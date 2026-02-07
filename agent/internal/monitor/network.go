package monitor

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	psnet "github.com/shirou/gopsutil/v3/net"
)

var (
	lastNetStats []psnet.IOCountersStat
	lastNetTime  time.Time
)

type NetworkMetrics struct {
	PublicIP    string           `json:"public_ip"`
	LocalIPs    []string         `json:"local_ips"`
	PingResults []PingResult     `json:"ping_results"`
	PortResults []PortResult     `json:"port_results"`
	Interfaces  []InterfaceStats `json:"interfaces"`
}

type InterfaceStats struct {
	Name    string   `json:"name"`
	IPs     []string `json:"ips"`
	RxBps   float64  `json:"rx_bps"`
	TxBps   float64  `json:"tx_bps"`
	RxBytes uint64   `json:"rx_bytes"`
	TxBytes uint64   `json:"tx_bytes"`
}

type PingResult struct {
	Host    string `json:"host"`
	Success bool   `json:"success"`
	Latency int64  `json:"latency_ms"`
}

type PortResult struct {
	Host string `json:"host"`
	Port int    `json:"port"`
	Open bool   `json:"open"`
}

func CheckNetwork(hosts []string, ports []map[string]interface{}) *NetworkMetrics {
	metrics := &NetworkMetrics{
		LocalIPs: []string{},
	}

	// 1. Get Public IP
	httpClient := &http.Client{Timeout: 2 * time.Second}
	if resp, err := httpClient.Get("https://ident.me"); err == nil {
		if ip, err := io.ReadAll(resp.Body); err == nil {
			metrics.PublicIP = string(ip)
		}
		resp.Body.Close()
	}

	// 2. Get Local IPs
	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, addr := range addrs {
			if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
				if ipnet.IP.To4() != nil {
					metrics.LocalIPs = append(metrics.LocalIPs, ipnet.IP.String())
				}
			}
		}
	}

	// 3. Bandwidth & IP Correlation
	now := time.Now()
	if currentStats, err := psnet.IOCounters(true); err == nil {
		if !lastNetTime.IsZero() {
			duration := now.Sub(lastNetTime).Seconds()
			
			// Map interface names to IPs
			ifaceMap := make(map[string][]string)
			if nIfaces, err := net.Interfaces(); err == nil {
				for _, iface := range nIfaces {
					if addrs, err := iface.Addrs(); err == nil {
						for _, addr := range addrs {
							if ipnet, ok := addr.(*net.IPNet); ok {
								if ipnet.IP.To4() != nil {
									ifaceMap[iface.Name] = append(ifaceMap[iface.Name], ipnet.IP.String())
								}
							}
						}
					}
				}
			}

			for _, curr := range currentStats {
				for _, prev := range lastNetStats {
					if curr.Name == prev.Name {
						rxBps := float64(curr.BytesRecv-prev.BytesRecv) * 8 / duration
						txBps := float64(curr.BytesSent-prev.BytesSent) * 8 / duration
						
						metrics.Interfaces = append(metrics.Interfaces, InterfaceStats{
							Name:    curr.Name,
							IPs:     ifaceMap[curr.Name],
							RxBps:   rxBps,
							TxBps:   txBps,
							RxBytes: curr.BytesRecv,
							TxBytes: curr.BytesSent,
						})
						break
					}
				}
			}
		}
		lastNetStats = currentStats
		lastNetTime = now
	}

	for _, host := range hosts {
		start := time.Now()
		conn, err := net.DialTimeout("tcp", host+":80", 2*time.Second)
		latency := time.Since(start).Milliseconds()
		success := err == nil
		if conn != nil {
			conn.Close()
		}
		metrics.PingResults = append(metrics.PingResults, PingResult{
			Host:    host,
			Success: success,
			Latency: latency,
		})
	}

	for _, p := range ports {
		host, _ := p["host"].(string)
		port, _ := p["port"].(float64)
		address := fmt.Sprintf("%s:%d", host, int(port))
		conn, err := net.DialTimeout("tcp", address, 2*time.Second)
		open := err == nil
		if conn != nil {
			conn.Close()
		}
		metrics.PortResults = append(metrics.PortResults, PortResult{
			Host: host,
			Port: int(port),
			Open: open,
		})
	}

	return metrics
}
