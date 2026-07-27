# GrillHub — Contexto para o Claude

Plataforma do grupo de amigos "Grill" (David / grill1385): eventos, presenças, membros, cargos, contas partilhadas e férias.

## Acesso ao código

- Repo: `https://github.com/grill1385/grill-hub.git` (privado)
- Para trabalhar: pedir ao David um fine-grained PAT read/write de curta duração e clonar. Nunca guardar o token em ficheiros nem no repo.
- Site: https://grill1385.github.io/grill-hub/ — deploy automático via GitHub Actions a cada push para `main` (+ 2x/dia para regenerar páginas de partilha OG).

## Stack e arquitetura

- React 18 + Vite, SPA. `src/App.jsx` (componente App + todos os modais; inclui streaks de presença — `streakTier` colore a chama: >=30 violeta rosado, >=10 azul, >=6 vermelho, >=3 laranja, >=1 âmbar), `src/Ferias.jsx` (aba Férias), `src/Media.jsx` (aba Media), `src/api.js` (todo o acesso ao Supabase — exporta `api`, `feriasApi`, `mediaApi`), `src/main.jsx`.
- Backend: Supabase (`noperkfdcdairrpnomrs.supabase.co`) — Postgres + Auth (email/password e Google) + Storage (bucket público `grill`) + Edge Functions (`notify-event`, `event-og`, `resolve-maps`).
- RLS: leitura pública em tudo; escrita só admins (`is_admin()`/`is_main_admin()` sobre o email do JWT), exceto tabelas de férias (escrita também para membros via `is_member()`), e RPCs `update_my_profile`/`set_my_confirmation` para o próprio membro.
- Migrações em `supabase/*.sql` — correm-se manualmente no SQL Editor (uma vez cada): `setup-auth.sql`, `setup-perfil-rsvp.sql`, `setup-contas-storage.sql`, `setup-melhorias.sql`, `setup-ferias.sql`, `setup-ferias-confirmacoes.sql`, `setup-ferias-transporte-geral.sql`, `setup-ferias-contas.sql`, `setup-media.sql`, `setup-contas-pagamentos.sql`, `setup-contas-parcelas.sql`, `setup-aniversarios.sql`, `setup-vergonha.sql`.
- GitHub Actions: `deploy.yml` (Pages + `scripts/generate-share-pages.mjs` com sharp), `lembretes.yml` (diário 08:00 UTC: `send-reminders.mjs` 3 dias antes de eventos — só a quem ainda não confirmou presença + `send-debt-reminders.mjs` dívidas; emails via Brevo, secret `BREVO_API_KEY`, sender grillfeup@gmail.com), `keep-alive.yml` (2x/semana ping ao Supabase).

## Dados (tabelas)

- `members` (id, name, email, birth_date, join_date, role_id, username, avatar_url) — conta liga-se a membro por email igual.
- `events` (datas, status "Por planear/Agendado/Concluído", `presences` jsonb, `confirmations` jsonb RSVP), `roles` (label, level), `admins` (email, is_main), `purchases` (contas por evento, split equal/custom, settled, claimed, receipts), `profiles` (contas auth pendentes de ligação).
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

## Contas — fluxo de pagamento (eventos e férias, jul 2026)

- Qualquer membro cria compras, mas só consigo próprio como credor (payer bloqueado na UI; RLS "membro cria como credor"/"membro edita as suas" em `purchases` exige payer_member_id = my_member_id(); em `vacation_purchases` a política de membros já cobria). O credor edita/elimina as suas compras; admins tudo.
- Devedor marca "já paguei" → `claimed[mid]=true` via RPCs `claim_my_payment`/`claim_my_vacation_payment` (só participantes, bloqueado se já saldado). `claimed` fica FORA de fromPurchase/fromVPurchase (só muda via RPC, para upserts não pisarem). Pill tracejada dourada "pagou? por confirmar" (.pill.claim).
- Credor (ou admin) confirma → settled (upsert normal). Devedor com claimed deixa de ser notificado (Home, mailto de lembrete e send-debt-reminders.mjs ignoram claimed); na Home do credor aparece "Pagamentos a confirmar" (secção no painel Contas, botão Confirmar).

## Aniversários (Home, jul 2026)

- Tabela `birthday_wishes` (member_id = aniversariante, from_member_id, year, message, emailed_at; unique por trio; RLS: leitura pública, membro escreve os seus). Carregada tolerantemente no api.loadAll (`wishes`).
- Email do desejo: Edge Function `birthday-wish` (Brevo, autoriza via my_member_id = from_member_id; marca emailed_at; reenviar um desejo limpa emailed_at). Checkbox no modal + botão «Enviar também por email 📧» na Home para desejos já feitos sem email (aniversariante precisa de email).
- Emojis tipo Discord: mapa EMOJI + `emojify()` em App.jsx converte `:nome:` (EN e PT, ex.: :fire:/:fogo:, :festa:, :bolo:) ao guardar, com pré-visualização no modal.
- HomeTab (painel Contas, no fim): banner «Feliz aniversário» com emojis para o próprio no dia (por mês-dia de birth_date) + desejos recebidos do ano; para os outros membros: lembrete no dia com botão «Desejar parabéns» (modal com mensagem opcional, upsert 1/ano) e lembrete 1 semana antes (sem botão).

