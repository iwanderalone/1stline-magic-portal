import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { Button, Card, Badge, Overlay, Toast, EmptyState, Input } from '../components/UI';

// ─── Helpers ──────────────────────────────────────────────

function isOnline(agent) {
  if (!agent.last_seen) return false;
  const iso = agent.last_seen.endsWith('Z') ? agent.last_seen : agent.last_seen + 'Z';
  return Date.now() - new Date(iso).getTime() < 75_000;
}

const STATUS_COLORS = {
  running:    '#10b981',
  exited:     '#ef4444',
  dead:       '#ef4444',
  oom_killed: '#ef4444',
  paused:     '#f59e0b',
  restarting: '#3b82f6',
  created:    '#3b82f6',
};
function statusColor(s) { return STATUS_COLORS[(s || '').toLowerCase()] || '#8a96b8'; }

function fmtBytes(bytes, decimals = 1) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(decimals)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(decimals)} GB`;
}

function fmtSince(dt) {
  if (!dt) return 'never';
  const iso = dt.endsWith('Z') ? dt : dt + 'Z';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function fmtUptime(seconds) {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtPorts(ports) {
  if (!ports || ports.length === 0) return null;
  const mapped = ports.filter(p => p.public_port).map(p => `${p.public_port}:${p.private_port}`).slice(0, 4);
  if (mapped.length === 0) return null;
  return mapped.join(', ') + (ports.filter(p => p.public_port).length > 4 ? '…' : '');
}

function barColor(pct) {
  if (pct == null) return '#10b981';
  if (pct >= 90) return '#ef4444';
  if (pct >= 70) return '#f59e0b';
  return '#10b981';
}

// ─── Metric Bar ───────────────────────────────────────────

function MetricBar({ label, used, total, pct: _pct, color }) {
  const { theme: t } = useTheme();
  const pct = _pct != null ? _pct : (total ? Math.min(100, (used / total) * 100) : 0);
  const bc = color || barColor(pct);
  return (
    <div style={{ flex: 1, minWidth: 80 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: t.textMuted, fontWeight: 600, letterSpacing: '0.05em' }}>{label}</span>
        <span style={{ fontSize: 10, color: t.textSecondary }}>
          {total ? `${fmtBytes(used, 0)} / ${fmtBytes(total, 0)}` : `${pct.toFixed(0)}%`}
        </span>
      </div>
      <div style={{ height: 5, background: t.border, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: bc, borderRadius: 3, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

function MiniBar({ pct, color }) {
  const { theme: t } = useTheme();
  return (
    <div style={{ background: t.border, borderRadius: 3, height: 4, overflow: 'hidden', flex: 1 }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct || 0))}%`, background: color, height: '100%', transition: 'width 0.4s ease' }} />
    </div>
  );
}

// ─── System Metrics Panel ─────────────────────────────────

