import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { useLang } from './LangContext';
import { Icon } from './Icons';

const CAT = '=^.^=';

/* ─── Tiny markdown renderer (bold / italic / code / lists / headers) ── */

function renderInline(text, keyBase) {
  // Split on **bold**, *italic*, `code` — order matters (bold before italic).
  const parts = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      parts.push(<b key={`${keyBase}-${i++}`}>{tok.slice(2, -2)}</b>);
    } else if (tok.startsWith('`')) {
      parts.push(
        <code key={`${keyBase}-${i++}`} style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.92em',
          background: 'var(--surface-sunken)', padding: '1px 5px',
          borderRadius: 4, border: '1px solid var(--border-light)',
        }}>{tok.slice(1, -1)}</code>
      );
    } else {
      parts.push(<i key={`${keyBase}-${i++}`}>{tok.slice(1, -1)}</i>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Markdown({ text }) {
  const blocks = [];
  const lines = (text || '').split('\n');
  let list = null;   // { ordered, items }
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`l${key++}`} style={{ margin: '2px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {list.items.map((it, i) => <li key={i}>{renderInline(it, `li${key}-${i}`)}</li>)}
      </Tag>
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const header = line.match(/^\s*#{1,4}\s+(.*)$/);

    if (bullet || ordered) {
      const isOrdered = !!ordered;
      const item = (bullet || ordered)[1];
      if (!list || list.ordered !== isOrdered) { flushList(); list = { ordered: isOrdered, items: [] }; }
      list.items.push(item);
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    if (header) {
      blocks.push(<div key={`h${key++}`} style={{ fontWeight: 700, marginTop: 2 }}>{renderInline(header[1], `h${key}`)}</div>);
    } else {
      blocks.push(<div key={`p${key++}`}>{renderInline(line, `p${key}`)}</div>);
    }
  }
  flushList();
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{blocks}</div>;
}

/* ─── Chat ──────────────────────────────────────────────── */

function CatAvatar({ size = 30 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'var(--accent-light)', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-mono)', fontSize: size * 0.32, color: 'var(--accent)',
      fontWeight: 700, letterSpacing: '-0.05em', userSelect: 'none',
    }}>{CAT}</div>
  );
}

function Bubble({ from, children }) {
  const user = from === 'user';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexDirection: user ? 'row-reverse' : 'row' }}>
      {!user && <CatAvatar />}
      <div style={{
        maxWidth: '82%', padding: '9px 13px', fontSize: 13, lineHeight: 1.55,
        wordBreak: 'break-word',
        borderRadius: user ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        background: user ? 'var(--accent)' : 'var(--surface-alt)',
        color: user ? '#fff' : 'var(--text)',
        border: user ? 'none' : '1px solid var(--border-light)',
      }}>{children}</div>
    </div>
  );
}

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
          width: 54, height: 54, borderRadius: '50%',
          background: 'var(--accent)', color: '#fff', border: 'none',
          boxShadow: 'var(--shadow-lg)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, letterSpacing: '-0.05em',
        }}
      >
        {open ? <Icon name="x" size={22} color="#fff" /> : CAT}
      </button>

      {/* chat panel */}
      {open && (
        <div style={{
          position: 'fixed', right: 22, bottom: 88, zIndex: 900,
          width: 'min(390px, calc(100vw - 44px))', height: 'min(540px, calc(100vh - 132px))',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* header */}
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-alt)',
          }}>
            <CatAvatar size={34} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>{tr('aiTitle')}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{tr('aiScope')}</div>
            </div>
          </div>

          {/* messages */}
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Bubble from="model"><Markdown text={tr('aiHello')} /></Bubble>
            {messages.map((m, i) => (
              <Bubble key={i} from={m.role === 'user' ? 'user' : 'model'}>
                {m.role === 'user' ? m.text : <Markdown text={m.text} />}
              </Bubble>
            ))}
            {busy && (
              <Bubble from="model">
                <span style={{ color: 'var(--text-muted)' }}>{tr('aiThinking')}</span>
              </Bubble>
            )}
            {error && <div style={{ fontSize: 12, color: 'var(--danger)', paddingLeft: 38 }}>{error}</div>}
          </div>

          {/* input — auto-growing textarea, Enter sends, Shift+Enter = newline */}
          <form
            onSubmit={e => { e.preventDefault(); send(); }}
            style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)', alignItems: 'flex-end' }}
          >
            <textarea
              value={input}
              rows={1}
              onChange={e => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 110) + 'px';
              }}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                if (e.shiftKey) {
                  // insert newline explicitly — some browsers/layouts swallow the default
                  e.preventDefault();
                  const el = e.target;
                  const { selectionStart: a, selectionEnd: b, value } = el;
                  const next = value.slice(0, a) + '\n' + value.slice(b);
                  setInput(next);
                  requestAnimationFrame(() => {
                    el.selectionStart = el.selectionEnd = a + 1;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 110) + 'px';
                  });
                } else {
                  e.preventDefault();
                  send();
                  e.target.style.height = 'auto';
                }
              }}
              placeholder={tr('aiPlaceholder')}
              style={{
                flex: 1, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit',
                background: 'var(--surface-alt)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text)', outline: 'none',
                resize: 'none', lineHeight: 1.45, maxHeight: 110, overflowY: 'auto',
              }}
            />
            <button type="submit" disabled={busy || !input.trim()} style={{
              border: 'none', background: 'var(--accent)', color: '#fff',
              borderRadius: 'var(--radius-sm)', padding: '9px 14px', cursor: 'pointer',
              opacity: busy || !input.trim() ? 0.5 : 1,
              display: 'flex', alignItems: 'center', flexShrink: 0,
            }}>
              <Icon name="send" size={15} color="#fff" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
