-- ────────────────────────────────────────────────────────────────────────────
-- EduGest — Tabela de Crachás
-- Execute este SQL no Supabase Studio (SQL Editor)
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.crachas (
    cod_matriz_aluno  bigint        primary key,
    status            text          not null default 'pendente'
                                    check (status in ('pendente','impresso','entregue')),
    data_impressao    timestamptz   null,
    data_entrega      timestamptz   null,
    obs               text          null,
    created_at        timestamptz   not null default now(),
    updated_at        timestamptz   not null default now()
);

-- Índice útil para filtrar por status
create index if not exists crachas_status_idx on public.crachas(status);

-- Trigger para atualizar updated_at automaticamente
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists crachas_updated_at on public.crachas;
create trigger crachas_updated_at
    before update on public.crachas
    for each row execute function public.set_updated_at();

-- Row Level Security (opcional, para Supabase anon key)
-- alter table public.crachas enable row level security;
-- create policy "allow all for authenticated" on public.crachas using (true);