function SystemPanel({ snapshot }) {
  const { theme: t } = useTheme();
  const [showLogins, setShowLogins] = useState(false);
  const [showUpdates, setShowUpdates] = useState(false);
  const [showFailed, setShowFailed] = useState(false);

  if (!snapshot) return null;
  const { system: sys, recent_logins: logins = [], pending_updates: updates = [], failed_services: failed = [] } = snapshot;

  const cpuPct  = sys?.cpu_percent;
  const memUsed = sys?.mem_used_bytes;
  const memTot  = sys?.mem_total_bytes;
  const diskUsed = sys?.disk_used_bytes;
  const diskTot  = sys?.disk_total_bytes;
  const diskPct  = diskTot ? (diskUsed / diskTot) * 100 : null;

  return (
    <div style={{ borderBottom: `1px solid ${t.border}`, background: t.surfaceAlt }}>
      {/* Metrics row */}
      <div style={{ padding: '10px 16px', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {cpuPct != null && (
          <MetricBar label="CPU" pct={cpuPct} />
        )}
        {memTot != null && (
          <MetricBar label="RAM" used={memUsed} total={memTot} />
        )}
        {diskTot != null && (
          <MetricBar label="DISK" pct={diskPct} color={barColor(diskPct)} />
        )}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {sys?.uptime_seconds != null && (
            <div style={{ fontSize: 11, color: t.textMuted }}>
              <span style={{ color: t.textSecondary, fontWeight: 600 }}>Up</span> {fmtUptime(sys.uptime_seconds)}
            </div>
          )}
          {sys?.load_avg_1m != null && (
            <div style={{ fontSize: 11, color: t.textMuted }}>
              <span style={{ color: t.textSecondary, fontWeight: 600 }}>Load</span>{' '}
              {sys.load_avg_1m.toFixed(2)} / {sys.load_avg_5m?.toFixed(2) ?? '—'}
            </div>
          )}
        </div>
      </div>

      {/* Alert badges */}
      {(updates.length > 0 || failed.length > 0 || logins.length > 0) && (
        <div style={{ padding: '6px 16px 10px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {updates.length > 0 && (
            <button onClick={() => { setShowUpdates(v => !v); setShowFailed(false); setShowLogins(false); }}
              style={{ background: 'rgba(217,119,6,0.13)', border: '1px solid rgba(217,119,6,0.3)', borderRadius: 20,
                padding: '3px 10px', fontSize: 11, color: '#d97706', cursor: 'pointer', fontWeight: 600 }}>
              ⬆️ {updates.length} update{updates.length !== 1 ? 's' : ''} available
            </button>
          )}
          {failed.length > 0 && (
            <button onClick={() => { setShowFailed(v => !v); setShowUpdates(false); setShowLogins(false); }}
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 20,
                padding: '3px 10px', fontSize: 11, color: '#ef4444', cursor: 'pointer', fontWeight: 600 }}>
              🔴 {failed.length} service{failed.length !== 1 ? 's' : ''} failed
            </button>
          )}
          {logins.length > 0 && (
            <button onClick={() => { setShowLogins(v => !v); setShowUpdates(false); setShowFailed(false); }}
              style={{ background: t.accentLight, border: `1px solid ${t.border}`, borderRadius: 20,
                padding: '3px 10px', fontSize: 11, color: t.accent, cursor: 'pointer', fontWeight: 600 }}>
              👤 {logins.length} recent login{logins.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

      {/* Expandable: Updates */}
      {showUpdates && updates.length > 0 && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: t.radiusSm,
            maxHeight: 180, overflowY: 'auto' }}>
            {updates.map((u, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '6px 12px',
                borderBottom: i < updates.length - 1 ? `1px solid ${t.borderLight}` : 'none',
                fontSize: 11, fontFamily: 'monospace' }}>
                <span style={{ flex: 1, fontWeight: 600, color: t.text }}>{u.package}</span>
                {u.current_version && <span style={{ color: t.textMuted }}>{u.current_version}</span>}
                {u.new_version && <><span style={{ color: t.textMuted }}>→</span>
                  <span style={{ color: '#10b981' }}>{u.new_version}</span></>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expandable: Failed services */}
      {showFailed && failed.length > 0 && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ background: t.surface, border: `1px solid rgba(239,68,68,0.3)`, borderRadius: t.radiusSm, padding: '8px 12px' }}>
            {failed.map((svc, i) => (
              <div key={i} style={{ fontSize: 12, fontFamily: 'monospace', color: '#ef4444', padding: '2px 0' }}>
                ● {svc}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expandable: Recent logins */}
      {showLogins && logins.length > 0 && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: t.radiusSm }}>
            {logins.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '6px 12px',
                borderBottom: i < logins.length - 1 ? `1px solid ${t.borderLight}` : 'none',
                fontSize: 11, alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: t.text }}>{l.username}</span>
                {l.ip && <span style={{ fontFamily: 'monospace', color: t.textMuted }}>{l.ip}</span>}
                {l.event_type && l.event_type !== 'login' && (
                  <Badge color={l.event_type === 'failed' ? 'red' : 'blue'}>{l.event_type}</Badge>
                )}
                {l.timestamp && <span style={{ color: t.textMuted, marginLeft: 'auto' }}>{l.timestamp}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Container Card ───────────────────────────────────────

function ContainerCard({ container, agentId, onAction, onEdit, onViewLogs, pending }) {
  const { theme: t } = useTheme();
  const label = container.display_name || container.name;
  const sc = statusColor(container.status);
  const memPct = container.mem_limit_bytes
    ? Math.min(100, (container.mem_usage_bytes / container.mem_limit_bytes) * 100) : null;
  const ports = fmtPorts(container.ports);

  return (
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: t.radius,
      display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: t.shadow }}>

      {/* Status strip */}
      <div style={{ height: 3, background: sc }} />

      {/* Header */}
      <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, wordBreak: 'break-word', lineHeight: 1.3 }}>{label}</div>
          <div style={{ fontSize: 10, color: t.textMuted, marginTop: 2, fontFamily: 'monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {container.image}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={() => onViewLogs(container)} title="View logs"
            style={{ background: 'none', border: `1px solid ${t.border}`, cursor: 'pointer',
              fontSize: 10, color: t.textMuted, padding: '2px 6px', borderRadius: 8 }}>
            📋
          </button>
          <button onClick={() => onEdit(container)} title="Edit metadata"
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, color: t.textMuted, padding: '2px 4px', borderRadius: 4 }}>
            ✏️
          </button>
        </div>
      </div>

      {/* Meta */}
      <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: sc, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {container.status}
          </span>
          {ports && <span style={{ fontSize: 10, color: t.textMuted }}>🔌 {ports}</span>}
        </div>
        {container.hosted_on && (
          <div style={{ fontSize: 10, color: t.textSecondary }}>📍 {container.hosted_on}</div>
        )}
        {container.description && (
          <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.4,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {container.description}
          </div>
        )}

        {/* CPU bar */}
        {container.cpu_percent != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: 9, color: t.textMuted, width: 22, flexShrink: 0 }}>CPU</span>
            <MiniBar pct={container.cpu_percent} color={barColor(container.cpu_percent)} />
            <span style={{ fontSize: 9, color: t.textSecondary, width: 32, textAlign: 'right', flexShrink: 0 }}>
              {container.cpu_percent.toFixed(1)}%
            </span>
          </div>
        )}

        {/* Memory bar */}
        {container.mem_usage_bytes != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: t.textMuted, width: 22, flexShrink: 0 }}>MEM</span>
            <MiniBar pct={memPct} color={barColor(memPct)} />
            <span style={{ fontSize: 9, color: t.textSecondary, width: 32, textAlign: 'right', flexShrink: 0 }}>
              {fmtBytes(container.mem_usage_bytes, 0)}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ padding: '7px 12px', borderTop: `1px solid ${t.border}`, display: 'flex', gap: 5 }}>
        {[['▶', 'start', '#10b981'], ['■', 'stop', '#ef4444'], ['↺', 'restart', '#f59e0b']].map(([icon, cmd, col]) => (
          <button key={cmd}
            disabled={pending || container.is_absent}
            onClick={() => onAction(agentId, container.docker_id, cmd)}
            title={cmd}
            style={{ flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 600,
              background: t.surfaceAlt, border: `1px solid ${t.border}`,
              borderRadius: t.radiusSm, cursor: pending ? 'not-allowed' : 'pointer',
              color: pending ? t.textMuted : t.textSecondary, transition: 'all 0.15s' }}
            onMouseEnter={e => { if (!pending) { e.currentTarget.style.borderColor = col; e.currentTarget.style.color = col; } }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.textSecondary; }}>
            {icon} {cmd}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Edit Agent Overlay ───────────────────────────────────

function EditAgentOverlay({ agent, onClose, onSave }) {
  const { theme: t } = useTheme();
  const [name, setName] = useState(agent.name || '');
  const [description, setDescription] = useState(agent.description || '');
  const [templateId, setTemplateId] = useState(agent.alert_template_id || '');
  const [threshold, setThreshold] = useState(String(agent.disk_alert_threshold ?? 85));
  const [templates, setTemplates] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/admin/telegram-templates').then(setTemplates).catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave(agent.id, {
      name: name.trim(),
      description: description.trim() || null,
      alert_template_id: templateId || null,
      disk_alert_threshold: parseInt(threshold, 10),
    });
    setSaving(false);
  };

  const selectStyle = {
    width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6,
    border: `1px solid ${t.border}`, background: t.surfaceAlt, color: t.text,
    boxSizing: 'border-box', appearance: 'auto',
  };

  return (
    <Overlay title={`Edit Agent — ${agent.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input label="Agent Name *" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: t.text }}>Alert Telegram Template</label>
          <select value={templateId} onChange={e => setTemplateId(e.target.value)} style={selectStyle}>
            <option value="">— No alerts —</option>
            {templates.map(tpl => (
              <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: t.textMuted }}>
            Telegram alerts will be sent via this template's chat when thresholds are crossed.
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: t.text }}>
            Disk Alert Threshold (%)
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="range" min={50} max={99} value={threshold}
              onChange={e => setThreshold(e.target.value)}
              style={{ flex: 1, accentColor: threshold >= 90 ? '#ef4444' : threshold >= 75 ? '#f59e0b' : t.accent }} />
            <span style={{ fontSize: 13, fontWeight: 700, minWidth: 36, textAlign: 'right',
              color: threshold >= 90 ? '#ef4444' : threshold >= 75 ? '#f59e0b' : '#10b981' }}>
              {threshold}%
            </span>
          </div>
          <span style={{ fontSize: 11, color: t.textMuted }}>
            Alert fires when disk usage exceeds this percentage (with 1h cooldown).
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}

// ─── Agent Section ────────────────────────────────────────

function AgentSection({ agent, onAction, onEdit, onViewLogs, pendingActions, onDeleteAgent, onEditAgent }) {
  const { theme: t } = useTheme();
  const online = isOnline(agent);
  const active = (agent.containers || []).filter(c => !c.is_absent);
  const [collapsed, setCollapsed] = useState(false);
  const [editingAgent, setEditingAgent] = useState(false);

  const onlineColor = online ? '#10b981' : '#ef4444';

  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: t.radius, overflow: 'hidden', boxShadow: t.shadow }}>

      {/* Agent header */}
      <div style={{ background: t.surface, borderLeft: `4px solid ${onlineColor}`, padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setCollapsed(v => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
            color: t.textMuted, padding: '2px 4px', borderRadius: 4, flexShrink: 0 }}>
          {collapsed ? '▶' : '▼'}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>🖥️ {agent.name}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
              padding: '2px 8px', borderRadius: 20, fontWeight: 600,
              background: online ? 'rgba(16,185,129,0.13)' : 'rgba(239,68,68,0.12)',
              color: onlineColor }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: onlineColor, flexShrink: 0 }} />
              {online ? 'Online' : 'Offline'}
            </span>
            {active.length > 0 && (
              <span style={{ fontSize: 11, color: t.textMuted }}>
                {active.length} container{active.length !== 1 ? 's' : ''}
              </span>
            )}
            {agent.alert_template_id && (
              <span title="Telegram alerts configured" style={{ fontSize: 12 }}>🔔</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 3 }}>
            {[agent.hostname, agent.ip_address].filter(Boolean).join(' · ')}
            {agent.last_seen && <span> · last seen {fmtSince(agent.last_seen)}</span>}
            {agent.description && <span style={{ color: t.textSecondary }}> · {agent.description}</span>}
          </div>
        </div>

        <button onClick={() => setEditingAgent(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
            color: t.textMuted, padding: '4px 6px', borderRadius: 4 }}
          title="Edit agent settings">⚙️</button>
        <button onClick={() => { if (confirm(`Delete agent "${agent.name}"? This removes all container history.`)) onDeleteAgent(agent.id); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
            color: t.textMuted, padding: '4px 6px', borderRadius: 4 }}
          title="Delete agent">🗑</button>
      </div>

      {editingAgent && (
        <EditAgentOverlay agent={agent} onClose={() => setEditingAgent(false)}
          onSave={async (id, data) => { await onEditAgent(id, data); setEditingAgent(false); }} />
      )}

      {!collapsed && (
        <>
          {/* System metrics */}
          <SystemPanel snapshot={agent.snapshot} />

          {/* Container grid */}
          <div style={{ background: t.bg, padding: active.length > 0 ? 14 : 0 }}>
            {active.length === 0 ? (
              <div style={{ padding: '18px', textAlign: 'center', color: t.textMuted, fontSize: 12 }}>
                {online ? 'No containers reported yet' : 'Agent offline — last known state shown above'}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                {active.map(c => (
                  <ContainerCard key={c.docker_id} container={c} agentId={agent.id}
                    onAction={onAction} onEdit={onEdit} onViewLogs={onViewLogs}
                    pending={!!pendingActions[`${agent.id}:${c.docker_id}`]} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Edit Container Overlay ───────────────────────────────

function EditContainerOverlay({ agentId, container, onClose, onSave }) {
  const { theme: t } = useTheme();
  const [displayName, setDisplayName] = useState(container.display_name || '');
  const [hostedOn, setHostedOn] = useState(container.hosted_on || '');
  const [description, setDescription] = useState(container.description || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(agentId, container.docker_id, {
      display_name: displayName.trim() || null,
      hosted_on: hostedOn.trim() || null,
      description: description.trim() || null,
    });
    setSaving(false);
  };

  return (
    <Overlay title={`Edit — ${container.display_name || container.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input label="Display Name (optional)" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder={container.name} />
        <Input label="Hosted On (optional)" value={hostedOn} onChange={e => setHostedOn(e.target.value)} placeholder="e.g. Hetzner CX21, Frankfurt" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: t.text }}>Description (optional)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            placeholder="What does this container do?" rows={3}
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6,
              border: `1px solid ${t.border}`, background: t.surfaceAlt, color: t.text,
              resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Overlay>
  );
}

