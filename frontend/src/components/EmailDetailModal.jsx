import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { Button, Badge, Tag, Overlay, Toast } from './UI';
import { Icon } from './Icons';
import { useLang } from './LangContext';
import EmailReplies from './EmailReplies';

const STATUS_CONFIG = {
  unchecked: { key: 'mailStatusUnchecked', color: 'yellow', icon: 'clock' },
  solved:    { key: 'mailStatusSolved',    color: 'green',  icon: 'checkCircle' },
  on_pause:  { key: 'mailStatusPaused',    color: 'blue',   icon: 'play' },
  blocked:   { key: 'mailStatusBlocked',   color: 'red',    icon: 'alertTriangle' },
};
const STATUS_CYCLE = ['unchecked', 'on_pause', 'blocked', 'solved'];

const COLLAPSED_LINE_COUNT = 12;

export function MessageBody({ body }) {
  const [expanded, setExpanded] = useState(false);
  if (!body) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>(no message body)</div>;
  }
  const lines = body.split('\n');
  const isLong = lines.length > COLLAPSED_LINE_COUNT;
  const shown = expanded || !isLong ? body : lines.slice(0, COLLAPSED_LINE_COUNT).join('\n');
  return (
    <div>
      <div style={{
        fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
        fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
        maxHeight: expanded ? 'none' : 320, overflowY: expanded ? 'visible' : 'auto',
        paddingRight: 4,
      }}>{shown}</div>
      {isLong && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            marginTop: 8, padding: '4px 10px', fontSize: 11, fontWeight: 600,
            background: 'transparent', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-xs)', color: 'var(--text-secondary)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {expanded ? `Collapse · ${lines.length} lines` : `Show full message · ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

export default function EmailDetailModal({ emailId, onClose, onChange }) {
  const { t: tr } = useLang();
  const [email, setEmail] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, cs] = await Promise.all([
        api(`/mail-reporter/emails/${emailId}`),
        api(`/mail-reporter/emails/${emailId}/comments`).catch(() => []),
      ]);
      setEmail(e);
      setComments(cs || []);
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [emailId]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (status) => {
    if (!email || email.status === status || busy) return;
    setBusy(true);
    try {
      const updated = await api(`/mail-reporter/emails/${email.id}`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      });
      setEmail(prev => ({ ...updated, body: prev.body }));
      onChange?.(updated);
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const addComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim() || busy) return;
    setBusy(true);
    try {
      const c = await api(`/mail-reporter/emails/${email.id}/comments`, {
        method: 'POST', body: JSON.stringify({ text: commentText.trim() }),
      });
      setComments(prev => [...prev, c]);
      setCommentText('');
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose} title={loading ? tr('mailLoading') : (email?.subject || '(no subject)')} maxWidth={720}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {loading || !email ? (
        <div style={{ padding: 30, color: 'var(--text-muted)', textAlign: 'center' }}>{tr('mailLoading')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Status cycle */}
          <div style={{ display: 'flex', background: 'var(--surface-sunken)', padding: 2, borderRadius: 'var(--radius-sm)', alignSelf: 'flex-start' }}>
            {STATUS_CYCLE.map(s => {
              const cfg = STATUS_CONFIG[s];
              const active = email.status === s;
              return (
                <button key={s} onClick={() => setStatus(s)} disabled={busy || active}
                  style={{
                    border: 'none', background: active ? 'var(--surface)' : 'transparent',
                    color: active ? `var(--${cfg.color === 'yellow' ? 'warning' : cfg.color === 'red' ? 'danger' : cfg.color === 'green' ? 'success' : 'accent'})` : 'var(--text-muted)',
                    padding: '5px 12px', fontSize: 11, fontWeight: 700,
                    borderRadius: 'var(--radius-xs)', cursor: active ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5,
                    boxShadow: active ? 'var(--shadow-xs)' : 'none', fontFamily: 'inherit',
                  }}>
                  <Icon name={cfg.icon} size={11} /> {tr(cfg.key)}
                </button>
              );
            })}
          </div>

          {/* Meta */}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13 }}>
            <span className="t-eyebrow">{tr('mailFrom')}</span>
            <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{email.sender || '—'}</span>
            <span className="t-eyebrow">{tr('mailMailboxLbl')}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{email.mailbox_email || '—'}</span>
            <span className="t-eyebrow">{tr('mailReceived')}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{new Date(email.received_at || email.created_at).toLocaleString()}</span>
            {email.extracted_code && (<>
              <span className="t-eyebrow">Code</span>
              <Tag>{email.extracted_code}</Tag>
            </>)}
          </div>

          {/* Body */}
          <section style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14 }}>
            <div className="t-eyebrow" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="mail" size={11} /> {tr('mailMessageBody')}
            </div>
            <MessageBody body={email.body} />
          </section>

          {/* Outbound replies */}
          <EmailReplies
            emailId={email.id}
            sender={email.sender}
            mailboxEmail={email.mailbox_email}
            onError={(message) => setToast({ message, type: 'error' })}
          />

          {/* Comments */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="t-eyebrow">{tr('tkComments')} ({comments.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
              {comments.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('mailNoComments')}</div>
              ) : comments.map(c => (
                <div key={c.id} style={{ padding: '8px 10px', background: 'var(--surface-alt)', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-light)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{c.username}</span>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{new Date(c.created_at).toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{c.text}</div>
                </div>
              ))}
            </div>
            <form onSubmit={addComment} style={{ display: 'flex', gap: 8 }}>
              <input
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                placeholder={tr('mailWriteComment')}
                style={{
                  flex: 1, padding: '8px 12px', fontSize: 13, fontFamily: 'inherit',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', color: 'var(--text)',
                }}
              />
              <Button type="submit" size="sm" disabled={!commentText.trim() || busy} icon="send">{tr('mailPostComment')}</Button>
            </form>
          </section>
        </div>
      )}
    </Overlay>
  );
}
