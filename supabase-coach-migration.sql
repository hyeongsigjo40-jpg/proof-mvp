alter table public.profiles
  add column if not exists goal_picture text,
  add column if not exists failure_picture text,
  add column if not exists action_code jsonb,
  add column if not exists feedback_loop text,
  add column if not exists kakao_linked boolean not null default false,
  add column if not exists kakao_access_token text,
  add column if not exists kakao_refresh_token text,
  add column if not exists checkin_time time not null default '21:00';

alter table public.check_ins
  drop constraint if exists check_ins_result_check;

alter table public.check_ins
  add constraint check_ins_result_check
  check (result in ('done', 'partial', 'not_done', 'no_response'));
