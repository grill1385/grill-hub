// GrillHub — Edge Function: avisar membros de um evento por email
// Deploy: painel Supabase → Edge Functions → nova função "notify-event" (colar este código)
// Secret necessário: BREVO_API_KEY (e opcionalmente SENDER_EMAIL)

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { eventId } = await req.json();
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    // só admins podem disparar avisos
    const { data: isAdmin } = await sb.rpc("is_admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Apenas admins." }), { status: 403, headers: cors });
    }

    const { data: ev } = await sb.from("events").select("*").eq("id", eventId).single();
    if (!ev) return new Response(JSON.stringify({ error: "Evento não encontrado." }), { status: 404, headers: cors });

    const { data: members } = await sb.from("members").select("*");
    const dest = (members ?? []).filter((m: { email?: string }) => m.email);

    const fmt = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
    const quando = fmt(ev.date_start) + (ev.date_end ? ` até ${fmt(ev.date_end)}` : "");
    const local = ev.location
      ? `<p>📍 ${ev.location}${ev.location_url ? ` — <a href="${ev.location_url}">mapa</a>` : ""}</p>` : "";
    const SITE = "https://grill1385.github.io/grill-hub/";
    const BREVO = Deno.env.get("BREVO_API_KEY")!;
    const SENDER = Deno.env.get("SENDER_EMAIL") ?? "filipesalazar95@gmail.com";

    let sent = 0;
    for (const m of dest) {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": BREVO, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { name: "GrillHub", email: SENDER },
          to: [{ email: m.email, name: m.name }],
          subject: `🔥 Novo evento no GrillHub: ${ev.name} (${fmt(ev.date_start)})`,
          htmlContent: `
            <div style="font-family:sans-serif;max-width:520px">
              <h2 style="color:#E85D1F">🔥 ${ev.name}</h2>
              <p>Olá ${m.name}! Há um novo evento marcado para <b>${quando}</b>.</p>
              ${ev.description ? `<p>${ev.description}</p>` : ""}
              ${local}
              <p><b>Vais?</b> Entra no GrillHub e confirma (ou não) a tua presença:</p>
              <p><a href="${SITE}" style="background:#E85D1F;color:#1A0F08;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Confirmar presença →</a></p>
            </div>`,
        }),
      });
      if (r.ok) sent++;
    }
    return new Response(JSON.stringify({ sent, total: dest.length }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
