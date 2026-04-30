create table if not exists public.missions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  goal text not null,
  budget numeric(10,2) not null default 0,
  charter_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mission_logs (
  id bigserial primary key,
  mission_id uuid not null references public.missions(id) on delete cascade,
  line text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.plugin_installs (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plugin_name text not null,
  installed_at timestamptz not null default now(),
  unique (user_id, plugin_name)
);

create table if not exists public.billing_snapshots (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  threshold_usd numeric(10,2) not null default 0,
  current_spend_usd numeric(10,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.missions enable row level security;
alter table public.mission_logs enable row level security;
alter table public.plugin_installs enable row level security;
alter table public.billing_snapshots enable row level security;

create policy if not exists "missions_select_own"
on public.missions for select
to authenticated
using (auth.uid() = user_id);

create policy if not exists "missions_insert_own"
on public.missions for insert
to authenticated
with check (auth.uid() = user_id);

create policy if not exists "missions_update_own"
on public.missions for update
to authenticated
using (auth.uid() = user_id);

create policy if not exists "mission_logs_select_own"
on public.mission_logs for select
to authenticated
using (
  exists (
    select 1 from public.missions m
    where m.id = mission_id and m.user_id = auth.uid()
  )
);

create policy if not exists "mission_logs_insert_own"
on public.mission_logs for insert
to authenticated
with check (
  exists (
    select 1 from public.missions m
    where m.id = mission_id and m.user_id = auth.uid()
  )
);

create policy if not exists "plugins_select_own"
on public.plugin_installs for select
to authenticated
using (auth.uid() = user_id);

create policy if not exists "plugins_insert_own"
on public.plugin_installs for insert
to authenticated
with check (auth.uid() = user_id);

create policy if not exists "billing_select_own"
on public.billing_snapshots for select
to authenticated
using (auth.uid() = user_id);

create policy if not exists "billing_insert_own"
on public.billing_snapshots for insert
to authenticated
with check (auth.uid() = user_id);
