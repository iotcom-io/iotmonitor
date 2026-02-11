# Docker Deployment Guide - IoTMonitor

This guide is aligned with the current `docker-compose.yml`:
- External MongoDB and external MQTT are the default runtime model.
- Local Mongo and local Mosquitto are optional profiles.
- Redis runs locally by default.

## 1) Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- Open ports: `3000`, `5001` (plus `1883/8883` only if using local MQTT profile)

## 2) Configure Environment

Create runtime env file from example:

```bash
cp backend/.env.example backend/.env
```

Update at minimum:

- `JWT_SECRET`
- `MONGODB_URI`
- `MQTT_URL`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`

### External services (default)

Use these style values in `backend/.env`:

```env
MONGODB_URI=mongodb://host.docker.internal:27017/iotmonitor
MQTT_URL=mqtt://monitoring.iotcom.io:1883
MQTT_USERNAME=your_mqtt_username
MQTT_PASSWORD=your_mqtt_password
```

### Local profile values

If you run local Mongo or Mosquitto via compose profiles:

```env
MONGODB_URI=mongodb://mongodb:27017/iotmonitor
MQTT_URL=mqtt://mosquitto:1883
```

## 3) Start Services

### A. Standard (external Mongo + external MQTT)

```bash
docker compose up -d --build
```

### B. Include local Mongo

```bash
docker compose --profile local-db up -d --build
```

### C. Include local MQTT broker

```bash
docker compose --profile local-mqtt up -d --build
```

### D. Include both local Mongo + local MQTT

```bash
docker compose --profile local-db --profile local-mqtt up -d --build
```

## 4) Access URLs

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:5001`
- Backend health: `http://localhost:5001/health`

## 5) Operational Commands

```bash
# service status
docker compose ps

# logs
docker compose logs -f
docker compose logs -f backend

# restart backend
docker compose restart backend

# stop all
docker compose down

# stop + delete volumes (destructive)
docker compose down -v
```

## 6) First-Run Seed

```bash
docker compose exec backend npm run seed
```

## 7) Security Defaults in Compose

Current compose hardening includes:

- Removed obsolete `version` key.
- Optional local infra via profiles (`local-db`, `local-mqtt`).
- Backend/Frontend `no-new-privileges` security option.
- Health checks on `redis` and `backend`.
- `mongodb` and `redis` ports bound to localhost only.

## 8) Production Checklist

1. Use managed MongoDB and secured MQTT broker.
2. Keep strong `JWT_SECRET` and rotate credentials.
3. Restrict inbound firewall to `3000/5001` (and MQTT only where required).
4. Keep `backend/.env` out of source control.
5. Enable TLS termination using reverse proxy (Nginx/Caddy/Traefik).
6. Monitor container logs and resource usage.

## 9) Troubleshooting

### Backend cannot connect to Mongo or MQTT

- Check `backend/.env` values.
- From backend container, test DNS/connectivity to targets.
- Verify broker credentials and ACLs.

### Frontend up but API failing

- Check backend health endpoint:
  - `curl http://localhost:5001/health`
- Check backend logs:
  - `docker compose logs -f backend`

### Local MQTT profile not receiving traffic

- Ensure `MQTT_URL=mqtt://mosquitto:1883` in `backend/.env`.
- Start with profile:
  - `docker compose --profile local-mqtt up -d`

## 10) Notes

- Compose uses `docker compose` syntax (not legacy `docker-compose`).
- If your Mongo runs on host OS, `host.docker.internal` is mapped for backend via `extra_hosts`.
