import React, { useEffect, useMemo, useState } from "react";

/* ============================================================
   AS MINHAS CONTAS
   Junta, para o membro com sessão iniciada, as contas dos eventos
   (`purchases`) e das férias (`vacation_purchases`).
   SÓ LEITURA: nada aqui escreve na base de dados — pagar, confirmar
   e editar continuam a fazer-se no evento / nas férias de origem.
   ============================================================ */
import { feriasApi } from "./api.js";
import { shareOf, buildLedger, ledgerCell } from "./ledger.js";

const eur = (n) => `${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")} €`;
const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const round2 = (n) => Math.round(n * 100) / 100;
function fmtDate(iso) {
  if (!iso) return "sem data";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
const signed = (v) => (v === 0 ? "0,00 €" : `${v > 0 ? "+" : "−"}${eur(Math.abs(v))}`);
const balClass = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "zero");

/* A minha situação numa compra.
   - fui eu que paguei: quanto falta receber e quanto está «por confirmar»
   - sou participante: a minha parte e se está por pagar / por confirmar / saldada */
function myStatus(pu, me) {
  const parts = pu.participants || [];
  if (pu.payerId === me) {
    let toReceive = 0, pending = 0;
    parts.forEach((mid) => {
      if (mid === me || pu.settled?.[mid]) return;
      const a = shareOf(pu, mid);
      if (a <= 0) return;
      if (pu.claimed?.[mid]) pending += a; else toReceive += a;
    });
    toReceive = round2(toReceive); pending = round2(pending);
    return { role: "payer", toReceive, pending, done: toReceive === 0 && pending === 0 };
  }
  const share = shareOf(pu, me);
  const settled = share <= 0 || !!pu.settled?.[me];
  const claimed = !settled && !!pu.claimed?.[me];
  return { role: "debtor", share, settled, claimed, done: settled };
}

