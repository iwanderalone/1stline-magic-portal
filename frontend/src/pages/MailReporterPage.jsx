import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api';
import { useLang } from '../components/LangContext';
import { Button, Card, Badge, Input, Overlay, Toast, EmptyState, Tag } from '../components/UI';
import { Icon } from '../components/Icons';
import { MessageBody } from '../components/EmailDetailModal';
import EmailReplies from '../components/EmailReplies';

// --- Constants & Config ---

const EMAIL_STATUS_CONFIG = {
  unchecked: { key: 'mailStatusUnchecked', label: 'Unchecked', color: 'yellow', icon: 'clock' },
  solved:    { key: 'mailStatusSolved',    label: 'Solved',    color: 'green',  icon: 'checkCircle' },
  on_pause:  { key: 'mailStatusPaused',    label: 'Paused',    color: 'blue',   icon: 'play' },
  blocked:   { key: 'mailStatusBlocked',   label: 'Blocked',   color: 'red',    icon: 'alertTriangle' },
};

const STATUS_CYCLE = ['unchecked', 'on_pause', 'blocked', 'solved'];

const MATCH_TYPE_LABELS = {
  keyword: 'Keyword (subject + body)',
  subject_keyword: 'Subject keyword',
  sender: 'Sender address',
  sender_domain: 'Sender domain',
};

// --- Helpers ---

function toUtc(dt) {
  if (!dt) return null;
  const s = dt.endsWith('Z') || dt.includes('+') ? dt : dt + 'Z';
  return new Date(s);
}

