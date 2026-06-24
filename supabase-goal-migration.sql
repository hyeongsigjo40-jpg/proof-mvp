-- Goal fields migration for elastic_profiles
-- Run this in Supabase SQL Editor after supabase-elastic-migration.sql

alter table public.elastic_profiles
  add column if not exists life_area text,
  add column if not exists why_change text,
  add column if not exists identity_statement text;
