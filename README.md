# 🚀 IoT Monitor - Complete Docker Deployment

A comprehensive IoT device monitoring platform with real-time telemetry, agent management, and alerting capabilities. Fully containerized for easy deployment.

## 📋 Table of Contents
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Manual Setup](#manual-setup)
- [Usage](#usage)
- [Documentation](#documentation)

## ✨ Features

- **Real-Time Monitoring**: Live device metrics via WebSocket (Socket.IO)
- **Multi-Module Agents**: System, Docker, Asterisk, Network monitoring
- **Custom Agent Builder**: On-demand agent compilation for Linux/Windows
- **Alert Management**: Configurable notification rules with test alerts
- **MQTT Integration**: Device communication via Mosquitto broker
- **REST API**: Comprehensive device and metrics management
- **Modern UI**: React + Vite with real-time charts (Recharts)

## 🏗️ Architecture

### Services
- **Frontend** (Port 3000): React SPA served by Nginx
- **Backend** (Port 5001): Node.js + TypeScript + Socket.IO
- **MongoDB** (Port 27017): Primary database
- **Redis** (Port 6379): Caching and session storage
- **Mosquitto** (Ports 1883, 8883): MQTT broker for agents

### Technology Stack
- **Backend**: Express.js, Socket.IO, Mongoose, MQTT.js
- **Frontend**: React 18, Vite, TailwindCSS, Zustand
- **Database**: MongoDB 7.0
- **Broker**: Eclipse Mosquitto 2.0
- **Container**: Docker + Docker Compose

## 🚀 Quick Start

### Prerequisites
```bash
# Verify Docker installation
docker --version  # (20.10+)
docker-compose --version  # (2.0+)
```

### One-Command Setup
```bash
cd /mnt/projects/iotmonitor
./quick-start.sh
```

This script will:
1. Build all Docker images
2. Start all services
3. Initialize the database
4. Seed with demo data

**Access the app at:** http://localhost:3000

### Default Credentials
```
Email: admin@iotcom.io
Password: admin123456
```

## 🔧 Manual Setup

### 1. Configure Environment
```bash
# Copy example env file (already configured for Docker)
cp backend/.env.example backend/.env

# Edit if needed
nano backend/.env
```

**Important variables:**
```bash
JWT_SECRET=change_this_in_production
MONGODB_URI=mongodb://mongodb:27017/iotmonitor
REDIS_URL=redis://redis:6379
MQTT_URL=mqtt://mosquitto:1883
SLACK_WEBHOOK_URL=your_slack_webhook_url (optional)
```

### 2. Build Images
```bash
docker-compose build
```

### 3. Start Services
```bash
# Start in detached mode
docker-compose up -d

# View logs
docker-compose logs -f
```

### 4. Initialize Database
```bash
# Run seed script
docker-compose exec backend npm run seed
```

## 📖 Usage

### Accessing Services
| Service | URL | Purpose |
|---------|-----|---------|
| Frontend | http://localhost:3000 | Web UI |
| Backend API | http://localhost:5001 | REST API |
| MongoDB | mongodb://localhost:27017 | Database |
| MQTT Broker | mqtt://localhost:1883 | Agent comms |

### Managing Containers

**View running containers:**
```bash
docker-compose ps
```

**View logs:**
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
```

**Restart a service:**
```bash
docker-compose restart backend
```

**Rebuild after code changes:**
```bash
# Rebuild specific service
docker-compose up -d --build backend

# Rebuild everything
docker-compose up -d --build
```

**Stop all services:**
```bash
docker-compose down
```

**Remove all data (destructive!):**
```bash
docker-compose down -v
```

### Registering Devices

1. Navigate to **Devices** → **Register Device**
2. Fill in device details:
   - Name: e.g., "Production Server 1"
   - Type: Server, Network Device, or Website
   - Hostname/IP: e.g., 192.168.1.100
   - Monitoring Modules: Select system, docker, asterisk, network
3. Click **Register Device**
4. Build agent for your platform (Linux/Windows, amd64/arm64)
5. Download and deploy agent on target device

### Building Agents

**Via UI:**
1. Go to Device List
2. Click "Build Agent" icon
3. Select OS and architecture
4. Download binary

**Agent runs automatically** and reports to MQTT broker.

### Viewing Real-Time Metrics

- **Dashboard**: Aggregated stats with live charts
- **Device Detail**: Per-device metrics, network info, SIP status
- **Settings Tab**: Configure notifications, test alerts

## 📚 Documentation

- [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md) - Comprehensive Docker guide
- [API Documentation](#) - REST API reference (coming soon)
- [Agent Development](#) - Custom agent modules (coming soon)

## 🔐 Security Recommendations

### For Production:

1. **Change secrets:**
   ```bash
   # Generate strong JWT secret
   openssl rand -base64 32
   ```

2. **Enable MongoDB auth:**
   ```yaml
   mongodb:
     environment:
       MONGO_INITDB_ROOT_USERNAME: admin
       MONGO_INITDB_ROOT_PASSWORD: <strong-password>
   ```

3. **Remove exposed ports** (only expose frontend):
   ```yaml
   mongodb:
     # Comment out ports section
     # ports:
     #   - "27017:27017"
   ```

4. **Use TLS for MQTT** (port 8883)

5. **Set up reverse proxy** (Nginx, Traefik, Caddy)

6. **Enable firewall rules**

## 🐛 Troubleshooting

### Container won't start
```bash
# Check detailed logs
docker-compose logs backend

# Rebuild without cache
docker-compose build --no-cache backend
docker-compose up -d
```

### MongoDB connection failed
```bash
# Check MongoDB health
docker-compose exec mongodb mongosh --eval "db.adminCommand('ping')"

# Verify connection string
docker-compose exec backend env | grep MONGODB_URI
```

### Port already in use
```bash
# Find process using port
netstat -tulpn | grep 3000

# Change port in docker-compose.yml
# frontend:
#   ports:
#     - "8080:80"  # Changed from 3000:80
```

## 📊 Monitoring & Maintenance

### Backup Database
```bash
# Backup MongoDB
docker-compose exec mongodb mongodump --out /data/db/backup

# Copy backup from container
docker cp iotmonitor-mongodb:/data/db/backup ./mongodb-backup
```

### View Resource Usage
```bash
docker stats
```

### Clean Up
```bash
# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Full cleanup
docker system prune -a
```

## 🤝 Contributing

Contributions welcome! See Phase 2, 3, and 4 tasks in `task.md`.

## 📄 License

MIT License

---

**Built with Docker** 🐳 | **Powered by Socket.IO** ⚡ | **Monitored by MQTT** 📡
