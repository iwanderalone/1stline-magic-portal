import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { useLang } from '../components/LangContext';
import { Button, Card, Badge, Input, Overlay, Toast } from '../components/UI';

// Fallback for old logs that pre-date the rule_id column
const CATEGORY_COLORS = {
  adobe: 'red', onboarding: 'blue', offboarding: 'blue',
  onboarding_offboarding: 'blue', yandex_support: 'yellow',
  general: 'gray', filtered: 'gray',
};
const CATEGORY_LABELS = {
  adobe: '🔴 Adobe', onboarding: '🔵 Onboarding', offboarding: '🔵 Offboarding',
  onboarding_offboarding: '🔵 On+Offboarding (legacy)', yandex_support: '🟡 Yandex',
  general: '📩 General', filtered: '⛔ Filtered',
};

const EMAIL_STATUS_CONFIG = {
  unchecked: { label: 'Unchecked', color: 'yellow' },
  solved:    { label: '✓ Solved',  color: 'green'  },
  on_pause:  { label: '⏸ Paused',  color: 'blue'   },
  blocked:   { label: '🚫 Blocked', color: 'red'    },
};

const MATCH_TYPE_LABELS = {
  keyword: 'Keyword (subject + body)',
  subject_keyword: 'Subject keyword',
  sender: 'Sender address',
  sender_domain: 'Sender domain',
};

function toUtc(dt) {
  if (!dt) return null;
  const s = dt.endsWith('Z') || dt.includes('+') ? dt : dt + 'Z';
  return new Date(s);
}
function fmtTime(dt) {
  const d = toUtc(dt);
  if (!d) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtSince(dt) {
  if (!dt) return 'Never';
  const diff = Math.floor((Date.now() - toUtc(dt)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Hex color pill badge used for rule labels
function RuleBadge({ rule }) {
  if (!rule) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: rule.color + '22',
      color: rule.color,
      border: `1px solid ${rule.color}44`,
      borderRadius: '999px',
      padding: '2px 10px',
      fontSize: '12px',
      fontWeight: 600,
      whiteSpace: 'nowrap',
      letterSpacing: '0.01em',
    }}>
      {rule.label}
    </span>
  );
}

const PAGE_SIZE = 10;

// ─── Mailbox Modal ────────────────────────────────────────────────────

// Parse combined "chat_id:thread_id" into parts
function parseTelegramTarget(target) {
  if (!target) return { chatId: '', threadId: '' };
  const idx = target.indexOf(':');
  if (idx < 0) return { chatId: target.trim(), threadId: '' };
  return { chatId: target.slice(0, idx).trim(), threadId: target.slice(idx + 1).trim() };
}
function buildTelegramTarget(chatId, threadId) {
  const c = (chatId || '').trim();
  const t = (threadId || '').trim();
  if (!c) return '';
  return t ? `${c}:${t}` : c;
}

// Reusable Telegram target fields with optional template picker
function TelegramTargetFields({ chatId, threadId, onChatId, onThreadId, templates, theme: t }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {templates && templates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            From template
          </label>
          <select
            style={{ padding: '8px 10px', borderRadius: t.radiusSm, border: `1px solid ${t.border}`, fontSize: '13px', background: t.surfaceAlt, color: t.text, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }}
            value=""
            onChange={e => {
              const tpl = templates.find(tp => String(tp.id) === e.target.value);
              if (tpl) { onChatId(tpl.chat_id); onThreadId(tpl.topic_id ? String(tpl.topic_id) : ''); }
            }}
          >
            <option value="">— pick a template to fill fields —</option>
            {templates.map(tp => (
              <option key={tp.id} value={tp.id}>{tp.name}{tp.topic_id ? ` (topic ${tp.topic_id})` : ''}</option>
            ))}
          </select>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'flex-end' }}>
        <Input label="Chat / Channel ID" value={chatId} onChange={e => onChatId(e.target.value)} placeholder="-1001234567890" />
        <Input label="Thread / Topic ID" value={threadId} onChange={e => onThreadId(e.target.value)} placeholder="optional" style={{ width: '110px' }} />
      </div>
    </div>
  );
}

