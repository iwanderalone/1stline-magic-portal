import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import { Badge, Button, Card, Input } from '../../../components/UI';
import { useLang } from '../../../components/LangContext';
import { fmtDate } from './shared';

// "Who has what": every seat grouped per person. The leavers switch asks
// NetBox which of these people the AD sync marked as gone — the list of
// licenses to take back.
export default function PeopleTab({ reloadKey, onOpenSub, onToast }) {
  const { lang, t: tr } = useLang();
  const [q, setQ] = useState('');
  const [leavers, setLeavers] = useState(false);
  const [people, setPeople] = useState(null);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (leavers) p.set('leavers_only', 'true');
    setPeople(null);
    return api(`/purchases/people?${p}`).then(d => setPeople(d || []))
      .catch(err => { setPeople([]); onToast({ message: err.message, type: 'error' }); });
  }, [q, leavers, onToast]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load, reloadKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 260px' }}>
          <Input label={tr('purSearch')} value={q} onChange={e => setQ(e.target.value)} placeholder={tr('purPeopleSearchHint')} />
        </div>
        <Button variant={leavers ? 'primary' : 'secondary'} icon="alertTriangle" onClick={() => setLeavers(v => !v)}>
          {tr('purLeaversOnly')}
        </Button>
      </div>
      {leavers && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{tr('purLeaversHint')}</div>}

      {people === null ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>…</div>
      ) : people.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>
          {leavers ? tr('purNoLeavers') : tr('purNoPeople')}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', alignItems: 'start', gap: 12 }}>
          {people.map(p => (
            <Card key={`${p.netbox_contact_id || p.person_name}`} padding={14}
              style={p.offboarded ? { borderLeft: '3px solid var(--danger)' } : undefined}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontWeight: 700 }}>{p.person_name}</span>
                {p.person_department && <Badge color="gray">{p.person_department}</Badge>}
                {p.offboarded && <Badge color="red" dot>{tr('purLeaver')}</Badge>}
                {!p.netbox_contact_id && <Badge color="yellow">{tr('purNotInNetbox')}</Badge>}
              </div>
              {p.person_email && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{p.person_email}</div>}
              {p.seats.map(s => (
                <div key={s.seat_id} onClick={() => onOpenSub(s.subscription_id)} style={{
                  display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '6px 0',
                  borderTop: '1px solid var(--border-light)', cursor: 'pointer',
                }}>
                  <span style={{ fontWeight: 600 }}>{s.vendor}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.product}{s.login ? ` · ${s.login}` : ''}
                  </span>
                  {s.status !== 'active' && <Badge color="gray">{tr('purCancelled')}</Badge>}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(s.assigned_on, lang)}</span>
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
