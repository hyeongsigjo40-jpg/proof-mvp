import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildProofSystemPrompt } from "@/lib/proof-ai-context";

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const motiveStepContext =
  "현재 호출은 motive_summary다. 이 단계의 목적은 긴 동기를 UI와 기록에서 재사용 가능한 짧은 명사구로 압축하는 것이다.\n" +
  "allowed_actions: summarize_motive_phrase.\n" +
  "forbidden_actions: advice, diagnosis, coaching_reply, multiple_questions.";

export async function POST(request: Request) {
  const { identity_motive } = (await request.json()) as { identity_motive?: string };
  const motive = identity_motive?.trim() ?? "";

  if (!motive) {
    return NextResponse.json({ summary: "그 변화" });
  }

  if (!openai) {
    return NextResponse.json({ summary: fallbackSummary(motive) });
  }

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          buildProofSystemPrompt("동기 요약기", motiveStepContext) +
          "\n\n너는 사용자의 동기를 아주 짧게 요약한다. 평가, 조언, 분석을 하지 않는다. 한국어 명사구 한 개로만 답한다. 24자 이내.",
      },
      { role: "user", content: motive },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "motive_summary",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["summary"],
          properties: {
            summary: { type: "string" },
          },
        },
      },
    },
  });

  return NextResponse.json(JSON.parse(response.output_text) as { summary: string });
}

function fallbackSummary(value: string) {
  return value.length > 24 ? `${value.slice(0, 24)}...` : value;
}
