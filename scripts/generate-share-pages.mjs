/* Gera páginas estáticas de partilha (OG tags para Discord/WhatsApp) em dist/share/<id>.html
   Corre no workflow de deploy, depois do build. */
import { mkdirSync, writeFileSync } from "node:fs";

const SB = "https://noperkfdcdairrpnomrs.supabase.co";
const KEY = "sb_publishable_9IyQdSmI1GviEx83KqtCvw_gxMd-cnl";
const SITE = "https://grill1385.github.io/grill-hub/";

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

const r = await fetch(`${SB}/rest/v1/events?select=*`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
if (!r.ok) { console.error("Erro Supabase:", r.status); process.exit(1); }
const events = await r.json();

mkdirSync("dist/share", { recursive: true });
const hoje = new Date().toISOString().slice(0, 10);

for (const ev of events) {
  const target = `${SITE}?event=${encodeURIComponent(ev.id)}`;
  const concluido = ev.status === "Concluído" || String(ev.date_end ?? ev.date_start) < hoje;
  const conf = Object.values(ev.confirmations ?? {}).filter(Boolean).length;
  const pres = Object.values(ev.presences ?? {}).filter(Boolean).length;
  const title = `🔥 ${ev.name} — ${fmt(ev.date_start)}${ev.date_end ? " até " + fmt(ev.date_end) : ""}`;
  const counts = concluido ? `${pres} presenças` : `${conf} confirmado(s) — entra e confirma a tua presença!`;
  const descr = [ev.location, ev.description, counts].filter(Boolean).join(" · ");
  const html = `<!doctype html>
<html lang="pt"><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:site_name" content="GrillHub">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(descr)}">
<meta property="og:image" content="${SITE}og-banner.png">
<meta property="og:url" content="${esc(target)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FF7A3D">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head><body>A redirecionar para o GrillHub…</body></html>`;
  writeFileSync(`dist/share/${ev.id}.html`, html);
}
writeFileSync("dist/share/index.html", `<!doctype html><meta http-equiv="refresh" content="0;url=${SITE}">`);
console.log(`${events.length} páginas de partilha geradas.`);
