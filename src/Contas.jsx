import React, { useEffect, useMemo, useState } from "react";

/* ============================================================
   AS MINHAS CONTAS
   Junta, para o membro com sessão iniciada, as contas dos eventos
   (`purchases`) e das férias (`vacation_purchases`).
   Leituras: tudo. Escritas: só por RPC cirúrgica (contasApi) —
   arquivar contas saldadas e recibos (pagar várias contas de uma vez).
   Pagar/confirmar uma conta avulsa e editar continuam na origem.
   ============================================================ */
import { feriasApi, contasApi, isMissingRpc } from "./api.js";
import { shareOf, buildLedger, ledgerCell, isFullySettled } from "./ledger.js";

const eur = (n) => `${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")} €`;
const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const round2 = (n) => Math.round(n * 100) / 100;
function fmtDate(iso) {
  if (!iso) return "sem data";
  /* timestamps (recibos) vêm em UTC — mostra o dia na hora local */
  if (iso.length > 10) return new Date(iso).toLocaleDateString("pt-PT");
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
const signed = (v) => (v === 0 ? "0,00 €" : `${v > 0 ? "+" : "−"}${eur(Math.abs(v))}`);
const balClass = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "zero");
const itemKey = (origin, purchaseId, memberId) => `${origin}:${purchaseId}:${memberId}`;
const OPEN = ["aberto", "pago"];
const STATUS_LABEL = { aberto: "por pagar", pago: "pago, por confirmar", confirmado: "confirmado", cancelado: "cancelado" };

/* A minha situação numa compra.
   - fui eu que paguei: quanto falta receber e quanto está «por confirmar»
   - sou participante: a minha parte e se está por pagar / por confirmar / saldada
   `paidReceiptOf(pu, mid)` devolve o recibo com estado «pago» onde está essa linha (ou null):
   essas linhas contam como «por confirmar», incluindo as abatidas, que não têm claimed. */
function myStatus(pu, me, paidReceiptOf) {
  const parts = pu.participants || [];
  if (pu.payerId === me) {
    let toReceive = 0, pending = 0;
    parts.forEach((mid) => {
      if (mid === me || pu.settled?.[mid]) return;
      const a = shareOf(pu, mid);
      if (a <= 0) return;
      if (pu.claimed?.[mid] || paidReceiptOf?.(pu, mid)) pending += a; else toReceive += a;
    });
    toReceive = round2(toReceive); pending = round2(pending);
    return { role: "payer", toReceive, pending, done: toReceive === 0 && pending === 0 };
  }
  const share = shareOf(pu, me);
  const settled = share <= 0 || !!pu.settled?.[me];
  const rec = settled ? null : paidReceiptOf?.(pu, me);
  const claimed = !settled && (!!pu.claimed?.[me] || !!rec);
  /* abatida = a minha parte entra «a abater» num recibo pago por outra pessoa a mim */
  const offset = !!rec && rec.fromId !== me && !pu.claimed?.[me];
  return { role: "debtor", share, settled, claimed, offset, done: settled };
}