export default function MinhasContasTab({ members, events, eventPurchases, myMember, onOpenEvent, onOpenVacation }) {
  const [vd, setVd] = useState(null);          // {vacations, purchases} das férias
  const [vacErr, setVacErr] = useState(false);
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState("all"); // all | event | vacation | event:<id> | vacation:<id>
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [hideDone, setHideDone] = useState(true);
  const [pair, setPair] = useState(null);      // id do membro aberto em detalhe
  const [detail, setDetail] = useState(null);  // key da compra aberta em detalhe

  useEffect(() => {
    feriasApi.loadAccounts().then(setVd).catch((e) => { console.error(e); setVacErr(true); setVd({ vacations: [], purchases: [] }); });
  }, []);

  const me = myMember?.id || null;
  const nm = (id) => members.find((m) => m.id === id)?.name || "?";

  /* todas as compras em que entro (como credor ou participante), com a origem anexada */
  const mine = useMemo(() => {
    if (!me || !vd) return [];
    const out = [];
    (eventPurchases || []).forEach((pu) => {
      if (pu.payerId !== me && !(pu.participants || []).includes(me)) return;
      const ev = events.find((e) => e.id === pu.eventId);
      out.push({ ...pu, key: `event:${pu.id}`, src: "event", srcId: pu.eventId, srcName: ev?.name || "Evento apagado", date: ev?.dateStart || null });
    });
    vd.purchases.forEach((pu) => {
      if (pu.payerId !== me && !(pu.participants || []).includes(me)) return;
      const vac = vd.vacations.find((v) => v.id === pu.vacationId);
      out.push({ ...pu, key: `vacation:${pu.id}`, src: "vacation", srcId: pu.vacationId, srcName: vac?.name || "Férias apagadas", date: vac?.dateStart || null });
    });
    return out
      .map((pu) => ({ ...pu, st: myStatus(pu, me) }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.description.localeCompare(b.description));
  }, [me, vd, eventPurchases, events]);

  /* origens onde tenho contas, para o filtro */
  const origins = useMemo(() => {
    const seen = new Map();
    mine.forEach((pu) => { if (!seen.has(`${pu.src}:${pu.srcId}`)) seen.set(`${pu.src}:${pu.srcId}`, pu); });
    const list = [...seen.values()];
    return {
      events: list.filter((x) => x.src === "event"),
      vacations: list.filter((x) => x.src === "vacation"),
    };
  }, [mine]);

  /* filtros de origem, data e pesquisa — mexem nas contas E nos saldos */
  const scoped = useMemo(() => {
    const nq = norm(q);
    return mine.filter((pu) => {
      if (origin === "event" || origin === "vacation") { if (pu.src !== origin) return false; }
      else if (origin !== "all" && `${pu.src}:${pu.srcId}` !== origin) return false;
      if (dateFrom && (!pu.date || pu.date < dateFrom)) return false;
      if (dateTo && (!pu.date || pu.date > dateTo)) return false;
      if (nq && !norm(pu.description).includes(nq) && !norm(pu.srcName).includes(nq)) return false;
      return true;
    });
  }, [mine, q, origin, dateFrom, dateTo]);
  const listed = hideDone ? scoped.filter((pu) => !pu.st.done) : scoped;

  /* saldo com cada pessoa (dívidas dos dois sentidos abatidas) */
  const ledger = useMemo(() => buildLedger(scoped), [scoped]);
  const rows = useMemo(() => {
    if (!me) return [];
    const ids = new Set();
    [ledger.owe, ledger.pend].forEach((bag) => {
      Object.keys(bag[me] || {}).forEach((id) => ids.add(id));
      Object.keys(bag).forEach((d) => { if (bag[d][me]) ids.add(d); });
    });
    ids.delete(me);
    return [...ids].map((id) => {
      const iOwe = ledgerCell(ledger.owe, me, id).total;
      const owesMe = ledgerCell(ledger.owe, id, me).total;
      const pending = round2(ledgerCell(ledger.pend, me, id).total + ledgerCell(ledger.pend, id, me).total);
      return { id, name: nm(id), iOwe, owesMe, balance: round2(owesMe - iOwe), pending };
    }).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  }, [ledger, me, members]);
  const toReceive = round2(rows.reduce((acc, r) => acc + Math.max(0, r.balance), 0));
  const toPay = round2(rows.reduce((acc, r) => acc + Math.max(0, -r.balance), 0));
  const pendingTotal = round2(rows.reduce((acc, r) => acc + r.pending, 0));

  const filtersOn = q || origin !== "all" || dateFrom || dateTo;
  const clearFilters = () => { setQ(""); setOrigin("all"); setDateFrom(""); setDateTo(""); };
  const openDetail = mine.find((pu) => pu.key === detail) || null;

  return (
    <section>
      <ContasStyle />
      <div className="section-head"><h2>As Minhas Contas</h2></div>

      {!myMember ? (
        <p className="hint">Entra com a tua conta de membro para veres as tuas contas dos eventos e das férias.</p>
      ) : !vd ? (
        <p className="hint">A carregar…</p>
      ) : (
        <>
          {vacErr && <p className="hint">Não foi possível carregar as contas das férias — por agora só aparecem as dos eventos.</p>}

          <div className="mc-kpis">
            <div className="mc-kpi pos"><span>A receber</span><b>{eur(toReceive)}</b></div>
            <div className="mc-kpi neg"><span>A pagar</span><b>{eur(toPay)}</b></div>
            {pendingTotal > 0 && <div className="mc-kpi claim"><span>Por confirmar</span><b>{eur(pendingTotal)}</b></div>}
          </div>

          <div className="mc-filters">
            <input className="mc-search" type="search" placeholder="Pesquisar conta, evento ou férias…"
              value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
              <option value="all">Eventos e férias</option>
              <option value="event">Só eventos</option>
              <option value="vacation">Só férias</option>
              {origins.vacations.length > 0 && (
                <optgroup label="Férias">
                  {origins.vacations.map((x) => <option key={x.srcId} value={`vacation:${x.srcId}`}>{x.srcName}</option>)}
                </optgroup>
              )}
              {origins.events.length > 0 && (
                <optgroup label="Eventos">
                  {origins.events.map((x) => <option key={x.srcId} value={`event:${x.srcId}`}>{x.srcName}{x.date ? ` (${fmtDate(x.date)})` : ""}</option>)}
                </optgroup>
              )}
            </select>
            <label className="mc-date" title="Data do evento ou do início das férias">De
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
            <label className="mc-date">a
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
            {filtersOn && <button className="btn ghost small" onClick={clearFilters}>Limpar filtros</button>}
          </div>

          <h3 className="mc-h">Saldo com cada pessoa</h3>
          {rows.length === 0 ? (
            <p className="empty">{filtersOn ? "Nada por acertar com estes filtros." : "Estás quite com toda a gente. 🔥"}</p>
          ) : (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Já com as dívidas dos dois sentidos abatidas. Verde = têm de te pagar, vermelho = tens de pagar.
                Os pagamentos «por confirmar» não entram nas somas. Clica numa linha para veres as contas.
              </p>
              <div className="mc-table-wrap">
                <table className="mc-table">
                  <thead>
                    <tr><th>Pessoa</th><th className="num mc-col-detail">Eu devo</th><th className="num mc-col-detail">Devem-me</th><th className="num">Saldo</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="clickable" onClick={() => setPair(r.id)}>
                        <td>
                          <b>{r.name}</b>
                          {r.pending > 0 && <span className="mc-pend-tag" title="Pagamentos marcados como feitos, à espera de confirmação">{eur(r.pending)} por confirmar</span>}
                        </td>
                        <td className="num mc-col-detail">{r.iOwe ? eur(r.iOwe) : "—"}</td>
                        <td className="num mc-col-detail">{r.owesMe ? eur(r.owesMe) : "—"}</td>
                        <td className={`num bal ${balClass(r.balance)}`}>{signed(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="mc-list-head">
            <h3 className="mc-h">As tuas contas ({listed.length})</h3>
            <label className="mc-check">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
              Ocultar saldadas
            </label>
          </div>
          {listed.length === 0 ? (
            <p className="empty">
              {mine.length === 0 ? "Ainda não entras em nenhuma conta."
                : hideDone && scoped.length ? "Tudo saldado por aqui. Desmarca «Ocultar saldadas» para veres o histórico."
                : "Nenhuma conta corresponde aos filtros."}
            </p>
          ) : (
            <div className="mc-list">
              {listed.map((pu) => (
                <button key={pu.key} className={`mc-row ${pu.st.done ? "done" : ""}`} onClick={() => setDetail(pu.key)}>
                  <div className="mc-row-main">
                    <strong>{pu.description}</strong>
                    <span className="mc-origin">
                      <span className={`mc-kind ${pu.src}`}>{pu.src === "event" ? "Evento" : "Férias"}</span>
                      {pu.srcName}{pu.date ? ` · ${fmtDate(pu.date)}` : ""}
                    </span>
                  </div>
                  <div className="mc-row-side">
                    <StatusLine st={pu.st} payerName={nm(pu.payerId)} />
                    <span className="mc-total">total {eur(pu.total)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {pair && (
        <PairModal ledger={ledger} me={me} otherId={pair} nm={nm}
          onOpen={(key) => { setPair(null); setDetail(key); }} onClose={() => setPair(null)} />
      )}
      {openDetail && (
        <AccountModal pu={openDetail} me={me} nm={nm}
          onGo={() => {
            setDetail(null);
            if (openDetail.src === "event") onOpenEvent(openDetail.srcId, openDetail.id);
            else onOpenVacation(openDetail.srcId, openDetail.id);
          }}
          onClose={() => setDetail(null)} />
      )}
    </section>
  );
}

function StatusLine({ st, payerName }) {
  if (st.role === "payer") {
    if (st.done) return <span className="mc-st done">pagaste · tudo recebido</span>;
    return (
      <span className="mc-st pos">
        {st.toReceive > 0 && <>falta receber <b>{eur(st.toReceive)}</b></>}
        {st.toReceive > 0 && st.pending > 0 && " · "}
        {st.pending > 0 && <span className="mc-claim">{eur(st.pending)} por confirmar</span>}
      </span>
    );
  }
  if (st.settled) return <span className="mc-st done">{st.share > 0 ? `a tua parte ${eur(st.share)} · saldada` : "sem parte tua"}</span>;
  if (st.claimed) return <span className="mc-st"><span className="mc-claim">pagaste {eur(st.share)} a {payerName} · por confirmar</span></span>;
  return <span className="mc-st neg">deves <b>{eur(st.share)}</b> a {payerName}</span>;
}

function McModal({ title, onClose, children }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="iconbtn" onClick={onClose} title="Fechar">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Eu e outra pessoa: as contas dos dois sentidos ---------- */
function PairModal({ ledger, me, otherId, nm, onOpen, onClose }) {
  const iOwe = ledgerCell(ledger.owe, me, otherId);
  const owesMe = ledgerCell(ledger.owe, otherId, me);
  const pendOut = ledgerCell(ledger.pend, me, otherId);
  const pendIn = ledgerCell(ledger.pend, otherId, me);
  const net = round2(owesMe.total - iOwe.total);
  const name = nm(otherId);

  const block = (title, cell) => !cell.items.length ? null : (
    <>
      <h4>{title} — {eur(cell.total)}</h4>
      <div className="mini-list">
        {cell.items.map(({ pu, amount }, i) => (
          <button key={`${pu.key}-${i}`} className="mini-item" onClick={() => onOpen(pu.key)} title="Ver esta conta">
            <span>{pu.description}<span className="mini-date"> · {pu.src === "event" ? "evento" : "férias"} {pu.srcName}</span></span>
            <b className="mc-amount">{eur(amount)}</b>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <McModal title={`Tu e ${name}`} onClose={onClose}>
      <p className="net-summary" style={{ marginTop: 0 }}>
        {net > 0 ? <><b>{name}</b> deve-te <b className="mc-pos">{eur(net)}</b></>
          : net < 0 ? <>Deves <b className="mc-neg">{eur(-net)}</b> a <b>{name}</b></>
          : <>Estão quites — as dívidas dos dois lados anulam-se.</>}
      </p>
      {block(`Deves a ${name}`, iOwe)}
      {block(`${name} deve-te`, owesMe)}
      {(pendOut.items.length > 0 || pendIn.items.length > 0) && (
        <>
          <h4>Já pagos, à espera de confirmação</h4>
          <p className="hint" style={{ marginTop: 0 }}>Não entram nas somas acima. Quem recebeu confirma no evento ou nas férias de origem.</p>
          {block(`Pagaste a ${name}`, pendOut)}
          {block(`${name} pagou-te`, pendIn)}
        </>
      )}
    </McModal>
  );
}

/* ---------- Detalhe de uma conta (só leitura) ---------- */
function AccountModal({ pu, me, nm, onGo, onClose }) {
  const parts = pu.participants || [];
  const isSet = (mid) => mid === pu.payerId || !!pu.settled?.[mid];
  const settledSum = Math.min(pu.total, round2(parts.filter(isSet).reduce((acc, mid) => acc + shareOf(pu, mid), 0)));
  const pct = pu.total > 0 ? Math.min(100, Math.round((settledSum / pu.total) * 100)) : 0;
  const label = (id) => (id === me ? "Tu" : nm(id));
  return (
    <McModal title={pu.description} onClose={onClose}>
      <p className="mc-origin" style={{ marginTop: 0 }}>
        <span className={`mc-kind ${pu.src}`}>{pu.src === "event" ? "Evento" : "Férias"}</span>
        {pu.srcName}{pu.date ? ` · ${fmtDate(pu.date)}` : ""}
      </p>
      <div className="mc-detail-grid">
        <div><span>Total</span><b>{eur(pu.total)}</b></div>
        <div><span>Pagou</span><b>{label(pu.payerId)}</b></div>
        <div><span>Divisão</span><b>{pu.split === "custom" ? (pu.parcels?.length ? "Por parcelas" : "Valores individuais") : `${eur(shareOf(pu, parts[0]))} por pessoa`}</b></div>
        <div><span>Saldado</span><b>{eur(settledSum)} de {eur(pu.total)}</b></div>
      </div>
      <div className="mc-progress" title={`${pct}% saldado`}><i style={{ width: `${pct}%` }} /></div>
      <p className="net-summary"><StatusLine st={pu.st} payerName={nm(pu.payerId)} /></p>

      {pu.parcels?.length > 0 && (
        <>
          <h4>Parcelas</h4>
          <div className="mini-list">
            {pu.parcels.map((pc, i) => (
              <div key={pc.id || i} className="mini-item static">
                <span>{pc.name || "Parcela"}<span className="mini-date"> · {(pc.members || []).map(label).join(", ") || "por atribuir"}</span></span>
                <b className="mc-amount">{eur(pc.price)}</b>
              </div>
            ))}
          </div>
        </>
      )}

      <h4>Participantes</h4>
      <div className="pill-row">
        {parts.map((mid) => {
          const done = isSet(mid);
          const claimed = !done && !!pu.claimed?.[mid];
          return (
            <span key={mid} className={`pill ${done ? "on" : claimed ? "claim" : ""}`}>
              {label(mid)}{mid === pu.payerId ? " · pagou" : done ? " · saldado" : claimed ? " · pagou? por confirmar" : ` · deve ${eur(shareOf(pu, mid))}`}
            </span>
          );
        })}
      </div>

      <p className="hint">Para marcar «já paguei», confirmar ou editar, abre a conta no sítio de origem.</p>
      <div className="actions">
        <button className="btn ember" onClick={onGo}>{pu.src === "event" ? "Abrir no evento" : "Abrir nas férias"}</button>
      </div>
    </McModal>
  );
}

function ContasStyle() {
  return (
    <style>{`
      .mc-kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
      .mc-kpi { flex: 1 1 150px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; }
      .mc-kpi span { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
      .mc-kpi b { font-size: 20px; font-variant-numeric: tabular-nums; }
      .mc-kpi.pos b { color: #7BD389; }
      .mc-kpi.neg b { color: #FF6B5C; }
      .mc-kpi.claim { border-style: dashed; border-color: var(--gold); }
      .mc-kpi.claim b { color: var(--gold); }

      .mc-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 18px; }
      .mc-filters select, .mc-filters input { padding: 7px 10px; }
      .mc-search { flex: 1 1 220px; min-width: 0; }
      .mc-filters .mc-date { display: flex; flex-direction: row; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); margin: 0; }
      .mc-filters .mc-date input { width: auto; margin: 0; }

      .mc-h { margin: 6px 0 10px; font-size: 15px; }
      .mc-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin-bottom: 20px;
        border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
      .mc-table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
      .mc-table th, .mc-table td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
      .mc-table thead th { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); font-weight: 600; }
      .mc-table tbody tr:last-child td { border-bottom: none; }
      .mc-table .num { text-align: right; font-variant-numeric: tabular-nums; }
      .mc-table .bal { font-weight: 700; }
      .mc-table .bal.pos, .mc-pos { color: #7BD389; }
      .mc-table .bal.neg, .mc-neg { color: #FF6B5C; }
      .mc-table .bal.zero { color: var(--text); }
      .mc-table tr.clickable { cursor: pointer; }
      .mc-table tr.clickable:hover td { background: var(--surface2); }
      .mc-pend-tag { display: inline-block; margin-left: 8px; font-size: 11px; padding: 1px 7px; border-radius: 999px;
        border: 1px dashed var(--gold); color: var(--gold); white-space: nowrap; }

      .mc-list-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .mc-list-head .mc-check { display: flex; flex-direction: row; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); margin: 0; cursor: pointer; }
      .mc-check input { width: auto; margin: 0; }
      .mc-list { display: flex; flex-direction: column; gap: 8px; }
      .mc-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%;
        background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px;
        color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: border-color .15s; }
      .mc-row:hover { border-color: var(--ember); }
      .mc-row.done { opacity: .6; }
      .mc-row-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .mc-row-main strong { overflow-wrap: anywhere; }
      .mc-row-side { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; text-align: right; flex-shrink: 0; }
      .mc-origin { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); }
      .mc-kind { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: rgba(255,255,255,.07); color: var(--text); }
      .mc-kind.vacation { background: rgba(245,184,65,.14); color: var(--gold); }
      .mc-kind.event { background: rgba(255,122,61,.14); color: var(--ember); }
      .mc-total { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
      .mc-st { font-size: 13px; }
      .mc-st.pos { color: #7BD389; }
      .mc-st.neg { color: #FF6B5C; }
      .mc-st.done { color: var(--muted); }
      .mc-claim { color: var(--gold); }
      .mc-amount { white-space: nowrap; margin-left: 10px; }

      .mc-detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 12px 0; }
      .mc-detail-grid div { display: flex; flex-direction: column; gap: 3px; background: var(--surface2); border-radius: 8px; padding: 9px 11px; }
      .mc-detail-grid span { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
      .mc-progress { height: 6px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; }
      .mc-progress i { display: block; height: 100%; background: linear-gradient(90deg, var(--ember), var(--gold)); }

      @media (max-width: 640px) {
        .mc-col-detail { display: none; }
        .mc-kpis { gap: 6px; }
        .mc-kpi { flex: 1 1 0; min-width: 0; padding: 9px 10px; }
        .mc-kpi span { font-size: 10px; letter-spacing: .06em; }
        .mc-kpi b { font-size: 15px; }
        .mc-row { flex-direction: column; align-items: stretch; }
        .mc-row-side { align-items: flex-start; text-align: left; }
        .mc-filters select { flex: 1 1 100%; }
        .mc-filters .mc-date { flex: 1 1 40%; min-width: 0; }
        .mc-filters .mc-date input { flex: 1; min-width: 0; }
        .mc-pend-tag { margin-left: 0; margin-top: 4px; display: block; width: fit-content; }
      }
    `}</style>
  );
}
