import { useState } from 'react';
import { api } from '../../../api';
import { Badge, Button, Card, Input } from '../../../components/UI';
import { useLang } from '../../../components/LangContext';
import { categoryColor } from './shared';

// Fallbacks the server relies on — they can be renamed, never archived.
const FIXED = ['hardware', 'other'];

// Categories, budgets (departments) and payment cards. None is ever deleted —
// history points at them — they are switched off instead.
export default function SettingsTab({ lookups, onChanged, onToast }) {
  const { t: tr } = useLang();
  const [dept, setDept] = useState('');
  const [card, setCard] = useState({ label: '', last4: '', holder: '' });
  const [editingCard, setEditingCard] = useState(null);
  const [cat, setCat] = useState({ name: '', name_ru: '' });
  const [editingCat, setEditingCat] = useState(null);

  const run = async (fn, ok) => {
    try {
      await fn();
      onChanged();
      if (ok) onToast({ message: ok, type: 'success' });
      return true;
    } catch (err) {
      onToast({ message: err.message, type: 'error' });
      return false;
    }
  };

  const addDept = (e) => {
    e.preventDefault();
    if (!dept.trim()) return;
    run(() => api('/purchases/departments', { method: 'POST', body: JSON.stringify({ name: dept.trim() }) }), tr('purSaved'))
      .then(ok => ok && setDept(''));
  };
  const toggleDept = (d) => run(() => api(`/purchases/departments/${d.id}`, {
    method: 'PATCH', body: JSON.stringify({ name: d.name, is_active: !d.is_active }),
  }));
  const renameDept = (d) => {
    const name = window.prompt(tr('purRename'), d.name);
    if (!name || name.trim() === d.name) return;
    run(() => api(`/purchases/departments/${d.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim(), is_active: d.is_active }) }));
  };

  const saveCard = (e) => {
    e.preventDefault();
    const payload = { label: card.label.trim(), last4: card.last4.trim() || null, holder: card.holder.trim() || null,
      is_active: editingCard ? editingCard.is_active : true };
    const req = editingCard
      ? api(`/purchases/cards/${editingCard.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : api('/purchases/cards', { method: 'POST', body: JSON.stringify(payload) });
    run(() => req, tr('purSaved')).then(ok => { if (ok) { setCard({ label: '', last4: '', holder: '' }); setEditingCard(null); } });
  };
  const toggleCard = (c) => run(() => api(`/purchases/cards/${c.id}`, {
    method: 'PATCH', body: JSON.stringify({ label: c.label, last4: c.last4, holder: c.holder, notes: c.notes, is_active: !c.is_active }),
  }));

  const saveCat = (e) => {
    e.preventDefault();
    const payload = { name: cat.name.trim(), name_ru: cat.name_ru.trim() || null,
      is_active: editingCat ? editingCat.is_active : true };
    const req = editingCat
      ? api(`/purchases/categories/${editingCat.key}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : api('/purchases/categories', { method: 'POST', body: JSON.stringify(payload) });
    run(() => req, tr('purSaved')).then(ok => { if (ok) { setCat({ name: '', name_ru: '' }); setEditingCat(null); } });
  };
  const toggleCat = (c) => run(() => api(`/purchases/categories/${c.key}`, {
    method: 'PATCH', body: JSON.stringify({ name: c.name, name_ru: c.name_ru, is_active: !c.is_active }),
  }));

  const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--border-light)', fontSize: 13 };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', alignItems: 'start', gap: 16 }}>
      <Card header={tr('purCategories')} padding="12px 18px">
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{tr('purCategoriesHint')}</div>
        {lookups.meta.categories.map(c => (
          <div key={c.key} style={{ ...row, opacity: c.is_active ? 1 : 0.55 }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: categoryColor(c.key), flexShrink: 0 }} />
            <span style={{ flex: 1 }}>
              {c.name}{c.name_ru && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> · {c.name_ru}</span>}
            </span>
            {!c.is_active && <Badge color="gray">{tr('purArchived')}</Badge>}
            <Button size="sm" variant="ghost" icon="edit" title={tr('edit')}
              onClick={() => { setEditingCat(c); setCat({ name: c.name, name_ru: c.name_ru || '' }); }} />
            {!FIXED.includes(c.key) && (
              <Button size="sm" variant="ghost" onClick={() => toggleCat(c)}>{c.is_active ? tr('purArchive') : tr('purRestore')}</Button>
            )}
          </div>
        ))}
        <form onSubmit={saveCat} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
          <Input label={tr('purCategoryName')} value={cat.name} onChange={e => setCat(c => ({ ...c, name: e.target.value }))} required placeholder="Internet" />
          <Input label={tr('purCategoryNameRu')} value={cat.name_ru} onChange={e => setCat(c => ({ ...c, name_ru: e.target.value }))} placeholder="Интернет" />
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {editingCat && <Button type="button" variant="ghost" onClick={() => { setEditingCat(null); setCat({ name: '', name_ru: '' }); }}>{tr('cancel')}</Button>}
            <Button type="submit" variant="secondary" icon={editingCat ? 'check' : 'plus'}>{editingCat ? tr('save') : tr('purAdd')}</Button>
          </div>
        </form>
      </Card>

      <Card header={tr('purBudgets')} padding="12px 18px">
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{tr('purBudgetsHint')}</div>
        {lookups.departments.map(d => (
          <div key={d.id} style={{ ...row, opacity: d.is_active ? 1 : 0.55 }}>
            <span style={{ flex: 1 }}>{d.name}</span>
            {!d.is_active && <Badge color="gray">{tr('purArchived')}</Badge>}
            <Button size="sm" variant="ghost" icon="edit" onClick={() => renameDept(d)} title={tr('purRename')} />
            <Button size="sm" variant="ghost" onClick={() => toggleDept(d)}>{d.is_active ? tr('purArchive') : tr('purRestore')}</Button>
          </div>
        ))}
        <form onSubmit={addDept} style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}><Input value={dept} onChange={e => setDept(e.target.value)} placeholder={tr('purNewBudget')} /></div>
          <Button type="submit" variant="secondary" icon="plus">{tr('purAdd')}</Button>
        </form>
      </Card>

      <Card header={tr('purCards')} padding="12px 18px">
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{tr('purCardsHint')}</div>
        {lookups.cards.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tr('purNoCards')}</div>}
        {lookups.cards.map(c => (
          <div key={c.id} style={{ ...row, opacity: c.is_active ? 1 : 0.55 }}>
            <span style={{ flex: 1 }}>
              <b>{c.label}</b>{c.last4 && <span style={{ fontFamily: 'var(--font-mono)' }}> ••{c.last4}</span>}
              {c.holder && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> · {c.holder}</span>}
            </span>
            {!c.is_active && <Badge color="gray">{tr('purArchived')}</Badge>}
            <Button size="sm" variant="ghost" icon="edit" title={tr('edit')}
              onClick={() => { setEditingCard(c); setCard({ label: c.label, last4: c.last4 || '', holder: c.holder || '' }); }} />
            <Button size="sm" variant="ghost" onClick={() => toggleCard(c)}>{c.is_active ? tr('purArchive') : tr('purRestore')}</Button>
          </div>
        ))}
        <form onSubmit={saveCard} style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 1fr', gap: 8, marginTop: 12 }}>
          <Input label={tr('purCardLabel')} value={card.label} onChange={e => setCard(c => ({ ...c, label: e.target.value }))} required placeholder="Corporate Visa" />
          <Input label={tr('purCardLast4')} value={card.last4} maxLength={4} inputMode="numeric" pattern="\d{4}"
            onChange={e => setCard(c => ({ ...c, last4: e.target.value.replace(/\D/g, '') }))} placeholder="4821" />
          <Input label={tr('purCardHolder')} value={card.holder} onChange={e => setCard(c => ({ ...c, holder: e.target.value }))} />
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {editingCard && <Button type="button" variant="ghost" onClick={() => { setEditingCard(null); setCard({ label: '', last4: '', holder: '' }); }}>{tr('cancel')}</Button>}
            <Button type="submit" variant="secondary" icon={editingCard ? 'check' : 'plus'}>{editingCard ? tr('save') : tr('purAdd')}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
