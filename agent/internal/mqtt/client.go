package mqtt

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/iotmonitor/agent/internal/config"
)

type Client struct {
	mqtt.Client
	Config *config.Config
}

func NewClient(cfg *config.Config) (*Client, error) {
	opts := mqtt.NewClientOptions()
	opts.AddBroker(cfg.MQTTURL)
	opts.SetClientID(cfg.DeviceID)

	// Prefer explicit broker credentials from settings/build env; fallback to device auth.
	username := strings.TrimSpace(cfg.MQTTUsername)
	password := cfg.MQTTPassword
	if username == "" {
		username = cfg.DeviceID
		password = cfg.AgentToken
	}

	opts.SetUsername(username)
	opts.SetPassword(password)
	opts.SetAutoReconnect(true)
	opts.SetMaxReconnectInterval(5 * time.Minute)

	if cfg.UseTLS {
		tlsConfig := &tls.Config{
			InsecureSkipVerify: true, // For development; should be false in production with proper CA
		}
		opts.SetTLSConfig(tlsConfig)
	}

	opts.OnConnect = func(c mqtt.Client) {
		log.Printf("Connected to MQTT broker at %s", cfg.MQTTURL)
	}

	opts.OnConnectionLost = func(c mqtt.Client, err error) {
		log.Printf("Disconnected from MQTT broker: %v", err)
	}

	client := mqtt.NewClient(opts)
	if token := client.Connect(); token.Wait() && token.Error() != nil {
		return nil, token.Error()
	}

	return &Client{client, cfg}, nil
}

func (c *Client) PublishMetric(checkType string, payload interface{}) error {
	topic := fmt.Sprintf("%s/%s/metrics/%s", c.Config.MQTTPrefix, c.Config.DeviceID, checkType)
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	if c.Config.Debug {
		log.Printf("[DEBUG] Publishing %s: %s", checkType, string(data))
	}

	token := c.Publish(topic, 1, false, data)
	token.Wait()
	return token.Error()
}

func (c *Client) PublishStatus(status string) error {
	topic := fmt.Sprintf("%s/%s/status", c.Config.MQTTPrefix, c.Config.DeviceID)
	token := c.Publish(topic, 1, true, status)
	token.Wait()
	return token.Error()
}
