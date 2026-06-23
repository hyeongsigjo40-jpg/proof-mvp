create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  habit_name text not null,
  usual_breakdown_context text not null,
  usual_breakdown_behavior text not null,
  goal_picture text,
  failure_picture text,
  action_code jsonb,
  feedback_loop text,
  onboarded_at timestamptz not null default now()
);

create table if not exists public.daily_plans (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  plan_text text not null,
  minimum_plan_text text,
  created_at timestamptz not null default now()
);

create table if not exists public.check_ins (
  id text primary key,
  plan_id text not null references public.daily_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  result text not null check (result in ('done', 'partial', 'not_done')),
  context_text text,
  created_at timestamptz not null default now()
);

create table if not exists public.pattern_insights (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pattern_summary text not null,
  generated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.daily_plans enable row level security;
alter table public.check_ins enable row level security;
alter table public.pattern_insights enable row level security;

create policy "profiles are owned by user"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "plans are owned by user"
  on public.daily_plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "check-ins are owned by user"
  on public.check_ins for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "insights are owned by user"
  on public.pattern_insights for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists daily_plans_user_date_idx on public.daily_plans(user_id, date desc);
create index if not exists check_ins_user_created_idx on public.check_ins(user_id, created_at desc);
create index if not exists pattern_insights_user_generated_idx on public.pattern_insights(user_id, generated_at desc);
