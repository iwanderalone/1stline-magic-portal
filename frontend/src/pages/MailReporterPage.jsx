import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { useLang } from '../components/LangContext';
import { Button, Card, Badge, Input, Overlay, Toast } from '../components/UI';

const CATEGORY_COLORS = {
  adobe: 'red', onboarding: 'blue', offboarding: 'blue',
  onboarding_offboarding: 'blue', yandex_support: 'yellow',
  general: 'gray', filtered: 'gray',
};
const CATEGORY_LABELS = {
  adobe: '🔴 adobe', onboarding: '🔵 onboarding', offboarding: '🔵 offboarding',
  onboarding_offboarding: '🔵 on+off', yandex_support: '🟡 yandex',
  general: '📩 general', filtered: '⛔ filtered',
};

function fmtTime(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtSince(dt) {
  if (!dt) return 'Never';
  const diff = Math.floor((Date.now() - new Date(dt)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const PAGE_SIZE = 10;

function MailboxModal({ mailbox, onClose, onSave }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const isEdit = !!mailbox?.id;
  const [form, setForm] = useState({
    email: mailbox?.email || '', password: '',
    subject_filter: mailbox?.subject_filter || 'NONE',
    telegram_target: mailbox?.telegram_target || '',
    enabled: mailbox?.enabled ?? true,
    monitor_since: mailbox?.monitor_since || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault(); setSaving(true); setErr('');
    const payload = { ...form };
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
        <Input label={tr('telegramTarget')} value={form.telegram_target} onChange={set('telegram_target')} placeholder="-100123456789 or -100123456789:42" />
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

function CommentModal({ email, onClose, onSave }) {
  const { t: tr } = useLang();
  const { theme: t } = useTheme();
  const [comment, setComment] = useState(email.solver_comment || '');
  const [saving, setSaving] = useState(false);
  return (
    <Overlay onClose={onClose} title="Add Comment">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, wordBreak: 'break-word' }}>{email.subject}</div>
        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '5px' }}>Comment</label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={4}
            placeholder="Add a note about this email…"
            style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: `1px solid ${t.border}`, fontSize: '14px', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', background: t.surface, color: t.text }}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>{tr('cancel')}</Button>
          <Button disabled={saving} onClick={async () => {
            setSaving(true);
            try { await onSave(comment); onClose(); }
            finally { setSaving(false); }
          }}>{saving ? '…' : 'Save'}</Button>
        </div>
      </div>
    </Overlay>
  );
}

export default function MailReporterPage({ user }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const isAdmin = user?.role === 'admin';

  const [mailboxes, setMailboxes] = useState([]);
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [page, setPage] = useState(0);

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [toast, setToast] = useState(null);
  const [commentTarget, setCommentTarget] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

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

  useEffect(() => {
    if (isAdmin) loadMailboxes();
    else setLoading(false);
    loadEmails();
    const interval = setInterval(loadEmails, 30000);
    return () => clearInterval(interval);
  }, [loadMailboxes, loadEmails, isAdmin]);

  function onSaved(mb) {
    setMailboxes(prev => {
      const idx = prev.findIndex(m => m.id === mb.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = mb; return next; }
      return [...prev, mb];
    });
    setShowModal(false); setEditTarget(null); showToast('Mailbox saved');
  }

  async function doDelete(id) {
    try { await api(`/mail-reporter/mailboxes/${id}`, { method: 'DELETE' }); setMailboxes(prev => prev.filter(m => m.id !== id)); showToast('Mailbox deleted'); }
    catch (e) { showToast(e.message || 'Delete failed', 'error'); }
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
    try { await api('/mail-reporter/poll-now', { method: 'POST' }); showToast('Poll triggered — refreshing in 5s…'); setTimeout(() => { loadMailboxes(); loadEmails(); }, 5000); }
    catch (e) { showToast(e.message || 'Failed', 'error'); }
  }

  async function clearLogs() {
    if (!window.confirm('Delete all email logs? Emails will be re-processed on next poll.')) return;
    try { const res = await api('/mail-reporter/emails', { method: 'DELETE' }); setEmails([]); setPage(0); showToast(`Cleared ${res.deleted} log entries`); }
    catch (e) { showToast(e.message || 'Failed', 'error'); }
  }

  async function toggleSolved(em) {
    try {
      const updated = await api(`/mail-reporter/emails/${em.id}`, { method: 'PATCH', body: JSON.stringify({ is_solved: !em.is_solved }) });
      setEmails(prev => prev.map(e => e.id === updated.id ? updated : e));
    } catch (e) { showToast(e.message || 'Failed', 'error'); }
  }

  async function saveComment(em, comment) {
    const updated = await api(`/mail-reporter/emails/${em.id}`, { method: 'PATCH', body: JSON.stringify({ solver_comment: comment }) });
    setEmails(prev => prev.map(e => e.id === updated.id ? updated : e));
    showToast('Comment saved');
  }

  const totalPages = Math.ceil(emails.length / PAGE_SIZE);
  const pagedEmails = emails.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const labelStyle = { fontSize: '11px', fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const cellStyle = { padding: '10px 12px', fontSize: '13px', borderBottom: `1px solid ${t.border}`, verticalAlign: 'middle' };
  const headStyle = { ...cellStyle, ...labelStyle, padding: '8px 12px', background: t.background, borderBottom: `1px solid ${t.border}` };

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
            <Button size="sm" onClick={() => { setEditTarget(null); setShowModal(true); }}>{tr('addMailbox')}</Button>
          </div>
        )}
      </div>

      {/* Mailboxes — admin only */}
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
                      <td style={cellStyle}><code style={{ fontSize: '12px', background: t.background, padding: '2px 6px', borderRadius: '4px', border: `1px solid ${t.border}` }}>{mb.subject_filter || 'NONE'}</code></td>
                      <td style={cellStyle}>{mb.telegram_target ? <code style={{ fontSize: '12px' }}>{mb.telegram_target}</code> : <span style={{ color: t.textMuted, fontSize: '12px' }}>global default</span>}</td>
                      <td style={{ ...cellStyle, color: t.textMuted, fontSize: '12px' }}>{fmtSince(mb.last_poll_at)}</td>
                      <td style={cellStyle}>{mb.consecutive_failures > 0 ? <Badge color="red">{mb.consecutive_failures} fail{mb.consecutive_failures !== 1 ? 's' : ''}</Badge> : <Badge color="green">0</Badge>}</td>
                      <td style={cellStyle}>
                        <button onClick={() => toggleEnabled(mb)} style={{ background: mb.enabled ? '#10b981' : t.border, color: mb.enabled ? '#fff' : t.textMuted, border: 'none', borderRadius: '12px', padding: '3px 10px', fontSize: '12px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s' }}>
                          {mb.enabled ? 'ON' : 'OFF'}
                        </button>
                      </td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          <Button size="sm" variant="ghost" onClick={() => testConn(mb)} style={{ fontSize: '11px', padding: '3px 8px' }}>{testResult?.id === mb.id && testResult.message === 'Testing…' ? '…' : '🔌'}</Button>
                          <Button size="sm" variant="secondary" onClick={() => { setEditTarget(mb); setShowModal(true); }} style={{ fontSize: '11px', padding: '3px 8px' }}>Edit</Button>
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

      {/* Email Log */}
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
                  {pagedEmails.map(em => (
                    <tr key={em.id} style={{ opacity: em.skip_reason === 'filter' ? 0.5 : 1, background: em.is_solved ? `${t.success || '#10b981'}08` : (!em.telegram_sent && !em.skip_reason ? `${t.danger}08` : 'transparent') }}>
                      <td style={{ ...cellStyle, fontSize: '11px', color: t.textMuted, whiteSpace: 'nowrap' }}>{fmtTime(em.received_at || em.created_at)}</td>
                      <td style={{ ...cellStyle, fontSize: '12px', fontFamily: 'monospace' }}>{em.mailbox_email || '—'}</td>
                      <td style={{ ...cellStyle, fontSize: '12px', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={em.sender}>{em.sender || '—'}</td>
                      <td style={{ ...cellStyle, maxWidth: '200px' }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={em.subject}>{em.subject || '—'}</div>
                        {em.solver_comment && <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '2px', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={em.solver_comment}>💬 {em.solver_comment}</div>}
                      </td>
                      <td style={cellStyle}><Badge color={CATEGORY_COLORS[em.category] || 'gray'}>{CATEGORY_LABELS[em.category] || em.category}</Badge></td>
                      <td style={cellStyle}>{em.skip_reason ? <Badge color="gray">{em.skip_reason}</Badge> : em.telegram_sent ? <Badge color="green">✓</Badge> : <Badge color="red">✗</Badge>}</td>
                      <td style={cellStyle}>{em.extracted_code ? <code style={{ background: t.background, padding: '2px 6px', borderRadius: '4px', fontSize: '13px', fontWeight: 700, border: `1px solid ${t.border}` }}>{em.extracted_code}</code> : <span style={{ color: t.border }}>—</span>}</td>
                      <td style={cellStyle}>
                        {em.is_solved
                          ? <Badge color="green">✓ Solved</Badge>
                          : <Badge color="yellow">Unchecked</Badge>}
                      </td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={() => toggleSolved(em)} title={em.is_solved ? 'Mark as unsolved' : 'Mark as solved'} style={{ background: em.is_solved ? '#10b981' : t.surfaceAlt, color: em.is_solved ? '#fff' : t.textSecondary, border: `1px solid ${em.is_solved ? '#10b981' : t.border}`, borderRadius: '6px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                            {em.is_solved ? '✓' : '○'}
                          </button>
                          <button onClick={() => setCommentTarget(em)} title="Add comment" style={{ background: t.surfaceAlt, color: t.textSecondary, border: `1px solid ${t.border}`, borderRadius: '6px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer' }}>
                            💬
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
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

      {showModal && <MailboxModal mailbox={editTarget} onClose={() => { setShowModal(false); setEditTarget(null); }} onSave={onSaved} />}
      {confirmDelete && (
        <Overlay onClose={() => setConfirmDelete(null)} title="Delete Mailbox">
          <p style={{ margin: '0 0 16px', fontSize: '14px' }}>Delete <strong>{confirmDelete.email}</strong>? This also removes all email logs for this mailbox.</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>{tr('cancel')}</Button>
            <Button variant="danger" onClick={() => doDelete(confirmDelete.id)}>Delete</Button>
          </div>
        </Overlay>
      )}
      {commentTarget && <CommentModal email={commentTarget} onClose={() => setCommentTarget(null)} onSave={c => saveComment(commentTarget, c)} />}
    </div>
  );
}
