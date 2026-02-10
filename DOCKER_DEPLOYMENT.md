# Docker Deployment Guide - IoT Monitor

## Prerequisites

- Docker Engine 20.10+ 
- Docker Compose 2.0+
- 2GB+ free disk space
- Ports available: 3000, 5001, 27017, 6379, 1883, 8883

## Quick Start

### 1. Clone and Navigate
```bash
cd /mnt/projects/iotmonitor
```

### 2. Environment Configuration
The `.env` file is already configured for Docker deployment. Review and update if needed:
```bash
nano backend/.env
```

**Key Variables:**
- `MONGODB_URI`: Uses `mongodb://mongodb:27017/iotmonitor` (Docker service name)
- `REDIS_URL`: Uses `redis://redis:6379` 
- `MQTT_URL`: Uses `mqtt://mosquitto:1883`
- `JWT_SECRET`: **Change for production!**
- `SLACK_WEBHOOK_URL`: Optional Slack notifications

### 3. Build and Start All Services
```bash
# Build images and start all containers
docker-compose up -d

# View logs
docker-compose logs -f

# Check service status
docker-compose ps
```

### 4. Access the Application
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5001
- **MongoDB**: localhost:27017
- **MQTT Broker**: localhost:1883

### 5. Initialize Database (First Run Only)
```bash
# Run database seed script
docker-compose exec backend npm run seed
```

## Services Architecture

### MongoDB
- **Image**: `mongo:7.0`
- **Port**: 27017
- **Volume**: `mongodb_data:/data/db`
- **Health Check**: Enabled with mongosh ping

### Redis
- **Image**: `redis:7.0-alpine`
- **Port**: 6379
- **Volume**: `redis_data:/data`
- **Persistence**: AOF enabled

### Mosquitto (MQTT Broker)
- **Image**: `eclipse-mosquitto:2.0`
- **Ports**: 1883 (MQTT), 8883 (MQTT over TLS)
- **Volumes**: Config, data, and logs persisted

### Backend (Node.js + TypeScript)
- **Build**: Multi-stage from `backend/Dockerfile`
- **Port**: 5001
- **Features**:
  - Built-in Go for agent compilation
  - REST API + Socket.IO
  - Auto-restart on failure

### Frontend (React + Vite + Nginx)
- **Build**: Multi-stage from `frontend/Dockerfile`
- **Port**: 3000 (Nginx serves on port 80 internally)
- **Features**:
  - Production-optimized build
  - API proxy to backend
  - Socket.IO WebSocket support

## Docker Commands Reference

### Managing Containers
```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# Restart specific service
docker-compose restart backend

# View logs for specific service
docker-compose logs -f backend

# View logs for all services
docker-compose logs -f
```

### Rebuilding After Code Changes
```bash
# Rebuild and restart specific service
docker-compose up -d --build backend

# Rebuild all services
docker-compose up -d --build

# Rebuild without cache (clean build)
docker-compose build --no-cache
docker-compose up -d
```

### Database Management
```bash
# Access MongoDB shell
docker-compose exec mongodb mongosh iotmonitor

# Backup MongoDB
docker-compose exec mongodb mongodump --out /data/db/backup

# Access Redis CLI
docker-compose exec redis redis-cli

# View MQTT logs
docker-compose exec mosquitto cat /mosquitto/log/mosquitto.log
```

### Maintenance
```bash
# Remove stopped containers
docker-compose down

# Remove stopped containers AND volumes (DESTRUCTIVE!)
docker-compose down -v

# View disk usage
docker system df

# Clean up unused images
docker image prune -a
```

## Volume Management

Persistent data is stored in Docker volumes:
- `mongodb_data` - Database files
- `redis_data` - Redis persistence
- `mosquitto_data` - MQTT broker data
- `mosquitto_log` - MQTT logs

