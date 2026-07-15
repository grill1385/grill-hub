/* Lembretes de eventos — corre diariamente via GitHub Actions.
   Envia email 3 dias antes de cada evento "Agendado", mas SÓ aos
   membros que ainda não confirmaram presença.
   Lê as tabelas events/members do Supabase. */

const SB = "https://noperkfdcdairrpnomrs.supabase.co";
const SB_KEY = "sb_publishable_9IyQdSmI1GviEx83KqtCvw_gxMd-cnl";
const BREVO_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || "grillfeup@gmail.com";
const SITE = "https://grill1385.github.io/grill-hub/";
const DIAS_ANTES = 3;

if (!BREVO_KEY) { console.error("BREVO_API_KEY em falta"); process.exit(1); }

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const fmtDate = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

const targetDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" })
  .format(new Date(Date.now() + DIAS_ANTES * 86400000));

async function get(url) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) { console.error("Erro Supabase:", r.status, await r.text()); process.exit(1); }
  return r.json();
}

const events = await get(`${SB}/rest/v1/events?select=*&date_start=eq.${targetDate}&status=eq.Agendado`);
const members = (await get(`${SB}/rest/v1/members?select=*`)).filter((m) => m.email);

console.log(`Data alvo: ${targetDate} | eventos: ${events.length} | membros com email: ${members.length}`);
if (!events.length || !members.length) { console.log("Nada a enviar."); process.exit(0); }

let enviados = 0;
for (const ev of events) {
  const quando = fmtDate(ev.date_start) + (ev.date_end ? ` até ${fmtDate(ev.date_end)}` : "");
  const local = ev.location ? `<p>📍 ${ev.location}${ev.location_url ? ` — <a href="${ev.location_url}">mapa</a>` : ""}</p>` : "";
  for (const m of members) {
    if (ev.confirmations?.[m.id]) continue; // já confirmou — não precisa de lembrete
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Presenças do Grill", email: SENDER_EMAIL },
        to: [{ email: m.email, name: m.name }],
        subject: `🔥 ${ev.name} — faltam ${DIAS_ANTES} dias (${fmtDate(ev.date_start)})`,
        htmlContent: `
          <div style="font-family:sans-serif;max-width:520px">
            <h2 style="color:#E85D1F">🔥 ${ev.name}</h2>
            <p>Olá ${m.name}! O evento está agendado para <b>${quando}</b> e ainda não confirmaste presença.</p>
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
