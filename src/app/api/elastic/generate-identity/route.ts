import OpenAI from "openai";
import { NextResponse } from "next/server";

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

export async function POST(request: Request) {
  const { life_area, why_change, vision_text } = (await request.json()) as {
    life_area?: string;
    why_change?: string;
    vision_text?: string;
  };

  const area = life_area?.trim() ?? "";
  const why = why_change?.trim() ?? "";
  const vision = vision_text?.trim() ?? "";

  if (!vision) {
    return NextResponse.json({ statement: `나는 ${area || "이 영역"}에서 매일 작은 증거를 쌓아가는 사람이다.` });
  }

  if (!openai) {
    return NextResponse.json({ statement: fallbackStatement(area, vision) });
  }

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "너는 사용자의 목표와 비전을 바탕으로 정체성 문장을 한 문장으로 만든다. '나는 [과거 패턴/결핍]이 아니라, [새로운 행동 정체성]인 사람이다.' 구조를 따른다. 구체적이고 행동 중심적으로 쓴다. 평가나 조언 없이 문장 하나만 반환한다. 한국어로 쓴다.",
      },
      {
        role: "user",
        content: `삶의 영역: ${area}\n바꾸고 싶은 이유: ${why}\n이루어졌을 때의 모습: ${vision}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "identity_statement",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["statement"],
          properties: {
            statement: { type: "string" },
          },
        },
      },
    },
  });

  return NextResponse.json(JSON.parse(response.output_text) as { statement: string });
}

function fallbackStatement(area: string, vision: string) {
  const areaText = area || "이 영역";
  if (vision.endsWith("다")) {
    return `나는 ${areaText}에서 ${vision}`;
  }
  return `나는 ${areaText}에서 매일 작은 증거를 쌓아가는 사람이다.`;
}
