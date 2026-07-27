// GrillHub — Edge Function: enviar desejo de parabéns por email
// Deploy: painel Supabase → Edge Functions → nova função "birthday-wish" (colar este código)
// Secret necessário: BREVO_API_KEY (e opcionalmente SENDER_EMAIL)
// Autorização: o remetente do desejo (from_member_id) tem de ser o membro autenticado.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const esc = (t: string) =>
  String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { wishId } = await req.json();
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    const { data: mid } = await sb.rpc("my_member_id");
    if (!mid) return new Response(JSON.stringify({ error: "Sem membro associado à conta." }), { status: 403, headers: cors });

    const { data: wish } = await sb.from("birthday_wishes").select("*").eq("id", wishId).single();
    if (!wish) return new Response(JSON.stringify({ error: "Desejo não encontrado." }), { status: 404, headers: cors });
    if (wish.from_member_id !== mid) {
      return new Response(JSON.stringify({ error: "Só podes enviar por email os teus próprios desejos." }), { status: 403, headers: cors });
    }

    const { data: members } = await sb.from("members").select("*").in("id", [wish.member_id, wish.from_member_id]);
    const dest = (members ?? []).find((m: { id: string }) => m.id === wish.member_id);
    const sender = (members ?? []).find((m: { id: string }) => m.id === wish.from_member_id);
    if (!dest?.email) return new Response(JSON.stringify({ error: "O aniversariante não tem email registado." }), { status: 400, headers: cors });

    const SITE = "https://grill1385.github.io/grill-hub/";
    const BREVO = Deno.env.get("BREVO_API_KEY")!;
    const SENDER = Deno.env.get("SENDER_EMAIL") ?? "grillfeup@gmail.com";
    const msgHtml = wish.message ? `<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #E85D1F;background:#FFF6EF">${esc(wish.message).replace(/\n/g, "<br>")}</blockquote>` : "";

    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "GrillHub", email: SENDER },
        to: [{ email: dest.email, name: dest.name }],
        subject: `🎂 ${sender?.name ?? "Alguém do Grill"} deseja-te parabéns!`,
        htmlContent: `
          <div style="font-family:sans-serif;max-width:520px">
            <h2 style="color:#E85D1F">🎂🎉 Feliz aniversário, ${esc(dest.name)}!</h2>
            <p><b>${esc(sender?.name ?? "?")}</b> deseja-te parabéns${wish.message ? ":" : "! 🎈"}</p>
            ${msgHtml}
            <p><a href="${SITE}" style="background:#E85D1F;color:#1A0F08;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Ver no GrillHub →</a></p>
          </div>`,
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error(`Brevo falhou: ${r.status} ${detail}`);
      return new Response(JSON.stringify({ error: `Brevo: ${r.status}` }), { status: 502, headers: cors });
    }

    await sb.from("birthday_wishes").update({ emailed_at: new Date().toISOString() }).eq("id", wishId);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
