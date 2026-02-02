package monitor

import (
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
)

type SystemMetrics struct {
	Hostname    string  `json:"hostname"`
	CPUUsage    float64 `json:"cpu_usage"`
	CPULoad     float64 `json:"cpu_load"` // 1 min load avg
	MemoryUsage float64 `json:"memory_usage"`
	MemoryTotal uint64  `json:"memory_total"`
	MemoryUsed  uint64  `json:"memory_used"`
	DiskUsage   float64 `json:"disk_usage"`
	DiskTotal   uint64  `json:"disk_total"`
	DiskUsed    uint64  `json:"disk_used"`
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

	diskInfo, err := disk.Usage("/")
	if err != nil {
		// Fallback for some systems where / might not be the right path
		diskInfo = &disk.UsageStat{}
	}

	info, err := host.Info()
	if err != nil {
		return nil, err
	}

	avg, err := load.Avg()
	if err != nil {
		avg = &load.AvgStat{}
	}

	return &SystemMetrics{
		Hostname:    info.Hostname,
		CPUUsage:    cpuPercent[0],
		CPULoad:     avg.Load1,
		MemoryUsage: vm.UsedPercent,
		MemoryTotal: vm.Total,
		MemoryUsed:  vm.Used,
		DiskUsage:   diskInfo.UsedPercent,
		DiskTotal:   diskInfo.Total,
		DiskUsed:    diskInfo.Used,
		Uptime:      info.Uptime,
		Timestamp:   time.Now().Unix(),
	}, nil
}
