-- Persist in-progress onboarding and daily chat state.
-- Run after supabase-elastic-debug-scope-migration.sql.

alter table public.elastic_profiles
  add column if not exists last_onboarding_step text,
  add column if not exists draft_state jsonb;
