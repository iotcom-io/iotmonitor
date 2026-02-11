# IoTMonitor

IoTMonitor is a full-stack monitoring platform for:
- Device and server telemetry (CPU, memory, disk, bandwidth, network, Docker, SIP/PBX)
- Website/API uptime and response validation
- SSL certificate health and expiry tracking
- License/subscription renewal monitoring
- Real-time alerts, incidents, notification routing, and role-based operations

This README describes end-to-end flow, system architecture, operations, and UI usage.

## 1. Core Capabilities

### Device Monitoring
- Agent-based telemetry over MQTT.
- Module-driven monitoring per device (system, network, docker, asterisk/pbx, terminal).
- Real-time and historical charts.
- Rule-based threshold checks with assignees and notification policies.

### Web/API Monitoring
- Single monitor can include both HTTP/API check and SSL check.
- HTTP method support with method-specific request payload/headers.
- Expected status code and response-content validation.
- Uptime percentage, outage durations, and incident tracking.

### SSL Monitoring
- SSL checks attached to web monitors (single listing model).
- Expiry-state transitions (`ok`, `warning`, `critical`, `expired`).
- Weekly SSL summary and reminder cadence in monitoring service.

### License/Subscription Monitoring
- Renewal/expiry state tracking (`ok`, `warning`, `critical`, `expired`, `paused`).
- Seat, owner, amount, currency, and billing-cycle metadata.
- Renewal amount insight for upcoming windows (30d/90d).

### Alerts and Incidents
- Active alert tracking, reminder throttling, and recovery notifications.
- Incident lifecycle: open -> updates -> resolve.
- Unified incident list with filters and historical search.

### Notification Routing
- Multiple channel types in UI: Slack, Email, Webhook, SMS placeholder.
- One or more default channels are supported.
- Per-monitor/per-license channel assignment by channel IDs.
- Fallback behavior: if no monitor-specific channels are selected, default channel(s) are used.

### Access Control
- JWT authentication.
- Role and permission checks across backend routes and frontend screens.
- Assignment-aware access for devices, synthetic monitors, incidents, alerts, and licenses.

### Reporting and Export
- CSV export available for:
  - Active alerts
  - Incidents
  - Web monitors
  - Licenses/subscriptions
  - Device telemetry history (from device detail)

### UI/UX
- Collapsible sidebar.
- Mobile sidebar drawer behavior.
- Persistent light/dark theme toggle.

## 2. Architecture and Data Flow

## High-Level Components
- `frontend/`: React + Vite + Tailwind UI.
- `backend/`: Express + TypeScript + Socket.IO + MQTT consumers.
- MongoDB: primary data store.
- Redis: caching/service support.
- MQTT broker: agent telemetry command channel.
- `agent/`: Go-based telemetry agent compiled per target.

## Runtime Flow
1. Agent publishes telemetry to MQTT topics.
2. Backend MQTT service ingests and stores telemetry.
3. Monitoring services evaluate rules and state transitions.
4. Alert tracking updates and incident records are created/updated/resolved.
5. Notification service resolves destination channels and sends messages.
6. Frontend receives API + socket updates for live views.

## Monitoring Services
- Offline detection
- Threshold/service monitoring
- Notification throttling
- Scheduled summaries
- Synthetic runner
- License monitoring

## 3. Notification Model

Notification channels are managed in **Notifications** UI.

Each channel has:
- `type` (`slack`, `email`, `webhook`, `sms`)
- `enabled`
- `is_default`
- `alert_types`
- `severity_levels`
- Type-specific config (e.g., webhook URL, email list)

### Routing precedence
1. If monitor/license has `notification_channel_ids`, send to those enabled channels.
2. Else send to enabled default channel(s).
3. Else fallback to legacy channel settings.

This allows different destination sets by monitor class (device rules vs web monitors vs licenses).

## 4. Alert and Incident Lifecycle

## Alert lifecycle
- Trigger: check fails / threshold breached / offline event.
- Tracking record updates notification counters and schedule.
- Reminder cadence follows severity/state policy.
- Resolve: when condition returns normal or monitor paused.

## Incident lifecycle
- Opened on first failure condition.
- Updated while condition remains active.
- Resolved manually or automatically on recovery.
- Historical incidents remain queryable and exportable.

## 5. UI Flows

