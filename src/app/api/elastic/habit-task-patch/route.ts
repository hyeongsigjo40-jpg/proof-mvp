import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildProofSystemPrompt } from "@/lib/proof-ai-context";

type HabitTaskPatchRequest = {
  latest_user_answer: string;
  profile: {
    habit_name: string;
    habit_action: string;
    habit_period: string;
    habit_frequency: string;
    habit_when: string;
    habit_amount: string;
    mini_task: string;
    plus_task: string;
    elite_task: string;
  };
  recent_checkins: {
    checkin_date: string;
    result: string;
    memo: string | null;
  }[];
};

type HabitTaskPatchResponse = {
  intent: "patch" | "clarify" | "keep";
  reply: string;
  patch: {
    mini_task: string | null;
    plus_task: string | null;
    elite_task: string | null;
  };
  next_step: "confirm_patch" | "ask_clarifying_question" | "close_without_patch";
};

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const taskPatchStepContext =
  "현재 호출은 daily_plan_patch_controller다. 이 단계의 목적은 사용자의 자유로운 문장을 Mini/Plus/Elite 목표 수정 후보로 해석하는 것이다.\n" +
  "이 호출은 계획을 실제로 저장하지 않는다. 오직 사용자가 확인할 후보 patch만 만든다.\n" +
  "추출 관점: target_level, new_task, ambiguity, relation_to_today_pattern.\n" +
  "allowed_actions: propose_patch, ask_one_clarifying_question, keep_current_plan.\n" +
  "forbidden_actions: save_plan, change_plan_without_confirmation, infer_unmentioned_levels_aggressively, generic_motivation, long_advice, multiple_questions.";

export async function POST(request: Request) {
  const body = (await request.json()) as HabitTaskPatchRequest;

  if (!openai) {
    return NextResponse.json(fallbackClarify());
  }

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          buildProofSystemPrompt("습관 목표 수정 컨트롤러", taskPatchStepContext) +
          "\n\n[decision_rules]\n" +
          "- 사용자가 Mini/Plus/Elite를 명시하면 해당 기준만 patch에 넣는다.\n" +
          "- 사용자가 '아예 작게', '1분 시작', '최소로'처럼 낮추는 맥락을 말하면 Mini 후보로 볼 수 있다.\n" +
          "- 사용자가 '플러스', '기본', '보통', '10분'처럼 기본 성공 단위를 말하면 Plus 후보로 볼 수 있다.\n" +
          "- 사용자가 '도전', '여유 있을 때', '끝까지'처럼 확장 단위를 말하면 Elite 후보로 볼 수 있다.\n" +
          "- 여러 기준을 바꾸려는 말이면 여러 patch를 제안한다.\n" +
          "- 확신이 낮으면 patch를 비우고 한 가지 확인 질문만 한다.\n" +
          "- 기존 목표와 오늘 패턴을 참고하되, 사용자가 말하지 않은 기준은 null로 둔다.\n" +
          "- reply는 수정 후보를 짧게 요약하고 '이대로 저장할까요?'로 끝낸다. clarify면 한 질문만 한다.",
      },
      {
        role: "user",
        content: JSON.stringify({
          product_context: "Proof는 목표→패턴→SMART 습관→Elastic Habit→daily check-in→다음 계획 조정으로 이어지는 루프다.",
          current_step: "daily_plan_patch_controller",
          step_goal: "사용자의 문장을 다음날 Mini/Plus/Elite 수정 후보로 구조화하고, 실제 저장 전 확인 단계로 넘긴다.",
          forbidden_actions: [
            "judge_user",
            "save_plan",
            "change_plan_without_confirmation",
            "invent_patch_for_unmentioned_levels",
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
        name: "habit_task_patch",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["intent", "reply", "patch", "next_step"],
          properties: {
            intent: { type: "string", enum: ["patch", "clarify", "keep"] },
            reply: { type: "string" },
            patch: {
              type: "object",
              additionalProperties: false,
              required: ["mini_task", "plus_task", "elite_task"],
              properties: {
                mini_task: { type: ["string", "null"] },
                plus_task: { type: ["string", "null"] },
                elite_task: { type: ["string", "null"] },
              },
            },
            next_step: { type: "string", enum: ["confirm_patch", "ask_clarifying_question", "close_without_patch"] },
          },
        },
      },
    },
  });

  return NextResponse.json(JSON.parse(response.output_text) as HabitTaskPatchResponse);
}

function fallbackClarify(): HabitTaskPatchResponse {
  return {
    intent: "clarify",
    reply: "어떤 기준을 바꿀지 한 번만 더 확인할게요. Mini / Plus / Elite 중 무엇을 어떻게 바꿀까요?",
    patch: {
      mini_task: null,
      plus_task: null,
      elite_task: null,
    },
    next_step: "ask_clarifying_question",
  };
}
