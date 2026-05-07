# Replace Custom Containers Module With Grafana Alert Ingestion

## Goal

Replace the custom VPS/container monitoring agent module with a simpler, safer alert ingestion layer backed by Grafana Alerting.

The portal should act as a 1st-line support awareness dashboard, not as a full observability backend. Grafana remains the source of truth for metrics, dashboards, logs, and alert rules.

## Target Outcome

- Grafana pushes firing/resolved alert events to the portal through a secured webhook.
- The portal stores normalized active/recent alerts.
- Engineers see a concise operational alert view in the portal.
- Alerts can trigger existing portal notifications and optional Telegram messages.
- Alert labels/annotations can link to future runbooks.
- The current custom container/VPS agent, Docker socket collector, and remote-command leftovers are removed.

## Why This Direction

- The project already has Grafana for real monitoring.
- Building metric ingestion, log parsing, retention, alert deduplication, and agent lifecycle in this portal duplicates solved observability tooling.
- The current outbound agent design is better than inbound SSH, but it still adds custom API, agent key handling, Docker socket access, alert state, and maintenance surface.
- A Grafana webhook receiver is lightweight, standard, and aligned with the support-dashboard role.

## Proposed Architecture

```text
Grafana Alerting
  -> Webhook Contact Point
  -> Portal Backend /api/webhooks/grafana-alerts
  -> Normalized alert tables
  -> Portal alert dashboard + notifications + runbook links
```

Grafana should send a shared secret header:

```text
X-Grafana-Webhook-Secret: <long-random-secret>
```

The portal backend validates the secret and normalizes incoming Grafana alert payloads.

## Grafana Label Convention

Use consistent labels in Grafana rules so the portal can classify alerts without custom parsing:

```text
severity=critical|warning|info
team=support
host=vps-01
service=postgres
container=api
environment=prod
runbook=postgres-replication-lag
```

Useful annotations:

```text
summary=Short human-readable problem
description=Longer context
grafana_url=Dashboard or panel URL
action=First suggested action
```

## New Backend Module

Suggested package names:

- API module: `backend/app/api/ops_alerts.py`
- Models: add to `backend/app/models/models.py`
- Schemas: add to `backend/app/schemas/schemas.py`
- Optional service: `backend/app/services/ops_alerts_service.py`

### Tables

`alert_sources`

- `id`
- `name`
- `source_type` = `grafana`
- `secret_hash`
- `enabled`
- `created_at`
- `updated_at`

`ops_alerts`

- `id`
- `source_id`
- `fingerprint`
- `status` = `firing | resolved`
- `severity`
- `title`
- `summary`
- `host`
- `service`
- `container`
- `environment`
- `runbook_key`
- `grafana_url`
- `labels` JSON
- `annotations` JSON
- `starts_at`
- `ends_at`
- `last_received_at`
- `acknowledged_at`
- `acknowledged_by_user_id`

`ops_alert_events`

- `id`
- `source_id`
- `alert_id`
- `event_type` = `firing | resolved | unknown`
- `fingerprint`
- `payload` JSON or redacted JSON
- `received_at`

### API

Public webhook:

- `POST /api/webhooks/grafana-alerts`

Authenticated portal APIs:

- `GET /api/ops-alerts?status=firing`
- `GET /api/ops-alerts/recent`
- `GET /api/ops-alerts/{alert_id}`
- `PATCH /api/ops-alerts/{alert_id}/ack`

Admin APIs if needed:

- `GET /api/alert-sources`
- `POST /api/alert-sources`
- `PATCH /api/alert-sources/{source_id}`
- `POST /api/alert-sources/{source_id}/rotate-secret`

## Webhook Security Requirements

- Require `X-Grafana-Webhook-Secret`.
- Compare secrets using `secrets.compare_digest`.
- Store only a hash of the secret.
- Reject disabled sources.
- Cap request body size.
- Add rate limiting for webhook endpoint.
- Persist raw payload only if useful for debugging; redact sensitive annotation fields if needed.
- Do not expose raw webhook payloads to non-admin users by default.

