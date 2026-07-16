/* ============================================================
   GrillHub — Upload em massa para a secção Media
   Envia uma pasta inteira (fotos/vídeos/PDFs) para o GrillHub,
   replicando as subpastas. Corre no TEU computador.

   Pré-requisitos:
     - Node 18+ e, na raiz do repo:  npm install
     - Uma conta GrillHub com permissão (admin para documentos/manga;
       qualquer membro para fotos).

   Uso:
     GRILL_EMAIL="tu@exemplo.com" GRILL_PASSWORD="a-tua-pass" \
       node scripts/bulk-upload-media.mjs --dir "./stories" --section fotos --folder "Instagram Stories"

   Opções:
     --dir     pasta local a enviar (obrigatório)
     --section fotos | documentos | manga           (default: fotos)
     --folder  nome da pasta de destino no GrillHub  (opcional; senão vai à raiz da secção)
   ============================================================ */
import { createClient } from "@supabase/supabase-js";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const SB_URL = "https://noperkfdcdairrpnomrs.supabase.co";
const SB_KEY = "sb_publishable_9IyQdSmI1GviEx83KqtCvw_gxMd-cnl";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, cur, i, arr) => {
    if (cur.startsWith("--")) a.push([cur.slice(2), arr[i + 1]]);
    return a;
  }, [])
);
const DIR = args.dir;
const SECTION = args.section || "fotos";
const ROOT_FOLDER = args.folder || null;
const EMAIL = process.env.GRILL_EMAIL;
const PASSWORD = process.env.GRILL_PASSWORD;

if (!DIR) { console.error("Falta --dir <pasta>"); process.exit(1); }
if (!EMAIL || !PASSWORD) { console.error("Define GRILL_EMAIL e GRILL_PASSWORD no ambiente."); process.exit(1); }
if (!["fotos", "documentos", "manga"].includes(SECTION)) { console.error("--section tem de ser fotos | documentos | manga"); process.exit(1); }

const MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v", avi: "video/x-msvideo",
  pdf: "application/pdf",
};
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const { error: authErr } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authErr) { console.error("Login falhou:", authErr.message); process.exit(1); }
console.log(`Sessão iniciada como ${EMAIL}. Secção: ${SECTION}.`);

let nFiles = 0, nFolders = 0, nSkip = 0;

async function ensureFolder(title, parentId) {
  const id = uid();
  const { error } = await supabase.from("media_entries").insert({
    id, section: SECTION, parent_id: parentId, kind: "folder", title, uploaded_by: "bulk-upload",
  });
  if (error) throw error;
  nFolders++;
  return id;
}

async function walk(localDir, parentId) {
  const items = (await readdir(localDir)).sort();
  for (const name of items) {
    const full = path.join(localDir, name);
    const st = await stat(full);
    if (st.isDirectory()) {
      const fid = await ensureFolder(name, parentId);
      console.log(`📁 ${name}/`);
      await walk(full, fid);
      continue;
    }
    const ext = (name.split(".").pop() || "").toLowerCase();
    const mime = MIME[ext];
    if (!mime) { nSkip++; continue; } // ignora ficheiros não suportados
    const buf = await readFile(full);
    const key = `media/${SECTION}/${uid()}.${ext}`;
    const up = await supabase.storage.from("grill").upload(key, buf, { contentType: mime, upsert: false });
    if (up.error) { console.error(`  ✗ ${name}: ${up.error.message}`); continue; }
    const { data: pub } = supabase.storage.from("grill").getPublicUrl(key);
    const { error: insErr } = await supabase.from("media_entries").insert({
      id: uid(), section: SECTION, parent_id: parentId, kind: "file",
      title: name.replace(/\.[^.]+$/, ""), url: pub.publicUrl, mime, size_bytes: st.size, uploaded_by: "bulk-upload",
    });
    if (insErr) { console.error(`  ✗ ${name} (registo): ${insErr.message}`); continue; }
    nFiles++;
    if (nFiles % 10 === 0) console.log(`  … ${nFiles} ficheiros enviados`);
  }
}

const rootId = ROOT_FOLDER ? await ensureFolder(ROOT_FOLDER, null) : null;
if (ROOT_FOLDER) console.log(`📁 ${ROOT_FOLDER}/ (raiz)`);
await walk(DIR, rootId);

console.log(`\nConcluído: ${nFiles} ficheiros, ${nFolders} pastas${nSkip ? `, ${nSkip} ignorados (tipo não suportado)` : ""}.`);
process.exit(0);
