# GrillHub — Contexto para o Claude

Plataforma do grupo de amigos "Grill" (David / grill1385): eventos, presenças, membros, cargos, contas partilhadas e férias.

## Acesso ao código

- Repo: `https://github.com/grill1385/grill-hub.git` (privado)
- Para trabalhar: pedir ao David um fine-grained PAT read/write de curta duração e clonar. Nunca guardar o token em ficheiros nem no repo.
- Site: https://grill1385.github.io/grill-hub/ — deploy automático via GitHub Actions a cada push para `main` (+ 2x/dia para regenerar páginas de partilha OG).

## Stack e arquitetura

- React 18 + Vite, SPA. `src/App.jsx` (~1900 linhas: componente App + todos os modais), `src/Ferias.jsx` (aba Férias), `src/api.js` (todo o acesso ao Supabase), `src/main.jsx`.
- Backend: Supabase (`noperkfdcdairrpnomrs.supabase.co`) — Postgres + Auth (email/password e Google) + Storage (bucket público `grill`) + Edge Functions (`notify-event`, `event-og`).
- RLS: leitura pública em tudo; escrita só admins (`is_admin()`/`is_main_admin()` sobre o email do JWT), exceto tabelas de férias (escrita também para membros via `is_member()`), e RPCs `update_my_profile`/`set_my_confirmation` para o próprio membro.
- Migrações em `supabase/*.sql` — correm-se manualmente no SQL Editor (uma vez cada): `setup-auth.sql`, `setup-perfil-rsvp.sql`, `setup-contas-storage.sql`, `setup-melhorias.sql`, `setup-ferias.sql`.
- GitHub Actions: `deploy.yml` (Pages + `scripts/generate-share-pages.mjs` com sharp), `lembretes.yml` (diário 08:00 UTC: `send-reminders.mjs` 3 dias antes de eventos + `send-debt-reminders.mjs` dívidas; emails via Brevo, secret `BREVO_API_KEY`, sender grillfeup@gmail.com), `keep-alive.yml` (2x/semana ping ao Supabase).

## Dados (tabelas)

- `members` (id, name, email, birth_date, join_date, role_id, username, avatar_url) — conta liga-se a membro por email igual.
- `events` (datas, status "Por planear/Agendado/Concluído", `presences` jsonb, `confirmations` jsonb RSVP), `roles` (label, level), `admins` (email, is_main), `purchases` (contas por evento, split equal/custom, settled, receipts), `profiles` (contas auth pendentes de ligação).
- Férias (jul 2026): `vacations` (name, date_start/end, event_id opcional, notes), `vacation_places` (city, country, arrive/depart_date, sort), `vacation_stays` (place_id, check_in/out + horas, price_night_person, price_total, links jsonb, status), `vacation_transports` (from/to_place_id — null = "Casinha" (casa, início/fim), kind, date, time, price_person, links, status), `vacation_tasks` (auto_key null = manual; assignees jsonb, due_date, done).

## Aba "Férias do Grill" (src/Ferias.jsx) — regras

- Sub-menus por férias: Resumo, Locais, Alojamento, Transportes. Dias/noites calculados das datas.
- Transporte de chegada/saída de cada local é derivado dos Transportes (não se duplica nos Locais).
- Estados de alojamentos/transportes: Por pesquisar → Em pesquisa → Em discussão → Escolhido → Marcado → Pago. Regras: "Em pesquisa"+ exige ≥1 link; "Escolhido"+ exige exatamente 1 link. Preços sempre opcionais.
- Tarefas automáticas no Resumo (só para férias futuras): locais sem alojamento, locais sem transporte, itens não-"Pago". Transportes: aparecem 6 meses antes do início, prazo 3 meses antes. Alojamento: aparecem 4 meses antes, prazo 2 meses antes. Atribuição de membros persiste em `vacation_tasks` por `auto_key`; tarefas manuais também existem (done toggle).
- Custos no Resumo: total alojamento (price_total), transportes €/pessoa; divisão por confirmados do evento ligado, senão nº de membros.
- Escrita: qualquer conta ligada a um membro (canEdit = session && (isAdmin || myMember)).

## Estado atual / pendentes

- Aba Férias publicada (commit 2ddb592, jul 2026). Pré-requisito: `setup-ferias.sql` corrido no SQL Editor — confirmar com o David se já foi feito.
- As 3 férias antigas existem como eventos normais; o David vai registá-las também nas Férias só para histórico. As férias de 2026 (destino: Balcãs) estão em planeamento ativo.

## Convenções

- Tudo em PT-PT, tom informal (ex.: "Casinha", "A acender a brasa…").
- IDs: `uid()` aleatório em texto; BD snake_case ↔ app camelCase (converters em api.js).
- UI: classes CSS do `Style()` em App.jsx (card, btn ember/ghost/danger, pill, segmented, section-head, hint, empty, modal/overlay, detail-grid, status…). Ferias.jsx tem estilos próprios prefixados `v` (FeriasStyle).
- Commits em português, mensagem descritiva; push para `main` = deploy.
