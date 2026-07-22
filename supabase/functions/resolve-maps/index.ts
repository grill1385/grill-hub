// GrillHub — Edge Function: resolver links curtos do Google Maps
// (maps.app.goo.gl / goo.gl/maps) para obter coordenadas.
// Deploy: painel Supabase → Edge Functions → nova função "resolve-maps"
//         (colar este código). Não precisa de secrets.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

function findCoords(s: string): [number, number] | null {
  let m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = s.match(/[?&](?:q|query|ll|center|destination)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/i);
  if (m) return [Number(m[1]), Number(m[2])];
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { url } = await req.json();
    if (!url) return json({ error: "url em falta" }, 400);
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
    let body = "";
    try { body = await r.text(); } catch { /* ignore */ }
    const coords = findCoords(r.url) || findCoords(body);
    if (!coords) return json({ error: "sem coordenadas" }, 404);
    return json({ lat: coords[0], lng: coords[1], url: r.url });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