function fmtTime(dt) {
  const d = toUtc(dt);
  if (!d) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtSince(dt) {
  if (!dt) return 'Never';
  const diff = Math.floor((Date.now() - toUtc(dt)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

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

// --- Components ---

function RuleBadge({ rule, style }) {
  if (!rule) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: rule.color + '15',
      color: rule.color,
      border: `1px solid ${rule.color}33`,
      borderRadius: 'var(--radius-pill)',
      padding: '1px 10px',
      fontSize: '11px',
      fontWeight: 600,
      whiteSpace: 'nowrap',
      letterSpacing: '0.01em',
      ...style,
    }}>
      <Icon name="hash" size={10} color={rule.color} />
      {rule.label}
    </span>
  );
}

function TelegramTargetFields({ chatId, threadId, onChatId, onThreadId, templates }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {templates && templates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label className="t-eyebrow">From template</label>
          <select
            style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px', background: 'var(--surface-alt)', color: 'var(--text)', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }}
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

// --- Modals ---

function MailboxModal({ mailbox, onClose, onSave }) {
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
          <label className="t-eyebrow">Telegram target (default for this mailbox)</label>
          <TelegramTargetFields chatId={tgChatId} threadId={tgThreadId} onChatId={setTgChatId} onThreadId={setTgThreadId} templates={templates} />
        </div>
        <Input label={tr('monitorSince')} type="date" value={form.monitor_since} onChange={set('monitor_since')} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
          <span>{tr('enabled')}</span>
        </label>
        {err && <div style={{ color: 'var(--danger)', fontSize: '13px' }}>{err}</div>}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={onClose}>{tr('cancel')}</Button>
          <Button type="submit" disabled={saving}>{saving ? '…' : (isEdit ? 'Save' : tr('add'))}</Button>
        </div>
      </form>
    </Overlay>
  );
}

function RuleModal({ rule, onClose, onSave, mailboxes = [] }) {
  const isEdit = !!rule?.id;
  const isBuiltin = rule?.is_builtin ?? false;
  const isGeneral = rule?.builtin_key === 'general';
  const isBackupAlerts = rule?.builtin_key === 'backup_alerts';
  const matchLocked = isBuiltin && isGeneral;

  const parsedTg = parseTelegramTarget(rule?.telegram_target);
  const [form, setForm] = useState({
    name: rule?.name || '',
    match_type: rule?.match_type || 'keyword',
    match_values: rule?.match_values || '',
    label: rule?.label || 'Custom',
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

  return (
    <Overlay onClose={onClose} title={isEdit ? `Edit Rule${isBuiltin ? (isGeneral ? ' — General' : ' — Built-in') : ''}` : 'Add Routing Rule'}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {isBuiltin && (
          <div style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderLeft: '3px solid var(--accent)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
            {isGeneral ? 'General is the catch-all rule.' : 'Built-in rule — you can add keywords to extend detection.'}
          </div>
        )}
        <Input label="Name" value={form.name} onChange={set('name')} required disabled={isGeneral} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Input label="Label" value={form.label} onChange={set('label')} required placeholder="Adobe" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label className="t-eyebrow">Color</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input type="color" value={form.color} onChange={set('color')} style={{ width: '36px', height: '34px', padding: '2px', border: '1px solid var(--border)', background: 'none', cursor: 'pointer' }} />
              <Input value={form.color} onChange={set('color')} placeholder="#6b7280" />
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Input label="Hashtag" value={form.hashtag} onChange={set('hashtag')} placeholder="#adobe" />
          <Input label="Mentions" value={form.mention_users} onChange={set('mention_users')} placeholder="@user" />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.include_body}
            disabled={isBackupAlerts}
            onChange={e => setForm(f => ({ ...f, include_body: e.target.checked }))}
          />
          <span>
            {isBackupAlerts
              ? 'Backup alerts always send a compact parsed summary'
              : 'Include original email body in Telegram message'}
          </span>
        </label>
        <TelegramTargetFields chatId={tgChatId} threadId={tgThreadId} onChatId={setTgChatId} onThreadId={setTgThreadId} templates={templates} />
        {!matchLocked && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label className="t-eyebrow">Match type</label>
                <select style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text)' }} value={form.match_type} onChange={set('match_type')}>
                  {Object.entries(MATCH_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <Input label="Priority" type="number" value={form.priority} onChange={set('priority')} />
            </div>
            <Input label="Match values (comma-separated)" value={form.match_values} onChange={set('match_values')} placeholder="keyword1, keyword2" />
          </>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? '…' : 'Save'}</Button>
        </div>
      </form>
    </Overlay>
  );
}

// --- Internal Page Modules ---

function EmailSidebar({ counts, activeFolder, onSelect, rules, mailboxes }) {
  const { t: tr } = useLang();

  const Item = ({ id, label, icon, count, color }) => (
    <button
      onClick={() => onSelect(id)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        background: activeFolder === id ? 'var(--accent-light)' : 'transparent',
        border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        color: activeFolder === id ? 'var(--accent)' : 'var(--text-secondary)',
        fontSize: '13px', fontWeight: activeFolder === id ? 600 : 500,
        textAlign: 'left', transition: 'all 0.15s ease',
      }}
    >
      <Icon name={icon} size={15} color={activeFolder === id ? 'var(--accent)' : color || 'var(--text-muted)'} />
      <span style={{ flex: 1 }}>{label}</span>
      {count > 0 && (
        <span style={{
          fontSize: '10px', background: activeFolder === id ? 'var(--accent)' : 'var(--surface-sunken)',
          color: activeFolder === id ? '#fff' : 'var(--text-muted)',
          padding: '1px 6px', borderRadius: '10px', minWidth: '18px', textAlign: 'center'
        }}>{count}</span>
      )}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Item id="inbox" label={tr('mailInbox')} icon="inbox" count={counts.inbox} />
        <Item id="unrouted" label={tr('mailUnrouted')} icon="filter" count={counts.unrouted} />
        <Item id="archive" label={tr('mailArchive')} icon="archive" />
        <Item id="sent" label={tr('mailSentFolder')} icon="send" />
      </div>

      <div style={{ height: 1, background: 'var(--border-light)', margin: '4px 0' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="t-eyebrow" style={{ padding: '0 12px', marginBottom: 4 }}>{tr('mailCategories')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rules.filter(r => r.builtin_key !== 'general').map(r => (
            <Item key={r.id} id={`rule:${r.id}`} label={r.label} icon="hash" color={r.color} count={counts[`rule:${r.id}`]} />
          ))}
        </div>
      </div>

      {mailboxes.length > 0 && (
        <div style={{ marginTop: 'auto', paddingTop: 12 }}>
          <div className="t-eyebrow" style={{ padding: '0 12px', marginBottom: 6 }}>{tr('mailMailboxes')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 12px' }}>
            {mailboxes.map(mb => (
              <div key={mb.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '11px', color: 'var(--text-muted)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: mb.enabled ? 'var(--success)' : 'var(--text-muted)' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mb.email}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmailList({ emails, activeId, onSelect, loading, ruleMap }) {
  const { t: tr } = useLang();
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{tr('mailLoading')}</div>;
  if (emails.length === 0) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <EmptyState icon={<Icon name="mail" size={32} />} title={tr('mailNoMessages')} subtitle={tr('mailNoMessagesDesc')} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {emails.map(em => {
        const rule = em.rule_id ? ruleMap[em.rule_id] : null;
        const status = EMAIL_STATUS_CONFIG[em.status] || EMAIL_STATUS_CONFIG.unchecked;
        return (
          <div
            key={em.id}
            onClick={() => onSelect(em)}
            style={{
              padding: '12px 16px', borderBottom: '1px solid var(--border-light)', cursor: 'pointer',
              background: activeId === em.id ? 'var(--surface-alt)' : 'transparent',
              transition: 'background 0.1s ease', position: 'relative',
            }}
          >
            {activeId === em.id && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'var(--accent)' }} />}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmtTime(em.received_at || em.created_at)}</div>
              {em.comment_count > 0 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px',
                  color: 'var(--accent)', fontWeight: 700, background: 'var(--accent-light)',
                  padding: '1px 8px', borderRadius: 10,
                }}>
                  <Icon name="message" size={11} /> {em.comment_count}
                </div>
              )}
            </div>
            <div style={{ fontWeight: 600, fontSize: '13.5px', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: activeId === em.id ? 'var(--text)' : 'var(--text-secondary)' }}>
              {em.subject || '(no subject)'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>
              {em.sender}
            </div>
            {em.last_comment && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6,
                fontSize: '11.5px', color: 'var(--accent)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                <Icon name="message" size={10} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{em.last_comment}</span>
              </div>
            )}
            {em.reply_count > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6,
                fontSize: '11px', color: 'var(--success)', fontWeight: 600,
              }}>
                <Icon name="send" size={10} />
                {tr('mailReplied')}{em.reply_count > 1 ? ` ×${em.reply_count}` : ''}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {rule ? <RuleBadge rule={rule} style={{ fontSize: '10px', padding: '0 8px' }} /> : <Badge tone="gray" style={{ fontSize: '10px' }}>{tr('mailGeneral')}</Badge>}
              <span style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: `var(--${status.color})`, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <Icon name={status.icon} size={10} />
                {tr(status.key)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SentList({ replies, loading, activeId, onSelect }) {
  const { t: tr } = useLang();
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{tr('mailLoading')}</div>;
  if (replies.length === 0) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <EmptyState icon={<Icon name="send" size={32} />} title={tr('mailSentNothing')} subtitle={tr('mailSentNothingDesc')} />
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {replies.map(r => (
        <div
          key={r.id}
          onClick={() => onSelect(r.email_id)}
          style={{
            padding: '12px 16px', borderBottom: '1px solid var(--border-light)', cursor: 'pointer',
            background: activeId === r.email_id ? 'var(--surface-alt)' : 'transparent',
            transition: 'background 0.1s ease', position: 'relative',
          }}
        >
          {activeId === r.email_id && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'var(--accent)' }} />}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{
              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              color: r.status === 'failed' ? 'var(--danger)' : 'var(--success)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <Icon name={r.status === 'failed' ? 'alertTriangle' : 'send'} size={10} />
              {r.status === 'failed' ? tr('mailFailedTag') : tr('mailSentTag')}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmtTime(r.created_at)}</span>
          </div>
          <div style={{ fontWeight: 600, fontSize: '13.5px', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
            {r.subject || '(no subject)'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            → {r.to_addr} · {r.username || '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmailDetail({ email, ruleMap, onStatusChange, onAddComment }) {
  const { t: tr } = useLang();
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [savingComment, setSavingComment] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const loadComments = useCallback(async () => {
    if (!email) return;
    setLoadingComments(true);
    try { const data = await api(`/mail-reporter/emails/${email.id}/comments`); setComments(data); }
    catch {} finally { setLoadingComments(false); }
  }, [email]);

  useEffect(() => { loadComments(); }, [loadComments]);

  if (!email) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <EmptyState icon={<Icon name="mail" size={48} />} title={tr('mailSelectEmail')} subtitle={tr('mailSelectEmailDesc')} />
    </div>
  );

  const rule = email.rule_id ? ruleMap[email.id] : null;
  const status = EMAIL_STATUS_CONFIG[email.status] || EMAIL_STATUS_CONFIG.unchecked;

  const handleStatus = async (next) => {
    setUpdatingStatus(true);
    await onStatusChange(email, next);
    setUpdatingStatus(false);
  };

  const handleComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    setSavingComment(true);
    try {
      const c = await onAddComment(email, commentText.trim());
      setComments(prev => [...prev, c]);
      setCommentText('');
    } catch {}
    finally { setSavingComment(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 20 }}>
      {/* Header */}
      <section>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {email.rule_id ? <RuleBadge rule={ruleMap[email.rule_id]} /> : <Badge tone="gray">{tr('mailGeneral')}</Badge>}
          {email.extracted_code && <Tag>Code: {email.extracted_code}</Tag>}
          <span style={{ flex: 1 }} />
          <div style={{ display: 'flex', background: 'var(--surface-sunken)', padding: 2, borderRadius: 'var(--radius-sm)' }}>
            {STATUS_CYCLE.map(s => {
              const cfg = EMAIL_STATUS_CONFIG[s];
              const isActive = email.status === s;
              return (
                <button
                  key={s}
                  onClick={() => handleStatus(s)}
                  disabled={updatingStatus || isActive}
                  style={{
                    border: 'none', background: isActive ? 'var(--surface)' : 'transparent',
                    color: isActive ? `var(--${cfg.color})` : 'var(--text-muted)',
                    padding: '4px 10px', fontSize: '11px', fontWeight: 700,
                    borderRadius: 'var(--radius-xs)', cursor: isActive ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.1s ease',
                    boxShadow: isActive ? 'var(--shadow-xs)' : 'none',
                  }}
                >
                  <Icon name={cfg.icon} size={11} />
                  {tr(cfg.key)}
                </button>
              );
            })}
          </div>
        </div>

        <h2 style={{ fontSize: '20px', fontWeight: 700, lineHeight: 1.3, margin: '0 0 16px' }}>{email.subject || '(no subject)'}</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: '13px' }}>
          <span className="t-eyebrow">{tr('mailFrom')}</span>
          <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{email.sender}</span>
          <span className="t-eyebrow">{tr('mailMailboxLbl')}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{email.mailbox_email}</span>
          <span className="t-eyebrow">{tr('mailReceived')}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{new Date(email.received_at || email.created_at).toLocaleString()}</span>
        </div>
      </section>

      {/* Message Body */}
      <section style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="t-eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="mail" size={12} /> {tr('mailMessageBody')}
        </div>
        <MessageBody body={email.body} />
      </section>

      <div style={{ height: 1, background: 'var(--border-light)' }} />

      {/* Outbound replies */}
      <EmailReplies
        emailId={email.id}
        sender={email.sender}
        mailboxEmail={email.mailbox_email}
        onError={(message) => window.alert(message)}
      />

      <div style={{ height: 1, background: 'var(--border-light)' }} />

      {/* Internal Activity */}
      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
        <div className="t-eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="message" size={12} /> {tr('mailActivity')}{comments.length > 0 ? ` (${comments.length})` : ''}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
          {loadingComments ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{tr('mailLoadingHistory')}</div>
          ) : comments.length === 0 ? (
            <div style={{ padding: '20px', background: 'var(--surface-alt)', borderRadius: 'var(--radius)', border: '1px dashed var(--border)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              {tr('mailNoComments')}
            </div>
          ) : (
            comments.map(c => (
              <div key={c.id} style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: '12px', color: 'var(--accent)' }}>{c.username}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{fmtSince(c.created_at)}</span>
                </div>
                <div style={{ fontSize: '13px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.text}</div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleComment} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            placeholder={tr('mailWriteComment')}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
              background: 'var(--surface-alt)', color: 'var(--text)', fontSize: '13px', fontFamily: 'inherit',
              resize: 'none', minHeight: '80px', outline: 'none'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit" size="sm" disabled={savingComment || !commentText.trim()} icon="send">
              {savingComment ? tr('mailSaving') : tr('mailPostComment')}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

// --- Main Page ---

export default function MailReporterPage({ user }) {
  const { t: tr } = useLang();
  const isAdmin = user?.role === 'admin';

  const [mailboxes, setMailboxes] = useState([]);
  const [emails, setEmails] = useState([]);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [toast, setToast] = useState(null);

  const [showMailboxModal, setShowMailboxModal] = useState(false);
  const [showRuleModal, setShowRuleModal] = useState(false);

  const ruleMap = useMemo(() => Object.fromEntries(rules.map(r => [r.id, r])), [rules]);

  const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3500); };

  const loadData = useCallback(async () => {
    try {
      const [uEmails, uMailboxes, uRules] = await Promise.all([
        api('/mail-reporter/emails?limit=500'),
        isAdmin ? api('/mail-reporter/mailboxes') : Promise.resolve([]),
        isAdmin ? api('/mail-reporter/rules') : Promise.resolve([]),
      ]);
      setEmails(uEmails || []);
      setMailboxes(uMailboxes || []);
      setRules(uRules || []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadData();
    const i = setInterval(loadData, 30000);
    return () => clearInterval(i);
  }, [loadData]);

  const filteredEmails = useMemo(() => {
    if (activeFolder === 'inbox') return emails.filter(e => e.status !== 'solved');
    if (activeFolder === 'unrouted') return emails.filter(e => !e.rule_id && e.status !== 'solved');
    if (activeFolder === 'archive') return emails.filter(e => e.status === 'solved');
    if (activeFolder.startsWith('rule:')) {
      const rid = parseInt(activeFolder.split(':')[1]);
      return emails.filter(e => e.rule_id === rid);
    }
    return emails;
  }, [emails, activeFolder]);

  const counts = useMemo(() => {
    const c = { inbox: 0, unrouted: 0 };
    emails.forEach(e => {
      if (e.status !== 'solved') {
        c.inbox++;
        if (!e.rule_id) c.unrouted++;
        if (e.rule_id) {
          const key = `rule:${e.rule_id}`;
          c[key] = (c[key] || 0) + 1;
        }
      }
    });
    return c;
  }, [emails]);

  const pickEmail = async (email) => {
    if (!email) { setSelectedEmail(null); return; }
    setSelectedEmail(email);
    try {
      const full = await api(`/mail-reporter/emails/${email.id}`);
      setSelectedEmail(prev => prev?.id === full.id ? full : prev);
    } catch (e) { showToast(e.message, 'error'); }
  };

  // Sent view — outbound replies log
  const [sentReplies, setSentReplies] = useState([]);
  const [sentLoading, setSentLoading] = useState(false);
  useEffect(() => {
    if (activeFolder !== 'sent') return;
    setSentLoading(true);
    api('/mail-reporter/replies?limit=150')
      .then(d => setSentReplies(d || []))
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setSentLoading(false));
  }, [activeFolder]);

  const handleStatusChange = async (email, status) => {
    try {
      const updated = await api(`/mail-reporter/emails/${email.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setEmails(prev => prev.map(e => e.id === updated.id ? updated : e));
      if (selectedEmail?.id === email.id) {
        setSelectedEmail(prev => ({ ...updated, body: prev?.body }));
      }
      showToast('Status updated');
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleAddComment = async (email, text) => {
    try {
      const c = await api(`/mail-reporter/emails/${email.id}/comments`, { method: 'POST', body: JSON.stringify({ text }) });
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, comment_count: (e.comment_count || 0) + 1 } : e));
      return c;
    } catch (e) { showToast(e.message, 'error'); throw e; }
  };

  const pollNow = async () => {
    try {
      await api('/mail-reporter/poll-now', { method: 'POST' });
      showToast('Sync triggered…');
      setTimeout(loadData, 5000);
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Action Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Mail</h1>
          <Badge tone="blue" dot>{emails.length} logs</Badge>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && <Button variant="secondary" size="sm" icon="settings" onClick={() => setShowRuleModal(true)}>Rules</Button>}
          {isAdmin && <Button variant="secondary" size="sm" icon="plus" onClick={() => setShowMailboxModal(true)}>Mailbox</Button>}
          <Button variant="primary" size="sm" icon="refresh" onClick={pollNow}>Sync IMAP</Button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 2, background: 'var(--border-light)', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
        {/* Sidebar */}
        <div style={{ width: 220, background: 'var(--surface)', padding: 12, overflowY: 'auto' }}>
          <EmailSidebar counts={counts} activeFolder={activeFolder} onSelect={setActiveFolder} rules={rules} mailboxes={mailboxes} />
        </div>

        {/* List */}
        <div style={{ width: 380, background: 'var(--bg)', overflowY: 'auto', borderRight: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column' }}>
          {activeFolder === 'sent' ? (
            <SentList replies={sentReplies} loading={sentLoading} activeId={selectedEmail?.id} onSelect={(emailId) => pickEmail({ id: emailId })} />
          ) : (
            <EmailList emails={filteredEmails} activeId={selectedEmail?.id} onSelect={pickEmail} loading={loading} ruleMap={ruleMap} />
          )}
        </div>

        {/* Detail */}
        <div style={{ flex: 1, background: 'var(--surface)', padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <EmailDetail
            email={selectedEmail}
            ruleMap={ruleMap}
            onStatusChange={handleStatusChange}
            onAddComment={handleAddComment}
          />
        </div>
      </div>

      {showMailboxModal && <MailboxModal onClose={() => setShowMailboxModal(false)} onSave={loadData} />}
      {showRuleModal && <RuleModal mailboxes={mailboxes} onClose={() => setShowRuleModal(false)} onSave={loadData} />}
    </div>
  );
}
