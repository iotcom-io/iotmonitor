package monitor

import (
	"os/exec"
	"strings"
)

type AsteriskStatus struct {
	Online     bool   `json:"online"`
	Uptime     string `json:"uptime"`
	SipRegs    int    `json:"sip_registrations"`
	LastOutput string `json:"last_output"`
}

func GetAsteriskStatus(isDocker bool, containerName string) (*AsteriskStatus, error) {
	var cmd *exec.Cmd
	if isDocker {
		cmd = exec.Command("docker", "exec", containerName, "asterisk", "-rx", "core show uptime")
	} else {
		cmd = exec.Command("asterisk", "-rx", "core show uptime")
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return &AsteriskStatus{Online: false, LastOutput: string(output)}, nil
	}

	status := &AsteriskStatus{
		Online:     true,
		LastOutput: string(output),
	}

	// Parsing uptime
	lines := strings.Split(string(output), "\n")
	if len(lines) > 0 {
		status.Uptime = strings.TrimSpace(lines[0])
	}

	// Parsing SIP registrations (example)
	if isDocker {
		cmd = exec.Command("docker", "exec", containerName, "asterisk", "-rx", "pjsip show registrations")
	} else {
		cmd = exec.Command("asterisk", "-rx", "pjsip show registrations")
	}

	sipOutput, _ := cmd.Output()
	// Simplified parsing for demonstration
	status.SipRegs = strings.Count(string(sipOutput), "Registered")

	return status, nil
}
