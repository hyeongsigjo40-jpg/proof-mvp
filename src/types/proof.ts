export type BreakdownContext =
  | "아침 기상 직후"
  | "저녁 퇴근·하교 후"
  | "마감 직전"
  | "기타";

export type CheckInResult = "done" | "partial" | "not_done";

export type Profile = {
  id: string;
  habit_name: string;
  usual_breakdown_context: string;
  usual_breakdown_behavior: string;
  goal_picture: string | null;
  failure_picture: string | null;
  action_code: string[] | null;
  feedback_loop: string | null;
  onboarded_at: string;
};

export type DailyPlan = {
  id: string;
  user_id: string;
  date: string;
  plan_text: string;
  minimum_plan_text: string | null;
  created_at: string;
};

export type CheckIn = {
  id: string;
  plan_id: string;
  user_id: string;
  result: CheckInResult;
  context_text: string | null;
  created_at: string;
};

export type PatternInsight = {
  id: string;
  user_id: string;
  pattern_summary: string;
  generated_at: string;
};

export type CoachQuestion = {
  id: string;
  label: string;
  helper: string;
  placeholder: string;
};

export type CoachSynthesis = {
  goal_picture: string;
  failure_picture: string;
  action_code: string[];
  feedback_loop: string;
};

export type RecordItem = DailyPlan & {
  check_in: CheckIn | null;
};
