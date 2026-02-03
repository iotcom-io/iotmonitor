package monitor

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type PJSIPRegistration struct {
	Name      string `json:"name"`
	ServerURI string `json:"serverUri"`
	Auth      string `json:"auth"`
	Status    string `json:"status"`
	ExpiresS  *int64 `json:"expiresS,omitempty"`
	Raw       string `json:"raw,omitempty"`
}

type PJSIPContact struct {
	AOR        string   `json:"aor"`
	ContactURI string   `json:"contactUri"`
	Hash       string   `json:"hash"`
	Status     string   `json:"status"`
	RTTms      *float64 `json:"rttMs,omitempty"`
	Raw        string   `json:"raw,omitempty"`
}

type AsteriskPJSIPMetrics struct {
	Registrations []PJSIPRegistration `json:"registrations"`
	Contacts      []PJSIPContact      `json:"contacts"`
	Summary       map[string]any      `json:"summary"`
}

var expRe = regexp.MustCompile(`\(exp\.\s+(\d+)s\)`)

func dockerExecAsterisk(ctx context.Context, container string, cmd string) (string, error) {
	// docker exec <container> asterisk -rx "<cmd>"
	c := exec.CommandContext(ctx, "docker", "exec", container, "asterisk", "-rx", cmd)
	var out bytes.Buffer
	var stderr bytes.Buffer
	c.Stdout = &out
	c.Stderr = &stderr

	if err := c.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", errors.New(msg)
	}
	return out.String(), nil
}

func parsePJSIPRegistrations(output string) []PJSIPRegistration {
	lines := strings.Split(output, "\n")
	var rows []string

	inTable := false
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "====") {
			inTable = true
			continue
		}
		if strings.HasPrefix(line, "Objects found:") {
			break
		}
		if !inTable {
			continue
		}
		// Skip header line if it leaks through
		if strings.HasPrefix(line, "<Registration/ServerURI") {
			continue
		}
		rows = append(rows, line)
	}

	var regs []PJSIPRegistration
	for _, row := range rows {
		// Collapse multiple spaces
		fields := strings.Fields(row)
		if len(fields) < 3 {
			continue
		}

		// First field is like "esamwadstag/sip:esamwad.iotcom.io"
		first := fields[0]
		name := first
		serverURI := ""
		if i := strings.Index(first, "/"); i > 0 && i+1 < len(first) {
			name = first[:i]
			serverURI = first[i+1:]
		}

		auth := fields[1]
		status := fields[2]

		var expires *int64
		if m := expRe.FindStringSubmatch(row); len(m) == 2 {
			if v, err := strconv.ParseInt(m[1], 10, 64); err == nil {
				expires = &v
			}
		}

		regs = append(regs, PJSIPRegistration{
			Name:      name,
			ServerURI: serverURI,
			Auth:      auth,
			Status:    status,
			ExpiresS:  expires,
			Raw:       row,
		})
	}
	return regs
}

func parsePJSIPContacts(output string) []PJSIPContact {
	lines := strings.Split(output, "\n")
	var rows []string

	inTable := false
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "====") {
			inTable = true
			continue
		}
		if strings.HasPrefix(line, "Objects found:") {
			break
		}
		if !inTable {
			continue
		}
		if strings.HasPrefix(line, "Contact:  <Aor/ContactUri") {
			continue
		}
		// Some lines start with "Contact:" prefix
		line = strings.TrimPrefix(line, "Contact:")
		line = strings.TrimSpace(line)
		rows = append(rows, line)
	}

	var contacts []PJSIPContact
	for _, row := range rows {
		fields := strings.Fields(row)
		// Expected: aor/contacturi hash status rtt
		if len(fields) < 4 {
			continue
		}

		first := fields[0]
		aor := first
		contactURI := ""
		if i := strings.Index(first, "/"); i > 0 && i+1 < len(first) {
			aor = first[:i]
			contactURI = first[i+1:]
		}

		hash := fields[1]
		status := fields[2]

		var rtt *float64
		if len(fields) >= 4 {
			if strings.ToLower(fields[3]) != "nan" {
				if v, err := strconv.ParseFloat(fields[3], 64); err == nil {
					rtt = &v
				}
			}
		}

		contacts = append(contacts, PJSIPContact{
			AOR:        aor,
			ContactURI: contactURI,
			Hash:       hash,
			Status:     status,
			RTTms:      rtt,
			Raw:        row,
		})
	}
	return contacts
}

// Public function your main loop can call
func GetAsteriskPJSIPMetrics(container string) (AsteriskPJSIPMetrics, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	regOut, err := dockerExecAsterisk(ctx, container, "pjsip show registrations")
	if err != nil {
		return AsteriskPJSIPMetrics{}, err
	}
	contOut, err := dockerExecAsterisk(ctx, container, "pjsip show contacts")
	if err != nil {
		return AsteriskPJSIPMetrics{}, err
	}

	regs := parsePJSIPRegistrations(regOut)
	contacts := parsePJSIPContacts(contOut)

	// Summaries
	summary := map[string]any{
		"registrationsTotal": len(regs),
		"contactsTotal":      len(contacts),
	}
	regOk := 0
	for _, r := range regs {
		if strings.EqualFold(r.Status, "Registered") {
			regOk++
		}
	}
	avail := 0
	unavail := 0
	for _, c := range contacts {
		if strings.EqualFold(c.Status, "Avail") {
			avail++
		} else if strings.EqualFold(c.Status, "Unavail") {
			unavail++
		}
	}
	summary["registrationsRegistered"] = regOk
	summary["contactsAvail"] = avail
	summary["contactsUnavail"] = unavail

	return AsteriskPJSIPMetrics{
		Registrations: regs,
		Contacts:      contacts,
		Summary:       summary,
	}, nil
}
