import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { Button } from './UI';
import { useLang } from './LangContext';
import { Icon } from './Icons';

function fmt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Sent-reply thread + composer for an ingested email. Sends real SMTP mail. */
export default function EmailReplies({ emailId, sender, mailboxEmail, onError }) {
  const { t: tr } = useLang();
  const [replies, setReplies] = useState([]);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    api(`/mail-reporter/emails/${emailId}/replies`).then(d => setReplies(d || [])).catch(() => {});
  }, [emailId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    if (!window.confirm(`${tr('erConfirm')} ${sender || ''}?`)) return;
    setSending(true);
    try {
      const r = await api(`/mail-reporter/emails/${emailId}/reply`, {
        method: 'POST', body: JSON.stringify({ body }),
      });
      setReplies(prev => [...prev, r]);
      setText('');
      setComposing(false);
    } catch (e) {
      onError?.(e.message || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="t-eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="send" size={11} /> {tr('erTitle')}{replies.length > 0 ? ` (${replies.length})` : ''}
        <span style={{ flex: 1 }} />
        {!composing && (
          <Button size="sm" variant="ghost" icon="send" onClick={() => setComposing(true)}>{tr('erReplyBtn')}</Button>
        )}
      </div>

      {replies.map(r => (
        <div key={r.id} style={{
          border: `1px solid ${r.status === 'failed' ? 'var(--danger)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-sm)', padding: '10px 12px',
          background: 'var(--surface-alt)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4, fontSize: 11 }}>
            <span style={{ fontWeight: 700, color: r.status === 'failed' ? 'var(--danger)' : 'var(--success)' }}>
              {r.status === 'failed' ? `✗ ${tr('mailFailedTag')}` : `↗ ${tr('mailSentTag')}`} · {r.username} → {r.to_addr}
            </span>
            <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmt(r.created_at)}</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.body}</div>
          {r.error && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--danger)' }}>{r.error}</div>}
        </div>
      ))}

      {composing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={tr('erPlaceholder')}
            rows={4}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 13,
              fontFamily: 'inherit', background: 'var(--surface-alt)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              color: 'var(--text)', resize: 'vertical', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
              {tr('erHintFrom')} {mailboxEmail || '…'} {tr('erHintTo')} {sender || '…'}
            </span>
            <Button size="sm" variant="ghost" onClick={() => { setComposing(false); setText(''); }}>{tr('erCancel')}</Button>
            <Button size="sm" icon="send" disabled={sending || !text.trim()} onClick={send}>
              {sending ? tr('erSending') : tr('erSend')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
