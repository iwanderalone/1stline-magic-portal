import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiBlob } from '../../api';
import { Button, EmptyState, Tabs, Toast } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useLang } from '../../components/LangContext';
import DeviceDetailModal from '../../components/DeviceDetailModal';

// Inventory → Map. Geometry comes from the portal (/tools/office-map), what is
// at each desk comes live from NetBox (/occupancy): a desk is a NetBox location,
// its devices are the devices in that location, its people their holders.

const MIN_ZOOM_W = 400;      // plan units — closest zoom
const DRAG_THRESHOLD = 4;    // px before a press counts as a pan/drag rather than a click

const deskNo = (label) => (label || '').replace(/^(desk|room|rack)-0*/i, '');

export default function OfficeMapPanel({ user, subPath, navigate }) {
  const { t: tr } = useLang();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';
  const [map, setMap] = useState(null);           // {areas, netbox, netbox_url}
  const [occ, setOcc] = useState({});             // location_id → {devices, people}
  const [occError, setOccError] = useState(null);
  const [areaSlug, setAreaSlug] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState(null);   // device id in DeviceDetailModal
  const [toast, setToast] = useState(null);

  useEffect(() => {
    api('/tools/office-map').then(d => {
      setMap(d);
      const wanted = (subPath || '').split('/')[0];
      setAreaSlug(d.areas.find(a => a.slug === wanted)?.slug || d.areas[0]?.slug || null);
    }).catch(err => setToast({ message: err.message, type: 'error' }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOcc = useCallback(() => {
    api('/tools/office-map/occupancy')
      .then(d => { setOcc(d || {}); setOccError(null); })
      .catch(err => setOccError(err.message));
  }, []);
  useEffect(() => { if (map?.netbox) loadOcc(); }, [map?.netbox, loadOcc]);

  const area = map?.areas.find(a => a.slug === areaSlug);
  const selected = area?.items.find(i => i.id === selectedId) || null;

  const goArea = (slug) => {
    setAreaSlug(slug); setSelectedId(null);
    navigate(`inventory/map/${slug}`);
  };

  // Search: desk number/name or a person's name, across all plans.
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !map) return null;
    const hit = new Set();
    for (const a of map.areas) {
      for (const i of a.items) {
        const o = occ[i.location_id];
        const hay = [i.label, deskNo(i.label), ...(o?.people || []), ...(o?.devices || []).map(d => d.name)]
          .filter(Boolean).join(' ').toLowerCase();
        if (hay.includes(needle)) hit.add(i.id);
      }
    }
    return hit;
  }, [q, map, occ]);

  // Jump to the plan holding the only/first match.
  useEffect(() => {
    if (!matches || !matches.size || !map) return;
    if (area?.items.some(i => matches.has(i.id))) return;
    const other = map.areas.find(a => a.items.some(i => matches.has(i.id)));
    if (other) setAreaSlug(other.slug);
  }, [matches]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveItem = async (item, x, y) => {
    setMap(m => ({ ...m, areas: m.areas.map(a => ({ ...a, items: a.items.map(i => i.id === item.id ? { ...i, x, y } : i) })) }));
    try {
      await api(`/tools/office-map/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ x, y }) });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
      setMap(m => ({ ...m, areas: m.areas.map(a => ({ ...a, items: a.items.map(i => i.id === item.id ? { ...i, x: item.x, y: item.y } : i) })) }));
    }
  };

  if (!map) return toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null;
  if (!map.areas.length) {
    return <EmptyState icon={<Icon name="grid" size={40} />} title={tr('mapEmpty')} subtitle={tr('mapEmptyDesc')} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {viewing && <DeviceDetailModal deviceId={viewing} canEdit={false} onClose={() => setViewing(null)} />}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {map.areas.length > 1 && (
          <Tabs tabs={map.areas.map(a => ({ id: a.slug, label: a.name }))} active={areaSlug} onChange={goArea} />
        )}
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
          <span style={{ position: 'absolute', left: 9, top: 8, color: 'var(--text-muted)' }}><Icon name="search" size={15} /></span>
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder={tr('mapSearch')}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '7px 10px 7px 30px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', fontSize: 13, background: 'var(--surface-alt)', color: 'var(--text)', outline: 'none',
            }}
          />
        </div>
        {matches && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('mapMatches').replace('{n}', matches.size)}</span>}
        <div style={{ flex: 1 }} />
        {occError && <span style={{ fontSize: 12, color: 'var(--warning)' }} title={occError}>{tr('mapNetboxDown')}</span>}
        {canEdit && (
          <Button size="sm" variant={editing ? 'primary' : 'secondary'} icon="edit" onClick={() => setEditing(e => !e)}>
            {editing ? tr('mapEditDone') : tr('mapEdit')}
          </Button>
        )}
      </div>

      {editing && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('mapEditHint')}</div>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', minHeight: 560 }}>
        <PlanCanvas
          key={area.slug}
          area={area} occ={occ} matches={matches} selectedId={selectedId} editing={editing}
          onSelect={(id) => setSelectedId(id)} onMove={moveItem}
        />
        {selected && (
          <DetailPanel
            item={selected} info={occ[selected.location_id]} netboxUrl={map.netbox_url}
            onClose={() => setSelectedId(null)} onDevice={setViewing}
          />
        )}
      </div>
    </div>
  );
}

function PlanCanvas({ area, occ, matches, selectedId, editing, onSelect, onMove }) {
  const { t: tr } = useLang();
  const svgRef = useRef(null);
  const [view, setView] = useState(() => fitView(area));
  const [hover, setHover] = useState(null);       // {item, x, y} client coords for the tooltip
  const [dragPos, setDragPos] = useState(null);   // {id, x, y} while an item is being moved
  const press = useRef(null);

  useEffect(() => { setView(fitView(area)); }, [area.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const toPlan = (clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect();
    const k = Math.max(view.w / r.width, view.h / r.height);   // preserveAspectRatio meet
    const ox = (r.width * k - view.w) / 2, oy = (r.height * k - view.h) / 2;
    return { x: view.x - ox + (clientX - r.left) * k, y: view.y - oy + (clientY - r.top) * k, k };
  };

  // Wheel = zoom around the cursor. Attached natively: React's onWheel is passive.
  useEffect(() => {
    const el = svgRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      setView(v => {
        const r = el.getBoundingClientRect();
        const k = Math.max(v.w / r.width, v.h / r.height);
        const ox = (r.width * k - v.w) / 2, oy = (r.height * k - v.h) / 2;
        const px = v.x - ox + (e.clientX - r.left) * k, py = v.y - oy + (e.clientY - r.top) * k;
        const f = Math.exp(e.deltaY * 0.0015);
        const w = Math.min(area.width * 1.5, Math.max(MIN_ZOOM_W, v.w * f));
        const s = w / v.w;
        return { x: px - (px - v.x) * s, y: py - (py - v.y) * s, w, h: v.h * s };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [area.width]);

  const onPointerDown = (e, item = null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    const p = toPlan(e.clientX, e.clientY);
    press.current = { item, sx: e.clientX, sy: e.clientY, px: p.x, py: p.y, view, moved: false };
  };

  const onPointerMove = (e) => {
    const pr = press.current;
    if (!pr) return;
    if (!pr.moved && Math.hypot(e.clientX - pr.sx, e.clientY - pr.sy) < DRAG_THRESHOLD) return;
    pr.moved = true;
    const r = svgRef.current.getBoundingClientRect();
    const k = Math.max(pr.view.w / r.width, pr.view.h / r.height);
    const dx = (e.clientX - pr.sx) * k, dy = (e.clientY - pr.sy) * k;
    if (editing && pr.item) {
      setDragPos({ id: pr.item.id, x: Math.round(pr.item.x + dx), y: Math.round(pr.item.y + dy) });
    } else {
      setView({ ...pr.view, x: pr.view.x - dx, y: pr.view.y - dy });
    }
  };

  const onPointerUp = () => {
    const pr = press.current;
    press.current = null;
    if (!pr) return;
    if (!pr.moved) { onSelect(pr.item ? pr.item.id : null); return; }
    if (editing && pr.item && dragPos) {
      onMove(pr.item, dragPos.x, dragPos.y);
      setDragPos(null);
    }
  };

  const zoom = (f) => setView(v => {
    const w = Math.min(area.width * 1.5, Math.max(MIN_ZOOM_W, v.w * f));
    const s = w / v.w, cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    return { x: cx - (w / 2), y: cy - (v.h * s) / 2, w, h: v.h * s };
  });

  const fontFor = (it) => Math.max(18, Math.min(34, Math.min(it.w, it.h) * 0.32));

  return (
    <div style={{
      position: 'relative', flex: 1, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', overflow: 'hidden', height: 'calc(100vh - 230px)', minHeight: 560,
    }}>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        style={{ width: '100%', height: '100%', display: 'block', cursor: press.current?.moved ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none' }}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
      >
        {area.zones.map((z, i) => (
          <rect key={`z${i}`} x={z.x} y={z.y} width={z.w} height={z.h} rx={24}
            fill="none" stroke="var(--border)" strokeWidth={4} />
        ))}
        {area.walls.map(([x, y, w, h], i) => (
          <rect key={`w${i}`} x={x} y={y} width={w} height={h} fill="var(--text-secondary)" />
        ))}
        {area.labels.map((l, i) => (
          <text key={`l${i}`} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle"
            fontSize={44} fontWeight={600} fill="var(--text-muted)" style={{ pointerEvents: 'none' }}>{l.text}</text>
        ))}

        {area.items.map(it0 => {
          const it = dragPos?.id === it0.id ? { ...it0, x: dragPos.x, y: dragPos.y } : it0;
          const info = occ[it.location_id];
          const occupied = (info?.people?.length || 0) > 0;
          const hasDevices = (info?.devices?.length || 0) > 0;
          const isSel = it.id === selectedId;
          const dim = matches && !matches.has(it.id);
          const hit = matches && matches.has(it.id);
          const unbound = !it.location_id;
          const fill = hit ? 'var(--accent-light)'
            : it.kind === 'rack' ? 'var(--surface-sunken)'
            : occupied ? 'var(--surface-alt)' : 'transparent';
          const stroke = isSel || hit ? 'var(--accent)' : unbound ? 'var(--warning)' : 'var(--border-strong)';
          return (
            <g key={it.id} opacity={dim ? 0.25 : 1}
              style={{ cursor: editing ? 'move' : 'pointer' }}
              onPointerDown={(e) => onPointerDown(e, it0)}
              onPointerEnter={(e) => setHover({ item: it, x: e.clientX, y: e.clientY })}
              onPointerMove={(e) => hover && setHover({ item: it, x: e.clientX, y: e.clientY })}
              onPointerLeave={() => setHover(null)}
            >
              <rect x={it.x} y={it.y} width={it.w} height={it.h} rx={it.kind === 'room' ? 10 : 4}
                fill={fill} stroke={stroke} strokeWidth={isSel || hit ? 7 : 3}
                strokeDasharray={unbound ? '14 8' : it.kind === 'room' ? '10 6' : undefined} />
              <text x={it.x + it.w / 2} y={it.y + it.h / 2} textAnchor="middle" dominantBaseline="central"
                fontSize={fontFor(it)} fontFamily="var(--font-mono)"
                fill={occupied || hasDevices || it.kind !== 'desk' ? 'var(--text)' : 'var(--text-muted)'}
                style={{ pointerEvents: 'none' }}>
                {it.kind === 'desk' ? (deskNo(it.label) || '?') : (it.label || '?')}
              </text>
            </g>
          );
        })}
      </svg>

      <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Button size="sm" variant="secondary" onClick={() => zoom(0.75)} title={tr('mapZoomIn')}>+</Button>
        <Button size="sm" variant="secondary" onClick={() => zoom(1 / 0.75)} title={tr('mapZoomOut')}>−</Button>
        <Button size="sm" variant="secondary" onClick={() => setView(fitView(area))} title={tr('mapFit')}><Icon name="grid" size={14} /></Button>
      </div>

      {hover && !press.current && (
        <HoverCard item={hover.item} info={occ[hover.item.location_id]} x={hover.x} y={hover.y} host={svgRef.current} />
      )}
    </div>
  );
}

function HoverCard({ item, info, x, y, host }) {
  const { t: tr } = useLang();
  if (!host) return null;
  const r = host.getBoundingClientRect();
  const people = info?.people || [];
  return (
    <div style={{
      position: 'absolute', left: Math.min(x - r.left + 14, r.width - 240), top: Math.max(8, y - r.top - 10),
      width: 220, padding: '8px 10px', background: 'var(--surface-elevated)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-md)', fontSize: 12, pointerEvents: 'none',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{item.label || tr('mapUnbound')}</div>
      {people.length > 0 && <div style={{ marginTop: 3 }}>{people.join(', ')}</div>}
      <div style={{ marginTop: 3, color: 'var(--text-muted)' }}>
        {item.location_id ? tr('mapDevicesN').replace('{n}', info?.devices?.length ?? '…') : tr('mapUnboundHint')}
      </div>
    </div>
  );
}

function DetailPanel({ item, info, netboxUrl, onClose, onDevice }) {
  const { t: tr } = useLang();
  const [face, setFace] = useState('front');
  const [rackImg, setRackImg] = useState(null);
  const [rackErr, setRackErr] = useState(null);

  useEffect(() => {
    if (!item.rack_id) return undefined;
    let url = null;
    setRackImg(null); setRackErr(null);
    apiBlob(`/tools/office-map/racks/${item.rack_id}/elevation.svg?face=${face}`)
      .then(b => { url = URL.createObjectURL(b); setRackImg(url); })
      .catch(err => setRackErr(err.message));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [item.rack_id, face]);

  const devices = info?.devices || [];
  const people = info?.people || [];
  const kindLabel = { desk: tr('mapKindDesk'), room: tr('mapKindRoom'), rack: tr('mapKindRack') }[item.kind];

  return (
    <div style={{
      width: item.rack_id ? 380 : 320, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
      height: 'calc(100vh - 230px)', minHeight: 560, overflowY: 'auto', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div className="t-eyebrow">{kindLabel}</div>
          <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{item.label || tr('mapUnbound')}</div>
        </div>
        <button onClick={onClose} title={tr('close')} style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
          <Icon name="x" size={16} />
        </button>
      </div>

      {!item.location_id && (
        <div style={{ fontSize: 12, color: 'var(--warning)' }}>{item.note || tr('mapUnboundHint')}</div>
      )}

      {people.length > 0 && (
        <div>
          <div className="t-eyebrow" style={{ marginBottom: 4 }}>{tr('mapPeople')}</div>
          {people.map(p => <div key={p} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><Icon name="user" size={13} />{p}</div>)}
        </div>
      )}

      {item.rack_id && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <div className="t-eyebrow" style={{ flex: 1, marginBottom: 0 }}>{tr('mapRackElevation')}</div>
            <Tabs tabs={[{ id: 'front', label: tr('mapRackFront') }, { id: 'rear', label: tr('mapRackRear') }]} active={face} onChange={setFace} />
          </div>
          {rackErr && <div style={{ fontSize: 12, color: 'var(--warning)' }}>{rackErr}</div>}
          {rackImg && <img src={rackImg} alt="" style={{ width: '100%', background: '#fff', borderRadius: 'var(--radius-sm)' }} />}
        </div>
      )}

      {item.location_id && (
        <div>
          <div className="t-eyebrow" style={{ marginBottom: 4 }}>
            {tr('mapDevices')} {info ? `· ${devices.length}` : ''}
          </div>
          {!info && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>…</div>}
          {info && !devices.length && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('mapNoDevices')}</div>}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {devices.map(d => (
              <button key={d.id} onClick={() => onDevice(d.id)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, textAlign: 'left',
                border: 'none', borderBottom: '1px solid var(--border-light)', background: 'none', padding: '7px 2px',
                cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit',
              }}>
                <span style={{ fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{d.role || '—'}</span>{' '}
                  {[d.manufacturer, d.type].filter(Boolean).join(' ')}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {[d.name, d.asset_tag].filter(Boolean).join(' · ')}
                  {d.holders?.length ? ` · ${d.holders.join(', ')}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {item.location_id && netboxUrl && (
        <a href={`${netboxUrl}/dcim/locations/${item.location_id}/`} target="_blank" rel="noreferrer"
          style={{ fontSize: 12, color: 'var(--accent)', marginTop: 'auto' }}>
          {tr('mapOpenNetbox')}
        </a>
      )}
    </div>
  );
}

function fitView(area) {
  // Fit what is actually drawn, not the whole Miro frame (lots of white margin).
  const xs = [], ys = [];
  for (const [x, y, w, h] of area.walls) { xs.push(x, x + w); ys.push(y, y + h); }
  for (const i of area.items) { xs.push(i.x, i.x + i.w); ys.push(i.y, i.y + i.h); }
  for (const z of area.zones) { xs.push(z.x, z.x + z.w); ys.push(z.y, z.y + z.h); }
  if (!xs.length) return { x: 0, y: 0, w: area.width, h: area.height };
  const pad = 120;
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 };
}
