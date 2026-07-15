import React, { useEffect, useMemo, useRef, useState } from "react";

/* ============================================================
   FÉRIAS DO GRILL
   Planeamento das férias anuais: locais, alojamento,
   transportes, tarefas automáticas + manuais e custos.
   Tabelas: ver supabase/setup-ferias.sql
   ============================================================ */
import { feriasApi } from "./api.js";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ---------- Utilitários (locais a esta aba) ---------- */
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const todayISO = () => new Date().toISOString().slice(0, 10);
const eur = (n) => `${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")} €`;

function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function addMonthsISO(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, d));
  return dt.toISOString().slice(0, 10);
}

function haversineKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fmtDur(hours) {
  if (hours == null || !isFinite(hours)) return "—";
  const h = Math.floor(hours), m = Math.round((hours - h) * 60);
  return h ? `${h}h${m ? ` ${String(m).padStart(2, "0")}min` : ""}` : `${m}min`;
}

function nightsBetween(a, b) {
  if (!a || !b) return null;
  const n = Math.round((new Date(b) - new Date(a)) / 86400000);
  return n >= 0 ? n : null;
}

/* ---------- Estados ---------- */
export const VSTATUS = ["Por pesquisar", "Em pesquisa", "Em discussão", "Escolhido", "Marcado", "Pago"];
const VSTATUS_STYLE = {
  "Por pesquisar": { bg: "#3A2C26", fg: "#F09A6A", dot: "#FF7A3D" },
  "Em pesquisa": { bg: "#3B3220", fg: "#F5C168", dot: "#F5B841" },
  "Em discussão": { bg: "#38303B", fg: "#D9A6E8", dot: "#C77DFF" },
  "Escolhido": { bg: "#20303B", fg: "#8EC9F5", dot: "#41A5F5" },
  "Marcado": { bg: "#233B38", fg: "#8FD9C9", dot: "#2EC4B6" },
  "Pago": { bg: "#2E3B2E", fg: "#9BC98F", dot: "#7FB069" },
};
const TRANSPORT_KINDS = ["Avião", "Comboio", "Autocarro", "Carro", "Barco", "Outro"];

/* Regras de progressão de estado (dependem dos links) */
function statusBlocker(target, links) {
  const idx = VSTATUS.indexOf(target);
  const n = (links || []).length;
  if (idx >= 1 && n < 1) return "Para \"Em pesquisa\" (ou mais) é preciso pelo menos 1 link.";
  if (idx >= 3 && n !== 1) return "Para \"Escolhido\" (ou mais) só pode restar 1 link — a discussão termina quando removem os outros.";
  return null;
}

const placeName = (p) => (p ? p.city + (p.country ? ` (${p.country})` : "") : "?");
const endName = (placeId, places) => (placeId ? placeName(places.find((p) => p.id === placeId)) : "Casinha");
const transportLabel = (t, places) => `${endName(t.fromPlaceId, places)} → ${endName(t.toPlaceId, places)}`;

/* ---------- Tarefas automáticas ---------- */
function computeAutoTasks(vac, places, stays, transports) {
  const out = [];
  const today = todayISO();
  if (!vac.dateStart || (vac.dateEnd || vac.dateStart) < today) return out; // férias passadas: sem tarefas
  const showT = addMonthsISO(vac.dateStart, -6) <= today; // transportes: aparecem 6 meses antes
  const showL = addMonthsISO(vac.dateStart, -4) <= today; // locais/alojamento: 4 meses antes
  const dueT = addMonthsISO(vac.dateStart, -3);           // prazo: 3 meses antes
  const dueL = addMonthsISO(vac.dateStart, -2);           // prazo: 2 meses antes
  for (const p of places) {
    if (showL && !stays.some((s) => s.placeId === p.id))
      out.push({ autoKey: `stay-missing:${p.id}`, title: `Procurar alojamento em ${placeName(p)}`, dueDate: dueL });
    if (showT && !transports.some((t) => !t.isGeneral && (t.toPlaceId === p.id || t.fromPlaceId === p.id)))
      out.push({ autoKey: `transport-missing:${p.id}`, title: `Procurar transporte para ${placeName(p)}`, dueDate: dueT });
  }
  for (const s of stays)
    if (showL && s.status !== "Pago") {
      const p = places.find((x) => x.id === s.placeId);
      out.push({ autoKey: `stay-status:${s.id}`, title: `Alojamento "${s.name || placeName(p)}" está "${s.status}" — levar até "Pago"`, dueDate: dueL });
    }
  for (const t of transports)
    if (showT && t.status !== "Pago" && !t.generalId)
      out.push({
        autoKey: `transport-status:${t.id}`,
        title: t.isGeneral
          ? `Transporte geral "${t.name || t.kind}" está "${t.status}" — levar até "Pago"`
          : `Transporte ${transportLabel(t, places)} está "${t.status}" — levar até "Pago"`,
        dueDate: dueT,
      });
  return out;
}

/* ---------- Componentes básicos ---------- */
function VModal({ title, onClose, children, wide }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="iconbtn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function StatusChip({ status }) {
  const s = VSTATUS_STYLE[status] || VSTATUS_STYLE["Por pesquisar"];
  return (
    <span className="status" style={{ background: s.bg, color: s.fg }}>
      <i style={{ background: s.dot }} />{status}
    </span>
  );
}

function StatusSelect({ item, canEdit, onChange, showToast }) {
  if (!canEdit) return <StatusChip status={item.status} />;
  return (
    <select
      value={item.status}
      style={{ maxWidth: 160 }}
      onChange={(e) => {
        const target = e.target.value;
        const err = statusBlocker(target, item.links);
        if (err) { showToast(err); e.target.value = item.status; return; }
        onChange(target);
      }}>
      {VSTATUS.map((s) => <option key={s}>{s}</option>)}
    </select>
  );
}

function LinksList({ links }) {
  if (!links?.length) return <p className="hint" style={{ margin: "4px 0" }}>Sem links.</p>;
  return (
    <div className="vlinks">
      {links.map((l, i) => (
        <a key={i} href={l} target="_blank" rel="noreferrer" title={l}>
          🔗 {l.replace(/^https?:\/\/(www\.)?/, "").slice(0, 42)}{l.replace(/^https?:\/\/(www\.)?/, "").length > 42 ? "…" : ""}
        </a>
      ))}
    </div>
  );
}