// ─── Logs Overlay ─────────────────────────────────────────

function LogsOverlay({ container, onClose }) {
  const { theme: t } = useTheme();
  const logs = container.last_logs;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText((logs || []).join('\n')); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  return (
    <Overlay title={`Logs — ${container.display_name || container.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, color: t.textMuted }}>
            Captured: {container.reported_at
              ? new Date((container.reported_at.endsWith('Z') ? container.reported_at : container.reported_at + 'Z')).toLocaleString()
              : '—'}
          </div>
          {logs && logs.length > 0 && <Button size="sm" variant="ghost" onClick={handleCopy}>{copied ? '✓ Copied' : '📋 Copy'}</Button>}
        </div>
        {!logs || logs.length === 0 ? (
          <EmptyState icon="📋" title="No logs captured" subtitle="The agent will include logs on the next report cycle" />
        ) : (
          <div style={{ background: '#0d1117', borderRadius: t.radiusSm, padding: 12, maxHeight: 400,
            overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5, color: '#e6edf3',
            border: `1px solid ${t.border}` }}>
            {logs.map((line, i) => <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line || '\u00A0'}</div>)}
          </div>
        )}
      </div>
    </Overlay>
  );
}

// ─── Register Agent Overlay ───────────────────────────────

function RegisterAgentOverlay({ onClose, onRegister }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const handleRegister = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onRegister(name.trim(), description.trim() || null);
    setSaving(false);
  };

  return (
    <Overlay title="Register VPS Agent" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input label="Agent Name *" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. vps-berlin-01" autoFocus />
        <Input label="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Primary production server" />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleRegister} disabled={saving || !name.trim()}>
            {saving ? 'Registering…' : 'Register Agent'}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}

// ─── New Key Overlay ──────────────────────────────────────

function NewKeyOverlay({ agentId, apiKey, onClose }) {
  const { theme: t } = useTheme();
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(apiKey); setCopied(true); setTimeout(() => setCopied(false), 3000); } catch {}
  };

  const envBlock = `PORTAL_URL=https://your-portal.example.com\nAGENT_ID=${agentId}\nAGENT_KEY=${apiKey}`;

  return (
    <Overlay title="Agent API Key — Save This Now" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: t.warningLight, border: `1px solid ${t.warning}`, borderRadius: t.radiusSm,
          padding: '10px 14px', fontSize: 13, color: t.warning }}>
          ⚠️ <strong>This key is shown only once.</strong> It cannot be recovered — copy it and put it in your VPS env file now.
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 12, background: t.surfaceAlt, border: `1px solid ${t.border}`,
          borderRadius: t.radiusSm, padding: '12px 14px', wordBreak: 'break-all', userSelect: 'all', lineHeight: 1.6 }}>
          {apiKey}
        </div>
        <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6 }}>
          On your VPS, save to <code>/etc/1line-agent/env</code>:
          <pre style={{ marginTop: 6, background: t.surfaceAlt, border: `1px solid ${t.border}`,
            borderRadius: t.radiusSm, padding: '8px 12px', fontSize: 11, fontFamily: 'monospace',
            overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {envBlock}
          </pre>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={handleCopy}>{copied ? '✓ Copied!' : '📋 Copy Key'}</Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Overlay>
  );
}

