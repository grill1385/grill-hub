import React, { useState, useEffect, useMemo, useRef } from "react";

/* ============================================================
   GRILLHUB
   - Consulta livre sem login; ADMIN entra com conta Supabase
     (email+password ou Google) para gerir
   - Dados em tabelas Supabase com RLS (ver src/api.js)
   ============================================================ */
import { api, supabase } from "./api.js";
import * as XLSX from "xlsx";
import FeriasTab from "./Ferias.jsx";
import MediaTab from "./Media.jsx";
import { CalendarView, EventsMap, EventLocationManager, EventSearch, needsLocation, extractLatLng } from "./EventsExtra.jsx";
import StatsView from "./Stats.jsx";

const SITE_URL = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";

/* ---------- Utilitários ---------- */
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

const todayISO = () => new Date().toISOString().slice(0, 10);

const daysSince = (iso) => (iso ? Math.max(0, Math.round((new Date(todayISO()) - new Date(iso)) / 86400000)) : 0);

function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const eur = (n) => `${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")} €`;

const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/* ---------- Emojis tipo Discord (:nome_do_emoji:) ---------- */
const EMOJI = {
  fire: "🔥", fogo: "🔥", tada: "🎉", festa: "🎉", parabens: "🎉", party: "🥳", festao: "🥳",
  birthday: "🎂", bolo: "🎂", cake: "🎂", balloon: "🎈", balao: "🎈", gift: "🎁", presente: "🎁",
  confetti: "🎊", heart: "❤️", coracao: "❤️", hearts: "💕", heart_eyes: "😍", sparkling_heart: "💖",
  beer: "🍺", cerveja: "🍺", beers: "🍻", cervejas: "🍻", wine: "🍷", vinho: "🍷", champagne: "🍾",
  cocktail: "🍸", whisky: "🥃", coffee: "☕", cafe: "☕", meat: "🍖", carne: "🍖", steak: "🥩",
  bife: "🥩", chicken: "🍗", frango: "🍗", pizza: "🍕", burger: "🍔", batatas: "🍟", fries: "🍟",
  grin: "😁", joy: "😂", rofl: "🤣", smile: "😄", sweat_smile: "😅", wink: "😉", sunglasses: "😎",
  fixe: "😎", thinking: "🤔", zany: "🤪", drool: "🤤", cry: "😢", sob: "😭", kiss: "😘", beijo: "😘",
  angel: "😇", devil: "😈", clown: "🤡", palhaco: "🤡", ghost: "👻", skull: "💀", caveira: "💀",
  poop: "💩", hot: "🥵", cold: "🥶", clap: "👏", palmas: "👏", muscle: "💪", forca: "💪",
  thumbsup: "👍", like: "👍", thumbsdown: "👎", ok_hand: "👌", pray: "🙏", wave: "👋",
  handshake: "🤝", eyes: "👀", olhos: "👀", rocket: "🚀", foguete: "🚀", star: "⭐", estrela: "⭐",
  sparkles: "✨", boom: "💥", zap: "⚡", rainbow: "🌈", sun: "☀️", sol: "☀️", moon: "🌙", lua: "🌙",
  crown: "👑", coroa: "👑", rei: "👑", trophy: "🏆", trofeu: "🏆", medal: "🏅", money: "💰",
  dinheiro: "💰", money_mouth: "🤑", gem: "💎", dance: "💃", dancar: "💃", man_dancing: "🕺",
  soccer: "⚽", bola: "⚽", gamepad: "🎮", dice: "🎲", dart: "🎯", guitar: "🎸", music: "🎵",
  musica: "🎵", mic: "🎤", camera: "📷", email: "📧", check: "✅", x: "❌", warning: "⚠️",
  bomb: "💣", knife: "🔪", chef: "👨‍🍳", velho: "👴", baby: "👶", plane: "✈️", aviao: "✈️",
  car: "🚗", carro: "🚗", van: "🚐", carrinha: "🚐", train: "🚆", comboio: "🚆", ship: "🚢",
  barco: "🚢", beach: "🏖️", praia: "🏖️", tent: "⛺", tenda: "⛺", mountain: "⛰️", montanha: "⛰️",
  "100": "💯",
};
const emojify = (t) => String(t || "").replace(/:([a-z0-9_+-]+):/gi, (all, name) => EMOJI[norm(name).replace(/-/g, "_")] || all);

const shareOf = (pu, mid) => {
  if (pu.split === "custom") {
    if (pu.parcels?.length) {
      let t = 0;
      pu.parcels.forEach((pc) => {
        const ms = pc.members || [];
        if (ms.length && ms.includes(mid)) t += (Number(pc.price) || 0) / ms.length;
      });
      return Math.round(t * 100) / 100;
    }
    return Math.round((Number(pu.shares?.[mid]) || 0) * 100) / 100;
  }
  return pu.participants?.length ? Math.round((pu.total / pu.participants.length) * 100) / 100 : 0;
};

/* Compensação de dívidas por pares (líquido).
   Considera só dívidas ainda por saldar e não reclamadas ("já paguei").
   Se A deve a B e B deve a A, fica só a diferença, na direção certa —
   quem, no líquido, passa a receber é considerado saldado.
   Não reencaminha dívidas por terceiros (mantém-se a pagar a quem pagou). */
function pairwiseNet(purchases, events) {
  const owe = {}; // owe[devedor][credor] = { amount, items: [{eventName, desc, amount, date}] }
  (purchases || []).forEach((pu) => {
    const payer = pu.payerId;
    if (!payer) return;
    const ev = (events || []).find((e) => e.id === pu.eventId);
    (pu.participants || []).forEach((mid) => {
      if (mid === payer) return;
      if (pu.settled?.[mid] || pu.claimed?.[mid]) return;
      const a = shareOf(pu, mid);
      if (a <= 0) return;
      owe[mid] = owe[mid] || {};
      const slot = (owe[mid][payer] = owe[mid][payer] || { amount: 0, items: [] });
      slot.amount += a;
      slot.items.push({ eventName: ev?.name || "?", desc: pu.description, amount: a, date: ev ? (ev.dateEnd || ev.dateStart) : null });
    });
  });
  const ids = [...new Set([...Object.keys(owe), ...Object.values(owe).flatMap((o) => Object.keys(o))])];
  const out = []; // {from, to, amount, items (dívidas do devedor), offsets (a abater), since}
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const x = ids[i], y = ids[j];
      const xy = owe[x]?.[y], yx = owe[y]?.[x];
      const net = Math.round((((xy?.amount) || 0) - ((yx?.amount) || 0)) * 100) / 100;
      if (net === 0) continue;
      const [from, to, fit, oit] = net > 0 ? [x, y, xy?.items || [], yx?.items || []] : [y, x, yx?.items || [], xy?.items || []];
      const dates = fit.map((it) => it.date).filter(Boolean).sort();
      out.push({ from, to, amount: Math.abs(net), items: fit, offsets: oit, since: dates[0] || null });
    }
  }
  return out;
}

function eventEndDate(ev) {
  return ev.dateEnd || ev.dateStart;
}

function nowHM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function getStatus(ev) {
  if (ev.status === "Concluído") return "Concluído";
  const end = eventEndDate(ev);
  if (end) {
    const today = todayISO();
    if (end < today) return "Concluído";
    if (end === today && ev.timeEnd && nowHM() >= ev.timeEnd) return "Concluído";
  }
  if (ev.status === "Planeado") return "Agendado"; // compatibilidade com dados antigos
  return ev.status || "Por planear";
}

/* "12/07/2026" + horas opcionais → "12/07/2026 · 14:00–18:00" */
function fmtDateRange(ev) {
  const base = `${fmtDate(ev.dateStart)}${ev.dateEnd ? ` → ${fmtDate(ev.dateEnd)}` : ""}`;
  const times = ev.timeStart && ev.timeEnd ? `${ev.timeStart}–${ev.timeEnd}`
    : ev.timeStart ? `a partir das ${ev.timeStart}`
    : ev.timeEnd ? `até às ${ev.timeEnd}` : "";
  return times ? `${base} · ${times}` : base;
}

const STATUS_STYLE = {
  "Concluído": { bg: "#2E3B2E", fg: "#9BC98F", dot: "#7FB069" },
  "Agendado": { bg: "#3B3220", fg: "#F5C168", dot: "#F5B841" },
  "Por planear": { bg: "#3A2C26", fg: "#F09A6A", dot: "#FF7A3D" },
};

function mapsHref(ev) {
  if (ev.locationUrl) return ev.locationUrl;
  if (ev.location) return `https://www.google.com/maps/search/${encodeURIComponent(ev.location)}`;
  return null;
}

/* ---------- Ícones (SVG inline) ---------- */
const Icon = {
  gear: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a2 2 0 1 1-4 0v-.09a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-.97H3a2 2 0 1 1 0-4h.09A1.6 1.6 0 0 0 4.56 9a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 8.84 4.7 1.6 1.6 0 0 0 9.81 3.23V3a2 2 0 1 1 4 0v.09c0 .64.38 1.21.97 1.47a1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77c.26.59.83.97 1.47.97H21a2 2 0 1 1 0 4h-.09c-.64 0-1.21.38-1.47.97Z" />
    </svg>
  ),
  flame: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" {...p}>
      <path d="M12 2s1 3-1.5 6C8.5 10.5 7 12.2 7 15a5 5 0 0 0 10 0c0-1.5-.5-2.6-1.2-3.7-.4 1-1 1.7-1.8 2.2.3-3.5-1-6.5-2-9.5Z" />
    </svg>
  ),
  pin: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="3" />
    </svg>
  ),
  x: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
};

/* ---------- Sequências de presença (streaks) ----------
   A chama aquece à medida que a sequência cresce. */
function streakTier(n) {
  if (n >= 30) return "#E8B4FF"; // violeta rosado — chama lendária (30+)
  if (n >= 10) return "#7FD4FF"; // brasa azul
  if (n >= 6) return "#FF4D2E";  // vermelho vivo
  if (n >= 3) return "#FF7A3D";  // laranja quente
  if (n >= 1) return "#F5B841";  // âmbar aceso
  return "#5A5048";              // apagado
}

function StreakFlame({ n, best, showZero = false, size = 15 }) {
  if (!n && !showZero) return null;
  const isRecord = n > 0 && n === best && best > 1;
  const title = n > 0
    ? `Em chamas: ${n} evento(s) seguido(s)${best && best !== n ? ` · recorde: ${best}` : ""}${isRecord ? " · melhor de sempre!" : ""}`
    : `Sem sequência ativa${best ? ` · recorde: ${best}` : ""}`;
  return (
    <span className={`streak ${n === 0 ? "cold" : ""} ${isRecord ? "record" : ""}`} title={title}>
      <span className="streak-flame" style={{ color: streakTier(n) }}>{Icon.flame({ width: size, height: size })}</span>
      <b>{n}</b>
    </span>
  );
}

/* Chama compacta para as tabelas laterais: quente = presença, cinza = falta ("traição"). */
function SideFlame({ n, cold }) {
  return (
    <span className={`streak ${cold ? "ash" : ""}`}>
      <span className="streak-flame" style={{ color: cold ? "#8A8078" : streakTier(n) }}>{Icon.flame({ width: 14, height: 14 })}</span>
      <b>{n}</b>
    </span>
  );
}

