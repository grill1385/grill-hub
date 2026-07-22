import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ============================================================
   Extras dos Eventos: geocoding partilhado, vista de calendário,
   vista de mapa e gestor de localizações (Gestão).
   ============================================================ */

/* ---------- Geocoding ---------- */
export function extractLatLng(url) {
  if (!url) return null;
  let m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = url.match(/[?&](?:q|query|ll|center|destination|daddr)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/i);
  if (m) return [Number(m[1]), Number(m[2])];
  m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  return null;
}

async function geocodeText(q) {
  if (!q) return null;
  const key = `grill-geo:${q.toLowerCase()}`;
  try { const c = localStorage.getItem(key); if (c) return JSON.parse(c); } catch { /* sem cache */ }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data?.[0]) return null;
    const pt = [Number(data[0].lat), Number(data[0].lon)];
    try { localStorage.setItem(key, JSON.stringify(pt)); } catch { /* quota */ }
    return pt;
  } catch { return null; }
}

export async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=14&lat=${lat}&lon=${lng}`);
    const d = await res.json();
    const a = d.address || {};
    return a.city || a.town || a.village || a.municipality || d.name || d.display_name?.split(",")[0] || null;
  } catch { return null; }
}

/* coords de um evento: link do maps → texto da localização */
export function eventLatLng(ev) { return extractLatLng(ev.locationUrl); }
export function hasFixedLocation(ev) { return !!eventLatLng(ev); }
export function needsLocation(ev) { return !hasFixedLocation(ev) && !(ev.location && ev.location.trim()); }

/* resolve coords de vários eventos (link direto ou geocoding do texto) */
function useEventCoords(events) {
  const [coords, setCoords] = useState({});
  const sig = events.map((e) => `${e.id}:${e.locationUrl || ""}:${e.location || ""}`).join("|");
  useEffect(() => {
    let alive = true;
    (async () => {
      const out = {};
      for (const ev of events) {
        const direct = extractLatLng(ev.locationUrl);
        if (direct) { out[ev.id] = direct; continue; }
        if (ev.location && ev.location.trim()) {
          const g = await geocodeText(ev.location.trim());
          if (g) out[ev.id] = g;
        }
      }
      if (alive) setCoords(out);
    })();
    return () => { alive = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return coords;
}

const DARK_TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_OPTS = { attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: "abcd", maxZoom: 19 };
const fmtD = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

/* ============================================================
   VISTA DE MAPA
   ============================================================ */
export function EventsMap({ events, colorOf, onOpen }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const coords = useEventCoords(events);
  const [sel, setSel] = useState(null); // {ll, list:[ev]}

  const groups = useMemo(() => {
    const by = {};
    events.forEach((ev) => {
      const ll = coords[ev.id];
      if (!ll) return;
      const key = `${ll[0].toFixed(4)},${ll[1].toFixed(4)}`;
      (by[key] = by[key] || { ll, list: [] }).list.push(ev);
    });
    return Object.values(by);
  }, [events, coords]);

  useEffect(() => {
    if (!boxRef.current || !groups.length) return;
    const map = L.map(boxRef.current, { scrollWheelZoom: false });
    mapRef.current = map;
    L.tileLayer(DARK_TILES, TILE_OPTS).addTo(map);
    map.fitBounds(L.latLngBounds(groups.map((g) => g.ll)), { padding: [40, 40], maxZoom: 12 });
    groups.forEach((g) => {
      const n = g.list.length;
      const icon = L.divIcon({ className: "", html: `<div class="ev-pin">${n}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      L.marker(g.ll, { icon }).addTo(map).on("click", () => setSel(g));
    });
    return () => { map.remove(); if (mapRef.current === map) mapRef.current = null; };
  }, [groups]);

  if (!events.length) return <p className="empty">Sem eventos.</p>;

  return (
    <div>
      <EventsExtraStyle />
      <div className="ev-map" ref={boxRef} />
      {Object.keys(coords).length === 0 && <p className="hint">A localizar eventos no mapa…</p>}
      {events.some((e) => needsLocation(e)) && (
        <p className="hint">Alguns eventos ainda não têm localização — associa-os na Gestão › Gestão de eventos.</p>
      )}
      {sel && (
        <div className="ev-mapsel">
          <div className="ev-mapsel-head">
            <strong>{sel.list.length} evento(s) neste local</strong>
            <button className="iconbtn" onClick={() => setSel(null)}>✕</button>
          </div>
          {sel.list.sort((a, b) => (b.dateStart || "").localeCompare(a.dateStart || "")).map((ev) => (
            <button key={ev.id} className="ev-mapsel-row" onClick={() => onOpen(ev.id)}>
              <span className="ev-dot" style={{ background: colorOf(ev) }} />
              <span className="ev-mapsel-name">{ev.name}</span>
              <span className="hint" style={{ margin: 0 }}>{fmtD(ev.dateStart)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   VISTA DE CALENDÁRIO
   ============================================================ */
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function CalendarView({ events, colorOf, onOpen }) {
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  const evByDay = useMemo(() => {
    const map = {};
    events.forEach((ev) => {
      const s = ev.dateStart; if (!s) return;
      const e = ev.dateEnd || ev.dateStart;
      let d = new Date(s + "T00:00:00"); const end = new Date(e + "T00:00:00");
      let guard = 0;
      while (d <= end && guard++ < 400) {
        const key = iso(d.getFullYear(), d.getMonth(), d.getDate());
        (map[key] = map[key] || []).push(ev);
        d.setDate(d.getDate() + 1);
      }
    });
    return map;
  }, [events]);

  const first = new Date(cur.y, cur.m, 1);
  const lead = (first.getDay() + 6) % 7;         // segunda = 0
  const days = new Date(cur.y, cur.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const todayKey = iso(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const shift = (delta) => setCur(({ y, m }) => {
    const nm = m + delta; return { y: y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
  });

  return (
    <div>
      <EventsExtraStyle />
      <div className="cal-head">
        <button className="btn ghost small" onClick={() => shift(-1)}>‹</button>
        <h3>{MESES[cur.m]} {cur.y}</h3>
        <button className="btn ghost small" onClick={() => shift(1)}>›</button>
        <button className="btn ghost small" onClick={() => { const d = new Date(); setCur({ y: d.getFullYear(), m: d.getMonth() }); }}>Hoje</button>
      </div>
      <div className="cal-grid cal-dow">
        {DIAS.map((d) => <div key={d} className="cal-dowcell">{d}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="cal-cell empty" />;
          const key = iso(cur.y, cur.m, d);
          const list = evByDay[key] || [];
          return (
            <div key={i} className={`cal-cell ${key === todayKey ? "today" : ""}`}>
              <span className="cal-daynum">{d}</span>
              <div className="cal-events">
                {list.slice(0, 4).map((ev) => (
                  <button key={ev.id} className="cal-ev" onClick={() => onOpen(ev.id)} title={ev.name}>
                    <span className="ev-dot" style={{ background: colorOf(ev) }} />
                    <span className="cal-ev-name">{ev.name}</span>
                  </button>
                ))}
                {list.length > 4 && <span className="hint" style={{ margin: 0 }}>+{list.length - 4}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   GESTÃO DE LOCALIZAÇÕES (Gestão › Gestão de eventos)
   ============================================================ */
export function EventLocationManager({ events, onSaveEvent, showToast }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const markLayer = useRef(null);
  const pickRef = useRef(null);
  const coords = useEventCoords(events);
  const [selId, setSelId] = useState(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [pick, setPick] = useState(null); // [lat,lng] escolhido no mapa
  const [busy, setBusy] = useState(false);

  const pending = events.filter((e) => needsLocation(e))
    .sort((a, b) => (b.dateStart || "").localeCompare(a.dateStart || ""));
  const placed = events.filter((e) => !needsLocation(e));

  function selectEvent(ev) {
    setSelId(ev.id); setName(ev.location || ""); setUrl(ev.locationUrl || ""); setPick(null);
  }

  /* mapa */
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    const map = L.map(boxRef.current, { scrollWheelZoom: false });
    mapRef.current = map;
    L.tileLayer(DARK_TILES, TILE_OPTS).addTo(map);
    map.setView([39.5, -8.0], 6); // Portugal
    markLayer.current = L.layerGroup().addTo(map);
    map.on("click", (e) => {
      if (!pickRef.current) return; // só marca quando há evento selecionado
      setPick([e.latlng.lat, e.latlng.lng]);
    });
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => { pickRef.current = selId; }, [selId]);

  /* desenha marcadores dos já colocados + o pin temporário */
  useEffect(() => {
    const map = mapRef.current, layer = markLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();
    placed.forEach((ev) => {
      const ll = coords[ev.id];
      if (!ll) return;
      const icon = L.divIcon({ className: "", html: `<div class="ev-pin small">•</div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
      L.marker(ll, { icon }).addTo(layer).bindTooltip(ev.name);
    });
    const p = pick || extractLatLng(url);
    if (p) {
      const icon = L.divIcon({ className: "", html: `<div class="ev-pin pickpin">✓</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      L.marker(p, { icon }).addTo(layer);
      map.panTo(p);
    }
  }, [coords, pick, url, selId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const ev = events.find((e) => e.id === selId);
    if (!ev) return;
    let ll = pick || extractLatLng(url);
    if (!ll && name.trim()) ll = await geocodeText(name.trim());
    if (!ll) { showToast("Sem localização — clica no mapa, cola um link do Google Maps com coordenadas, ou escreve um local reconhecível."); return; }
    setBusy(true);
    let loc = name.trim();
    if (!loc) loc = (await reverseGeocode(ll[0], ll[1])) || `${ll[0].toFixed(4)}, ${ll[1].toFixed(4)}`;
    const locationUrl = /google\.[^/]+\/maps/.test(url) && extractLatLng(url)
      ? url
      : `https://www.google.com/maps/search/?api=1&query=${ll[0]},${ll[1]}`;
    try {
      await onSaveEvent({ ...ev, location: loc, locationUrl });
      showToast("Localização associada.");
      setSelId(null); setName(""); setUrl(""); setPick(null);
    } catch (e) { console.error(e); showToast("Não foi possível guardar."); }
    setBusy(false);
  }

  return (
    <div>
      <EventsExtraStyle />
      <div className="evmgr">
        <div className="evmgr-list">
          <h4 style={{ marginTop: 0 }}>Por associar ({pending.length})</h4>
          {pending.length === 0 && <p className="hint">Todos os eventos têm localização. 🔥</p>}
          {pending.map((ev) => (
            <button key={ev.id} className={`evmgr-row ${selId === ev.id ? "on" : ""}`} onClick={() => selectEvent(ev)}>
              <span className="evmgr-name">{ev.name}</span>
              <span className="hint" style={{ margin: 0 }}>{fmtD(ev.dateStart)}</span>
            </button>
          ))}
          {placed.length > 0 && <p className="hint" style={{ marginTop: 12 }}>{placed.length} evento(s) já com localização (pontos no mapa).</p>}
        </div>

        <div className="evmgr-map-wrap">
          <div className="evmgr-map" ref={boxRef} />
          {selId ? (
            <div className="evmgr-form">
              <p className="hint" style={{ marginTop: 0 }}>
                A associar: <b>{events.find((e) => e.id === selId)?.name}</b> — clica no mapa para marcar, cola um link do Google Maps, ou escreve o nome do local.
              </p>
              <div className="row">
                <label>Nome do local<input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Casa do Pedro, Óbidos" /></label>
                <label>Link Google Maps<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://maps.google.com/…" /></label>
              </div>
              {(pick || extractLatLng(url)) && (
                <p className="hint">Coordenadas: {(pick || extractLatLng(url)).map((n) => n.toFixed(4)).join(", ")}</p>
              )}
              <div className="actions">
                <button className="btn ghost" onClick={() => { setSelId(null); setPick(null); }}>Cancelar</button>
                <button className="btn ember" disabled={busy} onClick={save}>{busy ? "A guardar…" : "Associar localização"}</button>
              </div>
            </div>
          ) : (
            <p className="hint">Escolhe um evento à esquerda para lhe associar uma localização.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- estilos ---------- */
function EventsExtraStyle() {
  return (
    <style>{`
      .ev-map, .evmgr-map { height: 420px; border-radius: 12px; border: 1px solid var(--line); overflow: hidden; position: relative; z-index: 0; }
      .evmgr-map { height: 380px; }
      .ev-pin { min-width: 30px; height: 30px; padding: 0 6px; border-radius: 999px; background: var(--ember); color: #1A0F08; font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 1px 6px rgba(0,0,0,.5); }
      .ev-pin.small { min-width: 18px; height: 18px; font-size: 12px; background: var(--gold); }
      .ev-pin.pickpin { background: #7FB069; }
      .ev-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
      .ev-mapsel { margin-top: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface2); padding: 10px 12px; }
      .ev-mapsel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
      .ev-mapsel-row { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: 0; color: inherit; padding: 6px 4px; cursor: pointer; border-radius: 6px; text-align: left; }
      .ev-mapsel-row:hover { background: rgba(255,255,255,.05); }
      .ev-mapsel-name { flex: 1; font-weight: 600; }

      .cal-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
      .cal-head h3 { margin: 0; min-width: 190px; }
      .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
      .cal-dow { margin-bottom: 6px; }
      .cal-dowcell { text-align: center; font-size: 12px; color: var(--muted); font-weight: 600; }
      .cal-cell { min-height: 96px; background: var(--surface2); border: 1px solid var(--line); border-radius: 8px; padding: 5px 6px; display: flex; flex-direction: column; gap: 4px; }
      .cal-cell.empty { background: transparent; border: 0; }
      .cal-cell.today { border-color: var(--ember); box-shadow: inset 0 0 0 1px var(--ember); }
      .cal-daynum { font-size: 12px; color: var(--muted); font-weight: 600; }
      .cal-events { display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
      .cal-ev { display: flex; align-items: center; gap: 5px; background: rgba(255,255,255,.05); border: 0; color: inherit; border-radius: 5px; padding: 2px 5px; cursor: pointer; text-align: left; }
      .cal-ev:hover { background: rgba(255,122,61,.18); }
      .cal-ev-name { font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      .evmgr { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
      .evmgr-list { max-height: 460px; overflow: auto; }
      .evmgr-row { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; background: var(--surface2); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer; color: inherit; text-align: left; }
      .evmgr-row.on { border-color: var(--ember); }
      .evmgr-name { font-weight: 600; }
      .evmgr-form { margin-top: 10px; }
      @media (max-width: 760px) {
        .evmgr { grid-template-columns: 1fr; }
        .cal-cell { min-height: 72px; }
      }
    `}</style>
  );
}
