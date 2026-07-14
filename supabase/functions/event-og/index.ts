// GrillHub — Edge Function: pré-visualização de eventos para Discord/WhatsApp/etc.
// Deploy: painel Supabase → Edge Functions → nova função "event-og"
// IMPORTANTE: desativar "Verify JWT" nas definições da função (o crawler do Discord não tem autenticação)

const SITE = "https://grill1385.github.io/grill-hub/";

const esc = (t: unknown) =>
  String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const SB = Deno.env.get("SUPABASE_URL")!;
  const KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  let ev: Record<string, unknown> | null = null;
  if (id) {
    const r = await fetch(`${SB}/rest/v1/events?id=eq.${encodeURIComponent(id)}&select=*`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (r.ok) ev = (await r.json())[0] ?? null;
  }

  const target = ev ? `${SITE}?event=${encodeURIComponent(id)}` : SITE;
  const fmt = (iso?: string) => (iso ? iso.split("-").reverse().join("/") : "");
  const hoje = new Date().toISOString().slice(0, 10);
  const concluido = ev && (ev.status === "Concluído" || String(ev.date_end ?? ev.date_start) < hoje);
  const conf = ev ? Object.values((ev.confirmations as Record<string, boolean>) ?? {}).filter(Boolean).length : 0;
  const pres = ev ? Object.values((ev.presences as Record<string, boolean>) ?? {}).filter(Boolean).length : 0;

  const title = ev
    ? `🔥 ${ev.name} — ${fmt(ev.date_start as string)}${ev.date_end ? " até " + fmt(ev.date_end as string) : ""}`
    : "GrillHub";
  const counts = ev ? (concluido ? `${pres} presenças` : `${conf} confirmado(s) — entra e confirma a tua presença!`) : "";
  const descr = ev
    ? [ev.location, ev.description, counts].filter(Boolean).join(" · ")
    : "Eventos, presenças e contas do GRILL";

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

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
});
