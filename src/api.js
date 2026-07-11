/* ============================================================
   API — Presenças do Grill
   Dados em tabelas Supabase (members, events, roles, admins)
   com RLS: leitura pública, escrita apenas para admins
   autenticados via Supabase Auth (email+password ou Google).
   ============================================================ */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://noperkfdcdairrpnomrs.supabase.co";
const SUPABASE_KEY = "sb_publishable_9IyQdSmI1GviEx83KqtCvw_gxMd-cnl";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* conversão snake_case (BD) <-> camelCase (app) */
const toMember = (r) => ({
  id: r.id, name: r.name, email: r.email,
  birthDate: r.birth_date, joinDate: r.join_date, roleId: r.role_id,
  username: r.username, avatarUrl: r.avatar_url,
});
const fromMember = (m) => ({
  id: m.id, name: m.name, email: m.email || null,
  birth_date: m.birthDate || null, join_date: m.joinDate || null, role_id: m.roleId || null,
  username: m.username || null, avatar_url: m.avatarUrl || null,
});
const toEvent = (r) => ({
  id: r.id, name: r.name, dateStart: r.date_start, dateEnd: r.date_end,
  description: r.description || "", location: r.location || "",
  locationUrl: r.location_url || "", status: r.status,
  presences: r.presences || {}, confirmations: r.confirmations || {},
});
const fromEvent = (e) => ({
  id: e.id, name: e.name, date_start: e.dateStart, date_end: e.dateEnd || null,
  description: e.description || null, location: e.location || null,
  location_url: e.locationUrl || null, status: e.status, presences: e.presences || {},
});

const toPurchase = (r) => ({
  id: r.id, eventId: r.event_id, description: r.description, total: Number(r.total),
  payerId: r.payer_member_id, participants: r.participants || [],
  settled: r.settled || {}, receipts: r.receipts || [],
});
const fromPurchase = (p) => ({
  id: p.id, event_id: p.eventId, description: p.description, total: p.total,
  payer_member_id: p.payerId || null, participants: p.participants || [],
  settled: p.settled || {}, receipts: p.receipts || [],
});

export const api = {
  async loadAll() {
    const [members, events, roles, admins, purchases, profiles] = await Promise.all([
      supabase.from("members").select("*"),
      supabase.from("events").select("*"),
      supabase.from("roles").select("*"),
      supabase.from("admins").select("*"),
      supabase.from("purchases").select("*"),
      supabase.from("profiles").select("*"),
    ]);
    for (const r of [members, events, roles, admins, purchases]) if (r.error) throw r.error;
    return {
      members: members.data.map(toMember),
      events: events.data.map(toEvent),
      roles: roles.data,
      admins: admins.data,
      purchases: purchases.data.map(toPurchase),
      profiles: profiles.error ? [] : profiles.data,
    };
  },
  async saveMember(m) { const { error } = await supabase.from("members").upsert(fromMember(m)); if (error) throw error; },
  async deleteMember(id) { const { error } = await supabase.from("members").delete().eq("id", id); if (error) throw error; },
  async saveEvent(e) { const { error } = await supabase.from("events").upsert(fromEvent(e)); if (error) throw error; },
  async deleteEvent(id) { const { error } = await supabase.from("events").delete().eq("id", id); if (error) throw error; },
  async saveRole(r) { const { error } = await supabase.from("roles").upsert(r); if (error) throw error; },
  async deleteRole(id) { const { error } = await supabase.from("roles").delete().eq("id", id); if (error) throw error; },
  async addAdmin(email) { const { error } = await supabase.from("admins").insert({ email, is_main: false }); if (error) throw error; },
  async removeAdmin(email) { const { error } = await supabase.from("admins").delete().eq("email", email).eq("is_main", false); if (error) throw error; },
  async updateMyProfile(username, birthDate, avatarUrl) {
    const { error } = await supabase.rpc("update_my_profile", {
      p_username: username || null, p_birth_date: birthDate || null, p_avatar_url: avatarUrl || null,
    });
    if (error) throw error;
  },
  async setMyConfirmation(eventId, value) {
    const { error } = await supabase.rpc("set_my_confirmation", { p_event_id: eventId, p_value: value });
    if (error) throw error;
  },
  async savePurchase(pu) { const { error } = await supabase.from("purchases").upsert(fromPurchase(pu)); if (error) throw error; },
  async deletePurchase(id) { const { error } = await supabase.from("purchases").delete().eq("id", id); if (error) throw error; },
  async uploadFile(path, file) {
    const { error } = await supabase.storage.from("grill").upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from("grill").getPublicUrl(path);
    return data.publicUrl;
  },
};
