alter table public.elastic_profiles
  add column if not exists scope text not null default 'live';

alter table public.elastic_checkins
  add column if not exists scope text not null default 'live';

alter table public.elastic_profiles
  drop constraint if exists elastic_profiles_pkey;

alter table public.elastic_profiles
  add constraint elastic_profiles_pkey primary key (user_id, scope);

alter table public.elastic_checkins
  drop constraint if exists elastic_checkins_user_id_checkin_date_key;

alter table public.elastic_checkins
  drop constraint if exists elastic_checkins_user_scope_checkin_date_key;

alter table public.elastic_checkins
  add constraint elastic_checkins_user_scope_checkin_date_key unique (user_id, scope, checkin_date);

create index if not exists elastic_profiles_user_scope_idx
  on public.elastic_profiles(user_id, scope);

create index if not exists elastic_checkins_user_scope_date_idx
  on public.elastic_checkins(user_id, scope, checkin_date desc);
