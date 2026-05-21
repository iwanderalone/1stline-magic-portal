import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { Button, Input, Select, Card, Overlay, Toast, EmptyState, Badge } from '../components/UI';
import { Icon } from '../components/Icons';

const CATEGORY_ICONS = {
  access:  'key',
  infra:   'server',
  yandex:  'zap',
  website: 'workspace',
  office:  'inbox',
};

const CATEGORY_LABELS = {
  access:  'Access',
  infra:   'Infra',
  yandex:  'Yandex',
  website: 'Website/CMS',
  office:  'Office',
};

const LANG_OPTIONS = ['shell', 'sql', 'python', 'yaml', 'ini', 'json', 'bash', 'text'];

function EstimatedTime({ steps }) {
  const mins = Math.max(1, Math.round(steps.length * 1.2 + 1));
  return `~${mins} min`;
}

/* ─── Code Block ─────────────────────────────────────────────── */
function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div style={{
      position: 'relative',
      background: 'var(--surface-alt)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      marginTop: 10,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 12px',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'lowercase' }}>
          {lang || 'code'}
        </span>
        <button onClick={copy} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: copied ? 'var(--success)' : 'var(--text-muted)',
          display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 4px',
        }}>
          <Icon name={copied ? 'check' : 'copy'} size={12} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre style={{
        margin: 0,
        padding: '12px 16px',
        fontSize: lang === 'text' ? 13.5 : 12.5,
        lineHeight: 1.7,
        fontFamily: lang === 'text' ? 'var(--font-sans)' : 'var(--font-mono)',
        color: 'var(--text)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>{code}</pre>
    </div>
  );
}

/* ─── Step Item ──────────────────────────────────────────────── */
function StepItem({ step, index }) {
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
      <div style={{
        flexShrink: 0,
        width: 30, height: 30,
        borderRadius: '50%',
        background: 'var(--accent)',
        color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700,
        marginTop: 2,
      }}>
        {index + 1}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)', marginBottom: 4 }}>
          {step.title}
        </div>
        {step.description && (
          <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {step.description}
          </div>
        )}
        {step.code_block && (
          <CodeBlock code={step.code_block} lang={step.code_language} />
        )}
      </div>
    </div>
  );
}

