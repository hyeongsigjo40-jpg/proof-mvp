import OpenAI from "openai";
import { NextResponse } from "next/server";

type OnboardingStep =
  | "habit"
  | "motive"
  | "transition"
  | "failure_date"
  | "feeling"
  | "behavior"
  | "recovery"
  | "elastic_intro"
  | "mini"
  | "plus"
  | "elite"
  | "vision"
  | "complete";

type OnboardingData = {
  habitName?: string;
  identityMotive?: string;
  motiveSummary?: string;
  recentFailureDate?: string;
  preBreakdownFeeling?: string;
  actualBreakdownBehavior?: string;
  recoveryMethod?: string;
  miniTask?: string;
  plusTask?: string;
  eliteTask?: string;
  monthlyVision?: string;
};

type OnboardingControllerRequest = {
  current_step: OnboardingStep;
  latest_user_answer?: string;
  data: OnboardingData;
};

type OnboardingControllerResponse = {
  intent: "answer" | "question" | "correction" | "unclear" | "continue";
  should_advance: boolean;
  next_step: OnboardingStep;
  data_patch: {
    field: keyof OnboardingData;
    value: string;
  }[];
  reply: string;
};

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

const stepOrder: OnboardingStep[] = [
  "habit",
  "motive",
  "transition",
  "failure_date",
  "feeling",
  "behavior",
  "recovery",
  "elastic_intro",
  "mini",
  "plus",
  "elite",
  "vision",
  "complete",
];

export async function POST(request: Request) {
  const body = (await request.json()) as OnboardingControllerRequest;

  if (!openai) {
    return NextResponse.json(fallbackTurn(body));
  }

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "너는 Proof의 Elastic Habit 온보딩 진행자이자 상태 컨트롤러다. 사용자의 입력이 현재 단계의 답변인지, 질문인지, 수정 요청인지 먼저 판단한다. 답변이면 data_patch 배열에 저장할 필드와 값만 넣고 다음 단계로 이동한다. 질문/추천 요청/불명확한 입력이면 should_advance=false로 두고 같은 단계에 머무르며 도움을 주며 data_patch는 빈 배열로 둔다. 사용자가 이전 답변을 고치려 하면 data_patch로 수정하고 필요한 단계에 머문다. 정체성 평가, 의지력 평가, 성격 진단, 죄책감 유발은 금지한다. Mini/Plus/Elite는 행동량 단계다. reply는 한국어 1-3문장으로 짧게 쓴다.",
      },
      {
        role: "user",
        content: JSON.stringify({
          ...body,
          current_step_goal: stepGoal(body.current_step),
          next_step_if_answer: getNextStep(body.current_step),
          data_patch_rules: {
            habit: "habitName에는 사용자의 긴 문장을 그대로 넣지 말고 화면 제목으로 쓸 짧은 명사구를 저장한다. 예: 평일 오전 고인지 작업",
            motive: "identityMotive에는 원문에 가까운 목표/이유를 저장하고, motiveSummary에는 24자 이내 명사구를 저장한다.",
            mini: "사용자가 추천을 물으면 저장하지 말고 should_advance=false. 실제 선택/동의가 있을 때만 miniTask에 저장한다.",
            plus: "사용자가 추천을 물으면 저장하지 말고 should_advance=false. 실제 선택/동의가 있을 때만 plusTask에 저장한다.",
            elite: "사용자가 추천을 물으면 저장하지 말고 should_advance=false. 실제 선택/동의가 있을 때만 eliteTask에 저장한다.",
          },
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "elastic_onboarding_controller",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["intent", "should_advance", "next_step", "data_patch", "reply"],
          properties: {
            intent: { type: "string", enum: ["answer", "question", "correction", "unclear", "continue"] },
            should_advance: { type: "boolean" },
            next_step: {
              type: "string",
              enum: stepOrder,
            },
            data_patch: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["field", "value"],
                properties: {
                  field: {
                    type: "string",
                    enum: [
                      "habitName",
                      "identityMotive",
                      "motiveSummary",
                      "recentFailureDate",
                      "preBreakdownFeeling",
                      "actualBreakdownBehavior",
                      "recoveryMethod",
                      "miniTask",
                      "plusTask",
                      "eliteTask",
                      "monthlyVision",
                    ],
                  },
                  value: { type: "string" },
                },
              },
            },
            reply: { type: "string" },
          },
        },
      },
    },
  });

  return NextResponse.json(JSON.parse(response.output_text) as OnboardingControllerResponse);
}

