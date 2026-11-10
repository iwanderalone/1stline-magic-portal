import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../api';
import { Button, Badge, Toast, EmptyState, PageHeader } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useLang } from '../../components/LangContext';

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

function formatEta(sec) {
  if (sec < 60) return '< 1m';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ETA from the average rate so far (messages or bytes, whichever the phase
// tracks) — noisy early on, so we only show it once there's enough data to
// be meaningful.
function computeEta(done, total, startedAt, minDone) {
  if (!startedAt || !total || !done || done < minDone) return null;
  const elapsedSec = (Date.now() - new Date(startedAt)) / 1000;
  if (elapsedSec < 8) return null;
  const remaining = total - done;
  if (remaining <= 0) return null;
  const rate = done / elapsedSec;
  if (rate <= 0) return null;
  return formatEta(remaining / rate);
}

const STATUS_COLOR = { failed: 'red', running: 'gray', queued: 'gray', canceled: 'gray' };

// "8 Oct 2026, 01:59" — no seconds.
const fmtJobTime = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};
const BYTE_PHASES = ['downloading', 'archiving', 'hashing', 'uploading'];

function ProgressBar({ job, tr }) {
  const phaseKey = {
    connecting: 'toolPhConnecting', listing: 'toolPhListing', fetching: 'toolPhFetching', downloading: 'toolPhDownloading',
    reconnecting: 'toolPhReconnecting',
    archiving: 'toolPhArchiving', hashing: 'toolPhHashing', uploading: 'toolPhUploading',
    verifying: 'toolPhVerifying', mbox: 'toolPhMbox', queued: 'toolPhQueued',
  }[job.phase] || null;
  // fetching tracks messages; archiving/hashing/uploading track bytes; other
  // phases (listing, verifying, mbox) show an indeterminate sweep.
  const isMsgPhase = job.phase === 'fetching' && job.messages_total > 0;
  const isBytePhase = BYTE_PHASES.includes(job.phase) && job.bytes_total > 0;
  const determinate = isMsgPhase || isBytePhase;
  const done = isMsgPhase ? job.messages_done : job.bytes_done;
  const total = isMsgPhase ? job.messages_total : job.bytes_total;
  const pct = determinate ? Math.min(100, Math.round((done / total) * 100)) : null;
  const eta = determinate ? computeEta(done, total, job.started_at, isMsgPhase ? 20 : 1) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
        <span>
          {phaseKey ? tr(phaseKey) : job.phase}
          {job.current_folder ? ` — ${job.current_folder}` : ''}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>
          {determinate
            ? `${isMsgPhase ? done : human(done)}/${isMsgPhase ? total : human(total)} · ${pct}%${eta ? ` · ${tr('toolEtaLbl')} ${eta}` : ''}`
            : (job.messages_total ? `${job.messages_total} ${job.kind === 'disk' ? tr('toolFiles').toLowerCase() : 'msg'}` : '')}
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

// What happens / happened to the employee's Yandex 360 account around the backup.
function AccountLine({ job, tr }) {
  const r = job.account_result;
  let text, color = 'var(--text-muted)';
  if (r === 'blocked') text = tr('toolAccBlocked');
  else if (r && r.startsWith('block failed')) { text = `${tr('toolAccBlockFailed')}: ${r.replace(/^block failed:\s*/, '')}`; color = 'var(--danger)'; }
  else if (r) { text = tr('toolAccLeftActive'); color = 'var(--warning)'; }
  else if (RUNNING.includes(job.status) && job.account_action === 'restore') text = tr('toolAccWillRestore');
  else if (RUNNING.includes(job.status) && job.account_action === 'block') text = tr('toolAccWillBlock');
  if (!text) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color }}>
      <Icon name="shield" size={12} color={color} />
      <span>{text}</span>
    </div>
  );
}

