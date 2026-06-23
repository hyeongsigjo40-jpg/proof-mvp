"use client";

import { generatePatternSummary } from "@/lib/patterns";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";
import { todayKey, tomorrowKey } from "@/lib/date";
import type { CheckIn, CheckInResult, DailyPlan, PatternInsight, Profile, RecordItem } from "@/types/proof";

const DEMO_USER_ID = "demo-user";
const STORAGE_KEY = "proof-mvp-store";

type LocalState = {
  profile: Profile | null;
  plans: DailyPlan[];
  checkIns: CheckIn[];
  insights: PatternInsight[];
};

type OnboardingInput = {
  habit_name: string;
  usual_breakdown_context: string;
  usual_breakdown_behavior: string;
  goal_picture?: string | null;
  failure_picture?: string | null;
  action_code?: string[] | null;
  feedback_loop?: string | null;
  kakao_linked?: boolean;
  checkin_time?: string;
};

type PlanInput = {
  plan_text: string;
  minimum_plan_text?: string;
  date?: string;
};

type CheckInInput = {
  plan_id: string;
  result: CheckInResult;
  context_text?: string;
};

const initialState: LocalState = {
  profile: null,
  plans: [],
  checkIns: [],
  insights: [],
};

function readLocalState(): LocalState {
  if (typeof window === "undefined") {
    return initialState;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return initialState;
  }

  try {
    return JSON.parse(raw) as LocalState;
  } catch {
    return initialState;
  }
}

function writeLocalState(state: LocalState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function getCurrentUserId() {
  if (!hasSupabaseConfig || !supabase) {
    return DEMO_USER_ID;
  }

  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function signInWithEmail(email: string) {
  if (!supabase) {
    return;
  }

  const redirectTo = `${window.location.origin}/`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });

  if (error) {
    throw error;
  }
}

export async function signOut() {
  if (supabase) {
    await supabase.auth.signOut();
  }
}

