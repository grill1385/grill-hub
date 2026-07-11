-- ============================================================
-- GrillHub — fase C: perfis de contas, compras/contas e storage
-- Correr UMA vez no SQL Editor do Supabase.
-- ============================================================

-- 1) Perfis: registo automático de cada conta criada (para associação e notificações)
create table if not exists profiles (
  id uuid primary key,
  email text not null,
  name text,
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "admins leem perfis" on profiles for select using (is_admin());

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- backfill das contas já existentes
insert into profiles (id, email, name)
select id, lower(email), coalesce(raw_user_meta_data->>'name', '') from auth.users
on conflict (id) do nothing;

-- 2) Compras (contas divididas por evento)
create table if not exists purchases (
  id text primary key,
  event_id text not null references events(id) on delete cascade,
  description text not null,
  total numeric(10,2) not null,
  payer_member_id text references members(id) on delete set null,
  participants jsonb not null default '[]'::jsonb,
  settled jsonb not null default '{}'::jsonb,
  receipts jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);
alter table purchases enable row level security;
create policy "leitura publica" on purchases for select using (true);
create policy "escrita admin" on purchases for all using (is_admin()) with check (is_admin());

-- 3) Storage: bucket público "grill" (faturas + fotos de perfil)
insert into storage.buckets (id, name, public) values ('grill', 'grill', true)
on conflict (id) do nothing;

create policy "leitura grill" on storage.objects for select using (bucket_id = 'grill');
create policy "upload grill" on storage.objects for insert to authenticated
  with check (bucket_id = 'grill' and (is_admin() or my_member_id() is not null));
create policy "update grill" on storage.objects for update to authenticated
  using (bucket_id = 'grill' and (is_admin() or my_member_id() is not null));
create policy "delete grill" on storage.objects for delete to authenticated
  using (bucket_id = 'grill' and is_admin());