/* ─── Runbook Detail ─────────────────────────────────────────── */
function RunbookDetail({ runbook, isAdmin, onRun, onEdit, onDelete }) {
  const { theme: t } = useTheme();
  const [runDone, setRunDone] = useState(false);

  const handleRun = async () => {
    await onRun(runbook.id);
    setRunDone(true);
    setTimeout(() => setRunDone(false), 2000);
  };

  const fmtDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <div className="fade-in" style={{ height: '100%', overflowY: 'auto', padding: '28px 32px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'var(--accent-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={CATEGORY_ICONS[runbook.category] || 'bookmark'} size={18} color="var(--accent)" />
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {runbook.slug}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: '2px 8px',
          borderRadius: 4, background: 'var(--surface-alt)', border: '1px solid var(--border)',
          color: 'var(--text-secondary)', textTransform: 'lowercase',
        }}>
          {runbook.category}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={onEdit} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 6, borderRadius: 6,
            display: 'flex', alignItems: 'center',
          }} title="Edit">
            <Icon name="edit" size={16} />
          </button>
          {isAdmin && (
            <button onClick={onDelete} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--error)', padding: 6, borderRadius: 6,
              display: 'flex', alignItems: 'center',
            }} title="Delete">
              <Icon name="trash" size={16} />
            </button>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={runDone ? 'check' : 'play'}
            onClick={handleRun}
            style={runDone ? { background: 'var(--success)', borderColor: 'var(--success)' } : {}}
          >
            {runDone ? 'Logged' : 'Run'}
          </Button>
        </div>
      </div>

      {/* Title */}
      <h1 style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 26,
        letterSpacing: '-0.02em',
        margin: '0 0 12px 0',
        color: 'var(--text)',
        lineHeight: 1.25,
      }}>
        {runbook.title}
      </h1>

      {/* Meta */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 8, fontSize: 13, color: 'var(--text-muted)', alignItems: 'center' }}>
        {runbook.owner && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Icon name="user" size={13} />
            Owned by <strong style={{ color: 'var(--text-secondary)', marginLeft: 4 }}>{runbook.owner.display_name}</strong>
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name="clock" size={13} />
          Updated {fmtDate(runbook.updated_at)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name="zap" size={13} />
          {runbook.run_count} {runbook.run_count === 1 ? 'run' : 'runs'}
        </span>
        {runbook.tags?.length > 0 && runbook.tags.map(tag => (
          <span key={tag} style={{
            fontSize: 11, padding: '2px 7px',
            borderRadius: 4, background: 'var(--surface-alt)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}>{tag}</span>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', margin: '20px 0' }} />

      {/* When to use */}
      {runbook.when_to_use && (
        <section style={{ marginBottom: 28 }}>
          <div className="t-eyebrow" style={{ marginBottom: 10 }}>When to use</div>
          <p style={{ fontSize: 14.5, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>
            {runbook.when_to_use}
          </p>
        </section>
      )}

      {/* Procedure */}
      {runbook.steps?.length > 0 && (
        <section>
          <div className="t-eyebrow" style={{ marginBottom: 20 }}>Procedure</div>
          {runbook.steps.map((step, i) => (
            <StepItem key={step.id} step={step} index={i} />
          ))}
        </section>
      )}

      {runbook.steps?.length === 0 && !runbook.when_to_use && (
        <EmptyState icon="bookmark" title="No content yet" subtitle="Edit this runbook to add steps." />
      )}
    </div>
  );
}

/* ─── Step Editor ────────────────────────────────────────────── */
function StepEditor({ steps, onChange }) {
  const addStep = () => onChange([...steps, { order: steps.length + 1, title: '', description: '', code_block: '', code_language: 'shell' }]);
  const removeStep = (i) => onChange(steps.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, order: idx + 1 })));
  const updateStep = (i, field, value) => {
    const next = [...steps];
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };

  return (
    <div>
      <label className="t-eyebrow" style={{ display: 'block', marginBottom: 8 }}>Steps</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {steps.map((s, i) => (
          <div key={i} style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            padding: 12, background: 'var(--surface-alt)',
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%',
                background: 'var(--accent)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>{i + 1}</span>
              <input
                placeholder="Step title"
                value={s.title}
                onChange={e => updateStep(i, 'title', e.target.value)}
                style={{
                  flex: 1, padding: '5px 8px', fontSize: 13,
                  border: '1px solid var(--border)', borderRadius: 4,
                  background: 'var(--surface)', color: 'var(--text)', outline: 'none',
                }}
              />
              <button type="button" onClick={() => removeStep(i)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--error)', padding: 4,
              }}>
                <Icon name="x" size={14} />
              </button>
            </div>
            <textarea
              placeholder="Description (optional)"
              value={s.description || ''}
              onChange={e => updateStep(i, 'description', e.target.value)}
              rows={2}
              style={{
                width: '100%', padding: '6px 8px', fontSize: 12.5,
                border: '1px solid var(--border)', borderRadius: 4,
                background: 'var(--surface)', color: 'var(--text)',
                outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                marginBottom: 6, boxSizing: 'border-box',
              }}
            />
            <textarea
              placeholder="Code block (optional)"
              value={s.code_block || ''}
              onChange={e => updateStep(i, 'code_block', e.target.value)}
              rows={3}
              style={{
                width: '100%', padding: '6px 8px', fontSize: 12,
                border: '1px solid var(--border)', borderRadius: 4,
                background: 'var(--surface)', color: 'var(--text)',
                outline: 'none', resize: 'vertical',
                fontFamily: 'var(--font-mono)', marginBottom: 6,
                boxSizing: 'border-box',
              }}
            />
            {s.code_block && (
              <select
                value={s.code_language || 'shell'}
                onChange={e => updateStep(i, 'code_language', e.target.value)}
                style={{
                  fontSize: 12, padding: '3px 6px',
                  border: '1px solid var(--border)', borderRadius: 4,
                  background: 'var(--surface)', color: 'var(--text)', outline: 'none',
                }}
              >
                {LANG_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            )}
          </div>
        ))}
        <button type="button" onClick={addStep} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', fontSize: 13,
          border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)',
          background: 'none', color: 'var(--text-muted)', cursor: 'pointer',
        }}>
          <Icon name="plus" size={14} />
          Add step
        </button>
      </div>
    </div>
  );
}

