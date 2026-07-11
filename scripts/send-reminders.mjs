/* Lembretes de eventos — corre diariamente via GitHub Actions.
   Envia email aos membros 3 dias antes de cada evento "Agendado". */

const SB = "https://noperkfdcdairrpnomrs.supabase.co";
const SB_KEY = "sb_publishable_9IyQdSmI1GviEx83KqtCvw_gxMd-cnl";
const BREVO_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || "filipesalazar95@gmail.com";
const SITE = "https://grill1385.github.io/grill-hub/";
const DIAS_ANTES = 3;

if (!BREVO_KEY) { console.error("BREVO_API_KEY em falta"); process.exit(1); }

const fmtDate = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

// data (YYYY-MM-DD) em Lisboa, daqui a N dias
const targetDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" })
  .format(new Date(Date.now() + DIAS_ANTES * 86400000));

const res = await fetch(`${SB}/rest/v1/kv?key=eq.grill%3Adata&select=value`, {
  headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
});
if (!res.ok) { console.error("Erro Supabase:", res.status); process.exit(1); }
const rows = await res.json();
if (!rows.length) { console.log("Sem dados na kv."); process.exit(0); }

const data = JSON.parse(rows[0].value);
const events = (data.events || []).filter(
  (e) => e.dateStart === targetDate && ["Agendado", "Planeado"].includes(e.status)
);
const members = (data.members || []).filter((m) => m.email);

console.log(`Data alvo: ${targetDate} | eventos: ${events.length} | membros com email: ${members.length}`);
if (!events.length || !members.length) { console.log("Nada a enviar."); process.exit(0); }

let enviados = 0;
for (const ev of events) {
  const quando = fmtDate(ev.dateStart) + (ev.dateEnd ? ` até ${fmtDate(ev.dateEnd)}` : "");
  const local = ev.location ? `<p>📍 ${ev.location}${ev.locationUrl ? ` — <a href="${ev.locationUrl}">mapa</a>` : ""}</p>` : "";
  for (const m of members) {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Presenças do Grill", email: SENDER_EMAIL },
        to: [{ email: m.email, name: m.name }],
        subject: `🔥 ${ev.name} — faltam ${DIAS_ANTES} dias (${fmtDate(ev.dateStart)})`,
        htmlContent: `
          <div style="font-family:sans-serif;max-width:520px">
            <h2 style="color:#E85D1F">🔥 ${ev.name}</h2>
            <p>Olá ${m.name}! O evento está agendado para <b>${quando}</b>.</p>
            ${ev.description ? `<p>${ev.description}</p>` : ""}
            ${local}
            <p><a href="${SITE}" style="color:#E85D1F">Ver no Presenças do Grill →</a></p>
          </div>`,
      }),
    });
    if (r.ok) { enviados++; } else { console.error(`Falha para ${m.email}:`, r.status, await r.text()); }
  }
}
console.log(`Emails enviados: ${enviados}`);
