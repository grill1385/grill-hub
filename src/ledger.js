/* ============================================================
   LIVRO-RAZÃO DAS CONTAS (partilhado por Eventos, Férias e «As Minhas Contas")
   Só cálculos — não lê nem escreve na base de dados.
   ============================================================ */

/* parte de um membro numa compra (divisão por todos, valores individuais ou parcelas) */
export const shareOf = (pu, mid) => {
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

/* Quem deve a quem, compra a compra — serve para compras de eventos e de férias.
   `owe` = dívidas por saldar; `pend` = já marcadas "já paguei" à espera de
   confirmação do credor (não entram nas somas, mostram-se à parte). */
export function buildLedger(purchases) {
  const owe = {}, pend = {};
  const add = (bag, debtor, creditor, pu, amount) => {
    bag[debtor] = bag[debtor] || {};
    const cell = (bag[debtor][creditor] = bag[debtor][creditor] || { total: 0, items: [] });
    cell.total = Math.round((cell.total + amount) * 100) / 100;
    cell.items.push({ pu, amount });
  };
  (purchases || []).forEach((pu) => {
    const payer = pu.payerId;
    if (!payer) return;
    (pu.participants || []).forEach((mid) => {
      if (mid === payer || pu.settled?.[mid]) return;
      const a = shareOf(pu, mid);
      if (a <= 0) return;
      add(pu.claimed?.[mid] ? pend : owe, mid, payer, pu, a);
    });
  });
  return { owe, pend };
}

export const ledgerCell = (bag, debtor, creditor) => bag?.[debtor]?.[creditor] || { total: 0, items: [] };

/* líquido que `debtor` ainda deve a `creditor` depois de abater o sentido contrário
   (ex.: A deve 1 a B e B deve 2 a A → A→B = 0 e B→A = 1) */
export const ledgerNet = (owe, debtor, creditor) =>
  Math.round((ledgerCell(owe, debtor, creditor).total - ledgerCell(owe, creditor, debtor).total) * 100) / 100;