### Backup Volumes
```bash
# Backup MongoDB volume
docker run --rm -v iotmonitor_mongodb_data:/data -v $(pwd):/backup alpine tar czf /backup/mongodb-backup.tar.gz /data

# Restore MongoDB volume
docker run --rm -v iotmonitor_mongodb_data:/data -v $(pwd):/backup alpine tar xzf /backup/mongodb-backup.tar.gz -C /
```

## Troubleshooting

### Container Won't Start
```bash
# Check logs
docker-compose logs backend

# Check if port is already in use
netstat -tulpn | grep 5001

# Restart with fresh build
docker-compose down
docker-compose up -d --build
```

### MongoDB Connection Issues
```bash
# Verify MongoDB is running
docker-compose ps mongodb

# Check MongoDB health
docker-compose exec mongodb mongosh --eval "db.adminCommand('ping')"

# Verify environment variable
docker-compose exec backend env | grep MONGODB_URI
```

### Backend Build Failures
```bash
# Check if Go is installed in container
docker-compose exec backend go version

# Rebuild with verbose output
docker-compose build --progress=plain backend
```

## Production Considerations

### Security
1. **Change JWT_SECRET** in `.env` to a strong random value
2. **Remove exposed ports** for databases (27017, 6379) from docker-compose.yml
3. **Enable MongoDB authentication**:
   ```yaml
   environment:
     MONGO_INITDB_ROOT_USERNAME: admin
     MONGO_INITDB_ROOT_PASSWORD: strongpassword
   ```
4. **Use TLS** for MQTT (port 8883)
5. **Set up firewall rules** for production server

### Performance
1. **Limit container resources**:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '1.0'
         memory: 512M
   ```
2. **Use production-grade reverse proxy** (Traefik, Caddy)
3. **Enable log rotation**
4. **Monitor container health** with health checks

### Scaling
For high-availability production deployment:
- Use MongoDB replica sets
- Add Redis Sentinel for failover
- Deploy multiple backend instances with load balancer
- Use container orchestration (Kubernetes, Docker Swarm)

## Development vs Production

This docker-compose.yml is configured for **production use**. For development:

```bash
# Override for development with hot-reload
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Create `docker-compose.dev.yml`:
```yaml
version: '3.8'
services:
  backend:
    volumes:
      - ./backend/src:/app/src
    command: npm run dev
  frontend:
    volumes:
      - ./frontend/src:/app/src
    command: npm run dev
```

## Network Architecture

All services run on the `iotmonitor-network` bridge network:
- Services communicate using container names (e.g., `mongodb`, `redis`)
- Internal DNS resolution provided by Docker
- Frontend Nginx proxies API requests to backend
- Socket.IO connections are maintained through WebSocket upgrade

## Agent Deployment

IoT agents built in the backend container can be downloaded via:
```
http://localhost:3000/api/devices/download/{filename}
```

The backend container includes Go runtime for on-demand agent compilation.

## Historical Telemetry APIs

The monitoring API supports archival range queries, time-bucket aggregation, and CSV export.

### Range Query (JSON)

```http
GET /api/monitoring/metrics/{deviceId}?from=2026-02-09T00:00:00.000Z&to=2026-02-10T00:00:00.000Z&bucket=auto&max_points=1200
```

Query params:
- `from`, `to`: ISO datetime range
- `bucket`: `auto`, `raw`, `1m`, `5m`, `15m`, `1h`, `6h`, `1d`
- `max_points`: max points returned after sampling (default 1200)
- `limit`: scan limit for raw mode (default 60000)

Notes:
- `raw` bucket supports up to 48 hours.
- `auto` chooses a bucket based on range and point limit.
- If range is omitted, endpoint returns recent real-time points (latest 50 by default).

### CSV Export

```http
GET /api/monitoring/metrics/{deviceId}/export?from=2026-02-09T00:00:00.000Z&to=2026-02-10T00:00:00.000Z&bucket=1m
```

CSV columns:
- `timestamp`
- `cpu_usage`
- `memory_usage`
- `disk_usage`
- `bandwidth_mbps`
- `sip_rtt_avg_ms`
- `sip_registration_percent`
- `point_count`
