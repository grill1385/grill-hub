/* Lembretes de contas por saldar — corre diariamente via GitHub Actions.
   Envia email 3 dias após o evento e depois semanalmente enquanto houver dívida. */

const SB = "https://noperkfdcdairrpnomrs.supabase.co";
const SB_KEY = "sb_publishable_9IyQdSmI1GviEx83KqtCvw_gxMd-cnl";
const BREVO_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || "filipesalazar95@gmail.com";
const SITE = "https://grill1385.github.io/grill-hub/";

if (!BREVO_KEY) { console.error("BREVO_API_KEY em falta"); process.exit(1); }

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const eur = (n) => `${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")} €`;
const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
const diasDesde = (iso) => Math.round((new Date(hoje) - new Date(iso)) / 86400000);

async function get(url) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) { console.error("Erro Supabase:", r.status, await r.text()); process.exit(1); }
  return r.json();
}

const [events, purchases, members] = await Promise.all([
  get(`${SB}/rest/v1/events?select=*`),
  get(`${SB}/rest/v1/purchases?select=*`),
  get(`${SB}/rest/v1/members?select=*`),
]);

const mem = Object.fromEntries(members.map((m) => [m.id, m]));
// dívidas por membro: [{eventName, desc, amount, payerName}]
const debts = {};
for (const pu of purchases) {
  const ev = events.find((e) => e.id === pu.event_id);
  if (!ev) continue;
  const fim = ev.date_end || ev.date_start;
  const d = diasDesde(fim);
  if (d < 3 || (d - 3) % 7 !== 0) continue; // 3 dias depois, e depois semanalmente
  const parts = pu.participants || [];
  if (!parts.length) continue;
  const share = Math.round((Number(pu.total) / parts.length) * 100) / 100;
  for (const mid of parts) {
    if (mid === pu.payer_member_id || pu.settled?.[mid]) continue;
    (debts[mid] = debts[mid] || []).push({
      eventName: ev.name, desc: pu.description, amount: share,
      payerName: mem[pu.payer_member_id]?.name || "?",
    });
  }
}

const devedores = Object.entries(debts).filter(([mid]) => mem[mid]?.email);
console.log(`Hoje: ${hoje} | membros com dívidas a notificar: ${devedores.length}`);
if (!devedores.length) { console.log("Nada a enviar."); process.exit(0); }

let enviados = 0;
for (const [mid, items] of devedores) {
  const m = mem[mid];
  const total = items.reduce((s, i) => s + i.amount, 0);
  const linhas = items.map((i) => `<li><b>${i.eventName}</b> — ${i.desc}: <b>${eur(i.amount)}</b> a pagar a <b>${i.payerName}</b></li>`).join("");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "GrillHub", email: SENDER_EMAIL },
      to: [{ email: m.email, name: m.name }],
      subject: `🔥 GrillHub — tens ${eur(total)} por saldar`,
      htmlContent: `
        <div style="font-family:sans-serif;max-width:520px">
          <h2 style="color:#E85D1F">🔥 Contas por saldar</h2>
          <p>Olá ${m.name}! Ainda tens contas por saldar no GrillHub:</p>
          <ul>${linhas}</ul>
          <p>Total: <b>${eur(total)}</b></p>
          <p><a href="${SITE}" style="color:#E85D1F">Ver detalhes no GrillHub →</a></p>
        </div>`,
    }),
  });
  if (r.ok) { enviados++; } else { console.error(`Falha para ${m.email}:`, r.status, await r.text()); }
}
console.log(`Emails enviados: ${enviados}`);
