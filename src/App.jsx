import React, { useState, useEffect, useMemo } from "react";

/* ============================================================
   GRILLHUB
   - Consulta livre sem login; ADMIN entra com conta Supabase
     (email+password ou Google) para gerir
   - Dados em tabelas Supabase com RLS (ver src/api.js)
   ============================================================ */
import { api, supabase } from "./api.js";
import * as XLSX from "xlsx";

const SITE_URL = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";

/* ---------- Utilitários ---------- */
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

const todayISO = () => new Date().toISOString().slice(0, 10);

function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const eur = (n) => `${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")} €`;

const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

const shareOf = (pu, mid) =>
  pu.split === "custom"
    ? Math.round((Number(pu.shares?.[mid]) || 0) * 100) / 100
    : (pu.participants?.length ? Math.round((pu.total / pu.participants.length) * 100) / 100 : 0);

function eventEndDate(ev) {
  return ev.dateEnd || ev.dateStart;
}

function getStatus(ev) {
  if (ev.status === "Concluído") return "Concluído";
  if (eventEndDate(ev) && eventEndDate(ev) < todayISO()) return "Concluído";
  if (ev.status === "Planeado") return "Agendado"; // compatibilidade com dados antigos
  return ev.status || "Por planear";
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
        setData({ admins: [], members: [], events: [], roles: [], purchases: [], profiles: [] });
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
    const concluded = data.events.filter((e) => getStatus(e) === "Concluído");
    return data.members
      .map((mb) => {
        const eligible = concluded.filter((e) => !mb.joinDate || eventEndDate(e) >= mb.joinDate);
        const present = eligible.filter((e) => e.presences?.[mb.id]);
        const pct = eligible.length ? Math.round((present.length / eligible.length) * 100) : 0;
        return { member: mb, pct, present: present.length, total: eligible.length };
      })
      .sort((a, b) => b.pct - a.pct || b.present - a.present || a.member.name.localeCompare(b.member.name));
  }, [data]);

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
    } catch { showToast("Não foi possível guardar o evento."); }
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
        await api.updateMyProfile(f.username.trim(), f.birthDate || null, f.avatarUrl.trim());
        setData({
          ...data,
          members: data.members.map((m) =>
            m.id === myMember.id
              ? { ...m, username: f.username.trim() || null, birthDate: f.birthDate || null, avatarUrl: f.avatarUrl.trim() || null }
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

  async function toggleSettled(pu, memberId) {
    const next = { ...pu, settled: { ...pu.settled, [memberId]: !pu.settled[memberId] } };
    try {
      await api.savePurchase(next);
      setData({ ...data, purchases: data.purchases.map((p) => (p.id === pu.id ? next : p)) });
    } catch { showToast("Não foi possível atualizar."); }
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
            ["scoreboard", "Scoreboard"],
            ["membros", "Membros"],
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
        <main className={`content ${tab === "home" ? "wide" : ""}`}>
          {tab === "home" && (
            <HomeTab events={sortedEventsAsc} scoreboard={scoreboard} myMember={myMember}
              purchases={data.purchases} members={data.members}
              onOpenEvent={(id) => setModal({ type: "eventDetail", id })}
              onMember={(id) => setModal({ type: "memberDetail", id })}
              onConfirm={toggleConfirmation}
              onGoScoreboard={() => setTab("scoreboard")} />
          )}

          {tab === "eventos" && (
            <section>
              <div className="section-head">
                <h2>Eventos</h2>
                <div className="head-actions">
                  <div className="segmented">
                    <button className={eventView === "lista" ? "on" : ""} onClick={() => setEventView("lista")}>Lista</button>
                    <button className={eventView === "timeline" ? "on" : ""} onClick={() => setEventView("timeline")}>Friso temporal</button>
                  </div>
                  {isAdmin && <button className="btn ghost" onClick={() => setModal({ type: "importEvents" })}>Importar Excel</button>}
                  {isAdmin && <button className="btn ember" onClick={() => setModal({ type: "eventForm" })}>+ Evento</button>}
                </div>
              </div>

              <div className="filter-bar">
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

              {eventView === "lista" ? (
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
              <div className="board">
                {scoreboard.map((row, i) => (
                  <button key={row.member.id} className="board-row" onClick={() => setModal({ type: "memberDetail", id: row.member.id })}>
                    <span className={`rank r${i + 1}`}>{i + 1}</span>
                    <span className="board-name">
                      {row.member.name}
                      {row.member.username && <span className="uname">@{row.member.username}</span>}
                    </span>
                    <span className="board-bar"><i style={{ width: `${row.pct}%` }} /></span>
                    <span className="board-pct">{row.pct}%</span>
                    <span className="board-count">{row.present}/{row.total}</span>
                  </button>
                ))}
              </div>
              <p className="hint">Percentagem calculada sobre eventos concluídos desde a data de integração de cada membro (sem data de integração, contam todos).</p>
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
              onAddAdmin={addAdmin} onRemoveAdmin={removeAdmin} />
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
          onAddPurchase={() => setModal({ type: "purchaseForm", eventId: ev.id })}
          onEditPurchase={(pid) => setModal({ type: "purchaseForm", eventId: ev.id, id: pid })}
          onToggleSettled={toggleSettled}
          onClose={() => setModal(null)} />;
      })()}

      {modal?.type === "eventForm" && (
        <EventFormModal ev={data.events.find((e) => e.id === modal.id)} members={data.members}
          onSave={upsertEvent} onDelete={deleteEvent} onClose={() => setModal(null)} />
      )}

      {modal?.type === "memberDetail" && (() => {
        const mb = data.members.find((m) => m.id === modal.id);
        if (!mb) return null;
        const attended = sortedEventsAsc.filter((e) => e.presences?.[mb.id]);
        const row = scoreboard.find((r) => r.member.id === mb.id);
        return <MemberDetailModal mb={mb} role={roleById[mb.roleId]} attended={attended} row={row}
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
        return <PurchaseFormModal ev={ev} purchase={pu} members={data.members}
          onSave={savePurchase} onDelete={deletePurchase}
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

function HomeTab({ events, scoreboard, myMember, purchases, members, onOpenEvent, onMember, onConfirm, onGoScoreboard }) {
  const myDebts = useMemo(() => {
    if (!myMember) return [];
    const items = [];
    (purchases || []).forEach((pu) => {
      if (!pu.participants?.includes(myMember.id)) return;
      if (pu.payerId === myMember.id || pu.settled?.[myMember.id]) return;
      const amount = shareOf(pu, myMember.id);
      if (amount <= 0) return;
      const ev = events.find((e) => e.id === pu.eventId);
      items.push({
        id: pu.id, eventId: pu.eventId, eventName: ev?.name || "?",
        desc: pu.description, amount,
        payer: members.find((m) => m.id === pu.payerId)?.name || "?",
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

  function move(d) {
    const nk = Math.min(Math.max(0, k + d), maxOffset);
    if (nk !== k) { setDir(d); setOffset(nk); }
  }

  const card = (ev, fade = 0, big = false) => {
    const st = getStatus(ev); const sty = STATUS_STYLE[st];
    return (
      <div key={ev.id} className={`tl-card fade-${fade} ${big ? "big" : ""}`} onClick={() => onOpenEvent(ev.id)}>
        <div className="tl-date">{fmtDate(ev.dateStart)}{ev.dateEnd ? ` → ${fmtDate(ev.dateEnd)}` : ""}</div>
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
      <div className="tl-labels">
        <h4>{k === 0 ? "Últimos eventos" : `Linha temporal · ${k} para trás`}</h4>
        <h4>{k === 0 ? "Próximos eventos" : ""}</h4>
        <h4>{k === 0 ? "Por confirmar" : ""}</h4>
      </div>
      <div className={`tl-row ${dir > 0 ? "slide-past" : dir < 0 ? "slide-future" : ""}`} key={`k${k}`}>
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
              {myMember && myDebts.length === 0 && <p className="hint">Sem contas por saldar.</p>}
              {myMember && myDebts.map((d) => (
                <div key={d.id} className="todo-item">
                  <button className="todo-name" onClick={() => onOpenEvent(d.eventId)}>{d.eventName}</button>
                  <span className="mini-date">{d.desc}</span>
                  <span className="debt-line">deves <b>{eur(d.amount)}</b> a <b>{d.payer}</b></span>
                </div>
              ))}
            </div>
            </>
          ) : (
            rightEv ? card(rightEv, 2) : <div className="tl-card empty-card" />
          )}
        </div>
      </div>

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
        <div className="event-date">{fmtDate(ev.dateStart)}{ev.dateEnd ? ` → ${fmtDate(ev.dateEnd)}` : ""}</div>
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

function EventDetailModal({ ev, members, isAdmin, myMember, purchases, onEdit, onMember, onConfirm, onNotify, onAddPurchase, onEditPurchase, onToggleSettled, onClose }) {
  const owing = {};
  (purchases || []).forEach((pu) => {
    (pu.participants || []).forEach((mid) => {
      if (mid !== pu.payerId && !pu.settled?.[mid]) owing[mid] = (owing[mid] || 0) + shareOf(pu, mid);
    });
  });
  const owingEmails = Object.keys(owing).map((id) => members.find((m) => m.id === id)?.email).filter(Boolean);
  const mailtoBody = Object.keys(owing).map((id) => {
    const m = members.find((x) => x.id === id);
    return `${m?.name || id}: ${eur(owing[id])} em dívida`;
  }).join("\n");
  const mailtoHref = owingEmails.length
    ? `mailto:${owingEmails.join(",")}?subject=${encodeURIComponent(`GrillHub — contas por saldar: ${ev.name}`)}&body=${encodeURIComponent(`Olá! Há contas por saldar do evento "${ev.name}":\n\n${mailtoBody}\n\nDetalhes: https://grill1385.github.io/grill-hub/`)}`
    : null;
  const st = getStatus(ev); const s = STATUS_STYLE[st];
  const present = members.filter((m) => ev.presences?.[m.id]);
  const absent = members.filter((m) => ev.presences && ev.presences[m.id] === false);
  const confirmed = members.filter((m) => ev.confirmations?.[m.id]);
  const href = mapsHref(ev);
  return (
    <Modal title={ev.name} onClose={onClose} wide>
      <div className="detail-row">
        <span className="status" style={{ background: s.bg, color: s.fg }}><i style={{ background: s.dot }} />{st}</span>
        <span>{fmtDate(ev.dateStart)}{ev.dateEnd ? ` → ${fmtDate(ev.dateEnd)}` : ""}</span>
        {isAdmin && <button className="btn ghost small" onClick={onEdit}>{Icon.gear({})} Editar</button>}
      </div>
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
          </div>
        </>
      )}

      <h4>Contas</h4>
      {(!purchases || purchases.length === 0) && <p className="hint">Sem contas.</p>}
      {(purchases || []).map((pu) => {
        const parts = pu.participants || [];
        const isSet = (mid) => mid === pu.payerId || !!pu.settled?.[mid];
        const totalSettled = Math.min(pu.total, Math.round(parts.filter(isSet).reduce((acc, mid) => acc + shareOf(pu, mid), 0) * 100) / 100);
        const payer = members.find((m) => m.id === pu.payerId);
        return (
          <div key={pu.id} className="purchase">
            <div className="purchase-head">
              <strong>{pu.description}</strong>
              <span className="purchase-total">{eur(pu.total)}</span>
              {isAdmin && <button className="iconbtn" title="Editar compra" onClick={() => onEditPurchase(pu.id)}>{Icon.gear({})}</button>}
            </div>
            <div className="hint" style={{ marginTop: 0 }}>
              Pagar a <b>{payer?.name || "?"}</b> · {pu.split === "custom" ? "valores individuais" : `${eur(shareOf(pu, parts[0]))} por pessoa`} · saldado {eur(totalSettled)} de {eur(pu.total)}
            </div>
            <div className="pill-row">
              {parts.map((mid) => {
                const m = members.find((x) => x.id === mid);
                if (!m) return null;
                const done = isSet(mid);
                return (
                  <button key={mid} className={`pill ${done ? "on" : ""}`}
                    title={mid === pu.payerId ? "Pagou a compra" : isAdmin ? "Alternar saldado" : ""}
                    onClick={() => isAdmin && mid !== pu.payerId && onToggleSettled(pu, mid)}>
                    {m.name}{mid === pu.payerId ? " · pagou" : done ? " · saldado" : ` · deve ${eur(shareOf(pu, mid))}`}
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
      {isAdmin && (
        <div className="actions" style={{ justifyContent: "flex-start" }}>
          <button className="btn ghost small" onClick={onAddPurchase}>+ Compra</button>
          {mailtoHref && <a className="btn ghost small" href={mailtoHref} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Enviar lembrete por email</a>}
        </div>
      )}
    </Modal>
  );
}

function EventFormModal({ ev, members, onSave, onDelete, onClose }) {
  const editing = !!ev;
  const [f, setF] = useState(() => ({
    id: ev?.id || uid(),
    name: ev?.name || "",
    range: !!ev?.dateEnd,
    dateStart: ev?.dateStart || todayISO(),
    dateEnd: ev?.dateEnd || "",
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

function MemberDetailModal({ mb, role, attended, row, onEvent, onClose }) {
  return (
    <Modal title={mb.name} onClose={onClose} wide>
      <div className="detail-grid">
        <div><span className="klabel">Cargo</span>{role?.label || "Sem cargo"}</div>
        <div><span className="klabel">Username</span>{mb.username ? `@${mb.username}` : "—"}</div>
        <div><span className="klabel">Email</span>{mb.email || "—"}</div>
        <div><span className="klabel">Nascimento</span>{fmtDate(mb.birthDate)}</div>
        <div><span className="klabel">No Grill desde</span>{fmtDate(mb.joinDate)}</div>
        <div><span className="klabel">Presenças</span>{row ? `${row.pct}% (${row.present}/${row.total})` : "—"}</div>
      </div>
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
    roleId: mb?.roleId || "",
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
      <div className="actions">
        {editing && <button className="btn danger" onClick={() => onDelete(f.id)}>Eliminar</button>}
        <button className="btn ember" disabled={!f.name.trim()} onClick={() => onSave({ ...(mb || {}), ...f, name: f.name.trim(), email: f.email.trim() || null, roleId: f.roleId || null })}>Guardar membro</button>
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

function PurchaseFormModal({ ev, purchase, members, onSave, onDelete, onClose }) {
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
    payerId: purchase?.payerId || members[0]?.id || "",
    participants: defaultParts,
    settled: { ...(purchase?.settled || {}) },
    receipts: [...(purchase?.receipts || [])],
    split: purchase?.split || "equal",
    shares: { ...(purchase?.shares || {}) },
  }));
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const toggleP = (id) =>
    set("participants", f.participants.includes(id) ? f.participants.filter((x) => x !== id) : [...f.participants, id]);
  const share = f.participants.length && Number(f.total) > 0
    ? Math.round((Number(f.total) / f.participants.length) * 100) / 100 : 0;
  const sumShares = Math.round(f.participants.reduce((acc, id) => acc + (Number(f.shares[id]) || 0), 0) * 100) / 100;
  const sumOk = Math.abs(sumShares - (Number(f.total) || 0)) < 0.005;

  async function submit() {
    if (!f.description.trim() || !(Number(f.total) > 0) || !f.payerId || !f.participants.length) return;
    if (f.split === "custom" && !sumOk) return;
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
        total: Math.round(Number(f.total) * 100) / 100,
        payerId: f.payerId, participants: f.participants, settled: f.settled, receipts,
        split: f.split,
        shares: f.split === "custom"
          ? Object.fromEntries(f.participants.map((id) => [id, Math.round((Number(f.shares[id]) || 0) * 100) / 100]))
          : {},
      });
    } catch { setBusy(false); }
  }

  return (
    <Modal title={editing ? "Editar compra" : "Nova compra"} onClose={onClose} wide>
      <label>Descrição<input value={f.description} onChange={(e) => set("description", e.target.value)} autoFocus placeholder="ex.: Carne para o churrasco" /></label>
      <div className="row">
        <label>Valor total (€)<input type="number" min="0" step="0.01" value={f.total} onChange={(e) => set("total", e.target.value)} /></label>
        <label>Quem pagou (a quem devem)
          <select value={f.payerId} onChange={(e) => set("payerId", e.target.value)}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      </div>
      <label>Divisão
        <div className="segmented">
          <button type="button" className={f.split === "equal" ? "on" : ""} onClick={() => set("split", "equal")}>Divisão por todos</button>
          <button type="button" className={f.split === "custom" ? "on" : ""} onClick={() => set("split", "custom")}>Só pago o que como</button>
        </div>
      </label>
      <h4>Dividir por {f.participants.length} pessoa(s){f.split === "equal" && share > 0 ? ` · ${eur(share)} cada` : ""}</h4>
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
      <label style={{ marginTop: 14 }}>Fotos da fatura (opcional)
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles([...e.target.files])} />
      </label>
      {f.receipts.length > 0 && <p className="hint">{f.receipts.length} foto(s) já carregada(s).</p>}
      <div className="actions">
        {editing && <button className="btn danger" disabled={busy} onClick={() => onDelete(purchase)}>Eliminar</button>}
        <button className="btn ember" disabled={busy || (f.split === "custom" && !sumOk)} onClick={submit}>{busy ? "A carregar…" : "Guardar compra"}</button>
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

function AdminPanel({ admins, isMain, pendingProfiles, members, onLink, onDismiss, onAddAdmin, onRemoveAdmin }) {
  const [email, setEmail] = useState(""); const [err, setErr] = useState(null);
  return (
    <section>
      <div className="section-head"><h2>Gestão</h2></div>

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
      .content { flex:1; padding:24px 28px; max-width:960px; }

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
      .cards { display:flex; flex-direction:column; gap:10px; }
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
      .board-row { display:grid; grid-template-columns:34px 1fr 2fr 52px 56px; align-items:center; gap:12px;
        background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:12px 14px; cursor:pointer; color:var(--text); font:inherit; text-align:left; }
      .board-row:hover { border-color:var(--ember); }
      .rank { font-family:'Bebas Neue','Arial Narrow',sans-serif; font-size:19px; color:var(--muted); text-align:center; }
      .rank.r1 { color:var(--gold); } .rank.r2 { color:#C8C2B8; } .rank.r3 { color:#C68B59; }
      .board-name { font-weight:600; }
      .board-bar { height:9px; background:var(--surface2); border-radius:6px; overflow:hidden; }
      .board-bar i { display:block; height:100%; background:linear-gradient(90deg,#E85D1F,var(--ember),var(--gold)); border-radius:6px; box-shadow:0 0 8px rgba(255,122,61,.5); }
      .board-pct { font-weight:700; color:var(--ember); text-align:right; }
      .board-count { color:var(--muted); font-size:12px; text-align:right; }

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
      .home2 { width:100%; }
      .tl-labels, .tl-row { display:grid; grid-template-columns:1.15fr 3fr 1.15fr; gap:14px; }
      .tl-labels h4 { margin:0 0 10px; }
      .tl-center { display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; }
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
      .debt-line { font-size:12.5px; color:var(--muted); }
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
        .board-row { grid-template-columns:28px 1fr 60px; }
        .board-bar, .board-count { display:none; }
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
