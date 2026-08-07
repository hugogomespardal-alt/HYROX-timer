-- ===========================================================================
--  HYROX Simulation Timer — CrossFit Viseu
--  Sincronização entre dispositivos (Supabase)
--
--  É ISTO que a aplicação usa para o "Cenário B": um ecrã/TV que é um aparelho
--  SEPARADO do que cronometra. Basta esta tabela — simples e suficiente.
--  (O ficheiro supabase_schema.sql, relacional, é apenas uma referência avançada
--   e NÃO é necessário para a sincronização da app.)
--
--  Passos:
--    1. Cria um projeto grátis em https://supabase.com
--    2. Abre o SQL Editor e executa este ficheiro.
--    3. Em Project Settings → API, copia o "Project URL" e a chave "anon public".
--    4. Na app: Admin → Sincronização entre dispositivos → cola URL e chave,
--       escolhe um "Código da sessão" (igual em todos os dispositivos) e liga.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- Uma linha por prova/sessão. A app guarda aqui o estado completo (JSON) e usa
-- um número de revisão crescente (rev) para saber qual é a versão mais recente.
create table if not exists sessions (
  id          text primary key,           -- código da sessão (ex.: cfv-simulacao-2026)
  data        jsonb  not null default '{}',-- estado completo da prova
  rev         bigint not null default 0,   -- revisão (last-write-wins)
  device      text,                        -- identificador do dispositivo que gravou
  updated_at  timestamptz default now()
);

-- Privilégios para a chave anónima (leitura/escrita nesta tabela).
grant usage on schema public to anon, authenticated;
grant all on table sessions to anon, authenticated;

-- RLS permissiva: adequado a uma prova interna com a anon key.
-- (Para uso público/permanente, restringe conforme necessário.)
alter table sessions enable row level security;
drop policy if exists p_sessions_all on sessions;
create policy p_sessions_all on sessions
  for all using (true) with check (true);

-- (Opcional) Realtime: a app já faz polling a cada 1,5 s, por isso NÃO é
-- obrigatório. Se quiseres ativar mesmo assim:
--   Database → Replication → ativa a tabela "sessions".

-- Teste rápido (deve devolver 0 linhas, sem erro):
-- select * from sessions;
-- ===========================================================================
