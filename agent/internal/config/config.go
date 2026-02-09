package config

import (
	"encoding/json"
	"os"
)

type Config struct {
	DeviceID   string `json:"device_id"`
	AgentToken string `json:"agent_token"`
	MQTTURL    string `json:"mqtt_url"`
	MQTTPort   int    `json:"mqtt_port"`
	UseTLS     bool   `json:"use_tls"`
	MQTTPrefix string `json:"mqtt_prefix"`
	Debug      bool   `json:"debug"`
	EnabledModules string `json:"enabled_modules"`
}

var (
	DefaultDeviceID   = ""
	DefaultAgentToken = ""
	DefaultMQTTURL    = "localhost"
	DefaultEnabledModules = "system,docker,asterisk,network"
)

func LoadConfig(path string) (*Config, error) {
	file, err := os.Open(path)
	if err != nil {
		// If no config file, try environment variables or default values
		cfg := &Config{
			DeviceID:   os.Getenv("IOT_DEVICE_ID"),
			AgentToken: os.Getenv("IOT_AGENT_TOKEN"),
			MQTTURL:    os.Getenv("IOT_MQTT_URL"),
			MQTTPrefix: "iotmonitor/device",
			EnabledModules: os.Getenv("IOT_ENABLED_MODULES"),
		}

		if cfg.DeviceID == "" {
			cfg.DeviceID = DefaultDeviceID
		}
		if cfg.AgentToken == "" {
			cfg.AgentToken = DefaultAgentToken
		}
		if cfg.MQTTURL == "" {
			cfg.MQTTURL = DefaultMQTTURL
		}
		if cfg.EnabledModules == "" {
			cfg.EnabledModules = DefaultEnabledModules
		}

		return cfg, nil
	}
	defer file.Close()

	var cfg Config
	decoder := json.NewDecoder(file)
	if err := decoder.Decode(&cfg); err != nil {
		return nil, err
	}

	if cfg.MQTTPrefix == "" {
		cfg.MQTTPrefix = "iotmonitor/device"
	}
	if cfg.EnabledModules == "" {
		cfg.EnabledModules = DefaultEnabledModules
	}

	return &cfg, nil
}
