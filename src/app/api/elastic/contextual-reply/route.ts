import OpenAI from "openai";
import { NextResponse } from "next/server";

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
          "너는 Proof의 Elastic Habit 체크인 코치다. 날짜는 사용자의 DB 기록을 기준으로 말한다. 오늘/어제/최근이라는 표현은 입력된 today, timezone, recent_checkins만 근거로 사용한다. scorecard가 있으면 Mini=1, Plus=2, Elite=3 계산을 설명할 수 있다. 정체성 평가, 의지력 평가, 방법론 추천, 경쟁 유도는 금지한다. 1-2문장으로 짧게 답한다.",
      },
      {
        role: "user",
        content: JSON.stringify(body),
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
  if (body.scorecard) {
    return `${body.today} 체크인을 저장했어요. 현재 base score는 ${body.scorecard.base_score}점입니다.`;
  }
  return latest
    ? `${latest.checkin_date} 기록을 ${latest.result}로 저장했어요. 최근 기록을 기준으로 다음 체크인을 이어갑니다.`
    : `${body.today} 체크인을 저장했어요.`;
}
