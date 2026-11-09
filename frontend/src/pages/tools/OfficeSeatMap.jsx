import { useEffect, useMemo, useRef } from 'react';
import { useLang } from '../../components/LangContext';

// The "Seats" view of the office map: instead of the floor drawn to scale
// (mostly empty floor, desks pressed together in blocks), each group of desks
// becomes a card. Inside a card the desks keep their arrangement from the
// board, scaled up and spaced out; the cards are packed in reading order.

export const deskNo = (label) => (label || '').replace(/^desk-0*/i, '');
export const shortName = (full) => {
  const parts = (full || '').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || '';
};
export const itemTitle = (it) => {
  if (!it.label) return '?';
  if (it.kind === 'desk') return deskNo(it.label);
  if (it.kind === 'rack') return it.label.replace(/^rack-0*/i, 'Rack ');
  return it.label.replace(/^room-0*/i, 'Room ');
};

const K = 0.42;          // board units → px inside a card
const GAP = 5;           // px between neighbouring desks
const LINK = 90;         // board units: desks closer than this form one block
const LABEL_REACH = 520; // board units: how far a caption may sit from its block

const edgeDist = (a, b) => {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
};
const bbox = (items) => {
  const x = Math.min(...items.map(i => i.x)), y = Math.min(...items.map(i => i.y));
  return { x, y, w: Math.max(...items.map(i => i.x + i.w)) - x, h: Math.max(...items.map(i => i.y + i.h)) - y };
};

// Desks that touch (or nearly) form one block; a block keeps its shape.
function blocksOf(items) {
  const parent = new Map(items.map(i => [i.id, i.id]));
  const find = (id) => { while (parent.get(id) !== id) id = parent.get(id); return id; };
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (edgeDist(items[a], items[b]) < LINK) parent.set(find(items[a].id), find(items[b].id));
    }
  }
  const out = new Map();
  for (const i of items) {
    const r = find(i.id);
    if (!out.has(r)) out.set(r, []);
    out.get(r).push(i);
  }
  // A block standing on end (a column of desks drawn sideways on the board)
  // is laid flat: in a seating chart orientation carries no meaning, and wide
  // tiles fit a name.
  const flat = (b) => {
    const box = bbox(b);
    if (b.length < 2 || box.h <= box.w * 1.3) return b;
    return b.map(i => ({ ...i, x: i.y, y: i.x, w: i.h, h: i.w }));
  };
  // Inside a card: biggest block first, then reading order.
  return [...out.values()].map(flat).map(b => ({ items: b, box: bbox(b) }))
    .sort((a, b) => (b.items.length - a.items.length) || (a.box.y - b.box.y) || (a.box.x - b.box.x));
}

// Cards: the zone each item was given (set at import, editable), or for items
// without one, blocks of near desks named after the caption over them.
export function groupArea(area) {
  const zoned = new Map();
  for (const i of area.items) {
    if (!i.zone) continue;
    if (!zoned.has(i.zone)) zoned.set(i.zone, []);
    zoned.get(i.zone).push(i);
  }
  const groups = [...zoned].map(([title, items]) => ({ title, items, other: title === 'Not linked yet' }));
  for (const g of guessGroups({ ...area, items: area.items.filter(i => !i.zone) })) groups.push(g);
  for (const g of groups) { g.box = bbox(g.items); g.blocks = blocksOf(g.items); }
  // Reading order: bands of the board from top to bottom, left to right inside a band.
  groups.sort((a, b) => (a.other - b.other) || (Math.round(a.box.y / 1200) - Math.round(b.box.y / 1200)) || (a.box.x - b.box.x));
  return groups;
}

function guessGroups(area) {
  const items = area.items;
  if (!items.length) return [];
  const parent = new Map(items.map(i => [i.id, i.id]));
  const find = (id) => { while (parent.get(id) !== id) id = parent.get(id); return id; };
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (edgeDist(items[a], items[b]) < LINK) parent.set(find(items[a].id), find(items[b].id));
    }
  }
  const clusters = new Map();
  for (const i of items) {
    const r = find(i.id);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(i);
  }

  // A caption names the nearest block below/around it (captions sit on top).
  const named = new Map();   // caption text → [cluster]
  const unnamed = [];
  for (const cl of clusters.values()) {
    const b = bbox(cl);
    let best = null;
    for (const l of area.labels) {
      const dx = Math.max(0, b.x - l.x, l.x - (b.x + b.w));
      const dy = l.y < b.y ? b.y - l.y : l.y > b.y + b.h ? (l.y - (b.y + b.h)) * 2.5 : 0;
      const d = Math.hypot(dx, dy);
      if (d < LABEL_REACH && (!best || d < best.d)) best = { d, text: l.text };
    }
    if (best) {
      if (!named.has(best.text)) named.set(best.text, []);
      named.get(best.text).push(cl);
    } else {
      unnamed.push(cl);
    }
  }

  const groups = [];
  for (const [title, cls] of named) groups.push({ title, items: cls.flat(), other: false });
  for (const cl of unnamed) groups.push({ title: null, items: cl, other: false });
  return groups;
}