// ─── Main Page ────────────────────────────────────────────

export default function ContainersPage() {
  const { theme: t } = useTheme();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [newAgent, setNewAgent] = useState(null);        // { id, api_key }
  const [editingContainer, setEditingContainer] = useState(null);
  const [viewingLogs, setViewingLogs] = useState(null);
  const [pendingActions, setPendingActions] = useState({});

  const showToast = (message, type) => { setToast({ message, type }); setTimeout(() => setToast(null), 3500); };

  const fetchAgents = useCallback(async () => {
    try {
      const data = await api('/containers/');
      setAgents(data || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    const i = setInterval(fetchAgents, 15000);
    return () => clearInterval(i);
  }, [fetchAgents]);

  const handleAction = async (agentId, dockerId, command) => {
    const key = `${agentId}:${dockerId}`;
    setPendingActions(p => ({ ...p, [key]: true }));
    try {
      await api(`/containers/agents/${agentId}/containers/${dockerId}/action`, { method: 'POST', body: JSON.stringify({ command }) });
      showToast(`${command} queued — agent will execute on next check-in`, 'success');
      setTimeout(fetchAgents, 2000);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setPendingActions(p => { const n = { ...p }; delete n[key]; return n; });
    }
  };

  const handleMetaSave = async (agentId, dockerId, meta) => {
    try {
      const updated = await api(`/containers/agents/${agentId}/containers/${dockerId}`, { method: 'PATCH', body: JSON.stringify(meta) });
      setAgents(prev => prev.map(a => a.id !== agentId ? a : {
        ...a, containers: a.containers.map(c => c.docker_id !== dockerId ? c : { ...c, ...updated }),
      }));
      setEditingContainer(null);
      showToast('Saved', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleRegister = async (name, description) => {
    try {
      const data = await api('/containers/agents', { method: 'POST', body: JSON.stringify({ name, description }) });
      setNewAgent({ id: data.id, api_key: data.api_key });
      setShowRegister(false);
      fetchAgents();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleDeleteAgent = async (agentId) => {
    try {
      await api(`/containers/agents/${agentId}`, { method: 'DELETE' });
      showToast('Agent deleted', 'info');
      fetchAgents();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleAgentSave = async (agentId, data) => {
    try {
      const updated = await api(`/containers/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify(data) });
      setAgents(prev => prev.map(a => a.id !== agentId ? a : { ...a, ...updated }));
      showToast('Agent settings saved', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const onlineCount = agents.filter(isOnline).length;
  const totalContainers = agents.reduce((s, a) => s + (a.containers || []).filter(c => !c.is_absent).length, 0);
  const totalUpdates = agents.reduce((s, a) => s + (a.snapshot?.pending_updates?.length || 0), 0);
  const totalFailed = agents.reduce((s, a) => s + (a.snapshot?.failed_services?.length || 0), 0);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Infrastructure Dashboard</h2>
          {!loading && agents.length > 0 && (
            <div style={{ fontSize: 12, color: t.textMuted, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span>{agents.length} agent{agents.length !== 1 ? 's' : ''} ·{' '}
                <span style={{ color: '#10b981' }}>{onlineCount} online</span>
                {onlineCount < agents.length && <span style={{ color: '#ef4444' }}> · {agents.length - onlineCount} offline</span>}
              </span>
              <span>{totalContainers} container{totalContainers !== 1 ? 's' : ''}</span>
              {totalUpdates > 0 && <span style={{ color: '#d97706' }}>⬆️ {totalUpdates} updates pending</span>}
              {totalFailed > 0 && <span style={{ color: '#ef4444' }}>🔴 {totalFailed} services failed</span>}
            </div>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowRegister(true)}>+ Register Agent</Button>
      </div>

      {/* Body */}
      {loading && <div style={{ padding: 40, textAlign: 'center', color: t.textMuted }}>Loading…</div>}
      {!loading && error && <Card style={{ padding: 20, color: '#ef4444', textAlign: 'center' }}>{error}</Card>}
      {!loading && !error && agents.length === 0 && (
        <EmptyState icon="🖥️" title="No agents registered"
          subtitle="Register your first VPS agent to start monitoring containers and system health" />
      )}
      {!loading && !error && agents.map(agent => (
        <AgentSection key={agent.id} agent={agent}
          onAction={handleAction}
          onEdit={c => setEditingContainer({ agentId: agent.id, container: c })}
          onViewLogs={c => setViewingLogs(c)}
          onDeleteAgent={handleDeleteAgent}
          onEditAgent={handleAgentSave}
          pendingActions={pendingActions} />
      ))}

      {showRegister && <RegisterAgentOverlay onClose={() => setShowRegister(false)} onRegister={handleRegister} />}
      {newAgent && <NewKeyOverlay agentId={newAgent.id} apiKey={newAgent.api_key} onClose={() => setNewAgent(null)} />}
      {editingContainer && (
        <EditContainerOverlay agentId={editingContainer.agentId} container={editingContainer.container}
          onClose={() => setEditingContainer(null)} onSave={handleMetaSave} />
      )}
      {viewingLogs && <LogsOverlay container={viewingLogs} onClose={() => setViewingLogs(null)} />}
    </div>
  );
}
