package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/iotmonitor/agent/internal/config"
	"github.com/iotmonitor/agent/internal/monitor"
	"github.com/iotmonitor/agent/internal/mqtt"
)

func main() {
	configPath := flag.String("config", "config.json", "Path to config file")
	flag.Parse()

	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	if cfg.DeviceID == "" || cfg.AgentToken == "" {
		log.Fatal("DeviceID and AgentToken are required. Set via config file or env vars (IOT_DEVICE_ID, IOT_AGENT_TOKEN)")
	}

	client, err := mqtt.NewClient(cfg)
	if err != nil {
		log.Fatalf("Failed to connect to MQTT: %v", err)
	}

	client.PublishStatus("online")

	// Start command handler
	client.HandleCommands()

	// Graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	log.Println("IoTMonitor Agent started successfully")

	for {
		select {
		case <-ticker.C:
			// System Metrics
			sysMetrics, err := monitor.GetSystemMetrics()
			if err == nil {
				client.PublishMetric("system", sysMetrics)
			}

			// Docker Metrics
			dockerMetrics, err := monitor.GetDockerMetrics()
			if err == nil {
				client.PublishMetric("docker", dockerMetrics)
			}

			// Asterisk Metrics
			astMetrics, err := monitor.GetAsteriskPJSIPMetrics("asterisk")
			if err == nil {
				client.PublishMetric("asterisk", astMetrics)
			} else {
				log.Printf("Asterisk metrics error: %v", err)
			}

			// Network Metrics (Example targets)
			netMetrics := monitor.CheckNetwork([]string{"google.com", "1.1.1.1"}, []map[string]interface{}{
				{"host": "google.com", "port": 443.0},
			})
			client.PublishMetric("network", netMetrics)

		case sig := <-sigChan:
			log.Printf("Received signal: %v. Shutting down...", sig)
			client.PublishStatus("offline")
			client.Disconnect(250)
			return
		}
	}
}
