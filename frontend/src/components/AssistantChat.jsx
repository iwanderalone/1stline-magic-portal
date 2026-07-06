import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { useLang } from './LangContext';
import { Icon } from './Icons';

export default function AssistantChat() {
  const { t: tr } = useLang();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);   // {role: 'user'|'model', text}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    api('/assistant/status').then(d => setEnabled(!!d?.enabled)).catch(() => {});
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy, open]);

  if (!enabled) return null;

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError('');
    const next = [...messages, { role: 'user', text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await api('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: next.slice(-16) }),
      });
      setMessages(prev => [...prev, { role: 'model', text: res.reply || '…' }]);
    } catch (e) {
      setError(e.message || 'Assistant error');
      setMessages(prev => prev.slice(0, -1));   // put the question back in the box
      setInput(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* floating toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        title={tr('aiTitle')}
        style={{
          position: 'fixed', right: 22, bottom: 22, zIndex: 900,
          width: 52, height: 52, borderRadius: '50%',
          background: 'var(--accent)', color: '#fff', border: 'none',
          boxShadow: 'var(--shadow-lg)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon name={open ? 'x' : 'zap'} size={22} color="#fff" />
      </button>

      {/* chat panel */}
      {open && (
        <div style={{
          position: 'fixed', right: 22, bottom: 86, zIndex: 900,
          width: 'min(380px, calc(100vw - 44px))', height: 'min(520px, calc(100vh - 130px))',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* header */}
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-alt)',
          }}>
            <Icon name="zap" size={15} color="var(--accent)" />
            <span style={{ fontWeight: 700, fontSize: 14 }}>{tr('aiTitle')}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{tr('aiScope')}</span>
          </div>

          {/* messages */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {tr('aiHello')}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '88%', padding: '8px 12px', fontSize: 13, lineHeight: 1.5,
                borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                background: m.role === 'user' ? 'var(--accent)' : 'var(--surface-alt)',
                color: m.role === 'user' ? '#fff' : 'var(--text)',
                border: m.role === 'user' ? 'none' : '1px solid var(--border-light)',
              }}>{m.text}</div>
            ))}
            {busy && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('aiThinking')}</div>}
            {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
          </div>

          {/* input */}
          <form
            onSubmit={e => { e.preventDefault(); send(); }}
            style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={tr('aiPlaceholder')}
              style={{
                flex: 1, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit',
                background: 'var(--surface-alt)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text)', outline: 'none',
              }}
            />
            <button type="submit" disabled={busy || !input.trim()} style={{
              border: 'none', background: 'var(--accent)', color: '#fff',
              borderRadius: 'var(--radius-sm)', padding: '0 14px', cursor: 'pointer',
              opacity: busy || !input.trim() ? 0.5 : 1,
              display: 'flex', alignItems: 'center',
            }}>
              <Icon name="send" size={15} color="#fff" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
