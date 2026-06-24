"use client";

import { hasSupabaseConfig, supabase } from "@/lib/supabase";
import { todayKey } from "@/lib/date";
import type { ElasticCheckIn, ElasticCheckInStatus, ElasticProfile } from "@/lib/elastic-types";

const PROFILE_KEY = "proof-elastic-profile";
const CHECKINS_KEY = "proof-elastic-checkins";
export const LIVE_ELASTIC_SCOPE = "live";

export type ElasticProfileInput = Omit<ElasticProfile, "updated_at">;

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function readLocalProfile() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PROFILE_KEY);
  return raw ? (JSON.parse(raw) as ElasticProfile) : null;
}

function writeLocalProfile(profile: ElasticProfile) {
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function readLocalCheckIns() {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(CHECKINS_KEY);
  return raw ? (JSON.parse(raw) as ElasticCheckIn[]) : [];
}

function writeLocalCheckIns(checkIns: ElasticCheckIn[]) {
  window.localStorage.setItem(CHECKINS_KEY, JSON.stringify(checkIns));
}

function isMissingScopeColumn(error: { message?: string; code?: string } | null) {
  return error?.code === "42703" || error?.message?.includes("scope");
}

export async function getElasticProfile(userId: string, scope = LIVE_ELASTIC_SCOPE) {
  if (!hasSupabaseConfig || !supabase) {
    const profile = readLocalProfile();
    return profile?.user_id === userId && (profile.scope ?? LIVE_ELASTIC_SCOPE) === scope ? profile : null;
  }

  const { data, error } = await supabase
    .from("elastic_profiles")
    .select("*")
    .eq("user_id", userId)
    .eq("scope", scope)
    .maybeSingle();
  if (isMissingScopeColumn(error) && scope === LIVE_ELASTIC_SCOPE) {
    const legacy = await supabase.from("elastic_profiles").select("*").eq("user_id", userId).maybeSingle();
    if (legacy.error) throw legacy.error;
    return legacy.data as ElasticProfile | null;
  }
  if (error) throw error;
  return data as ElasticProfile | null;
}

export async function saveElasticProfile(input: ElasticProfileInput) {
  const row: ElasticProfile = {
    scope: input.scope ?? LIVE_ELASTIC_SCOPE,
    ...input,
    updated_at: new Date().toISOString(),
  };

  if (!hasSupabaseConfig || !supabase) {
    writeLocalProfile(row);
    return row;
  }

  const { data, error } = await supabase.from("elastic_profiles").upsert(row).select("*").single();
  if (isMissingScopeColumn(error) && row.scope === LIVE_ELASTIC_SCOPE) {
    const { scope: _scope, ...legacyRow } = row;
    const legacy = await supabase.from("elastic_profiles").upsert(legacyRow).select("*").single();
    if (legacy.error) throw legacy.error;
    return legacy.data as ElasticProfile;
  }
  if (error) throw error;
  return data as ElasticProfile;
}

export async function updateElasticTasks(
  userId: string,
  tasks: Pick<ElasticProfile, "mini_task" | "plus_task" | "elite_task">,
  scope = LIVE_ELASTIC_SCOPE,
) {
  if (!hasSupabaseConfig || !supabase) {
    const current = readLocalProfile();
    if (!current || current.user_id !== userId || (current.scope ?? LIVE_ELASTIC_SCOPE) !== scope) return null;
    const next = { ...current, ...tasks, updated_at: new Date().toISOString() };
    writeLocalProfile(next);
    return next;
  }

  const { data, error } = await supabase
    .from("elastic_profiles")
    .update({ ...tasks, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("scope", scope)
    .select("*")
    .single();
  if (isMissingScopeColumn(error) && scope === LIVE_ELASTIC_SCOPE) {
    const legacy = await supabase
      .from("elastic_profiles")
      .update({ ...tasks, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .select("*")
      .single();
    if (legacy.error) throw legacy.error;
    return legacy.data as ElasticProfile;
  }
  if (error) throw error;
  return data as ElasticProfile;
}

export async function getElasticCheckIns(userId: string, scope = LIVE_ELASTIC_SCOPE) {
  if (!hasSupabaseConfig || !supabase) {
    return readLocalCheckIns().filter(
      (checkIn) => checkIn.user_id === userId && (checkIn.scope ?? LIVE_ELASTIC_SCOPE) === scope,
    );
  }

  const { data, error } = await supabase
    .from("elastic_checkins")
    .select("*")
    .eq("user_id", userId)
    .eq("scope", scope)
    .order("checkin_date", { ascending: true });
  if (isMissingScopeColumn(error) && scope === LIVE_ELASTIC_SCOPE) {
    const legacy = await supabase
      .from("elastic_checkins")
      .select("*")
      .eq("user_id", userId)
      .order("checkin_date", { ascending: true });
    if (legacy.error) throw legacy.error;
    return (legacy.data ?? []) as ElasticCheckIn[];
  }
  if (error) throw error;
  return (data ?? []) as ElasticCheckIn[];
}

export async function saveElasticCheckIn(input: {
  user_id: string;
  scope?: string;
  checkin_date?: string;
  result: ElasticCheckInStatus;
  memo?: string;
  self_narrative_detected?: boolean;
}) {
  const row: ElasticCheckIn = {
    id: createId("elastic_checkin"),
    user_id: input.user_id,
    scope: input.scope ?? LIVE_ELASTIC_SCOPE,
    checkin_date: input.checkin_date ?? todayKey(),
    result: input.result,
    memo: input.memo?.trim() || null,
    self_narrative_detected: input.self_narrative_detected ?? false,
    created_at: new Date().toISOString(),
  };

  if (!hasSupabaseConfig || !supabase) {
    const current = readLocalCheckIns();
    writeLocalCheckIns([
      ...current.filter(
        (checkIn) =>
          !(
            checkIn.user_id === row.user_id &&
            (checkIn.scope ?? LIVE_ELASTIC_SCOPE) === row.scope &&
            checkIn.checkin_date === row.checkin_date
          ),
      ),
      row,
    ]);
    return row;
  }

  await supabase
    .from("elastic_checkins")
    .delete()
    .eq("user_id", row.user_id)
    .eq("scope", row.scope)
    .eq("checkin_date", row.checkin_date);

  const { data, error } = await supabase.from("elastic_checkins").insert(row).select("*").single();
  if (isMissingScopeColumn(error) && row.scope === LIVE_ELASTIC_SCOPE) {
    const { scope: _scope, ...legacyRow } = row;
    await supabase.from("elastic_checkins").delete().eq("user_id", row.user_id).eq("checkin_date", row.checkin_date);
    const legacy = await supabase.from("elastic_checkins").insert(legacyRow).select("*").single();
    if (legacy.error) throw legacy.error;
    return legacy.data as ElasticCheckIn;
  }
  if (error) throw error;
  return data as ElasticCheckIn;
}

export async function deleteElasticScope(userId: string, scope: string) {
  if (!hasSupabaseConfig || !supabase) {
    const profile = readLocalProfile();
    if (profile?.user_id === userId && (profile.scope ?? LIVE_ELASTIC_SCOPE) === scope) {
      window.localStorage.removeItem(PROFILE_KEY);
    }
    writeLocalCheckIns(
      readLocalCheckIns().filter(
        (checkIn) => !(checkIn.user_id === userId && (checkIn.scope ?? LIVE_ELASTIC_SCOPE) === scope),
      ),
    );
    return;
  }

  const checkIns = await supabase.from("elastic_checkins").delete().eq("user_id", userId).eq("scope", scope);
  if (checkIns.error) throw checkIns.error;
  const profile = await supabase.from("elastic_profiles").delete().eq("user_id", userId).eq("scope", scope);
  if (profile.error) throw profile.error;
}
