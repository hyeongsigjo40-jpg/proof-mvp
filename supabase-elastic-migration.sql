create table if not exists public.elastic_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  habit_name text not null,
  identity_motive text not null,
  motive_summary text,
  recent_failure_date text,
  pre_breakdown_feeling text,
  actual_breakdown_behavior text,
  recovery_method text,
  mini_task text not null,
  plus_task text not null,
  elite_task text not null,
  monthly_vision text not null,
  onboarding_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.elastic_checkins (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null,
  result text not null check (result in ('mini', 'plus', 'elite', 'not_done', 'no_response')),
  memo text,
  self_narrative_detected boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);

alter table public.elastic_profiles enable row level security;
alter table public.elastic_checkins enable row level security;

drop policy if exists "elastic profiles are owned by user" on public.elastic_profiles;
drop policy if exists "elastic checkins are owned by user" on public.elastic_checkins;

create policy "elastic profiles are owned by user"
  on public.elastic_profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "elastic checkins are owned by user"
  on public.elastic_checkins for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists elastic_checkins_user_date_idx
  on public.elastic_checkins(user_id, checkin_date desc);