function getNextStep(step: OnboardingStep): OnboardingStep {
  const currentIndex = stepOrder.indexOf(step);
  return stepOrder[Math.min(currentIndex + 1, stepOrder.length - 1)] ?? step;
}

function stepGoal(step: OnboardingStep) {
  switch (step) {
    case "habit":
      return "사용자가 만들고 싶은 습관을 파악한다.";
    case "motive":
      return "왜 이 습관을 만들고 싶은지, 목표와 이유를 파악한다.";
    case "transition":
      return "정체성 판단이 아니라 오늘의 행동 기록으로 전환하는 데 동의를 얻고 실패 장면으로 넘어간다.";
    case "failure_date":
      return "최근에 이 습관을 지키지 못한 날이나 상황을 파악한다.";
    case "feeling":
      return "무너지기 직전의 기분이나 몸 상태를 파악한다.";
    case "behavior":
      return "그때 실제로 한 행동을 관찰 가능한 표현으로 파악한다.";
    case "recovery":
      return "다시 시작할 때 이미 쓰는 회복 방법을 파악한다. 답변이 나오면 next_step을 elastic_intro로 설정하고 reply는 짧은 수락 문장(1문장)만 쓴다.";
    case "elastic_intro":
      return "이 단계는 UI에서 버튼으로 처리되므로 직접 호출되지 않는다.";
    case "mini":
      return "Mini 최소 단위를 정한다.";
    case "plus":
      return "Plus 보통 단위를 정한다.";
    case "elite":
      return "Elite 도전 단위를 정한다.";
    case "vision":
      return "한 달 뒤 달라질 관찰 가능한 장면을 정한다.";
    default:
      return "온보딩을 마무리한다.";
  }
}

function fallbackTurn(body: OnboardingControllerRequest): OnboardingControllerResponse {
  const text = body.latest_user_answer?.trim() ?? "";
  if (!text && body.current_step === "habit") {
    return stay(body.current_step, {}, "지금 이루고 싶은 습관이 뭔가요?");
  }
  if (!text && body.current_step === "transition") {
    return advance("transition", {}, "좋아요. 최근에 못 지킨 날이나 상황이 언제였어요?");
  }
  if (looksLikeQuestion(text)) {
    return stay(body.current_step, {}, fallbackHelp(body.current_step, body.data));
  }

  switch (body.current_step) {
    case "habit":
      return advance("habit", { habitName: compactHabitName(text) }, "좋아요. 이 습관을 왜 만들고 싶으세요?");
    case "motive":
      return advance(
        "motive",
        { identityMotive: text, motiveSummary: compactSummary(text) },
        `그러니까 ${compactSummary(text)}이 중요한 이유네요. 이제 결과가 아니라 오늘 할 행동으로 좁혀볼게요. 최근에 못 지킨 날이나 상황이 언제였어요?`,
      );
    case "transition":
      return advance("transition", {}, "최근에 못 지킨 날이나 상황이 언제였어요?");
    case "failure_date":
      return advance("failure_date", { recentFailureDate: text }, "무너지기 직전, 기분이나 몸 상태가 어땠어요?");
    case "feeling":
      return advance("feeling", { preBreakdownFeeling: text }, "그때 실제로 뭘 했어요?");
    case "behavior":
      return advance("behavior", { actualBreakdownBehavior: text }, "그 다음엔 보통 어떻게 다시 시작해요?");
    case "recovery":
      return advance("recovery", { recoveryMethod: text }, "알겠어요, 저장했어요.");
    case "mini":
      return advance("mini", { miniTask: text }, "좋아요. Plus, 즉 보통 단위는 무엇으로 할까요?");
    case "plus":
      return advance("plus", { plusTask: text }, "좋아요. Elite, 즉 도전 단위는 무엇으로 할까요?");
    case "elite":
      return advance("elite", { eliteTask: text }, "이게 잘 되면 한 달 뒤 뭐가 달라져 있을까요? 관찰 가능한 장면으로 적어주세요.");
    case "vision":
      return advance("vision", { monthlyVision: text }, "저장했어요. 이제 일상 화면에는 한 달 뒤 변화와 Mini/Plus/Elite만 두고 볼게요.");
    default:
      return stay(body.current_step, {}, "이미 온보딩이 완료됐어요.");
  }
}

