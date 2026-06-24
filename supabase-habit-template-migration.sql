-- SMART 습관 템플릿 필드 마이그레이션
-- supabase-goal-migration.sql 이후 실행

alter table public.elastic_profiles
  add column if not exists habit_action text,
  add column if not exists habit_period text,
  add column if not exists habit_frequency text,
  add column if not exists habit_when text,
  add column if not exists habit_amount text;

-- monthly_vision nullable로 변경 (더 이상 필수 필드 아님)
alter table public.elastic_profiles
  alter column monthly_vision drop not null;
