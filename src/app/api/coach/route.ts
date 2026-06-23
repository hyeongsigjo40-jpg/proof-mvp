import OpenAI from "openai";
import { NextResponse } from "next/server";
import { fallbackQuestions, type CoachAnswer, type CoachBaseInput } from "@/lib/coach-schema";
import type { CoachQuestion, CoachSynthesis } from "@/types/proof";

type CoachRequest =
  | {
      mode: "questions";
      baseInput: CoachBaseInput;
    }
  | {
      mode: "synthesis";
      baseInput: CoachBaseInput;
      answers: CoachAnswer[];
    };

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

export async function POST(request: Request) {
  const body = (await request.json()) as CoachRequest;

  if (!openai) {
    if (body.mode === "questions") {
      return NextResponse.json({ questions: fallbackQuestions });
    }

    return NextResponse.json(createFallbackSynthesis(body.baseInput, body.answers));
  }

  if (body.mode === "questions") {
    const response = await openai.responses.create({
      model,
      input: [
        {
          role: "system",
          content:
            "너는 Proof의 코칭 질문 설계자다. 사용자의 정체성을 평가하지 말고, 목적/목표/실패 장면을 관찰 가능한 행동으로 좁히는 구체 질문만 만든다. 질문은 5개만 만든다. 심리분석, 성격유형, 의지 평가, 죄책감 유발 표현은 금지한다.",
        },
        {
          role: "user",
          content: JSON.stringify(body.baseInput),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "proof_coach_questions",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["questions"],
            properties: {
              questions: {
                type: "array",
                minItems: 5,
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "label", "helper", "placeholder"],
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    helper: { type: "string" },
                    placeholder: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    });

    return NextResponse.json(JSON.parse(response.output_text) as { questions: CoachQuestion[] });
  }

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "너는 Proof의 행동 강령 압축기다. 사용자의 답변을 바탕으로 목적/목표의 명확한 그림, 실패 이유의 명확한 그림, 행동 강령, 피드백 루프를 만든다. 모든 문장은 평가가 아니라 다음 행동을 돕는 문장이어야 한다. 포인트, 배지, 스트릭, 의지력 평가, 성격 진단은 금지한다.",
      },
      {
        role: "user",
        content: JSON.stringify({
          baseInput: body.baseInput,
          answers: body.answers,
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "proof_coach_synthesis",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["goal_picture", "failure_picture", "action_code", "feedback_loop"],
          properties: {
            goal_picture: { type: "string" },
            failure_picture: { type: "string" },
            action_code: {
              type: "array",
              minItems: 3,
              maxItems: 5,
              items: { type: "string" },
            },
            feedback_loop: { type: "string" },
          },
        },
      },
    },
  });

  return NextResponse.json(JSON.parse(response.output_text) as CoachSynthesis);
}

function createFallbackSynthesis(baseInput: CoachBaseInput, answers: CoachAnswer[]) {
  const minimum = answers.find((answer) => answer.question_id.includes("minimum"))?.answer;

  return {
    goal_picture: `${baseInput.habit_name}을 관찰 가능한 한 줄 계획으로 만들고, 이번 주에 반복 가능한 기준을 먼저 확인합니다.`,
    failure_picture: `${baseInput.usual_breakdown_context}에 ${baseInput.usual_breakdown_behavior}로 흐르는 장면이 반복될 수 있습니다.`,
    action_code: [
      `전날 밤 ${baseInput.habit_name}의 시간, 장소, 행동량을 한 문장으로 정한다.`,
      minimum ? `시작이 어려운 날에는 ${minimum}만 한다.` : "시작이 어려운 날에는 최소 버전을 먼저 한다.",
      "하지 않았거나 일부만 한 날에는 그 순간의 행동만 한 줄로 남긴다.",
    ],
    feedback_loop: "체크인 기록이 쌓이면 자주 반복되는 상황을 다음 계획 화면에서 다시 확인합니다.",
  } satisfies CoachSynthesis;
}