export async function getProfile(userId: string) {
  if (!hasSupabaseConfig || !supabase) {
    return readLocalState().profile;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, habit_name, usual_breakdown_context, usual_breakdown_behavior, goal_picture, failure_picture, action_code, feedback_loop, kakao_linked, checkin_time, onboarded_at",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data as Profile | null;
}

export async function saveProfile(userId: string, input: OnboardingInput) {
  const profile: Profile = {
    id: userId,
    habit_name: input.habit_name,
    usual_breakdown_context: input.usual_breakdown_context,
    usual_breakdown_behavior: input.usual_breakdown_behavior,
    goal_picture: input.goal_picture ?? null,
    failure_picture: input.failure_picture ?? null,
    action_code: input.action_code ?? null,
    feedback_loop: input.feedback_loop ?? null,
    kakao_linked: input.kakao_linked ?? false,
    checkin_time: input.checkin_time ?? "21:00",
    onboarded_at: new Date().toISOString(),
  };

  if (!hasSupabaseConfig || !supabase) {
    const state = readLocalState();
    writeLocalState({ ...state, profile });
    return profile;
  }

  const { data, error } = await supabase
    .from("profiles")
    .upsert(profile)
    .select(
      "id, habit_name, usual_breakdown_context, usual_breakdown_behavior, goal_picture, failure_picture, action_code, feedback_loop, kakao_linked, checkin_time, onboarded_at",
    )
    .single();
  if (error) {
    throw error;
  }
  return data as Profile;
}

export async function getLatestInsight(userId: string) {
  if (!hasSupabaseConfig || !supabase) {
    return readLocalState().insights.at(-1) ?? null;
  }

  const { data, error } = await supabase
    .from("pattern_insights")
    .select("*")
    .eq("user_id", userId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data as PatternInsight | null;
}

export async function getTodayPlan(userId: string) {
  return getPlanForDate(userId, todayKey());
}

export async function getTomorrowPlan(userId: string) {
  return getPlanForDate(userId, tomorrowKey());
}

export async function getPlanForDate(userId: string, date: string) {
  if (!hasSupabaseConfig || !supabase) {
    return (
      readLocalState()
        .plans.filter((plan) => plan.user_id === userId && plan.date === date)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
    );
  }

  const { data, error } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data as DailyPlan | null;
}

export async function savePlan(userId: string, input: PlanInput) {
  const date = input.date ?? todayKey();
  const plan: DailyPlan = {
    id: createId("plan"),
    user_id: userId,
    date,
    plan_text: input.plan_text,
    minimum_plan_text: input.minimum_plan_text?.trim() || null,
    created_at: new Date().toISOString(),
  };

  if (!hasSupabaseConfig || !supabase) {
    const state = readLocalState();
    writeLocalState({
      ...state,
      plans: [...state.plans.filter((item) => !(item.user_id === userId && item.date === date)), plan],
    });
    return plan;
  }

  await supabase.from("daily_plans").delete().eq("user_id", userId).eq("date", date);

  const { data, error } = await supabase.from("daily_plans").insert(plan).select("*").single();
  if (error) {
    throw error;
  }
  return data as DailyPlan;
}

export async function getPendingCheckInPlan(userId: string) {
  const plan = await getTodayPlan(userId);
  if (!plan) {
    return null;
  }

  const checkIn = await getCheckInForPlan(plan.id);
  return checkIn ? null : plan;
}

export async function getCheckInForPlan(planId: string) {
  if (!hasSupabaseConfig || !supabase) {
    return readLocalState().checkIns.find((checkIn) => checkIn.plan_id === planId) ?? null;
  }

  const { data, error } = await supabase.from("check_ins").select("*").eq("plan_id", planId).maybeSingle();
  if (error) {
    throw error;
  }
  return data as CheckIn | null;
}

export async function saveCheckIn(userId: string, input: CheckInInput) {
  const checkIn: CheckIn = {
    id: createId("check"),
    user_id: userId,
    plan_id: input.plan_id,
    result: input.result,
    context_text: input.context_text?.trim() || null,
    created_at: new Date().toISOString(),
  };

  if (!hasSupabaseConfig || !supabase) {
    const state = readLocalState();
    const checkIns = [...state.checkIns, checkIn];
    const insight = createInsightIfReady(userId, checkIns, state.insights);
    writeLocalState({
      ...state,
      checkIns,
      insights: insight ? [...state.insights, insight] : state.insights,
    });
    return checkIn;
  }

  const { data, error } = await supabase.from("check_ins").insert(checkIn).select("*").single();
  if (error) {
    throw error;
  }

  await createRemoteInsightIfReady(userId);
  return data as CheckIn;
}

export async function getRecords(userId: string) {
  await ensureNoResponseForPastPlans(userId);

  if (!hasSupabaseConfig || !supabase) {
    const state = readLocalState();
    return state.plans
      .filter((plan) => plan.user_id === userId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
      .map((plan) => ({
        ...plan,
        check_in: state.checkIns.find((checkIn) => checkIn.plan_id === plan.id) ?? null,
      })) satisfies RecordItem[];
  }

  const { data, error } = await supabase
    .from("daily_plans")
    .select("*, check_ins(*)")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data.map((plan) => {
    const checkIns = Array.isArray(plan.check_ins) ? plan.check_ins : [];
    return {
      ...plan,
      check_in: checkIns[0] ?? null,
    };
  }) as RecordItem[];
}

export async function updateCheckInTime(userId: string, checkinTime: string) {
  if (!hasSupabaseConfig || !supabase) {
    const state = readLocalState();
    if (!state.profile) {
      return null;
    }
    const profile = { ...state.profile, checkin_time: checkinTime };
    writeLocalState({ ...state, profile });
    return profile;
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ checkin_time: checkinTime })
    .eq("id", userId)
    .select(
      "id, habit_name, usual_breakdown_context, usual_breakdown_behavior, goal_picture, failure_picture, action_code, feedback_loop, kakao_linked, checkin_time, onboarded_at",
    )
    .single();

  if (error) {
    throw error;
  }
  return data as Profile;
}

export async function ensureNoResponseForPastPlans(userId: string) {
  const today = todayKey();

  if (!hasSupabaseConfig || !supabase) {
    const state = readLocalState();
    const missing = state.plans.filter(
      (plan) =>
        plan.user_id === userId &&
        plan.date < today &&
        !state.checkIns.some((checkIn) => checkIn.plan_id === plan.id),
    );

    if (missing.length === 0) {
      return;
    }

    writeLocalState({
      ...state,
      checkIns: [
        ...state.checkIns,
        ...missing.map((plan) => ({
          id: createId("check"),
          user_id: userId,
          plan_id: plan.id,
          result: "no_response" as const,
          context_text: null,
          created_at: new Date().toISOString(),
        })),
      ],
    });
    return;
  }

  const { data: plans, error } = await supabase
    .from("daily_plans")
    .select("id")
    .eq("user_id", userId)
    .lt("date", today);

  if (error) {
    throw error;
  }

  if (!plans?.length) {
    return;
  }

  const { data: checkIns, error: checkInError } = await supabase
    .from("check_ins")
    .select("plan_id")
    .eq("user_id", userId)
    .in(
      "plan_id",
      plans.map((plan) => plan.id),
    );

  if (checkInError) {
    throw checkInError;
  }

  const checkedPlanIds = new Set((checkIns ?? []).map((checkIn) => checkIn.plan_id));
  const missingRows = plans
    .filter((plan) => !checkedPlanIds.has(plan.id))
    .map((plan) => ({
      id: createId("check"),
      user_id: userId,
      plan_id: plan.id,
      result: "no_response",
      context_text: null,
      created_at: new Date().toISOString(),
    }));

  if (missingRows.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from("check_ins").insert(missingRows);
  if (insertError) {
    throw insertError;
  }
}

function createInsightIfReady(userId: string, checkIns: CheckIn[], insights: PatternInsight[]) {
  const latestSummary = insights.at(-1)?.pattern_summary;
  const summary = generatePatternSummary(checkIns.filter((checkIn) => checkIn.user_id === userId));

  if (!summary || summary === latestSummary) {
    return null;
  }

  return {
    id: createId("insight"),
    user_id: userId,
    pattern_summary: summary,
    generated_at: new Date().toISOString(),
  } satisfies PatternInsight;
}

async function createRemoteInsightIfReady(userId: string) {
  if (!supabase) {
    return;
  }

  const { data: checkIns, error: checkInError } = await supabase
    .from("check_ins")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (checkInError) {
    throw checkInError;
  }

  const summary = generatePatternSummary((checkIns ?? []) as CheckIn[]);
  if (!summary) {
    return;
  }

  const { data: latest, error: latestError } = await supabase
    .from("pattern_insights")
    .select("*")
    .eq("user_id", userId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw latestError;
  }

  if (latest?.pattern_summary === summary) {
    return;
  }

  const { error } = await supabase.from("pattern_insights").insert({
    id: createId("insight"),
    user_id: userId,
    pattern_summary: summary,
    generated_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }
}
