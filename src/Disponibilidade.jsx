import React, { useEffect, useMemo, useRef, useState } from "react";

/* ============================================================
   MAPA DE DISPONIBILIDADE
   Cada membro marca cada dia como "livre", "ocupado" ou "indeciso".
   Vista tipo calendário: mês atual + a última semana do mês anterior
   e a primeira do seguinte. Seleção múltipla arrastando o rato.
   Todos veem tudo; cada um só edita a sua.
   Dias com muita gente livre ganham borda brilhante:
     5-6 vermelha · 7-9 laranja · 10+ amarela
   Tabela: ver supabase/setup-disponibilidades.sql
   ============================================================ */
import { availabilityApi } from "./api.js";

export const STATES = ["livre", "ocupado", "indeciso"];
export const STATE_LABEL = { livre: "Livre", ocupado: "Ocupado", indeciso: "Indeciso" };
export const STATE_EMOJI = { livre: "🟢", ocupado: "🔴", indeciso: "🟡" };

const WD = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/* ---------- datas (sempre em hora local, nunca UTC) ---------- */
export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/* segunda-feira da semana de d */
const mondayOf = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const fmtDay = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

/* ---------- borda brilhante conforme o nº de livres ---------- */
export function hotTier(n) {
  if (n >= 10) return "t10";
  if (n >= 7) return "t7";
  if (n >= 5) return "t5";
  return "";
}

/* ============================================================
   Janela de 4 semanas alinhada à semana (segunda a domingo):
   só muda de semana a semana, para o aviso da Home "voltar"
   uma vez por semana e não todos os dias.
   ============================================================ */
export function weeksWindow(from = new Date(), weeks = 4) {
  const start = mondayOf(from);
  const out = [];
  for (let i = 0; i < weeks * 7; i++) out.push(iso(addDays(start, i)));
  return out;
}

/* meses ('YYYY-MM') tocados por uma lista de dias */
export const monthsOf = (days) => [...new Set(days.map((d) => d.slice(0, 7)))];

/* dias das próximas 4 semanas que o membro ainda não classificou
   (o fim da janela só avança à segunda-feira → o aviso volta 1x/semana;
    dias já passados desta semana não contam) */
export function missingDays(rows, memberId, from = new Date()) {
  if (!memberId) return [];
  const mine = {};
  (rows || []).forEach((r) => { if (r.memberId === memberId) Object.assign(mine, r.days || {}); });
  const hoje = iso(from);
  return weeksWindow(from).filter((d) => d >= hoje && !mine[d]);
}