## Estado atual / pendentes

- Aba Férias publicada (commit 2ddb592, jul 2026). Pré-requisito: `setup-ferias.sql` corrido no SQL Editor — confirmar com o David se já foi feito.
- Confirmações de participação nas férias (jul 2026). Pré-requisito: `setup-ferias-confirmacoes.sql` corrido no SQL Editor — confirmar com o David.
- Transportes gerais + mapa do roteiro (jul 2026). Pré-requisito: `setup-ferias-transporte-geral.sql` corrido no SQL Editor — confirmar com o David.
- Contas das férias (jul 2026). Pré-requisito: `setup-ferias-contas.sql` corrido no SQL Editor — confirmar com o David.
- Fluxo "já paguei"→confirmação + compras por membros (jul 2026). Pré-requisito: `setup-contas-pagamentos.sql` corrido no SQL Editor — confirmar com o David.
- Parcelas + importação Excel de compras (jul 2026). Pré-requisito: `setup-contas-parcelas.sql` corrido no SQL Editor — confirmar com o David.
- «Envergonha» (jul 2026). Pré-requisito: `setup-vergonha.sql` corrido no SQL Editor — confirmar com o David.
- Aniversários na Home (jul 2026). Pré-requisitos: `setup-aniversarios.sql` corrido no SQL Editor (se corrido antes da opção de email, só a linha `alter ... emailed_at`) e Edge Function `birthday-wish` criada no painel do Supabase — confirmar com o David.
- As 3 férias antigas existem como eventos normais; o David vai registá-las também nas Férias só para histórico. As férias de 2026 (destino: Balcãs) estão em planeamento ativo.

## Convenções

