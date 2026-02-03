package monitor

import (
	"context"
	"encoding/json"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
)

type ContainerInfo struct {
	ID          string   `json:"id"`
	Names       []string `json:"names"`
	Image       string   `json:"image"`
	State       string   `json:"state"`
	Status      string   `json:"status"`
	CPUPercent  float64  `json:"cpu_percent"`
	MemoryUsage uint64   `json:"memory_usage"`
	MemoryLimit uint64   `json:"memory_limit"`
	NetRx       uint64   `json:"net_rx"`
	NetTx       uint64   `json:"net_tx"`
}

func GetDockerMetrics() ([]ContainerInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	containers, err := cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil, err
	}

	var metrics []ContainerInfo
	for _, cnt := range containers {
		info := ContainerInfo{
			ID:     cnt.ID,
			Names:  cnt.Names,
			Image:  cnt.Image,
			State:  cnt.State,
			Status: cnt.Status,
		}

		// Only fetch stats for running containers
		if cnt.State == "running" {
			statsCtx, statsCancel := context.WithTimeout(ctx, 1*time.Second)
			stats, err := cli.ContainerStatsOneShot(statsCtx, cnt.ID)
			if err == nil {
				var data struct {
					CPUStats struct {
						CPUUsage struct {
							TotalUsage uint64 `json:"total_usage"`
						} `json:"cpu_usage"`
						SystemCPUUsage uint64 `json:"system_cpu_usage"`
						OnlineCPUs     uint32 `json:"online_cpus"`
					} `json:"cpu_stats"`
					PreCPUStats struct {
						CPUUsage struct {
							TotalUsage uint64 `json:"total_usage"`
						} `json:"cpu_usage"`
						SystemCPUUsage uint64 `json:"system_cpu_usage"`
					} `json:"precpu_stats"`
					MemoryStats struct {
						Usage uint64 `json:"usage"`
						Limit uint64 `json:"limit"`
					} `json:"memory_stats"`
					Networks map[string]struct {
						RxBytes uint64 `json:"rx_bytes"`
						TxBytes uint64 `json:"tx_bytes"`
					} `json:"networks"`
				}

				if err := json.NewDecoder(stats.Body).Decode(&data); err == nil {
					// CPU Calculation
					cpuDelta := float64(data.CPUStats.CPUUsage.TotalUsage) - float64(data.PreCPUStats.CPUUsage.TotalUsage)
					systemDelta := float64(data.CPUStats.SystemCPUUsage) - float64(data.PreCPUStats.SystemCPUUsage)
					onlineCPUs := float64(data.CPUStats.OnlineCPUs)
					if onlineCPUs == 0 {
						onlineCPUs = 1
					}

					if systemDelta > 0 && cpuDelta > 0 {
						info.CPUPercent = (cpuDelta / systemDelta) * onlineCPUs * 100.0
					}

					// Memory
					info.MemoryUsage = data.MemoryStats.Usage
					info.MemoryLimit = data.MemoryStats.Limit

					// Network
					for _, net := range data.Networks {
						info.NetRx += net.RxBytes
						info.NetTx += net.TxBytes
					}
				}
				stats.Body.Close()
			}
			statsCancel()
		}

		metrics = append(metrics, info)
	}

	return metrics, nil
}