// A lone desk/room/rack gets a standard tile instead of its board size
// (rooms are only a caption on the board, racks a small icon).
const LONE = { desk: [96, 46], room: [96, 40], rack: [84, 46] };
const lone = (blk) => blk.items.length === 1;
const blockW = (blk) => (lone(blk) ? LONE[blk.items[0].kind][0] : blk.box.w * K + GAP);
const blockH = (blk) => (lone(blk) ? LONE[blk.items[0].kind][1] : blk.box.h * K + GAP);
const seatBox = (it, blk) => (lone(blk)
  ? { x: 0, y: 0, w: LONE[it.kind][0], h: LONE[it.kind][1] }
  : { x: (it.x - blk.box.x) * K + GAP / 2, y: (it.y - blk.box.y) * K + GAP / 2, w: it.w * K - GAP, h: it.h * K - GAP });

const rangeTitle = (items, tr) => {
  const nums = items.filter(i => i.kind === 'desk').map(i => Number(deskNo(i.label))).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
  if (!nums.length) return items.map(i => itemTitle(i)).join(', ');
  return `${tr('mapKindDesk')} ${nums[0]}${nums.length > 1 ? `–${nums[nums.length - 1]}` : ''}`;
};

export default function OfficeSeatMap({ area, occ, matches, selectedId, onSelect }) {
  const { t: tr } = useLang();
  const groups = useMemo(() => groupArea(area), [area]);
  const firstHit = useRef(null);

  // Bring the first search hit into view.
  useEffect(() => {
    if (matches?.size) firstHit.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [matches]);
  let hitMarked = false;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
      {groups.map((g, gi) => {
        const seated = g.items.filter(i => occ[i.location_id]?.people?.length).length;
        const desks = g.items.filter(i => i.kind === 'desk').length;
        const title = g.other ? tr('mapNotLinkedGroup') : g.title || rangeTitle(g.items, tr);
        const dimCard = matches && !g.items.some(i => matches.has(i.id));
        return (
          <section key={gi} style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            padding: '12px 14px 14px', opacity: dimCard ? 0.35 : 1, transition: 'opacity var(--dur-fast) ease',
          }}>
            <header style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
              {desks > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {tr(desks === 1 ? 'mapSeatCountOne' : 'mapSeatCount').replace('{n}', desks).replace('{s}', seated)}
                </span>
              )}
            </header>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start', maxWidth: 640 }}>
              {g.blocks.map((blk, bi) => (
                <div key={bi} style={{ position: 'relative', width: blockW(blk), height: blockH(blk) }}>
                  {blk.items.map(it => {
                    const isFirst = !hitMarked && matches?.has(it.id) && (hitMarked = true);
                    const box = seatBox(it, blk);
                    return (
                      <Seat key={it.id} it={it} info={occ[it.location_id]} {...box}
                        selected={it.id === selectedId} hit={!!matches?.has(it.id)} dim={!!matches && !matches.has(it.id)}
                        onSelect={onSelect} innerRef={isFirst ? firstHit : undefined} />
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Seat({ it, info, x, y, w, h, selected, hit, dim, onSelect, innerRef }) {
  const { t: tr } = useLang();
  const people = info?.people || [];
  const nDev = info?.devices?.length || 0;
  const unbound = !it.location_id;
  const minW = Math.max(w, 30), minH = Math.max(h, 26);
  const vertical = minH > minW * 1.4;
  const roomy = minH >= 40 && minW >= 60;
  const name = people.length ? shortName(people[0]) + (people.length > 1 ? ` +${people.length - 1}` : '') : '';
  const absolute = x !== undefined;
  const bg = selected || hit ? 'var(--accent-light)'
    : it.kind === 'rack' ? 'var(--surface-sunken)'
    : people.length ? 'var(--surface-elevated)'
    : nDev ? 'var(--surface-alt)' : 'var(--surface)';
  const border = selected || hit ? 'var(--accent)' : unbound ? 'var(--warning)' : 'var(--border-strong)';
  const tip = [
    it.label || tr('mapUnbound'),
    people.join(', '),
    it.location_id ? tr('mapDevicesN').replace('{n}', info ? nDev : '…') : tr('mapUnboundHint'),
  ].filter(Boolean).join('\n');

  return (
    <button
      ref={innerRef}
      onClick={() => onSelect(it.id)}
      title={tip}
      style={{
        position: absolute ? 'absolute' : 'relative', left: x, top: y, width: minW, height: minH,
        boxSizing: 'border-box', padding: '2px 4px', borderRadius: it.kind === 'room' ? 10 : 7,
        border: `${selected || hit ? 2 : 1}px ${unbound || it.kind === 'room' ? 'dashed' : 'solid'} ${border}`,
        background: bg, color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit', opacity: dim ? 0.35 : 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
        overflow: 'hidden', boxShadow: selected ? '0 0 0 3px var(--accent-glow)' : 'none',
        transition: 'box-shadow var(--dur-fast) ease, background var(--dur-fast) ease',
      }}
    >
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: it.kind === 'desk' ? 13 : 11, fontWeight: people.length || nDev ? 600 : 400,
        color: people.length || nDev || it.kind !== 'desk' ? 'var(--text)' : 'var(--text-muted)', lineHeight: 1.1,
        whiteSpace: 'nowrap',
      }}>{itemTitle(it)}</span>
      {name && (roomy || vertical) && (
        <span style={{
          fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.15, maxWidth: '100%', textAlign: 'center',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: vertical ? 'normal' : 'nowrap',
          wordBreak: 'break-word',
        }}>{name}</span>
      )}
    </button>
  );
}
