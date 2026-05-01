create table if not exists public.activity_events (
  id bigserial primary key,
  mission_id uuid references public.missions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  ts timestamptz not null default now()
);

create index if not exists activity_events_mission_idx on public.activity_events (mission_id, ts);

alter table public.activity_events enable row level security;

create policy "activity_events_select_own" on public.activity_events
  for select to authenticated using (auth.uid() = user_id);
