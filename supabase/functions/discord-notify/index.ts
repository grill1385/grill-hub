// GrillHub — Edge Function: enviar mensagens para o Discord (bot "GrillHub")
// Deploy: painel Supabase → Edge Functions → nova função "discord-notify" (colar este código)
// Secrets necessarios:
//   DISCORD_BOT_TOKEN       -> token do bot (Developer Portal → Bot → Reset Token)
//   DISCORD_CHANNEL_ID      -> ID do canal geral onde as mensagens sao enviadas
//   DISCORD_SHAME_CHANNEL_ID (opcional) -> canal proprio para as vergonhas; se faltar usa o geral
//
// Tipos de mensagem (campo "kind"):
//   { kind: "shame",   memberId }   -> menciona o membro e envergonha-o
//   { kind: "event",   eventId }    -> anuncia um evento e faz ping a todos com Discord ligado
//   { kind: "payment", purchaseId } -> lembra quem tem uma compra por saldar
//   { kind: "custom",  text, memberIds? } -> mensagem livre (mencionando memberIds, opcional)

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DISCORD_API = "https://discord.com/api/v10";
const eur = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")} €`;
const fmt = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const mention = (id: string) => `<@${id}>`;

// share (quota) de um participante numa compra — mesma logica dos lembretes por email
function shareOf(pu: any, mid: string) {
  const parts = pu.participants || [];
  if (pu.split === "custom") return Math.round((Number(pu.shares?.[mid]) || 0) * 100) / 100;
  return parts.length ? Math.round((Number(pu.total) / parts.length) * 100) / 100 : 0;
}

async function sendToDiscord(channelId: string, content: string, userIds: string[]) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) throw new Error("DISCORD_BOT_TOKEN em falta nos secrets.");
  const r = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      // so mencionamos (ping) os utilizadores que listamos explicitamente
      allowed_mentions: { parse: [], users: [...new Set(userIds)] },
    }),
  });
  if (!r.ok) throw new Error(`Discord ${r.status}: ${await r.text()}`);
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const kind = body?.kind as string;

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    // so admins podem disparar mensagens
    const { data: isAdmin } = await sb.rpc("is_admin");
    if (!isAdmin) return json({ error: "Apenas admins." }, 403);

    const GENERAL = Deno.env.get("DISCORD_CHANNEL_ID");
    if (!GENERAL) return json({ error: "DISCORD_CHANNEL_ID em falta nos secrets." }, 500);
    const SHAME = Deno.env.get("DISCORD_SHAME_CHANNEL_ID") || GENERAL;
    const SITE = "https://grill1385.github.io/grill-hub/";

    if (kind === "shame") {
      const { data: m } = await sb.from("members").select("*").eq("id", body.memberId).single();
      if (!m) return json({ error: "Membro nao encontrado." }, 404);
      if (!m.discord_id) return json({ error: `${m.name} ainda nao ligou o Discord.` }, 400);
      const content =
        `🔥😳 **VERGONHA** 😳🔥\n${mention(m.discord_id)} foi oficialmente **ENVERGONHADO(A)** pelo Grill!\n` +
        `Que este momento fique registado para a posteridade. 🐔`;
      await sendToDiscord(SHAME, content, [m.discord_id]);
      return json({ ok: true });
    }

    if (kind === "event") {
      const { data: ev } = await sb.from("events").select("*").eq("id", body.eventId).single();
      if (!ev) return json({ error: "Evento nao encontrado." }, 404);
      const { data: members } = await sb.from("members").select("*");
      const pingIds = (members ?? []).filter((m: any) => m.discord_id).map((m: any) => m.discord_id);
      const quando = fmt(ev.date_start) + (ev.date_end ? ` até ${fmt(ev.date_end)}` : "");
      const linhas = [
        `📣🔥 **NOVO EVENTO NO GRILL** 🔥📣`,
        `**${ev.name}**`,
        `🗓️ ${quando}`,
        ev.location ? `📍 ${ev.location}${ev.location_url ? ` — <${ev.location_url}>` : ""}` : "",
        ev.description ? `\n${ev.description}` : "",
        `\n${pingIds.map(mention).join(" ")}`,
        `\nConfirma a tua presença 👉 ${SITE}`,
      ].filter(Boolean);
      await sendToDiscord(GENERAL, linhas.join("\n"), pingIds);
      return json({ ok: true, pinged: pingIds.length });
    }

    if (kind === "payment") {
      const { data: pu } = await sb.from("purchases").select("*").eq("id", body.purchaseId).single();
      if (!pu) return json({ error: "Compra nao encontrada." }, 404);
      const { data: members } = await sb.from("members").select("*");
      const mem: Record<string, any> = Object.fromEntries((members ?? []).map((m: any) => [m.id, m]));
      const { data: ev } = await sb.from("events").select("name").eq("id", pu.event_id).single();
      const payer = mem[pu.payer_member_id];
      const parts: string[] = pu.participants || [];
      const devedores = parts.filter((mid) => mid !== pu.payer_member_id && !pu.settled?.[mid] && shareOf(pu, mid) > 0);
      if (!devedores.length) return json({ error: "Ninguem tem esta compra por saldar." }, 400);
      const semDiscord = devedores.filter((mid) => !mem[mid]?.discord_id).map((mid) => mem[mid]?.name);
      const pingIds = devedores.filter((mid) => mem[mid]?.discord_id).map((mid) => mem[mid].discord_id);
      const linhasDev = devedores.map((mid) => {
        const who = mem[mid]?.discord_id ? mention(mem[mid].discord_id) : `**${mem[mid]?.name || "?"}**`;
        return `• ${who} — ${eur(shareOf(pu, mid))}`;
      });
      const content = [
        `💸🔥 **CONTAS POR SALDAR** 🔥💸`,
        `${ev?.name ? `**${ev.name}** — ` : ""}${pu.description}`,
        `Pagar a **${payer?.name || "?"}**:`,
        ...linhasDev,
        `\nAcertem contas no GrillHub 👉 ${SITE}`,
      ].join("\n");
      await sendToDiscord(GENERAL, content, pingIds);
      return json({ ok: true, pinged: pingIds.length, semDiscord });
    }

    if (kind === "custom") {
      const text = String(body.text || "").trim();
      if (!text) return json({ error: "Mensagem vazia." }, 400);
      const ids: string[] = [];
      if (Array.isArray(body.memberIds) && body.memberIds.length) {
        const { data: members } = await sb.from("members").select("id,discord_id").in("id", body.memberIds);
        for (const m of members ?? []) if (m.discord_id) ids.push(m.discord_id);
      }
      const prefix = ids.length ? ids.map(mention).join(" ") + "\n" : "";
      await sendToDiscord(GENERAL, prefix + text, ids);
      return json({ ok: true, pinged: ids.length });
    }

    return json({ error: `Tipo de mensagem desconhecido: ${kind}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
