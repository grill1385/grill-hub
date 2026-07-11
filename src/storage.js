/* ============================================================
   Adaptador de storage — Presenças do Grill
   Versão atual: localStorage (dados por browser).
   Para dados partilhados entre todos os visitantes, substitui
   apenas o objeto `backend` por uma implementação Firebase /
   Supabase com a mesma interface { get, set } — o resto da app
   não precisa de mudar.
   ============================================================ */

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

/* Exemplo futuro (Supabase):
const supabaseBackend = {
  async get(key) {
    const { data } = await supabase.from("kv").select("value").eq("key", key).single();
    return data ? { key, value: data.value } : null;
  },
  async set(key, value) {
    await supabase.from("kv").upsert({ key, value });
    return { key, value };
  },
};
*/

const backend = localBackend;

export const storage = {
  async get(key) {
    try { return await backend.get(key); } catch { return null; }
  },
  async set(key, value) {
    try { return await backend.set(key, value); } catch { return null; }
  },
};
