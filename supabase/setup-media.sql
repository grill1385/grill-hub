-- ============================================================
-- GrillHub — Secção Media (Documentos, Mangá da Lore, Fotos)
-- Correr UMA vez no SQL Editor do Supabase.
-- Entradas em árvore: pastas e ficheiros, com aninhamento livre.
-- section: 'documentos' | 'manga' | 'fotos'
-- kind: 'folder' | 'file'
-- RLS escrita: admins em tudo; membros só na secção 'fotos'.
-- ============================================================

create table if not exists media_entries (
  id text primary key,
  section text not null,                       -- documentos | manga | fotos
  parent_id text references media_entries(id) on delete cascade, -- null = raiz da secção
  kind text not null,                          -- folder | file
  title text not null,
  url text,                                    -- ficheiros: URL público no storage
  mime text,                                   -- ficheiros: content-type
  size_bytes bigint,                           -- ficheiros: tamanho
  uploaded_by text,                            -- nome de quem carregou
  created_at timestamptz not null default now()
);

create index if not exists media_entries_section_parent_idx
  on media_entries (section, parent_id);

alter table media_entries enable row level security;
drop policy if exists "leitura publica" on media_entries;
drop policy if exists "escrita media" on media_entries;
create policy "leitura publica" on media_entries for select using (true);
-- admins escrevem em tudo; membros só na secção 'fotos'
create policy "escrita media" on media_entries for all
  using (is_admin() or (section = 'fotos' and is_member()))
  with check (is_admin() or (section = 'fotos' and is_member()));

notify pgrst, 'reload schema';
