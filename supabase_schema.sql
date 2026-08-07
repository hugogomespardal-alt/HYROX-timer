-- ===========================================================================
--  HYROX Simulation Timer — CrossFit Viseu
--  Estrutura da base de dados (PostgreSQL / Supabase)
--
--  A aplicação funciona 100% offline com armazenamento local. Este script é
--  OPCIONAL e serve para sincronização entre vários dispositivos via Supabase.
--  Executa-o no editor SQL do teu projeto Supabase.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
create table if not exists provas (
  id           text primary key,
  name         text not null,
  genero       text,
  categoria    text,
  stations     jsonb not null default
               '["skierg","sledpush","sledpull","burpees","row","farmers","sandbag","wallballs"]',
  created_at   timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- VAGAS DE PARTIDA
-- ---------------------------------------------------------------------------
create table if not exists vagas (
  id             text primary key,
  nome           text not null,
  hora_prevista  text,
  athletes       jsonb not null default '[]',   -- lista de ids de atletas
  created_at     timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- ATLETAS
-- ---------------------------------------------------------------------------
create table if not exists atletas (
  id             text primary key,
  nome           text not null,
  dorsal         text,
  prova_id       text references provas(id),
  genero         text,
  categoria      text,
  vaga_id        text references vagas(id),
  hora_prevista  text,
  pista          text,
  obs            text,
  status         text not null default 'nao_iniciado',
  -- estados: nao_iniciado, em_corrida, em_estacao, terminado,
  --          aguardar_validacao, validado, DNS, DNF, desclassificado
  marks          jsonb not null default '[]',   -- timestamps (ms epoch) por ponto de registo
  history        jsonb not null default '[]',   -- alterações aos dados do atleta
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_atletas_prova on atletas(prova_id);
create index if not exists idx_atletas_vaga  on atletas(vaga_id);

-- ---------------------------------------------------------------------------
-- REGISTOS DE CRONOMETRAGEM (log imutável — nunca apagar)
-- ---------------------------------------------------------------------------
create table if not exists registos (
  id           uuid primary key default gen_random_uuid(),
  atleta_id    text references atletas(id),
  point        int  not null,          -- índice do ponto de registo (0..2N)
  point_label  text,
  value_ms     bigint not null,        -- hora exata do clique (ms epoch)
  operador     text,
  device       text,
  created_at   timestamptz default now()
);
create index if not exists idx_registos_atleta on registos(atleta_id);

-- ---------------------------------------------------------------------------
-- PENALIZAÇÕES
-- ---------------------------------------------------------------------------
create table if not exists penalty_types (
  id       text primary key,
  label    text not null,
  seconds  int not null default 0,
  per      text
);

create table if not exists penalizacoes (
  id           text primary key,
  atleta_id    text references atletas(id),
  target       text,          -- 'Geral' | 'Corrida N' | nome da estação
  type_id      text,
  type_label   text,
  count        int  not null default 1,
  seconds      int  not null default 0,   -- segundos por ocorrência
  total        int  not null default 0,   -- count * seconds
  juiz         text,
  obs          text,
  created_at   timestamptz default now()
);
create index if not exists idx_pen_atleta on penalizacoes(atleta_id);

-- ---------------------------------------------------------------------------
-- AUDITORIA (histórico completo — registos, correções, undo, estados)
-- ---------------------------------------------------------------------------
create table if not exists auditoria (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,   -- registo|undo|correcao|penalizacao|estado|edicao|criacao|import
  atleta_id    text,
  point        int,
  point_label  text,
  from_ms      bigint,
  to_ms        bigint,
  removed_ms   bigint,
  motivo       text,
  note         text,
  operador     text,
  device       text,
  created_at   timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- updated_at automático nos atletas
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

drop trigger if exists trg_atletas_touch on atletas;
create trigger trg_atletas_touch before update on atletas
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- SEED — 4 provas, tipos de penalização, 2 vagas, 8 atletas de teste
-- ---------------------------------------------------------------------------
insert into provas (id,name,genero,categoria) values
  ('pf_pro','Individual Feminino PRO','F','PRO'),
  ('pf_half','Individual Feminino HALF','F','HALF'),
  ('pm_pro','Individual Masculino PRO','M','PRO'),
  ('pm_half','Individual Masculino HALF','M','HALF')
on conflict (id) do nothing;

insert into penalty_types (id,label,seconds,per) values
  ('p_run','Erro no percurso da corrida',120,'ocorrência'),
  ('p_sled','Sled não ultrapassar a linha',30,'ocorrência'),
  ('p_burpee','Burpee Broad Jump inválido',30,'repetição'),
  ('p_custom','Penalização personalizada',0,'segundos definidos')
on conflict (id) do nothing;

insert into vagas (id,nome,hora_prevista,athletes) values
  ('vaga1','Vaga 1 — 09:00','09:00','["a101","a102","a111","a201"]'),
  ('vaga2','Vaga 2 — 09:20','09:20','["a112","a202","a211","a212"]')
on conflict (id) do nothing;

insert into atletas (id,nome,dorsal,prova_id,genero,categoria,vaga_id,hora_prevista,pista) values
  ('a101','Ana Marques','101','pf_pro','F','PRO','vaga1','09:00','1'),
  ('a102','Rita Sousa','102','pf_pro','F','PRO','vaga1','09:00','2'),
  ('a111','Sofia Nunes','111','pf_half','F','HALF','vaga1','09:00','3'),
  ('a112','Carla Dias','112','pf_half','F','HALF','vaga2','09:20','1'),
  ('a201','Bruno Lima','201','pm_pro','M','PRO','vaga1','09:00','4'),
  ('a202','João Guerra','202','pm_pro','M','PRO','vaga2','09:20','2'),
  ('a211','Rafael Costa','211','pm_half','M','HALF','vaga2','09:20','3'),
  ('a212','Filipe Cruz','212','pm_half','M','HALF','vaga2','09:20','4')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS (Row Level Security) — ajusta às tuas necessidades.
-- Para uma prova interna basta uma policy permissiva com a anon key.
-- Em produção, restringe por utilizador autenticado.
-- ---------------------------------------------------------------------------
alter table provas        enable row level security;
alter table vagas         enable row level security;
alter table atletas       enable row level security;
alter table registos      enable row level security;
alter table penalty_types enable row level security;
alter table penalizacoes  enable row level security;
alter table auditoria     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['provas','vagas','atletas','registos','penalty_types','penalizacoes','auditoria']
  loop
    execute format('drop policy if exists p_all on %I;', t);
    execute format('create policy p_all on %I for all using (true) with check (true);', t);
  end loop;
end $$;

-- Realtime (sincronização entre dispositivos):
--   No painel Supabase → Database → Replication, ativa as tabelas acima.
-- ===========================================================================