/* ============================================================ */
export default function DisponibilidadeTab({ members, myMember, session, showToast, onChanged }) {
  const today = iso(new Date());
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sel, setSel] = useState(null);            // {a, b} extremos (ISO) da seleção
  const [dragging, setDragging] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false); // esconder a contagem dos outros
  const gridRef = useRef(null);

  const canEdit = !!(session && myMember);

  /* ---------- grelha: semana extra antes e depois do mês ---------- */
  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const last = new Date(cursor.y, cursor.m + 1, 0);
    const start = addDays(mondayOf(first), -7);          // última semana do mês anterior
    const end = addDays(mondayOf(last), 13);             // primeira semana do mês seguinte
    const days = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) days.push(iso(d));
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    return { days, weeks };
  }, [cursor]);

  const gridMonths = useMemo(() => monthsOf(grid.days), [grid]);

  /* ---------- carregar (também os meses da janela de 4 semanas, p/ o aviso) ---------- */
  const need = useMemo(
    () => [...new Set([...gridMonths, ...monthsOf(weeksWindow())])].sort(),
    [gridMonths]
  );

  async function reload() {
    setLoading(true);
    setRows(await availabilityApi.loadMonths(need));
    setLoading(false);
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [need.join(",")]);

  /* ---------- índice dia -> estados ---------- */
  const byDay = useMemo(() => {
    const map = {};
    (rows || []).forEach((r) => {
      Object.entries(r.days || {}).forEach(([day, st]) => {
        if (!STATES.includes(st)) return;
        (map[day] ||= { livre: [], ocupado: [], indeciso: [] })[st].push(r.memberId);
      });
    });
    return map;
  }, [rows]);

  const myState = (day) => {
    if (!myMember) return null;
    const c = byDay[day];
    if (!c) return null;
    return STATES.find((s) => c[s].includes(myMember.id)) || null;
  };

  const nameOf = (id) => members.find((m) => m.id === id)?.name || "?";

  /* ---------- dias por classificar nas próximas 4 semanas ---------- */
  const missing = useMemo(() => missingDays(rows, myMember?.id), [rows, myMember]);
  const missingSet = useMemo(() => new Set(missing), [missing]);

  /* ---------- seleção ---------- */
  const selDays = useMemo(() => {
    if (!sel) return [];
    const [a, b] = [sel.a, sel.b].sort();
    return grid.days.filter((d) => d >= a && d <= b);
  }, [sel, grid]);
  const selSet = useMemo(() => new Set(selDays), [selDays]);

  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(false);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [dragging]);

  function down(day, e) {
    /* no toque o browser captura o ponteiro na célula inicial — libertar
       permite que os pointermove cheguem à grelha (ver move()) */
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    if (e.shiftKey && sel) { setSel({ ...sel, b: day }); return; }   // shift+clique estende
    setSel({ a: day, b: day });
    setDragging(true);
  }
  function over(day) { if (dragging) setSel((s) => (s ? { ...s, b: day } : s)); }
  /* arrastar com o dedo: encontra a célula por baixo do toque */
  function move(e) {
    if (!dragging || e.pointerType === "mouse") return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-day]");
    if (el) over(el.dataset.day);
  }

  /* ---------- gravar ---------- */
  async function apply(state) {
    if (!canEdit || !selDays.length) return;
    setSaving(true);
    try {
      await availabilityApi.setMine(selDays, state);
      await reload();
      onChanged?.();
      setSel(null);
      showToast?.(state
        ? `${selDays.length} dia${selDays.length === 1 ? "" : "s"} marcado${selDays.length === 1 ? "" : "s"} como «${STATE_LABEL[state]}»`
        : `${selDays.length} dia${selDays.length === 1 ? "" : "s"} por classificar`);
    } catch (err) {
      console.error(err);
      showToast?.(err.message?.includes("Sem membro")
        ? "A tua conta ainda não está ligada a um membro."
        : "Não foi possível guardar. Corre a migração setup-disponibilidades.sql?");
    }
    setSaving(false);
  }

  /* preencher de uma vez os dias que faltam nas próximas 4 semanas */
  async function fillMissing(state) {
    if (!canEdit || !missing.length) return;
    setSaving(true);
    try {
      await availabilityApi.setMine(missing, state);
      await reload();
      onChanged?.();
      showToast?.(`${missing.length} dias marcados como «${STATE_LABEL[state]}»`);
    } catch (err) { console.error(err); showToast?.("Não foi possível guardar."); }
    setSaving(false);
  }

  /* ---------- melhores datas do período visível ---------- */
  const bestDays = useMemo(
    () => grid.days
      .filter((d) => d >= today && (byDay[d]?.livre.length || 0) >= 5)
      .sort((a, b) => (byDay[b].livre.length - byDay[a].livre.length) || a.localeCompare(b))
      .slice(0, 8),
    [grid, byDay, today]
  );

  const shiftMonth = (n) => setCursor(({ y, m }) => {
    const d = new Date(y, m + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const total = members.length || 1;

  return (
    <section>
      <AvailStyle />

      <div className="section-head">
        <h2>Mapa de Disponibilidade</h2>
        <div className="head-actions">
          <div className="segmented">
            <button onClick={() => shiftMonth(-1)} title="Mês anterior">‹</button>
            <button className="on" style={{ minWidth: 150, cursor: "default" }}>{MONTHS[cursor.m]} {cursor.y}</button>
            <button onClick={() => shiftMonth(1)} title="Mês seguinte">›</button>
          </div>
          <button className="btn ghost small" onClick={() => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }); }}>Hoje</button>
          <button className={`btn ghost small ${onlyMine ? "" : ""}`} onClick={() => setOnlyMine((v) => !v)}>
            {onlyMine ? "Ver todos" : "Ver só a minha"}
          </button>
        </div>
      </div>

      {!session && <p className="hint">Estás a ver o mapa em modo de leitura. Entra na tua conta para marcares a tua disponibilidade.</p>}
      {session && !myMember && <p className="hint">A tua conta ainda não está ligada a um membro — pede a um admin para a ligar.</p>}

      {canEdit && missing.length > 0 && (
        <div className="av-warn">
          <span>
            ⏳ Faltam-te <b>{missing.length}</b> dia{missing.length === 1 ? "" : "s"} por classificar nas próximas 4 semanas
            (<b>{fmtDay(missing[0])}</b> a <b>{fmtDay(missing[missing.length - 1])}</b>).
          </span>
          <span className="av-warn-acts">
            <button className="pill" disabled={saving} onClick={() => fillMissing("livre")}>Marcar tudo como Livre</button>
            <button className="pill" disabled={saving} onClick={() => fillMissing("ocupado")}>…como Ocupado</button>
          </span>
        </div>
      )}

      <div className="av-legend">
        {STATES.map((s) => <span key={s} className={`av-key ${s}`}><i />{STATE_LABEL[s]}</span>)}
        <span className="av-sep" />
        <span className="av-key t5"><i />5-6 livres</span>
        <span className="av-key t7"><i />7-9 livres</span>
        <span className="av-key t10"><i />10+ livres</span>
      </div>

      <div className="av-wrap">
        <div className="av-head">{WD.map((w) => <span key={w}>{w}</span>)}</div>
        <div className="av-grid" ref={gridRef} onPointerMove={move}>
          {grid.weeks.map((week, wi) => week.map((day) => {
            const c = byDay[day] || { livre: [], ocupado: [], indeciso: [] };
            const livres = c.livre.length;
            const mine = myState(day);
            const out = Number(day.slice(5, 7)) - 1 !== cursor.m;
            return (
              <button
                key={day}
                data-day={day}
                className={[
                  "av-cell",
                  out ? "out" : "",
                  day === today ? "today" : "",
                  mine ? `mine-${mine}` : "",
                  onlyMine ? "" : hotTier(livres),
                  selSet.has(day) ? "sel" : "",
                  canEdit && missingSet.has(day) && !mine ? "todo" : "",
                ].join(" ")}
                onPointerDown={(e) => down(day, e)}
                onPointerEnter={() => over(day)}
                title={`${fmtDay(day)} — ${livres} livre(s), ${c.indeciso.length} indeciso(s), ${c.ocupado.length} ocupado(s)`}
              >
                <span className="av-num">{Number(day.slice(8, 10))}{wi === 0 || day.slice(8, 10) === "01" ? <em> {MONTHS[Number(day.slice(5, 7)) - 1].slice(0, 3)}</em> : null}</span>
                {!onlyMine && (
                  <>
                    <span className="av-bar">
                      {STATES.map((s) => c[s].length ? <i key={s} className={s} style={{ flexGrow: c[s].length }} /> : null)}
                    </span>
                    <span className="av-count">{livres > 0 ? <b>{livres}</b> : <span className="av-zero">—</span>}</span>
                  </>
                )}
                {onlyMine && <span className="av-count">{mine ? STATE_EMOJI[mine] : <span className="av-zero">—</span>}</span>}
              </button>
            );
          }))}
        </div>
        {loading && <p className="hint" style={{ marginTop: 8 }}>A carregar disponibilidades…</p>}
      </div>

      {/* ---------- painel da seleção ---------- */}
      {selDays.length > 0 && (
        <div className="av-panel">
          <div className="av-panel-head">
            <h3>
              {selDays.length === 1
                ? fmtDay(selDays[0])
                : `${fmtDay(selDays[0])} – ${fmtDay(selDays[selDays.length - 1])} · ${selDays.length} dias`}
            </h3>
            <button className="iconbtn" title="Fechar" onClick={() => setSel(null)}>✕</button>
          </div>

          {canEdit ? (
            <div className="av-actions">
              {STATES.map((s) => (
                <button key={s} className={`av-btn ${s}`} disabled={saving} onClick={() => apply(s)}>
                  {STATE_EMOJI[s]} {STATE_LABEL[s]}
                </button>
              ))}
              <button className="btn ghost small" disabled={saving} onClick={() => apply(null)}>Limpar</button>
              <span className="hint" style={{ margin: 0 }}>Arrasta pelos dias para selecionares vários (ou shift+clique).</span>
            </div>
          ) : (
            <p className="hint">Entra na tua conta para marcares a tua disponibilidade.</p>
          )}

          {selDays.length === 1 && (
            <div className="av-detail">
              {STATES.map((s) => {
                const ids = byDay[selDays[0]]?.[s] || [];
                return (
                  <div key={s} className="av-detail-col">
                    <h4>{STATE_EMOJI[s]} {STATE_LABEL[s]} · {ids.length}</h4>
                    {ids.length
                      ? ids.map((id) => <span key={id} className="av-name">{nameOf(id)}</span>)
                      : <span className="hint" style={{ margin: 0 }}>—</span>}
                  </div>
                );
              })}
              <div className="av-detail-col">
                <h4>Sem resposta · {total - STATES.reduce((a, s) => a + (byDay[selDays[0]]?.[s]?.length || 0), 0)}</h4>
                {members
                  .filter((m) => !STATES.some((s) => (byDay[selDays[0]]?.[s] || []).includes(m.id)))
                  .map((m) => <span key={m.id} className="av-name muted">{m.name}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- melhores datas ---------- */}
      <div className="section-head" style={{ marginTop: 28 }}><h2>Melhores datas à vista</h2></div>
      {bestDays.length === 0 ? (
        <p className="empty">Ainda não há dias com 5 ou mais membros livres neste período. Marquem lá as disponibilidades! 🔥</p>
      ) : (
        <div className="av-best">
          {bestDays.map((d) => (
            <button key={d} className={`av-best-card ${hotTier(byDay[d].livre.length)}`} onClick={() => setSel({ a: d, b: d })}>
              <strong>{fmtDay(d)}</strong>
              <span className="hint">{WD[(new Date(d + "T00:00:00").getDay() + 6) % 7]}</span>
              <span className="av-best-n">{byDay[d].livre.length} livres</span>
              {byDay[d].indeciso.length > 0 && <span className="hint">+{byDay[d].indeciso.length} indeciso(s)</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ============================================================ */
function AvailStyle() {
  return (
    <style>{`
      .av-wrap { user-select:none; }
      .av-head { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; margin-bottom:6px; }
      .av-head span { text-align:center; font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
      .av-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; touch-action:pan-y; }

      .av-cell { position:relative; display:flex; flex-direction:column; gap:4px; align-items:stretch;
        min-height:74px; padding:6px 7px; border-radius:10px; cursor:pointer; font:inherit; text-align:left;
        background:var(--surface); border:1px solid var(--line); color:var(--text); transition:border-color .12s, transform .06s; }
      .av-cell:hover { border-color:var(--muted); }
      .av-cell:active { transform:scale(.98); }
      .av-cell.out { opacity:.5; }
      .av-cell.today .av-num { color:var(--ember); font-weight:800; }
      .av-cell.today { box-shadow:inset 0 0 0 1px var(--ember); }
      .av-num { font-size:13px; font-weight:700; color:var(--text); }
      .av-num em { font-style:normal; font-size:10px; color:var(--muted); font-weight:600; }

      .av-bar { display:flex; gap:2px; height:5px; border-radius:3px; overflow:hidden; background:rgba(255,255,255,.05); }
      .av-bar i { display:block; border-radius:3px; }
      .av-bar i.livre { background:#4ADE80; } .av-bar i.indeciso { background:#F5B841; } .av-bar i.ocupado { background:#D96C5F; }
      .av-count { margin-top:auto; font-size:15px; line-height:1; }
      .av-count b { color:#4ADE80; }
      .av-zero { color:var(--muted); font-size:12px; }

      /* o meu estado pinta o fundo */
      .av-cell.mine-livre { background:linear-gradient(180deg, rgba(74,222,128,.20), rgba(74,222,128,.07)); }
      .av-cell.mine-ocupado { background:linear-gradient(180deg, rgba(217,108,95,.20), rgba(217,108,95,.07)); }
      .av-cell.mine-indeciso { background:linear-gradient(180deg, rgba(245,184,65,.20), rgba(245,184,65,.07)); }
      /* dias por classificar dentro das próximas 4 semanas */
      .av-cell.todo { border-style:dashed; border-color:rgba(245,184,65,.55); }

      /* bordas brilhantes das datas boas */
      .av-cell.t5 { border-color:#E23B3B; box-shadow:0 0 0 1px #E23B3B, 0 0 12px rgba(226,59,59,.55); }
      .av-cell.t7 { border-color:#FF7A3D; box-shadow:0 0 0 1px #FF7A3D, 0 0 12px rgba(255,122,61,.6); }
      .av-cell.t10 { border-color:#F5B841; box-shadow:0 0 0 1px #F5B841, 0 0 14px rgba(245,184,65,.7); }
      .av-cell.t5.today, .av-cell.t7.today, .av-cell.t10.today { box-shadow:inset 0 0 0 1px var(--ember), 0 0 12px rgba(255,255,255,.15); }
      .av-cell.sel { outline:2px solid var(--gold); outline-offset:1px; }

      .av-legend { display:flex; flex-wrap:wrap; gap:14px; align-items:center; margin:0 0 12px; font-size:12.5px; color:var(--muted); }
      .av-key { display:inline-flex; align-items:center; gap:6px; }
      .av-key i { width:12px; height:12px; border-radius:4px; display:inline-block; border:1px solid var(--line); }
      .av-key.livre i { background:rgba(74,222,128,.35); } .av-key.ocupado i { background:rgba(217,108,95,.35); } .av-key.indeciso i { background:rgba(245,184,65,.35); }
      .av-key.t5 i { border-color:#E23B3B; box-shadow:0 0 7px rgba(226,59,59,.8); background:none; }
      .av-key.t7 i { border-color:#FF7A3D; box-shadow:0 0 7px rgba(255,122,61,.8); background:none; }
      .av-key.t10 i { border-color:#F5B841; box-shadow:0 0 7px rgba(245,184,65,.9); background:none; }
      .av-sep { width:1px; height:14px; background:var(--line); }

      .av-warn { display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between;
        margin:0 0 14px; padding:10px 12px; border-radius:10px; border:1px solid var(--gold);
        background:rgba(245,184,65,.08); font-size:13.5px; }
      .av-warn-acts { display:flex; gap:8px; flex-wrap:wrap; }

      .av-panel { margin-top:14px; background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
      .av-panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .av-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px; }
      .av-btn { border:1px solid var(--line); border-radius:8px; padding:8px 14px; font:inherit; font-weight:600; cursor:pointer;
        background:var(--surface2); color:var(--text); }
      .av-btn:hover { filter:brightness(1.15); }
      .av-btn.livre { border-color:#4ADE80; } .av-btn.ocupado { border-color:#D96C5F; } .av-btn.indeciso { border-color:#F5B841; }
      .av-btn:disabled { opacity:.45; cursor:not-allowed; }

      .av-detail { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-top:14px;
        border-top:1px solid var(--line); padding-top:10px; }
      .av-detail-col { display:flex; flex-direction:column; gap:3px; }
      .av-detail-col h4 { margin:0 0 4px; }
      .av-name { font-size:13px; }
      .av-name.muted { color:var(--muted); }

      .av-best { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; }
      .av-best-card { display:flex; flex-direction:column; gap:2px; align-items:flex-start; padding:12px 14px; border-radius:12px;
        background:var(--surface); border:1px solid var(--line); color:var(--text); font:inherit; cursor:pointer; text-align:left; }
      .av-best-card strong { font-size:17px; }
      .av-best-n { color:#4ADE80; font-weight:700; font-size:13px; margin-top:4px; }
      .av-best-card.t5 { border-color:#E23B3B; box-shadow:0 0 10px rgba(226,59,59,.45); }
      .av-best-card.t7 { border-color:#FF7A3D; box-shadow:0 0 10px rgba(255,122,61,.5); }
      .av-best-card.t10 { border-color:#F5B841; box-shadow:0 0 12px rgba(245,184,65,.6); }

      @media (max-width: 640px) {
        .av-cell { min-height:58px; padding:4px 5px; }
        .av-num { font-size:11.5px; } .av-count { font-size:13px; }
      }
    `}</style>
  );
}