function LinksEditor({ links, onChange }) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim();
    if (!v) return;
    onChange([...(links || []), v.startsWith("http") ? v : `https://${v}`]);
    setDraft("");
  }
  return (
    <div>
      <span className="klabel">Links (booking, airbnb, voos, flixbus…)</span>
      {(links || []).map((l, i) => (
        <div key={i} className="vlink-row">
          <a href={l} target="_blank" rel="noreferrer">{l.slice(0, 52)}{l.length > 52 ? "…" : ""}</a>
          <button type="button" className="iconbtn" title="Remover link" onClick={() => onChange(links.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="row" style={{ alignItems: "center" }}>
        <input placeholder="https://…" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn ghost small" onClick={add}>+ Link</button>
      </div>
    </div>
  );
}

function AssigneePills({ assignees, members, canEdit, onToggle }) {
  return (
    <div className="pill-row" style={{ margin: "4px 0 0" }}>
      {members.map((m) => {
        const on = assignees.includes(m.id);
        if (!canEdit && !on) return null;
        return (
          <button key={m.id} type="button" className={`pill ${on ? "on" : ""}`} disabled={!canEdit}
            onClick={() => canEdit && onToggle(m.id)}>
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   ABA PRINCIPAL
   ============================================================ */
export default function FeriasTab({ members, events, myMember, isAdmin, session, showToast }) {
  const canEdit = !!session && (isAdmin || !!myMember);
  const [fd, setFd] = useState(null);   // {vacations, places, stays, transports, tasks}
  const [loadErr, setLoadErr] = useState(false);
  const [sel, setSel] = useState(null); // id das férias abertas
  const [sub, setSub] = useState("resumo");
  const [modal, setModal] = useState(null);

  useEffect(() => {
    feriasApi.loadAll().then(setFd).catch((e) => { console.error(e); setLoadErr(true); });
  }, []);

  /* ---------- gravações genéricas ---------- */
  async function save(kind, obj, apiFn, label) {
    try {
      await apiFn(obj);
      setFd((d) => {
        const list = d[kind].some((x) => x.id === obj.id)
          ? d[kind].map((x) => (x.id === obj.id ? obj : x))
          : [...d[kind], obj];
        return { ...d, [kind]: list };
      });
      setModal(null);
      if (label) showToast(`${label} guardado.`);
    } catch (e) {
      console.error(e);
      const msg = e?.message || "";
      if (/column|schema/i.test(msg)) showToast("Não foi possível guardar — parece faltar correr uma migração SQL no Supabase (ver supabase/*.sql).");
      else if (/row-level security|permission|policy/i.test(msg)) showToast("Não foi possível guardar. Tens conta de membro ligada?");
      else showToast(`Não foi possível guardar.${msg ? ` (${msg})` : ""}`);
    }
  }

  async function remove(kind, id, apiFn, label, cascade) {
    try {
      await apiFn(id);
      setFd((d) => {
        const next = { ...d, [kind]: d[kind].filter((x) => x.id !== id) };
        if (cascade) cascade(next, id);
        return next;
      });
      setModal(null);
      showToast(`${label} eliminado.`);
    } catch (e) { console.error(e); showToast("Não foi possível eliminar."); }
  }

  async function setItemStatus(kind, item, status, apiFn) {
    const next = { ...item, status };
    try {
      await apiFn(next);
      setFd((d) => ({ ...d, [kind]: d[kind].map((x) => (x.id === item.id ? next : x)) }));
    } catch (e) { console.error(e); showToast("Não foi possível atualizar o estado."); }
  }

  async function toggleAssignee(vac, task, memberId) {
    // task pode ser automática (sem linha na BD ainda) ou manual
    const stored = task.stored || null;
    const base = stored || { id: uid(), vacationId: vac.id, autoKey: task.autoKey || null, title: task.autoKey ? null : task.title, assignees: [], dueDate: task.autoKey ? null : task.dueDate, done: false };
    const assignees = base.assignees.includes(memberId)
      ? base.assignees.filter((x) => x !== memberId)
      : [...base.assignees, memberId];
    const next = { ...base, assignees };
    try {
      await feriasApi.saveTask(next);
      setFd((d) => ({
        ...d,
        tasks: d.tasks.some((t) => t.id === next.id) ? d.tasks.map((t) => (t.id === next.id ? next : t)) : [...d.tasks, next],
      }));
    } catch (e) { console.error(e); showToast("Não foi possível atribuir."); }
  }

  async function toggleTaskDone(task) {
    const next = { ...task, done: !task.done };
    try {
      await feriasApi.saveTask(next);
      setFd((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === task.id ? next : t)) }));
    } catch (e) { console.error(e); showToast("Não foi possível atualizar."); }
  }

  /* ---------- confirmações de participação ---------- */
  function patchVacation(id, patch) {
    setFd((d) => ({ ...d, vacations: d.vacations.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  }

  async function toggleMyConfirmation(vac) {
    if (!myMember) return;
    const next = !vac.confirmations?.[myMember.id];
    try {
      await feriasApi.setMyVacationConfirmation(vac.id, next);
      patchVacation(vac.id, { confirmations: { ...(vac.confirmations || {}), [myMember.id]: next } });
      showToast(next ? "Participação confirmada!" : "Confirmação removida.");
    } catch (e) { console.error(e); showToast("Não foi possível confirmar. Já correram o setup-ferias-confirmacoes.sql?"); }
  }

  async function setMemberConfirmation(vac, memberId, value) {
    const confirmations = { ...(vac.confirmations || {}), [memberId]: value };
    try {
      await feriasApi.saveVacationConfirmations(vac.id, confirmations);
      patchVacation(vac.id, { confirmations });
    } catch (e) { console.error(e); showToast("Não foi possível alterar a confirmação."); }
  }

  /* ---------- estados de carregamento ---------- */
  if (loadErr) {
    return (
      <section>
        <div className="section-head"><h2>Férias do Grill</h2></div>
        <p className="empty">Não foi possível carregar as férias. Se é a primeira vez, é preciso correr o script <code>supabase/setup-ferias.sql</code> no SQL Editor do Supabase.</p>
      </section>
    );
  }
  if (!fd) {
    return (
      <section>
        <div className="section-head"><h2>Férias do Grill</h2></div>
        <p className="hint">A carregar…</p>
      </section>
    );
  }

  const vac = fd.vacations.find((v) => v.id === sel) || null;

  return (
    <section>
      <FeriasStyle />
      {!vac ? (
        <VacationList vacations={fd.vacations} fd={fd} canEdit={canEdit}
          onOpen={(id) => { setSel(id); setSub("resumo"); }}
          onNew={() => setModal({ type: "vacForm" })} />
      ) : (
        <VacationDetail vac={vac} fd={fd} members={members} events={events} canEdit={canEdit}
          myMember={myMember} isAdmin={isAdmin}
          onToggleMyConfirmation={() => toggleMyConfirmation(vac)}
          onSetMemberConfirmation={(mid, value) => setMemberConfirmation(vac, mid, value)}
          sub={sub} setSub={setSub} showToast={showToast}
          onBack={() => setSel(null)}
          onEdit={() => setModal({ type: "vacForm", id: vac.id })}
          onAddPlace={() => setModal({ type: "placeForm" })}
          onEditPlace={(id) => setModal({ type: "placeForm", id })}
          onAddStay={(placeId) => setModal({ type: "stayForm", placeId })}
          onEditStay={(id) => setModal({ type: "stayForm", id })}
          onAddTransport={(general) => setModal({ type: "transportForm", general })}
          onEditTransport={(id) => setModal({ type: "transportForm", id })}
          onAddTask={() => setModal({ type: "taskForm" })}
          onEditTask={(id) => setModal({ type: "taskForm", id })}
          onStayStatus={(s, st) => setItemStatus("stays", s, st, feriasApi.saveStay)}
          onTransportStatus={(t, st) => setItemStatus("transports", t, st, feriasApi.saveTransport)}
          onToggleAssignee={(task, mid) => toggleAssignee(vac, task, mid)}
          onToggleTaskDone={toggleTaskDone} />
      )}

      {/* ---------- Modais ---------- */}
      {modal?.type === "vacForm" && (
        <VacationFormModal vac={fd.vacations.find((v) => v.id === modal.id)} events={events}
          onSave={(v) => save("vacations", v, feriasApi.saveVacation, "Férias")}
          onDelete={(id) => { remove("vacations", id, feriasApi.deleteVacation, "Férias"); setSel(null); }}
          onClose={() => setModal(null)} />
      )}
      {modal?.type === "placeForm" && vac && (
        <PlaceFormModal place={fd.places.find((p) => p.id === modal.id)} vac={vac}
          nextSort={Math.max(0, ...fd.places.filter((p) => p.vacationId === vac.id).map((p) => p.sort + 1))}
          onSave={(p) => save("places", p, feriasApi.savePlace, "Local")}
          onDelete={(id) => remove("places", id, feriasApi.deletePlace, "Local", (d) => {
            d.stays = d.stays.filter((s) => s.placeId !== id);
            d.transports = d.transports.map((t) => ({
              ...t,
              fromPlaceId: t.fromPlaceId === id ? null : t.fromPlaceId,
              toPlaceId: t.toPlaceId === id ? null : t.toPlaceId,
            }));
          })}
          onClose={() => setModal(null)} />
      )}
      {modal?.type === "stayForm" && vac && (
        <StayFormModal stay={fd.stays.find((s) => s.id === modal.id)} vac={vac} defaultPlaceId={modal.placeId}
          places={fd.places.filter((p) => p.vacationId === vac.id)} showToast={showToast}
          onSave={(s) => save("stays", s, feriasApi.saveStay, "Alojamento")}
          onDelete={(id) => remove("stays", id, feriasApi.deleteStay, "Alojamento")}
          onClose={() => setModal(null)} />
      )}
      {modal?.type === "transportForm" && vac && (
        <TransportFormModal transport={fd.transports.find((t) => t.id === modal.id)} vac={vac}
          general={modal.general} transports={fd.transports.filter((t) => t.vacationId === vac.id)}
          places={fd.places.filter((p) => p.vacationId === vac.id)} showToast={showToast}
          onSave={(t) => save("transports", t, feriasApi.saveTransport, "Transporte")}
          onDelete={(id) => remove("transports", id, feriasApi.deleteTransport, "Transporte")}
          onClose={() => setModal(null)} />
      )}
      {modal?.type === "taskForm" && vac && (
        <TaskFormModal task={fd.tasks.find((t) => t.id === modal.id)} vac={vac}
          members={members.filter((m) => vac.confirmations?.[m.id] || (fd.tasks.find((t) => t.id === modal.id)?.assignees || []).includes(m.id))}
          onSave={(t) => save("tasks", t, feriasApi.saveTask, "Tarefa")}
          onDelete={(id) => remove("tasks", id, feriasApi.deleteTask, "Tarefa")}
          onClose={() => setModal(null)} />
      )}
    </section>
  );
}

/* ============================================================
   LISTA DE FÉRIAS
   ============================================================ */
function VacationList({ vacations, fd, canEdit, onOpen, onNew }) {
  const sorted = [...vacations].sort((a, b) => (b.dateStart || "").localeCompare(a.dateStart || ""));
  return (
    <>
      <div className="section-head">
        <h2>Férias do Grill</h2>
        {canEdit && <button className="btn ember" onClick={onNew}>+ Férias</button>}
      </div>
      {sorted.length === 0 && (
        <p className="empty">Ainda não há férias registadas.{canEdit ? " Cria as primeiras com o botão + Férias." : ""}</p>
      )}
      <div className="cards">
        {sorted.map((v) => {
          const nights = nightsBetween(v.dateStart, v.dateEnd);
          const places = fd.places.filter((p) => p.vacationId === v.id);
          const items = [...fd.stays, ...fd.transports].filter((x) => x.vacationId === v.id);
          const paid = items.filter((x) => x.status === "Pago").length;
          return (
            <div key={v.id} className="card event-card" onClick={() => onOpen(v.id)}>
              <div className="event-top"><strong>{v.name}</strong></div>
              <div className="event-date">{fmtDate(v.dateStart)} → {fmtDate(v.dateEnd)}</div>
              <div className="event-meta">
                {nights != null && <span className="vac-chip">{nights + 1} dias · {nights} noites</span>}
                <span className="vac-chip">{places.length} {places.length === 1 ? "local" : "locais"}</span>
                {items.length > 0 && <span className="vac-chip">{paid}/{items.length} pago{paid !== 1 ? "s" : ""}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ============================================================
   DETALHE DAS FÉRIAS
   ============================================================ */
function VacationDetail(props) {
  const { vac, fd, members, events, canEdit, sub, setSub, onBack, onEdit } = props;
  const nights = nightsBetween(vac.dateStart, vac.dateEnd);
  const places = fd.places.filter((p) => p.vacationId === vac.id)
    .sort((a, b) => (a.arriveDate || "9999").localeCompare(b.arriveDate || "9999") || a.sort - b.sort);
  const stays = fd.stays.filter((s) => s.vacationId === vac.id);
  const transports = fd.transports.filter((t) => t.vacationId === vac.id)
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  const linkedEvent = vac.eventId ? events.find((e) => e.id === vac.eventId) : null;

  const tabs = [
    ["resumo", "Resumo"],
    ["locais", `Locais (${places.length})`],
    ["alojamento", `Alojamento (${stays.length})`],
    ["transportes", `Transportes (${transports.length})`],
  ];

  return (
    <>
      <div className="section-head">
        <h2>
          <a href="#" className="vac-back" onClick={(e) => { e.preventDefault(); onBack(); }}>← Férias</a>
          {" "}{vac.name}
        </h2>
        {canEdit && <button className="btn ghost" onClick={onEdit}>Editar férias</button>}
      </div>
      <div className="filter-bar" style={{ alignItems: "center" }}>
        <span className="vac-chip big">{fmtDate(vac.dateStart)} → {fmtDate(vac.dateEnd)}</span>
        {nights != null && <span className="vac-chip big">{nights + 1} dias · {nights} noites</span>}
        {linkedEvent && <span className="vac-chip big">Evento: {linkedEvent.name}</span>}
        {Object.values(vac.confirmations || {}).filter(Boolean).length > 0 && (
          <span className="vac-chip big">{Object.values(vac.confirmations || {}).filter(Boolean).length} confirmados</span>
        )}
      </div>
      {vac.notes && <p className="hint" style={{ marginTop: 0 }}>{vac.notes}</p>}

      <div className="segmented" style={{ marginBottom: 16 }}>
        {tabs.map(([id, label]) => (
          <button key={id} className={sub === id ? "on" : ""} onClick={() => setSub(id)}>{label}</button>
        ))}
      </div>

      {sub === "resumo" && <SummaryView {...props} places={places} stays={stays} transports={transports} linkedEvent={linkedEvent} />}
      {sub === "locais" && <PlacesView {...props} places={places} stays={stays} transports={transports} />}
      {sub === "alojamento" && <StaysView {...props} places={places} stays={stays} />}
      {sub === "transportes" && <TransportsView {...props} places={places} transports={transports} />}
    </>
  );
}

/* ---------- Participação: membro confirma a sua, admin edita todas ---------- */
function ParticipationSection({ vac, members, myMember, isAdmin, isPast, onToggleMine, onSetMember }) {
  const [open, setOpen] = useState(false);
  const conf = vac.confirmations || {};
  const n = Object.values(conf).filter(Boolean).length;
  const mine = myMember ? !!conf[myMember.id] : false;
  return (
    <div style={{ marginBottom: 24 }}>
      <div className="section-head" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>
          Participação{n > 0 ? ` (${n})` : ""}
          <a href="#" className="vtask-jump" onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}>
            {open ? "esconder" : "mostrar"}
          </a>
        </h3>
        {myMember && !isPast && (
          <button className={`btn small ${mine ? "ghost" : "ember"}`} onClick={onToggleMine}>
            {mine ? "Cancelar confirmação" : "Confirmar participação"}
          </button>
        )}
      </div>
      {!open ? null : <>
      <div className="pill-row">
        {members.map((m) => {
          const on = !!conf[m.id];
          const isMine = myMember?.id === m.id;
          const clickable = isAdmin || (isMine && !isPast);
          return (
            <button key={m.id} type="button" className={`pill ${on ? "on" : ""}`} disabled={!clickable}
              title={isAdmin ? "Alterar confirmação (admin)" : isMine ? "A tua confirmação" : ""}
              onClick={() => {
                if (!clickable) return;
                if (isMine && !isAdmin) onToggleMine();
                else onSetMember(m.id, !on);
              }}>
              {m.name}{on ? " ✓" : ""}
            </button>
          );
        })}
      </div>
      <p className="hint">
        {isPast
          ? "Férias já realizadas — só admins podem ajustar quem foi (para histórico)."
          : "Confirma a tua participação — os custos por pessoa dividem-se pelos confirmados e as tarefas só se atribuem a participantes. Admins podem alterar qualquer confirmação."}
      </p>
      </>}
    </div>
  );
}

/* ---------- Resumo: participação + tarefas + custos ---------- */
function SummaryView({ vac, fd, members, canEdit, myMember, isAdmin, onToggleMyConfirmation, onSetMemberConfirmation, places, stays, transports, linkedEvent, showToast, onAddTask, onEditTask, onToggleAssignee, onToggleTaskDone, setSub }) {
  const stored = fd.tasks.filter((t) => t.vacationId === vac.id);
  const auto = computeAutoTasks(vac, places, stays, transports).map((a) => {
    const row = stored.find((t) => t.autoKey === a.autoKey) || null;
    return { ...a, assignees: row?.assignees || [], stored: row };
  });
  const manual = stored.filter((t) => !t.autoKey).map((t) => ({ ...t, stored: t }));
  const open = [...auto, ...manual.filter((t) => !t.done)].sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const done = manual.filter((t) => t.done);
  const today = todayISO();

  /* custos: divide pelos confirmados das férias; senão pelos do evento ligado; senão por todos */
  const nVacConfirm = Object.values(vac.confirmations || {}).filter(Boolean).length;
  const nEvConfirm = linkedEvent ? Object.values(linkedEvent.confirmations || {}).filter(Boolean).length : 0;
  const nPeople = nVacConfirm || nEvConfirm || members.length;
  const stayTotal = stays.reduce((acc, s) => acc + (Number(s.priceTotal) || 0), 0);
  const transpPP = transports.filter((t) => !t.generalId).reduce((acc, t) => acc + (Number(t.pricePerson) || 0), 0);
  const totalPP = stayTotal / (nPeople || 1) + transpPP;

  const isPast = (vac.dateEnd || vac.dateStart) < today;
  const participants = members.filter((m) => vac.confirmations?.[m.id]);

  return (
    <div>
      <ParticipationSection vac={vac} members={members} myMember={myMember} isAdmin={isAdmin} isPast={isPast}
        onToggleMine={onToggleMyConfirmation} onSetMember={onSetMemberConfirmation} />

      <div className="section-head" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Lista de tarefas</h3>
        {canEdit && <button className="btn ghost small" onClick={onAddTask}>+ Tarefa manual</button>}
      </div>
      {isPast && <p className="hint">Férias já realizadas — sem tarefas automáticas.</p>}
      {!isPast && participants.length === 0 && <p className="hint">Sem participantes confirmados — as tarefas só se atribuem a quem participa (secção Participação).</p>}
      {!isPast && open.length === 0 && <p className="empty">Nada pendente por agora. As tarefas automáticas aparecem 6 meses antes (transportes) e 4 meses antes (alojamento) do início.</p>}
      <div className="vtask-list">
        {open.map((t) => (
          <div key={t.autoKey || t.id} className="vtask">
            <div className="vtask-main">
              {!t.autoKey && canEdit && (
                <input type="checkbox" checked={false} title="Marcar como feita" onChange={() => onToggleTaskDone(t.stored)} />
              )}
              <span className="vtask-title">
                {t.title}
                {t.autoKey?.startsWith("stay") && <a href="#" className="vtask-jump" onClick={(e) => { e.preventDefault(); setSub("alojamento"); }}>ver</a>}
                {t.autoKey?.startsWith("transport") && <a href="#" className="vtask-jump" onClick={(e) => { e.preventDefault(); setSub("transportes"); }}>ver</a>}
                {!t.autoKey && canEdit && <a href="#" className="vtask-jump" onClick={(e) => { e.preventDefault(); onEditTask(t.id); }}>editar</a>}
              </span>
              {t.dueDate && (
                <span className={`vtask-due ${t.dueDate < today ? "late" : ""}`}>
                  limite: {fmtDate(t.dueDate)}{t.dueDate < today ? " ⚠" : ""}
                </span>
              )}
            </div>
            <AssigneePills assignees={t.assignees || []}
              members={members.filter((m) => vac.confirmations?.[m.id] || (t.assignees || []).includes(m.id))}
              canEdit={canEdit}
              onToggle={(mid) => onToggleAssignee(t, mid)} />
          </div>
        ))}
      </div>
      {done.length > 0 && (
        <>
          <h4>Feitas</h4>
          <div className="vtask-list">
            {done.map((t) => (
              <div key={t.id} className="vtask done">
                <div className="vtask-main">
                  {canEdit && <input type="checkbox" checked onChange={() => onToggleTaskDone(t.stored)} />}
                  <span className="vtask-title"><s>{t.title}</s></span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 style={{ marginTop: 24 }}>Custos</h3>
      <div className="detail-grid">
        <div><span className="klabel">Alojamento (total)</span>{stayTotal ? eur(stayTotal) : "—"}</div>
        <div><span className="klabel">Alojamento (por pessoa)</span>{stayTotal ? eur(stayTotal / (nPeople || 1)) : "—"}</div>
        <div><span className="klabel">Transportes (por pessoa)</span>{transpPP ? eur(transpPP) : "—"}</div>
        <div><span className="klabel">Total por pessoa</span>{stayTotal || transpPP ? eur(totalPP) : "—"}</div>
      </div>
      <p className="hint">
        Por pessoa a dividir por {nPeople} {nVacConfirm ? "confirmado(s) nestas férias" : nEvConfirm ? "confirmado(s) no evento ligado" : "membro(s) do Grill (confirmem a participação lá em cima para afinar)"}.
        Só entram alojamentos com preço total e transportes com preço por pessoa.
      </p>
    </div>
  );
}

/* ---------- Mapa do roteiro ---------- */
/* Coordenadas a partir de um link do Google Maps (quando o URL as contém). */
function extractLatLngFromLink(url) {
  if (!url) return null;
  let m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = url.match(/[?&](?:q|query|ll|center|destination)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/i);
  if (m) return [Number(m[1]), Number(m[2])];
  m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  return null;
}

/* Geocoding da cidade via Nominatim (OpenStreetMap), com cache em localStorage. */
async function geocodeCity(city, country) {
  const key = `grill-geo:${`${city},${country || ""}`.toLowerCase()}`;
  try { const c = localStorage.getItem(key); if (c) return JSON.parse(c); } catch { /* sem cache */ }
  try {
    const q = encodeURIComponent(country ? `${city}, ${country}` : city);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`);
    const data = await res.json();
    if (!data?.[0]) return null;
    const pt = [Number(data[0].lat), Number(data[0].lon)];
    try { localStorage.setItem(key, JSON.stringify(pt)); } catch { /* quota */ }
    return pt;
  } catch { return null; }
}

function RouteMap({ places, stays, transports }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const [pts, setPts] = useState(null); // [{ place, ll, fromStay }]
  const sig = places.map((p) => `${p.id}|${p.city}|${p.country || ""}`).join(";")
    + "#" + stays.map((st) => st.id + (st.links || []).join(",")).join(";");
  const tSig = (transports || []).map((t) => t.id + t.status + (t.date || "") + (t.time || "") + (t.kind || "") + (t.generalId || "")).join(";");

  useEffect(() => {
    let alive = true;
    (async () => {
      const out = [];
      for (const p of places) {
        let ll = null, fromStay = false;
        for (const st of stays.filter((x) => x.placeId === p.id)) {
          for (const l of st.links || []) {
            const c = extractLatLngFromLink(l);
            if (c) { ll = c; fromStay = true; break; }
          }
          if (ll) break;
        }
        if (!ll) ll = await geocodeCity(p.city, p.country);
        if (ll) out.push({ place: p, ll, fromStay });
      }
      if (alive) setPts(out);
    })();
    return () => { alive = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pts || !pts.length || !boxRef.current) return;
    const map = L.map(boxRef.current, { scrollWheelZoom: false });
    mapRef.current = map;
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd", maxZoom: 19,
    }).addTo(map);
    map.fitBounds(L.latLngBounds(pts.map((x) => x.ll)), { padding: [40, 40], maxZoom: 11 });

    const popupHtml = (x, i) => {
      const p = x.place;
      const n = nightsBetween(p.arriveDate, p.departDate);
      const pStays = stays.filter((st) => st.placeId === p.id);
      return (
        `<strong>${i + 1}. ${placeName(p)}</strong><br/>` +
        `${fmtDate(p.arriveDate)} → ${fmtDate(p.departDate)}${n != null ? ` · ${n} noite${n === 1 ? "" : "s"}` : ""}` +
        (pStays.length
          ? pStays.map((st) => `<br/>🏠 ${st.name || "Alojamento"} — ${st.status}`).join("")
          : "<br/><em>sem alojamento</em>") +
        (x.fromStay ? "<br/><small>📍 morada do alojamento</small>" : "")
      );
    };
    /* pontos praticamente sobrepostos (ex.: viagem começa e acaba no mesmo sítio) partilham um pin "1·6" */
    const groups = [];
    const byKey = {};
    pts.forEach((x, i) => {
      const key = `${x.ll[0].toFixed(4)},${x.ll[1].toFixed(4)}`;
      if (byKey[key]) byKey[key].items.push({ x, i });
      else { byKey[key] = { ll: x.ll, items: [{ x, i }] }; groups.push(byKey[key]); }
    });
    groups.forEach((g) => {
      const label = g.items.map(({ i }) => i + 1).join("·");
      const html = g.items.map(({ x, i }) => popupHtml(x, i)).join('<hr style="margin:6px 0;opacity:.4"/>');
      const w = Math.max(26, 12 + label.length * 8);
      const icon = L.divIcon({ className: "", html: `<div class="vmap-pin" style="min-width:${w}px">${label}</div>`, iconSize: [w, 26], iconAnchor: [w / 2, 13] });
      L.marker(g.ll, { icon }).addTo(map).bindPopup(html);
    });

    /* trajeto por trechos clicáveis (OSRM público, condução); fallback: linhas retas */
    (async () => {
      if (pts.length < 2) return;
      const segs = [];
      for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
      const results = await Promise.all(segs.map(async ([a, b]) => {
        try {
          const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.ll[1]},${a.ll[0]};${b.ll[1]},${b.ll[0]}?overview=full&geometries=geojson`);
          const j = await res.json();
          const r = j.routes?.[0];
          if (r?.geometry?.coordinates)
            return { latlngs: r.geometry.coordinates.map(([lo, la]) => [la, lo]), km: r.distance / 1000, driveH: r.duration / 3600 };
        } catch { /* fallback abaixo */ }
        return { latlngs: [a.ll, b.ll], km: haversineKm(a.ll, b.ll), driveH: null };
      }));
      if (mapRef.current !== map) return;

      const base = { color: "#FF7A3D", weight: 4, opacity: 0.85 };
      const hi = { color: "#FFD166", weight: 6, opacity: 1 };
      const visLines = [];
      results.forEach((seg, i) => {
        const [a, b] = segs[i];
        const A = a.place, B = b.place;
        const leg = (transports || []).find((t) => !t.isGeneral
          && ((t.fromPlaceId === A.id && t.toPlaceId === B.id) || (t.fromPlaceId === B.id && t.toPlaceId === A.id)));
        const gen = leg?.generalId ? (transports || []).find((t) => t.id === leg.generalId) : null;
        const kind = gen?.kind || leg?.kind || null;
        const kmStraight = haversineKm(a.ll, b.ll);

        let estH = seg.driveH, modo = "de carro";
        if (kind === "Avião") { estH = kmStraight / 750 + 0.75; modo = "de avião"; }
        else if (kind === "Comboio") { estH = seg.km / 90; modo = "de comboio"; }
        else if (kind === "Autocarro") { estH = seg.driveH != null ? seg.driveH * 1.25 : seg.km / 70; modo = "de autocarro"; }
        else if (kind === "Barco") { estH = kmStraight / 35; modo = "de barco"; }
        else if (estH == null) estH = seg.km / 80;

        const html =
          `<strong>${placeName(A)} → ${placeName(B)}</strong><br/>` +
          (leg
            ? `🚏 ${gen ? (gen.name || gen.kind) : (leg.kind || "Transporte")} — ${(gen || leg).status}${leg.time ? ` · ${leg.time}` : ""}<br/>`
            : "<em>sem transporte definido</em><br/>") +
          `Partida: ${fmtDate(leg?.date || A.departDate)} · Chegada: ${fmtDate(B.arriveDate || leg?.date)}<br/>` +
          `Distância: ${Math.round(seg.km)} km${kind === "Avião" ? ` por estrada (~${Math.round(kmStraight)} km em voo)` : ""}<br/>` +
          `Tempo estimado ${modo}: ~${fmtDur(estH)}`;

        /* linha visível não interceta cliques; uma linha invisível mais larga trata da interação */
        const vis = L.polyline(seg.latlngs, { ...base, interactive: false }).addTo(map);
        const hit = L.polyline(seg.latlngs, { color: "#000", opacity: 0.001, weight: 20 }).addTo(map);
        hit.bindPopup(html);
        hit.on("click", (e) => {
          visLines.forEach((l) => l.setStyle(base));
          vis.setStyle(hi);
          hit.openPopup(e.latlng);
        });
        hit.on("popupclose", () => vis.setStyle(base));
        visLines.push(vis);
      });
    })();

    return () => { map.remove(); if (mapRef.current === map) mapRef.current = null; };
  }, [pts, tSig]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!places.length) return null;
  if (pts && !pts.length) return <p className="hint">Não consegui localizar os locais no mapa (geocoding indisponível?).</p>;
  return (
    <>
      <div className="vmap" ref={boxRef} />
      {!pts && <p className="hint" style={{ marginTop: -8 }}>A localizar cidades no mapa…</p>}
    </>
  );
}

/* ---------- Locais ---------- */
function PlacesView({ canEdit, places, stays, transports, onAddPlace, onEditPlace }) {
  const gmap = {};
  transports.forEach((t) => { if (t.isGeneral) gmap[t.id] = t; });
  return (
    <div>
      <div className="section-head" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Roteiro</h3>
        {canEdit && <button className="btn ember" onClick={onAddPlace}>+ Local</button>}
      </div>
      {places.length === 0 && <p className="empty">Sem locais ainda. Adiciona a primeira cidade do roteiro.</p>}
      <RouteMap places={places} stays={stays} transports={transports} />
      <div className="cards">
        {places.map((p, i) => {
          const n = nightsBetween(p.arriveDate, p.departDate);
          const pStays = stays.filter((s) => s.placeId === p.id);
          const arr = transports.find((t) => t.toPlaceId === p.id);
          const dep = transports.find((t) => t.fromPlaceId === p.id);
          return (
            <div key={p.id} className="card">
              <div className="event-top">
                <strong>{i + 1}. {placeName(p)}</strong>
                {canEdit && <button className="iconbtn" title="Editar local" onClick={() => onEditPlace(p.id)}>✎</button>}
              </div>
              <div className="event-date">
                {fmtDate(p.arriveDate)} → {fmtDate(p.departDate)}{n != null ? ` · ${n} noite${n === 1 ? "" : "s"}` : ""}
              </div>
              <div className="vplace-info">
                <div><span className="klabel">Chegada</span>{arr ? <>{(arr.generalId && gmap[arr.generalId]?.name) || arr.kind || "Transporte"} <StatusChip status={arr.generalId ? (gmap[arr.generalId]?.status || arr.status) : arr.status} /></> : <em className="vmiss">sem transporte</em>}</div>
                <div><span className="klabel">Saída</span>{dep ? <>{(dep.generalId && gmap[dep.generalId]?.name) || dep.kind || "Transporte"} <StatusChip status={dep.generalId ? (gmap[dep.generalId]?.status || dep.status) : dep.status} /></> : <em className="vmiss">sem transporte</em>}</div>
                <div><span className="klabel">Alojamento</span>
                  {pStays.length
                    ? pStays.map((s) => <span key={s.id} style={{ marginRight: 6 }}><StatusChip status={s.status} /></span>)
                    : <em className="vmiss">sem alojamento</em>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Alojamento ---------- */
function StaysView({ canEdit, places, stays, showToast, onAddStay, onEditStay, onStayStatus }) {
  const sorted = [...stays].sort((a, b) => (a.checkIn || "9999").localeCompare(b.checkIn || "9999"));
  return (
    <div>
      <div className="section-head" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Alojamento</h3>
        {canEdit && <button className="btn ember" onClick={() => onAddStay(null)} disabled={!places.length} title={places.length ? "" : "Adiciona primeiro um local"}>+ Alojamento</button>}
      </div>
      {!places.length && <p className="hint">Adiciona primeiro os locais no separador Locais.</p>}
      {places.length > 0 && sorted.length === 0 && <p className="empty">Sem alojamentos ainda.</p>}
      <div className="cards">
        {sorted.map((s) => {
          const p = places.find((x) => x.id === s.placeId);
          const n = nightsBetween(s.checkIn, s.checkOut);
          return (
            <div key={s.id} className="card">
              <div className="event-top">
                <strong>{s.name || `Alojamento em ${placeName(p)}`}</strong>
                {canEdit && <button className="iconbtn" title="Editar" onClick={() => onEditStay(s.id)}>✎</button>}
              </div>
              <div className="event-date">
                {placeName(p)} · check-in {fmtDate(s.checkIn)}{s.checkInTime ? ` ${s.checkInTime}` : ""} → check-out {fmtDate(s.checkOut)}{s.checkOutTime ? ` ${s.checkOutTime}` : ""}{n != null ? ` · ${n} noite${n === 1 ? "" : "s"}` : ""}
              </div>
              <div className="event-meta" style={{ gap: 10 }}>
                <StatusSelect item={s} canEdit={canEdit} showToast={showToast} onChange={(st) => onStayStatus(s, st)} />
                {s.priceNightPerson != null && s.priceNightPerson !== "" && <span className="vac-chip">{eur(s.priceNightPerson)}/noite/pessoa</span>}
                {s.priceTotal != null && s.priceTotal !== "" && <span className="vac-chip">total {eur(s.priceTotal)}</span>}
              </div>
              <LinksList links={s.links} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Transportes ---------- */
function TransportsView({ canEdit, places, transports, showToast, onAddTransport, onEditTransport, onTransportStatus }) {
  const generals = transports.filter((t) => t.isGeneral);
  const legs = transports.filter((t) => !t.isGeneral);
  const gmap = {};
  generals.forEach((g) => { gmap[g.id] = g; });
  return (
    <div>
      <div className="section-head" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Transportes</h3>
        {canEdit && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={() => onAddTransport(true)}>+ Transporte geral</button>
            <button className="btn ember" onClick={() => onAddTransport(false)}>+ Transporte</button>
          </div>
        )}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>“Casinha” marca o início/fim das férias (casa). Um transporte geral (ex.: carrinha alugada) pode associar-se a vários deslocamentos.</p>

      {generals.length > 0 && (
        <>
          <h4 style={{ margin: "8px 0" }}>Gerais</h4>
          <div className="cards">
            {generals.map((g) => {
              const nLegs = legs.filter((l) => l.generalId === g.id).length;
              return (
                <div key={g.id} className="card">
                  <div className="event-top">
                    <strong>{g.name || "Transporte geral"}</strong>
                    {canEdit && <button className="iconbtn" title="Editar" onClick={() => onEditTransport(g.id)}>✎</button>}
                  </div>
                  <div className="event-date">
                    {g.kind || "Transporte"} · uso {fmtDate(g.date)} → {fmtDate(g.dateEnd)} · {nLegs} deslocamento{nLegs === 1 ? "" : "s"}
                  </div>
                  <div className="event-meta" style={{ gap: 10 }}>
                    <StatusSelect item={g} canEdit={canEdit} showToast={showToast} onChange={(st) => onTransportStatus(g, st)} />
                    {g.pricePerson != null && g.pricePerson !== "" && <span className="vac-chip">{eur(g.pricePerson)}/pessoa</span>}
                  </div>
                  <LinksList links={g.links} />
                </div>
              );
            })}
          </div>
          <h4 style={{ margin: "16px 0 8px" }}>Deslocamentos</h4>
        </>
      )}

      {legs.length === 0 && <p className="empty">Sem deslocamentos ainda.</p>}
      <div className="cards">
        {legs.map((t) => {
          const gen = t.generalId ? gmap[t.generalId] : null;
          return (
            <div key={t.id} className="card">
              <div className="event-top">
                <strong>{transportLabel(t, places)}</strong>
                {canEdit && <button className="iconbtn" title="Editar" onClick={() => onEditTransport(t.id)}>✎</button>}
              </div>
              <div className="event-date">
                {gen ? (gen.name || "Transporte geral") : (t.kind || "Transporte")} · {fmtDate(t.date)}{t.time ? ` ${t.time}` : ""}
              </div>
              <div className="event-meta" style={{ gap: 10 }}>
                {gen
                  ? <><StatusChip status={gen.status} /><span className="vac-chip">geral: {gen.name || gen.kind}</span></>
                  : <>
                      <StatusSelect item={t} canEdit={canEdit} showToast={showToast} onChange={(st) => onTransportStatus(t, st)} />
                      {t.pricePerson != null && t.pricePerson !== "" && <span className="vac-chip">{eur(t.pricePerson)}/pessoa</span>}
                    </>}
              </div>
              <LinksList links={t.links} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   FORMULÁRIOS
   ============================================================ */
function VacationFormModal({ vac, events, onSave, onDelete, onClose }) {
  const editing = !!vac;
  const [f, setF] = useState(() => ({
    id: vac?.id || uid(), name: vac?.name || "",
    dateStart: vac?.dateStart || "", dateEnd: vac?.dateEnd || "",
    eventId: vac?.eventId || "", notes: vac?.notes || "",
  }));
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const n = nightsBetween(f.dateStart, f.dateEnd);
  const sortedEvents = [...events].sort((a, b) => (b.dateStart || "").localeCompare(a.dateStart || ""));
  return (
    <VModal title={editing ? "Editar férias" : "Novas férias"} onClose={onClose}>
      <label>Nome<input placeholder="ex.: Férias 2026 — Balcãs" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></label>
      <div className="row">
        <label>Início<input type="date" value={f.dateStart} onChange={(e) => set("dateStart", e.target.value)} /></label>
        <label>Fim<input type="date" value={f.dateEnd} onChange={(e) => set("dateEnd", e.target.value)} /></label>
      </div>
      {n != null && <p className="hint" style={{ margin: "0 0 8px" }}>{n + 1} dias · {n} noites</p>}
      <label>Evento ligado (opcional — para confirmações e presenças)
        <select value={f.eventId} onChange={(e) => set("eventId", e.target.value)}>
          <option value="">Sem evento ligado</option>
          {sortedEvents.map((ev) => <option key={ev.id} value={ev.id}>{ev.name} ({fmtDate(ev.dateStart)})</option>)}
        </select>
      </label>
      <label>Notas (opcional)<textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
      <div className="actions">
        {editing && <button className="btn danger" onClick={() => { if (window.confirm("Eliminar estas férias e tudo o que contêm (locais, alojamentos, transportes, tarefas)?")) onDelete(f.id); }}>Eliminar</button>}
        <button className="btn ember" disabled={!f.name.trim() || !f.dateStart || !f.dateEnd || f.dateEnd < f.dateStart}
          onClick={() => onSave({ ...f, name: f.name.trim(), eventId: f.eventId || null, notes: f.notes.trim() })}>
          Guardar férias
        </button>
      </div>
    </VModal>
  );
}

function PlaceFormModal({ place, vac, nextSort, onSave, onDelete, onClose }) {
  const editing = !!place;
  const [f, setF] = useState(() => ({
    id: place?.id || uid(), vacationId: vac.id,
    city: place?.city || "", country: place?.country || "",
    arriveDate: place?.arriveDate || "", departDate: place?.departDate || "",
    sort: place?.sort ?? nextSort,
  }));
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const n = nightsBetween(f.arriveDate, f.departDate);
  return (
    <VModal title={editing ? "Editar local" : "Novo local"} onClose={onClose}>
      <div className="row">
        <label>Cidade<input placeholder="ex.: Sarajevo" value={f.city} onChange={(e) => set("city", e.target.value)} autoFocus /></label>
        <label>País<input placeholder="ex.: Bósnia" value={f.country} onChange={(e) => set("country", e.target.value)} /></label>
      </div>
      <div className="row">
        <label>Chegada<input type="date" min={vac.dateStart} max={vac.dateEnd} value={f.arriveDate} onChange={(e) => set("arriveDate", e.target.value)} /></label>
        <label>Saída<input type="date" min={vac.dateStart} max={vac.dateEnd} value={f.departDate} onChange={(e) => set("departDate", e.target.value)} /></label>
      </div>
      {n != null && <p className="hint" style={{ margin: "0 0 8px" }}>{n} noite{n === 1 ? "" : "s"} neste local</p>}
      <p className="hint">O transporte de chegada/saída define-se no separador Transportes e aparece aqui automaticamente.</p>
      <div className="actions">
        {editing && <button className="btn danger" onClick={() => { if (window.confirm("Eliminar este local? Os alojamentos associados também são eliminados.")) onDelete(f.id); }}>Eliminar</button>}
        <button className="btn ember" disabled={!f.city.trim() || (f.arriveDate && f.departDate && f.departDate < f.arriveDate)}
          onClick={() => onSave({ ...f, city: f.city.trim(), country: f.country.trim() || null, arriveDate: f.arriveDate || null, departDate: f.departDate || null })}>
          Guardar local
        </button>
      </div>
    </VModal>
  );
}

function StayFormModal({ stay, vac, defaultPlaceId, places, showToast, onSave, onDelete, onClose }) {
  const editing = !!stay;
  const [f, setF] = useState(() => ({
    id: stay?.id || uid(), vacationId: vac.id,
    placeId: stay?.placeId || defaultPlaceId || places[0]?.id || "",
    name: stay?.name || "",
    checkIn: stay?.checkIn || "", checkInTime: stay?.checkInTime || "",
    checkOut: stay?.checkOut || "", checkOutTime: stay?.checkOutTime || "",
    priceNightPerson: stay?.priceNightPerson ?? "", priceTotal: stay?.priceTotal ?? "",
    links: stay?.links || [], status: stay?.status || "Por pesquisar",
  }));
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const n = nightsBetween(f.checkIn, f.checkOut);
  function submit() {
    const err = statusBlocker(f.status, f.links);
    if (err) { showToast(err); return; }
    onSave({
      ...f, name: f.name.trim() || null,
      checkIn: f.checkIn || null, checkInTime: f.checkInTime || null,
      checkOut: f.checkOut || null, checkOutTime: f.checkOutTime || null,
      priceNightPerson: f.priceNightPerson === "" ? null : Number(f.priceNightPerson),
      priceTotal: f.priceTotal === "" ? null : Number(f.priceTotal),
    });
  }
  return (
    <VModal title={editing ? "Editar alojamento" : "Novo alojamento"} onClose={onClose} wide>
      <div className="row">
        <label>Local
          <select value={f.placeId} onChange={(e) => set("placeId", e.target.value)}>
            {places.map((p) => <option key={p.id} value={p.id}>{placeName(p)}</option>)}
          </select>
        </label>
        <label>Nome (opcional)<input placeholder="ex.: Airbnb no centro" value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
      </div>
      <div className="row">
        <label>Check-in<input type="date" value={f.checkIn} onChange={(e) => set("checkIn", e.target.value)} /></label>
        <label>Hora<input type="time" value={f.checkInTime} onChange={(e) => set("checkInTime", e.target.value)} /></label>
      </div>
      <div className="row">
        <label>Check-out<input type="date" value={f.checkOut} onChange={(e) => set("checkOut", e.target.value)} /></label>
        <label>Hora<input type="time" value={f.checkOutTime} onChange={(e) => set("checkOutTime", e.target.value)} /></label>
      </div>
      {n != null && <p className="hint" style={{ margin: "0 0 8px" }}>{n} noite{n === 1 ? "" : "s"}</p>}
      <div className="row">
        <label>€/noite/pessoa<input type="number" min="0" step="0.01" value={f.priceNightPerson} onChange={(e) => set("priceNightPerson", e.target.value)} /></label>
        <label>Preço total (€)<input type="number" min="0" step="0.01" value={f.priceTotal} onChange={(e) => set("priceTotal", e.target.value)} /></label>
      </div>
      <LinksEditor links={f.links} onChange={(l) => set("links", l)} />
      <label>Estado
        <select value={f.status} onChange={(e) => set("status", e.target.value)}>
          {VSTATUS.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <p className="hint">“Em pesquisa” exige ≥1 link · “Escolhido” em diante exige exatamente 1 link.</p>
      <div className="actions">
        {editing && <button className="btn danger" onClick={() => onDelete(f.id)}>Eliminar</button>}
        <button className="btn ember" disabled={!f.placeId} onClick={submit}>Guardar alojamento</button>
      </div>
    </VModal>
  );
}

function TransportFormModal({ transport, vac, general, places, transports, showToast, onSave, onDelete, onClose }) {
  const editing = !!transport;
  const isGeneral = editing ? !!transport.isGeneral : !!general;
  const generals = (transports || []).filter((t) => t.isGeneral && t.id !== transport?.id);
  const [f, setF] = useState(() => ({
    id: transport?.id || uid(), vacationId: vac.id,
    fromPlaceId: transport?.fromPlaceId || "", toPlaceId: transport?.toPlaceId || "",
    kind: transport?.kind || (isGeneral ? "Carro" : "Avião"),
    name: transport?.name || "",
    date: transport?.date || "", dateEnd: transport?.dateEnd || "", time: transport?.time || "",
    pricePerson: transport?.pricePerson ?? "",
    links: transport?.links || [], status: transport?.status || "Por pesquisar",
    generalId: transport?.generalId || "",
  }));
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const usesGeneral = !isGeneral && !!f.generalId;

  /* com transporte geral, a data vem dos locais: saída do local de partida = chegada ao local de destino */
  const fromPlace = places.find((p) => p.id === f.fromPlaceId) || null;
  const toPlace = places.find((p) => p.id === f.toPlaceId) || null;
  const derivedDate = fromPlace?.departDate || toPlace?.arriveDate || null;
  const dateMismatch = usesGeneral && !!fromPlace?.departDate && !!toPlace?.arriveDate
    && fromPlace.departDate !== toPlace.arriveDate;

  function submit() {
    if (isGeneral) {
      if (!f.name.trim()) { showToast("Dá um nome ao transporte geral (ex.: Carrinha alugada)."); return; }
      if (f.date && f.dateEnd && f.dateEnd < f.date) { showToast("O fim do uso não pode ser antes do início."); return; }
      const err = statusBlocker(f.status, f.links);
      if (err) { showToast(err); return; }
      onSave({
        ...f, isGeneral: true, name: f.name.trim(), fromPlaceId: null, toPlaceId: null, generalId: null,
        date: f.date || null, dateEnd: f.dateEnd || null, time: null,
        pricePerson: f.pricePerson === "" ? null : Number(f.pricePerson),
      });
      return;
    }
    if (!f.fromPlaceId && !f.toPlaceId) { showToast("Casinha → Casinha não é bem uma viagem 😄"); return; }
    if (f.fromPlaceId === f.toPlaceId) { showToast("Partida e chegada não podem ser o mesmo local."); return; }
    if (!usesGeneral) {
      const err = statusBlocker(f.status, f.links);
      if (err) { showToast(err); return; }
    }
    if (dateMismatch) {
      showToast(`A saída de ${placeName(fromPlace)} (${fmtDate(fromPlace.departDate)}) não coincide com a chegada a ${placeName(toPlace)} (${fmtDate(toPlace.arriveDate)}) — corrige as datas nos locais.`);
      return;
    }
    onSave({
      ...f, isGeneral: false, name: null, dateEnd: null,
      fromPlaceId: f.fromPlaceId || null, toPlaceId: f.toPlaceId || null,
      generalId: f.generalId || null,
      date: usesGeneral ? derivedDate : (f.date || null), time: f.time || null,
      pricePerson: usesGeneral ? null : (f.pricePerson === "" ? null : Number(f.pricePerson)),
    });
  }

  const endOptions = (
    <>
      <option value="">Casinha (início/fim)</option>
      {places.map((p) => <option key={p.id} value={p.id}>{placeName(p)}</option>)}
    </>
  );

  if (isGeneral) {
    return (
      <VModal title={editing ? "Editar transporte geral" : "Novo transporte geral"} onClose={onClose} wide>
        <label>Nome<input placeholder="ex.: Carrinha alugada" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></label>
        <div className="row">
          <label>Tipo
            <select value={f.kind} onChange={(e) => set("kind", e.target.value)}>
              {TRANSPORT_KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <label>€/pessoa<input type="number" min="0" step="0.01" value={f.pricePerson} onChange={(e) => set("pricePerson", e.target.value)} /></label>
        </div>
        <div className="row">
          <label>Início do uso<input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
          <label>Fim do uso<input type="date" value={f.dateEnd} onChange={(e) => set("dateEnd", e.target.value)} /></label>
        </div>
        <LinksEditor links={f.links} onChange={(l) => set("links", l)} />
        <label>Estado
          <select value={f.status} onChange={(e) => set("status", e.target.value)}>
            {VSTATUS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <p className="hint">Depois associa este transporte aos deslocamentos entre locais (campo “Transporte geral” no formulário de cada deslocamento).</p>
        <div className="actions">
          {editing && <button className="btn danger" onClick={() => { if (window.confirm("Eliminar este transporte geral? Os deslocamentos associados ficam sem transporte.")) onDelete(f.id); }}>Eliminar</button>}
          <button className="btn ember" onClick={submit}>Guardar transporte geral</button>
        </div>
      </VModal>
    );
  }

  return (
    <VModal title={editing ? "Editar transporte" : "Novo transporte"} onClose={onClose} wide>
      <div className="row">
        <label>Partida<select value={f.fromPlaceId} onChange={(e) => set("fromPlaceId", e.target.value)}>{endOptions}</select></label>
        <label>Chegada<select value={f.toPlaceId} onChange={(e) => set("toPlaceId", e.target.value)}>{endOptions}</select></label>
      </div>
      {generals.length > 0 && (
        <label>Transporte geral (opcional — preço e estado ficam no geral)
          <select value={f.generalId} onChange={(e) => set("generalId", e.target.value)}>
            <option value="">— nenhum —</option>
            {generals.map((g) => <option key={g.id} value={g.id}>{g.name || g.kind}</option>)}
          </select>
        </label>
      )}
      {!usesGeneral && (
        <div className="row">
          <label>Tipo
            <select value={f.kind} onChange={(e) => set("kind", e.target.value)}>
              {TRANSPORT_KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <label>€/pessoa<input type="number" min="0" step="0.01" value={f.pricePerson} onChange={(e) => set("pricePerson", e.target.value)} /></label>
        </div>
      )}
      {usesGeneral ? (
        <>
          {dateMismatch
            ? <p className="hint" style={{ color: "#ff8a5c", margin: "0 0 8px" }}>
                A saída de {placeName(fromPlace)} ({fmtDate(fromPlace.departDate)}) não coincide com a chegada a {placeName(toPlace)} ({fmtDate(toPlace.arriveDate)}) — corrige as datas nos locais.
              </p>
            : <p className="hint" style={{ margin: "0 0 8px" }}>
                Data do deslocamento: {derivedDate ? fmtDate(derivedDate) : "—"} (vem das datas dos locais).
              </p>}
          <div className="row">
            <label>Hora (opcional)<input type="time" value={f.time} onChange={(e) => set("time", e.target.value)} /></label>
          </div>
        </>
      ) : (
        <div className="row">
          <label>Data<input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
          <label>Hora<input type="time" value={f.time} onChange={(e) => set("time", e.target.value)} /></label>
        </div>
      )}
      {!usesGeneral && (
        <>
          <LinksEditor links={f.links} onChange={(l) => set("links", l)} />
          <label>Estado
            <select value={f.status} onChange={(e) => set("status", e.target.value)}>
              {VSTATUS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <p className="hint">“Em pesquisa” exige ≥1 link · “Escolhido” em diante exige exatamente 1 link.</p>
        </>
      )}
      <div className="actions">
        {editing && <button className="btn danger" onClick={() => onDelete(f.id)}>Eliminar</button>}
        <button className="btn ember" onClick={submit}>Guardar transporte</button>
      </div>
    </VModal>
  );
}

function TaskFormModal({ task, vac, members, onSave, onDelete, onClose }) {
  const editing = !!task;
  const [f, setF] = useState(() => ({
    id: task?.id || uid(), vacationId: vac.id, autoKey: null,
    title: task?.title || "", dueDate: task?.dueDate || "",
    assignees: task?.assignees || [], done: task?.done || false,
  }));
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const toggle = (mid) => set("assignees", f.assignees.includes(mid) ? f.assignees.filter((x) => x !== mid) : [...f.assignees, mid]);
  return (
    <VModal title={editing ? "Editar tarefa" : "Nova tarefa"} onClose={onClose}>
      <label>Tarefa<input placeholder="ex.: Alugar carro em Split" value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus /></label>
      <label>Data limite (opcional)<input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></label>
      <span className="klabel">Responsáveis (participantes confirmados)</span>
      {members.length === 0 && <p className="hint">Ainda não há participantes confirmados — confirma a participação no Resumo.</p>}
      <div className="pill-row">
        {members.map((m) => (
          <button key={m.id} type="button" className={`pill ${f.assignees.includes(m.id) ? "on" : ""}`} onClick={() => toggle(m.id)}>{m.name}</button>
        ))}
      </div>
      <div className="actions">
        {editing && <button className="btn danger" onClick={() => onDelete(f.id)}>Eliminar</button>}
        <button className="btn ember" disabled={!f.title.trim()}
          onClick={() => onSave({ ...f, title: f.title.trim(), dueDate: f.dueDate || null })}>
          Guardar tarefa
        </button>
      </div>
    </VModal>
  );
}

/* ---------- Estilos específicos ---------- */
function FeriasStyle() {
  return (
    <style>{`
      .vac-chip { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: rgba(255,255,255,.07); color: inherit; opacity: .9; white-space: nowrap; }
      .vac-chip.big { font-size: 13px; }
      .vac-back { text-decoration: none; opacity: .65; font-size: 15px; margin-right: 4px; }
      .vac-back:hover { opacity: 1; }
      .vtask-list { display: flex; flex-direction: column; gap: 8px; }
      .vtask { padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.07); }
      .vtask.done { opacity: .55; }
      .vtask-main { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
      .vtask-title { flex: 1; min-width: 200px; }
      .vtask-jump { font-size: 12px; margin-left: 8px; opacity: .7; }
      .vtask-due { font-size: 12px; opacity: .75; white-space: nowrap; }
      .vtask-due.late { color: #ff8a5c; opacity: 1; font-weight: 600; }
      .vplace-info { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; font-size: 14px; }
      .vplace-info .klabel { display: inline-block; min-width: 90px; }
      .vmiss { opacity: .6; }
      .vlinks { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; font-size: 13px; }
      .vlinks a { opacity: .85; word-break: break-all; }
      .vlink-row { display: flex; align-items: center; gap: 6px; font-size: 13px; margin: 2px 0; }
      .vlink-row a { flex: 1; word-break: break-all; }
      .vmap { height: 340px; border-radius: 12px; margin-bottom: 14px; border: 1px solid rgba(255,255,255,.1); overflow: hidden; position: relative; z-index: 0; }
      .vmap-pin { min-width: 26px; padding: 0 5px; box-sizing: border-box; height: 26px; border-radius: 999px; background: #FF7A3D; color: #fff; font-weight: 700; font-size: 13px; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 1px 6px rgba(0,0,0,.5); }
      .vmap .leaflet-popup-content { font-size: 13px; line-height: 1.45; }
    `}</style>
  );
}
