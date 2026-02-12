package monitor

import (
	"sort"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/process"
	"os"
)

type TopProcess struct {
	PID           int32   `json:"pid"`
	Name          string  `json:"name"`
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryPercent float32 `json:"memory_percent"`
}

type SystemMetrics struct {
	Hostname             string       `json:"hostname"`
	CPUUsage             float64      `json:"cpu_usage"`
	CPULoad              float64      `json:"cpu_load"` // 1 min load avg
	CPUPerCore           []float64    `json:"cpu_per_core"`
	MemoryUsage          float64      `json:"memory_usage"`
	MemoryTotal          uint64       `json:"memory_total"`
	MemoryUsed           uint64       `json:"memory_used"`
	MemoryAvail          uint64       `json:"memory_available"`
	MemoryCached         uint64       `json:"memory_cached"`
	MemoryBuffers        uint64       `json:"memory_buffers"`
	DiskUsage            float64      `json:"disk_usage"`
	DiskTotal            uint64       `json:"disk_total"`
	DiskUsed             uint64       `json:"disk_used"`
	DiskReadBytesPerSec  float64      `json:"disk_read_bytes_per_sec"`
	DiskWriteBytesPerSec float64      `json:"disk_write_bytes_per_sec"`
	TopCPUProcesses      []TopProcess `json:"top_cpu_processes"`
	Uptime               uint64       `json:"uptime"`
	Timestamp            int64        `json:"timestamp"`
}

var (
	diskIOMu           sync.Mutex
	prevDiskSampleAt   time.Time
	prevDiskReadBytes  uint64
	prevDiskWriteBytes uint64
)

func readDiskIOPerSecond() (float64, float64) {
	counters, err := disk.IOCounters()
	if err != nil || len(counters) == 0 {
		return 0, 0
	}

	var totalRead uint64
	var totalWrite uint64
	for _, stat := range counters {
		totalRead += stat.ReadBytes
		totalWrite += stat.WriteBytes
	}

	now := time.Now()
	diskIOMu.Lock()
	defer diskIOMu.Unlock()

	if prevDiskSampleAt.IsZero() {
		prevDiskSampleAt = now
		prevDiskReadBytes = totalRead
		prevDiskWriteBytes = totalWrite
		return 0, 0
	}

	elapsed := now.Sub(prevDiskSampleAt).Seconds()
	if elapsed <= 0 {
		prevDiskSampleAt = now
		prevDiskReadBytes = totalRead
		prevDiskWriteBytes = totalWrite
		return 0, 0
	}

	var readDelta uint64
	var writeDelta uint64
	if totalRead >= prevDiskReadBytes {
		readDelta = totalRead - prevDiskReadBytes
	}
	if totalWrite >= prevDiskWriteBytes {
		writeDelta = totalWrite - prevDiskWriteBytes
	}

	prevDiskSampleAt = now
	prevDiskReadBytes = totalRead
	prevDiskWriteBytes = totalWrite

	return float64(readDelta) / elapsed, float64(writeDelta) / elapsed
}

func readTopCPUProcesses(limit int) []TopProcess {
	if limit <= 0 {
		return []TopProcess{}
	}

	procs, err := process.Processes()
	if err != nil {
		return []TopProcess{}
	}

	// Prevent sampling extremely large process lists every cycle.
	if len(procs) > 400 {
		procs = procs[:400]
	}

	top := make([]TopProcess, 0, len(procs))
	for _, procEntry := range procs {
		if procEntry == nil {
			continue
		}

		cpuPercent, err := procEntry.CPUPercent()
		if err != nil {
			continue
		}
		memPercent, _ := procEntry.MemoryPercent()
		name, _ := procEntry.Name()
		if name == "" {
			name = "unknown"
		}

		top = append(top, TopProcess{
			PID:           procEntry.Pid,
			Name:          name,
			CPUPercent:    cpuPercent,
			MemoryPercent: memPercent,
		})
	}

	sort.Slice(top, func(i, j int) bool {
		if top[i].CPUPercent == top[j].CPUPercent {
			return top[i].MemoryPercent > top[j].MemoryPercent
		}
		return top[i].CPUPercent > top[j].CPUPercent
	})

	if len(top) > limit {
		top = top[:limit]
	}
	return top
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
	diskReadBytesPerSec, diskWriteBytesPerSec := readDiskIOPerSecond()
	topCPUProcesses := readTopCPUProcesses(5)

	// Memory: align with "free -h" by using (total - available) as used
	memUsed := vm.Total - vm.Available
	memUsedPct := float64(memUsed) / float64(vm.Total) * 100

	return &SystemMetrics{
		Hostname:             info.Hostname,
		CPUUsage:             totalCpu,
		CPULoad:              avg.Load1,
		CPUPerCore:           perCorePercent,
		MemoryUsage:          memUsedPct,
		MemoryTotal:          vm.Total,
		MemoryUsed:           memUsed,
		MemoryAvail:          vm.Available,
		MemoryCached:         vm.Cached,
		MemoryBuffers:        vm.Buffers,
		DiskUsage:            diskInfo.UsedPercent,
		DiskTotal:            diskInfo.Total,
		DiskUsed:             diskInfo.Used,
		DiskReadBytesPerSec:  diskReadBytesPerSec,
		DiskWriteBytesPerSec: diskWriteBytesPerSec,
		TopCPUProcesses:      topCPUProcesses,
		Uptime:               info.Uptime,
		Timestamp:            time.Now().Unix(),
	}, nil
}
