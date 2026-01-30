package monitor

import (
	"fmt"
	"net"
	"time"
)

type NetworkMetrics struct {
	PingResults []PingResult `json:"ping_results"`
	PortResults []PortResult `json:"port_results"`
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
	metrics := &NetworkMetrics{}

	for _, host := range hosts {
		start := time.Now()
		// Simple TCP check as a proxy for ping if ICMP is restricted,
		// or just use a dialer with a short timeout.
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
		host := p["host"].(string)
		port := int(p["port"].(float64))
		address := fmt.Sprintf("%s:%d", host, port)
		conn, err := net.DialTimeout("tcp", address, 2*time.Second)
		open := err == nil
		if conn != nil {
			conn.Close()
		}
		metrics.PortResults = append(metrics.PortResults, PortResult{
			Host: host,
			Port: port,
			Open: open,
		})
	}

	return metrics
}