/* ─── Runbook Form Modal ─────────────────────────────────────── */
function RunbookModal({ initial, users, onSave, onClose }) {
  const CATEGORIES = ['access', 'infra', 'yandex', 'website', 'office'];
  const [form, setForm] = useState({
    title: initial?.title || '',
    category: initial?.category || 'access',
    when_to_use: initial?.when_to_use || '',
    tags: (initial?.tags || []).join(', '),
    owner_id: initial?.owner?.id || '',
    steps: initial?.steps?.map(s => ({ ...s })) || [],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return setErr('Title is required');
    setSaving(true);
    setErr('');
    try {
      const payload = {
        title: form.title.trim(),
        category: form.category,
        when_to_use: form.when_to_use || null,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        owner_id: form.owner_id || null,
        steps: form.steps.filter(s => s.title.trim()).map((s, i) => ({
          order: i + 1,
          title: s.title.trim(),
          description: s.description || null,
          code_block: s.code_block || null,
          code_language: s.code_language || null,
        })),
      };
      await onSave(payload);
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)',
        width: '100%', maxWidth: 640,
        maxHeight: '90vh', overflowY: 'auto',
        padding: 28,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20 }}>
            {initial ? 'Edit runbook' : 'New runbook'}
          </h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input
            label="Title"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="e.g. PostgreSQL replication lag — triage and recovery"
            required
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              label="Category"
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
              ))}
            </Select>
            <Select
              label="Owner"
              value={form.owner_id}
              onChange={e => setForm(f => ({ ...f, owner_id: e.target.value }))}
            >
              <option value="">— no owner —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
            </Select>
          </div>
          <div>
            <label className="t-eyebrow" style={{ display: 'block', marginBottom: 5 }}>When to use</label>
            <textarea
              value={form.when_to_use}
              onChange={e => setForm(f => ({ ...f, when_to_use: e.target.value }))}
              placeholder="Describe when this runbook should be used…"
              rows={3}
              style={{
                width: '100%', padding: '8px 11px', fontSize: 13,
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-alt)', color: 'var(--text)',
                outline: 'none', resize: 'vertical', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <Input
            label="Tags (comma-separated)"
            value={form.tags}
            onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
            placeholder="e.g. database, p1, postgres"
          />
          <StepEditor steps={form.steps} onChange={steps => setForm(f => ({ ...f, steps }))} />
          {err && <div style={{ fontSize: 13, color: 'var(--error)' }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : (initial ? 'Save changes' : 'Create runbook')}
            </Button>
          </div>
        </form>
      </div>
    </Overlay>
  );
}

