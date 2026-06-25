export type ElasticLevel = "mini" | "plus" | "elite";
export type ElasticCheckInStatus = ElasticLevel | "not_done" | "no_response";

export type ElasticProfile = {
  user_id: string;
  scope?: string;
  life_area: string | null;
  why_change: string | null;
  identity_statement: string | null;
  habit_name: string;
  habit_action: string | null;
  habit_period: string | null;
  habit_frequency: string | null;
  habit_when: string | null;
  habit_amount: string | null;
  identity_motive: string;
  motive_summary: string | null;
  recent_failure_date: string | null;
  pre_breakdown_feeling: string | null;
  actual_breakdown_behavior: string | null;
  recovery_method: string | null;
  mini_task: string;
  plus_task: string;
  elite_task: string;
  monthly_vision: string | null;
  last_onboarding_step: string | null;
  onboarding_completed_at: string | null;
  updated_at: string;
};

export type ElasticCheckIn = {
  id: string;
  user_id: string;
  scope?: string;
  checkin_date: string;
  result: ElasticCheckInStatus;
  memo: string | null;
  self_narrative_detected: boolean;
  created_at: string;
};
