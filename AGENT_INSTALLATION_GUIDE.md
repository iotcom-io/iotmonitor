# IoTMonitor Agent Installation Guide

## Overview

This guide provides production-grade instructions for installing the IoTMonitor agent on your servers and devices. The agent collects telemetry and sends it to the central monitoring platform.

## Prerequisites

### Linux Systems
- **OS**: Ubuntu 20.04+, Debian 11+, CentOS 8+, RHEL 8+, or any systemd-based Linux distribution
- **Privileges**: Root or sudo access
- **Network**: Outbound internet access to reach the monitoring server
- **Required Tools**: `curl`, `systemctl`

### Windows Systems
- **OS**: Windows Server 2019+ or Windows 10+
- **Privileges**: Administrator access
- **Network**: Outbound internet access to reach the monitoring server
- **Required Tools**: PowerShell 5.1+

## Installation Methods

### Method 1: One-Line Command (Recommended)

#### Linux
```bash
curl -fsSL "https://your-domain.com/api/devices/{device_id}/install-script?os=linux" | sudo bash
```

#### Windows (PowerShell)
```powershell
powershell -Command "Invoke-WebRequest -Uri 'https://your-domain.com/api/devices/{device_id}/install-script?os=windows' -OutFile 'install.ps1'; .\install.ps1"
```

**Important**: Your nginx must have `/socket.io/` proxy configured for WebSocket connections to work after installation.

### Method 2: Download and Execute

#### Linux
```bash
# Download the installation script
curl -fsSL "https://your-domain.com/api/devices/{device_id}/install-script?os=linux" -o install-agent.sh

# Review the script (recommended)
cat install-agent.sh

# Execute the script
sudo bash install-agent.sh

# Clean up
rm install-agent.sh
```

#### Windows
```powershell
# Download the installation script
Invoke-WebRequest -Uri "https://your-domain.com/api/devices/{device_id}/install-script?os=windows" -OutFile install.ps1

# Review the script (recommended)
Get-Content install.ps1

# Execute the script (run as Administrator)
.\install.ps1

# Clean up
Remove-Item install.ps1
```

## What the Installation Script Does

### Linux Installation Steps
1. **Validation**: Checks for root privileges and required commands (curl, systemctl)
2. **Download**: Downloads the pre-built agent binary for your device
3. **Installation**: Moves binary to `/usr/local/bin/iotmonitor-agent`
4. **Service Setup**: Creates systemd service with security hardening
5. **Log Directory**: Creates `/var/log/iotmonitor` for logs
6. **Service Start**: Enables and starts the service
7. **Verification**: Checks if service started successfully

### Windows Installation Steps
1. **Download**: Downloads the agent binary
2. **Installation**: Installs to `C:\Program Files\` or `C:\` if Program Files is unavailable
3. **Log Directory**: Creates `C:\ProgramData\iotmonitor` for logs
4. **Service Setup**: Creates Windows service (if possible)
5. **Service Start**: Starts the service
6. **Manual Fallback**: Provides manual execution command if service creation fails

## Post-Installation Verification

### Linux
```bash
# Check service status
sudo systemctl status iotmonitor-agent

# View live logs
sudo journalctl -u iotmonitor-agent -f

# Check recent logs
sudo journalctl -u iotmonitor-agent -n 50

# Restart service if needed
sudo systemctl restart iotmonitor-agent

# Stop service
sudo systemctl stop iotmonitor-agent
```

### Windows
```powershell
# Check service status
Get-Service IoTMonitorAgent

# View event logs
Get-EventLog -LogName Application -Source IoTMonitorAgent -Newest 50

# Restart service
Restart-Service IoTMonitorAgent

# Stop service
Stop-Service IoTMonitorAgent

# Manual execution (if service fails)
C:\Program Files\iotmonitor-agent.exe
```

## Troubleshooting

### Service Won't Start

#### Linux
```bash
# Check detailed error logs
sudo journalctl -u iotmonitor-agent -n 100 --no-pager

