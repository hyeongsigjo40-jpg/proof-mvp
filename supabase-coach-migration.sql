alter table public.profiles
  add column if not exists goal_picture text,
  add column if not exists failure_picture text,
  add column if not exists action_code jsonb,
  add column if not exists feedback_loop text;
