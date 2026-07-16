# GrillHub — Contexto para o Claude

Plataforma do grupo de amigos "Grill" (David / grill1385): eventos, presenças, membros, cargos, contas partilhadas e férias.

## Acesso ao código

- Repo: `https://github.com/grill1385/grill-hub.git` (privado)
- Para trabalhar: pedir ao David um fine-grained PAT read/write de curta duração e clonar. Nunca guardar o token em ficheiros nem no repo.
- Site: https://grill1385.github.io/grill-hub/ — deploy automático via GitHub Actions a cada push para `main` (+ 2x/dia para regenerar páginas de partilha OG).

## Stack e arquitetura

- React 18 + Vite, SPA. `src/App.jsx` (componente App + todos os modais; inclui streaks de presença — `streakTier` colore a chama: >=30 violeta rosado, >=10 azul, >=6 vermelho, >=3 laranja, >=1 âmbar), `src/Ferias.jsx` (aba Férias), `src/Media.jsx` (aba Media), `src/api.js` (todo o acesso ao Supabase — exporta `api`, `feriasApi`, `mediaApi`), `src/main.jsx`.
- Backend: Supabase (`noperkfdcdairrpnomrs.supabase.co`) — Postgres + Auth (email/password e Google) + Storage (bucket público `grill`) + Edge Functions (`notify-event`, `event-og`).
- RLS: leitura pública em tudo; escrita só admins (`is_admin()`/`is_main_admin()` sobre o email do JWT), exceto tabelas de férias (escrita também para membros via `is_member()`), e RPCs `update_my_profile`/`set_my_confirmation` para o próprio membro.
- Migrações em `supabase/*.sql` — correm-se manualmente no SQL Editor (uma vez cada): `setup-auth.sql`, `setup-perfil-rsvp.sql`, `setup-contas-storage.sql`, `setup-melhorias.sql`, `setup-ferias.sql`, `setup-ferias-confirmacoes.sql`, `setup-ferias-transporte-geral.sql`, `setup-ferias-contas.sql`, `setup-media.sql`.
- GitHub Actions: `deploy.yml` (Pages + `scripts/generate-share-pages.mjs` com sharp), `lembretes.yml` (diário 08:00 UTC: `send-reminders.mjs` 3 dias antes de eventos — só a quem ainda não confirmou presença + `send-debt-reminders.mjs` dívidas; emails via Brevo, secret `BREVO_API_KEY`, sender grillfeup@gmail.com), `keep-alive.yml` (2x/semana ping ao Supabase).

## Dados (tabelas)

- `members` (id, name, email, birth_date, join_date, role_id, username, avatar_url) — conta liga-se a membro por email igual.
- `events` (datas, status "Por planear/Agendado/Concluído", `presences` jsonb, `confirmations` jsonb RSVP), `roles` (label, level), `admins` (email, is_main), `purchases` (contas por evento, split equal/custom, settled, receipts), `profiles` (contas auth pendentes de ligação).
- Férias (jul 2026): `vacations` (name, date_start/end, event_id opcional, notes, `confirmations` jsonb {memberId: bool}), `vacation_places` (city, country, arrive/depart_date, sort), `vacation_stays` (place_id, check_in/out + horas, price_night_person, price_total, links jsonb, status), `vacation_transports` (from/to_place_id — null = "Casinha" (casa, início/fim), kind, date, time, price_person, links, status; is_general/name/date_end = transporte geral tipo carrinha alugada com período de uso; general_id liga um deslocamento a um geral), `vacation_tasks` (auto_key null = manual; assignees jsonb, due_date, done), `vacation_purchases` (igual a purchases mas com vacation_id e created_at; split equal="Divisão por todos"/custom="Só pago o que usufruo").

## Aba "Férias do Grill" (src/Ferias.jsx) — regras