export default function MinhasContasTab({ members, events, eventPurchases, myMember, isAdmin, showToast, onChanged,
  receipts = [], receiptItems = [], archiveReady, receiptsReady, directReady, onOpenEvent, onOpenVacation }) {
  const [vd, setVd] = useState(null);          // {vacations, purchases} das férias
  const [vacErr, setVacErr] = useState(false);
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState("all"); // all | event | vacation | event:<id> | vacation:<id>
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [hideDone, setHideDone] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pair, setPair] = useState(null);      // id do membro aberto em detalhe
  const [detail, setDetail] = useState(null);  // key da compra aberta em detalhe
  const [receiptOpen, setReceiptOpen] = useState(null); // id do recibo aberto
  const [newReceipt, setNewReceipt] = useState(null);   // id da pessoa para quem se está a criar um recibo
  const [settleFrom, setSettleFrom] = useState(null);   // id da pessoa que «já me pagou tudo»
  const [busy, setBusy] = useState(false);

  const loadVac = () => feriasApi.loadAccounts().then(setVd)
    .catch((e) => { console.error(e); setVacErr(true); setVd((d) => d || { vacations: [], purchases: [] }); });
  useEffect(() => { loadVac(); }, []);

  const me = myMember?.id || null;
  const nm = (id) => members.find((m) => m.id === id)?.name || "?";

  /* em que recibo está cada linha (o mais recente que não esteja cancelado) */
  const receiptOfLine = useMemo(() => {
    const byId = new Map(receipts.filter((r) => r.status !== "cancelado").map((r) => [r.id, r]));
    const map = new Map();
    receiptItems.forEach((it) => {
      const r = byId.get(it.receiptId);
      if (!r) return;
      const k = itemKey(it.origin, it.purchaseId, it.memberId);
      /* uma linha pode ter recibos antigos confirmados e um em aberto — mostra o mais recente */
      if (!map.has(k) || (map.get(k).createdAt || "") < (r.createdAt || "")) map.set(k, r);
    });
    return map;
  }, [receipts, receiptItems]);
  const inOpenReceipt = (pu, memberId) => OPEN.includes(receiptOfLine.get(itemKey(pu.src, pu.id, memberId))?.status);
  /* recibo «pago» (à espera do credor) onde está a linha — nos dois sentidos: as linhas de quem
     pagou têm claimed, mas as abatidas não; ambas contam como «por confirmar» até à confirmação */
  const paidReceiptOf = useMemo(() => (pu, memberId) => {
    const r = receiptOfLine.get(itemKey(pu.src, pu.id, memberId));
    return r?.status === "pago" ? r : null;
  }, [receiptOfLine]);

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
      .map((pu) => ({ ...pu, st: myStatus(pu, me, paidReceiptOf) }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.description.localeCompare(b.description));
  }, [me, vd, eventPurchases, events, paidReceiptOf]);
  const byKey = useMemo(() => new Map(mine.map((pu) => [pu.key, pu])), [mine]);

  /* recibos: os meus (a pagar ou a receber) e em que recibo está cada linha */
  const myReceipts = useMemo(
    () => (me ? receipts.filter((r) => r.fromId === me || r.toId === me)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")) : []),
    [receipts, me]
  );
  const itemsOf = (rid) => receiptItems.filter((it) => it.receiptId === rid);

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
  /* arquivadas e saldadas só saem da lista — nos saldos valem 0 de qualquer forma */
  const listed = scoped.filter((pu) => (showArchived || !pu.archived) && (!hideDone || !pu.st.done || (showArchived && pu.archived)));
  const archivedCount = scoped.filter((pu) => pu.archived).length;
  const canArchive = (pu) => !!archiveReady && !pu.archived && isFullySettled(pu) && (isAdmin || pu.payerId === me);
  const toArchive = scoped.filter((pu) => canArchive(pu) && pu.payerId === me);

  /* saldo com cada pessoa (dívidas dos dois sentidos abatidas) */
  const ledger = useMemo(() => buildLedger(scoped, paidReceiptOf), [scoped, paidReceiptOf]);
  /* os recibos usam sempre TODAS as contas entre os dois, ignorando os filtros */
  const fullLedger = useMemo(() => buildLedger(mine, paidReceiptOf), [mine, paidReceiptOf]);
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

  /* o que entraria num recibo meu para `otherId`: o que lhe devo + o que me deve (a abater),
     sem linhas já presas noutro recibo em aberto */
  const receiptDraft = (otherId) => {
    const lines = (cell, debtor) => cell.items
      .filter(({ pu }) => !inOpenReceipt(pu, debtor))
      .map(({ pu, amount }) => ({ pu, amount, origin: pu.src, purchaseId: pu.id, memberId: debtor }));
    const pay = lines(ledgerCell(fullLedger.owe, me, otherId), me);
    const offset = lines(ledgerCell(fullLedger.owe, otherId, me), otherId);
    const total = round2(pay.reduce((a, x) => a + x.amount, 0) - offset.reduce((a, x) => a + x.amount, 0));
    const open = myReceipts.find((r) => r.fromId === me && r.toId === otherId && OPEN.includes(r.status)) || null;
    return { pay, offset, total, open };
  };

  /* «Já me pagou tudo»: o que `otherId` me deve (por saldar ou «por confirmar»)
     menos o que eu lhe devo — tudo fica saldado de uma vez, validado por mim (credor) */
  const settleDraft = (otherId) => {
    const lines = (cell, debtor) => cell.items
      .filter(({ pu }) => !inOpenReceipt(pu, debtor))
      .map(({ pu, amount }) => ({ pu, amount, origin: pu.src, purchaseId: pu.id, memberId: debtor }));
    const paid = [...lines(ledgerCell(fullLedger.owe, otherId, me), otherId), ...lines(ledgerCell(fullLedger.pend, otherId, me), otherId)];
    const offset = lines(ledgerCell(fullLedger.owe, me, otherId), me);
    const total = round2(paid.reduce((a, x) => a + x.amount, 0) - offset.reduce((a, x) => a + x.amount, 0));
    const open = myReceipts.find((r) => r.fromId === otherId && r.toId === me && OPEN.includes(r.status)) || null;
    return { paid, offset, total, open };
  };

  async function run(action, okMsg) {
    setBusy(true);
    try {
      const out = await action();
      await Promise.all([onChanged?.(), loadVac()]);
      if (okMsg) showToast?.(typeof okMsg === "function" ? okMsg(out) : okMsg);
      return out;
    } catch (e) {
      console.error(e);
      if (isMissingRpc(e)) showToast?.("Esta função ainda não está ativa no Supabase (falta correr a migração das contas).");
      else showToast?.(e?.message ? `Não foi possível: ${e.message}` : "Não foi possível concluir.");
      return null;
    } finally { setBusy(false); }
  }

  const createReceipt = async (otherId) => {
    const d = receiptDraft(otherId);
    const rid = await run(() => contasApi.createReceipt(otherId, [...d.pay, ...d.offset]), (id) => `Recibo ${id} criado.`);
    if (rid) { setNewReceipt(null); setPair(null); setReceiptOpen(rid); }
  };
  const settleAll = async (otherId) => {
    const d = settleDraft(otherId);
    const rid = await run(() => contasApi.settleAllFrom(otherId, [...d.paid, ...d.offset]),
      (id) => `Contas com ${nm(otherId)} saldadas — registado como ${id}.`);
    if (rid) { setSettleFrom(null); setReceiptOpen(rid); }
  };
  const archiveMany = async (list, value) => {
    await run(async () => { for (const pu of list) await contasApi.setArchived(pu.src, pu.id, value); },
      value ? (list.length > 1 ? `${list.length} contas arquivadas.` : "Conta arquivada.") : "Conta desarquivada.");
  };

  const filtersOn = q || origin !== "all" || dateFrom || dateTo;
  const clearFilters = () => { setQ(""); setOrigin("all"); setDateFrom(""); setDateTo(""); };
  const openDetail = mine.find((pu) => pu.key === detail) || null;
  const activeReceipts = myReceipts.filter((r) => OPEN.includes(r.status));
  const pastReceipts = myReceipts.filter((r) => !OPEN.includes(r.status));
  const openReceipt = myReceipts.find((r) => r.id === receiptOpen) || null;

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

          {activeReceipts.length > 0 && (
            <div className="mc-receipts">
              {activeReceipts.map((r) => (
                <ReceiptCard key={r.id} r={r} me={me} nm={nm} onOpen={() => setReceiptOpen(r.id)} />
              ))}
            </div>
          )}

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
                Os pagamentos «por confirmar» não entram nas somas. Clica numa linha para veres as contas
                {toPay > 0 ? " — e, se deves, para pagar tudo de uma vez com um recibo" : ""}.
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
            <div className="mc-list-opts">
              <label className="mc-check">
                <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
                Ocultar saldadas
              </label>
              {archivedCount > 0 && (
                <label className="mc-check">
                  <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                  Ver arquivadas ({archivedCount})
                </label>
              )}
            </div>
          </div>
          {toArchive.length > 0 && (
            <p className="hint mc-archive-hint">
              Tens {toArchive.length} conta{toArchive.length === 1 ? "" : "s"} que pagaste já saldada{toArchive.length === 1 ? "" : "s"}.{" "}
              <button className="btn ghost small" disabled={busy} onClick={() => {
                if (window.confirm(`Arquivar ${toArchive.length} conta${toArchive.length === 1 ? "" : "s"} saldada${toArchive.length === 1 ? "" : "s"}? Não muda nenhum valor — continuam visíveis em «Ver arquivadas».`)) archiveMany(toArchive, true);
              }}>Arquivar {toArchive.length === 1 ? "essa" : `as ${toArchive.length}`}</button>
            </p>
          )}
          {listed.length === 0 ? (
            <p className="empty">
              {mine.length === 0 ? "Ainda não entras em nenhuma conta."
                : hideDone && scoped.length ? "Tudo saldado por aqui. Desmarca «Ocultar saldadas» para veres o histórico."
                : "Nenhuma conta corresponde aos filtros."}
            </p>
          ) : (
            <div className="mc-list">
              {listed.map((pu) => {
                /* a minha parte desta conta está (ou esteve) num recibo? */
                const rec = pu.st.role === "debtor" ? receiptOfLine.get(itemKey(pu.src, pu.id, me)) : null;
                return (
                  <button key={pu.key} className={`mc-row ${pu.st.done ? "done" : ""} ${pu.archived ? "archived" : ""}`} onClick={() => setDetail(pu.key)}>
                    <div className="mc-row-main">
                      <strong>{pu.description}</strong>
                      <span className="mc-origin">
                        <span className={`mc-kind ${pu.src}`}>{pu.src === "event" ? "Evento" : "Férias"}</span>
                        {pu.srcName}{pu.date ? ` · ${fmtDate(pu.date)}` : ""}
                        {pu.archived && <span className="mc-tag">arquivada</span>}
                        {rec && <span className="mc-tag">recibo {rec.id}</span>}
                      </span>
                    </div>
                    <div className="mc-row-side">
                      <StatusLine st={pu.st} payerName={nm(pu.payerId)} />
                      <span className="mc-total">total {eur(pu.total)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {pastReceipts.length > 0 && (
            <div className="mc-history">
              <button className="btn ghost small" onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? "Esconder" : "Ver"} recibos anteriores ({pastReceipts.length})
              </button>
              {showHistory && (
                <div className="mc-receipts" style={{ marginTop: 10 }}>
                  {pastReceipts.map((r) => (
                    <ReceiptCard key={r.id} r={r} me={me} nm={nm} onOpen={() => setReceiptOpen(r.id)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {pair && (
        <PairModal ledger={ledger} me={me} otherId={pair} nm={nm} filtersOn={!!filtersOn} receiptsReady={!!receiptsReady}
          draft={receiptDraft(pair)} settle={directReady ? settleDraft(pair) : null}
          onSettleAll={() => { setSettleFrom(pair); setPair(null); }}
          onNewReceipt={() => { setNewReceipt(pair); setPair(null); }}
          onOpenReceipt={(id) => { setPair(null); setReceiptOpen(id); }}
          onOpen={(key) => { setPair(null); setDetail(key); }} onClose={() => setPair(null)} />
      )}
      {settleFrom && (
        <SettleAllModal draft={settleDraft(settleFrom)} otherName={nm(settleFrom)} busy={busy}
          onConfirm={() => settleAll(settleFrom)} onClose={() => setSettleFrom(null)} />
      )}
      {newReceipt && (
        <NewReceiptModal draft={receiptDraft(newReceipt)} otherName={nm(newReceipt)} busy={busy}
          onCreate={() => createReceipt(newReceipt)} onClose={() => setNewReceipt(null)} />
      )}
      {openReceipt && (
        <ReceiptModal r={openReceipt} items={itemsOf(openReceipt.id)} me={me} nm={nm} byKey={byKey} busy={busy}
          onPay={() => run(() => contasApi.payReceipt(openReceipt.id), "Marcado como pago — falta a outra pessoa confirmar.")}
          onConfirm={() => run(() => contasApi.confirmReceipt(openReceipt.id), "Recibo confirmado — contas saldadas.")}
          onReopen={() => run(() => contasApi.reopenReceipt(openReceipt.id), "Recibo reaberto.")}
          onCancel={() => run(() => contasApi.cancelReceipt(openReceipt.id), "Recibo cancelado.")}
          onOpenAccount={(key) => { setReceiptOpen(null); setDetail(key); }}
          onClose={() => setReceiptOpen(null)} />
      )}
      {openDetail && (
        <AccountModal pu={openDetail} me={me} nm={nm} receiptOfLine={receiptOfLine} busy={busy}
          canArchive={canArchive(openDetail)} canUnarchive={!!archiveReady && openDetail.archived && (isAdmin || openDetail.payerId === me)}
          onArchive={(value) => archiveMany([openDetail], value)}
          onOpenReceipt={(id) => { setDetail(null); setReceiptOpen(id); }}
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
  if (st.offset) return <span className="mc-st"><span className="mc-claim">a tua parte {eur(st.share)} abatida no recibo · por confirmar</span></span>;
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

/* ---------- Cartão de recibo (lista no topo e histórico) ---------- */
function ReceiptCard({ r, me, nm, onOpen }) {
  const iPay = r.fromId === me;
  const other = nm(iPay ? r.toId : r.fromId);
  let text, cls = "";
  if (r.status === "aberto") {
    text = iPay ? <>Tens de pagar <b>{eur(r.total)}</b> a <b>{other}</b> — usa <b>{r.id}</b> no descritivo e depois marca como pago</>
      : <><b>{other}</b> criou um recibo de <b>{eur(r.total)}</b> para ti — ainda não pagou</>;
    cls = iPay ? "todo" : "";
  } else if (r.status === "pago") {
    text = iPay ? <>Pagaste <b>{eur(r.total)}</b> a <b>{other}</b> — à espera que confirme</>
      : <><b>{other}</b> diz que te pagou <b>{eur(r.total)}</b> — confirma se recebeste</>;
    cls = iPay ? "wait" : "todo";
  } else {
    text = <>{iPay ? `Para ${other}` : `De ${other}`} · <b>{eur(r.total)}</b> · {r.kind === "direto" ? "pago fora do GrillHub" : STATUS_LABEL[r.status]}</>;
    cls = "past";
  }
  return (
    <button className={`mc-receipt ${cls}`} onClick={onOpen}>
      <span className="mc-receipt-id">{r.id}</span>
      <span className="mc-receipt-text">{text}</span>
      <span className="mc-receipt-go">ver →</span>
    </button>
  );
}

/* ---------- Eu e outra pessoa: as contas dos dois sentidos ---------- */
function PairModal({ ledger, me, otherId, nm, filtersOn, receiptsReady, draft, settle, onSettleAll, onNewReceipt, onOpenReceipt, onOpen, onClose }) {
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
        {filtersOn && <><br /><span className="mc-muted">(só as contas que passam nos filtros)</span></>}
      </p>

      {!receiptsReady ? null : draft.open ? (
        <div className="mc-receipt-cta">
          <span>Já tens o recibo <b>{draft.open.id}</b> para {name} ({STATUS_LABEL[draft.open.status]}).</span>
          <button className="btn ghost small" onClick={() => onOpenReceipt(draft.open.id)}>Ver recibo</button>
        </div>
      ) : draft.total > 0 && draft.pay.length > 0 ? (
        <div className="mc-receipt-cta">
          <span>Paga tudo o que deves a {name} de uma vez: <b>{eur(draft.total)}</b>{draft.offset.length > 0 ? " (já com o que te deve abatido)" : ""}.</span>
          <button className="btn ember small" onClick={onNewReceipt}>Criar recibo</button>
        </div>
      ) : null}

      {!settle ? null : settle.open ? (
        <div className="mc-receipt-cta">
          <span>{name} tem o recibo <b>{settle.open.id}</b> para ti ({STATUS_LABEL[settle.open.status]}) — valida-o aí.</span>
          <button className="btn ghost small" onClick={() => onOpenReceipt(settle.open.id)}>Ver recibo</button>
        </div>
      ) : settle.total > 0 && settle.paid.length > 0 ? (
        <div className="mc-receipt-cta settle">
          <span>{name} já te pagou tudo por fora (MB Way, dinheiro…)? Valida de uma vez: <b>{eur(settle.total)}</b>{settle.offset.length > 0 ? " (já com o que lhe devias abatido)" : ""}.</span>
          <button className="btn ember small" onClick={onSettleAll}>Já me pagou tudo</button>
        </div>
      ) : null}

      {block(`Deves a ${name}`, iOwe)}
      {block(`${name} deve-te`, owesMe)}
      {(pendOut.items.length > 0 || pendIn.items.length > 0) && (
        <>
          <h4>À espera de confirmação</h4>
          <p className="hint" style={{ marginTop: 0 }}>
            Não entram nas somas acima: «já paguei» por confirmar e linhas de recibos pagos (incluindo as abatidas).
            Quem recebeu confirma no recibo, no evento ou nas férias de origem.
          </p>
          {block(`Da tua parte para ${name}`, pendOut)}
          {block(`Da parte de ${name} para ti`, pendIn)}
        </>
      )}
    </McModal>
  );
}

/* ---------- Pré-visualizar e criar um recibo ---------- */
function ReceiptLines({ title, lines, sign }) {
  if (!lines.length) return null;
  return (
    <>
      <h4>{title}</h4>
      <div className="mini-list">
        {lines.map((l, i) => (
          <div key={i} className="mini-item static">
            <span>{l.pu?.description || "Compra"}<span className="mini-date"> · {l.pu ? `${l.pu.src === "event" ? "evento" : "férias"} ${l.pu.srcName}` : ""}</span></span>
            <b className="mc-amount">{sign}{eur(l.amount)}</b>
          </div>
        ))}
      </div>
    </>
  );
}

function NewReceiptModal({ draft, otherName, busy, onCreate, onClose }) {
  return (
    <McModal title={`Novo recibo para ${otherName}`} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        Junta num só pagamento tudo o que deves a {otherName} e ainda não pagaste{draft.offset.length ? `, já abatido do que ${otherName} te deve` : ""}.
        Depois de criar, recebes um ID curto para pôr no descritivo do MB Way / Revolut.
      </p>
      <ReceiptLines title="O que pagas" lines={draft.pay} sign="" />
      <ReceiptLines title={`A abater (${otherName} deve-te)`} lines={draft.offset} sign="−" />
      <p className="net-summary">Total a pagar: <b className="mc-neg">{eur(draft.total)}</b></p>
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn ember" disabled={busy || draft.total <= 0} onClick={onCreate}>Criar recibo</button>
      </div>
    </McModal>
  );
}

/* ---------- «Já me pagou tudo»: pré-visualizar e validar ---------- */
function SettleAllModal({ draft, otherName, busy, onConfirm, onClose }) {
  return (
    <McModal title={`${otherName} já te pagou tudo`} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        Para quando {otherName} te pagou por fora, sem recibo no GrillHub. Todas estas contas ficam saldadas de uma vez
        {draft.offset.length ? `, incluindo o que devias a ${otherName} (abatido no valor)` : ""}. Fica registado no teu
        histórico de recibos como «pago fora do GrillHub».
      </p>
      <ReceiptLines title={`O que ${otherName} te devia`} lines={draft.paid} sign="" />
      <ReceiptLines title={`Abatido (o que devias a ${otherName})`} lines={draft.offset} sign="−" />
      <p className="net-summary">Valor que {otherName} te pagou: <b className="mc-pos">{eur(draft.total)}</b></p>
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn ember" disabled={busy || draft.total <= 0}
          onClick={() => { if (window.confirm(`Confirmas que recebeste ${eur(draft.total)} de ${otherName}? Estas contas ficam todas saldadas.`)) onConfirm(); }}>
          Confirmar que recebi {eur(draft.total)}
        </button>
      </div>
    </McModal>
  );
}

/* ---------- Detalhe de um recibo ---------- */
function ReceiptModal({ r, items, me, nm, byKey, busy, onPay, onConfirm, onReopen, onCancel, onOpenAccount, onClose }) {
  const iPay = r.fromId === me;
  const other = nm(iPay ? r.toId : r.fromId);
  const lineOf = (it) => ({ ...it, pu: byKey.get(`${it.origin}:${it.purchaseId}`) });
  const pay = items.filter((it) => it.memberId === r.fromId).map(lineOf);
  const offset = items.filter((it) => it.memberId === r.toId).map(lineOf);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try { navigator.clipboard.writeText(r.id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); } catch { /* sem clipboard */ }
  };
  const lines = (title, list, sign) => !list.length ? null : (
    <>
      <h4>{title}</h4>
      <div className="mini-list">
        {list.map((l, i) => (
          <button key={i} className="mini-item" disabled={!l.pu} onClick={() => l.pu && onOpenAccount(l.pu.key)}>
            <span>{l.pu?.description || "Compra (já não existe)"}<span className="mini-date">{l.pu ? ` · ${l.pu.src === "event" ? "evento" : "férias"} ${l.pu.srcName}` : ""}</span></span>
            <b className="mc-amount">{sign}{eur(l.amount)}</b>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <McModal title={`Recibo ${r.id}`} onClose={onClose}>
      <div className="mc-detail-grid" style={{ marginTop: 0 }}>
        <div><span>{iPay ? "Pagas a" : "Recebes de"}</span><b>{other}</b></div>
        <div><span>Total</span><b>{eur(r.total)}</b></div>
        <div><span>Estado</span><b className={`mc-rstatus ${r.status}`}>{STATUS_LABEL[r.status]}</b></div>
        <div><span>Criado</span><b>{fmtDate(r.createdAt)}</b></div>
      </div>

      {iPay && r.status === "aberto" && (
        <div className="mc-receipt-id-box">
          <span>Descritivo da transferência (MB Way / Revolut):</span>
          <b>{r.id}</b>
          <button className="btn ghost small" onClick={copy}>{copied ? "Copiado ✓" : "Copiar"}</button>
        </div>
      )}

      {lines(iPay ? "O que pagas" : `O que ${other} te paga`, pay, "")}
      {lines(iPay ? `A abater (${other} deve-te)` : `A abater (o que deves a ${other})`, offset, "−")}

      <p className="hint">
        {r.status === "aberto" && (iPay ? "Depois de transferires, marca como pago: todas estas contas passam a «por confirmar» de uma vez." : `Quando ${other} pagar e marcar o recibo como pago, recebes aqui o pedido para confirmar.`)}
        {r.status === "pago" && (iPay ? `${other} vai confirmar que recebeu — aí as contas ficam saldadas.` : "Confirma só depois de veres o dinheiro na conta. Todas estas contas ficam saldadas de uma vez.")}
        {r.status === "confirmado" && (r.kind === "direto"
          ? `Pago fora do GrillHub e validado por ${iPay ? other : "ti"} a ${fmtDate(r.confirmedAt)} — estas contas ficaram saldadas em conjunto.`
          : `Confirmado a ${fmtDate(r.confirmedAt)} — estas contas foram pagas em conjunto neste recibo.`)}
        {r.status === "cancelado" && "Recibo cancelado — as contas voltaram a ficar por pagar avulso."}
      </p>

      <div className="actions">
        {iPay && r.status === "aberto" && <>
          <button className="btn ghost" disabled={busy} onClick={() => { if (window.confirm("Cancelar este recibo? As contas voltam a ficar por pagar.")) onCancel(); }}>Cancelar recibo</button>
          <button className="btn ember" disabled={busy} onClick={() => { if (window.confirm(`Confirmas que já transferiste ${eur(r.total)} a ${other}?`)) onPay(); }}>Já paguei</button>
        </>}
        {iPay && r.status === "pago" && (
          <button className="btn ghost" disabled={busy} onClick={onReopen}>Afinal ainda não paguei</button>
        )}
        {!iPay && r.status === "pago" && <>
          <button className="btn ghost" disabled={busy} onClick={() => { if (window.confirm("Marcar como não recebido? O recibo volta a ficar por pagar.")) onReopen(); }}>Não recebi</button>
          <button className="btn ember" disabled={busy} onClick={() => { if (window.confirm(`Confirmas que recebeste ${eur(r.total)} de ${other}? As contas ficam saldadas.`)) onConfirm(); }}>Confirmar que recebi</button>
        </>}
      </div>
    </McModal>
  );
}

/* ---------- Detalhe de uma conta ---------- */
function AccountModal({ pu, me, nm, receiptOfLine, busy, canArchive, canUnarchive, onArchive, onOpenReceipt, onGo, onClose }) {
  const parts = pu.participants || [];
  const isSet = (mid) => mid === pu.payerId || !!pu.settled?.[mid];
  const settledSum = Math.min(pu.total, round2(parts.filter(isSet).reduce((acc, mid) => acc + shareOf(pu, mid), 0)));
  const pct = pu.total > 0 ? Math.min(100, Math.round((settledSum / pu.total) * 100)) : 0;
  const label = (id) => (id === me ? "Tu" : nm(id));
  const recs = parts.map((mid) => ({ mid, r: receiptOfLine.get(itemKey(pu.src, pu.id, mid)) })).filter((x) => x.r);
  return (
    <McModal title={pu.description} onClose={onClose}>
      <p className="mc-origin" style={{ marginTop: 0 }}>
        <span className={`mc-kind ${pu.src}`}>{pu.src === "event" ? "Evento" : "Férias"}</span>
        {pu.srcName}{pu.date ? ` · ${fmtDate(pu.date)}` : ""}
        {pu.archived && <span className="mc-tag">arquivada</span>}
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

      {recs.length > 0 && (
        <>
          <h4>Pago em recibo</h4>
          <div className="mini-list">
            {recs.map(({ mid, r }) => (
              <button key={mid} className="mini-item" onClick={() => onOpenReceipt(r.id)}>
                <span>{label(mid)}<span className="mini-date"> · recibo {r.id}</span></span>
                <b className="mc-amount">{r.kind === "direto" ? "pago fora do GrillHub" : STATUS_LABEL[r.status]}</b>
              </button>
            ))}
          </div>
        </>
      )}

      <p className="hint">Para marcar «já paguei», confirmar uma conta avulsa ou editar, abre a conta no sítio de origem.</p>
      <div className="actions">
        {canArchive && <button className="btn ghost" disabled={busy} onClick={() => onArchive(true)} title="Esconde a conta da lista — não muda nenhum valor">Arquivar</button>}
        {canUnarchive && <button className="btn ghost" disabled={busy} onClick={() => onArchive(false)}>Desarquivar</button>}
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
      .mc-muted { color: var(--muted); font-size: 12.5px; }
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
      .mc-list-opts { display: flex; gap: 14px; flex-wrap: wrap; }
      .mc-list-head .mc-check { display: flex; flex-direction: row; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); margin: 0; cursor: pointer; }
      .mc-check input { width: auto; margin: 0; }
      .mc-archive-hint { margin: 0 0 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .mc-list { display: flex; flex-direction: column; gap: 8px; }
      .mc-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: 100%;
        background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px;
        color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: border-color .15s; }
      .mc-row:hover { border-color: var(--ember); }
      .mc-row.done, .mc-row.archived { opacity: .6; }
      .mc-row-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .mc-row-main strong { overflow-wrap: anywhere; }
      .mc-row-side { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; text-align: right; flex-shrink: 0; }
      .mc-origin { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); }
      .mc-kind { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: rgba(255,255,255,.07); color: var(--text); }
      .mc-kind.vacation { background: rgba(245,184,65,.14); color: var(--gold); }
      .mc-kind.event { background: rgba(255,122,61,.14); color: var(--ember); }
      .mc-tag { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
      .mc-total { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
      .mc-st { font-size: 13px; }
      .mc-st.pos { color: #7BD389; }
      .mc-st.neg { color: #FF6B5C; }
      .mc-st.done { color: var(--muted); }
      .mc-claim { color: var(--gold); }
      .mc-amount { white-space: nowrap; margin-left: 10px; }

      .mc-receipts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
      .mc-receipt { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; font: inherit; color: var(--text);
        background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 11px 14px; cursor: pointer; }
      .mc-receipt:hover { border-color: var(--ember); }
      .mc-receipt.todo { border-color: var(--ember); background: linear-gradient(135deg, rgba(255,122,61,.12), rgba(245,184,65,.05)); }
      .mc-receipt.wait { border-style: dashed; border-color: var(--gold); }
      .mc-receipt.past { opacity: .7; }
      .mc-receipt-id { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; color: var(--gold); white-space: nowrap; }
      .mc-receipt-text { flex: 1; font-size: 13.5px; min-width: 0; }
      .mc-receipt-go { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
      .mc-receipt-cta { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
        border: 1px solid var(--ember); border-radius: 10px; padding: 10px 12px; margin: 10px 0; background: rgba(255,122,61,.07); font-size: 13.5px; }
      .mc-receipt-cta.settle { border-color: #7BD389; background: rgba(123,211,137,.07); }
      .mc-receipt-id-box { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 12px 0; padding: 10px 12px;
        border: 1px dashed var(--gold); border-radius: 10px; font-size: 13px; color: var(--muted); }
      .mc-receipt-id-box b { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 18px; color: var(--gold); letter-spacing: .06em; }
      .mc-rstatus.pago { color: var(--gold); }
      .mc-rstatus.confirmado { color: #7BD389; }
      .mc-rstatus.cancelado { color: var(--muted); }
      .mc-history { margin-top: 18px; }

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
        .mc-receipt { flex-wrap: wrap; gap: 6px 10px; }
        .mc-receipt-text { flex-basis: 100%; order: 3; }
      }
    `}</style>
  );
}
