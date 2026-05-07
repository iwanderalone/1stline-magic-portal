# AI-Assisted Daily Operations Plan

## Goal

Add AI support to the portal for daily 1st-line operations without turning the system into an autonomous production operator.

AI should help engineers understand, classify, summarize, draft, and find relevant runbooks. Humans remain responsible for decisions and actions.

## Direction

Use AI as an internal operations copilot:

- Summarize alerts, emails, incidents, and shift state.
- Recommend runbooks and first checks.
- Classify operational messages.
- Draft handover notes, escalation notes, and user/vendor replies.
- Answer questions from approved internal runbooks/knowledge.

Avoid direct AI-driven production changes:

- No automatic container restarts.
- No automatic user/account changes.
- No direct command execution.
- No unattended remediation.

## Local WebUI First

The preferred direction is to leverage the existing local WebUI/models if it exposes an API.

Reasons:

- Internal operational data stays inside local infrastructure.
- Lower external dependency for daily operations.
- Better fit for support-dashboard workflows where most outputs are drafts/suggestions.

The portal should not be coupled directly to one model provider. Add a provider abstraction so the backend can support local WebUI first and optionally OpenAI or another provider later.

```text
Portal Backend
  -> AIService
    -> Provider: local_webui
    -> Provider: openai
    -> Provider: disabled/mock
```

## Provider Configuration

Suggested environment variables:

```text
AI_ENABLED=true
AI_PROVIDER=local_webui
AI_BASE_URL=http://localhost:8080/v1
AI_API_KEY=
AI_MODEL=your-local-model
AI_TIMEOUT_SECONDS=60
AI_MAX_INPUT_CHARS=20000
AI_STORE_INTERACTIONS=true
```

If the WebUI exposes an OpenAI-compatible API, use:

```text
POST {AI_BASE_URL}/chat/completions
```

If not, implement a provider adapter for that WebUI's native endpoint.

## Good First Use Cases

### 1. Grafana Alert AI Summary

When Grafana pushes an alert webhook, AI can generate:

- Plain-English summary.
- Likely user/business impact.
- Affected host/service/container.
- First checks for 1st-line engineers.
- Suggested runbook key.
- Escalation recommendation.

Example output:

```json
{
  "summary": "Disk usage is critical on vps-mail-01.",
  "impact": "Mail processing may fail if disk reaches 100%.",
  "suggested_actions": [
    "Check largest directories under /var and Docker volumes.",
    "Check whether logs or attachments are growing unexpectedly.",
    "Escalate to infrastructure if usage cannot be safely reduced."
  ],
  "runbook_keys": ["disk-space-cleanup"],
  "needs_escalation": false,
  "confidence": "medium"
}
```

### 2. Shift Handover Generator

Generate a short handover from:

- Active Grafana alerts.
- Unresolved mail cases.
- Active reminders.
- Recent incidents.
- Important schedule/time-off context.

This is likely one of the highest-value daily features.

### 3. Runbook Q&A and Recommendation

Given an alert, email, or engineer question:

- Retrieve matching runbooks.
- Ask the model to answer only from approved runbook content.
- Return citations or runbook section references.

This should become more useful once the runbooks module exists.

### 4. Mail Reporter Classification

For operational emails:

- Classify category.
- Extract user/system/deadline/request type.
- Suggest priority.
- Detect likely duplicates.
- Draft internal reply or vendor/user response.

### 5. Incident Summary Generator

After resolution:

- Timeline.
- Actions taken.
- Suspected root cause.
- Follow-up tasks.
- Suggested runbook improvements.

### 6. Escalation Quality Check

Before escalation, AI checks whether the case has enough information:

- Affected system/user.
- Timestamp.
- Error message.
- Business impact.
- Reproduction steps.
- Logs/screenshots/reference links.

## Backend Design

Suggested files:

- `backend/app/api/ai_assistant.py`
- `backend/app/services/ai_assistant_service.py`
- `backend/app/services/ai_providers/base.py`
- `backend/app/services/ai_providers/local_webui.py`
- `backend/app/services/ai_providers/openai_provider.py`
- `backend/app/services/knowledge_retrieval.py`

Suggested tables:

`ai_interactions`

- `id`
- `user_id`
- `feature`
- `provider`
- `model`
- `input_ref_type`
- `input_ref_id`
- `prompt_hash`
- `input_redacted`
- `output`
- `status`
- `error`
- `created_at`

`ai_suggestions`

- `id`
- `interaction_id`
- `suggestion_type`
- `status` = `draft | accepted | rejected | dismissed`
- `content`
- `accepted_by_user_id`
- `created_at`
- `updated_at`

## API Shape

Authenticated endpoints:

- `POST /api/ai/alert-summary/{alert_id}`
- `POST /api/ai/shift-handover`
- `POST /api/ai/mail-classify/{email_id}`
- `POST /api/ai/runbook-search`
- `POST /api/ai/incident-summary`

Admin/test endpoints:

- `GET /api/ai/config`
- `POST /api/ai/test-provider`

## Structured Output

Prefer strict JSON outputs for operational workflows.

Example common envelope:

```json
{
  "summary": "string",
  "severity": "low|medium|high|critical",
  "suggested_actions": ["string"],
  "runbook_keys": ["string"],
  "needs_escalation": true,
  "confidence": "low|medium|high",
  "missing_information": ["string"]
}
```

Provider adapters should validate and repair/retry malformed JSON when practical. If the model cannot return valid JSON, return a safe failure rather than showing unreliable output as fact.

## Guardrails

- AI output is advisory only.
- No automatic production actions.
- Do not send secrets, passwords, tokens, private keys, or raw credentials to any model.
- Redact sensitive content before prompt construction.
- Add per-user and per-feature rate limits.
- Add request timeouts.
- Store audit logs for AI usage.
- Track whether suggestions were accepted, rejected, or ignored.
- Show model/provider metadata to admins for debugging.
- Provide fallback behavior when the local model is unavailable.

## Local Model Suitability

Local models are suitable for:

- Summaries.
- Classifications.
- Drafts.
- Runbook matching explanations.
- Shift handovers.
- Basic troubleshooting suggestions.

Use caution for:

- Complex root-cause analysis.
- Strict JSON reliability.
- Long-context multi-incident reasoning.
- High-concurrency workloads.
- Tasks requiring broad external world knowledge.

Optional future approach:

- Local model by default.
- Cloud/provider fallback only for explicitly approved complex tasks.

## Open Questions

- Which local WebUI is used?
- Does it expose an OpenAI-compatible `/v1/chat/completions` API?
- What is the API base URL?
- Does it require an API key?
- Which local model should be the default?
- What languages should responses support: English, Russian, or both?
- Should AI interaction logs store redacted input text or only references/hashes?
- Should all engineers use AI features, or should access be role/permission based?

## Recommended MVP

Start with three features:

1. Grafana alert summary from normalized alert events.
2. Shift handover generator.
3. Runbook recommendation/Q&A once the runbooks module exists.

This gives immediate operational value while keeping the system safe, local-first, and easy to replace or extend later.