## Alert Normalization

For each Grafana alert item:

- Derive stable `fingerprint` from Grafana fingerprint if provided, otherwise hash source + labels.
- Map Grafana status to `firing` or `resolved`.
- Extract severity from labels, default to `warning`.
- Extract host/service/container/environment/runbook from labels.
- Extract summary/title/action/Grafana URL from annotations.
- Upsert `ops_alerts` by `(source_id, fingerprint)`.
- Append `ops_alert_events` for audit/debug.
- On transition to `firing`, create portal notification and optionally Telegram message.
- On transition to `resolved`, update `ends_at` and optionally send recovery notification.

## Existing Module Removal Scope

Backend:

- Remove `backend/app/api/containers.py`.
- Remove router include from `backend/app/main.py`.
- Remove scheduler job `check_vps_offline` from `backend/app/main.py`.
- Remove container-related models:
  - `VPSAgent`
  - `ContainerState`
  - `ContainerCommand`
  - `ContainerCommandType`
  - `ContainerCommandStatus`
- Remove container-related schemas:
  - `VPSAgentCreate`
  - `VPSAgentUpdate`
  - `VPSAgentResponse`
  - `VPSAgentRegisterResponse`
  - `AgentReportRequest`
  - `AgentReportResponse`
  - `AgentWithContainersResponse`
  - `ContainerStateInput`
  - `ContainerStateResponse`
  - `ContainerMetaUpdate`
  - `SystemMetrics`
  - `LoginEvent`
  - `PendingUpdate`
  - `SystemSnapshotResponse`
- Add Alembic migration to drop old container tables after data backup decision.

Frontend:

- Remove `frontend/src/pages/ContainersPage.jsx`.
- Remove Containers nav item and icon mapping from `frontend/src/App.jsx`.
- Remove any container-specific API calls/components.
- Add future `OpsAlertsPage` or equivalent after backend is ready.

Agents/docs:

- Remove `agents/telegraf` directory if no longer used elsewhere.
- Remove custom command handler.
- Update README and deployment docs to state Grafana is the observability source.

Tests:

- Remove container API tests if present.
- Add webhook signature/secret tests.
- Add alert upsert/dedup tests.
- Add firing-to-resolved transition tests.
- Add permission tests for alert list/ack APIs.

## Implementation Phases

### Phase 1: Add Grafana Alert Receiver

- Add models/schemas for alert source, normalized alert, alert event.
- Add secured webhook endpoint.
- Add normalization/upsert logic.
- Add tests for secret validation and alert transitions.
- Keep existing containers module temporarily to reduce migration risk.

### Phase 2: Add Portal Alert View

- Add simple alert list page for active/recent alerts.
- Show severity, host/service/container, summary, started time, Grafana link, and optional runbook key.
- Add acknowledge action.
- Wire active-alert count into navigation/header if useful.

### Phase 3: Wire Notifications

- Create portal notifications when critical/warning alerts fire.
- Optionally send Telegram messages using existing Telegram service.
- Deduplicate by alert fingerprint and status transition.

### Phase 4: Remove Custom Containers Module

- Remove backend router, models, schemas, scheduler job, and agent code.
- Remove frontend Containers page/nav.
- Add Alembic migration to drop obsolete tables.
- Update docs.
- Run backend and frontend test/build verification.

## Open Decisions

- Should alert source configuration be database-managed or env-only for the first version?
- Should all engineers be able to acknowledge alerts, or only admins?
- Should resolved alerts remain visible for 24h, 7d, or indefinitely?
- Should raw Grafana payloads be stored, redacted, or skipped?
- Should Telegram notifications be sent for all firing alerts or only `severity=critical`?

## Recommended First Cut

Use env-based webhook secret for speed:

```text
GRAFANA_WEBHOOK_SECRET=<long-random-secret>
```

Then add database-managed alert sources later if multiple Grafana instances or secret rotation become necessary.

First UI should only show active and recent alerts. Avoid charts and metric history because Grafana already owns that.