- Media (aba, `src/Media.jsx`): 3 secções (documentos, manga, fotos) sobre a tabela `media_entries` (árvore: parent_id, kind folder/file, title, url, mime, size_bytes, uploaded_by, created_at). Ficheiros no bucket `grill` em `media/<section>/<id>.<ext>`. Escrita: documentos e manga só admins; fotos qualquer membro (RLS `escrita media`). Blocos com título e data e ícones SVG vetorizados (MIcon: folder/doc/pdf/photo/book); pastas aninháveis sem limite; viewer com imagem/PDF (iframe), abrir e descarregar. Suporta imagens, vídeos (fotos: image/*,video/*; thumbnail = 1º frame + play; viewer com <video>) e PDF. O mangá usa a capa `public/manga-cover.png` como thumbnail (secção e ficheiros não-imagem), com fallback para o ícone de livro se o ficheiro não existir. Pré-requisito: `setup-media.sql` corrido no SQL Editor.
- Upload em massa: `scripts/bulk-upload-media.mjs` (corre localmente) faz login por email/password (Supabase Auth, respeita RLS) e envia uma pasta inteira para a Media, replicando subpastas — útil p.ex. para stories exportados do Instagram (via "Descarregar as tuas informações" da Meta).
- Contas — compensação de dívidas (`pairwiseNet` em App.jsx): junta as dívidas por saldar e não-reclamadas entre cada par de membros e mostra só a diferença líquida, na direção certa (quem fica a receber é considerado saldado). Não reencaminha por terceiros. No EventDetailModal aparece o resumo discreto "Saldos a acertar"; na Home de cada membro mostra-se o net a pagar por credor, somado em todos os eventos, com total.
- Parcelas (split custom, eventos e férias): coluna `parcels` jsonb = [{id, name, price, members[]}]; cada parcela divide o preço pelos membros associados (associação opcional — «por atribuir»); shareOf (App.jsx, Ferias.jsx e send-debt-reminders.mjs) soma parcelas quando existem, senão usa `shares` (compras antigas mantêm a grelha manual — legacyShares). Total e participants derivados das parcelas no submit. Formulários com editor de parcelas; cartões mostram linha de parcelas.
- Importação de compras por Excel: botão «Importar Excel» (admins) nas Contas do evento → ImportPurchasesModal; template `public/template-compras.xlsx` (folhas Compras+Instruções; linhas «(exemplo)» ignoradas; divisão «todos» = 1 linha, «parcelas» = 1 linha por parcela com o mesmo nome de Compra; Membros e Pagador opcionais — pagador vazio = admin que importa; erros bloqueiam a importação).
- «Saldos a acertar» (pairwiseNet) também na sub-aba Contas das férias (Ferias.jsx tem cópia própria de pairwiseNet).
- pairwiseNet do App.jsx (eventos) devolve também items (dívidas do devedor por evento/compra, com data do evento), offsets (a abater) e since (evento mais antigo); idade = daysSince(since). A cópia das Férias mantém a versão simples.
- Home: «Contas a receber 💰» (net por par) com idade («há X dias») também no «a pagar»; botão «Enviar lembrete por email 📧» (mailto do próprio credor) com descritivo por evento/compra e compensações.
- Células de contas na Home são clicáveis → DebtDetailModal (dívidas por evento/compra, abatimentos e líquido).
- «Envergonha» 😳: tabela `debt_shames` (member_id = envergonhado, from_member_id, amount, creditors jsonb nomes, day, cleared; unique member/from/day = 1x por dia; RLS: leitura pública, insert from=my_member_id e ≠ target, update/clear só o envergonhado). Botão no tooltip do DebtBadge; notificação .shame-note na Home do devedor (acima dos aniversários) com ✕ para limpar (cleared=true); erro 23505 = já envergonhou hoje. Carregada tolerantemente (`shames`).
- Scoreboard: DebtBadge público (€) junto ao nome para dívidas líquidas com ≥7 dias — amarelo 7d, laranja 15d, vermelho 30d, preto brilhante 60d (t7/t15/t30/t60); hover mostra a quem deve, quanto e desde quando (só compras de eventos; férias não entram).
- Links curtos do Google Maps (maps.app.goo.gl) não têm coords no cliente → Edge Function `resolve-maps` (sem secrets) segue o redirecionamento e devolve lat/lng; `api.resolveMaps` chama-a. `saveEventPlace` expande o link ao gravar (guarda URL com `query=lat,lng`); o gestor de localização usa-a como fallback. Sem a função, links curtos falham (usar link completo ou clique no mapa).
- Locais recorrentes (`event_places`: name, url Google Maps obrigatório; RLS escrita admin, leitura pública). Geridos em Gestão › Gestão de eventos (adicionar/remover). Disponíveis para o admin escolher ao associar localização e para qualquer membro escolher no formulário de novo evento (preenche location + locationUrl). Pré-requisito: `setup-eventos-locais.sql`.
- Estatísticas dos Eventos (`src/Stats.jsx`, vista "Estatísticas", recharts): KPIs + eventos por ano (bar), distribuição por mês (pie), top 5 locais (bar), presenças médias por ano (line) e evolução dos locais ao longo dos anos (multi-line com seletor de locais a comparar). Usa data.events (ignora filtros da lista).
- Locais recorrentes editáveis: ao mudar nome/link de um local, `saveEventPlace` faz cascata — atualiza os eventos cujo locationUrl+location batem com o registo antigo (sem coluna nova; associação por correspondência).
- Pesquisa de eventos (`EventSearch` em EventsExtra): input com dropdown de pré-visualização (nome normalizado, sem acentos) — na filter-bar dos Eventos (abre o detalhe) e no topo do gestor da Gestão (seleciona qualquer evento para editar localização).
- Gestão de eventos: além dos "por associar", pode editar a localização de eventos já colocados (clicar no ponto do mapa ou pesquisar) e abrir o editor completo do evento via "Editar todos os dados" (onEditEvent → EventFormModal).
- Eventos — vistas: Lista, Friso temporal, Calendário e Mapa (`src/EventsExtra.jsx`, Leaflet + tiles Carto dark). Coordenadas: `extractLatLng` de um link Google Maps (@lat,lng, query=, !3d!4d) ou geocoding do texto da localização via Nominatim (cache localStorage `grill-geo:*`). Mapa agrupa eventos por local (bola clicável → lista de eventos aí). Gestão › "Gestão de eventos": lista de eventos sem localização + mapa; admin seleciona um evento e associa por link ou clique no mapa (grava location + locationUrl com coords), saindo da lista. Não precisa de migração SQL.
- Eventos: horas opcionais `time_start`/`time_end` ("HH:MM"). `getStatus` conclui o evento após a hora de fim no dia final (ou no fim do dia se não houver hora). `fmtDateRange(ev)` formata data+horas nos cartões e detalhe.
- Tudo em PT-PT, tom informal (ex.: "Casinha", "A acender a brasa…").
- IDs: `uid()` aleatório em texto; BD snake_case ↔ app camelCase (converters em api.js).
- Layout: `.content` ocupa toda a largura (sem max-width); `.cards` é grelha responsiva auto-fill minmax(360px,1fr) — 1 coluna no telemóvel.
- UI: classes CSS do `Style()` em App.jsx (card, btn ember/ghost/danger, pill, segmented, section-head, hint, empty, modal/overlay, detail-grid, status…). Ferias.jsx tem estilos próprios prefixados `v` (FeriasStyle).
- Commits em português, mensagem descritiva; push para `main` = deploy.