function advance(currentStep: OnboardingStep, dataPatch: OnboardingData, reply: string): OnboardingControllerResponse {
  return {
    intent: "answer",
    should_advance: true,
    next_step: getNextStep(currentStep),
    data_patch: toPatchArray(dataPatch),
    reply,
  };
}

function stay(currentStep: OnboardingStep, dataPatch: OnboardingData, reply: string): OnboardingControllerResponse {
  return {
    intent: "question",
    should_advance: false,
    next_step: currentStep,
    data_patch: toPatchArray(dataPatch),
    reply,
  };
}

function toPatchArray(dataPatch: OnboardingData): OnboardingControllerResponse["data_patch"] {
  return Object.entries(dataPatch).map(([field, value]) => ({ field: field as keyof OnboardingData, value: value ?? "" }));
}

function looksLikeQuestion(text: string) {
  return /[?？]|뭐|뭘|무엇|뭔지|어떻게|추천|좋을 것|좋을까|정해줘|골라줘|예시|맞아|괜찮|모르겠|잘\s*모르|막막|고민/.test(
    text,
  );
}

function fallbackHelp(step: OnboardingStep, data: OnboardingData) {
  if (step === "habit") {
    return "괜찮아요. 지금은 딱 하나만 고르면 됩니다. 데모데이 준비라면 '평일 오전 9시 30분부터 12시 30분까지 문제정의와 기획 작업하기' 같은 습관이 좋아 보여요. 이 방향으로 잡아볼까요?";
  }
  if (step === "recovery") {
    return "지금 상황이라면 '25분만 다시 켜기'처럼 회복 방법을 아주 작게 잡는 게 좋아 보여요. 예를 들면 웹툰을 닫고 타이머 25분을 켠 뒤 문제정의 문서 첫 줄만 여는 방식이요. 이런 식으로 다시 시작한다고 저장할까요?";
  }
  if (step === "mini") {
    return "이 경우 Mini는 부담 없이 시작 가능한 25분 한 세트가 좋아 보여요. 예를 들면 '오전 9시 30분에 문제정의 문서 25분 열기'처럼요. 이걸 Mini로 할까요?";
  }
  if (step === "plus") {
    return "Plus는 원래 목표에 가까운 기본 성공 단위가 좋아요. 예를 들면 '오전 9시 30분부터 12시 30분까지 고인지 작업 2세트 이상'처럼 잡을 수 있어요.";
  }
  if (step === "elite") {
    return "Elite는 데모데이 성과에 직접 닿는 산출물까지 포함하면 좋아요. 예를 들면 '3시간 고인지 작업 후 결제 전환 가설 1개를 검증한다'처럼요.";
  }
  return `${data.habitName || "이 단계"}에 대해 조금 더 구체적으로 잡아볼게요. 답변으로 저장할 문장을 말해주면 다음 단계로 넘어갈게요.`;
}

function compactHabitName(value: string) {
  if (value.includes("고인지")) return "평일 오전 고인지 작업";
  if (value.length > 28) return `${value.slice(0, 28)}...`;
  return value;
}

function compactSummary(value: string) {
  if (value.includes("데모데이") || value.includes("결제")) return "데모데이 성과와 B2C 결제 10건";
  return value.length > 24 ? `${value.slice(0, 24)}...` : value;
}