# Check if binary exists and is executable
ls -la /usr/local/bin/iotmonitor-agent

# Test binary manually
sudo /usr/local/bin/iotmonitor-agent
```

#### Windows
```powershell
# Run manually to see errors
C:\Program Files\iotmonitor-agent.exe

# Check Windows Event Viewer
eventvwr.msc

# Verify binary location
Test-Path "C:\Program Files\iotmonitor-agent.exe"
```

### Connection Issues

1. **Firewall Rules**: Ensure outbound connections to your MQTT server are allowed
2. **DNS Resolution**: Verify the server can resolve the monitoring domain
3. **Network Connectivity**: Test connectivity to the monitoring server
   ```bash
   # Linux
   curl -I https://your-domain.com
   
   # Windows
   Test-NetConnection your-domain.com -Port 443
   ```

### Permission Issues

#### Linux
```bash
# Ensure binary has correct permissions
sudo chmod +x /usr/local/bin/iotmonitor-agent
sudo chown root:root /usr/local/bin/iotmonitor-agent

# Fix log directory permissions
sudo chown -R nobody:nogroup /var/log/iotmonitor
```

#### Windows
```powershell
# Run PowerShell as Administrator
# Ensure binary has execute permissions
icacls "C:\Program Files\iotmonitor-agent.exe"
```

## Security Hardening

### Linux (Systemd Service)
The installation script includes these security features:
- `NoNewPrivileges=true`: Prevents privilege escalation
- `PrivateTmp=true`: Isolates /tmp
- `ProtectSystem=strict`: Read-only system directories
- `ProtectHome=true`: No access to home directories
- `ReadWritePaths=/var/log/iotmonitor`: Only log directory is writable

### Windows Service
- Runs with minimal privileges
- Logs to secure ProgramData directory
- Service configured for automatic startup

## Uninstallation

### Linux
```bash
# Stop and disable service
sudo systemctl stop iotmonitor-agent
sudo systemctl disable iotmonitor-agent

# Remove service file
sudo rm /etc/systemd/system/iotmonitor-agent.service
sudo systemctl daemon-reload

# Remove binary
sudo rm /usr/local/bin/iotmonitor-agent

# Remove log directory (optional)
sudo rm -rf /var/log/iotmonitor
```

### Windows
```powershell
# Stop and remove service
Stop-Service IoTMonitorAgent
sc delete IoTMonitorAgent

# Remove binary
Remove-Item "C:\Program Files\iotmonitor-agent.exe"

# Remove log directory (optional)
Remove-Item "C:\ProgramData\iotmonitor" -Recurse
```

## Configuration

The agent is pre-configured during build with:
- Device ID
- Agent authentication token
- MQTT broker URL and credentials
- Enabled monitoring modules
- Custom settings (Asterisk container, ping hosts, etc.)

To reconfigure, you must regenerate the agent binary from the monitoring platform.

## Monitoring and Maintenance

### Health Checks
The agent sends heartbeat every 10 seconds. If the device appears offline:
1. Check service status
2. Review logs for errors
3. Verify network connectivity
4. Check MQTT broker status

### Log Rotation
Logs are managed by systemd (Linux) or Windows Event Log (Windows). No manual rotation needed.

### Updates
To update the agent:
1. Generate new agent binary from monitoring platform
2. Stop the service
3. Replace the binary
4. Restart the service

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review logs for error messages
3. Contact your system administrator
4. Check the monitoring platform documentation

## Best Practices

1. **Test in Staging**: Always test installation in a staging environment first
2. **Review Scripts**: Review installation scripts before execution
3. **Monitor Initial Deployment**: Closely monitor the first 24 hours after installation
4. **Document Custom Configurations**: Keep records of any custom configurations
5. **Regular Updates**: Keep agents updated with the latest versions
6. **Backup Configuration**: Document device-specific configurations before updates
