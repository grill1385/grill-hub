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
  split: r.split || "equal", shares: r.shares || {},

  claimed: r.claimed || {},
});
/* claimed fica de fora do fromPurchase de propósito: só muda via RPC
   claim_my_payment, para o upsert não pisar registos concorrentes. */
const fromPurchase = (p) => ({
  id: p.id, event_id: p.eventId, description: p.description, total: p.total,
  payer_member_id: p.payerId || null, participants: p.participants || [],
  settled: p.settled || {}, receipts: p.receipts || [],
  split: p.split || "equal", shares: p.shares || {},
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
  async saveMembers(list) { const { error } = await supabase.from("members").upsert(list.map(fromMember)); if (error) throw error; },
  async saveEvents(list) { const { error } = await supabase.from("events").upsert(list.map(fromEvent)); if (error) throw error; },
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
  async dismissProfile(id) {
    const { error } = await supabase.from("profiles").update({ dismissed: true }).eq("id", id);
    if (error) throw error;
  },
  async savePurchase(pu) { const { error } = await supabase.from("purchases").upsert(fromPurchase(pu)); if (error) throw error; },
  /* devedor marca/desmarca "já paguei" (ver setup-contas-pagamentos.sql) */
  async claimPayment(purchaseId, value) {
    const { error } = await supabase.rpc("claim_my_payment", { p_purchase_id: purchaseId, p_value: value });
    if (error) throw error;
  },
  async deletePurchase(id) { const { error } = await supabase.from("purchases").delete().eq("id", id); if (error) throw error; },
  async uploadFile(path, file) {
    const { error } = await supabase.storage.from("grill").upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from("grill").getPublicUrl(path);
    return data.publicUrl;
  },
};

/* ============================================================
   Férias do Grill (tabelas: ver supabase/setup-ferias.sql)
   ============================================================ */
const toVacation = (r) => ({
  id: r.id, name: r.name, dateStart: r.date_start, dateEnd: r.date_end,
  eventId: r.event_id, notes: r.notes || "",
  confirmations: r.confirmations || {},
});
/* confirmations fica de fora de propósito: é gerido por
   set_my_vacation_confirmation (membro) / saveVacationConfirmations (admin),
   para o upsert das férias não pisar confirmações entretanto alteradas. */
const fromVacation = (v) => ({
  id: v.id, name: v.name, date_start: v.dateStart, date_end: v.dateEnd,
  event_id: v.eventId || null, notes: v.notes || null,
});
const toVPlace = (r) => ({
  id: r.id, vacationId: r.vacation_id, city: r.city, country: r.country,
  arriveDate: r.arrive_date, departDate: r.depart_date, sort: r.sort ?? 0,
});
const fromVPlace = (p) => ({
  id: p.id, vacation_id: p.vacationId, city: p.city, country: p.country || null,
  arrive_date: p.arriveDate || null, depart_date: p.departDate || null, sort: p.sort ?? 0,
});
const toVStay = (r) => ({
  id: r.id, vacationId: r.vacation_id, placeId: r.place_id, name: r.name,
  checkIn: r.check_in, checkInTime: r.check_in_time, checkOut: r.check_out, checkOutTime: r.check_out_time,
  priceNightPerson: r.price_night_person == null ? null : Number(r.price_night_person),
  priceTotal: r.price_total == null ? null : Number(r.price_total),
  links: r.links || [], status: r.status || "Por pesquisar",
});
const fromVStay = (s) => ({
  id: s.id, vacation_id: s.vacationId, place_id: s.placeId, name: s.name || null,
  check_in: s.checkIn || null, check_in_time: s.checkInTime || null,
  check_out: s.checkOut || null, check_out_time: s.checkOutTime || null,
  price_night_person: s.priceNightPerson ?? null, price_total: s.priceTotal ?? null,
  links: s.links || [], status: s.status || "Por pesquisar",
});
const toVTransport = (r) => ({
  id: r.id, vacationId: r.vacation_id, fromPlaceId: r.from_place_id, toPlaceId: r.to_place_id,
  date: r.date, time: r.time, kind: r.kind,
  pricePerson: r.price_person == null ? null : Number(r.price_person),
  links: r.links || [], status: r.status || "Por pesquisar",
  isGeneral: !!r.is_general, name: r.name || null, dateEnd: r.date_end || null, generalId: r.general_id || null,
});
const fromVTransport = (t) => ({
  id: t.id, vacation_id: t.vacationId, from_place_id: t.fromPlaceId || null, to_place_id: t.toPlaceId || null,
  date: t.date || null, time: t.time || null, kind: t.kind || null,
  price_person: t.pricePerson ?? null, links: t.links || [], status: t.status || "Por pesquisar",
  is_general: !!t.isGeneral, name: t.name || null, date_end: t.dateEnd || null, general_id: t.generalId || null,
});
const toVPurchase = (r) => ({
  id: r.id, vacationId: r.vacation_id, description: r.description, total: Number(r.total),
  payerId: r.payer_member_id, participants: r.participants || [],
  settled: r.settled || {}, split: r.split || "equal", shares: r.shares || {},
  sourceKey: r.source_key || null, createdAt: r.created_at || null,
  claimed: r.claimed || {},
});
/* claimed fica de fora do fromVPurchase: só muda via RPC claim_my_vacation_payment */
/* created_at fica de fora: é definido pela BD no insert e não deve ser pisado */
const fromVPurchase = (p) => ({
  id: p.id, vacation_id: p.vacationId, description: p.description, total: p.total,
  payer_member_id: p.payerId || null, participants: p.participants || [],
  settled: p.settled || {}, split: p.split || "equal", shares: p.shares || {},
  source_key: p.sourceKey || null,
});
const toVTask = (r) => ({
  id: r.id, vacationId: r.vacation_id, autoKey: r.auto_key, title: r.title,
  assignees: r.assignees || [], dueDate: r.due_date, done: !!r.done,
});
const fromVTask = (t) => ({
  id: t.id, vacation_id: t.vacationId, auto_key: t.autoKey || null, title: t.title || null,
  assignees: t.assignees || [], due_date: t.dueDate || null, done: !!t.done,
});

export const feriasApi = {
  async loadAll() {
    const [vacations, places, stays, transports, tasks, purchases] = await Promise.all([
      supabase.from("vacations").select("*"),
      supabase.from("vacation_places").select("*"),
      supabase.from("vacation_stays").select("*"),
      supabase.from("vacation_transports").select("*"),
      supabase.from("vacation_tasks").select("*"),
      supabase.from("vacation_purchases").select("*"),
    ]);
    for (const r of [vacations, places, stays, transports, tasks]) if (r.error) throw r.error;
    return {
      vacations: vacations.data.map(toVacation),
      places: places.data.map(toVPlace),
      stays: stays.data.map(toVStay),
      transports: transports.data.map(toVTransport),
      tasks: tasks.data.map(toVTask),
      /* tolerante: se a migração setup-ferias-contas.sql ainda não correu, segue sem contas */
      purchases: purchases.error ? [] : purchases.data.map(toVPurchase),
    };
  },
  async saveVacation(v) { const { error } = await supabase.from("vacations").upsert(fromVacation(v)); if (error) throw error; },
  /* o próprio membro confirma/desconfirma a sua participação (RPC; ver setup-ferias-confirmacoes.sql) */
  async setMyVacationConfirmation(vacationId, value) {
    const { error } = await supabase.rpc("set_my_vacation_confirmation", { p_vacation_id: vacationId, p_value: value });
    if (error) throw error;
  },
  /* admin altera as confirmações de qualquer membro (update direto, só a coluna) */
  async saveVacationConfirmations(vacationId, confirmations) {
    const { error } = await supabase.from("vacations").update({ confirmations }).eq("id", vacationId);
    if (error) throw error;
  },
  async deleteVacation(id) { const { error } = await supabase.from("vacations").delete().eq("id", id); if (error) throw error; },
  async savePlace(p) { const { error } = await supabase.from("vacation_places").upsert(fromVPlace(p)); if (error) throw error; },
  async deletePlace(id) { const { error } = await supabase.from("vacation_places").delete().eq("id", id); if (error) throw error; },
  async saveStay(s) { const { error } = await supabase.from("vacation_stays").upsert(fromVStay(s)); if (error) throw error; },
  async deleteStay(id) { const { error } = await supabase.from("vacation_stays").delete().eq("id", id); if (error) throw error; },
  async saveTransport(t) { const { error } = await supabase.from("vacation_transports").upsert(fromVTransport(t)); if (error) throw error; },
  async deleteTransport(id) { const { error } = await supabase.from("vacation_transports").delete().eq("id", id); if (error) throw error; },
  async saveTask(t) { const { error } = await supabase.from("vacation_tasks").upsert(fromVTask(t)); if (error) throw error; },
  async savePurchase(p) { const { error } = await supabase.from("vacation_purchases").upsert(fromVPurchase(p)); if (error) throw error; },
  async claimPayment(purchaseId, value) {
    const { error } = await supabase.rpc("claim_my_vacation_payment", { p_purchase_id: purchaseId, p_value: value });
    if (error) throw error;
  },
  async deletePurchase(id) { const { error } = await supabase.from("vacation_purchases").delete().eq("id", id); if (error) throw error; },
  async deleteTask(id) { const { error } = await supabase.from("vacation_tasks").delete().eq("id", id); if (error) throw error; },
};


/* ============================================================
   Media do Grill (tabela: ver supabase/setup-media.sql)
   Documentos, Mangá da Lore do Grill e Fotos, em árvore de pastas.
   ============================================================ */
const toMedia = (r) => ({
  id: r.id, section: r.section, parentId: r.parent_id, kind: r.kind,
  title: r.title, url: r.url || null, mime: r.mime || null,
  sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
  uploadedBy: r.uploaded_by || null, createdAt: r.created_at || null,
});
const fromMedia = (m) => ({
  id: m.id, section: m.section, parent_id: m.parentId || null, kind: m.kind,
  title: m.title, url: m.url || null, mime: m.mime || null,
  size_bytes: m.sizeBytes ?? null, uploaded_by: m.uploadedBy || null,
});

export const mediaApi = {
  async loadAll() {
    const { data, error } = await supabase.from("media_entries").select("*");
    if (error) throw error;
    return data.map(toMedia);
  },
  async save(m) { const { error } = await supabase.from("media_entries").upsert(fromMedia(m)); if (error) throw error; },
  async remove(id) { const { error } = await supabase.from("media_entries").delete().eq("id", id); if (error) throw error; },
};