function MailboxModal({ mailbox, onClose, onSave }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const isEdit = !!mailbox?.id;
  const parsed = parseTelegramTarget(mailbox?.telegram_target);
  const [form, setForm] = useState({
    email: mailbox?.email || '', password: '',
    subject_filter: mailbox?.subject_filter || 'NONE',
    enabled: mailbox?.enabled ?? true,
    monitor_since: mailbox?.monitor_since || '',
  });
  const [tgChatId, setTgChatId] = useState(parsed.chatId);
  const [tgThreadId, setTgThreadId] = useState(parsed.threadId);
  const [templates, setTemplates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    api('/admin/telegram-templates').then(setTemplates).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault(); setSaving(true); setErr('');
    const payload = { ...form, telegram_target: buildTelegramTarget(tgChatId, tgThreadId) };
    if (!payload.password && isEdit) delete payload.password;
    if (!payload.monitor_since) payload.monitor_since = null;
    try {
      const result = isEdit
        ? await api(`/mail-reporter/mailboxes/${mailbox.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api('/mail-reporter/mailboxes', { method: 'POST', body: JSON.stringify(payload) });
      onSave(result);
    } catch (e) { setErr(e.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <Overlay onClose={onClose} title={isEdit ? tr('editMailbox') : tr('addMailbox')}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Input label={tr('emailAddress')} type="email" value={form.email} onChange={set('email')} required disabled={isEdit} />
        <Input label={isEdit ? 'New password (blank = keep current)' : tr('appPassword')} type="password" value={form.password} onChange={set('password')} required={!isEdit} />
        <Input label={tr('subjectFilter')} value={form.subject_filter} onChange={set('subject_filter')} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Telegram target (default for this mailbox)
          </label>
          <TelegramTargetFields chatId={tgChatId} threadId={tgThreadId} onChatId={setTgChatId} onThreadId={setTgThreadId} templates={templates} theme={t} />
        </div>
        <Input label={tr('monitorSince')} type="date" value={form.monitor_since} onChange={set('monitor_since')} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
          <span>{tr('enabled')}</span>
        </label>
        {err && <div style={{ color: '#ef4444', fontSize: '13px' }}>{err}</div>}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={onClose}>{tr('cancel')}</Button>
          <Button type="submit" disabled={saving}>{saving ? '…' : (isEdit ? 'Save' : tr('add'))}</Button>
        </div>
      </form>
    </Overlay>
  );
}

// ─── Comment History Modal ────────────────────────────────────────────

function CommentHistoryModal({ email, onClose }) {
  const { theme: t } = useTheme();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api(`/mail-reporter/emails/${email.id}/comments`)
      .then(setComments).catch(() => {}).finally(() => setLoading(false));
  }, [email.id]);

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    try {
      const c = await api(`/mail-reporter/emails/${email.id}/comments`, {
        method: 'POST', body: JSON.stringify({ text: text.trim() }),
      });
      setComments(prev => [...prev, c]);
      setText('');
    } catch (err) { /* ignore */ }
    finally { setSaving(false); }
  }

  const taStyle = {
    width: '100%', padding: '9px 12px', borderRadius: t.radiusSm,
    border: `1px solid ${t.border}`, fontSize: '13px', resize: 'vertical',
    fontFamily: 'inherit', boxSizing: 'border-box', background: t.surfaceAlt,
    color: t.text, outline: 'none', lineHeight: 1.5,
  };

  return (
    <Overlay onClose={onClose} title="Comment history">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ fontSize: '12px', color: t.textMuted, wordBreak: 'break-word', borderLeft: `3px solid ${t.border}`, paddingLeft: '10px' }}>
          {email.subject || '(no subject)'}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px', color: t.textMuted, fontSize: '13px' }}>Loading…</div>
        ) : comments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: t.textMuted, fontSize: '13px' }}>No comments yet.</div>
        ) : (
          <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {comments.map(c => (
              <div key={c.id} style={{
                background: t.surfaceAlt, borderRadius: t.radiusSm,
                padding: '10px 12px', border: `1px solid ${t.border}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', gap: '8px' }}>
                  <span style={{ fontWeight: 700, fontSize: '12px', color: t.accent }}>{c.username}</span>
                  <span style={{ fontSize: '11px', color: t.textMuted, whiteSpace: 'nowrap' }}>{fmtTime(c.created_at)}</span>
                </div>
                <div style={{ fontSize: '13px', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.text}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: '12px' }}>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
              placeholder="Add a comment…" style={taStyle} required />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="ghost" type="button" onClick={onClose}>Close</Button>
              <Button type="submit" disabled={saving || !text.trim()}>{saving ? '…' : 'Add comment'}</Button>
            </div>
          </form>
        </div>
      </div>
    </Overlay>
  );
}

// ─── Rule Modal ───────────────────────────────────────────────────────

function RuleModal({ rule, onClose, onSave, mailboxes = [] }) {
  const { theme: t } = useTheme();
  const isEdit = !!rule?.id;
  const isBuiltin = rule?.is_builtin ?? false;
  const isGeneral = rule?.builtin_key === 'general';
  const matchLocked = isBuiltin && isGeneral;

  const parsedTg = parseTelegramTarget(rule?.telegram_target);
  const [form, setForm] = useState({
    name: rule?.name || '',
    match_type: rule?.match_type || 'keyword',
    match_values: rule?.match_values || '',
    label: rule?.label || '📩 Custom',
    color: rule?.color || '#6b7280',
    hashtag: rule?.hashtag || '',
    mention_users: rule?.mention_users || '',
    include_body: rule?.include_body ?? true,
    priority: rule?.priority ?? 10,
    enabled: rule?.enabled ?? true,
    mailbox_id: rule?.mailbox_id ?? null,
  });
  const [tgChatId, setTgChatId] = useState(parsedTg.chatId);
  const [tgThreadId, setTgThreadId] = useState(parsedTg.threadId);
  const [templates, setTemplates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    api('/admin/telegram-templates').then(setTemplates).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault(); setSaving(true); setErr('');
    const telegram_target = buildTelegramTarget(tgChatId, tgThreadId) || null;
    const payload = { ...form, priority: Number(form.priority), telegram_target, mailbox_id: form.mailbox_id || null };

    if (isBuiltin) {
      const body = isGeneral
        ? (() => { const { name, match_type, match_values, priority, mailbox_id, ...d } = payload; return d; })()
        : (() => { const { ...d } = payload; return d; })();
      try {
        const result = await api(`/mail-reporter/rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        onSave(result);
      } catch (e) { setErr(e.message || 'Save failed'); setSaving(false); }
      return;
    }
    try {
      const result = isEdit
        ? await api(`/mail-reporter/rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api('/mail-reporter/rules', { method: 'POST', body: JSON.stringify(payload) });
      onSave(result);
    } catch (e) { setErr(e.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  const lbl = {
    fontSize: '11px', fontWeight: 600, color: t.textMuted,
    textTransform: 'uppercase', letterSpacing: '0.06em',
  };
  const inp = {
    padding: '8px 10px', borderRadius: t.radiusSm,
    border: `1px solid ${t.border}`, fontSize: '13px',
    background: t.surfaceAlt, color: t.text,
    width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
    outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
  };
  const inpDisabled = { ...inp, opacity: 0.45, cursor: 'not-allowed' };
  const field = { display: 'flex', flexDirection: 'column', gap: '5px' };

  return (
    <Overlay onClose={onClose} title={isEdit ? `Edit Rule${isBuiltin ? (isGeneral ? ' — General (catch-all)' : ' — Built-in') : ''}` : 'Add Routing Rule'}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

        {/* Info banner */}
        {isBuiltin && (
          <div style={{
            background: t.surfaceAlt, border: `1px solid ${t.border}`,
            borderLeft: `3px solid ${isGeneral ? t.textMuted : t.accent}`,
            borderRadius: t.radiusSm, padding: '9px 12px',
            fontSize: '12px', color: t.textMuted, lineHeight: 1.5,
          }}>
            {isGeneral
              ? '🔒 General is the catch-all — it matches everything with no conditions. Only display settings can be edited.'
              : '⚙️ Built-in rule — you can add extra keywords below to extend detection. The original hardcoded detection still runs as fallback.'}
          </div>
        )}

        {/* Name */}
        <div style={field}>
          <label style={lbl}>Name</label>
          <input style={isGeneral ? inpDisabled : inp} value={form.name} onChange={set('name')} required disabled={isGeneral} />
        </div>

        {/* Label + Color */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={field}>
            <label style={lbl}>Label</label>
            <input style={inp} value={form.label} onChange={set('label')} required placeholder="🔴 Adobe" />
          </div>
          <div style={field}>
            <label style={lbl}>Color</label>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input type="color" value={form.color} onChange={set('color')} style={{
                width: '36px', height: '34px', padding: '2px 3px',
                border: `1px solid ${t.border}`, borderRadius: t.radiusSm,
                cursor: 'pointer', background: 'none',
              }} />
              <input style={{ ...inp, flex: 1 }} value={form.color} onChange={set('color')} placeholder="#6b7280" pattern="^#[0-9a-fA-F]{6}$" />
            </div>
          </div>
        </div>

        {/* Badge preview */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '9px 12px', background: t.surfaceAlt,
          borderRadius: t.radiusSm, border: `1px solid ${t.border}`,
        }}>
          <span style={{ fontSize: '11px', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Preview</span>
          <RuleBadge rule={form} />
        </div>

        {/* Hashtag + Mentions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={field}>
            <label style={lbl}>Hashtag(s)</label>
            <input style={inp} value={form.hashtag} onChange={set('hashtag')} placeholder="#adobe #ticket" />
          </div>
          <div style={field}>
            <label style={lbl}>Mentions</label>
            <input style={inp} value={form.mention_users} onChange={set('mention_users')} placeholder="@alice @bob" />
          </div>
        </div>

        {/* Telegram target override */}
        <div style={field}>
          <label style={lbl}>Telegram target override</label>
          <TelegramTargetFields chatId={tgChatId} threadId={tgThreadId} onChatId={setTgChatId} onThreadId={setTgThreadId} templates={templates} theme={t} />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.include_body} onChange={e => setForm(f => ({ ...f, include_body: e.target.checked }))} />
          <span style={{ color: t.textSecondary }}>Include email body in Telegram message</span>
        </label>

        {/* Mailbox scope — only for non-general rules */}
        {!isGeneral && (
          <div style={field}>
            <label style={lbl}>Apply to mailbox</label>
            <select style={inp} value={form.mailbox_id ?? ''} onChange={e => setForm(f => ({ ...f, mailbox_id: e.target.value ? Number(e.target.value) : null }))}>
              <option value="">All mailboxes (global)</option>
              {mailboxes.map(mb => <option key={mb.id} value={mb.id}>{mb.email}</option>)}
            </select>
          </div>
        )}

        {/* Match conditions — for custom rules AND non-general built-ins */}
        {!matchLocked && (
          <>
            <div style={{ borderTop: `1px solid ${t.border}`, margin: '2px 0' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'flex-end' }}>
              <div style={field}>
                <label style={lbl}>Match type</label>
                <select style={inp} value={form.match_type} onChange={set('match_type')} required={!isBuiltin}>
                  {Object.entries(MATCH_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div style={field}>
                <label style={lbl}>Priority</label>
                <input
                  type="number" style={inp}
                  value={form.priority} onChange={set('priority')}
                  min={1} max={999}
                />
              </div>
            </div>
            <div style={field}>
              <label style={lbl}>Match values (comma-separated)</label>
              <input
                style={inp}
                value={form.match_values}
                onChange={set('match_values')}
                required={!isBuiltin}
                placeholder="payment declined,keyword,phrase with spaces"
              />
              {isBuiltin && (
                <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '3px' }}>
                  Added on top of built-in detection — leave empty to rely on hardcoded logic only
                </div>
              )}
            </div>
          </>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
          <input
            type="checkbox" checked={form.enabled}
            onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
            disabled={isGeneral}
          />
          <span style={{ color: isGeneral ? t.textMuted : t.textSecondary }}>
            {isGeneral ? 'Enabled (General catch-all is always active)' : 'Enabled'}
          </span>
        </label>

        {err && <div style={{ color: t.danger, fontSize: '12px', padding: '6px 10px', background: t.dangerLight, borderRadius: t.radiusSm }}>{err}</div>}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px' }}>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? '…' : (isEdit ? 'Save' : 'Add Rule')}</Button>
        </div>
      </form>
    </Overlay>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────

export default function MailReporterPage({ user }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const isAdmin = user?.role === 'admin';

  const [mailboxes, setMailboxes] = useState([]);
  const [emails, setEmails] = useState([]);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [page, setPage] = useState(0);

  const [showMailboxModal, setShowMailboxModal] = useState(false);
  const [editMailbox, setEditMailbox] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [toast, setToast] = useState(null);
  const [commentTarget, setCommentTarget] = useState(null);

  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [confirmDeleteRule, setConfirmDeleteRule] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  // Build rule lookup map keyed by id for fast badge lookup
  const ruleMap = Object.fromEntries(rules.map(r => [r.id, r]));

  const loadMailboxes = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await api('/mail-reporter/mailboxes');
      setMailboxes(data);
    } catch (e) { showToast(e.message || 'Failed to load mailboxes', 'error'); }
    finally { setLoading(false); }
  }, [isAdmin]);

  const loadEmails = useCallback(async () => {
    setEmailsLoading(true);
    try {
      const data = await api('/mail-reporter/emails?limit=500');
      setEmails(data);
    } catch (e) { showToast(e.message || 'Failed to load emails', 'error'); }
    finally { setEmailsLoading(false); }
  }, []);

  const loadRules = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await api('/mail-reporter/rules');
      setRules(data);
    } catch (e) { showToast(e.message || 'Failed to load rules', 'error'); }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) { loadMailboxes(); loadRules(); }
    else setLoading(false);
    loadEmails();
    const interval = setInterval(loadEmails, 30000);
    return () => clearInterval(interval);
  }, [loadMailboxes, loadEmails, loadRules, isAdmin]);

  // ── Mailbox actions ──────────────────────────────────────────────

  function onMailboxSaved(mb) {
    setMailboxes(prev => {
      const idx = prev.findIndex(m => m.id === mb.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = mb; return next; }
      return [...prev, mb];
    });
    setShowMailboxModal(false); setEditMailbox(null); showToast('Mailbox saved');
  }

  async function doDeleteMailbox(id) {
    try {
      await api(`/mail-reporter/mailboxes/${id}`, { method: 'DELETE' });
      setMailboxes(prev => prev.filter(m => m.id !== id));
      showToast('Mailbox deleted');
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
    setConfirmDelete(null);
  }

  async function testConn(mb) {
    setTestResult({ id: mb.id, success: null, message: 'Testing…' });
    try { const res = await api(`/mail-reporter/mailboxes/${mb.id}/test`, { method: 'POST' }); setTestResult({ id: mb.id, ...res }); }
    catch (e) { setTestResult({ id: mb.id, success: false, message: e.message }); }
  }

  async function toggleEnabled(mb) {
    try {
      const updated = await api(`/mail-reporter/mailboxes/${mb.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !mb.enabled }) });
      setMailboxes(prev => prev.map(m => m.id === updated.id ? updated : m));
    } catch (e) { showToast(e.message || 'Update failed', 'error'); }
  }

  async function pollNow() {
    try {
      await api('/mail-reporter/poll-now', { method: 'POST' });
      showToast('Poll triggered — refreshing in 5s…');
      setTimeout(() => { loadMailboxes(); loadEmails(); }, 5000);
    } catch (e) { showToast(e.message || 'Failed', 'error'); }
  }

  async function clearLogs() {
    if (!window.confirm('Delete all email logs? Emails will be re-processed on next poll.')) return;
    try {
      const res = await api('/mail-reporter/emails', { method: 'DELETE' });
      setEmails([]); setPage(0); showToast(`Cleared ${res.deleted} log entries`);
    } catch (e) { showToast(e.message || 'Failed', 'error'); }
  }

  async function setEmailStatus(em, status) {
    try {
      const updated = await api(`/mail-reporter/emails/${em.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setEmails(prev => prev.map(e => e.id === updated.id ? updated : e));
    } catch (e) { showToast(e.message || 'Failed', 'error'); }
  }

  // ── Rule actions ─────────────────────────────────────────────────

  function onRuleSaved(r) {
    setRules(prev => {
      const idx = prev.findIndex(x => x.id === r.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = r; return next; }
      return [...prev, r];
    });
    setShowRuleModal(false); setEditRule(null); showToast('Rule saved');
  }

  async function doDeleteRule(id) {
    try {
      await api(`/mail-reporter/rules/${id}`, { method: 'DELETE' });
      setRules(prev => prev.filter(r => r.id !== id));
      showToast('Rule deleted');
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
    setConfirmDeleteRule(null);
  }

  async function moveRule(rule, direction) {
    // All rules except the General catch-all participate in ordering
    const movable = rules
      .filter(r => r.builtin_key !== 'general')
      .sort((a, b) => a.priority - b.priority || a.id - b.id);
    const idx = movable.findIndex(r => r.id === rule.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= movable.length) return;

    // Swap positions then renumber sequentially (avoids equal-priority deadlocks)
    const newOrder = [...movable];
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    const renumbered = newOrder.map((r, i) => ({ ...r, priority: (i + 1) * 10 }));
    const changed = renumbered.filter((r, i) => r.priority !== movable[i].priority);

    try {
      const results = await Promise.all(
        changed.map(r => api(`/mail-reporter/rules/${r.id}`, {
          method: 'PATCH', body: JSON.stringify({ priority: r.priority }),
        }))
      );
      setRules(prev => {
        const next = [...prev];
        results.forEach(r => { const i = next.findIndex(x => x.id === r.id); if (i >= 0) next[i] = r; });
        return next;
      });
    } catch (e) { showToast(e.message || 'Reorder failed', 'error'); }
  }

  async function toggleRuleEnabled(rule) {
    try {
      const updated = await api(`/mail-reporter/rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !rule.enabled }) });
      setRules(prev => prev.map(r => r.id === updated.id ? updated : r));
    } catch (e) { showToast(e.message || 'Update failed', 'error'); }
  }

  // ── Shared styles ────────────────────────────────────────────────

  const totalPages = Math.ceil(emails.length / PAGE_SIZE);
  const pagedEmails = emails.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const labelStyle = { fontSize: '11px', fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' };
  const cellStyle = { padding: '10px 12px', fontSize: '13px', borderBottom: `1px solid ${t.border}`, verticalAlign: 'middle' };
  const headStyle = { ...cellStyle, ...labelStyle, padding: '8px 12px', background: t.surfaceAlt, borderBottom: `1px solid ${t.border}` };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {toast && <Toast message={toast.msg} type={toast.type} />}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>{tr('mailReporter')}</h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: t.textMuted }}>IMAP monitoring → Telegram alerts</p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" onClick={pollNow}>{tr('pollNow')}</Button>
            <Button size="sm" onClick={() => { setEditMailbox(null); setShowMailboxModal(true); }}>{tr('addMailbox')}</Button>
          </div>
        )}
      </div>

      {/* ── Mailboxes — admin only ─────────────────────────────── */}
      {isAdmin && (
        <Card>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, fontSize: '15px' }}>{tr('mailboxes')}</span>
            <span style={{ ...labelStyle }}>{mailboxes.length} configured</span>
          </div>
          {loading ? (
            <div style={{ padding: '32px', textAlign: 'center', color: t.textMuted, fontSize: '14px' }}>{tr('loading')}</div>
          ) : mailboxes.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>📭</div>
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>{tr('noMailboxes')}</div>
              <div style={{ fontSize: '13px', color: t.textMuted }}>{tr('noMailboxesDesc')}</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{['Email', 'Filter', 'Telegram target', 'Last poll', 'Failures', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ ...headStyle, textAlign: 'left' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {mailboxes.map(mb => (
                    <tr key={mb.id} style={{ background: mb.consecutive_failures > 0 ? `${t.danger}08` : 'transparent' }}>
                      <td style={cellStyle}>
                        <div style={{ fontWeight: 500, fontFamily: 'monospace', fontSize: '13px' }}>{mb.email}</div>
                        {mb.last_error && <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '3px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={mb.last_error}>⚠ {mb.last_error}</div>}
                      </td>
                      <td style={cellStyle}><code style={{ fontSize: '12px', background: t.surfaceAlt, padding: '2px 6px', borderRadius: '4px', border: `1px solid ${t.border}` }}>{mb.subject_filter || 'NONE'}</code></td>
                      <td style={cellStyle}>{mb.telegram_target ? <code style={{ fontSize: '12px' }}>{mb.telegram_target}</code> : <span style={{ color: t.textMuted, fontSize: '12px' }}>global default</span>}</td>
                      <td style={{ ...cellStyle, color: t.textMuted, fontSize: '12px' }}>{fmtSince(mb.last_poll_at)}</td>
                      <td style={cellStyle}>{mb.consecutive_failures > 0 ? <Badge color="red">{mb.consecutive_failures} fail{mb.consecutive_failures !== 1 ? 's' : ''}</Badge> : <Badge color="green">0</Badge>}</td>
                      <td style={cellStyle}>
                        <button onClick={() => toggleEnabled(mb)} className={`toggle-pill ${mb.enabled ? 'toggle-on' : 'toggle-off'}`}>
                          {mb.enabled ? 'ON' : 'OFF'}
                        </button>
                      </td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          <Button size="sm" variant="ghost" onClick={() => testConn(mb)} style={{ fontSize: '11px', padding: '3px 8px' }}>{testResult?.id === mb.id && testResult.message === 'Testing…' ? '…' : '🔌'}</Button>
                          <Button size="sm" variant="secondary" onClick={() => { setEditMailbox(mb); setShowMailboxModal(true); }} style={{ fontSize: '11px', padding: '3px 8px' }}>Edit</Button>
                          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(mb)} style={{ fontSize: '11px', padding: '3px 8px' }}>Del</Button>
                        </div>
                        {testResult?.id === mb.id && testResult.message !== 'Testing…' && (
                          <div style={{ marginTop: '6px', fontSize: '11px', padding: '4px 8px', borderRadius: '6px', background: testResult.success ? '#d1fae5' : '#fee2e2', color: testResult.success ? '#065f46' : '#991b1b', maxWidth: '200px' }}>
                            {testResult.success ? '✓' : '✗'} {testResult.message}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── Routing Rules — admin only ─────────────────────────── */}
      {isAdmin && (
        <Card>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: '15px' }}>Routing Rules</span>
              <span style={{ ...labelStyle, marginLeft: '10px' }}>{rules.filter(r => !r.is_builtin).length} custom · {rules.filter(r => r.is_builtin).length} built-in</span>
            </div>
            <Button size="sm" onClick={() => { setEditRule(null); setShowRuleModal(true); }}>+ Add Rule</Button>
          </div>

          {rules.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: t.textMuted, fontSize: '14px' }}>No rules found — built-ins load on first startup.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{['Badge', 'Name', 'Mailbox scope', 'Type', 'Match values', 'Mentions', 'Body', 'Prio', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ ...headStyle, textAlign: 'left' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {rules.map(rule => (
                    <tr key={rule.id}>
                      <td style={cellStyle}><RuleBadge rule={rule} /></td>
                      <td style={{ ...cellStyle, maxWidth: '150px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden' }}>
                          {rule.is_builtin && <span title={rule.builtin_key === 'general' ? 'General catch-all — cannot be deleted' : 'Built-in rule — re-created on server restart'} style={{ fontSize: '12px', flexShrink: 0 }}>{rule.builtin_key === 'general' ? '🔒' : '⚙️'}</span>}
                          <span style={{ fontWeight: 500, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rule.name}</span>
                        </div>
                        {rule.hashtag && <div style={{ fontSize: '11px', color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rule.hashtag}</div>}
                      </td>
                      <td style={{ ...cellStyle, fontSize: '12px', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rule.is_builtin
                          ? <span style={{ color: t.textMuted, fontStyle: 'italic' }}>all (built-in)</span>
                          : rule.mailbox_id
                            ? <span style={{ color: t.accent, fontFamily: 'monospace' }}>{mailboxes.find(m => m.id === rule.mailbox_id)?.email || `#${rule.mailbox_id}`}</span>
                            : <span style={{ color: t.textMuted }}>all mailboxes</span>}
                      </td>
                      <td style={{ ...cellStyle, fontSize: '12px', color: t.textMuted, maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rule.is_builtin && !rule.match_values
                          ? <span style={{ fontStyle: 'italic' }}>built-in</span>
                          : (MATCH_TYPE_LABELS[rule.match_type] || rule.match_type || <span style={{ fontStyle: 'italic' }}>built-in</span>)}
                      </td>
                      <td style={{ ...cellStyle, maxWidth: '160px', fontSize: '12px' }}>
                        {rule.match_values
                          ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', whiteSpace: 'nowrap' }} title={rule.match_values}>{rule.match_values}</span>
                          : <span style={{ color: t.border }}>—</span>}
                      </td>
                      <td style={{ ...cellStyle, fontSize: '12px', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rule.mention_users}>
                        {rule.mention_users || <span style={{ color: t.border }}>—</span>}
                      </td>
                      <td style={{ ...cellStyle, fontSize: '12px', textAlign: 'center' }}>{rule.include_body ? '✓' : '—'}</td>
                      <td style={{ ...cellStyle, fontSize: '12px', textAlign: 'center', color: t.textMuted }}>{rule.priority}</td>
                      <td style={cellStyle}>
                        <button
                          onClick={() => !(rule.is_builtin && rule.builtin_key === 'general') && toggleRuleEnabled(rule)}
                          disabled={rule.is_builtin && rule.builtin_key === 'general'}
                          className={`toggle-pill ${rule.enabled ? 'toggle-on' : 'toggle-off'}`}
                          style={{ opacity: (rule.is_builtin && rule.builtin_key === 'general') ? 0.5 : 1 }}
                        >
                          {rule.enabled ? 'ON' : 'OFF'}
                        </button>
                      </td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          {rule.builtin_key !== 'general' && (() => {
                            const movable = rules.filter(r => r.builtin_key !== 'general').sort((a, b) => a.priority - b.priority || a.id - b.id);
                            const idx = movable.findIndex(r => r.id === rule.id);
                            return (
                              <>
                                <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => moveRule(rule, 'up')} style={{ fontSize: '11px', padding: '3px 6px' }} title="Move up">↑</Button>
                                <Button size="sm" variant="ghost" disabled={idx === movable.length - 1} onClick={() => moveRule(rule, 'down')} style={{ fontSize: '11px', padding: '3px 6px' }} title="Move down">↓</Button>
                              </>
                            );
                          })()}
                          <Button size="sm" variant="secondary" onClick={() => { setEditRule(rule); setShowRuleModal(true); }} style={{ fontSize: '11px', padding: '3px 8px' }}>Edit</Button>
                          {rule.builtin_key !== 'general' && (
                            <Button size="sm" variant="danger" onClick={() => setConfirmDeleteRule(rule)} style={{ fontSize: '11px', padding: '3px 8px' }}>Del</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── Email Log ─────────────────────────────────────────────── */}
      <Card>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontWeight: 600, fontSize: '15px' }}>{tr('recentEmails')}</span>
            <span style={{ ...labelStyle }}>{emails.length} entries</span>
            {emailsLoading && <span style={{ ...labelStyle }}>⟳</span>}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="ghost" size="sm" onClick={loadEmails}>Refresh</Button>
            {isAdmin && <Button variant="ghost" size="sm" onClick={clearLogs} style={{ color: '#ef4444' }}>{tr('clearLogs')}</Button>}
          </div>
        </div>

        {emails.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>📬</div>
            <div style={{ color: t.textMuted, fontSize: '14px' }}>{tr('noEmailLogs')}</div>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{['Time', 'Mailbox', 'From', 'Subject', 'Category', 'TG', 'Code', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ ...headStyle, textAlign: 'left' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {pagedEmails.map(em => {
                    // Use rule_id → live rule for badge, fall back to static category map
                    const rule = em.rule_id ? ruleMap[em.rule_id] : null;
                    return (
                      <tr key={em.id} style={{ opacity: em.skip_reason === 'filter' ? 0.5 : 1, background: em.is_solved ? `${t.success || '#10b981'}08` : (!em.telegram_sent && !em.skip_reason ? `${t.danger}08` : 'transparent') }}>
                        <td style={{ ...cellStyle, fontSize: '11px', color: t.textMuted, whiteSpace: 'nowrap' }}>{fmtTime(em.received_at || em.created_at)}</td>
                        <td style={{ ...cellStyle, fontSize: '12px', fontFamily: 'monospace' }}>{em.mailbox_email || '—'}</td>
                        <td style={{ ...cellStyle, fontSize: '12px', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={em.sender}>{em.sender || '—'}</td>
                        <td style={{ ...cellStyle, maxWidth: '200px' }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={em.subject}>{em.subject || '—'}</div>
                          {em.comment_count > 0 && <div style={{ fontSize: '11px', color: t.accent, marginTop: '2px' }}>💬 {em.comment_count} comment{em.comment_count !== 1 ? 's' : ''}</div>}
                        </td>
                        <td style={cellStyle}>
                          {rule
                            ? <RuleBadge rule={rule} />
                            : <Badge color={CATEGORY_COLORS[em.category] || 'gray'}>{CATEGORY_LABELS[em.category] || em.category}</Badge>
                          }
                        </td>
                        <td style={cellStyle}>{em.skip_reason ? <Badge color="gray">{em.skip_reason}</Badge> : em.telegram_sent ? <Badge color="green">✓</Badge> : <Badge color="red">✗</Badge>}</td>
                        <td style={cellStyle}>{em.extracted_code ? <code style={{ background: t.surfaceAlt, padding: '2px 6px', borderRadius: '4px', fontSize: '13px', fontWeight: 700, border: `1px solid ${t.border}` }}>{em.extracted_code}</code> : <span style={{ color: t.border }}>—</span>}</td>
                        <td style={cellStyle}>
                          {(() => {
                            const st = em.status || (em.is_solved ? 'solved' : 'unchecked');
                            const cfg = EMAIL_STATUS_CONFIG[st] || EMAIL_STATUS_CONFIG.unchecked;
                            return <Badge color={cfg.color}>{cfg.label}</Badge>;
                          })()}
                        </td>
                        <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <select
                              value={em.status || (em.is_solved ? 'solved' : 'unchecked')}
                              onChange={e => setEmailStatus(em, e.target.value)}
                              style={{
                                fontSize: '11px', padding: '3px 6px',
                                border: `1px solid ${t.border}`, borderRadius: t.radiusSm,
                                background: t.surfaceAlt, color: t.text,
                                cursor: 'pointer', fontFamily: 'inherit',
                              }}
                            >
                              <option value="unchecked">Unchecked</option>
                              <option value="solved">✓ Solved</option>
                              <option value="on_pause">⏸ Paused</option>
                              <option value="blocked">🚫 Blocked</option>
                            </select>
                            <button
                              onClick={() => setCommentTarget(em)}
                              title={em.comment_count > 0 ? `${em.comment_count} comment${em.comment_count !== 1 ? 's' : ''}` : 'Add comment'}
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '3px 8px', position: 'relative' }}
                            >
                              💬{em.comment_count > 0 && <span style={{ fontSize: '10px', marginLeft: '2px', color: t.accent }}>{em.comment_count}</span>}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${t.border}` }}>
                <span style={{ fontSize: '13px', color: t.textMuted }}>
                  Page {page + 1} of {totalPages} · {emails.length} total
                </span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(0)}>«</Button>
                  <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</Button>
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    const p = totalPages <= 7 ? i : Math.max(0, Math.min(page - 3, totalPages - 7)) + i;
                    return (
                      <Button key={p} size="sm" variant={p === page ? 'primary' : 'ghost'} onClick={() => setPage(p)}>
                        {p + 1}
                      </Button>
                    );
                  })}
                  <Button size="sm" variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>›</Button>
                  <Button size="sm" variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ── Modals ───────────────────────────────────────────────── */}
      {showMailboxModal && <MailboxModal mailbox={editMailbox} onClose={() => { setShowMailboxModal(false); setEditMailbox(null); }} onSave={onMailboxSaved} />}
      {showRuleModal && <RuleModal rule={editRule} mailboxes={mailboxes} onClose={() => { setShowRuleModal(false); setEditRule(null); }} onSave={onRuleSaved} />}

      {confirmDelete && (
        <Overlay onClose={() => setConfirmDelete(null)} title="Delete Mailbox">
          <p style={{ margin: '0 0 16px', fontSize: '14px' }}>Delete <strong>{confirmDelete.email}</strong>? This also removes all email logs for this mailbox.</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>{tr('cancel')}</Button>
            <Button variant="danger" onClick={() => doDeleteMailbox(confirmDelete.id)}>Delete</Button>
          </div>
        </Overlay>
      )}

      {confirmDeleteRule && (
        <Overlay onClose={() => setConfirmDeleteRule(null)} title="Delete Rule">
          <p style={{ margin: '0 0 16px', fontSize: '14px' }}>Delete rule <strong>{confirmDeleteRule.name}</strong>? Email logs referencing this rule will keep their category string but lose the colored badge.</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setConfirmDeleteRule(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => doDeleteRule(confirmDeleteRule.id)}>Delete</Button>
          </div>
        </Overlay>
      )}

      {commentTarget && <CommentHistoryModal email={commentTarget} onClose={() => { setCommentTarget(null); loadEmails(); }} />}
    </div>
  );
}
