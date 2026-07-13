import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { Button, Badge, Toast, EmptyState } from '../components/UI';
import { Icon } from '../components/Icons';
import { useLang } from '../components/LangContext';

const RUNNING = ['queued', 'running'];

function human(n) {
  if (n == null) return '—';
  let v = Number(n);
  for (const u of ['B', 'KiB', 'MiB', 'GiB']) {
    if (v < 1024) return `${v.toFixed(1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} TiB`;
}

function duration(a, b) {
  if (!a || !b) return '—';
  const sec = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m}m ${sec % 60}s`;
}

const STATUS_COLOR = { success: 'green', failed: 'red', running: 'blue', queued: 'gray' };

function ProgressBar({ job, tr }) {
  const phaseKey = {
    connecting: 'toolPhConnecting', listing: 'toolPhListing', fetching: 'toolPhFetching',
    archiving: 'toolPhArchiving', uploading: 'toolPhUploading', verifying: 'toolPhVerifying',
    mbox: 'toolPhMbox', queued: 'toolPhQueued',
  }[job.phase] || null;
  // fetching has a real total; later phases show an indeterminate sweep
  const determinate = job.phase === 'fetching' && job.messages_total > 0;
  const pct = determinate ? Math.min(100, Math.round((job.messages_done / job.messages_total) * 100)) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
        <span>
          {phaseKey ? tr(phaseKey) : job.phase}
          {job.current_folder ? ` — ${job.current_folder}` : ''}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>
          {determinate
            ? `${job.messages_done}/${job.messages_total} · ${pct}%`
            : (job.messages_total ? `${job.messages_total} msg` : '')}
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--surface-sunken)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
        {determinate ? (
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.5s' }} />
        ) : (
          <div className="tool-indeterminate" style={{
            position: 'absolute', width: '35%', height: '100%',
            background: 'var(--accent)', borderRadius: 4, opacity: 0.7,
            animation: 'toolSweep 1.4s ease-in-out infinite',
          }} />
        )}
      </div>
      <style>{`@keyframes toolSweep { 0% { left: -35%; } 100% { left: 100%; } }`}</style>
    </div>
  );
}

function JobRow({ job, tr }) {
  const [open, setOpen] = useState(false);
  const active = RUNNING.includes(job.status);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', background: 'var(--surface-alt)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <Badge color={STATUS_COLOR[job.status] || 'gray'}>{tr(`toolSt_${job.status}`) || job.status}</Badge>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{job.email}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {job.requested_by} · {new Date(job.created_at).toLocaleString()}
        </span>
        <span style={{ display: 'flex', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <Icon name="chevronDown" size={13} />
        </span>
      </div>
      {active && <ProgressBar job={job} tr={tr} />}
      {job.status === 'failed' && (
        <div style={{ fontSize: 12, color: 'var(--danger)', whiteSpace: 'pre-wrap' }}>{job.error}</div>
      )}
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>
          <span className="t-eyebrow">{tr('toolMessages')}</span>
          <span>{job.messages_done ?? '—'}{job.messages_total ? ` / ${job.messages_total}` : ''} ({job.folders_total ?? '—'} {tr('toolFolders')})</span>
          <span className="t-eyebrow">{tr('toolArchive')}</span>
          <span>{human(job.archive_size)}{job.mbox_count ? ` · ${job.mbox_count} mbox` : ''}</span>
          <span className="t-eyebrow">SHA-256</span>
          <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{job.sha256 || '—'}</span>
          <span className="t-eyebrow">S3</span>
          <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{job.s3_url || '—'}</span>
          <span className="t-eyebrow">{tr('toolDuration')}</span>
          <span>{duration(job.started_at, job.finished_at)}</span>
        </div>
      )}
    </div>
  );
}

function parseBatch(text) {
  // One mailbox per line: "email:password" or "email password". '#' starts a comment.
  const entries = [];
  const errors = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.split('#')[0].trim();
    if (!line) return;
    const m = line.match(/^(\S+@\S+\.\S+)[\s:]+(.+)$/);
    if (!m) { errors.push(i + 1); return; }
    entries.push({ email: m[1], password: m[2].trim() });
  });
  return { entries, errors };
}

export default function ToolsPage() {
  const { t: tr } = useLang();
  const [enabled, setEnabled] = useState(null);   // null = loading
  const [mode, setMode] = useState('single');     // single | batch
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [batchText, setBatchText] = useState('');
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    api('/tools/status').then(d => setEnabled(!!d?.mailbox_backup)).catch(() => setEnabled(false));
  }, []);

  const loadJobs = useCallback(async () => {
    try { setJobs(await api('/tools/mailbox-backup/jobs')); } catch { /* keep last */ }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Poll fast while any job is active, slow otherwise
  useEffect(() => {
    const anyActive = jobs.some(j => RUNNING.includes(j.status));
    clearInterval(pollRef.current);
    pollRef.current = setInterval(loadJobs, anyActive ? 2000 : 30000);
    return () => clearInterval(pollRef.current);
  }, [jobs, loadJobs]);

  const batchParsed = mode === 'batch' ? parseBatch(batchText) : null;
  const canSubmit = mode === 'single'
    ? !!(email.trim() && password)
    : !!(batchParsed && batchParsed.entries.length > 0 && batchParsed.errors.length === 0);

  const start = async (e) => {
    e.preventDefault();
    if (busy || !canSubmit) return;
    const entries = mode === 'single'
      ? [{ email: email.trim(), password }]
      : batchParsed.entries;
    setBusy(true);
    try {
      await api('/tools/mailbox-backup', {
        method: 'POST',
        body: JSON.stringify({ entries }),
      });
      setPassword('');
      setBatchText('');
      setToast({ message: tr('toolStarted'), type: 'success' });
      await loadJobs();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    padding: '9px 12px', fontSize: 13, fontFamily: 'inherit',
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text)', outline: 'none',
  };

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{tr('toolMailboxBackup')}</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>{tr('toolMbSubtitle')}</p>
      </div>

      {enabled === false && (
        <EmptyState icon={<Icon name="archive" size={40} />} title={tr('toolNotConfigured')} subtitle={tr('toolNotConfiguredDesc')} />
      )}

      {enabled && (
        <>
          <form onSubmit={start} style={{
            display: 'flex', flexDirection: 'column', gap: 12, padding: 18,
            border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-alt)',
          }}>
            {/* mode toggle */}
            <div style={{ display: 'flex', background: 'var(--surface-sunken)', padding: 2, borderRadius: 'var(--radius-sm)', alignSelf: 'flex-start' }}>
              {['single', 'batch'].map(m => (
                <button key={m} type="button" onClick={() => setMode(m)} style={{
                  border: 'none', background: mode === m ? 'var(--surface)' : 'transparent',
                  color: mode === m ? 'var(--text)' : 'var(--text-muted)',
                  padding: '5px 14px', fontSize: 12, fontWeight: 700,
                  borderRadius: 'var(--radius-xs)', cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: mode === m ? 'var(--shadow-xs)' : 'none',
                }}>
                  {tr(m === 'single' ? 'toolModeSingle' : 'toolModeBatch')}
                </button>
              ))}
            </div>

            {mode === 'single' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label className="t-eyebrow">{tr('toolEmailLbl')}</label>
                  <input value={email} onChange={e => setEmail(e.target.value)} placeholder="user@viory.video" style={inputStyle} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label className="t-eyebrow">{tr('toolPasswordLbl')}</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" style={inputStyle} />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="t-eyebrow">{tr('toolBatchLbl')}</label>
                <textarea
                  value={batchText}
                  onChange={e => setBatchText(e.target.value)}
                  rows={6}
                  placeholder={'user1@viory.video:app-password-1\nuser2@viory.video:app-password-2'}
                  spellCheck={false}
                  style={{ ...inputStyle, fontFamily: 'var(--font-mono)', resize: 'vertical', lineHeight: 1.6 }}
                />
                <div style={{ fontSize: 12, color: batchParsed?.errors.length ? 'var(--danger)' : 'var(--text-muted)' }}>
                  {batchParsed?.errors.length
                    ? `${tr('toolBatchBadLines')}: ${batchParsed.errors.join(', ')}`
                    : `${batchParsed?.entries.length || 0} ${tr('toolBatchParsed')}`}
                </div>
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('toolMbHint')}</div>
            <div>
              <Button type="submit" variant="primary" disabled={busy || !canSubmit} icon="archive">
                {mode === 'batch' && batchParsed?.entries.length > 1
                  ? `${tr('toolStartBackup')} (${batchParsed.entries.length})`
                  : tr('toolStartBackup')}
              </Button>
            </div>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="t-eyebrow">{tr('toolJobs')} ({jobs.length})</div>
            {jobs.length === 0
              ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tr('toolNoJobs')}</div>
              : jobs.map(j => <JobRow key={j.id} job={j} tr={tr} />)}
          </div>
        </>
      )}
    </div>
  );
}
