import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import { Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { api, apiBlob } from '../../api';
import { Button, EmptyState, Tabs, Toast } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useLang } from '../../components/LangContext';
import { useTheme } from '../../components/ThemeContext';
import DeviceDetailModal from '../../components/DeviceDetailModal';

// Inventory → Map, drawn with Konva (canvas). Geometry comes from the portal
// (/tools/office-map); what is at each desk comes live from NetBox
// (/occupancy): a desk is a NetBox location, its devices are the devices in
// that location, "sits here" is their holders.
//
// Text is sized in *screen* pixels (divided by the zoom) so it stays readable
// at any zoom; a label only appears once its tile is big enough to hold it.

Konva.dragDistance = 4;            // a press that moves less than this is a click

const PAD = 80;                    // plan units of margin around what is drawn
const MAX_ZOOM_FACTOR = 7;         // closest zoom, relative to "fit"
const SNAP = 5;                    // plan units, edit mode

const deskNo = (label) => (label || '').replace(/^desk-0*/i, '');
const shortName = (full) => {
  const parts = (full || '').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || '';
};
const itemTitle = (it) => {
  if (!it.label) return '?';
  if (it.kind === 'desk') return deskNo(it.label);
  if (it.kind === 'rack') return it.label.replace(/^rack-0*/i, 'R');
  return it.label.replace(/^room-0*/i, 'Room ');
};

function boundsOf(area) {
  const xs = [], ys = [];
  for (const [x, y, w, h] of area.walls) { xs.push(x, x + w); ys.push(y, y + h); }
  for (const i of area.items) { xs.push(i.x, i.x + i.w); ys.push(i.y, i.y + i.h); }
  for (const z of area.zones) { xs.push(z.x, z.x + z.w); ys.push(z.y, z.y + z.h); }
  for (const l of area.labels) { xs.push(l.x - 200, l.x + 200); ys.push(l.y - 40, l.y + 40); }
  if (!xs.length) return { x: 0, y: 0, w: area.width, h: area.height };
  const x0 = Math.min(...xs) - PAD, y0 = Math.min(...ys) - PAD;
  return { x: x0, y: y0, w: Math.max(...xs) + PAD - x0, h: Math.max(...ys) + PAD - y0 };
}