/* ─── Main Page ──────────────────────────────────────────────── */
export default function RunbooksPage({ user }) {
  const isAdmin = user?.role === 'admin';

  const [runbooks, setRunbooks] = useState([]);
  const [categories, setCategories] = useState({ total: 0, categories: [] });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);

  const loadRunbooks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeCategory) params.set('category', activeCategory);
      if (search.trim()) params.set('search', search.trim());
      const qs = params.toString();
      const [rbs, cats] = await Promise.all([
        api(`/runbooks/${qs ? '?' + qs : ''}`),
        api('/runbooks/categories'),
      ]);
      setRunbooks(rbs || []);
      setCategories(cats || { total: 0, categories: [] });
      if (!selectedId && rbs?.length > 0) setSelectedId(rbs[0].id);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, search]);

  useEffect(() => { loadRunbooks(); }, [loadRunbooks]);

  useEffect(() => {
    api('/users/').then(d => setUsers(d || [])).catch(() => {});
  }, []);

  const selectedRunbook = runbooks.find(r => r.id === selectedId) || null;

  const handleRun = async (id) => {
    try {
      const res = await api(`/runbooks/${id}/run`, { method: 'POST' });
      setRunbooks(prev => prev.map(r => r.id === id ? { ...r, run_count: res.run_count } : r));
    } catch (e) {
      setToast({ message: e.message, type: 'error' });
    }
  };

  const handleCreate = async (payload) => {
    await api('/runbooks/', { method: 'POST', body: JSON.stringify(payload) });
    setToast({ message: 'Runbook created', type: 'success' });
    setShowCreate(false);
    await loadRunbooks();
  };

  const handleUpdate = async (payload) => {
    await api(`/runbooks/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    setToast({ message: 'Runbook saved', type: 'success' });
    setEditing(null);
    await loadRunbooks();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this runbook?')) return;
    try {
      await api(`/runbooks/${id}`, { method: 'DELETE' });
      setToast({ message: 'Deleted', type: 'info' });
      setSelectedId(null);
      await loadRunbooks();
    } catch (e) {
      setToast({ message: e.message, type: 'error' });
    }
  };

  const allCategories = [
    { name: null, label: 'All runbooks', count: categories.total },
    ...categories.categories.map(c => ({
      name: c.name,
      label: CATEGORY_LABELS[c.name] || c.name,
      count: c.count,
    })),
  ];

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20, flexShrink: 0 }}>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontWeight: 600,
            fontSize: 30, letterSpacing: '-0.02em', margin: 0,
          }}>Runbooks</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>
            {categories.total} playbook{categories.total !== 1 ? 's' : ''} · used {runbooks.reduce((s, r) => s + (r.run_count || 0), 0)} times
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              style={{
                padding: '7px 11px 7px 32px', fontSize: 13,
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                background: 'var(--surface)', color: 'var(--text)', outline: 'none', width: 180,
              }}
            />
          </div>
          <Button variant="primary" size="sm" icon="plus" onClick={() => setShowCreate(true)}>
            New runbook
          </Button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Left: categories + list */}
        <div style={{
          width: 260, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 12,
          overflowY: 'auto',
        }}>
          {/* Category filter */}
          <Card style={{ padding: 8 }}>
            {allCategories.map(cat => (
              <button
                key={cat.name ?? '__all__'}
                onClick={() => { setActiveCategory(cat.name); setSelectedId(null); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 6, border: 'none',
                  background: activeCategory === cat.name ? 'var(--accent-light)' : 'transparent',
                  color: activeCategory === cat.name ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer', fontSize: 13, fontWeight: activeCategory === cat.name ? 600 : 400,
                  textAlign: 'left',
                }}
              >
                <Icon
                  name={cat.name ? (CATEGORY_ICONS[cat.name] || 'bookmark') : 'archive'}
                  size={14}
                  color={activeCategory === cat.name ? 'var(--accent)' : 'var(--text-muted)'}
                />
                <span style={{ flex: 1 }}>{cat.label}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{cat.count}</span>
              </button>
            ))}
          </Card>

          {/* Browse list */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px' }}>
              <span className="t-eyebrow">Browse</span>
              <span className="t-eyebrow" style={{ color: 'var(--text-muted)' }}>{runbooks.length}</span>
            </div>
            {loading ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
            ) : runbooks.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No runbooks found</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {runbooks.map(rb => (
                  <button
                    key={rb.id}
                    onClick={() => setSelectedId(rb.id)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '10px 12px',
                      borderRadius: 8, border: 'none',
                      background: selectedId === rb.id ? 'var(--surface)' : 'transparent',
                      boxShadow: selectedId === rb.id ? 'var(--shadow)' : 'none',
                      borderLeft: selectedId === rb.id ? '3px solid var(--accent)' : '3px solid transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{rb.slug}</span>
                      {rb.run_count > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rb.run_count}×</span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', lineHeight: 1.3, marginBottom: 4 }}>
                      {rb.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {rb.steps?.length || 0} step{rb.steps?.length !== 1 ? 's' : ''} · <EstimatedTime steps={rb.steps || []} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: detail */}
        <Card style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: 0 }}>
          {selectedRunbook ? (
            <RunbookDetail
              runbook={selectedRunbook}
              isAdmin={isAdmin}
              onRun={handleRun}
              onEdit={() => setEditing(selectedRunbook)}
              onDelete={() => handleDelete(selectedRunbook.id)}
            />
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState
                icon="bookmark"
                title="Select a runbook"
                subtitle="Choose a runbook from the list to view its steps."
              />
            </div>
          )}
        </Card>
      </div>

      {/* Modals */}
      {showCreate && (
        <RunbookModal users={users} onSave={handleCreate} onClose={() => setShowCreate(false)} />
      )}
      {editing && (
        <RunbookModal initial={editing} users={users} onSave={handleUpdate} onClose={() => setEditing(null)} />
      )}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