- Sub-menus por férias: Resumo, Locais, Alojamento, Transportes. Dias/noites calculados das datas.
- Transporte de chegada/saída de cada local é derivado dos Transportes (não se duplica nos Locais).
- Estados de alojamentos/transportes: Por pesquisar → Em pesquisa → Em discussão → Escolhido → Marcado → Pago. Regras: "Em pesquisa"+ exige ≥1 link; "Escolhido"+ exige exatamente 1 link. Preços sempre opcionais.
- Tarefas automáticas no Resumo (só para férias futuras): locais sem alojamento, locais sem transporte, itens não-"Pago" (deslocamentos ligados a um geral não geram tarefa de estado — o estado vive no geral).
- Responsáveis de tarefas (automáticas e manuais): só membros com participação confirmada nas férias (+ quem já estava atribuído).
- Transporte geral: preço, links e estado ficam no geral; deslocamentos ligados (general_id) não têm preço/estado próprios na UI e não contam nos custos (o geral conta uma vez).
- Mapa no Roteiro (RouteMap): Leaflet + tiles Carto dark; geocoding das cidades via Nominatim com cache em localStorage (`grill-geo:*`); se um alojamento tiver link Google Maps com coordenadas (@lat,lng, q=, !3d!4d), usa-se essa morada; trajeto por trechos clicáveis via OSRM público (router.project-osrm.org, um pedido por par consecutivo), fallback linhas retas; clique num trecho destaca-o e mostra popup (transporte do deslocamento, datas partida/chegada, hora, distância km e tempo estimado por modo — velocidades assumidas: avião 750 km/h + 45min, comboio 90, autocarro ~OSRM×1.25, barco 35, carro = OSRM); popups dos pins com datas/noites/alojamentos; pins sobrepostos agrupam-se (1·6). Transportes: aparecem 6 meses antes do início, prazo 3 meses antes. Alojamento: aparecem 4 meses antes, prazo 2 meses antes. Atribuição de membros persiste em `vacation_tasks` por `auto_key`; tarefas manuais também existem (done toggle).
- Participação (Resumo, secção colapsável mostrar/esconder): cada membro confirma/desconfirma a sua via RPC `set_my_vacation_confirmation` (bloqueia férias passadas); admins alteram qualquer confirmação (update direto só à coluna `confirmations`, também em férias passadas — para histórico). `fromVacation` NÃO envia confirmations para o upsert não pisar alterações concorrentes.
- Custos no Resumo: total alojamento (price_total), transportes €/pessoa; divisão por confirmados das férias, senão confirmados do evento ligado, senão nº de membros. Mostra também o total das contas registadas (link para a sub-aba Contas).
- Contas (sub-aba): compras com pagador obrigatório, participantes = confirmados nas férias, divisão equal/custom (custom valida soma = total); membros criam/editam, só admins alternam saldado e veem o botão de lembrete (mailto). Cada alojamento/transporte (exceto deslocamentos ligados a um geral) gera uma entrada "Por registar" com descrição e total estimado (stay: price_total ou price_night_person×noites×confirmados; transporte: price_person×confirmados) — "Registar compra" abre o formulário pré-preenchido e liga via source_key, evitando duplicados. Lembretes automáticos via send-debt-reminders.mjs: 3 dias após created_at da compra e depois semanalmente (sender grillfeup@gmail.com via Brevo).
- Escrita: qualquer conta ligada a um membro (canEdit = session && (isAdmin || myMember)).

## Estado atual / pendentes

- Aba Férias publicada (commit 2ddb592, jul 2026). Pré-requisito: `setup-ferias.sql` corrido no SQL Editor — confirmar com o David se já foi feito.
- Confirmações de participação nas férias (jul 2026). Pré-requisito: `setup-ferias-confirmacoes.sql` corrido no SQL Editor — confirmar com o David.
- Transportes gerais + mapa do roteiro (jul 2026). Pré-requisito: `setup-ferias-transporte-geral.sql` corrido no SQL Editor — confirmar com o David.
- Contas das férias (jul 2026). Pré-requisito: `setup-ferias-contas.sql` corrido no SQL Editor — confirmar com o David.
- As 3 férias antigas existem como eventos normais; o David vai registá-las também nas Férias só para histórico. As férias de 2026 (destino: Balcãs) estão em planeamento ativo.

## Convenções

- Media (aba, `src/Media.jsx`): 3 secções (documentos, manga, fotos) sobre a tabela `media_entries` (árvore: parent_id, kind folder/file, title, url, mime, size_bytes, uploaded_by, created_at). Ficheiros no bucket `grill` em `media/<section>/<id>.<ext>`. Escrita: documentos e manga só admins; fotos qualquer membro (RLS `escrita media`). Blocos com título e data; pastas aninháveis sem limite; viewer com imagem/PDF (iframe), abrir e descarregar. Pré-requisito: `setup-media.sql` corrido no SQL Editor.
- Tudo em PT-PT, tom informal (ex.: "Casinha", "A acender a brasa…").
- IDs: `uid()` aleatório em texto; BD snake_case ↔ app camelCase (converters em api.js).
- Layout: `.content` ocupa toda a largura (sem max-width); `.cards` é grelha responsiva auto-fill minmax(360px,1fr) — 1 coluna no telemóvel.
- UI: classes CSS do `Style()` em App.jsx (card, btn ember/ghost/danger, pill, segmented, section-head, hint, empty, modal/overlay, detail-grid, status…). Ferias.jsx tem estilos próprios prefixados `v` (FeriasStyle).
- Commits em português, mensagem descritiva; push para `main` = deploy.
