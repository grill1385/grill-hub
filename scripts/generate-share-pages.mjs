/* Gera páginas estáticas de partilha + banners OG por evento em dist/share/
   Corre no workflow de deploy, depois do build. */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import sharp from "sharp";

const SB = "https://noperkfdcdairrpnomrs.supabase.co";
const KEY = "sb_publishable_9IyQdSmI1GviEx83KqtCvw_gxMd-cnl";
const SITE = "https://grill1385.github.io/grill-hub/";

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

// partir o nome em até 2 linhas
function wrap(text, max) {
  const words = String(text).split(/\s+/);
  const lines = [""];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur + " " + w).trim().length <= max) lines[lines.length - 1] = (cur + " " + w).trim();
    else lines.push(w);
  }
  if (lines.length > 2) {
    lines[1] = lines.slice(1).join(" ");
    lines.length = 2;
    if (lines[1].length > max) lines[1] = lines[1].slice(0, max - 1) + "…";
  }
  return lines;
}

const logoInner = readFileSync("public/logo.svg", "utf-8").match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];

function bannerSVG(ev, concluido, conf, pres) {
  const nome = String(ev.name);
  const big = nome.length <= 26;
  const fontSize = big ? 78 : 58;
  const maxChars = big ? 26 : 36;
  const lines = wrap(nome, maxChars);
  const quando = fmt(ev.date_start) + (ev.date_end ? `  ·  até ${fmt(ev.date_end)}` : "");
  const rodape = concluido ? `${pres} presenças` : (conf > 0 ? `${conf} já confirmaram — junta-te!` : "Confirma a tua presença no GrillHub");
  const y0 = lines.length > 1 ? 290 : 330;
  const quandoY = y0 + (lines.length - 1) * (fontSize + 12) + 64;
  const locY = quandoY + 56;
  const nameText = lines.map((l, i) =>
    `<text x="90" y="${y0 + i * (fontSize + 12)}" font-family="Lato, Arial, sans-serif" font-weight="900" font-size="${fontSize}" fill="#F0E9DF">${esc(l)}</text>`
  ).join("");
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#17130F"/>
  <radialGradient id="glow" cx="0.85" cy="0.05" r="1"><stop offset="0" stop-color="#FF7A3D" stop-opacity="0.16"/><stop offset="0.6" stop-color="#17130F" stop-opacity="0"/></radialGradient>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g transform="translate(88,72) scale(1.05)">${logoInner}</g>
  <text x="215" y="140" font-family="Lato, Arial, sans-serif" font-weight="900" font-size="52" fill="#F0E9DF" letter-spacing="2">GRILL<tspan fill="#FF7A3D">HUB</tspan></text>
  ${nameText}
  <text x="90" y="${quandoY}" font-family="Lato, Arial, sans-serif" font-weight="700" font-size="42" fill="#F5B841">${esc(quando)}</text>
  ${ev.location ? `<g transform="translate(90,${locY - 26}) scale(1.4)" fill="none" stroke="#9C9184" stroke-width="1.8"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></g><text x="132" y="${locY}" font-family="Lato, Arial, sans-serif" font-size="32" fill="#9C9184">${esc(ev.location)}</text>` : ""}
  <text x="90" y="${586}" font-family="Lato, Arial, sans-serif" font-size="28" fill="#FF7A3D" font-weight="700">${esc(rodape)}</text>
  <rect x="90" y="600" width="380" height="6" rx="3" fill="#FF7A3D"/>
</svg>`;
}

const r = await fetch(`${SB}/rest/v1/events?select=*`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
if (!r.ok) { console.error("Erro Supabase:", r.status); process.exit(1); }
const events = await r.json();

mkdirSync("dist/share/og", { recursive: true });
const hoje = new Date().toISOString().slice(0, 10);

for (const ev of events) {
  const target = `${SITE}?event=${encodeURIComponent(ev.id)}`;
  const concluido = ev.status === "Concluído" || String(ev.date_end ?? ev.date_start) < hoje;
  const conf = Object.values(ev.confirmations ?? {}).filter(Boolean).length;
  const pres = Object.values(ev.presences ?? {}).filter(Boolean).length;
  const title = `🔥 ${ev.name} — ${fmt(ev.date_start)}${ev.date_end ? " até " + fmt(ev.date_end) : ""}`;
  const counts = concluido ? `${pres} presenças` : `${conf} confirmado(s) — entra e confirma a tua presença!`;
  const descr = [ev.location, ev.description, counts].filter(Boolean).join(" · ");

  await sharp(Buffer.from(bannerSVG(ev, concluido, conf, pres))).png().toFile(`dist/share/og/${ev.id}.png`);

  const html = `<!doctype html>
<html lang="pt"><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:site_name" content="GrillHub">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(descr)}">
<meta property="og:image" content="${SITE}share/og/${encodeURIComponent(ev.id)}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(target)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FF7A3D">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head><body>A redirecionar para o GrillHub…</body></html>`;
  writeFileSync(`dist/share/${ev.id}.html`, html);
}
writeFileSync("dist/share/index.html", `<!doctype html><meta http-equiv="refresh" content="0;url=${SITE}">`);
console.log(`${events.length} páginas + banners gerados.`);
