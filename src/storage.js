/* ============================================================
   Adaptador de storage — Presenças do Grill
   Backend atual: Supabase (tabela kv) — dados partilhados
   entre todos os visitantes do site.
   A chave "publishable" é pública por design (a segurança é
   feita pelas RLS policies no Supabase).
   ============================================================ */

const SUPABASE_URL = "https://noperkfdcdairrpnomrs.supabase.co";
const SUPABASE_KEY = "sb_publishable_9IyQdSmI1GviEx83KqtCvw_gxMd-cnl";

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

const supabaseBackend = {
  async get(key) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/kv?key=eq.${encodeURIComponent(key)}&select=value`,
      { headers: HEADERS }
    );
    if (!res.ok) throw new Error(`Supabase GET falhou: ${res.status}`);
    const rows = await res.json();
    return rows.length ? { key, value: rows[0].value } : null;
  },
  async set(key, value) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/kv`, {
      method: "POST",
      headers: { ...HEADERS, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`Supabase SET falhou: ${res.status}`);
    return { key, value };
  },
};

/* Backend anterior (localStorage) — mantido como referência
const localBackend = {
  async get(key) {
    const value = window.localStorage.getItem(key);
    return value === null ? null : { key, value };
  },
  async set(key, value) {
    window.localStorage.setItem(key, value);
    return { key, value };
  },
};
*/

const backend = supabaseBackend;

export const storage = {
  async get(key) {
    try { return await backend.get(key); } catch { return null; }
  },
  async set(key, value) {
    try { return await backend.set(key, value); } catch { return null; }
  },
};
