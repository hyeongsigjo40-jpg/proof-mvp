import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildProofSystemPrompt } from "@/lib/proof-ai-context";

type ContextualReplyRequest = {
  event: "checkin_saved" | "plan_saved" | "no_response_saved";
  today: string;
  timezone: string;
  profile: {
    habit_name: string;
    mini_task: string;
    plus_task: string;
    elite_task: string;
    monthly_vision: string;
  };
  recent_checkins: {
    checkin_date: string;
    result: string;
    memo: string | null;
  }[];
  scorecard?: {
    mini: number;
    plus: number;
    elite: number;
    base_score: number;
    bonus_score: number;
    total_score: number;
  };
};

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const dailyStepContext =
  "현재 호출은 daily_checkin_contextual_reply다. 이 단계의 목적은 체크인 결과를 평가하는 것이 아니라, 오늘 실행에 영향을 준 조건을 다음 계획 조정 루프에 넘기는 것이다.\n" +
  "추출 관점: friction, support, timing, emotion, next_adjustment_candidate.\n" +
  "allowed_actions: summarize_pattern, acknowledge_saved_record, suggest_confirmation_question, close_day.\n" +
  "forbidden_actions: score_explanation_by_default, generic_motivation, long_advice, plan_change_without_confirmation, multiple_questions.";

export async function POST(request: Request) {
  const body = (await request.json()) as ContextualReplyRequest;

  if (!openai) {
    return NextResponse.json({ reply: fallbackReply(body) });
  }

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          buildProofSystemPrompt("Elastic Habit 체크인 코치", dailyStepContext) +
          "\n\n[reply_rules]\n" +
          "- 날짜는 입력된 today, timezone, recent_checkins만 근거로 말한다.\n" +
          "- scorecard는 내부 참고용이다. 사용자가 점수를 직접 묻지 않으면 점수 계산을 설명하지 않는다.\n" +
          "- checkin_saved에서는 오늘의 선택과 메모에서 보이는 조건을 짧게 요약하고, 다음 계획 조정으로 이어질 수 있는 단서만 말한다.\n" +
          "- plan_saved에서는 변경된 계획을 확인하고 짧게 마감한다.\n" +
          "- no_response_saved에서는 응답 없음이 실패 판정이 아님을 짧게 확인한다.",
      },
      {
        role: "user",
        content: JSON.stringify({
          product_context: "Proof는 목표→패턴→SMART 습관→Elastic Habit→daily check-in→다음 계획 조정으로 이어지는 루프다.",
          current_step: "daily_checkin_contextual_reply",
          step_goal: "저장된 체크인을 평가하지 않고, 실행 조건을 다음 계획 조정에 넘길 수 있게 짧게 요약한다.",
          forbidden_actions: [
            "judge_user",
            "explain_score_unless_asked",
            "change_plan_without_confirmation",
            "give_generic_motivation",
            "ask_multiple_questions",
          ],
          ...body,
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "elastic_contextual_reply",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["reply"],
          properties: {
            reply: { type: "string" },
          },
        },
      },
    },
  });

  return NextResponse.json(JSON.parse(response.output_text) as { reply: string });
}

function fallbackReply(body: ContextualReplyRequest) {
  const latest = body.recent_checkins.at(-1);
  if (body.event === "no_response_saved") {
    return `${body.today} 기록은 응답 없음으로 저장했어요. 하지 않음으로 임의 판정하지 않습니다.`;
  }
  if (body.event === "plan_saved") {
    return `${body.today} 기준으로 내일의 Mini/Plus/Elite 계획을 저장했어요.`;
  }
  return latest
    ? `${latest.checkin_date} 기록을 ${latest.result}로 저장했어요. 오늘 조건을 다음 계획에 참고할게요.`
    : `${body.today} 체크인을 저장했어요.`;
}
