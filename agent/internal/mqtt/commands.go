package mqtt

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type CommandRequest struct {
	CommandID string   `json:"command_id"`
	Payload   string   `json:"payload"`
	Args      []string `json:"args"`
	Timeout   int      `json:"timeout"` // in seconds
}

type CommandResponse struct {
	CommandID string `json:"command_id"`
	Output    string `json:"output"`
	ExitCode  int    `json:"exit_code"`
	Error     string `json:"error"`
}

func (c *Client) HandleCommands() {
	topic := fmt.Sprintf("%s/%s/commands", c.Config.MQTTPrefix, c.Config.DeviceID)
	c.Subscribe(topic, 1, func(client mqtt.Client, msg mqtt.Message) {
		if c.Config.Debug {
			log.Printf("[DEBUG] Received message on %s: %s", msg.Topic(), string(msg.Payload()))
		}

		var req CommandRequest
		if err := json.Unmarshal(msg.Payload(), &req); err != nil {
			log.Printf("Failed to unmarshal command: %v", err)
			return
		}

		log.Printf("Received command: %s %v", req.Payload, req.Args)
		resp := c.ExecuteCommand(req)

		respTopic := fmt.Sprintf("%s/%s/responses", c.Config.MQTTPrefix, c.Config.DeviceID)
		respData, _ := json.Marshal(resp)
		client.Publish(respTopic, 1, false, respData)
	})
}

func (c *Client) ExecuteCommand(req CommandRequest) CommandResponse {
	timeout := time.Duration(req.Timeout) * time.Second
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, req.Payload, req.Args...)
	output, err := cmd.CombinedOutput()

	resp := CommandResponse{
		CommandID: req.CommandID,
		Output:    string(output),
		ExitCode:  0,
	}

	if err != nil {
		resp.Error = err.Error()
		if exitError, ok := err.(*exec.ExitError); ok {
			resp.ExitCode = exitError.ExitCode()
		} else {
			resp.ExitCode = -1
		}
	}

	return resp
}
