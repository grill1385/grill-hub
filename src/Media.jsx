import React, { useEffect, useMemo, useState } from "react";

/* ============================================================
   MEDIA DO GRILL
   Três secções: Documentos, Mangá da Lore do Grill e Fotos.
   Cada uma é uma árvore de pastas (aninhamento livre) com
   ficheiros. Blocos com título e data de upload.
   Escrita: Documentos e Mangá = só admins; Fotos = qualquer membro.
   Tabela: ver supabase/setup-media.sql
   ============================================================ */
import { mediaApi, api } from "./api.js";

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
/* base './' no Vite → capa servida da raiz do site (public/manga-cover.jpg) */
const MANGA_COVER = `${import.meta.env.BASE_URL}manga-cover.jpg`;

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function fmtSize(b) {
  if (b == null) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
const isImage = (m) => (m?.mime || "").startsWith("image/");
const isPdf = (m) => (m?.mime || "").includes("pdf");

/* ---------- Ícones vetorizados ---------- */
const MIcon = {
  folder: (s = 56) => (
    <svg viewBox="0 0 48 42" width={s} height={s} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 9a4 4 0 0 1 4-4h11.2a4 4 0 0 1 2.9 1.2L24 9h17a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9Z" fill="#E9A23B" />
      <path d="M3 15h42v20a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V15Z" fill="#F5C168" />
      <path d="M3 15h42" stroke="#B87A26" strokeWidth="1.2" />
    </svg>
  ),
  doc: (s = 56) => (
    <svg viewBox="0 0 40 48" width={s} height={s} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4a3 3 0 0 1 3-3h16l11 11v30a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V4Z" fill="#EFE7D6" />
      <path d="M25 1v8a3 3 0 0 0 3 3h8" fill="#CBB98F" />
      <path d="M13 21h14M13 28h14M13 35h9" stroke="#E85D1F" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  pdf: (s = 56) => (
    <svg viewBox="0 0 40 48" width={s} height={s} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4a3 3 0 0 1 3-3h16l11 11v30a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V4Z" fill="#EFE7D6" />
      <path d="M25 1v8a3 3 0 0 0 3 3h8" fill="#CBB98F" />
      <rect x="4" y="26" width="32" height="13" rx="2.5" fill="#C0392B" />
      <text x="20" y="35.5" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="8.5" fontWeight="700" fill="#fff">PDF</text>
    </svg>
  ),
  photo: (s = 56) => (
    <svg viewBox="0 0 48 42" width={s} height={s} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="5" width="42" height="32" rx="4" fill="#2A211B" stroke="#F5C168" strokeWidth="2" />
      <circle cx="15" cy="16" r="4" fill="#F5C168" />
      <path d="M6 34l11-12 8 8 6-6 11 12v0a3 3 0 0 1-3 1H8a3 3 0 0 1-2-3Z" fill="#E85D1F" />
    </svg>
  ),
  book: (s = 56) => (
    <svg viewBox="0 0 48 44" width={s} height={s} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 8C19 4 11 3 5 4v31c6-1 14 0 19 4 5-4 13-5 19-4V4c-6-1-14 0-19 4Z" fill="#EFE7D6" />
      <path d="M24 8v31" stroke="#B87A26" strokeWidth="2" />
      <path d="M24 8C19 4 11 3 5 4v31c6-1 14 0 19 4V8Z" fill="#8E2B22" />
      <path d="M10 13c3-.6 6-.6 9 .4M10 20c3-.6 6-.6 9 .4" stroke="#EFE7D6" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
};

const SECTIONS = {
  documentos: { label: "Documentos", icon: "doc", adminOnly: true, accept: "", blurb: "Documentos do grupo — atas, regras, listas, o que precisares." },
  manga: { label: "Mangá da Lore do Grill", icon: "book", adminOnly: true, accept: "image/*,application/pdf", blurb: "As edições semanais do mangá da lore do Grill." },
  fotos: { label: "Fotos", icon: "photo", adminOnly: false, accept: "image/*", blurb: "As fotos do grupo. Qualquer membro pode adicionar fotos e pastas." },
};

/* imagem com fallback para ícone (capa do mangá pode ainda não existir) */
function ImgOrIcon({ src, alt, fallback }) {
  const [err, setErr] = useState(false);
  if (err || !src) return fallback;
  return <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} />;
}

export default function MediaTab({ myMember, isAdmin, session, showToast }) {
  const [entries, setEntries] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [section, setSection] = useState(null);       // secção aberta
  const [path, setPath] = useState([]);               // pilha de pastas {id, title}
  const [viewer, setViewer] = useState(null);         // ficheiro em pré-visualização

  useEffect(() => {
    mediaApi.loadAll().then(setEntries).catch((e) => { console.error(e); setLoadErr(true); });
  }, []);

  const canWrite = (sec) => !!session && (isAdmin || (!SECTIONS[sec].adminOnly && !!myMember));

  const parentId = path.length ? path[path.length - 1].id : null;
  const current = useMemo(() => {
    if (!entries || !section) return [];
    return entries
      .filter((e) => e.section === section && (e.parentId || null) === parentId)
      .sort((a, b) => (a.kind === b.kind ? (b.createdAt || "").localeCompare(a.createdAt || "") : a.kind === "folder" ? -1 : 1));
  }, [entries, section, parentId]);

  async function addFolder() {
    const title = window.prompt("Nome da pasta:");
    if (!title || !title.trim()) return;
    const row = { id: uid(), section, parentId, kind: "folder", title: title.trim(), uploadedBy: myMember?.name || null };
    try {
      await mediaApi.save(row);
      setEntries((xs) => [...xs, row]);
    } catch (e) { console.error(e); showToast(errMsg(e)); }
  }

  async function uploadFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    let ok = 0;
    for (const file of files) {
      try {
        const ext = (file.name.split(".").pop() || "bin").toLowerCase();
        const url = await api.uploadFile(`media/${section}/${uid()}.${ext}`, file);
        const title = file.name.replace(/\.[^.]+$/, "");
        const row = {
          id: uid(), section, parentId, kind: "file", title,
          url, mime: file.type || null, sizeBytes: file.size ?? null,
          uploadedBy: myMember?.name || null,
        };
        await mediaApi.save(row);
        setEntries((xs) => [...xs, row]);
        ok++;
      } catch (e) { console.error(e); showToast(errMsg(e)); }
    }
    if (ok) showToast(`${ok} ficheiro(s) carregado(s).`);
  }

  async function rename(entry) {
    const title = window.prompt("Novo nome:", entry.title);
    if (!title || !title.trim() || title.trim() === entry.title) return;
    const next = { ...entry, title: title.trim() };
    try {
      await mediaApi.save(next);
      setEntries((xs) => xs.map((x) => (x.id === entry.id ? next : x)));
    } catch (e) { console.error(e); showToast(errMsg(e)); }
  }

  async function remove(entry) {
    const isFolder = entry.kind === "folder";
    if (!window.confirm(isFolder ? "Eliminar esta pasta e todo o seu conteúdo?" : "Eliminar este ficheiro?")) return;
    try {
      await mediaApi.remove(entry.id); // cascade na BD trata das subpastas/ficheiros
      setEntries((xs) => {
        const drop = new Set([entry.id]);
        if (isFolder) {
          let grew = true;
          while (grew) {
            grew = false;
            for (const e of xs) if (e.parentId && drop.has(e.parentId) && !drop.has(e.id)) { drop.add(e.id); grew = true; }
          }
        }
        return xs.filter((x) => !drop.has(x.id));
      });
      showToast(isFolder ? "Pasta eliminada." : "Ficheiro eliminado.");
    } catch (e) { console.error(e); showToast(errMsg(e)); }
  }

  function errMsg(e) {
    const m = e?.message || "";
    if (/relation|table|schema|column/i.test(m)) return "Falta correr o supabase/setup-media.sql (ou recarregar o schema: notify pgrst).";
    if (/row-level security|policy|permission/i.test(m)) return "Sem permissões para esta secção.";
    return `Não foi possível guardar.${m ? ` (${m})` : ""}`;
  }

  /* thumbnail de um ficheiro conforme a secção/tipo */
  function fileThumb(f) {
    if (isImage(f)) return <img src={f.url} alt={f.title} loading="lazy" />;
    if (section === "manga") return <ImgOrIcon src={MANGA_COVER} alt={f.title} fallback={MIcon.book(52)} />;
    if (isPdf(f)) return MIcon.pdf(52);
    return MIcon.doc(52);
  }

  /* ----- estados de carregamento ----- */
  if (loadErr) return (
    <section>
      <div className="section-head"><h2>Media</h2></div>
      <p className="empty">Não foi possível carregar. Se é a primeira vez, corre o <code>supabase/setup-media.sql</code> no SQL Editor.</p>
    </section>
  );
  if (!entries) return (
    <section><div className="section-head"><h2>Media</h2></div><p className="hint">A carregar…</p></section>
  );

  /* ----- ecrã inicial: 3 blocos ----- */
  if (!section) {
    return (
      <section>
        <MediaStyle />
        <div className="section-head"><h2>Media</h2></div>
        <div className="media-sections">
          {Object.entries(SECTIONS).map(([key, s]) => {
            const count = entries.filter((e) => e.section === key && e.kind === "file").length;
            return (
              <button key={key} className="media-section-card" onClick={() => { setSection(key); setPath([]); }}>
                <span className="media-section-icon">
                  {key === "manga"
                    ? <ImgOrIcon src={MANGA_COVER} alt="Mangá da Lore do Grill" fallback={MIcon.book(64)} />
                    : MIcon[s.icon](64)}
                </span>
                <strong>{s.label}</strong>
                <span className="hint" style={{ margin: 0 }}>{s.blurb}</span>
                <span className="media-count">{count} ficheiro{count === 1 ? "" : "s"}</span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  /* ----- dentro de uma secção ----- */
  const sec = SECTIONS[section];
  const writable = canWrite(section);
  const folders = current.filter((e) => e.kind === "folder");
  const files = current.filter((e) => e.kind === "file");

  return (
    <section>
      <MediaStyle />
      <div className="section-head">
        <h2>
          <a href="#" className="media-back" onClick={(e) => { e.preventDefault(); setSection(null); setPath([]); }}>← Media</a>
          {" "}{sec.label}
        </h2>
        {writable && (
          <div className="head-actions" style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={addFolder}>+ Pasta</button>
            <label className="btn ember" style={{ cursor: "pointer", margin: 0 }}>
              + {section === "fotos" ? "Fotos" : "Ficheiro"}
              <input type="file" multiple accept={sec.accept} style={{ display: "none" }}
                onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
        )}
      </div>

      {/* breadcrumb */}
      <div className="media-crumbs">
        <a href="#" onClick={(e) => { e.preventDefault(); setPath([]); }}>{sec.label}</a>
        {path.map((p, i) => (
          <span key={p.id}>
            <span className="media-sep">/</span>
            <a href="#" onClick={(e) => { e.preventDefault(); setPath(path.slice(0, i + 1)); }}>{p.title}</a>
          </span>
        ))}
      </div>

      {current.length === 0 && (
        <p className="empty">
          {writable
            ? (section === "fotos" ? "Pasta vazia. Adiciona fotos ou cria uma subpasta." : "Vazio. Carrega o primeiro ficheiro.")
            : "Ainda não há nada aqui."}
        </p>
      )}

      <div className="media-grid">
        {folders.map((f) => (
          <div key={f.id} className="media-block folder" onClick={() => setPath([...path, { id: f.id, title: f.title }])}>
            <div className="media-thumb folder-thumb">{MIcon.folder(58)}</div>
            <div className="media-meta">
              <span className="media-title" title={f.title}>{f.title}</span>
              <span className="media-date">{fmtDate(f.createdAt)}</span>
            </div>
            {writable && (
              <div className="media-actions" onClick={(e) => e.stopPropagation()}>
                <button className="iconbtn" title="Renomear" onClick={() => rename(f)}>✎</button>
                <button className="iconbtn" title="Eliminar" onClick={() => remove(f)}>🗑</button>
              </div>
            )}
          </div>
        ))}

        {files.map((f) => (
          <div key={f.id} className="media-block" onClick={() => setViewer(f)}>
            <div className="media-thumb">{fileThumb(f)}</div>
            <div className="media-meta">
              <span className="media-title" title={f.title}>{f.title}</span>
              <span className="media-date">{fmtDate(f.createdAt)}{f.sizeBytes ? ` · ${fmtSize(f.sizeBytes)}` : ""}{f.uploadedBy ? ` · ${f.uploadedBy}` : ""}</span>
            </div>
            {writable && (
              <div className="media-actions" onClick={(e) => e.stopPropagation()}>
                <button className="iconbtn" title="Renomear" onClick={() => rename(f)}>✎</button>
                <button className="iconbtn" title="Eliminar" onClick={() => remove(f)}>🗑</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* pré-visualização */}
      {viewer && (
        <div className="overlay" onClick={() => setViewer(null)}>
          <div className="media-viewer" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{viewer.title}</h3>
              <button className="iconbtn" onClick={() => setViewer(null)}>✕</button>
            </div>
            <div className="media-viewer-body">
              {isImage(viewer)
                ? <img src={viewer.url} alt={viewer.title} />
                : isPdf(viewer)
                  ? <iframe title={viewer.title} src={viewer.url} />
                  : <p className="hint">Pré-visualização indisponível para este tipo de ficheiro.</p>}
            </div>
            <div className="actions" style={{ padding: "0 4px 4px" }}>
              <a className="btn ghost small" href={viewer.url} target="_blank" rel="noreferrer">Abrir no browser</a>
              <a className="btn ember small" href={viewer.url} download={viewer.title} target="_blank" rel="noreferrer">Descarregar</a>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MediaStyle() {
  return (
    <style>{`
      .media-sections { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
      .media-section-card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; text-align: left;
        padding: 22px 20px; border-radius: 14px; background: var(--surface2); border: 1px solid var(--line); cursor: pointer; color: inherit; transition: transform .12s, border-color .12s; }
      .media-section-card:hover { transform: translateY(-2px); border-color: var(--ember); }
      .media-section-icon { height: 72px; display: flex; align-items: center; }
      .media-section-icon img { height: 72px; width: 56px; object-fit: cover; border-radius: 6px; box-shadow: 0 2px 10px rgba(0,0,0,.5); }
      .media-section-card strong { font-size: 17px; }
      .media-count { font-size: 12px; opacity: .7; margin-top: 4px; }
      .media-back { text-decoration: none; opacity: .85; font-size: 15px; margin-right: 4px; color: #F5C168; }
      .media-crumbs { font-size: 14px; margin-bottom: 14px; opacity: .9; }
      .media-crumbs a { color: #F5C168; text-decoration: none; }
      .media-crumbs .media-sep { opacity: .5; margin: 0 6px; }
      .media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px; align-items: start; }
      .media-block { position: relative; border-radius: 12px; background: var(--surface2); border: 1px solid var(--line); overflow: hidden; cursor: pointer; transition: transform .12s, border-color .12s; }
      .media-block:hover { transform: translateY(-2px); border-color: var(--ember); }
      .media-thumb { height: 130px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.25); overflow: hidden; }
      .media-thumb img { width: 100%; height: 100%; object-fit: cover; }
      .folder-thumb { background: rgba(245,184,104,.06); }
      .media-meta { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px 10px; }
      .media-title { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .media-date { font-size: 11.5px; opacity: .65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .media-actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; opacity: 0; transition: opacity .12s; }
      .media-block:hover .media-actions { opacity: 1; }
      .media-actions .iconbtn { background: rgba(0,0,0,.55); border-radius: 6px; }
      .media-viewer { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; width: 100%; max-width: 900px; max-height: 92vh; display: flex; flex-direction: column; padding: 14px 16px; }
      .media-viewer-body { flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; min-height: 200px; }
      .media-viewer-body img { max-width: 100%; max-height: 78vh; border-radius: 8px; }
      .media-viewer-body iframe { width: 100%; height: 78vh; border: 0; border-radius: 8px; background: #fff; }
      @media (max-width: 760px) {
        .media-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
        .media-thumb { height: 110px; }
      }
    `}</style>
  );
}
