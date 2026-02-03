package monitor

import (
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	"os"
)

type SystemMetrics struct {
	Hostname    string  `json:"hostname"`
	CPUUsage    float64 `json:"cpu_usage"`
	CPULoad     float64 `json:"cpu_load"` // 1 min load avg
	CPUPerCore  []float64 `json:"cpu_per_core"`
	MemoryUsage float64 `json:"memory_usage"`
	MemoryTotal uint64  `json:"memory_total"`
	MemoryUsed  uint64  `json:"memory_used"`
	MemoryAvail uint64  `json:"memory_available"`
	MemoryCached uint64 `json:"memory_cached"`
	MemoryBuffers uint64 `json:"memory_buffers"`
	DiskUsage   float64 `json:"disk_usage"`
	DiskTotal   uint64  `json:"disk_total"`
	DiskUsed    uint64  `json:"disk_used"`
	Uptime      uint64  `json:"uptime"`
	Timestamp   int64   `json:"timestamp"`
}

func GetSystemMetrics() (*SystemMetrics, error) {
	// CPU: 2s sample to smooth short spikes (per-core then avg for total)
	perCorePercent, err := cpu.Percent(2*time.Second, true)
	if err != nil {
		return nil, err
	}
	totalCpu := 0.0
	for _, v := range perCorePercent {
		totalCpu += v
	}
	if len(perCorePercent) > 0 {
		totalCpu = totalCpu / float64(len(perCorePercent))
	}

	vm, err := mem.VirtualMemory()
	if err != nil {
		return nil, err
	}

	// Disk path can be overridden (useful when running inside containers)
	path := os.Getenv("IOT_DISK_PATH")
	if path == "" {
		path = "/"
	}

	diskInfo, err := disk.Usage(path)
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

	// Memory: align with "free -h" by using (total - available) as used
	memUsed := vm.Total - vm.Available
	memUsedPct := float64(memUsed) / float64(vm.Total) * 100

	return &SystemMetrics{
		Hostname:    info.Hostname,
		CPUUsage:    totalCpu,
		CPULoad:     avg.Load1,
		CPUPerCore:  perCorePercent,
		MemoryUsage: memUsedPct,
		MemoryTotal: vm.Total,
		MemoryUsed:  memUsed,
		MemoryAvail: vm.Available,
		MemoryCached: vm.Cached,
		MemoryBuffers: vm.Buffers,
		DiskUsage:   diskInfo.UsedPercent,
		DiskTotal:   diskInfo.Total,
		DiskUsed:    diskInfo.Used,
		Uptime:      info.Uptime,
		Timestamp:   time.Now().Unix(),
	}, nil
}