// The desks a zone caption belongs to: those inside the outline that holds the
// caption, or — for captions without an outline — the ones closest under it.
function zoneItems(area, label) {
  const inside = (z, x, y) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
  const zone = area.zones.find(z => inside(z, label.x, label.y));
  const centre = (i) => [i.x + i.w / 2, i.y + i.h / 2];
  if (zone) {
    const hits = area.items.filter(i => inside(zone, ...centre(i)));
    if (hits.length) return hits;
  }
  const near = area.items
    .map(i => { const [x, y] = centre(i); return { i, d: Math.hypot(x - label.x, (y - label.y) * 1.3) }; })
    .filter(o => o.d < 900).sort((a, b) => a.d - b.d).map(o => o.i);
  return near.length ? near : area.items;
}

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
  const canvasApi = useRef(null);                 // {focus(items)} from the canvas

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

  // Search: desk number/name, a person, or a device name — across all plans.
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !map) return null;
    const hit = new Set();
    for (const a of map.areas) {
      for (const i of a.items) {
        const o = occ[i.location_id];
        if (i.kind === 'desk' && deskNo(i.label) === needle) { hit.add(i.id); continue; }
        const hay = [i.label, ...(o?.people || []), ...(o?.devices || []).flatMap(d => [d.name, d.asset_tag])]
          .filter(Boolean).join(' ').toLowerCase();
        if (needle.length > 1 && hay.includes(needle)) hit.add(i.id);
      }
    }
    return hit;
  }, [q, map, occ]);

  // Matches live on another plan only → switch to it.
  useEffect(() => {
    if (!matches?.size || !map || area?.items.some(i => matches.has(i.id))) return;
    const other = map.areas.find(a => a.items.some(i => matches.has(i.id)));
    if (other) setAreaSlug(other.slug);
  }, [matches]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSearchKey = (e) => {
    if (e.key === 'Enter' && matches?.size && area) {
      const hits = area.items.filter(i => matches.has(i.id));
      canvasApi.current?.focus(hits);
      if (hits.length === 1) setSelectedId(hits[0].id);
    }
    if (e.key === 'Escape') setQ('');
  };

  const moveItem = async (item, x, y) => {
    const patch = (fn) => setMap(m => ({ ...m, areas: m.areas.map(a => ({ ...a, items: a.items.map(i => i.id === item.id ? fn(i) : i) })) }));
    patch(i => ({ ...i, x, y }));
    try {
      await api(`/tools/office-map/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ x, y }) });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
      patch(i => ({ ...i, x: item.x, y: item.y }));
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
            value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder={tr('mapSearch')}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '7px 10px 7px 30px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', fontSize: 13, background: 'var(--surface-alt)', color: 'var(--text)', outline: 'none',
            }}
          />
        </div>
        {matches && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {tr('mapMatches').replace('{n}', matches.size)}{matches.size ? ` · ${tr('mapEnterToShow')}` : ''}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {occError && <span style={{ fontSize: 12, color: 'var(--warning)' }} title={occError}>{tr('mapNetboxDown')}</span>}
        {canEdit && (
          <Button size="sm" variant={editing ? 'primary' : 'secondary'} icon="edit" onClick={() => setEditing(e => !e)}>
            {editing ? tr('mapEditDone') : tr('mapEdit')}
          </Button>
        )}
      </div>

      {area.labels.length > 0 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', whiteSpace: 'nowrap', marginTop: -2, paddingBottom: 2, scrollbarWidth: 'thin' }}>
          {area.labels.map(l => (
            <button key={l.text} onClick={() => canvasApi.current?.focus(zoneItems(area, l))} style={{
              flexShrink: 0,
              padding: '3px 10px', fontSize: 12, borderRadius: 'var(--radius-pill)', cursor: 'pointer',
              border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)', fontFamily: 'inherit',
            }}>{l.text}</button>
          ))}
          <button onClick={() => canvasApi.current?.fit()} style={{
            flexShrink: 0,
            padding: '3px 10px', fontSize: 12, borderRadius: 'var(--radius-pill)', cursor: 'pointer',
            border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text)', fontFamily: 'inherit',
          }}>{tr('mapWholePlan')}</button>
        </div>
      )}

      <div style={{
        position: 'relative', height: 'calc(100vh - 250px)', minHeight: 520, borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--surface)',
      }}>
        <PlanCanvas
          key={area.slug}
          area={area} occ={occ} matches={matches} selectedId={selectedId} editing={editing}
          onSelect={setSelectedId} onMove={moveItem} apiRef={canvasApi}
        />
        {editing && (
          <div style={{
            position: 'absolute', left: 12, top: 12, maxWidth: 360, padding: '8px 12px', fontSize: 12,
            background: 'var(--surface-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)', boxShadow: 'var(--shadow-md)',
          }}>{tr('mapEditHint')}</div>
        )}
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

function PlanCanvas({ area, occ, matches, selectedId, editing, onSelect, onMove, apiRef }) {
  const { t: tr } = useLang();
  const { theme: t } = useTheme();
  const hostRef = useRef(null);
  const stageRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState(null);         // {x, y, s} stage position + scale
  const [hover, setHover] = useState(null);       // {item, px, py} screen coords inside host
  const scene = area;
  const B = useMemo(() => boundsOf(area), [area]);

  useLayoutEffect(() => {
    const el = hostRef.current;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitScale = size.w ? Math.min(size.w / B.w, size.h / B.h) : 1;
  const minS = fitScale * 0.9, maxS = fitScale * MAX_ZOOM_FACTOR;

  // Keep the plan on screen: centred on an axis where it fits, otherwise its
  // edges may not come further in than a small margin.
  const clamp = useCallback((x, y, s) => {
    const axis = (pos, lo, len, viewLen) => {
      const a = lo * s, b = (lo + len) * s;
      if (b - a <= viewLen) return (viewLen - (a + b)) / 2;
      return Math.min(-a + 24, Math.max(viewLen - b - 24, pos));
    };
    return { x: axis(x, B.x, B.w, size.w), y: axis(y, B.y, B.h, size.h), s };
  }, [B, size]);

  const fit = useCallback(() => clamp(0, 0, fitScale), [clamp, fitScale]);
  // First view: a tall plan squeezed to the screen height is too small to
  // read, so start up to ~2× closer, filling the width, at the top.
  const initial = useCallback(() => {
    const fitW = size.w / B.w;
    const s0 = Math.max(fitScale, Math.min(fitW * 0.96, fitScale * 2.2));
    return clamp(0, -B.y * s0 + 12, s0);
  }, [B, size, fitScale, clamp]);

  const animateTo = useCallback((v) => {
    const st = stageRef.current;
    if (!st) { setView(v); return; }
    new Konva.Tween({
      node: st, duration: 0.22, easing: Konva.Easings.EaseInOut,
      x: v.x, y: v.y, scaleX: v.s, scaleY: v.s,
      onFinish: () => setView(v),
    }).play();
  }, []);

  useEffect(() => { if (size.w) setView(initial()); }, [size.w, size.h, area.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (factor, px, py) => {
    // Read the live stage, not React state: wheel events outrun re-renders.
    const st = stageRef.current;
    const v = st ? { x: st.x(), y: st.y(), s: st.scaleX() } : view;
    const s = Math.min(maxS, Math.max(minS, v.s * factor));
    const wx = (px - v.x) / v.s, wy = (py - v.y) / v.s;
    return clamp(px - wx * s, py - wy * s, s);
  };

  const onWheel = (e) => {
    const ev = e.evt;
    ev.preventDefault();
    const st = stageRef.current;
    const p = st.getPointerPosition();
    // Trackpad: two-finger scroll pans, pinch (ctrl+wheel) zooms. A mouse
    // wheel (line mode, or big notched steps with no sideways part) zooms.
    const mouseWheel = ev.deltaMode === 1 || (ev.deltaX === 0 && Math.abs(ev.deltaY) >= 50 && Number.isInteger(ev.deltaY));
    let v;
    if (ev.ctrlKey || mouseWheel) {
      v = zoomAt(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0018)), p.x, p.y);
    } else {
      v = clamp(st.x() - ev.deltaX, st.y() - ev.deltaY, st.scaleX());
    }
    stageRef.current.position({ x: v.x, y: v.y });
    stageRef.current.scale({ x: v.s, y: v.s });
    setView(v);
  };

  const focus = useCallback((wanted) => {
    const ids = new Set(wanted.map(i => i.id));
    const items = scene.items.filter(i => ids.has(i.id));
    if (!items.length || !size.w) return;
    const x0 = Math.min(...items.map(i => i.x)), y0 = Math.min(...items.map(i => i.y));
    const x1 = Math.max(...items.map(i => i.x + i.w)), y1 = Math.max(...items.map(i => i.y + i.h));
    const m = 500;
    const s = Math.min(maxS, Math.max(minS, Math.min(size.w / (x1 - x0 + m), size.h / (y1 - y0 + m))));
    animateTo(clamp(size.w / 2 - ((x0 + x1) / 2) * s, size.h / 2 - ((y0 + y1) / 2) * s, s));
  }, [scene, size, minS, maxS, clamp, animateTo]);
  useEffect(() => { apiRef.current = { focus, fit: () => animateTo(fit()) }; }, [focus, fit, animateTo, apiRef]);

  const s = view?.s || 1;
  const px = (n) => n / s;                        // screen px → plan units
  // Zone captions follow the board's size (64 units) within a readable range.
  const captionPx = Math.min(13, Math.max(9, 64 * s));

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} onPointerLeave={() => setHover(null)}>
      {size.w > 0 && view && (
        <Stage
          ref={stageRef} width={size.w} height={size.h}
          x={view.x} y={view.y} scaleX={view.s} scaleY={view.s}
          draggable
          dragBoundFunc={(pos) => { const c = clamp(pos.x, pos.y, s); return { x: c.x, y: c.y }; }}
          onDragEnd={(e) => { if (e.target === stageRef.current) setView(v => ({ ...v, x: e.target.x(), y: e.target.y() })); }}
          onWheel={onWheel}
          onDblClick={() => { const p = stageRef.current.getPointerPosition(); animateTo(zoomAt(2, p.x, p.y)); }}
          onDblTap={() => { const p = stageRef.current.getPointerPosition(); animateTo(zoomAt(2, p.x, p.y)); }}
          onClick={(e) => { if (e.target === stageRef.current) onSelect(null); }}
          onTap={(e) => { if (e.target === stageRef.current) onSelect(null); }}
          style={{ cursor: 'grab' }}
        >
          <Layer listening>
            {scene.zones.map((z, i) => (
              <Rect key={`z${i}`} listening={false} x={z.x} y={z.y} width={z.w} height={z.h}
                cornerRadius={28} fill={t.surfaceAlt} opacity={0.55} />
            ))}
            {scene.walls.map(([x, y, w, h], i) => (
              <Rect key={`w${i}`} listening={false} x={x} y={y} width={w} height={h} fill={t.textMuted} cornerRadius={4} />
            ))}
            {scene.labels.map((l, i) => (
              <Text key={`l${i}`} listening={false} text={l.text}
                x={l.x - 700} y={l.y - px(captionPx) / 2} width={1400} align="center"
                fontSize={px(captionPx)} fontStyle="600" fontFamily={t.fontSans}
                fill={t.textMuted} wrap="none" />
            ))}
            {scene.items.map(it => (
              <Tile key={it.id} it={it} t={t} s={s} info={occ[it.location_id]}
                selected={it.id === selectedId}
                hit={!!matches?.has(it.id)} dim={!!matches && !matches.has(it.id)}
                editing={editing}
                onSelect={() => onSelect(it.id)}
                onHover={(on) => {
                  if (!on) { setHover(null); return; }
                  const p = stageRef.current.getPointerPosition();
                  setHover({ item: it, px: p.x, py: p.y });
                }}
                onMove={(x, y) => onMove(it, x, y)}
              />
            ))}
          </Layer>
        </Stage>
      )}

      <div style={{ position: 'absolute', left: 12, bottom: 12, display: 'flex', gap: 4 }}>
        <Button size="sm" variant="secondary" onClick={() => animateTo(zoomAt(1.4, size.w / 2, size.h / 2))} title={tr('mapZoomIn')}>+</Button>
        <Button size="sm" variant="secondary" onClick={() => animateTo(zoomAt(1 / 1.4, size.w / 2, size.h / 2))} title={tr('mapZoomOut')}>−</Button>
        <Button size="sm" variant="secondary" onClick={() => animateTo(fit())}>{tr('mapFit')}</Button>
        <span style={{ alignSelf: 'center', marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>{tr('mapHelp')}</span>
      </div>
      <Legend t={t} />

      {hover && (
        <HoverCard item={hover.item} info={occ[hover.item.location_id]} x={hover.px} y={hover.py} host={size} />
      )}
    </div>
  );
}

function Tile({ it, t, s, info, selected, hit, dim, editing, onSelect, onHover, onMove }) {
  const [hovered, setHovered] = useState(false);
  const px = (n) => n / s;
  const people = info?.people || [];
  const nDevices = info?.devices?.length || 0;
  const unbound = !it.location_id;
  const screenW = it.w * s, screenH = it.h * s;

  const fill = selected || hit ? t.accentLight
    : it.kind === 'rack' ? t.surfaceSunken
    : people.length ? t.surfaceElevated
    : nDevices ? t.surfaceAlt
    : t.surface;
  const stroke = selected || hit ? t.accent : unbound ? t.warning : hovered ? t.textMuted : t.borderStrong;
  const strokeW = px(selected || hit ? 2.5 : hovered ? 1.8 : 1.2);

  // Labels in screen pixels; shown only when the tile has room for them.
  const titleFs = it.kind === 'room' ? 10 : Math.min(13, screenH * 0.7, screenW * 0.42);
  const showTitle = it.kind === 'room' ? screenW >= 34 : titleFs >= 7.5;
  const showName = people.length > 0 && screenH >= 34 && screenW >= 54;
  const nameFs = 10.5;
  const title = itemTitle(it);
  const blockH = (showTitle ? titleFs : 0) + (showName ? nameFs + 3 : 0);
  const top = it.h / 2 - px(blockH) / 2;

  return (
    <Group
      x={it.x} y={it.y} opacity={dim ? 0.28 : 1}
      draggable={editing}
      onDragStart={(e) => { e.cancelBubble = true; }}
      onDragMove={(e) => { e.cancelBubble = true; }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const nx = Math.round(e.target.x() / SNAP) * SNAP, ny = Math.round(e.target.y() / SNAP) * SNAP;
        e.target.position({ x: nx, y: ny });
        onMove(nx, ny);
      }}
      onClick={(e) => { e.cancelBubble = true; onSelect(); }}
      onTap={(e) => { e.cancelBubble = true; onSelect(); }}
      onMouseEnter={(e) => { setHovered(true); onHover(true); e.target.getStage().container().style.cursor = editing ? 'move' : 'pointer'; }}
      onMouseLeave={(e) => { setHovered(false); onHover(false); e.target.getStage().container().style.cursor = 'grab'; }}
    >
      <Rect width={it.w} height={it.h}
        fill={it.kind === 'room' && !(selected || hit) ? (hovered ? t.surfaceAlt : 'transparent') : fill}
        stroke={it.kind === 'room' && !(selected || hit || hovered || unbound) ? 'transparent' : stroke}
        strokeWidth={strokeW}
        cornerRadius={it.kind === 'room' ? px(10) : Math.min(px(5), it.h / 4)} dash={unbound ? [px(6), px(4)] : undefined}
        shadowColor={t.accent} shadowBlur={selected ? px(10) : 0} shadowOpacity={selected ? 0.5 : 0} />
      {showTitle && (
        <Text listening={false} text={title} align="center" y={top}
          width={Math.max(it.w, px(70))} x={(it.w - Math.max(it.w, px(70))) / 2}
          fontSize={px(titleFs)} fontFamily={t.fontMono} fontStyle={people.length || nDevices ? '600' : 'normal'}
          fill={people.length || nDevices || it.kind !== 'desk' ? t.text : t.textMuted} wrap="none" ellipsis />
      )}
      {showName && (
        <Text listening={false} text={shortName(people[0]) + (people.length > 1 ? ` +${people.length - 1}` : '')}
          width={it.w - px(6)} x={px(3)} align="center" y={top + px(titleFs + 3)}
          fontSize={px(nameFs)} fontFamily={t.fontSans} fill={t.textSecondary} wrap="none" ellipsis />
      )}
    </Group>
  );
}

function Legend({ t }) {
  const { t: tr } = useLang();
  const sw = (fill, stroke, dash) => (
    <span style={{
      width: 14, height: 10, borderRadius: 3, background: fill, display: 'inline-block',
      border: `1.5px ${dash ? 'dashed' : 'solid'} ${stroke}`,
    }} />
  );
  return (
    <div style={{
      position: 'absolute', right: 12, bottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
      padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-elevated)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-xs)',
    }}>
      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>{sw(t.surfaceElevated, t.borderStrong)}{tr('mapLegendPeople')}</span>
      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>{sw(t.surfaceAlt, t.borderStrong)}{tr('mapLegendDevices')}</span>
      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>{sw(t.surface, t.borderStrong)}{tr('mapLegendEmpty')}</span>
      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>{sw('transparent', t.warning, true)}{tr('mapUnbound')}</span>
    </div>
  );
}

function HoverCard({ item, info, x, y, host }) {
  const { t: tr } = useLang();
  const people = info?.people || [];
  const kind = { desk: tr('mapKindDesk'), room: tr('mapKindRoom'), rack: tr('mapKindRack') }[item.kind];
  return (
    <div style={{
      position: 'absolute', left: Math.min(x + 14, host.w - 240), top: Math.min(Math.max(8, y + 14), host.h - 90),
      width: 220, padding: '8px 10px', background: 'var(--surface-elevated)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-md)', fontSize: 12, pointerEvents: 'none',
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
        <span style={{ color: 'var(--text-muted)' }}>{kind}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{item.label || tr('mapUnbound')}</span>
      </div>
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
      position: 'absolute', top: 12, right: 12, bottom: 12, width: item.rack_id ? 380 : 330, maxWidth: 'calc(100% - 24px)',
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-lg)', padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
      overflowY: 'auto', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div className="t-eyebrow">{kindLabel}</div>
          <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{item.label || tr('mapUnbound')}</div>
        </div>
        <button onClick={onClose} title={tr('close')} style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
          <Icon name="x" size={16} />
        </button>
      </div>

      {!item.location_id && (
        <div style={{ fontSize: 12, color: 'var(--warning)' }}>{item.note || tr('mapUnboundHint')}</div>
      )}

      {item.location_id && (
        <div>
          <div className="t-eyebrow" style={{ marginBottom: 4 }}>{tr('mapPeople')}</div>
          {people.length
            ? people.map(p => <div key={p} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}><Icon name="user" size={13} />{p}</div>)
            : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{info ? tr('mapNobody') : '…'}</div>}
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
            {tr('mapDevices')}{info ? ` · ${devices.length}` : ''}
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
