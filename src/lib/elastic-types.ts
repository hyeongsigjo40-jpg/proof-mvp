export type ElasticLevel = "mini" | "plus" | "elite";
export type ElasticCheckInStatus = ElasticLevel | "not_done" | "no_response";

export type ElasticProfile = {
  user_id: string;
  habit_name: string;
  identity_motive: string;
  motive_summary: string | null;
  recent_failure_date: string | null;
  pre_breakdown_feeling: string | null;
  actual_breakdown_behavior: string | null;
  recovery_method: string | null;
  mini_task: string;
  plus_task: string;
  elite_task: string;
  monthly_vision: string;
  onboarding_completed_at: string | null;
  updated_at: string;
};

export type ElasticCheckIn = {
  id: string;
  user_id: string;
  checkin_date: string;
  result: ElasticCheckInStatus;
  memo: string | null;
  self_narrative_detected: boolean;
  created_at: string;
};