/* ============================================================ */
export default function App() {
  const [data, setData] = useState(null); // {admins, members, events, roles}
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("home");
  const [eventView, setEventView] = useState("timeline"); // 'lista' | 'timeline'
  const [eventSort, setEventSort] = useState("desc"); // 'desc' = recentes primeiro
  const [filterYear, setFilterYear] = useState("");
  const [filterMembers, setFilterMembers] = useState([]);
  const [showMemberFilter, setShowMemberFilter] = useState(false);

  const [modal, setModal] = useState(null); // {type, ...payload}
  const [toast, setToast] = useState(null);

  const myEmail = session?.user?.email?.toLowerCase() || null;
  const adminRow = data?.admins?.find((a) => a.email === myEmail);
  const isAdmin = !!adminRow;
  const isMain = !!adminRow?.is_main;
  const myMember = data?.members?.find((m) => (m.email || "").toLowerCase() === myEmail) || null;
  const avatarSrc = myMember?.avatarUrl || session?.user?.user_metadata?.avatar_url || null;
  const pendingProfiles = isAdmin
    ? (data?.profiles || []).filter((pr) => !pr.dismissed && !data.members.some((m) => (m.email || "").toLowerCase() === pr.email))
    : [];

  /* ---------- Carregar dados e sessão ---------- */
  useEffect(() => {
    (async () => {
      try {
        setData(await api.loadAll());
      } catch (e) {
        console.error(e);
        setData({ admins: [], members: [], events: [], roles: [], purchases: [], profiles: [], wishes: [], shames: [] });
      }
      setLoading(false);
    })();

    supabase.auth.getSession().then(({ data: { session: sess } }) => setSession(sess));
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      if (event === "PASSWORD_RECOVERY") setModal({ type: "newPassword" });
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    api.loadAll().then(setData).catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => {
    if (loading || !data) return;
    const id = new URLSearchParams(window.location.search).get("event");
    if (id && data.events.some((e) => e.id === id)) {
      setModal({ type: "eventDetail", id });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loading]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  /* ---------- Cálculos ---------- */
  const roleById = useMemo(() => {
    const m = {};
    (data?.roles || []).forEach((r) => (m[r.id] = r));
    return m;
  }, [data]);

  const scoreboard = useMemo(() => {
    if (!data) return [];
    const concluded = data.events
      .filter((e) => getStatus(e) === "Concluído")
      .sort((a, b) => (a.dateStart || "").localeCompare(b.dateStart || "")); // cronológico p/ sequências
    return data.members
      .map((mb) => {
        const eligible = concluded.filter((e) => !mb.joinDate || eventEndDate(e) >= mb.joinDate);
        const present = eligible.filter((e) => e.presences?.[mb.id]);
        const pct = eligible.length ? Math.round((present.length / eligible.length) * 100) : 0;
        // sequências consecutivas: streak = presença atual, bestStreak = recorde, absStreak = faltas seguidas agora.
        let run = 0, best = 0, arun = 0;
        eligible.forEach((e) => {
          if (e.presences?.[mb.id]) { run += 1; if (run > best) best = run; arun = 0; }
          else { arun += 1; run = 0; }
        });
        return { member: mb, pct, present: present.length, total: eligible.length,
          streak: run, bestStreak: best, absStreak: arun };
      })
      .sort((a, b) => b.pct - a.pct || b.present - a.present || a.member.name.localeCompare(b.member.name));
  }, [data]);

  const hallOfFame = useMemo(
    () => scoreboard.filter((r) => r.bestStreak > 1)
      .sort((a, b) => b.bestStreak - a.bestStreak || a.member.name.localeCompare(b.member.name))
      .slice(0, 6),
    [scoreboard]
  );
  const betrayals = useMemo(
    () => scoreboard.filter((r) => r.absStreak > 1)
      .sort((a, b) => b.absStreak - a.absStreak || a.member.name.localeCompare(b.member.name))
      .slice(0, 6),
    [scoreboard]
  );

  const sortedEventsAsc = useMemo(
    () => (data ? [...data.events].sort((a, b) => (a.dateStart || "").localeCompare(b.dateStart || "")) : []),
    [data]
  );

  const eventYears = useMemo(
    () => [...new Set(sortedEventsAsc.map((e) => (e.dateStart || "").slice(0, 4)).filter(Boolean))].sort(),
    [sortedEventsAsc]
  );

  const visibleEvents = useMemo(() => {
    let list = sortedEventsAsc;
    if (filterYear) list = list.filter((e) => (e.dateStart || "").startsWith(filterYear));
    if (filterMembers.length) list = list.filter((e) => filterMembers.every((id) => e.presences?.[id]));
    return eventSort === "desc" ? [...list].reverse() : list;
  }, [sortedEventsAsc, filterYear, filterMembers, eventSort]);

  /* dívidas líquidas por membro (públicas), com idade — para o badge do scoreboard */
  const debtMap = useMemo(() => {
    if (!data) return {};
    const map = {};
    pairwiseNet(data.purchases, data.events).forEach((sm) => {
      const days = daysSince(sm.since);
      const rec = (map[sm.from] = map[sm.from] || { days: 0, pairs: [] });
      rec.pairs.push({ to: sm.to, name: data.members.find((m) => m.id === sm.to)?.name || "?", amount: sm.amount, days });
      rec.days = Math.max(rec.days, days);
    });
    return map;
  }, [data]);

  const hierarchyTiers = useMemo(() => {
    if (!data?.roles.length) return [];
    const levels = [...new Set(data.roles.map((r) => r.level))].sort((a, b) => a - b);
    return levels.map((lv) => data.roles.filter((r) => r.level === lv));
  }, [data]);

  /* ---------- Ações ---------- */
  async function handleLogout() {
    await supabase.auth.signOut();
    if (tab === "admin") setTab("eventos");
  }

  async function upsertEvent(ev) {
    try {
      await api.saveEvent(ev);
      const events = data.events.some((e) => e.id === ev.id)
        ? data.events.map((e) => (e.id === ev.id ? ev : e))
        : [...data.events, ev];
      setData({ ...data, events });
      setModal(null);
      showToast("Evento guardado.");
    } catch (e) {
      console.error(e);
      const m = e?.message || "";
      if (/time_start|time_end|column|schema/i.test(m))
        showToast(`Faltam as colunas de hora no Supabase (corre setup-eventos-horas.sql e "notify pgrst, reload schema"). Detalhe: ${m}`);
      else showToast(`Não foi possível guardar o evento.${m ? ` (${m})` : ""}`);
    }
  }

  async function deleteEvent(id) {
    try {
      await api.deleteEvent(id);
      setData({ ...data, events: data.events.filter((e) => e.id !== id) });
      setModal(null);
      showToast("Evento eliminado.");
    } catch { showToast("Não foi possível eliminar o evento."); }
  }

  async function upsertMember(mb) {
    try {
      await api.saveMember(mb);
      const members = data.members.some((m) => m.id === mb.id)
        ? data.members.map((m) => (m.id === mb.id ? mb : m))
        : [...data.members, mb];
      setData({ ...data, members });
      setModal(null);
      showToast("Membro guardado.");
    } catch { showToast("Não foi possível guardar o membro."); }
  }

  async function deleteMember(id) {
    try {
      await api.deleteMember(id);
      const events = data.events.map((e) => {
        const p = { ...(e.presences || {}) };
        delete p[id];
        return { ...e, presences: p };
      });
      setData({ ...data, members: data.members.filter((m) => m.id !== id), events });
      setModal(null);
      showToast("Membro eliminado.");
    } catch { showToast("Não foi possível eliminar o membro."); }
  }

  async function saveRole(roleId, label, relation, refRoleId) {
    const existing = data.roles.find((r) => r.id === roleId);
    const others = data.roles.filter((r) => r.id !== roleId);
    let level = existing ? existing.level : 0;
    if (relation !== "manter" && others.length && refRoleId) {
      const ref = others.find((r) => r.id === refRoleId);
      if (ref) level = relation === "acima" ? ref.level - 1 : relation === "abaixo" ? ref.level + 1 : ref.level;
    }
    const role = { id: existing ? roleId : uid(), label: label.trim(), level };
    try {
      await api.saveRole(role);
      const roles = existing
        ? data.roles.map((r) => (r.id === role.id ? role : r))
        : [...data.roles, role];
      setData({ ...data, roles });
      setModal(null);
      showToast(existing ? "Cargo atualizado." : "Cargo adicionado.");
    } catch { showToast("Não foi possível guardar o cargo."); }
  }

  async function deleteRole(id) {
    try {
      await api.deleteRole(id);
      const members = data.members.map((m) => (m.roleId === id ? { ...m, roleId: null } : m));
      setData({ ...data, roles: data.roles.filter((r) => r.id !== id), members });
      setModal(null);
      showToast("Cargo eliminado.");
    } catch { showToast("Não foi possível eliminar o cargo."); }
  }

  async function saveEventPlace(pl) {
    try {
      const old = (data.places || []).find((x) => x.id === pl.id) || null;
      // links curtos do Maps não têm coords — expande-os para gravar já com coordenadas
      if (pl.url && !extractLatLng(pl.url)) {
        const ll = await api.resolveMaps(pl.url);
        if (ll) pl = { ...pl, url: `https://www.google.com/maps/search/?api=1&query=${ll[0]},${ll[1]}` };
      }
      await api.saveEventPlace(pl);
      const places = old ? data.places.map((x) => (x.id === pl.id ? pl : x)) : [...(data.places || []), pl];

      // cascata: eventos associados ao link antigo deste local passam a usar o novo
      let events = data.events;
      if (old && (old.url !== pl.url || old.name !== pl.name)) {
        const affected = data.events.filter((ev) => ev.locationUrl === old.url && (ev.location || "") === (old.name || ""));
        if (affected.length) {
          const updated = affected.map((ev) => ({ ...ev, location: pl.name, locationUrl: pl.url }));
          await Promise.all(updated.map((ev) => api.saveEvent(ev)));
          const map = Object.fromEntries(updated.map((ev) => [ev.id, ev]));
          events = data.events.map((ev) => map[ev.id] || ev);
          showToast(`Local guardado — ${affected.length} evento(s) atualizado(s).`);
        } else showToast("Local guardado.");
      } else showToast("Local guardado.");

      setData({ ...data, places, events });
    } catch (e) { console.error(e); showToast(`Não foi possível guardar o local.${/relation|table|schema|column/i.test(e?.message || "") ? " Corre setup-eventos-locais.sql no Supabase." : ""}`); }
  }
  async function deleteEventPlace(id) {
    try {
      await api.deleteEventPlace(id);
      setData({ ...data, places: (data.places || []).filter((x) => x.id !== id) });
      showToast("Local eliminado.");
    } catch (e) { console.error(e); showToast("Não foi possível eliminar o local."); }
  }

  async function addAdmin(email) {
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) return "Email inválido.";
    if (data.admins.some((a) => a.email === e)) return "Esse email já é admin.";
    try {
      await api.addAdmin(e);
      setData({ ...data, admins: [...data.admins, { email: e, is_main: false }] });
      showToast("Admin adicionado.");
      return null;
    } catch { return "Não foi possível adicionar."; }
  }

  async function removeAdmin(email) {
    try {
      await api.removeAdmin(email);
      setData({ ...data, admins: data.admins.filter((a) => a.email !== email) });
      showToast("Admin removido.");
    } catch { showToast("Não foi possível remover."); }
  }

  function shareEvent(ev) {
    const url = `https://grill1385.github.io/grill-hub/share/${encodeURIComponent(ev.id)}.html`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => showToast("Link copiado — cola no Discord!"),
        () => window.prompt("Copia o link:", url)
      );
    } else {
      window.prompt("Copia o link:", url);
    }
  }

  async function notifyEventMembers(ev) {
    showToast("A enviar avisos…");
    try {
      const { data: res, error } = await supabase.functions.invoke("notify-event", { body: { eventId: ev.id } });
      if (error || res?.error) throw error || new Error(res.error);
      showToast(`Aviso enviado a ${res.sent} de ${res.total} membro(s) com email.`);
    } catch {
      showToast("Não foi possível enviar — a função notify-event está configurada no Supabase?");
    }
  }

  async function mentionDiscord(payload, verbo) {
    showToast(`A enviar para o Discord…`);
    try {
      const res = await api.mentionDiscord(payload);
      let msg = `${verbo} no Discord!`;
      if (typeof res?.pinged === "number") msg += ` (${res.pinged} mencionado(s))`;
      if (res?.semDiscord?.length) msg += ` Sem Discord ligado: ${res.semDiscord.join(", ")}.`;
      showToast(msg);
    } catch (e) {
      showToast(`Não foi possível enviar — ${String(e?.message || e).slice(0, 90)}`);
    }
  }
  const shameOnDiscord = (mb) => mentionDiscord({ kind: "shame", memberId: mb.id }, `${mb.name} envergonhado(a)`);
  const announceEventDiscord = (ev) => mentionDiscord({ kind: "event", eventId: ev.id }, "Evento anunciado");
  const chargePurchaseDiscord = (pu) => mentionDiscord({ kind: "payment", purchaseId: pu.id }, "Cobrança enviada");
  const remindDebtsDiscord = (text, memberIds) => mentionDiscord({ kind: "custom", text, memberIds }, "Lembrete enviado");
  const shameDebtOnDiscord = (mb, info) => {
    const pairs = [...(info?.pairs || [])].sort((a, b) => b.amount - a.amount);
    const detalhe = pairs.map((pr) => `   • ${eur(pr.amount)} a ${pr.name}`).join("\n");
    const total = Math.round(pairs.reduce((acc, pr) => acc + pr.amount, 0) * 100) / 100;
    const quem = mb.discordId ? `<@${mb.discordId}>` : `**${mb.name}**`;
    const text = `😳🔥 **VERGONHA — contas por saldar** 🔥😳\n${quem} tem contas por saldar há **${info.days} dia${info.days === 1 ? "" : "s"}**:\n${detalhe}\nTotal: **${eur(total)}**\n\nPaga lá isso 👉 https://grill1385.github.io/grill-hub/`;
    mentionDiscord({ kind: "custom", text, memberIds: [mb.id] }, `${mb.name} envergonhado(a)`);
  };

  async function toggleConfirmation(ev) {
    if (!myMember) return;
    const next = !ev.confirmations?.[myMember.id];
    try {
      await api.setMyConfirmation(ev.id, next);
      setData({
        ...data,
        events: data.events.map((e) =>
          e.id === ev.id ? { ...e, confirmations: { ...(e.confirmations || {}), [myMember.id]: next } } : e
        ),
      });
      showToast(next ? "Presença confirmada!" : "Confirmação removida.");
    } catch { showToast("Não foi possível registar a confirmação."); }
  }

  async function saveMyProfile(f) {
    try {
      if (myMember) {
        await api.updateMyProfile(f.username.trim(), f.birthDate || null, f.avatarUrl.trim(), f.discordId.trim());
        setData({
          ...data,
          members: data.members.map((m) =>
            m.id === myMember.id
              ? { ...m, username: f.username.trim() || null, birthDate: f.birthDate || null, avatarUrl: f.avatarUrl.trim() || null, discordId: f.discordId.trim() || null }
              : m
          ),
        });
      }
      if (f.newPassword) {
        if (f.newPassword.length < 6) { showToast("Password com 6+ caracteres."); return; }
        const { error } = await supabase.auth.updateUser({ password: f.newPassword });
        if (error) { showToast("Não foi possível mudar a password."); return; }
      }
      setModal(null);
      showToast("Perfil atualizado.");
    } catch { showToast("Não foi possível guardar o perfil."); }
  }

  async function savePurchase(pu) {
    try {
      await api.savePurchase(pu);
      const purchases = data.purchases.some((p) => p.id === pu.id)
        ? data.purchases.map((p) => (p.id === pu.id ? pu : p))
        : [...data.purchases, pu];
      setData({ ...data, purchases });
      setModal({ type: "eventDetail", id: pu.eventId });
      showToast("Compra guardada.");
    } catch { showToast("Não foi possível guardar a compra."); }
  }

  async function deletePurchase(pu) {
    try {
      await api.deletePurchase(pu.id);
      setData({ ...data, purchases: data.purchases.filter((p) => p.id !== pu.id) });
      setModal({ type: "eventDetail", id: pu.eventId });
      showToast("Compra eliminada.");
    } catch { showToast("Não foi possível eliminar a compra."); }
  }

  async function sendBirthdayWish(memberId, message, emailToo) {
    if (!myMember) return;
    const w = { id: uid(), memberId, fromMemberId: myMember.id, year: new Date().getFullYear(), message: emojify((message || "").trim()), emailedAt: null };
    try {
      await api.saveBirthdayWish(w);
      const wishes = [...(data.wishes || []).filter((x) => !(x.memberId === memberId && x.fromMemberId === myMember.id && x.year === w.year)), w];
      setData({ ...data, wishes });
      setModal(null);
      showToast("Parabéns enviados! 🎉");
      if (emailToo) emailBirthdayWish(w);
    } catch { showToast("Não foi possível enviar os parabéns."); }
  }

  async function emailBirthdayWish(w) {
    showToast("A enviar email… 📧");
    try {
      await api.emailBirthdayWish(w.id);
      setData((d) => ({ ...d, wishes: (d.wishes || []).map((x) => (x.id === w.id ? { ...x, emailedAt: new Date().toISOString() } : x)) }));
      showToast("Parabéns enviados por email! 📧");
    } catch { showToast("Email falhou — a função birthday-wish está configurada no Supabase?"); }
  }

  async function shameMember(targetId) {
    if (!myMember || myMember.id === targetId) return;
    const info = debtMap[targetId];
    if (!info) return;
    const sh = {
      id: uid(), memberId: targetId, fromMemberId: myMember.id,
      amount: Math.round(info.pairs.reduce((acc, pr) => acc + pr.amount, 0) * 100) / 100,
      creditors: info.pairs.map((pr) => pr.name),
    };
    try {
      await api.saveShame(sh);
      setData({ ...data, shames: [...(data.shames || []), { ...sh, cleared: false }] });
      showToast("Vergonha lançada! 😈");
    } catch (e) {
      if (e?.code === "23505") showToast("Calma — já envergonhaste esse membro hoje 😄");
      else showToast("Não foi possível envergonhar (setup-vergonha.sql já correu?)");
    }
  }

  async function clearShame(id) {
    try {
      await api.clearShame(id);
      setData({ ...data, shames: (data.shames || []).map((x) => (x.id === id ? { ...x, cleared: true } : x)) });
    } catch { showToast("Não foi possível limpar."); }
  }

  async function importPurchases(evId, list) {
    try {
      for (const pu of list) await api.savePurchase(pu);
      setData({ ...data, purchases: [...data.purchases, ...list] });
      setModal({ type: "eventDetail", id: evId });
      showToast(`${list.length} compra(s) importada(s).`);
    } catch { showToast("A importação falhou a meio — verifica as contas do evento."); }
  }

  async function toggleSettled(pu, memberId) {
    const next = { ...pu, settled: { ...pu.settled, [memberId]: !pu.settled[memberId] } };
    try {
      await api.savePurchase(next);
      setData({ ...data, purchases: data.purchases.map((p) => (p.id === pu.id ? next : p)) });
    } catch { showToast("Não foi possível atualizar."); }
  }

  async function claimPayment(pu, memberId, value) {
    const next = { ...pu, claimed: { ...(pu.claimed || {}), [memberId]: value } };
    try {
      await api.claimPayment(pu.id, value);
      setData({ ...data, purchases: data.purchases.map((p) => (p.id === pu.id ? next : p)) });
      showToast(value ? "Registado — falta o credor confirmar." : "Registo de pagamento anulado.");
    } catch { showToast("Não foi possível registar o pagamento."); }
  }

  async function importEvents(parsedEvents, newMemberNames) {
    try {
      const nameToId = {};
      data.members.forEach((m) => (nameToId[norm(m.name)] = m.id));
      const created = newMemberNames.map((nm) => ({
        id: uid(), name: nm, email: null, birthDate: null, joinDate: null, roleId: null, username: null, avatarUrl: null,
      }));
      created.forEach((m) => (nameToId[norm(m.name)] = m.id));
      if (created.length) await api.saveMembers(created);
      const evs = parsedEvents.map((pe) => {
        const presences = {};
        pe.memberNames.forEach((nm) => { const id = nameToId[norm(nm)]; if (id) presences[id] = true; });
        return {
          id: uid(), name: pe.name, dateStart: pe.dateStart, dateEnd: pe.dateEnd || null,
          description: pe.description || "", location: pe.location || "", locationUrl: pe.locationUrl || "",
          status: pe.status, presences, confirmations: {},
        };
      });
      await api.saveEvents(evs);
      setData({ ...data, members: [...data.members, ...created], events: [...data.events, ...evs] });
      setModal(null);
      showToast(`${evs.length} evento(s) importado(s)${created.length ? `, ${created.length} membro(s) criado(s)` : ""}.`);
    } catch { showToast("A importação falhou. Verifica o ficheiro e tenta de novo."); }
  }

  async function dismissProfile(id) {
    try {
      await api.dismissProfile(id);
      setData({ ...data, profiles: data.profiles.map((p) => (p.id === id ? { ...p, dismissed: true } : p)) });
      showToast("Conta marcada como não-membro.");
    } catch { showToast("Não foi possível atualizar."); }
  }

  async function linkAccount(memberId, email) {
    const member = data.members.find((m) => m.id === memberId);
    if (!member) return;
    const next = { ...member, email: email.toLowerCase() };
    try {
      await api.saveMember(next);
      setData({ ...data, members: data.members.map((m) => (m.id === memberId ? next : m)) });
      showToast("Conta associada ao membro.");
    } catch { showToast("Não foi possível associar."); }
  }

  /* ---------- Render ---------- */
  if (loading) {
    return (
      <div className="grill-root grill-center">
        <Style />
        <div className="loading">{Icon.flame({ width: 28, height: 28 })}<span>A acender a brasa…</span></div>
      </div>
    );
  }

  return (
    <div className="grill-root">
      <Style />

      {/* ---------- Cabeçalho ---------- */}
      <header className="topbar">
        <button className="brand" onClick={() => setTab("home")} title="Início">
          <img className="logo-img" src="./logo.svg" alt="GrillHub" />
          <h1>GRILL<em>HUB</em></h1>
        </button>
        <div className="topbar-right">
          {session ? (
            <>
              <span className="userchip">
                {myMember?.name || session.user.user_metadata?.name || session.user.email}
                {isMain ? <b>ADMIN PRINCIPAL</b> : isAdmin ? <b>ADMIN</b> : null}
              </span>
              <button className="avatar-btn" title="A minha área" onClick={() => setModal({ type: "profile" })}>
                {avatarSrc ? <img src={avatarSrc} alt="" /> : <span>{(myMember?.name || session.user.email || "?").slice(0, 1).toUpperCase()}</span>}
              </button>
              <button className="btn ghost" onClick={handleLogout}>Sair</button>
            </>
          ) : (
            <button className="btn ember" onClick={() => setModal({ type: "login" })}>Entrar</button>
          )}
        </div>
      </header>

      <div className="layout">
        {/* ---------- Barra lateral ---------- */}
        <nav className="sidebar">
          {[
            ["home", "Home"],
            ["eventos", "Eventos"],
            ["ferias", "Férias do Grill"],
            ["scoreboard", "Scoreboard"],
            ["membros", "Membros"],
            ["media", "Media"],
            ["hierarquia", "Hierarquia"],
            ...(isAdmin ? [["admin", "Gestão"]] : []),
          ].map(([id, label]) => (
            <button key={id} className={`navbtn ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
              {label}
              {id === "admin" && pendingProfiles.length > 0 && <span className="badge">{pendingProfiles.length}</span>}
            </button>
          ))}
        </nav>

        {/* ---------- Conteúdo ---------- */}
        <main className={`content ${tab === "home" ? "wide" : ""} ${tab === "scoreboard" ? "wide-score" : ""}`}>
          {tab === "home" && (
            <HomeTab events={sortedEventsAsc} scoreboard={scoreboard} myMember={myMember}
              purchases={data.purchases} members={data.members}
              onOpenEvent={(id) => setModal({ type: "eventDetail", id })}
              onMember={(id) => setModal({ type: "memberDetail", id })}
              onConfirm={toggleConfirmation}
              onConfirmPayment={(pu, mid) => toggleSettled(pu, mid)}
              wishes={data.wishes || []}
              onWish={(mid) => setModal({ type: "birthdayWish", memberId: mid })}
              onEmailWish={emailBirthdayWish}
              shames={data.shames || []}
              onClearShame={clearShame}
              onDebtDetail={(pair, direction) => setModal({ type: "debtDetail", pair, direction })}
              onGoScoreboard={() => setTab("scoreboard")} />
          )}

          {tab === "ferias" && (
            <FeriasTab members={data.members} events={data.events} myMember={myMember}
              isAdmin={isAdmin} session={session} showToast={showToast} />
          )}

          {tab === "media" && (
            <MediaTab myMember={myMember} isAdmin={isAdmin} session={session} showToast={showToast} />
          )}

          {tab === "eventos" && (
            <section>
              <div className="section-head">
                <h2>Eventos</h2>
                <div className="head-actions">
                  <div className="segmented">
                    <button className={eventView === "lista" ? "on" : ""} onClick={() => setEventView("lista")}>Lista</button>
                    <button className={eventView === "timeline" ? "on" : ""} onClick={() => setEventView("timeline")}>Friso temporal</button>
                    <button className={eventView === "calendario" ? "on" : ""} onClick={() => setEventView("calendario")}>Calendário</button>
                    <button className={eventView === "mapa" ? "on" : ""} onClick={() => setEventView("mapa")}>Mapa</button>
                    <button className={eventView === "stats" ? "on" : ""} onClick={() => setEventView("stats")}>Estatísticas</button>
                  </div>
                  {isAdmin && <button className="btn ghost" onClick={() => setModal({ type: "importEvents" })}>Importar Excel</button>}
                  {isAdmin && <button className="btn ember" onClick={() => setModal({ type: "eventForm" })}>+ Evento</button>}
                </div>
              </div>

              <div className="filter-bar">
                <EventSearch events={data.events} colorOf={(ev) => STATUS_STYLE[getStatus(ev)].dot}
                  onOpen={(id) => setModal({ type: "eventDetail", id })} />
                <div className="segmented">
                  <button className={eventSort === "desc" ? "on" : ""} onClick={() => setEventSort("desc")}>Recentes primeiro</button>
                  <button className={eventSort === "asc" ? "on" : ""} onClick={() => setEventSort("asc")}>Antigos primeiro</button>
                </div>
                <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
                  <option value="">Todos os anos</option>
                  {eventYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <button className={`btn ghost small ${filterMembers.length ? "active-filter" : ""}`} onClick={() => setShowMemberFilter(!showMemberFilter)}>
                  Filtrar por membros{filterMembers.length ? ` (${filterMembers.length})` : ""}
                </button>
                {(filterYear || filterMembers.length > 0) && (
                  <button className="btn ghost small" onClick={() => { setFilterYear(""); setFilterMembers([]); }}>Limpar filtros</button>
                )}
                {(filterYear || filterMembers.length > 0) && (
                  <span className="hint" style={{ margin: 0 }}>{visibleEvents.length} evento(s)</span>
                )}
              </div>
              {showMemberFilter && (
                <div className="pill-row" style={{ marginBottom: 16 }}>
                  {data.members.map((m) => (
                    <button key={m.id} className={`pill ${filterMembers.includes(m.id) ? "on" : ""}`}
                      onClick={() => setFilterMembers(filterMembers.includes(m.id) ? filterMembers.filter((x) => x !== m.id) : [...filterMembers, m.id])}>
                      {m.name}
                    </button>
                  ))}
                  {filterMembers.length > 1 && <span className="hint" style={{ margin: 0 }}>Eventos em que todos os selecionados estiveram presentes.</span>}
                </div>
              )}

              {sortedEventsAsc.length === 0 && (
                <p className="empty">Ainda não há eventos. {isAdmin ? "Adiciona o primeiro com o botão + Evento." : "O ADMIN ainda não acendeu a grelha."}</p>
              )}
              {sortedEventsAsc.length > 0 && visibleEvents.length === 0 && (
                <p className="empty">Nenhum evento corresponde aos filtros.</p>
              )}

              {eventView === "stats" ? (
                <StatsView events={data.events} members={data.members} />
              ) : eventView === "calendario" ? (
                <CalendarView events={visibleEvents} colorOf={(ev) => STATUS_STYLE[getStatus(ev)].dot}
                  onOpen={(id) => setModal({ type: "eventDetail", id })} />
              ) : eventView === "mapa" ? (
                <EventsMap events={visibleEvents} colorOf={(ev) => STATUS_STYLE[getStatus(ev)].dot}
                  onOpen={(id) => setModal({ type: "eventDetail", id })} />
              ) : eventView === "lista" ? (
                <div className="cards">
                  {visibleEvents.map((ev) => (
                    <EventCard key={ev.id} ev={ev} isAdmin={isAdmin}
                      onOpen={() => setModal({ type: "eventDetail", id: ev.id })}
                      onEdit={() => setModal({ type: "eventForm", id: ev.id })} />
                  ))}
                </div>
              ) : (
                <div className="skewer">
                  {visibleEvents.map((ev, i) => (
                    <div key={ev.id} className={`skewer-item ${i % 2 ? "right" : "left"}`}>
                      <span className="skewer-dot" style={{ background: STATUS_STYLE[getStatus(ev)].dot }} />
                      <div className="skewer-date">{fmtDate(ev.dateStart)}{ev.dateEnd ? ` → ${fmtDate(ev.dateEnd)}` : ""}</div>
                      <EventCard ev={ev} isAdmin={isAdmin} compact
                        onOpen={() => setModal({ type: "eventDetail", id: ev.id })}
                        onEdit={() => setModal({ type: "eventForm", id: ev.id })} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {tab === "scoreboard" && (
            <section>
              <div className="section-head"><h2>Scoreboard de presenças</h2></div>
              {scoreboard.length === 0 && <p className="empty">Sem membros ainda.</p>}
              <div className="score-layout">
                <div>
                  <div className="board">
                    {scoreboard.map((row, i) => (
                      <button key={row.member.id} className="board-row" onClick={() => setModal({ type: "memberDetail", id: row.member.id })}>
                        <span className={`rank r${i + 1}`}>{i + 1}</span>
                        <span className="board-name">
                          {row.member.name}
                          {debtMap[row.member.id]?.days >= 7 && (
                            <DebtBadge info={debtMap[row.member.id]}
                              canShame={!!myMember && myMember.id !== row.member.id}
                              onShame={() => shameMember(row.member.id)}
                              canShameDiscord={isAdmin && !!row.member.discordId}
                              onShameDiscord={() => shameDebtOnDiscord(row.member, debtMap[row.member.id])} />
                          )}
                          {row.member.username && <span className="uname">@{row.member.username}</span>}
                        </span>
                        <span className="board-bar"><i style={{ width: `${row.pct}%` }} /></span>
                        <StreakFlame n={row.streak} best={row.bestStreak} showZero />
                        <span className="board-pct">{row.pct}%</span>
                        <span className="board-count">{row.present}/{row.total}</span>
                      </button>
                    ))}
                  </div>
                  <p className="hint">Percentagem calculada sobre eventos concluídos desde a data de integração de cada membro (sem data de integração, contam todos).</p>
                </div>

                <aside className="score-side">
                  <div className="side-panel">
                    <h3>🏆 Hall of Fame</h3>
                    <p className="side-sub">Maiores sequências de presença de sempre</p>
                    {hallOfFame.length === 0 ? (
                      <p className="hint" style={{ margin: 0 }}>Ainda sem sequências dignas de fama.</p>
                    ) : hallOfFame.map((row, i) => (
                      <button key={row.member.id} className="hof-row" onClick={() => setModal({ type: "memberDetail", id: row.member.id })}>
                        <span className={`hof-rank r${i + 1}`}>{i + 1}</span>
                        <span className="hof-name">{row.member.name}</span>
                        <SideFlame n={row.bestStreak} />
                      </button>
                    ))}
                  </div>

                  <div className="side-panel">
                    <h3>🗡️ Maiores Traições</h3>
                    <p className="side-sub">Faltas seguidas neste momento</p>
                    {betrayals.length === 0 ? (
                      <p className="hint" style={{ margin: 0 }}>Ninguém anda a trair a brasa. Por enquanto.</p>
                    ) : betrayals.map((row, i) => (
                      <button key={row.member.id} className="hof-row" onClick={() => setModal({ type: "memberDetail", id: row.member.id })}>
                        <span className="hof-rank">{i + 1}</span>
                        <span className="hof-name">{row.member.name}</span>
                        <SideFlame n={row.absStreak} cold />
                      </button>
                    ))}
                  </div>
                </aside>
              </div>
            </section>
          )}

          {tab === "membros" && (
            <section>
              <div className="section-head">
                <h2>Membros do Grill</h2>
                {isAdmin && <button className="btn ember" onClick={() => setModal({ type: "memberForm" })}>+ Membro</button>}
              </div>
              {data.members.length === 0 && <p className="empty">Sem membros registados.</p>}
              <div className="cards grid2">
                {data.members.map((mb) => (
                  <div key={mb.id} className="card member-card" onClick={() => setModal({ type: "memberDetail", id: mb.id })}>
                    {mb.avatarUrl
                      ? <img className="avatar avatar-img" src={mb.avatarUrl} alt="" />
                      : <div className="avatar">{mb.name.slice(0, 1).toUpperCase()}</div>}
                    <div className="member-info">
                      <strong>{mb.name}</strong>
                      {mb.username && <span className="uname">@{mb.username}</span>}
                      <span>{roleById[mb.roleId]?.label || "Sem cargo"}</span>
                    </div>
                    {isAdmin && (
                      <button className="iconbtn" title="Editar" onClick={(e) => { e.stopPropagation(); setModal({ type: "memberForm", id: mb.id }); }}>
                        {Icon.gear({})}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "hierarquia" && (
            <section>
              <div className="section-head">
                <h2>Hierarquia de cargos</h2>
                {isAdmin && <button className="btn ember" onClick={() => setModal({ type: "roleForm" })}>+ Cargo</button>}
              </div>
              {hierarchyTiers.length === 0 && <p className="empty">Ainda não há cargos definidos.</p>}
              <div className="tree">
                {hierarchyTiers.map((tier, i) => (
                  <div key={i} className="tier">
                    {i > 0 && <div className="tier-link" />}
                    <div className="tier-roles">
                      {tier.map((r) => (
                        <div key={r.id} className="role-chip">
                          {r.label}
                          <span className="role-count">{data.members.filter((m) => m.roleId === r.id).length}</span>
                          {isAdmin && (
                            <button className="iconbtn" title="Editar cargo" onClick={() => setModal({ type: "roleForm", id: r.id })}>
                              {Icon.gear({ width: 13, height: 13 })}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "admin" && isAdmin && (
            <AdminPanel admins={data.admins} isMain={isMain} pendingProfiles={pendingProfiles}
              members={data.members} onLink={linkAccount} onDismiss={dismissProfile}
              onAddAdmin={addAdmin} onRemoveAdmin={removeAdmin}
              events={data.events} onSaveEvent={upsertEvent} showToast={showToast}
              places={data.places || []} onSavePlace={saveEventPlace} onDeletePlace={deleteEventPlace}
              onEditEvent={(id) => setModal({ type: "eventForm", id })} />
          )}
        </main>
      </div>

      {/* ---------- Modais ---------- */}
      {modal?.type === "login" && <LoginModal onClose={() => setModal(null)} />}
      {modal?.type === "newPassword" && <NewPasswordModal onClose={() => setModal(null)} onDone={() => showToast("Password atualizada.")} />}
      {modal?.type === "profile" && (
        <ProfileModal myMember={myMember} email={session?.user?.email} onSave={saveMyProfile} onClose={() => setModal(null)} />
      )}

      {modal?.type === "eventDetail" && (() => {
        const ev = data.events.find((e) => e.id === modal.id);
        if (!ev) return null;
        return <EventDetailModal ev={ev} members={data.members} isAdmin={isAdmin} myMember={myMember}
          purchases={data.purchases.filter((p) => p.eventId === ev.id)}
          onEdit={() => setModal({ type: "eventForm", id: ev.id })}
          onMember={(id) => setModal({ type: "memberDetail", id })}
          onConfirm={() => toggleConfirmation(ev)}
          onNotify={() => notifyEventMembers(ev)}
          onDiscordEvent={() => announceEventDiscord(ev)}
          onDiscordPayment={(pu) => chargePurchaseDiscord(pu)}
          onDiscordDebts={remindDebtsDiscord}
          onShare={() => shareEvent(ev)}
          onAddPurchase={() => setModal({ type: "purchaseForm", eventId: ev.id })}
          onEditPurchase={(pid) => setModal({ type: "purchaseForm", eventId: ev.id, id: pid })}
          onImportPurchases={() => setModal({ type: "importPurchases", eventId: ev.id })}
          onToggleSettled={toggleSettled}
          onClaim={claimPayment}
          onClose={() => setModal(null)} />;
      })()}

      {modal?.type === "eventForm" && (
        <EventFormModal ev={data.events.find((e) => e.id === modal.id)} members={data.members} places={data.places || []}
          onSave={upsertEvent} onDelete={deleteEvent} onClose={() => setModal(null)} />
      )}

      {modal?.type === "memberDetail" && (() => {
        const mb = data.members.find((m) => m.id === modal.id);
        if (!mb) return null;
        const attended = sortedEventsAsc.filter((e) => e.presences?.[mb.id]);
        const row = scoreboard.find((r) => r.member.id === mb.id);
        return <MemberDetailModal mb={mb} role={roleById[mb.roleId]} attended={attended} row={row}
          isAdmin={isAdmin} onShame={() => shameOnDiscord(mb)}
          onEvent={(id) => setModal({ type: "eventDetail", id })} onClose={() => setModal(null)} />;
      })()}

      {modal?.type === "memberForm" && (
        <MemberFormModal mb={data.members.find((m) => m.id === modal.id)} roles={data.roles}
          onSave={upsertMember} onDelete={deleteMember} onClose={() => setModal(null)} />
      )}

      {modal?.type === "importEvents" && (
        <ImportEventsModal members={data.members} onImport={importEvents} onClose={() => setModal(null)} />
      )}

      {modal?.type === "purchaseForm" && (() => {
        const ev = data.events.find((e) => e.id === modal.eventId);
        if (!ev) return null;
        const pu = data.purchases.find((p) => p.id === modal.id);
        return <PurchaseFormModal ev={ev} purchase={pu} members={data.members} isAdmin={isAdmin} myMember={myMember}
          onSave={savePurchase} onDelete={deletePurchase}
          onClose={() => setModal({ type: "eventDetail", id: ev.id })} />;
      })()}

      {modal?.type === "debtDetail" && modal.pair && (
        <DebtDetailModal pair={modal.pair} direction={modal.direction} myName={myMember?.name} onClose={() => setModal(null)} />
      )}

      {modal?.type === "birthdayWish" && (() => {
        const mb = data.members.find((m) => m.id === modal.memberId);
        if (!mb) return null;
        return <BirthdayWishModal member={mb} onSend={(msg) => sendBirthdayWish(mb.id, msg)} onClose={() => setModal(null)} />;
      })()}

      {modal?.type === "importPurchases" && (() => {
        const ev = data.events.find((e) => e.id === modal.eventId);
        if (!ev) return null;
        return <ImportPurchasesModal ev={ev} members={data.members} myMember={myMember}
          onImport={(list) => importPurchases(ev.id, list)}
          onClose={() => setModal({ type: "eventDetail", id: ev.id })} />;
      })()}

      {modal?.type === "roleForm" && (
        <RoleFormModal roles={data.roles} role={data.roles.find((r) => r.id === modal.id)}
          onSave={saveRole} onDelete={deleteRole} onClose={() => setModal(null)} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ============================================================
   Componentes
   ============================================================ */

/* Badge público de dívidas antigas (7d amarelo, 15d laranja, 30d vermelho, 60d preto brilhante) */
function DebtBadge({ info, canShame, onShame, canShameDiscord, onShameDiscord }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [open]);
  const d = info.days;
  const tier = d >= 60 ? "t60" : d >= 30 ? "t30" : d >= 15 ? "t15" : "t7";
  return (
    <span ref={ref} className={`debt-badge ${tier} ${open ? "open" : ""}`} title="Clica para fixar"
      onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
      €
      <span className="debt-tip">
        <b>Contas por saldar há {info.days} dia{info.days === 1 ? "" : "s"} 💸</b>
        {info.pairs.map((pr) => (
          <span key={pr.to}>Deve <b>{eur(pr.amount)}</b> a {pr.name}{pr.days > 0 ? ` · há ${pr.days} dia${pr.days === 1 ? "" : "s"}` : ""}</span>
        ))}
        {canShame && (
          <span className="pill shame-btn" role="button"
            onClick={(e) => { e.stopPropagation(); onShame(); }}>
            Envergonha 😳
          </span>
        )}
        {canShameDiscord && (
          <span className="pill shame-btn" role="button" title="Envergonhar publicamente no Discord"
            onClick={(e) => { e.stopPropagation(); onShameDiscord(); }}>
            No Discord 💬😳
          </span>
        )}
      </span>
    </span>
  );
}

/* Sumário do líquido entre mim e outro membro, evento a evento */
function DebtDetailModal({ pair, direction, myName, onClose }) {
  const gross = Math.round(pair.items.reduce((acc, it) => acc + it.amount, 0) * 100) / 100;
  const offset = Math.round(pair.offsets.reduce((acc, it) => acc + it.amount, 0) * 100) / 100;
  const title = direction === "pay" ? `Deves ${eur(pair.amount)} a ${pair.name}` : `${pair.name} deve-te ${eur(pair.amount)}`;
  return (
    <Modal title={title} onClose={onClose}>
      <h4 style={{ marginTop: 0 }}>{direction === "pay" ? `O que deves a ${pair.name}` : `O que ${pair.name} te deve`} ({eur(gross)})</h4>
      <div className="mini-list">
        {pair.items.map((it, i) => (
          <div key={i} className="mini-item" style={{ cursor: "default" }}>
            <span>{it.eventName} — {it.desc}</span>
            <span className="mini-date">{eur(it.amount)}{it.date ? ` · ${fmtDate(it.date)}` : ""}</span>
          </div>
        ))}
      </div>
      {pair.offsets.length > 0 && (
        <>
          <h4>A abater — {direction === "pay" ? `o que ${pair.name} te deve` : `o que deves a ${pair.name}`} ({eur(offset)})</h4>
          <div className="mini-list">
            {pair.offsets.map((it, i) => (
              <div key={i} className="mini-item" style={{ cursor: "default" }}>
                <span>{it.eventName} — {it.desc}</span>
                <span className="mini-date">− {eur(it.amount)}{it.date ? ` · ${fmtDate(it.date)}` : ""}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="hint"><b>Líquido: {eur(gross)} − {eur(offset)} = {eur(pair.amount)}</b>{direction === "pay" ? ` a pagar a ${pair.name}` : ` a receber de ${pair.name}`}.</p>
    </Modal>
  );
}

function HomeTab({ events, scoreboard, myMember, purchases, members, onOpenEvent, onMember, onConfirm, onConfirmPayment, wishes, onWish, onEmailWish, shames, onClearShame, onDebtDetail, onGoScoreboard }) {
  const myShames = myMember ? (shames || []).filter((sh) => sh.memberId === myMember.id && !sh.cleared) : [];
  /* aniversários: hoje e daqui a 1 semana (por mês-dia da data de nascimento) */
  const bdayYear = new Date().getFullYear();
  const todayMD = todayISO().slice(5);
  const in7MD = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(5, 10); })();
  const bdayToday = members.filter((m) => m.birthDate && m.birthDate.slice(5) === todayMD);
  const bdaySoon = members.filter((m) => m.birthDate && m.birthDate.slice(5) === in7MD);
  const isMyBday = !!myMember && bdayToday.some((m) => m.id === myMember.id);
  const myBdayWishes = myMember
    ? (wishes || []).filter((w) => w.memberId === myMember.id && w.year === bdayYear && w.fromMemberId !== myMember.id)
    : [];
  /* net por par, já compensado em todos os eventos: a pagar e a receber, com idade da dívida */
  const myNet = useMemo(() => {
    if (!myMember) return { pay: [], receive: [], total: 0, receiveTotal: 0 };
    const net = pairwiseNet(purchases, events);
    const deco = (sm, otherId) => {
      const m = members.find((x) => x.id === otherId);
      return { ...sm, otherId, name: m?.name || "?", email: m?.email || null, days: daysSince(sm.since) };
    };
    const pay = net.filter((sm) => sm.from === myMember.id).map((sm) => deco(sm, sm.to)).sort((a, b) => b.amount - a.amount);
    const receive = net.filter((sm) => sm.to === myMember.id).map((sm) => deco(sm, sm.from)).sort((a, b) => b.amount - a.amount);
    const total = Math.round(pay.reduce((acc, x) => acc + x.amount, 0) * 100) / 100;
    const receiveTotal = Math.round(receive.reduce((acc, x) => acc + x.amount, 0) * 100) / 100;
    return { pay, receive, total, receiveTotal };
  }, [purchases, events, members, myMember]);

  /* lembrete por email aos meus devedores, com descritivo por evento/compra e compensações */
  const reminderHref = useMemo(() => {
    if (!myMember) return null;
    const withEmail = myNet.receive.filter((d) => d.email);
    if (!withEmail.length) return null;
    const body = withEmail.map((d) => {
      const lines = [`${d.name} — líquido a pagar a ${myMember.name}: ${eur(d.amount)}${d.days > 0 ? ` (há ${d.days} dia${d.days === 1 ? "" : "s"})` : ""}`];
      d.items.forEach((it) => lines.push(`  • ${it.eventName} — ${it.desc}: ${eur(it.amount)}${it.date ? ` (${fmtDate(it.date)})` : ""}`));
      if (d.offsets.length) {
        lines.push(`  A abater (o que ${myMember.name} deve a ${d.name} de outros eventos):`);
        d.offsets.forEach((it) => lines.push(`  − ${it.eventName} — ${it.desc}: ${eur(it.amount)}`));
      }
      return lines.join("\n");
    }).join("\n\n");
    return `mailto:${withEmail.map((d) => d.email).join(",")}?subject=${encodeURIComponent(`GrillHub — contas por saldar com ${myMember.name}`)}&body=${encodeURIComponent(`Olá! Ficam as contas por saldar com ${myMember.name} (valores já compensados entre eventos):\n\n${body}\n\nDetalhes: https://grill1385.github.io/grill-hub/`)}`;
  }, [myMember, myNet]);
  /* pagamentos que dizem ter-me feito (sou o credor) e faltam confirmar */
  const toConfirm = useMemo(() => {
    if (!myMember) return [];
    const items = [];
    (purchases || []).forEach((pu) => {
      if (pu.payerId !== myMember.id) return;
      (pu.participants || []).forEach((mid) => {
        if (mid === pu.payerId || pu.settled?.[mid] || !pu.claimed?.[mid]) return;
        const ev = events.find((e) => e.id === pu.eventId);
        items.push({
          pu, mid, eventName: ev?.name || "?", desc: pu.description,
          amount: shareOf(pu, mid), name: members.find((m) => m.id === mid)?.name || "?",
        });
      });
    });
    return items;
  }, [purchases, events, members, myMember]);
  const anchor = useMemo(() => {
    let a = -1;
    events.forEach((e, i) => { if (getStatus(e) === "Concluído") a = i; });
    return a;
  }, [events]);
  const [offset, setOffset] = useState(0); // 0 = presente
  const [dir, setDir] = useState(0);
  const maxOffset = Math.max(0, anchor);
  const k = Math.min(Math.max(0, offset), maxOffset);
  const idxLeft = anchor - k;
  const leftEv = idxLeft >= 0 ? events[idxLeft] : null;
  const centerEvs = events.slice(idxLeft + 1, idxLeft + 4);
  const rightEv = k > 0 ? events[idxLeft + 4] || null : null;
  const todo = myMember
    ? events.filter((e) => getStatus(e) !== "Concluído" && !e.confirmations?.[myMember.id])
    : [];
  const top5 = scoreboard.slice(0, 5);
  const hottest = useMemo(
    () => scoreboard.filter((r) => r.streak >= 3).sort((a, b) => b.streak - a.streak)[0] || null,
    [scoreboard]
  );

  function move(d) {
    const nk = Math.min(Math.max(0, k + d), maxOffset);
    if (nk !== k) { setDir(d); setOffset(nk); }
  }

  const card = (ev, fade = 0, big = false) => {
    const st = getStatus(ev); const sty = STATUS_STYLE[st];
    return (
      <div key={ev.id} className={`tl-card fade-${fade} ${big ? "big" : ""}`} onClick={() => onOpenEvent(ev.id)}>
        <div className="tl-date">{fmtDateRange(ev)}</div>
        <strong>{ev.name}</strong>
        <div className="tl-meta">
          <span className="status" style={{ background: sty.bg, color: sty.fg }}><i style={{ background: sty.dot }} />{st}</span>
          {ev.location && <span className="loc">{Icon.pin({})} {ev.location}</span>}
        </div>
        <div className="tl-foot">
          {st === "Concluído" ? (
            <span className="hint">{Object.values(ev.presences || {}).filter(Boolean).length} presenças</span>
          ) : (
            <>
              <span className="hint">{Object.values(ev.confirmations || {}).filter(Boolean).length} confirmados</span>
              {myMember && (
                <button className={`pill ${ev.confirmations?.[myMember.id] ? "on" : ""}`}
                  onClick={(e) => { e.stopPropagation(); onConfirm(ev); }}>
                  {ev.confirmations?.[myMember.id] ? "✓ Vou!" : "Confirmar"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="home2">
      <div className={`tl-labels tl-c${Math.min(3, centerEvs.length)}`}>
        <h4>{k === 0 ? "Últimos eventos" : `Linha temporal · ${k} para trás`}</h4>
        <h4>{k === 0 ? "Próximos eventos" : ""}</h4>
        <h4>{k === 0 ? "Por confirmar" : ""}</h4>
      </div>
      <div className={`tl-row tl-c${Math.min(3, centerEvs.length)} ${dir > 0 ? "slide-past" : dir < 0 ? "slide-future" : ""}`} key={`k${k}`}>
        <div className="tl-slot tl-left">
          {leftEv ? card(leftEv, 0, true) : <div className="tl-card empty-card"><p className="hint">Ainda sem eventos concluídos.</p></div>}
          <div className="tl-arrows">
            <button className="arrow" disabled={k >= maxOffset} onClick={() => move(1)} title="Recuar no tempo">‹</button>
            <button className="arrow" disabled={k <= 0} onClick={() => move(-1)} title="Avançar no tempo">›</button>
          </div>
        </div>
        <div className="tl-slot tl-center">
          {centerEvs.length
            ? centerEvs.map((ev, i) => card(ev, i))
            : <div className="tl-card empty-card"><p className="hint">Sem próximos eventos.</p></div>}
        </div>
        <div className="tl-slot tl-right">
          {k === 0 ? (
            <>
            <div className="todo-panel2">
              <h4 style={{ marginTop: 0 }}>Futuros eventos</h4>
              {!myMember && <p className="hint">Entra com a tua conta de membro para confirmares presenças.</p>}
              {myMember && todo.length === 0 && <p className="hint">Tudo confirmado — brasa à vista!</p>}
              {myMember && todo.map((ev) => (
                <div key={ev.id} className="todo-item">
                  <button className="todo-name" onClick={() => onOpenEvent(ev.id)}>{ev.name}</button>
                  <span className="mini-date">{fmtDate(ev.dateStart)}</span>
                  <button className="pill" onClick={() => onConfirm(ev)}>Confirmar presença</button>
                </div>
              ))}
            </div>
            <div className="todo-panel2">
              <h4 style={{ marginTop: 0 }}>Contas</h4>
              {!myMember && <p className="hint">Entra com a tua conta de membro para veres as tuas contas.</p>}
              {myMember && myNet.pay.length === 0 && myNet.receive.length === 0 && toConfirm.length === 0 && <p className="hint">Sem contas por saldar.</p>}
              {myMember && myNet.pay.length > 0 && (
                <div className="debt-grid">
                  {myNet.pay.map((d) => (
                    <button key={d.otherId} type="button" className="debt-cell" title="Ver detalhe por evento"
                      onClick={() => onDebtDetail(d, "pay")}>
                      <span className="debt-cell-name">{d.name}</span>
                      <span className="debt-line">deves <b>{eur(d.amount)}</b></span>
                      {d.days > 0 && <span className="debt-age">há {d.days} dia{d.days === 1 ? "" : "s"}</span>}
                    </button>
                  ))}
                </div>
              )}
              {myMember && myNet.pay.length > 1 && (
                <p className="hint" style={{ margin: "2px 0 0" }}>Total a pagar (compensado): <b>{eur(myNet.total)}</b></p>
              )}
              {myMember && myNet.receive.length > 0 && (
                <>
                  <h4>Contas a receber 💰</h4>
                  <div className="debt-grid">
                    {myNet.receive.map((d) => (
                      <button key={d.otherId} type="button" className="debt-cell" title="Ver detalhe por evento"
                        onClick={() => onDebtDetail(d, "receive")}>
                        <span className="debt-cell-name">{d.name}</span>
                        <span className="debt-line">deve-te <b>{eur(d.amount)}</b></span>
                        {d.days > 0 && <span className="debt-age">há {d.days} dia{d.days === 1 ? "" : "s"}</span>}
                      </button>
                    ))}
                  </div>
                  {myNet.receive.length > 1 && (
                    <p className="hint" style={{ margin: "2px 0 0" }}>Total a receber (compensado): <b>{eur(myNet.receiveTotal)}</b></p>
                  )}
                  {reminderHref && (
                    <a className="btn ghost small" href={reminderHref} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", marginTop: 8 }}>
                      Enviar lembrete por email 📧
                    </a>
                  )}
                </>
              )}
              {myMember && toConfirm.length > 0 && (
                <>
                  <h4>Pagamentos a confirmar</h4>
                  {toConfirm.map((c) => (
                    <div key={`${c.pu.id}-${c.mid}`} className="todo-item">
                      <button className="todo-name" onClick={() => onOpenEvent(c.pu.eventId)}>{c.eventName}</button>
                      <span className="mini-date">{c.desc}</span>
                      <span className="debt-line"><b>{c.name}</b> diz que te pagou <b>{eur(c.amount)}</b></span>
                      <button className="pill" onClick={() => onConfirmPayment(c.pu, c.mid)}>Confirmar</button>
                    </div>
                  ))}
                </>
              )}
              {myShames.map((sh) => (
                <div key={sh.id} className="shame-note">
                  <span>
                    😳 <b>{members.find((m) => m.id === sh.fromMemberId)?.name || "?"}</b> disse-te para teres <em>vergonha</em> pela
                    tua dívida{sh.amount != null ? <> de <b>{eur(sh.amount)}</b></> : null}
                    {sh.creditors?.length ? <> a <b>{sh.creditors.join(", ")}</b></> : null}! 💸🙈
                  </span>
                  <button className="iconbtn" title="Limpar (até alguém te envergonhar de novo…)" onClick={() => onClearShame(sh.id)}>✕</button>
                </div>
              ))}
              {isMyBday && (
                <div className="bday-banner">
                  <h4 style={{ margin: 0 }}>🎂🎉 Feliz aniversário, {myMember.name}! 🥳🔥🍖</h4>
                  <p className="hint" style={{ margin: "4px 0 0" }}>O Grill deseja-te um dia em grande — a brasa hoje é por tua conta… de idade! 😄</p>
                  {myBdayWishes.map((w) => (
                    <div key={w.id} className="bday-wish">
                      🎈 <b>{members.find((m) => m.id === w.fromMemberId)?.name || "?"}</b> deseja-te parabéns{w.message ? <>: <em>«{w.message}»</em></> : "! 🎉"}
                    </div>
                  ))}
                </div>
              )}
              {myMember && (bdayToday.some((m) => m.id !== myMember.id) || bdaySoon.some((m) => m.id !== myMember.id)) && (
                <>
                  <h4>Aniversários 🎂</h4>
                  {bdayToday.filter((m) => m.id !== myMember.id).map((m) => {
                    const myWish = (wishes || []).find((w) => w.memberId === m.id && w.fromMemberId === myMember.id && w.year === bdayYear);
                    return (
                      <div key={m.id} className="todo-item bday-note">
                        <span>🎉 Hoje é o aniversário de <b>{m.name}</b>!</span>
                        {!myWish && <button className="pill" onClick={() => onWish(m.id)}>Desejar parabéns 🎈</button>}
                        {myWish && <span className="hint" style={{ margin: 0 }}>Parabéns enviados ✓{myWish.emailedAt ? " 📧" : ""}</span>}
                        {myWish && !myWish.emailedAt && m.email && (
                          <button className="pill" onClick={() => onEmailWish(myWish)}>Enviar também por email 📧</button>
                        )}
                      </div>
                    );
                  })}
                  {bdaySoon.filter((m) => m.id !== myMember.id).map((m) => (
                    <div key={m.id} className="todo-item bday-note">
                      <span>🗓️ O aniversário de <b>{m.name}</b> é daqui a uma semana ({fmtDate(m.birthDate).slice(0, 5)}) — vai aquecendo os parabéns! 🔥</span>
                    </div>
                  ))}
                </>
              )}
            </div>
            </>
          ) : (
            rightEv ? card(rightEv, 2) : <div className="tl-card empty-card" />
          )}
        </div>
      </div>

      {hottest && (
        <button className="hot-banner" onClick={() => onMember(hottest.member.id)} title="Ver membro">
          <StreakFlame n={hottest.streak} best={hottest.bestStreak} size={22} />
          <span><b>{hottest.member.name}</b> está em chamas — {hottest.streak} eventos seguidos sem falhar!</span>
        </button>
      )}

      <div className="section-head" style={{ marginTop: 36 }}><h2>Scoreboard — Top 5</h2></div>
      {top5.length === 0 && <p className="empty">Sem membros ainda.</p>}
      <div className="podium">
        {top5.map((row, i) => (
          <button key={row.member.id} className="podium-card" onClick={() => onMember(row.member.id)}>
            <span className={`rank r${i + 1}`}>{i + 1}</span>
            {row.member.avatarUrl
              ? <img className="avatar avatar-img" src={row.member.avatarUrl} alt="" />
              : <div className="avatar">{row.member.name.slice(0, 1).toUpperCase()}</div>}
            <span className="board-name">
              {row.member.name}
              {row.member.username && <span className="uname">@{row.member.username}</span>}
            </span>
            <span className="board-bar"><i style={{ width: `${row.pct}%` }} /></span>
            <span className="podium-pct">{row.pct}% <span className="mini-date">({row.present}/{row.total})</span></span>
            {row.streak > 0 && <StreakFlame n={row.streak} best={row.bestStreak} />}
          </button>
        ))}
      </div>
      <div className="actions" style={{ justifyContent: "center", marginTop: 18 }}>
        <button className="btn ember" onClick={onGoScoreboard}>Ver scoreboard completo</button>
      </div>
    </section>
  );
}

function ProfileModal({ myMember, email, onSave, onClose }) {
  const [f, setF] = useState(() => ({
    username: myMember?.username || "",
    birthDate: myMember?.birthDate || "",
    avatarUrl: myMember?.avatarUrl || "",
    discordId: myMember?.discordId || "",
    newPassword: "",
  }));
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  return (
    <Modal title="A minha área" onClose={onClose}>
      <div className="detail-grid">
        <div><span className="klabel">Conta</span>{email}</div>
        <div><span className="klabel">Nome (só o admin altera)</span>{myMember?.name || "—"}</div>
      </div>
      {myMember ? (
        <>
          <label>Username (tag pública)<input value={f.username} onChange={(e) => set("username", e.target.value)} placeholder="ex.: mestre-da-brasa" /></label>
          <label>Data de nascimento<input type="date" value={f.birthDate} onChange={(e) => set("birthDate", e.target.value)} /></label>
          <label>Imagem de perfil (upload)
            <input type="file" accept="image/*" onChange={async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              setUploading(true);
              try {
                const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
                const url = await api.uploadFile(`avatars/${myMember.id}-${Date.now()}.${ext}`, file);
                set("avatarUrl", url);
              } catch { /* falha silenciosa; mantém anterior */ }
              setUploading(false);
            }} />
          </label>
          {uploading && <p className="hint">A carregar imagem…</p>}
          {f.avatarUrl && <img src={f.avatarUrl} alt="" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--line)" }} />}
          <label style={{ marginTop: 10 }}>Ou URL da imagem<input value={f.avatarUrl} onChange={(e) => set("avatarUrl", e.target.value)} placeholder="https://…" /></label>
          <label style={{ marginTop: 10 }}>Discord ID (para o bot te mencionar)
            <input value={f.discordId} onChange={(e) => set("discordId", e.target.value)} placeholder="ex.: 123456789012345678" inputMode="numeric" />
          </label>
          <p className="hint">No Discord: Definições → Avançado → Modo de programador. Depois botão direito no teu nome → Copiar ID.</p>
        </>
      ) : (
        <p className="hint">Esta conta ainda não está associada a nenhum membro — pede ao admin para registar este email num membro.</p>
      )}
      <label>Nova password (opcional)<input type="password" value={f.newPassword} onChange={(e) => set("newPassword", e.target.value)} /></label>
      <div className="actions"><button className="btn ember" onClick={() => onSave(f)}>Guardar</button></div>
    </Modal>
  );
}

function EventCard({ ev, isAdmin, onOpen, onEdit, compact }) {
  const st = getStatus(ev);
  const s = STATUS_STYLE[st];
  const present = Object.values(ev.presences || {}).filter(Boolean).length;
  return (
    <div className={`card event-card ${compact ? "compact" : ""}`} onClick={onOpen}>
      <div className="event-top">
        <strong>{ev.name}</strong>
        {isAdmin && (
          <button className="iconbtn" title="Editar evento" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
            {Icon.gear({})}
          </button>
        )}
      </div>
      {!compact && (
        <div className="event-date">{fmtDateRange(ev)}</div>
      )}
      <div className="event-meta">
        <span className="status" style={{ background: s.bg, color: s.fg }}>
          <i style={{ background: s.dot }} />{st}
        </span>
        {ev.location && <span className="loc">{Icon.pin({})} {ev.location}</span>}
        {st === "Concluído"
          ? <span className="presenças">{present} presenças</span>
          : <span className="presenças">{Object.values(ev.confirmations || {}).filter(Boolean).length} confirmados</span>}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="iconbtn" onClick={onClose}>{Icon.x({})}</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function LoginModal({ onClose }) {
  const [mode, setMode] = useState("login"); // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);

  function switchMode(m) { setMode(m); setErr(null); setMsg(null); }

  async function submit() {
    setErr(null); setMsg(null);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: p });
      if (error) setErr("Credenciais inválidas."); else onClose();
    } else if (mode === "signup") {
      if (p.length < 6) { setErr("Password com 6+ caracteres."); return; }
      const { error } = await supabase.auth.signUp({ email, password: p, options: { emailRedirectTo: SITE_URL } });
      if (error) setErr(error.message); else setMsg("Conta criada — vê o teu email para confirmar.");
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
      if (error) setErr(error.message); else setMsg("Email de recuperação enviado.");
    }
  }

  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: SITE_URL } });
    if (error) setErr(error.message);
  }

  const titles = { login: "Entrar", signup: "Criar conta", reset: "Recuperar password" };
  return (
    <Modal title={titles[mode]} onClose={onClose}>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
      {mode !== "reset" && (
        <label>Password<input type="password" value={p} onChange={(e) => setP(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} /></label>
      )}
      {err && <p className="err">{err}</p>}
      {msg && <p className="hint">{msg}</p>}
      <div className="actions">
        <button className="btn ghost" onClick={google}>Entrar com Google</button>
        <button className="btn ember" onClick={submit}>{titles[mode]}</button>
      </div>
      <p className="hint">
        {mode === "login" ? (
          <>
            Sem conta? <a href="#" onClick={(e) => { e.preventDefault(); switchMode("signup"); }}>Criar conta</a>
            {" · "}
            <a href="#" onClick={(e) => { e.preventDefault(); switchMode("reset"); }}>Esqueci-me da password</a>
          </>
        ) : (
          <a href="#" onClick={(e) => { e.preventDefault(); switchMode("login"); }}>← Voltar ao login</a>
        )}
      </p>
      <p className="hint">A consulta é livre — o login só é necessário para gerir o Grill.</p>
    </Modal>
  );
}

function NewPasswordModal({ onClose, onDone }) {
  const [p, setP] = useState(""); const [err, setErr] = useState(null);
  async function submit() {
    if (p.length < 6) { setErr("Password com 6+ caracteres."); return; }
    const { error } = await supabase.auth.updateUser({ password: p });
    if (error) setErr(error.message); else { onDone(); onClose(); }
  }
  return (
    <Modal title="Definir nova password" onClose={onClose}>
      <label>Nova password<input type="password" value={p} onChange={(e) => setP(e.target.value)} autoFocus
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }} /></label>
      {err && <p className="err">{err}</p>}
      <div className="actions"><button className="btn ember" onClick={submit}>Guardar</button></div>
    </Modal>
  );
}

function EventDetailModal({ ev, members, isAdmin, myMember, purchases, onEdit, onMember, onConfirm, onNotify, onDiscordEvent, onDiscordPayment, onDiscordDebts, onShare, onAddPurchase, onEditPurchase, onImportPurchases, onToggleSettled, onClaim, onClose }) {
  const nm = (id) => members.find((m) => m.id === id)?.name || "?";
  /* saldos compensados: por devedor, a quem e quanto deve pagar */
  const settle = pairwiseNet(purchases);
  const byDebtor = {}; // debtorId -> [{to, amount}]
  settle.forEach((sm) => { (byDebtor[sm.from] = byDebtor[sm.from] || []).push({ to: sm.to, amount: sm.amount }); });
  const owingEmails = Object.keys(byDebtor).map((id) => members.find((m) => m.id === id)?.email).filter(Boolean);
  const mailtoBody = Object.entries(byDebtor).map(([id, lines]) => {
    const detalhe = lines.sort((a, b) => b.amount - a.amount)
      .map((l) => `   - ${eur(l.amount)} a ${nm(l.to)}`).join("\n");
    return `${nm(id)}:\n${detalhe}`;
  }).join("\n\n");
  const mailtoHref = owingEmails.length
    ? `mailto:${owingEmails.join(",")}?subject=${encodeURIComponent(`GrillHub — contas por saldar: ${ev.name}`)}&body=${encodeURIComponent(`Olá! Há contas por saldar do evento "${ev.name}" (valores já compensados entre todos):\n\n${mailtoBody}\n\nDetalhes: https://grill1385.github.io/grill-hub/`)}`
    : null;
  const debtorIds = Object.keys(byDebtor);
  const discordDebtText = () => {
    const linhas = Object.entries(byDebtor).map(([id, lines]) => {
      const detalhe = lines.sort((a, b) => b.amount - a.amount).map((l) => `   • ${eur(l.amount)} a ${nm(l.to)}`).join("\n");
      return `**${nm(id)}**:\n${detalhe}`;
    }).join("\n");
    return `💸🔥 **Contas por saldar — ${ev.name}** 🔥💸\n_(valores já compensados entre todos)_\n\n${linhas}\n\nAcertem contas no GrillHub 👉 https://grill1385.github.io/grill-hub/`;
  };
  const st = getStatus(ev); const s = STATUS_STYLE[st];
  const present = members.filter((m) => ev.presences?.[m.id]);
  const absent = members.filter((m) => ev.presences && ev.presences[m.id] === false);
  const confirmed = members.filter((m) => ev.confirmations?.[m.id]);
  const href = mapsHref(ev);
  return (
    <Modal title={ev.name} onClose={onClose} wide>
      <div className="detail-row">
        <span className="status" style={{ background: s.bg, color: s.fg }}><i style={{ background: s.dot }} />{st}</span>
        <span>{fmtDateRange(ev)}</span>
        <button className="btn ghost small" onClick={onShare} title="Copiar link de partilha (com pré-visualização no Discord)">Partilhar</button>
        {isAdmin && <button className="btn ghost small" onClick={onEdit}>{Icon.gear({})} Editar</button>}
      </div>
      {(ev.timeStart || ev.timeEnd) && (
        <p className="loc-line">🕐{" "}
          {ev.timeStart && ev.timeEnd ? `Das ${ev.timeStart} às ${ev.timeEnd}`
            : ev.timeStart ? `A partir das ${ev.timeStart}`
            : `Até às ${ev.timeEnd}`}
        </p>
      )}
      {ev.description && <p className="desc">{ev.description}</p>}
      {(ev.location || href) && (
        <p className="loc-line">{Icon.pin({})} {ev.location || "Localização"}{" "}
          {href && <a href={href} target="_blank" rel="noreferrer">Abrir no Google Maps ↗</a>}
        </p>
      )}
      {st === "Concluído" ? (
        <>
          <h4>Presentes ({present.length})</h4>
          <div className="pill-row">
            {present.length ? present.map((m) => (
              <button key={m.id} className="pill on" onClick={() => onMember(m.id)}>{m.name}</button>
            )) : <span className="hint">Ninguém marcado como presente.</span>}
          </div>
          {absent.length > 0 && (
            <>
              <h4>Ausentes ({absent.length})</h4>
              <div className="pill-row">
                {absent.map((m) => <button key={m.id} className="pill" onClick={() => onMember(m.id)}>{m.name}</button>)}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <h4>Confirmaram presença ({confirmed.length})</h4>
          <div className="pill-row">
            {confirmed.length ? confirmed.map((m) => (
              <button key={m.id} className="pill on" onClick={() => onMember(m.id)}>{m.name}</button>
            )) : <span className="hint">Ainda ninguém confirmou.</span>}
          </div>
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            {myMember && (
              <button className={`btn ${ev.confirmations?.[myMember.id] ? "ghost" : "ember"}`} onClick={onConfirm}>
                {ev.confirmations?.[myMember.id] ? "Cancelar confirmação" : "Confirmar presença"}
              </button>
            )}
            {isAdmin && (
              <button className="btn ghost" title="Envia email a todos os membros com email a pedir confirmação" onClick={onNotify}>
                Avisar membros por email
              </button>
            )}
            {isAdmin && (
              <button className="btn ghost" title="Anuncia este evento no Discord e menciona todos os membros com Discord ligado" onClick={onDiscordEvent}>
                📣 Anunciar no Discord
              </button>
            )}
          </div>
        </>
      )}

      <h4>Contas</h4>
      {(!purchases || purchases.length === 0) && <p className="hint">Sem contas.</p>}
      {(purchases || []).map((pu) => {
        const parts = pu.participants || [];
        const isSet = (mid) => mid === pu.payerId || !!pu.settled?.[mid];
        const totalSettled = Math.min(pu.total, Math.round(parts.filter(isSet).reduce((acc, mid) => acc + shareOf(pu, mid), 0) * 100) / 100);
        const claimedSum = Math.round(parts.filter((mid) => !isSet(mid) && pu.claimed?.[mid]).reduce((acc, mid) => acc + shareOf(pu, mid), 0) * 100) / 100;
        const payer = members.find((m) => m.id === pu.payerId);
        const iAmPayer = !!myMember && pu.payerId === myMember.id;
        return (
          <div key={pu.id} className="purchase">
            <div className="purchase-head">
              <strong>{pu.description}</strong>
              <span className="purchase-total">{eur(pu.total)}</span>
              {isAdmin && <button className="iconbtn" title="Cobrar no Discord (menciona quem tem esta compra por saldar)" onClick={() => onDiscordPayment(pu)}>💸</button>}
              {(isAdmin || iAmPayer) && <button className="iconbtn" title="Editar compra" onClick={() => onEditPurchase(pu.id)}>{Icon.gear({})}</button>}
            </div>
            <div className="hint" style={{ marginTop: 0 }}>
              Pagar a <b>{payer?.name || "?"}</b> · {pu.split === "custom" ? (pu.parcels?.length ? "por parcelas" : "valores individuais") : `${eur(shareOf(pu, parts[0]))} por pessoa`} · saldado {eur(totalSettled)} de {eur(pu.total)}{claimedSum > 0 && <> · <b>{eur(claimedSum)} por confirmar</b></>}
            </div>
            {pu.parcels?.length > 0 && (
              <div className="hint parcel-line" style={{ marginTop: 0 }}>
                {pu.parcels.map((pc, i) => {
                  const names = (pc.members || []).map((x) => members.find((m) => m.id === x)?.name || "?").join(", ");
                  return <span key={pc.id || i}>{i > 0 ? " · " : ""}{pc.name || "Parcela"} <b>{eur(pc.price)}</b> ({names || "por atribuir"})</span>;
                })}
              </div>
            )}
            <div className="pill-row">
              {parts.map((mid) => {
                const m = members.find((x) => x.id === mid);
                if (!m) return null;
                const done = isSet(mid);
                const claimed = !done && !!pu.claimed?.[mid];
                const canConfirm = (isAdmin || iAmPayer) && mid !== pu.payerId;
                const isMe = !!myMember && mid === myMember.id && mid !== pu.payerId;
                const onClick = canConfirm
                  ? () => onToggleSettled(pu, mid)
                  : isMe && !done ? () => onClaim(pu, mid, !claimed) : undefined;
                return (
                  <button key={mid} className={`pill ${done ? "on" : claimed ? "claim" : ""}`}
                    title={mid === pu.payerId ? "Pagou a compra"
                      : canConfirm ? (claimed ? "Confirmar que recebeste" : "Marcar como saldado")
                      : isMe && !done ? (claimed ? "Anular o «já paguei»" : "Marcar que já pagaste") : ""}
                    onClick={onClick}>
                    {m.name}{mid === pu.payerId ? " · pagou" : done ? " · saldado" : claimed ? " · pagou? por confirmar" : ` · deve ${eur(shareOf(pu, mid))}`}
                  </button>
                );
              })}
            </div>
            {pu.receipts?.length > 0 && (
              <div className="receipts">
                {pu.receipts.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`fatura ${i + 1}`} /></a>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {(() => {
        const settle = pairwiseNet(purchases);
        if (!settle.length) return null;
        const nm = (id) => members.find((m) => m.id === id)?.name || "?";
        return (
          <p className="hint net-summary">
            <b>Saldos a acertar</b> (compensado): {settle
              .sort((a, b) => b.amount - a.amount)
              .map((sm) => `${nm(sm.from)} → ${nm(sm.to)}: ${eur(sm.amount)}`)
              .join(" · ")}
          </p>
        );
      })()}
      {(isAdmin || myMember) && (
        <div className="actions" style={{ justifyContent: "flex-start" }}>
          <button className="btn ghost small" onClick={onAddPurchase}>+ Compra</button>
          {isAdmin && <button className="btn ghost small" onClick={onImportPurchases}>Importar Excel</button>}
          {isAdmin && mailtoHref && <a className="btn ghost small" href={mailtoHref} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Enviar lembrete por email</a>}
          {isAdmin && debtorIds.length > 0 && <button className="btn ghost small" title="Envia as contas por saldar deste evento para o Discord, mencionando os devedores" onClick={() => onDiscordDebts(discordDebtText(), debtorIds)}>Enviar lembrete por Discord 💬</button>}
        </div>
      )}
    </Modal>
  );
}

function EventFormModal({ ev, members, places = [], onSave, onDelete, onClose }) {
  const editing = !!ev;
  const [f, setF] = useState(() => ({
    id: ev?.id || uid(),
    name: ev?.name || "",
    range: !!ev?.dateEnd,
    dateStart: ev?.dateStart || todayISO(),
    dateEnd: ev?.dateEnd || "",
    timeStart: ev?.timeStart || "",
    timeEnd: ev?.timeEnd || "",
    description: ev?.description || "",
    location: ev?.location || "",
    locationUrl: ev?.locationUrl || "",
    status: ev?.status === "Planeado" ? "Agendado" : (ev?.status || "Por planear"),
    presences: { ...(ev?.presences || {}) },
  }));
  const isPast = (f.range && f.dateEnd ? f.dateEnd : f.dateStart) < todayISO();
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const togglePresence = (id) => setF((o) => ({ ...o, presences: { ...o.presences, [id]: !o.presences[id] } }));

  function submit() {
    if (!f.name.trim() || !f.dateStart) return;
    const presences = {};
    members.forEach((m) => (presences[m.id] = !!f.presences[m.id]));
    onSave({
      id: f.id, name: f.name.trim(), dateStart: f.dateStart,
      dateEnd: f.range && f.dateEnd ? f.dateEnd : null,
      timeStart: f.timeStart || null, timeEnd: f.timeEnd || null,
      description: f.description.trim(), location: f.location.trim(),
      locationUrl: f.locationUrl.trim(), status: f.status, presences,
    });
  }

  return (
    <Modal title={editing ? "Editar evento" : "Novo evento"} onClose={onClose} wide>
      <label>Nome do evento<input value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></label>
      <div className="row">
        <label className="check"><input type="checkbox" checked={f.range} onChange={(e) => set("range", e.target.checked)} /> Intervalo de datas</label>
      </div>
      <div className="row">
        <label>{f.range ? "Início" : "Data"}<input type="date" value={f.dateStart} onChange={(e) => set("dateStart", e.target.value)} /></label>
        {f.range && <label>Fim<input type="date" value={f.dateEnd} onChange={(e) => set("dateEnd", e.target.value)} /></label>}
      </div>
      <div className="row">
        <label>Hora de início (opcional)<input type="time" value={f.timeStart} onChange={(e) => set("timeStart", e.target.value)} /></label>
        <label>Hora de fim (opcional)<input type="time" value={f.timeEnd} onChange={(e) => set("timeEnd", e.target.value)} /></label>
      </div>
      <p className="hint" style={{ margin: "0 0 8px" }}>Com hora de fim, o evento passa a “Concluído” automaticamente depois dessa hora no dia final; senão, só no fim do dia.</p>
      <label>Estado
        {isPast ? (
          <input value="Concluído (automático — data já passou)" disabled />
        ) : (
          <select value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option>Por planear</option>
            <option>Agendado</option>
            <option>Concluído</option>
          </select>
        )}
      </label>
      <label>Descrição (opcional)<textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
      {places.length > 0 && (
        <label>Local guardado (opcional)
          <select value="" onChange={(e) => {
            const pl = places.find((x) => x.id === e.target.value);
            if (pl) setF((o) => ({ ...o, location: pl.name, locationUrl: pl.url }));
          }}>
            <option value="">— escolher de um local recorrente —</option>
            {[...places].sort((a, b) => a.name.localeCompare(b.name)).map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
          </select>
        </label>
      )}
      <div className="row">
        <label>Localização<input placeholder="ex.: Quinta do Zé, Óbidos" value={f.location} onChange={(e) => set("location", e.target.value)} /></label>
        <label>Link Google Maps (opcional)<input placeholder="https://maps.google.com/…" value={f.locationUrl} onChange={(e) => set("locationUrl", e.target.value)} /></label>
      </div>
      <h4>Presenças reais (confirmadas pelo admin)</h4>
      {members.length === 0 && <p className="hint">Adiciona membros primeiro no separador Membros.</p>}
      {editing && Object.values(ev?.confirmations || {}).some(Boolean) && (
        <p className="hint">✓ = confirmou presença antecipadamente.{" "}
          <a href="#" onClick={(e) => { e.preventDefault(); setF((o) => ({ ...o, presences: { ...(ev?.confirmations || {}) } })); }}>
            Usar confirmações como presenças
          </a>
        </p>
      )}
      <div className="pill-row">
        {members.map((m) => (
          <button key={m.id} type="button" className={`pill ${f.presences[m.id] ? "on" : ""}`} onClick={() => togglePresence(m.id)}>
            {m.name}{ev?.confirmations?.[m.id] ? " ✓" : ""} {f.presences[m.id] ? "· S" : "· N"}
          </button>
        ))}
      </div>
      <div className="actions">
        {editing && <button className="btn danger" onClick={() => onDelete(f.id)}>Eliminar</button>}
        <button className="btn ember" onClick={submit}>Guardar evento</button>
      </div>
    </Modal>
  );
}

function MemberDetailModal({ mb, role, attended, row, isAdmin, onShame, onEvent, onClose }) {
  return (
    <Modal title={mb.name} onClose={onClose} wide>
      <div className="detail-grid">
        <div><span className="klabel">Cargo</span>{role?.label || "Sem cargo"}</div>
        <div><span className="klabel">Username</span>{mb.username ? `@${mb.username}` : "—"}</div>
        <div><span className="klabel">Email</span>{mb.email || "—"}</div>
        <div><span className="klabel">Nascimento</span>{fmtDate(mb.birthDate)}</div>
        <div><span className="klabel">No Grill desde</span>{fmtDate(mb.joinDate)}</div>
        <div><span className="klabel">Presenças</span>{row ? `${row.pct}% (${row.present}/${row.total})` : "—"}</div>
        <div><span className="klabel">Sequência atual</span>{row?.streak ? <StreakFlame n={row.streak} best={row.bestStreak} /> : "—"}</div>
        <div><span className="klabel">Melhor sequência</span>{row?.bestStreak ? `${row.bestStreak} seguido(s)` : "—"}</div>
        <div><span className="klabel">Discord</span>{mb.discordId ? "Ligado ✅" : "Não ligado"}</div>
      </div>
      {isAdmin && (
        <div className="actions" style={{ justifyContent: "flex-start", marginTop: 4 }}>
          <button className="btn ember" title={mb.discordId ? "Menciona este membro no Discord" : "Este membro ainda não ligou o Discord"}
            disabled={!mb.discordId} onClick={onShame}>
            😳 Envergonhar no Discord
          </button>
        </div>
      )}
      <h4>Eventos em que esteve presente ({attended.length})</h4>
      {attended.length === 0 && <p className="hint">Ainda sem presenças registadas.</p>}
      <div className="mini-list">
        {attended.map((e) => (
          <button key={e.id} className="mini-item" onClick={() => onEvent(e.id)}>
            <span>{e.name}</span><span className="mini-date">{fmtDate(e.dateStart)}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function MemberFormModal({ mb, roles, onSave, onDelete, onClose }) {
  const editing = !!mb;
  const [f, setF] = useState(() => ({
    id: mb?.id || uid(), name: mb?.name || "",
    email: mb?.email || "",
    birthDate: mb?.birthDate || "", joinDate: mb?.joinDate || "",
    roleId: mb?.roleId || "", discordId: mb?.discordId || "",
  }));
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  return (
    <Modal title={editing ? "Editar membro" : "Novo membro"} onClose={onClose}>
      <label>Nome<input value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></label>
      <label>Email (para lembretes de eventos)<input type="email" placeholder="opcional" value={f.email} onChange={(e) => set("email", e.target.value)} /></label>
      <div className="row">
        <label>Data de nascimento<input type="date" value={f.birthDate} onChange={(e) => set("birthDate", e.target.value)} /></label>
        <label>Integração no Grill<input type="date" value={f.joinDate} onChange={(e) => set("joinDate", e.target.value)} /></label>
      </div>
      <label>Cargo
        <select value={f.roleId} onChange={(e) => set("roleId", e.target.value)}>
          <option value="">Sem cargo</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      <label>Discord ID (para menções no servidor)
        <input value={f.discordId} onChange={(e) => set("discordId", e.target.value)} placeholder="ex.: 123456789012345678" inputMode="numeric" />
      </label>
      <p className="hint">No Discord: Definições → Avançado → Modo de programador. Depois botão direito no membro → Copiar ID.</p>
      <div className="actions">
        {editing && <button className="btn danger" onClick={() => onDelete(f.id)}>Eliminar</button>}
        <button className="btn ember" disabled={!f.name.trim()} onClick={() => onSave({ ...(mb || {}), ...f, name: f.name.trim(), email: f.email.trim() || null, roleId: f.roleId || null, discordId: f.discordId.trim() || null })}>Guardar membro</button>
      </div>
    </Modal>
  );
}

function ImportEventsModal({ members, onImport, onClose }) {
  const [preview, setPreview] = useState(null); // {events, newNames, errors}
  const [createMissing, setCreateMissing] = useState(true);
  const [busy, setBusy] = useState(false);

  function toISO(v) {
    if (v instanceof Date && !isNaN(v)) {
      const off = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
      return off.toISOString().slice(0, 10);
    }
    const t = String(v || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null;
  }

  async function parseFile(file) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheetName = wb.SheetNames.find((n) => norm(n) === "eventos") || wb.SheetNames[0];
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
      const known = new Set(members.map((m) => norm(m.name)));
      const events = []; const errors = []; const newNames = new Map();
      raw.forEach((row, i) => {
        const get = (...keys) => {
          for (const k of Object.keys(row)) if (keys.includes(norm(k))) return row[k];
          return "";
        };
        const name = String(get("nome", "evento", "nome do evento") || "").trim();
        const isExample = i === 0 && name === "Churrasco de Verão";
        if (isExample) return;
        const dateStart = toISO(get("data inicio", "data início", "data", "inicio"));
        const dateEnd = toISO(get("data fim", "fim"));
        const memberNames = String(get("membros", "presencas", "presenças") || "")
          .split(/[;,]/).map((x) => x.trim()).filter(Boolean);
        if (!name && !dateStart && !memberNames.length) return; // linha vazia
        const linha = i + 2;
        if (!name) { errors.push(`Linha ${linha}: falta o nome do evento.`); return; }
        if (!dateStart) { errors.push(`Linha ${linha} (${name}): data de início inválida ou em falta.`); return; }
        let status = String(get("estado") || "").trim();
        if (!["Por planear", "Agendado", "Concluído"].includes(status)) {
          status = (dateEnd || dateStart) < todayISO() ? "Concluído" : "Por planear";
        }
        const concluded = status === "Concluído" || (dateEnd || dateStart) < todayISO();
        if (concluded && !memberNames.length) { errors.push(`Linha ${linha} (${name}): evento concluído precisa de pelo menos 1 membro.`); return; }
        memberNames.forEach((nm) => { if (!known.has(norm(nm)) && !newNames.has(norm(nm))) newNames.set(norm(nm), nm); });
        events.push({
          name, dateStart, dateEnd,
          location: String(get("local", "localizacao", "localização") || "").trim(),
          locationUrl: String(get("link google maps", "link maps", "link") || "").trim(),
          description: String(get("descricao", "descrição") || "").trim(),
          status, memberNames,
        });
      });
      setPreview({ events, newNames: [...newNames.values()], errors });
    } catch {
      setPreview({ events: [], newNames: [], errors: ["Não foi possível ler o ficheiro. É um .xlsx válido?"] });
    }
  }

  const canImport = preview && preview.events.length > 0 && preview.errors.length === 0
    && (createMissing || preview.newNames.length === 0);

  return (
    <Modal title="Importar eventos de Excel" onClose={onClose} wide>
      <p className="hint" style={{ marginTop: 0 }}>
        Usa o <a href="./template-eventos.xlsx" download style={{ color: "var(--ember)" }}>template de importação</a> —
        uma linha por evento, com Nome, Data Início e Membros (separados por ; ou ,) no mínimo.
      </p>
      <label>Ficheiro Excel (.xlsx)
        <input type="file" accept=".xlsx,.xls" onChange={(e) => { const f = e.target.files[0]; if (f) parseFile(f); }} />
      </label>
      {preview && (
        <>
          <p><b>{preview.events.length}</b> evento(s) prontos a importar.</p>
          {preview.newNames.length > 0 && (
            <>
              <p className="hint">Membros que não existem no site ({preview.newNames.length}): {preview.newNames.join(", ")}</p>
              <label className="check">
                <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
                Criar estes membros automaticamente (sem email — associas contas depois)
              </label>
            </>
          )}
          {preview.errors.length > 0 && (
            <div>
              {preview.errors.slice(0, 8).map((e, i) => <p key={i} className="err">{e}</p>)}
              {preview.errors.length > 8 && <p className="err">… e mais {preview.errors.length - 8} erros.</p>}
              <p className="hint">Corrige o ficheiro e volta a carregá-lo — nada foi importado.</p>
            </div>
          )}
        </>
      )}
      <div className="actions">
        <button className="btn ember" disabled={!canImport || busy}
          onClick={async () => { setBusy(true); await onImport(preview.events, createMissing ? preview.newNames : []); setBusy(false); }}>
          {busy ? "A importar…" : "Importar"}
        </button>
      </div>
    </Modal>
  );
}

function BirthdayWishModal({ member, onSend, onClose }) {
  const [msg, setMsg] = useState("");
  const [emailToo, setEmailToo] = useState(!!member.email);
  const prev = emojify(msg);
  return (
    <Modal title={`Desejar parabéns a ${member.name} 🎂`} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>A tua mensagem aparece na homepage de {member.name} hoje.</p>
      <label>Mensagem personalizada (opcional)
        <textarea rows={3} maxLength={280} placeholder="ex.: Parabéns, lenda! Que a brasa nunca te falte :fire:"
          value={msg} onChange={(e) => setMsg(e.target.value)} autoFocus />
      </label>
      <p className="hint" style={{ margin: "2px 0 6px" }}>Podes usar emojis como no Discord — :fire: :festa: :bolo: :cerveja: :coracao: :festao:…</p>
      {msg && prev !== msg && <p className="hint" style={{ margin: "0 0 8px" }}>Pré-visualização: {prev}</p>}
      {member.email ? (
        <label className="check">
          <input type="checkbox" checked={emailToo} onChange={(e) => setEmailToo(e.target.checked)} />
          {" "}Enviar também por email 📧
        </label>
      ) : (
        <p className="hint">{member.name} não tem email registado — os parabéns aparecem só no site.</p>
      )}
      <div className="actions">
        <button className="btn ember" onClick={() => onSend(msg, emailToo && !!member.email)}>Enviar parabéns 🎈</button>
      </div>
    </Modal>
  );
}

function ImportPurchasesModal({ ev, members, myMember, onImport, onClose }) {
  const [preview, setPreview] = useState(null); // {purchases, errors}
  const [busy, setBusy] = useState(false);
  const num = (v) => { const n = Number(String(v ?? "").replace("€", "").replace(",", ".").trim()); return isFinite(n) ? n : NaN; };

  async function parseFile(file) {
    try {
      const byName = new Map(members.map((m) => [norm(m.name), m]));
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheetName = wb.SheetNames.find((n) => norm(n) === "compras") || wb.SheetNames[0];
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
      const errors = [];
      const groups = new Map(); // compra -> linhas
      raw.forEach((row, i) => {
        const get = (...keys) => { for (const k of Object.keys(row)) if (keys.includes(norm(k))) return row[k]; return ""; };
        const compra = String(get("compra", "descricao", "descrição") || "").trim();
        const parcela = String(get("parcela", "subparcela", "sub-parcela") || "").trim();
        const preco = get("preco (eur)", "preco (\u20ac)", "preco", "preço (\u20ac)", "preço", "valor", "valor (\u20ac)");
        const linha = i + 2;
        if (!compra && !parcela && !String(preco).trim()) return; // linha vazia
        if (!compra) { errors.push(`Linha ${linha}: falta o nome da compra.`); return; }
        if (norm(compra).includes("(exemplo)")) return;
        if (!groups.has(compra)) groups.set(compra, []);
        groups.get(compra).push({
          linha, parcela, preco,
          membrosStr: String(get("membros", "membros (opcional)") || "").trim(),
          divisao: norm(String(get("divisao", "divisão") || "")),
          pagador: String(get("pagador", "pagador (opcional)", "pagou") || "").trim(),
        });
      });
      const purchases = [];
      const parseMembros = (str, linha, out = []) => {
        String(str || "").split(/[;,]/).map((x) => x.trim()).filter(Boolean).forEach((nm) => {
          const m = byName.get(norm(nm));
          if (!m) errors.push(`Linha ${linha}: membro "${nm}" não existe no site.`);
          else if (!out.includes(m.id)) out.push(m.id);
        });
        return out;
      };
      for (const [compra, rows] of groups) {
        const div = rows.map((r) => r.divisao).find(Boolean) || "";
        const isParcelas = div ? (div.includes("parcel") || div.includes("pago o que")) : rows.some((r) => r.parcela);
        const pagadorName = rows.map((r) => r.pagador).find(Boolean) || "";
        let payer = myMember || null;
        if (pagadorName) payer = byName.get(norm(pagadorName)) || null;
        if (pagadorName && !payer) { errors.push(`Compra "${compra}": pagador "${pagadorName}" não é um membro conhecido.`); continue; }
        if (!payer) { errors.push(`Compra "${compra}": preenche a coluna Pagador (a tua conta não está ligada a um membro).`); continue; }
        if (isParcelas) {
          const parcels = [];
          rows.forEach((r) => {
            const price = num(r.preco);
            if (!(price > 0)) { errors.push(`Linha ${r.linha} ("${compra}"): preço da parcela inválido.`); return; }
            parcels.push({ id: uid(), name: r.parcela || `Parcela ${parcels.length + 1}`, price: Math.round(price * 100) / 100, members: parseMembros(r.membrosStr, r.linha) });
          });
          if (!parcels.length) continue;
          const total = Math.round(parcels.reduce((a, pc) => a + pc.price, 0) * 100) / 100;
          purchases.push({
            id: uid(), eventId: ev.id, description: compra, total,
            payerId: payer.id, participants: [...new Set(parcels.flatMap((pc) => pc.members))],
            settled: {}, receipts: [], split: "custom", shares: {}, parcels,
          });
        } else {
          const r0 = rows[0];
          if (rows.length > 1) errors.push(`Compra "${compra}": divisão por todos deve ter só 1 linha (tem ${rows.length}).`);
          const total = num(r0.preco);
          if (!(total > 0)) { errors.push(`Linha ${r0.linha} ("${compra}"): valor total inválido.`); continue; }
          let participants = parseMembros(rows.map((r) => r.membrosStr).filter(Boolean).join(";"), r0.linha);
          if (!participants.length) {
            const st = getStatus(ev);
            const src = st === "Concluído" ? ev.presences : (Object.values(ev.confirmations || {}).some(Boolean) ? ev.confirmations : null);
            participants = (src ? members.filter((m) => src[m.id]) : members).map((m) => m.id);
          }
          purchases.push({
            id: uid(), eventId: ev.id, description: compra, total: Math.round(total * 100) / 100,
            payerId: payer.id, participants, settled: {}, receipts: [], split: "equal", shares: {}, parcels: [],
          });
        }
      }
      setPreview({ purchases, errors });
    } catch {
      setPreview({ purchases: [], errors: ["Não foi possível ler o ficheiro. É um .xlsx válido?"] });
    }
  }

  const canImport = preview && preview.purchases.length > 0 && preview.errors.length === 0;
  return (
    <Modal title={`Importar compras — ${ev.name}`} onClose={onClose} wide>
      <p className="hint" style={{ marginTop: 0 }}>
        Usa o <a href="./template-compras.xlsx" download style={{ color: "var(--ember)" }}>template de compras</a> —
        divisão «todos» numa linha, ou «parcelas» com uma linha por parcela (mesmo nome de Compra).
        Os membros por parcela são opcionais — podem associar-se depois na compra.
      </p>
      <label>Ficheiro Excel (.xlsx)
        <input type="file" accept=".xlsx,.xls" onChange={(e) => { const fl = e.target.files[0]; if (fl) parseFile(fl); }} />
      </label>
      {preview && (
        <>
          {preview.errors.length > 0 && (
            <div>
              <p className="err" style={{ marginBottom: 4 }}>Erros ({preview.errors.length}) — corrige e volta a carregar:</p>
              {preview.errors.slice(0, 12).map((e, i) => <p key={i} className="err" style={{ margin: "2px 0" }}>{e}</p>)}
              {preview.errors.length > 12 && <p className="err">… e mais {preview.errors.length - 12}.</p>}
            </div>
          )}
          <p><b>{preview.purchases.length}</b> compra(s) prontas a importar:</p>
          <div className="mini-list">
            {preview.purchases.map((pu) => (
              <div key={pu.id} className="mini-item" style={{ cursor: "default" }}>
                <span>{pu.description} — {pu.split === "custom" ? `${pu.parcels.length} parcela(s)` : `${pu.participants.length} participante(s)`} · pagou {members.find((m) => m.id === pu.payerId)?.name || "?"}</span>
                <span className="mini-date">{eur(pu.total)}</span>
              </div>
            ))}
          </div>
          <div className="actions">
            <button className="btn ember" disabled={!canImport || busy}
              onClick={async () => { setBusy(true); await onImport(preview.purchases); }}>
              {busy ? "A importar…" : `Importar ${preview.purchases.length} compra(s)`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function PurchaseFormModal({ ev, purchase, members, isAdmin, myMember, onSave, onDelete, onClose }) {
  const editing = !!purchase;
  const defaultParts = useMemo(() => {
    if (purchase) return purchase.participants;
    const st = getStatus(ev);
    const src = st === "Concluído" ? ev.presences : (Object.values(ev.confirmations || {}).some(Boolean) ? ev.confirmations : null);
    if (src) {
      const ids = members.filter((m) => src[m.id]).map((m) => m.id);
      if (ids.length) return ids;
    }
    return members.map((m) => m.id);
  }, [purchase, ev, members]);
  const [f, setF] = useState(() => ({
    id: purchase?.id || uid(),
    description: purchase?.description || "",
    total: purchase?.total ?? "",
    payerId: purchase?.payerId || (!isAdmin && myMember ? myMember.id : members[0]?.id) || "",
    participants: defaultParts,
    settled: { ...(purchase?.settled || {}) },
    receipts: [...(purchase?.receipts || [])],
    split: purchase?.split || "equal",
    shares: { ...(purchase?.shares || {}) },
    parcels: (purchase?.parcels || []).map((pc) => ({ ...pc, members: [...(pc.members || [])] })),
  }));
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const toggleP = (id) =>
    set("participants", f.participants.includes(id) ? f.participants.filter((x) => x !== id) : [...f.participants, id]);
  /* parcelas ("só pago o que como"): cada parcela divide o preço pelos seus membros */
  const legacyShares = purchase?.split === "custom" && !(purchase?.parcels?.length) && Object.keys(purchase?.shares || {}).length > 0;
  const usingParcels = f.split === "custom" && !legacyShares;
  const setParcel = (i, k, v) => setF((o) => ({ ...o, parcels: o.parcels.map((pc, j) => (j === i ? { ...pc, [k]: v } : pc)) }));
  const toggleParcelMember = (i, mid) => setF((o) => ({
    ...o,
    parcels: o.parcels.map((pc, j) => {
      if (j !== i) return pc;
      const ms = pc.members || [];
      return { ...pc, members: ms.includes(mid) ? ms.filter((x) => x !== mid) : [...ms, mid] };
    }),
  }));
  const addParcel = () => setF((o) => ({ ...o, parcels: [...o.parcels, { id: uid(), name: "", price: "", members: [] }] }));
  const rmParcel = (i) => setF((o) => ({ ...o, parcels: o.parcels.filter((_, j) => j !== i) }));
  const parcelsSum = Math.round(f.parcels.reduce((acc, pc) => acc + (Number(pc.price) || 0), 0) * 100) / 100;
  const parcelsOk = f.parcels.length > 0 && f.parcels.every((pc) => Number(pc.price) > 0);
  const pool = useMemo(() => {
    const st = getStatus(ev);
    const src = st === "Concluído" ? ev.presences : (Object.values(ev.confirmations || {}).some(Boolean) ? ev.confirmations : null);
    let ids = (src ? members.filter((m) => src[m.id]) : members).map((m) => m.id);
    if (!ids.length) ids = members.map((m) => m.id);
    [...(purchase?.participants || []), ...((purchase?.parcels || []).flatMap((pc) => pc.members || []))]
      .forEach((id) => { if (!ids.includes(id)) ids.push(id); });
    return ids;
  }, [ev, members, purchase]);
  const share = f.participants.length && Number(f.total) > 0
    ? Math.round((Number(f.total) / f.participants.length) * 100) / 100 : 0;
  const sumShares = Math.round(f.participants.reduce((acc, id) => acc + (Number(f.shares[id]) || 0), 0) * 100) / 100;
  const sumOk = Math.abs(sumShares - (Number(f.total) || 0)) < 0.005;

  async function submit() {
    const total = usingParcels ? parcelsSum : Math.round(Number(f.total) * 100) / 100;
    const participants = usingParcels ? [...new Set(f.parcels.flatMap((pc) => pc.members || []))] : f.participants;
    if (!f.description.trim() || !(total > 0) || !f.payerId) return;
    if (usingParcels && !parcelsOk) return;
    if (!usingParcels && !f.participants.length) return;
    if (f.split === "custom" && !usingParcels && !sumOk) return;
    setBusy(true);
    try {
      let receipts = f.receipts;
      for (const file of files) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const url = await api.uploadFile(`receipts/${ev.id}/${f.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`, file);
        receipts = [...receipts, url];
      }
      onSave({
        id: f.id, eventId: ev.id, description: f.description.trim(),
        total,
        payerId: f.payerId, participants, settled: f.settled, receipts,
        split: f.split,
        shares: f.split === "custom" && !usingParcels
          ? Object.fromEntries(f.participants.map((id) => [id, Math.round((Number(f.shares[id]) || 0) * 100) / 100]))
          : {},
        parcels: usingParcels
          ? f.parcels.map((pc) => ({ id: pc.id || uid(), name: String(pc.name || "").trim(), price: Math.round(Number(pc.price) * 100) / 100, members: pc.members || [] }))
          : [],
      });
    } catch { setBusy(false); }
  }

  return (
    <Modal title={editing ? "Editar compra" : "Nova compra"} onClose={onClose} wide>
      <label>Descrição<input value={f.description} onChange={(e) => set("description", e.target.value)} autoFocus placeholder="ex.: Carne para o churrasco" /></label>
      <div className="row">
        <label>Valor total (€)
          {usingParcels
            ? <input value={parcelsSum > 0 ? parcelsSum.toFixed(2).replace(".", ",") : ""} placeholder="soma das parcelas" disabled title="Calculado automaticamente: soma das parcelas" />
            : <input type="number" min="0" step="0.01" value={f.total} onChange={(e) => set("total", e.target.value)} />}
        </label>
        <label>Quem pagou (a quem devem)
          {isAdmin ? (
            <select value={f.payerId} onChange={(e) => set("payerId", e.target.value)}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          ) : (
            <input value={members.find((m) => m.id === f.payerId)?.name || "?"} disabled
              title="Como membro, só podes registar compras que tu próprio pagaste" />
          )}
        </label>
      </div>
      <label>Divisão
        <div className="segmented">
          <button type="button" className={f.split === "equal" ? "on" : ""} onClick={() => set("split", "equal")}>Divisão por todos</button>
          <button type="button" className={f.split === "custom" ? "on" : ""} onClick={() => set("split", "custom")}>Só pago o que como</button>
        </div>
      </label>
      {usingParcels ? (
        <>
          <h4>Parcelas{parcelsSum > 0 ? ` · total ${eur(parcelsSum)}` : ""}</h4>
          {f.parcels.map((pc, i) => (
            <div key={pc.id || i} className="parcel">
              <div className="row" style={{ alignItems: "flex-end" }}>
                <label>Parcela<input placeholder="ex.: Frango" value={pc.name} onChange={(e) => setParcel(i, "name", e.target.value)} /></label>
                <label>Preço (€)<input type="number" min="0" step="0.01" value={pc.price} onChange={(e) => setParcel(i, "price", e.target.value)} /></label>
                <button type="button" className="iconbtn" title="Remover parcela" onClick={() => rmParcel(i)}>✕</button>
              </div>
              <div className="pill-row">
                {pool.map((mid) => {
                  const m = members.find((x) => x.id === mid);
                  if (!m) return null;
                  const on = (pc.members || []).includes(mid);
                  return (
                    <button key={mid} type="button" className={`pill ${on ? "on" : ""}`} onClick={() => toggleParcelMember(i, mid)}>
                      {m.name}{on && pc.members.length ? ` · ${eur((Number(pc.price) || 0) / pc.members.length)}` : ""}
                    </button>
                  );
                })}
              </div>
              {!(pc.members || []).length && <p className="hint" style={{ margin: "4px 0 0" }}>Sem membros associados — fica «por atribuir» (pode preencher-se mais tarde).</p>}
            </div>
          ))}
          <button type="button" className="btn ghost small" onClick={addParcel}>+ Parcela</button>
          {f.parcels.length === 0 && <p className="hint">Adiciona parcelas (ex.: Frango 80€) e associa os membros de cada uma — cada parcela é dividida pelos membros associados.</p>}
          {f.parcels.length > 0 && !parcelsOk && <p className="err">Todas as parcelas precisam de preço maior que 0.</p>}
        </>
      ) : (
        <>
          <h4>Dividir por {f.participants.length} pessoa(s){f.split === "equal" && share > 0 ? ` · ${eur(share)} cada` : ""}</h4>
          {legacyShares && f.split === "custom" && <p className="hint" style={{ marginTop: 0 }}>Compra antiga com valores manuais por membro — mantém-se assim; compras novas usam parcelas.</p>}
          <div className="pill-row">
            {members.map((m) => (
              <button key={m.id} type="button" className={`pill ${f.participants.includes(m.id) ? "on" : ""}`} onClick={() => toggleP(m.id)}>{m.name}</button>
            ))}
          </div>
          {f.split === "custom" && (
            <>
              <div className="shares-grid">
                {f.participants.map((id) => {
                  const m = members.find((x) => x.id === id);
                  return (
                    <label key={id}>{m?.name || id} (€)
                      <input type="number" min="0" step="0.01" value={f.shares[id] ?? ""}
                        onChange={(e) => setF((o) => ({ ...o, shares: { ...o.shares, [id]: e.target.value } }))} />
                    </label>
                  );
                })}
              </div>
              {!sumOk && (
                <p className="err">A soma dos valores por membro ({eur(sumShares)}) tem de igualar o total da compra ({eur(Number(f.total) || 0)}).</p>
              )}
            </>
          )}
        </>
      )}
      <label style={{ marginTop: 14 }}>Fotos da fatura (opcional)
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles([...e.target.files])} />
      </label>
      {f.receipts.length > 0 && <p className="hint">{f.receipts.length} foto(s) já carregada(s).</p>}
      <div className="actions">
        {editing && <button className="btn danger" disabled={busy} onClick={() => onDelete(purchase)}>Eliminar</button>}
        <button className="btn ember" disabled={busy || (usingParcels ? !parcelsOk : (f.split === "custom" && !sumOk))} onClick={submit}>{busy ? "A carregar…" : "Guardar compra"}</button>
      </div>
    </Modal>
  );
}

function RoleFormModal({ roles, role, onSave, onDelete, onClose }) {
  const editing = !!role;
  const others = roles.filter((r) => r.id !== role?.id);
  const [label, setLabel] = useState(role?.label || "");
  const [relation, setRelation] = useState(editing ? "manter" : "abaixo");
  const [refId, setRefId] = useState(others[0]?.id || "");
  return (
    <Modal title={editing ? "Editar cargo" : "Novo cargo"} onClose={onClose}>
      <label>Nome do cargo<input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus placeholder="ex.: Mestre da Brasa" /></label>
      {others.length > 0 && (
        <div className="row">
          <label>Posição
            <select value={relation} onChange={(e) => setRelation(e.target.value)}>
              {editing && <option value="manter">Manter posição</option>}
              <option value="acima">Acima de</option>
              <option value="igual">Igual a</option>
              <option value="abaixo">Abaixo de</option>
            </select>
          </label>
          {relation !== "manter" && (
            <label>Cargo de referência
              <select value={refId} onChange={(e) => setRefId(e.target.value)}>
                {others.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <div className="actions">
        {editing && <button className="btn danger" onClick={() => onDelete(role.id)}>Eliminar</button>}
        <button className="btn ember" disabled={!label.trim()} onClick={() => onSave(role?.id ?? null, label, relation, refId)}>
          {editing ? "Guardar cargo" : "Adicionar cargo"}
        </button>
      </div>
    </Modal>
  );
}

function LinkRow({ profile, members, onLink, onDismiss }) {
  const [mid, setMid] = useState("");
  const blanks = members.filter((m) => !m.email);
  return (
    <div className="mini-item static">
      <span>{profile.email}{profile.name ? ` · ${profile.name}` : ""}</span>
      <span className="row-actions">
        <select value={mid} onChange={(e) => setMid(e.target.value)}>
          <option value="">Associar a membro…</option>
          {blanks.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button className="btn ghost small" disabled={!mid} onClick={() => onLink(mid, profile.email)}>Associar</button>
        <button className="btn ghost small" title="Esta conta não corresponde a nenhum membro (ex.: conta de admin)" onClick={() => onDismiss(profile.id)}>Não associar</button>
      </span>
    </div>
  );
}

function AdminPanel({ admins, isMain, pendingProfiles, members, onLink, onDismiss, onAddAdmin, onRemoveAdmin, events, onSaveEvent, showToast, places, onSavePlace, onDeletePlace, onEditEvent }) {
  const [email, setEmail] = useState(""); const [err, setErr] = useState(null);
  const [sub, setSub] = useState("geral"); // 'geral' | 'eventos'
  const semLocal = (events || []).filter((e) => needsLocation(e)).length;
  return (
    <section>
      <div className="section-head"><h2>Gestão</h2></div>

      <div className="segmented" style={{ marginBottom: 18 }}>
        <button className={sub === "geral" ? "on" : ""} onClick={() => setSub("geral")}>Contas &amp; Admins</button>
        <button className={sub === "eventos" ? "on" : ""} onClick={() => setSub("eventos")}>
          Gestão de eventos{semLocal > 0 ? ` (${semLocal})` : ""}
        </button>
      </div>

      {sub === "eventos" ? (
        <>
          <p className="hint" style={{ marginTop: 0 }}>Associa localizações aos eventos que ainda não têm — por link do Google Maps ou clicando no mapa. Assim que associas, o evento sai da lista e a bola aparece no mapa (e na vista de Mapa dos Eventos).</p>
          <EventLocationManager events={events || []} onSaveEvent={onSaveEvent} showToast={showToast} places={places || []} onSavePlace={onSavePlace} onDeletePlace={onDeletePlace} onEditEvent={onEditEvent} />
        </>
      ) : (
      <>
      <h4>Contas por associar ({pendingProfiles.length})</h4>
      {pendingProfiles.length === 0 && <p className="hint">Nenhuma conta nova por associar.</p>}
      {pendingProfiles.length > 0 && members.filter((m) => !m.email).length === 0 && (
        <p className="hint">Há contas novas mas nenhum membro sem email — cria o membro primeiro ou edita o email de um existente.</p>
      )}
      <div className="mini-list">
        {pendingProfiles.map((pr) => <LinkRow key={pr.id} profile={pr} members={members} onLink={onLink} onDismiss={onDismiss} />)}
      </div>
      <p className="hint">Podes corrigir associações a qualquer momento editando o email do membro no separador Membros.</p>

      <div className="section-head" style={{ marginTop: 28 }}><h2>Admins</h2></div>
      {isMain ? (
        <div className="card admin-card">
          <h4>Adicionar admin</h4>
          <p className="hint">A pessoa cria conta no site (email/password ou Google) e tu adicionas aqui o email dela para lhe dar permissões de gestão.</p>
          <div className="row">
            <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          </div>
          {err && <p className="err">{err}</p>}
          <div className="actions">
            <button className="btn ember" onClick={async () => { const e = await onAddAdmin(email); setErr(e); if (!e) setEmail(""); }}>Adicionar</button>
          </div>
        </div>
      ) : (
        <p className="hint">Apenas o ADMIN principal pode gerir admins.</p>
      )}

      <h4 style={{ marginTop: 24 }}>Admins ({admins.length})</h4>
      <div className="mini-list">
        {admins.map((a) => (
          <div key={a.email} className="mini-item static">
            <span>{a.email} {a.is_main ? <b className="tag">PRINCIPAL</b> : <b className="tag">ADMIN</b>}</span>
            {isMain && !a.is_main && (
              <span className="row-actions">
                <button className="btn danger small" onClick={() => onRemoveAdmin(a.email)}>Remover</button>
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="hint">As contas são geridas pelo Supabase Auth — qualquer pessoa pode criar conta, mas só os emails desta lista têm permissões de gestão.</p>
      </>
      )}
    </section>
  );
}

/* ============================================================
   Estilos
   ============================================================ */
function Style() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap');

      .grill-root {
        --bg: #17130F;
        --surface: #211C17;
        --surface2: #2A241E;
        --line: #3A322A;
        --text: #F0E9DF;
        --muted: #9C9184;
        --ember: #FF7A3D;
        --gold: #F5B841;
        --danger: #D96C5F;
        min-height: 100vh;
        background:
          radial-gradient(1000px 500px at 80% -10%, rgba(255,122,61,.10), transparent 60%),
          radial-gradient(700px 400px at 0% 100%, rgba(245,184,65,.06), transparent 60%),
          var(--bg);
        color: var(--text);
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 14.5px;
      }
      .grill-center { display:flex; align-items:center; justify-content:center; padding:24px; }
      .loading { display:flex; gap:10px; align-items:center; color:var(--ember); font-weight:600; }

      h1,h2,h3 { font-family:'Bebas Neue','Arial Narrow',sans-serif; letter-spacing:.06em; font-weight:400; margin:0; }
      h1 { font-size:26px; } h1 em { color:var(--ember); font-style:normal; }
      h2 { font-size:24px; } h3 { font-size:20px; }
      h4 { margin:18px 0 8px; font-size:12px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }

      .topbar { display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-bottom:1px solid var(--line); background:rgba(23,19,15,.85); position:sticky; top:0; z-index:20; backdrop-filter:blur(6px); }
      .brand { display:flex; align-items:center; gap:10px; }
      .brand-flame { color:var(--ember); display:flex; filter:drop-shadow(0 0 8px rgba(255,122,61,.6)); }
      .brand-flame.big { justify-content:center; margin-bottom:6px; }
      .topbar-right { display:flex; gap:10px; align-items:center; }
      .userchip { color:var(--muted); font-size:13px; }
      .userchip b { margin-left:8px; color:var(--gold); font-size:10px; letter-spacing:.1em; border:1px solid var(--gold); border-radius:4px; padding:2px 6px; }

      .layout { display:flex; min-height:calc(100vh - 61px); }
      .sidebar { width:180px; padding:18px 12px; border-right:1px solid var(--line); display:flex; flex-direction:column; gap:4px; flex-shrink:0; }
      .navbtn { text-align:left; background:none; border:none; color:var(--muted); padding:10px 12px; border-radius:8px; cursor:pointer; font:inherit; font-weight:500; border-left:3px solid transparent; }
      .navbtn:hover { color:var(--text); background:var(--surface); }
      .navbtn.active { color:var(--text); background:var(--surface); border-left-color:var(--ember); }
      .content { flex:1; padding:24px 28px; min-width:0; }

      .section-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:18px; flex-wrap:wrap; }
      .head-actions { display:flex; gap:10px; align-items:center; }
      .segmented { display:flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
      .segmented button { background:none; border:none; color:var(--muted); padding:7px 12px; cursor:pointer; font:inherit; font-size:13px; }
      .segmented button.on { background:var(--surface2); color:var(--text); }

      .btn { border:none; border-radius:8px; padding:9px 14px; font:inherit; font-weight:600; cursor:pointer; }
      .btn.ember { background:linear-gradient(135deg,var(--ember),#E85D1F); color:#1A0F08; }
      .btn.ember:hover { filter:brightness(1.1); }
      .btn.ghost { background:none; border:1px solid var(--line); color:var(--text); }
      .btn.danger { background:none; border:1px solid var(--danger); color:var(--danger); }
      .btn.small { padding:5px 10px; font-size:12px; }
      .btn:disabled { opacity:.45; cursor:not-allowed; }
      .iconbtn { background:none; border:none; color:var(--muted); cursor:pointer; padding:4px; border-radius:6px; display:inline-flex; }
      .iconbtn:hover { color:var(--ember); background:var(--surface2); }

      .card { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:16px; }
      .cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(360px, 1fr)); gap:10px; align-items:start; }
      .cards.grid2 { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); }
      .event-card { cursor:pointer; transition:border-color .15s; }
      .event-card:hover { border-color:var(--ember); }
      .event-top { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
      .event-top strong { font-size:15.5px; }
      .event-date { color:var(--muted); font-size:13px; margin-top:2px; }
      .event-meta { display:flex; gap:12px; align-items:center; margin-top:10px; flex-wrap:wrap; font-size:12.5px; color:var(--muted); }
      .status { display:inline-flex; align-items:center; gap:6px; padding:3px 9px; border-radius:20px; font-size:11.5px; font-weight:600; }
      .status i { width:6px; height:6px; border-radius:50%; }
      .loc { display:inline-flex; align-items:center; gap:4px; }

      /* Friso temporal — o "espeto" */
      .skewer { position:relative; padding:10px 0 30px; }
      .skewer::before { content:''; position:absolute; left:50%; top:0; bottom:0; width:3px; transform:translateX(-50%);
        background:linear-gradient(180deg, var(--line), var(--ember) 50%, var(--line)); border-radius:2px; }
      .skewer-item { position:relative; width:calc(50% - 30px); margin-bottom:22px; }
      .skewer-item.left { margin-right:auto; text-align:right; }
      .skewer-item.right { margin-left:auto; }
      .skewer-dot { position:absolute; top:24px; width:13px; height:13px; border-radius:50%; border:3px solid var(--bg); box-shadow:0 0 10px rgba(255,122,61,.5); }
      .skewer-item.left .skewer-dot { right:-37px; }
      .skewer-item.right .skewer-dot { left:-37px; }
      .skewer-date { font-family:'Bebas Neue','Arial Narrow',sans-serif; letter-spacing:.06em; color:var(--gold); margin-bottom:6px; font-size:15px; }
      .event-card.compact .event-top { justify-content:space-between; }
      .skewer-item.left .event-top { flex-direction:row-reverse; }
      .skewer-item.left .event-meta { justify-content:flex-end; }

      /* Scoreboard */
      .board { display:flex; flex-direction:column; gap:8px; }
      .board-row { display:grid; grid-template-columns:34px 1fr 2fr 42px 52px 56px; align-items:center; gap:12px;
        background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:12px 14px; cursor:pointer; color:var(--text); font:inherit; text-align:left; }
      .board-row:hover { border-color:var(--ember); }
      .rank { font-family:'Bebas Neue','Arial Narrow',sans-serif; font-size:19px; color:var(--muted); text-align:center; }
      .rank.r1 { color:var(--gold); } .rank.r2 { color:#C8C2B8; } .rank.r3 { color:#C68B59; }
      .board-name { font-weight:600; }
      .board-bar { height:9px; background:var(--surface2); border-radius:6px; overflow:hidden; }
      .board-bar i { display:block; height:100%; background:linear-gradient(90deg,#E85D1F,var(--ember),var(--gold)); border-radius:6px; box-shadow:0 0 8px rgba(255,122,61,.5); }
      .board-pct { font-weight:700; color:var(--ember); text-align:right; }
      .board-count { color:var(--muted); font-size:12px; text-align:right; }
      .streak { display:inline-flex; align-items:center; gap:3px; font-size:13px; color:var(--text); justify-self:center; white-space:nowrap; }
      .streak b { font-weight:700; font-variant-numeric:tabular-nums; }
      .streak-flame { display:inline-flex; filter:drop-shadow(0 0 5px currentColor); }
      .streak.cold { opacity:.38; }
      .streak.cold .streak-flame { filter:none; }
      .streak.record .streak-flame { animation:flamePulse 1.4s ease-in-out infinite; }
      @keyframes flamePulse { 0%,100%{ transform:scale(1); } 50%{ transform:scale(1.2); } }
      .hot-banner { display:flex; align-items:center; gap:12px; width:100%; margin-top:26px; padding:11px 15px; text-align:left;
        background:linear-gradient(90deg, rgba(255,77,46,.16), rgba(245,184,65,.04)); border:1px solid rgba(255,122,61,.32);
        border-radius:12px; color:var(--text); font-size:14px; cursor:pointer; transition:border-color .15s, transform .15s; }
      .hot-banner:hover { border-color:var(--ember); transform:translateY(-1px); }
      .streak.ash .streak-flame { filter:none; opacity:.9; }

      /* Scoreboard + colunas laterais (Hall of Fame / Traições) */
      .score-layout { display:grid; grid-template-columns:minmax(0,3fr) minmax(210px,1fr); gap:20px; align-items:start; }
      .score-side { display:flex; flex-direction:column; gap:16px; position:sticky; top:16px; }
      .side-panel { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:14px 15px; }
      .side-panel h3 { margin:0; font-size:15px; display:flex; align-items:center; gap:6px; }
      .side-sub { color:var(--muted); font-size:11px; margin:2px 0 10px; }
      .hof-row { display:flex; align-items:center; gap:9px; width:100%; padding:8px; border:0; border-radius:7px;
        background:none; color:var(--text); font:inherit; text-align:left; cursor:pointer; transition:background .12s; }
      .hof-row:hover { background:var(--surface2); }
      .hof-row:hover .hof-name { color:var(--ember); }
      .hof-rank { width:16px; flex:none; text-align:center; font-family:'Bebas Neue','Arial Narrow',sans-serif; font-size:16px; color:var(--muted); }
      .hof-rank.r1 { color:var(--gold); } .hof-rank.r2 { color:#C8C2B8; } .hof-rank.r3 { color:#C68B59; }
      .hof-name { flex:1; font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

      /* Membros */
      .member-card { display:flex; align-items:center; gap:12px; cursor:pointer; }
      .member-card:hover { border-color:var(--ember); }
      .avatar { width:40px; height:40px; border-radius:50%; background:linear-gradient(135deg,var(--ember),var(--gold)); color:#1A0F08;
        display:flex; align-items:center; justify-content:center; font-family:'Bebas Neue',sans-serif; font-size:20px; flex-shrink:0; }
      .member-info { display:flex; flex-direction:column; flex:1; }
      .member-info span { color:var(--muted); font-size:12.5px; }

      /* Hierarquia */
      .tree { display:flex; flex-direction:column; align-items:center; }
      .tier { display:flex; flex-direction:column; align-items:center; }
      .tier-link { width:2px; height:26px; background:var(--line); }
      .tier-roles { display:flex; gap:12px; flex-wrap:wrap; justify-content:center; }
      .role-chip { background:var(--surface); border:1px solid var(--gold); color:var(--text); border-radius:10px; padding:10px 16px; font-weight:600; display:flex; gap:8px; align-items:center; }
      .role-count { background:var(--surface2); color:var(--muted); border-radius:12px; padding:1px 8px; font-size:11.5px; }
      .chip-x { background:none; border:none; color:var(--muted); cursor:pointer; font-size:15px; padding:0 2px; }
      .chip-x:hover { color:var(--danger); }

      /* Modais e formulários */
      .overlay { position:fixed; inset:0; background:rgba(10,8,6,.7); display:flex; align-items:center; justify-content:center; padding:20px; z-index:50; backdrop-filter:blur(3px); }
      .modal { background:var(--surface); border:1px solid var(--line); border-radius:14px; width:100%; max-width:420px; max-height:88vh; display:flex; flex-direction:column; }
      .modal.wide { max-width:600px; }
      .modal-head { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--line); }
      .modal-body { padding:18px 20px 22px; overflow-y:auto; }
      label { display:flex; flex-direction:column; gap:5px; margin-bottom:12px; font-size:12.5px; color:var(--muted); font-weight:500; flex:1; }
      label.check { flex-direction:row; align-items:center; gap:8px; color:var(--text); }
      input, select, textarea { background:var(--surface2); border:1px solid var(--line); border-radius:8px; padding:9px 11px; color:var(--text); font:inherit; }
      input:focus, select:focus, textarea:focus { outline:none; border-color:var(--ember); }
      .row { display:flex; gap:12px; }
      .actions { display:flex; justify-content:flex-end; gap:10px; margin-top:14px; }
      .err { color:var(--danger); font-size:13px; margin:4px 0; }
      .hint { color:var(--muted); font-size:12.5px; margin-top:14px; }
      .empty { color:var(--muted); padding:30px 0; text-align:center; }

      .pill-row { display:flex; flex-wrap:wrap; gap:8px; }
      .pill { background:var(--surface2); border:1px solid var(--line); border-radius:20px; padding:6px 13px; color:var(--muted); cursor:pointer; font:inherit; font-size:13px; }
      .pill.on { background:rgba(255,122,61,.15); border-color:var(--ember); color:var(--ember); font-weight:600; }
      .pill.claim { border-style:dashed; border-color:var(--gold); color:var(--gold); }
      .pill:hover { border-color:var(--ember); }

      .detail-row { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:12px; }
      .desc { color:var(--text); margin:8px 0; }
      .loc-line { display:flex; align-items:center; gap:6px; color:var(--muted); }
      .loc-line a { color:var(--ember); text-decoration:none; }
      .detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
      .klabel { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); margin-bottom:2px; }

      .mini-list { display:flex; flex-direction:column; gap:6px; }
      .mini-item { display:flex; justify-content:space-between; align-items:center; background:var(--surface2); border:1px solid var(--line); border-radius:8px; padding:10px 13px; color:var(--text); font:inherit; cursor:pointer; text-align:left; }
      .mini-item:hover { border-color:var(--ember); }
      .mini-item.static { cursor:default; }
      .mini-item.static:hover { border-color:var(--line); }
      .mini-date { color:var(--muted); font-size:12px; }
      .tag { color:var(--gold); font-size:10px; letter-spacing:.08em; border:1px solid var(--gold); border-radius:4px; padding:1px 5px; margin-left:6px; }
      .row-actions { display:flex; gap:8px; }

      .bootstrap { max-width:360px; width:100%; text-align:center; display:flex; flex-direction:column; gap:6px; padding:30px 26px; }
      .bootstrap p { color:var(--muted); margin:4px 0 14px; }
      .bootstrap label { text-align:left; }

      .toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:var(--surface2); border:1px solid var(--ember); color:var(--text); padding:11px 20px; border-radius:10px; z-index:100; box-shadow:0 6px 24px rgba(0,0,0,.4); }

      /* GrillHub */
      .brand { background:none; border:none; cursor:pointer; padding:0; color:var(--text); display:flex; align-items:center; gap:10px; }
      .logo-img { width:36px; height:36px; display:block; }
      .avatar-btn { width:34px; height:34px; border-radius:50%; border:1px solid var(--line); background:var(--surface2); color:var(--gold); font-weight:700; cursor:pointer; overflow:hidden; display:flex; align-items:center; justify-content:center; padding:0; flex-shrink:0; }
      .avatar-btn:hover { border-color:var(--ember); }
      .avatar-btn img { width:100%; height:100%; object-fit:cover; }
      img.avatar.avatar-img { object-fit:cover; padding:0; border-radius:50%; width:40px; height:40px; }
      .uname { display:block; color:var(--muted); font-size:11px; opacity:.75; font-weight:400; }
      .home-grid { display:flex; gap:22px; align-items:flex-start; }
      .home-main { flex:1; min-width:0; }
      .todo-panel { width:232px; flex-shrink:0; position:sticky; top:80px; background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:14px 16px; box-shadow:0 10px 28px rgba(0,0,0,.35); }
      .todo-item { display:flex; flex-direction:column; gap:6px; border-top:1px solid var(--line); padding:10px 0; }
      .todo-item:first-of-type { border-top:none; }
      .todo-name { background:none; border:none; color:var(--text); font:inherit; font-weight:600; cursor:pointer; text-align:left; padding:0; }
      .todo-name:hover { color:var(--ember); }
      .carousel { display:flex; align-items:stretch; gap:10px; }
      .carousel-track { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px; flex:1; }
      .carousel-item { display:flex; flex-direction:column; gap:8px; }
      .carousel-item .pill { align-self:flex-start; }
      .carousel-item .event-card { flex:1; }
      .arrow { background:var(--surface); border:1px solid var(--line); color:var(--muted); border-radius:10px; width:34px; cursor:pointer; font-size:20px; flex-shrink:0; }
      .arrow:hover:not(:disabled) { color:var(--ember); border-color:var(--ember); }
      .arrow:disabled { opacity:.3; cursor:default; }

      /* Home 2.0 */
      .content.wide { max-width:none; }
      .content.wide-score { max-width:1240px; margin-inline:auto; }
      .home2 { width:100%; }
      .tl-labels, .tl-row { display:grid; grid-template-columns:1.05fr 2.55fr 1.55fr; gap:14px; }
      .tl-labels.tl-c2, .tl-row.tl-c2 { grid-template-columns:1.05fr 1.75fr 2.35fr; }
      .tl-labels.tl-c1, .tl-row.tl-c1 { grid-template-columns:1.05fr 0.95fr 3.15fr; }
      .tl-labels.tl-c0, .tl-row.tl-c0 { grid-template-columns:1.05fr 0.9fr 3.2fr; }
      .tl-labels h4 { margin:0 0 10px; }
      .tl-center { display:grid; grid-template-columns:repeat(auto-fit, minmax(0, 1fr)); gap:14px; }
      .tl-slot { min-width:0; }
      .tl-left { position:relative; display:flex; flex-direction:column; }
      .tl-card { background:linear-gradient(105deg, var(--surface) 20%, rgba(33,28,23,.45) 100%); border:1px solid var(--line);
        border-radius:14px; padding:16px; cursor:pointer; display:flex; flex-direction:column; gap:8px; min-height:150px;
        transition:border-color .18s, transform .18s, box-shadow .18s; }
      .tl-card:hover { border-color:var(--ember); transform:translateY(-5px) scale(1.02); box-shadow:0 14px 34px rgba(0,0,0,.45), 0 0 0 1px rgba(255,122,61,.25), 0 0 24px rgba(255,122,61,.12); }
      .tl-card.big { background:var(--surface); height:100%; }
      .tl-card.empty-card { cursor:default; align-items:center; justify-content:center; }
      .tl-card.empty-card:hover { border-color:var(--line); transform:none; box-shadow:none; }
      .fade-0 { opacity:1; } .fade-1 { opacity:.85; } .fade-2 { opacity:.68; }
      .fade-1:hover, .fade-2:hover { opacity:1; }
      .tl-date { font-family:'Bebas Neue','Arial Narrow',sans-serif; letter-spacing:.06em; color:var(--gold); font-size:15px; }
      .tl-meta { display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-size:12.5px; color:var(--muted); }
      .tl-foot { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:auto; flex-wrap:wrap; }
      .tl-arrows { position:absolute; bottom:12px; left:0; right:0; display:flex; justify-content:center; gap:10px;
        opacity:0; transition:opacity .2s; pointer-events:none; }
      .tl-left:hover .tl-arrows { opacity:1; pointer-events:auto; }
      .tl-arrows .arrow { width:40px; height:34px; backdrop-filter:blur(4px); background:rgba(42,36,30,.85); }
      @keyframes slidePast { from { transform:translateX(-46px) scale(.95); opacity:0; } to { transform:translateX(0) scale(1); opacity:1; } }
      @keyframes slideFuture { from { transform:translateX(46px) scale(.95); opacity:0; } to { transform:translateX(0) scale(1); opacity:1; } }
      .tl-row.slide-past .tl-card { animation:slidePast .42s cubic-bezier(.22,1,.36,1) backwards; }
      .tl-row.slide-future .tl-card { animation:slideFuture .42s cubic-bezier(.22,1,.36,1) backwards; }
      .tl-row.slide-past .tl-center .tl-card:nth-child(1), .tl-row.slide-future .tl-center .tl-card:nth-child(1) { animation-delay:.06s; }
      .tl-row.slide-past .tl-center .tl-card:nth-child(2), .tl-row.slide-future .tl-center .tl-card:nth-child(2) { animation-delay:.12s; }
      .tl-row.slide-past .tl-center .tl-card:nth-child(3), .tl-row.slide-future .tl-center .tl-card:nth-child(3) { animation-delay:.18s; }
      .tl-row.slide-past .tl-right .tl-card, .tl-row.slide-future .tl-right .tl-card { animation-delay:.24s; }
      .tl-right { display:flex; flex-direction:column; gap:14px; }
      .tl-row.tl-c0 .tl-right, .tl-row.tl-c1 .tl-right { display:grid; grid-template-columns:1fr 1.5fr; gap:14px; align-items:start; }
      @media (max-width: 900px) { .tl-row.tl-c0 .tl-right, .tl-row.tl-c1 .tl-right { display:flex; flex-direction:column; } }
      .todo-panel2 { background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:14px 16px;
        box-shadow:0 10px 28px rgba(0,0,0,.3); }
      .tl-right .todo-panel2:only-child { flex:1; }
      .podium { display:grid; grid-template-columns:repeat(5, 1fr); gap:14px; }
      .podium-card { display:flex; flex-direction:column; align-items:center; gap:9px; background:var(--surface);
        border:1px solid var(--line); border-radius:14px; padding:18px 14px; cursor:pointer; font:inherit; color:var(--text);
        transition:border-color .18s, transform .18s; }
      .podium-card:hover { border-color:var(--ember); transform:translateY(-3px); }
      .podium-card .board-name { text-align:center; }
      .podium-card .board-bar { width:100%; height:8px; background:var(--surface2); border-radius:6px; overflow:hidden; }
      .podium-pct { font-weight:700; color:var(--ember); font-size:14px; }
      .podium-card .rank { font-size:24px; }

      .badge { background:var(--ember); color:#1A0F08; border-radius:10px; font-size:11px; font-weight:700; padding:1px 7px; margin-left:8px; }
      .purchase { background:var(--surface2); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:10px; display:flex; flex-direction:column; gap:8px; }
      .purchase-head { display:flex; align-items:center; gap:10px; }
      .purchase-head strong { flex:1; }
      .purchase-total { color:var(--gold); font-weight:700; }
      .receipts { display:flex; gap:8px; flex-wrap:wrap; }
      .receipts img { width:64px; height:64px; object-fit:cover; border-radius:8px; border:1px solid var(--line); }
      .receipts a:hover img { border-color:var(--ember); }
      input[type="file"] { padding:7px; }
      .filter-bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:16px; }
      .filter-bar select { padding:7px 10px; }
      .btn.ghost.active-filter { border-color:var(--ember); color:var(--ember); }
      .shares-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:6px 12px; margin-top:10px; }
      .parcel { border:1px dashed var(--line); border-radius:10px; padding:10px 12px; margin-bottom:10px; }
      .parcel .row { margin-bottom:6px; }
      .parcel-line { word-break:break-word; }
      .debt-line { font-size:12.5px; color:var(--muted); }
      .net-summary { margin-top:10px; padding:8px 10px; border-radius:8px; background:rgba(245,184,104,.06); border:1px solid var(--line); line-height:1.5; }
      .debt-age { color:var(--muted); font-weight:400; }
      .debt-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; margin:6px 0; }
      @media (max-width: 760px) { .debt-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); } }
      .debt-cell { background:var(--surface2); border:1px solid var(--line); border-radius:10px; padding:7px 9px;
        display:flex; flex-direction:column; gap:2px; min-width:0; font-size:12.5px; }
      .debt-cell-name { font-weight:700; color:var(--ember); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      button.debt-cell { font:inherit; color:var(--text); text-align:left; cursor:pointer; transition:border-color .15s; }
      button.debt-cell:hover { border-color:var(--ember); }
      .shame-btn { margin-top:6px; align-self:flex-start; border-color:var(--ember); color:var(--ember); cursor:pointer; }
      .shame-note { margin-top:12px; padding:10px 12px; border-radius:10px; border:1px solid #E23B3B;
        background:rgba(226,59,59,.10); display:flex; align-items:flex-start; gap:8px; font-size:13.5px; line-height:1.5; }
      .shame-note span:first-child { flex:1; }
      .shame-note em { color:#FF8A5C; font-weight:700; }
      .debt-cell .debt-age { font-size:11.5px; }
      .debt-badge { position:relative; display:inline-flex; width:18px; height:18px; border-radius:50%; align-items:center;
        justify-content:center; font-size:11px; font-weight:800; margin-left:7px; cursor:help; color:#1A0F08; vertical-align:middle; }
      .debt-badge.t7 { background:#F5B841; }
      .debt-badge.t15 { background:#FF7A3D; }
      .debt-badge.t30 { background:#E23B3B; color:#fff; }
      .debt-badge.t60 { background:#0A0A0A; color:#F5B841; border:1px solid #F5B841;
        box-shadow:0 0 8px rgba(245,184,104,.85), 0 0 16px rgba(245,184,104,.4); animation:debt-glow 1.6s ease-in-out infinite alternate; }
      @keyframes debt-glow { from { box-shadow:0 0 6px rgba(245,184,104,.6); } to { box-shadow:0 0 14px rgba(245,184,104,1), 0 0 24px rgba(245,184,104,.5); } }
      .debt-tip { display:none; position:absolute; top:100%; left:50%; transform:translateX(-50%); z-index:30; min-width:230px;
        background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:10px 12px; box-shadow:0 12px 30px rgba(0,0,0,.45);
        font-size:12.5px; font-weight:400; color:var(--text); text-align:left; flex-direction:column; gap:4px; white-space:nowrap; }
      .debt-badge:hover .debt-tip, .debt-badge.open .debt-tip { display:flex; }
      .bday-banner { margin-top:12px; padding:12px 14px; border-radius:12px; border:1px solid var(--gold);
        background:linear-gradient(135deg, rgba(245,184,104,.14), rgba(255,122,61,.10)); }
      .bday-banner h4 { color:var(--gold); }
      .bday-wish { margin-top:8px; padding:8px 10px; border-radius:8px; background:rgba(255,255,255,.05); font-size:13.5px; line-height:1.45; }
      .bday-note span:first-child { flex:1; }
      .debt-line b { color:var(--ember); }

      @media (max-width: 760px) {
        .layout { flex-direction:column; }
        .sidebar { width:auto; flex-direction:row; overflow-x:auto; border-right:none; border-bottom:1px solid var(--line); padding:10px 12px; }
        .navbtn { border-left:none; border-bottom:2px solid transparent; white-space:nowrap; }
        .navbtn.active { border-bottom-color:var(--ember); }
        .content { padding:18px 14px; }
        .skewer::before { left:10px; }
        .skewer-item, .skewer-item.left, .skewer-item.right { width:auto; margin:0 0 20px 34px; text-align:left; }
        .skewer-item.left .skewer-dot, .skewer-item.right .skewer-dot { left:-31px; right:auto; }
        .skewer-item.left .event-top { flex-direction:row; }
        .skewer-item.left .event-meta { justify-content:flex-start; }
        .board-row { grid-template-columns:28px 1fr 42px 60px; }
        .board-bar, .board-count { display:none; }
        .score-layout { grid-template-columns:1fr; }
        .score-side { position:static; }
        .row { flex-direction:column; gap:0; }
        .detail-grid { grid-template-columns:1fr; }
        .home-grid { flex-direction:column; }
        .todo-panel { width:auto; position:static; }
        .tl-labels { display:none; }
        .tl-row { grid-template-columns:1fr; }
        .tl-center { grid-template-columns:1fr; }
        .tl-arrows { opacity:1; pointer-events:auto; position:static; margin-top:8px; }
        .tl-card { min-height:0; }
        .podium { grid-template-columns:1fr 1fr; gap:10px; }
        .podium-card { padding:14px 10px; }
        .userchip { display:none; }
        h1 { font-size:22px; }
        .logo-img { width:30px; height:30px; }
        .topbar { padding:10px 12px; }
        input, select, textarea { font-size:16px; }
        .purchase-head { flex-wrap:wrap; }
        .shares-grid { grid-template-columns:1fr 1fr; }
        .modal { max-height:92vh; }
        .actions { flex-wrap:wrap; }
      }
      @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
    `}</style>
  );
}