## Device Flow
1. Create device and choose device type/modules.
2. Build and download agent binary.
3. Deploy agent on target host.
4. View real-time metrics, checks, incidents, and historical trends.
5. Configure monitor rules and assignees from device detail.

## Web Monitor Flow
1. Go to **Web Monitoring** -> **New Monitor**.
2. Select website/API target.
3. Configure HTTP/API validation.
4. Optionally enable SSL monitoring in same monitor.
5. Assign notification channels (or leave empty for default fallback).
6. View uptime/outage and incidents.

## License Flow
1. Go to **Licenses** -> **New Entry**.
2. Fill renewal, amount, owner, and thresholds.
3. Assign notification channels (or default fallback).
4. Track state transitions and upcoming renewal spend.

## Incidents and Alerts
- **Alerts** page: active alert stream and export.
- **Incidents** page: active + historical lists with filters and export.

## 6. Setup and Deployment

## Prerequisites
- Docker + Docker Compose
- Node 18+ for local frontend
- Node 20+ for backend build/runtime
- MongoDB, Redis, MQTT (via compose or external)

## Environment
Use `backend/.env.example` as baseline.

Important variables:
- `MONGODB_URI`
- `REDIS_URL`
- `MQTT_URL`
- `JWT_SECRET`
- Notification credentials/webhooks as needed

## Docker deployment
From repo root:
```bash
cd d:\Projects\Iotcom\iotmonitor
docker compose up -d --build
```

Compose defaults are external Mongo + external MQTT.

Optional local service profiles:
```bash
# local Mongo only
docker compose --profile local-db up -d --build

# local MQTT only
docker compose --profile local-mqtt up -d --build

# both local Mongo and local MQTT
docker compose --profile local-db --profile local-mqtt up -d --build
```

Set matching values in `backend/.env`:
- Local Mongo profile: `MONGODB_URI=mongodb://mongodb:27017/iotmonitor`
- Local MQTT profile: `MQTT_URL=mqtt://mosquitto:1883`

## Local development
### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Build verification
```bash
cd backend
npm run build

cd ../frontend
npm run lint
```

## 7. Data Model Overview

Key backend models:
- `Device`
- `Telemetry`
- `MonitoringCheck`
- `AlertTracking`
- `Incident`
- `SyntheticCheck`
- `LicenseAsset`
- `NotificationChannel`
- `SystemSettings`
- `User`

## 8. Scalability and Data Retention Guidance

As telemetry grows, enforce retention controls early:
- Keep high-resolution telemetry for short windows.
- Aggregate hourly/daily rollups for long-term charts.
- Archive/TTL historical raw telemetry and resolved alerts beyond policy.
- Index heavy query paths (`device_id`, `timestamp`, `status`, `severity`, `target_type`).
- Run periodic archival jobs during low-load windows.

Suggested policy baseline:
- Raw telemetry: 30-90 days
- Aggregated telemetry: 12-18 months
- Incidents/audit logs: 12+ months

## 9. Security Checklist

- Rotate `JWT_SECRET` and all webhook/API credentials.
- Restrict MongoDB/Redis/MQTT network exposure.
- Enforce TLS at reverse proxy and broker where possible.
- Use least-privilege roles and assignment scoping.
- Audit remote-terminal permissions carefully.

## 10. Troubleshooting

## False alerts around startup/restarts
- Verify offline thresholds and heartbeat intervals.
- Confirm monitor pause/resume logic and notification throttling settings.
- Ensure monitor assignment and module selection match actual agent payload.

## No notifications
- Check channel `enabled` state.
- Check default channel exists.
- Verify monitor-specific `notification_channel_ids`.
- Run channel test from Notifications page.

## Web monitor status mismatch
- Validate expected status code list.
- Validate response match rule and regex/text.
- Confirm method-specific payload/headers.

## 11. Current Completion and Next Scope

Implemented platform scope now includes:
- Device + web + SSL + license monitoring
- Channel routing/default fallback
- Role/assignment-aware access controls
- CSV exports and dashboard insights
- Mobile navigation + theme toggle

Planned next expansion:
- Subscription billing automation integrations
- Advanced archival workers and retention UI controls
- Additional report templates and scheduled exports
- SMS provider integration

## 12. Repository Paths

- Frontend app: `frontend/src`
- Backend API/services: `backend/src`
- Agent source: `agent/`
- Compose/deployment: `docker-compose.yml`, `DOCKER_DEPLOYMENT.md`

