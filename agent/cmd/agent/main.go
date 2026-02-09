package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/iotmonitor/agent/internal/config"
	"github.com/iotmonitor/agent/internal/monitor"
	"github.com/iotmonitor/agent/internal/mqtt"
)

func loadEnabledModules(raw string) map[string]bool {
	enabled := map[string]bool{
		"system":   true,
		"docker":   true,
		"asterisk": true,
		"network":  true,
	}

	raw = strings.TrimSpace(raw)
	if raw == "" {
		return enabled
	}

	// If explicitly set, only listed modules are enabled.
	for k := range enabled {
		enabled[k] = false
	}

	for _, module := range strings.Split(raw, ",") {
		name := strings.ToLower(strings.TrimSpace(module))
		if _, ok := enabled[name]; ok {
			enabled[name] = true
		}
	}

	return enabled
}

func main() {
	configPath := flag.String("config", "config.json", "Path to config file")
	debug := flag.Bool("debug", false, "Enable debug logging")
	flag.Parse()

	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	if *debug {
		cfg.Debug = true
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
	enabledModules := loadEnabledModules(cfg.EnabledModules)
	asteriskContainer := strings.TrimSpace(os.Getenv("IOT_ASTERISK_CONTAINER"))
	if asteriskContainer == "" {
		asteriskContainer = "asterisk"
	}

	for {
		select {
		case <-ticker.C:
			// System Metrics
			if enabledModules["system"] {
				sysMetrics, err := monitor.GetSystemMetrics()
				if err == nil {
					client.PublishMetric("system", sysMetrics)
				}
			}

			// Docker Metrics
			if enabledModules["docker"] {
				dockerMetrics, err := monitor.GetDockerMetrics()
				if err == nil {
					client.PublishMetric("docker", dockerMetrics)
				}
			}

			// Asterisk Metrics
			if enabledModules["asterisk"] {
				astMetrics, err := monitor.GetAsteriskPJSIPMetrics(asteriskContainer)
				if err == nil {
					client.PublishMetric("asterisk", astMetrics)
				} else {
					log.Printf("Asterisk metrics error: %v", err)
				}
			}

			// Network Metrics (Example targets)
			if enabledModules["network"] {
				netMetrics := monitor.CheckNetwork([]string{"google.com", "1.1.1.1"}, []map[string]interface{}{
					{"host": "google.com", "port": 443.0},
				})
				client.PublishMetric("network", netMetrics)
			}

		case sig := <-sigChan:
			log.Printf("Received signal: %v. Shutting down...", sig)
			client.PublishStatus("offline")
			client.Disconnect(250)
			return
		}
	}
}
