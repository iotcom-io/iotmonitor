package monitor

import (
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
)

type SystemMetrics struct {
	CPUUsage    float64 `json:"cpu_usage"`
	MemoryUsage float64 `json:"memory_usage"`
	Uptime      uint64  `json:"uptime"`
	Timestamp   int64   `json:"timestamp"`
}

func GetSystemMetrics() (*SystemMetrics, error) {
	cpuPercent, err := cpu.Percent(time.Second, false)
	if err != nil {
		return nil, err
	}

	vm, err := mem.VirtualMemory()
	if err != nil {
		return nil, err
	}

	info, err := host.Info()
	if err != nil {
		return nil, err
	}

	return &SystemMetrics{
		CPUUsage:    cpuPercent[0],
		MemoryUsage: vm.UsedPercent,
		Uptime:      info.Uptime,
		Timestamp:   time.Now().Unix(),
	}, nil
}