function JobRow({ job, tr, onCancel, cancelling }) {
  const [open, setOpen] = useState(false);
  const active = RUNNING.includes(job.status);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', background: 'var(--surface-alt)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        {/* Success is the quiet default: a muted check, no pill. */}
        {job.status === 'success'
          ? <Icon name="check" size={13} color="var(--text-muted)" />
          : <Badge color={STATUS_COLOR[job.status] || 'gray'}>{tr(`toolSt_${job.status}`) || job.status}</Badge>}
        <span style={{ fontWeight: 600, fontSize: 13 }}>{job.email}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr(job.kind === 'disk' ? 'toolKindDisk' : 'toolKindMail')}</span>
        <span style={{ flex: 1 }} />
        {active && (
          <Button
            variant="danger" size="sm" disabled={cancelling}
            onClick={(e) => { e.stopPropagation(); onCancel(job); }}
          >
            {tr('toolCancel')}
          </Button>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {job.requested_by} · {fmtJobTime(job.created_at)}
        </span>
        <span style={{ display: 'flex', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <Icon name="chevronDown" size={13} />
        </span>
      </div>
      {active && <ProgressBar job={job} tr={tr} />}
      <AccountLine job={job} tr={tr} />
      {job.status === 'failed' && (
        <div style={{ fontSize: 12, color: 'var(--danger)', whiteSpace: 'pre-wrap' }}>{job.error}</div>
      )}
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>
          {job.kind === 'disk' ? <>
            <span className="t-eyebrow">{tr('toolFiles')}</span>
            <span>{job.messages_done ?? '—'}{job.messages_total ? ` / ${job.messages_total}` : ''}</span>
            {job.skipped > 0 && <>
              <span className="t-eyebrow">{tr('toolSkipped')}</span>
              <span style={{ color: 'var(--warning)' }} title={tr('toolSkippedHint')}>{job.skipped} — {tr('toolSkippedHint')}</span>
            </>}
          </> : <>
            <span className="t-eyebrow">{tr('toolMessages')}</span>
            <span>{job.messages_done ?? '—'}{job.messages_total ? ` / ${job.messages_total}` : ''} ({job.folders_total ?? '—'} {tr('toolFolders')})</span>
          </>}
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
  // Logins or addresses, one per line (commas and spaces work too). '#' starts a comment.
  const logins = [];
  const errors = [];
  text.split('\n').forEach((raw, i) => {
    raw.split('#')[0].split(/[\s,;]+/).filter(Boolean).forEach(tok => {
      if (/^[^\s@:]+(@[^\s@:]+\.[^\s@:]+)?$/.test(tok)) logins.push(tok);
      else errors.push(i + 1);
    });
  });
  return { logins: [...new Set(logins)], errors: [...new Set(errors)] };
}

export default function MailboxBackupPanel() {
  const { t: tr } = useLang();
  const [enabled, setEnabled] = useState(null);   // null = loading
  const [doMail, setDoMail] = useState(true);
  const [doDisk, setDoDisk] = useState(false);
  const [blockAfter, setBlockAfter] = useState(() => {
    try { return localStorage.getItem('mbBlockAfter') !== '0'; } catch { return true; }
  });
  const toggleBlock = (on) => {
    setBlockAfter(on);
    try { localStorage.setItem('mbBlockAfter', on ? '1' : '0'); } catch { /* per-browser nicety only */ }
  };
  const [batchText, setBatchText] = useState('');
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const [failedCount, setFailedCount] = useState(0);
  const [showFailed, setShowFailed] = useState(() => {
    try { return localStorage.getItem('mbShowFailed') !== '0'; } catch { return true; }
  });
  const [busy, setBusy] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [toast, setToast] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    api('/tools/status').then(d => setEnabled(!!d?.mailbox_backup)).catch(() => setEnabled(false));
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const d = await api(`/tools/mailbox-backup/jobs?page=${page}&page_size=${PAGE_SIZE}&show_failed=${showFailed}`);
      setJobs(d.items);
      setTotal(d.total);
      setFailedCount(d.failed ?? 0);
    } catch { /* keep last */ }
  }, [page, showFailed]);

  const toggleFailed = (on) => {
    setShowFailed(on);
    setPage(1);
    try { localStorage.setItem('mbShowFailed', on ? '1' : '0'); } catch { /* per-browser nicety only */ }
  };

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Poll fast while any job is active, slow otherwise
  useEffect(() => {
    const anyActive = jobs.some(j => RUNNING.includes(j.status));
    clearInterval(pollRef.current);
    pollRef.current = setInterval(loadJobs, anyActive ? 2000 : 30000);
    return () => clearInterval(pollRef.current);
  }, [jobs, loadJobs]);

  const parsed = parseBatch(batchText);
  const canSubmit = parsed.logins.length > 0 && parsed.errors.length === 0 && (doMail || doDisk);

  const start = async (e) => {
    e.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    try {
      await api('/tools/mailbox-backup', {
        method: 'POST',
        body: JSON.stringify({ logins: parsed.logins, mail: doMail, disk: doDisk, block_after: blockAfter }),
      });
      setBatchText('');
      setToast({ message: tr('toolStarted'), type: 'success' });
      if (page !== 1) setPage(1); else await loadJobs();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const cancelJob = async (job) => {
    if (cancellingId) return;
    if (!window.confirm(tr('toolCancelConfirm').replace('{email}', job.email))) return;
    setCancellingId(job.id);
    try {
      await api(`/tools/mailbox-backup/jobs/${job.id}/cancel`, { method: 'POST' });
      setToast({ message: tr('toolCanceled'), type: 'success' });
      await loadJobs();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setCancellingId(null);
    }
  };

  const inputStyle = {
    padding: '9px 12px', fontSize: 13, fontFamily: 'inherit',
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text)', outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <PageHeader title={tr('toolMailboxBackup')} subtitle={tr('toolMbSubtitle')} />

      {enabled === false && (
        <EmptyState icon={<Icon name="archive" size={40} />} title={tr('toolNotConfigured')} subtitle={tr('toolNotConfiguredDesc')} />
      )}

      {enabled && (
        <>
          <form onSubmit={start} style={{
            display: 'flex', flexDirection: 'column', gap: 12, padding: 18,
            border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-alt)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label className="t-eyebrow">{tr('toolBatchLbl')}</label>
              <textarea
                value={batchText}
                onChange={e => setBatchText(e.target.value)}
                rows={4}
                placeholder={tr('toolBatchPlaceholder')}
                spellCheck={false}
                autoComplete="off"
                style={{ ...inputStyle, fontFamily: 'var(--font-mono)', resize: 'vertical', lineHeight: 1.6 }}
              />
              <div style={{ fontSize: 12, color: parsed.errors.length ? 'var(--danger)' : 'var(--text-muted)' }}>
                {parsed.errors.length
                  ? `${tr('toolBatchBadLines')}: ${parsed.errors.join(', ')}`
                  : (parsed.logins.length > 0 ? `${parsed.logins.length} ${tr('toolBatchParsed')}` : tr('toolBatchEmpty'))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
              <span className="t-eyebrow" style={{ marginBottom: 0 }}>{tr('toolWhat')}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={doMail} onChange={e => setDoMail(e.target.checked)} />
                {tr('toolKindMail')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={doDisk} onChange={e => setDoDisk(e.target.checked)} />
                {tr('toolKindDisk')}
              </label>
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={blockAfter} onChange={e => toggleBlock(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                {tr('toolBlockAfter')}
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>{tr('toolBlockAfterHint')}</span>
              </span>
            </label>

            <div>
              <Button type="submit" variant="primary" disabled={busy || !canSubmit} icon="archive">
                {(() => {
                  const n = parsed.logins.length * ((doMail ? 1 : 0) + (doDisk ? 1 : 0));
                  return n > 1 ? `${tr('toolStartBackup')} (${n})` : tr('toolStartBackup');
                })()}
              </Button>
            </div>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div className="t-eyebrow">{tr('toolJobs')} ({total})</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={showFailed} onChange={e => toggleFailed(e.target.checked)} />
                {tr('toolShowFailed')}{failedCount > 0 && ` (${failedCount})`}
              </label>
            </div>
            {jobs.length === 0
              ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tr('toolNoJobs')}</div>
              : jobs.map(j => (
                  <JobRow key={j.id} job={j} tr={tr} onCancel={cancelJob} cancelling={cancellingId === j.id} />
                ))}
            {total > PAGE_SIZE && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 6 }}>
                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  {tr('toolPrev')}
                </Button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {tr('toolPageOf').replace('{page}', page).replace('{total}', Math.max(1, Math.ceil(total / PAGE_SIZE)))}
                </span>
                <Button variant="ghost" size="sm" disabled={page >= Math.ceil(total / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}>
                  {tr('toolNext')}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
