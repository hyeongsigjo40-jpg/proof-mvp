import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildProofSystemPrompt } from "@/lib/proof-ai-context";

type SummarizeOnboardingRequest = {
  goal?: string;
  habit?: string;
  blocker?: string;
};

type SummarizeOnboardingResponse = {
  goal: string;
  habit: string;
  blocker: string;
};

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

export async function POST(request: Request) {
  const body = (await request.json()) as SummarizeOnboardingRequest;
  const fallback = createFallbackSummary(body);

  if (!openai) {
    return NextResponse.json(fallback);
  }

  try {
    const response = await openai.responses.create({
      model,
      input: [
        {
          role: "system",
          content:
            buildProofSystemPrompt(
              "온보딩 요약자",
              "사용자의 목표, 반복 행동, 핵심 병목을 온보딩 결과 카드에 들어갈 짧은 한국어 문장으로 다듬는다.",
            ) +
            "\n\n규칙:\n" +
            "- 사용자가 말하지 않은 목표나 행동을 새로 만들지 않는다.\n" +
            "- 목표는 명사구 또는 짧은 문장으로 정리한다.\n" +
            "- 반복 행동은 사용자가 직접 할 수 있는 행동 문장으로 정리한다.\n" +
            "- 핵심 병목은 자책이 아니라 반복 패턴으로 재서사화한다.\n" +
            "- 각 필드는 45자 안팎으로 짧게 쓴다.\n" +
            "- 조언, 응원, 추가 질문은 쓰지 않는다.",
        },
        {
          role: "user",
          content: JSON.stringify({
            goal: body.goal ?? "",
            habit: body.habit ?? "",
            blocker: body.blocker ?? "",
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "proof_onboarding_summary",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["goal", "habit", "blocker"],
            properties: {
              goal: { type: "string" },
              habit: { type: "string" },
              blocker: { type: "string" },
            },
          },
        },
      },
    });

    const parsed = JSON.parse(response.output_text) as SummarizeOnboardingResponse;
    return NextResponse.json({
      goal: parsed.goal?.trim() || fallback.goal,
      habit: parsed.habit?.trim() || fallback.habit,
      blocker: parsed.blocker?.trim() || fallback.blocker,
    });
  } catch {
    return NextResponse.json(fallback);
  }
}

function createFallbackSummary(body: SummarizeOnboardingRequest): SummarizeOnboardingResponse {
  return {
    goal: clean(body.goal) || "목표를 매일의 행동으로 이어가기",
    habit: clean(body.habit) || "목표 행동을 작게 반복하기",
    blocker: normalizeBlocker(body.blocker) || "막히는 날의 패턴을 기록으로 확인하기",
  };
}

function clean(value: string | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function normalizeBlocker(value: string | undefined) {
  const text = clean(value);
  if (!text) return "";
  if (/패턴|경향|느낌|상황/.test(text)) return text;
  return `${text} 패턴`;
}
