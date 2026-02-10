package config

import (
	"encoding/json"
	"os"
)

type Config struct {
	DeviceID          string `json:"device_id"`
	AgentToken        string `json:"agent_token"`
	MQTTURL           string `json:"mqtt_url"`
	MQTTUsername      string `json:"mqtt_username"`
	MQTTPassword      string `json:"mqtt_password"`
	MQTTPort          int    `json:"mqtt_port"`
	UseTLS            bool   `json:"use_tls"`
	MQTTPrefix        string `json:"mqtt_prefix"`
	Debug             bool   `json:"debug"`
	EnabledModules    string `json:"enabled_modules"`
	AsteriskContainer string `json:"asterisk_container"`
	PingHost          string `json:"ping_host"`
}

var (
	DefaultDeviceID          = ""
	DefaultAgentToken        = ""
	DefaultMQTTURL           = "localhost"
	DefaultMQTTUsername      = ""
	DefaultMQTTPassword      = ""
	DefaultEnabledModules    = "system,docker,asterisk,network"
	DefaultAsteriskContainer = "asterisk"
	DefaultPingHost          = "1.1.1.1"
)

func LoadConfig(path string) (*Config, error) {
	file, err := os.Open(path)
	if err != nil {
		// If no config file, try environment variables or default values
		cfg := &Config{
			DeviceID:          os.Getenv("IOT_DEVICE_ID"),
			AgentToken:        os.Getenv("IOT_AGENT_TOKEN"),
			MQTTURL:           os.Getenv("IOT_MQTT_URL"),
			MQTTUsername:      os.Getenv("IOT_MQTT_USERNAME"),
			MQTTPassword:      os.Getenv("IOT_MQTT_PASSWORD"),
			MQTTPrefix:        "iotmonitor/device",
			EnabledModules:    os.Getenv("IOT_ENABLED_MODULES"),
			AsteriskContainer: os.Getenv("IOT_ASTERISK_CONTAINER"),
			PingHost:          os.Getenv("IOT_PING_HOST"),
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
		if cfg.MQTTUsername == "" {
			cfg.MQTTUsername = DefaultMQTTUsername
		}
		if cfg.MQTTPassword == "" {
			cfg.MQTTPassword = DefaultMQTTPassword
		}
		if cfg.EnabledModules == "" {
			cfg.EnabledModules = DefaultEnabledModules
		}
		if cfg.AsteriskContainer == "" {
			cfg.AsteriskContainer = DefaultAsteriskContainer
		}
		if cfg.PingHost == "" {
			cfg.PingHost = DefaultPingHost
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
	if cfg.MQTTUsername == "" {
		cfg.MQTTUsername = os.Getenv("IOT_MQTT_USERNAME")
	}
	if cfg.MQTTUsername == "" {
		cfg.MQTTUsername = DefaultMQTTUsername
	}
	if cfg.MQTTPassword == "" {
		cfg.MQTTPassword = os.Getenv("IOT_MQTT_PASSWORD")
	}
	if cfg.MQTTPassword == "" {
		cfg.MQTTPassword = DefaultMQTTPassword
	}
	if cfg.EnabledModules == "" {
		cfg.EnabledModules = os.Getenv("IOT_ENABLED_MODULES")
	}
	if cfg.EnabledModules == "" {
		cfg.EnabledModules = DefaultEnabledModules
	}
	if cfg.AsteriskContainer == "" {
		cfg.AsteriskContainer = os.Getenv("IOT_ASTERISK_CONTAINER")
	}
	if cfg.AsteriskContainer == "" {
		cfg.AsteriskContainer = DefaultAsteriskContainer
	}
	if cfg.PingHost == "" {
		cfg.PingHost = os.Getenv("IOT_PING_HOST")
	}
	if cfg.PingHost == "" {
		cfg.PingHost = DefaultPingHost
	}

	return &cfg, nil
}
