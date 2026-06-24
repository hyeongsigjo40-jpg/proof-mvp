import OpenAI from "openai";
import { NextResponse } from "next/server";

type OnboardingStep =
  | "goal_area"
  | "goal_why"
  | "goal_identity"
  | "failure_situation"
  | "failure_feeling"
  | "bridge"
  | "habit_action"
  | "habit_period"
  | "habit_frequency"
  | "habit_when"
  | "habit_amount"
  | "goal_complete"
  | "mini"
  | "plus"
  | "elite"
  | "complete";

type OnboardingData = {
  lifeArea?: string;
  whyChange?: string;
  goalIdentityStatement?: string;
  failureSituation?: string;
  failureFeeling?: string;
  habitAction?: string;
  habitPeriod?: string;
  habitFrequency?: string;
  habitWhen?: string;
  habitAmount?: string;
  miniTask?: string;
  plusTask?: string;
  eliteTask?: string;
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
  data_patch: { field: keyof OnboardingData; value: string }[];
  reply: string;
};

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

const stepOrder: OnboardingStep[] = [
  "goal_area", "goal_why", "goal_identity",
  "failure_situation", "failure_feeling", "bridge",
  "habit_action", "habit_period", "habit_frequency", "habit_when", "habit_amount",
  "goal_complete", "mini", "plus", "elite", "complete",
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
          "너는 Proof 온보딩 진행자다. data 객체에 사용자가 이미 말한 정보가 담겨 있다. 항상 활용한다.\n\n[목표 파트: goal_area→goal_why→goal_identity]\n자연스러운 대화로 진행. goal_identity에서 '나는 [이전 패턴]이 아니라, [새 행동 정체성]인 사람이다.' 형태 문장을 goalIdentityStatement에 저장.\n\n[패턴 파트: failure_situation→failure_feeling→bridge]\n- failure_situation: 최근에 목표를 향해 가다가 흐트러졌던 구체적인 상황을 파악한다. 판단 없이. failureSituation에 저장.\n- failure_feeling: 그때 든 생각이나 감정을 파악한다. failureFeeling에 저장 후 next_step=bridge.\n- bridge: 사용자의 실패 상황(failureSituation)과 감정(failureFeeling)을 직접 언급하며, 이것이 의지력 문제가 아니라 목표가 상황에 맞게 유연하지 않아서임을 설명한다. 그래서 Proof가 SMART 목표와 Elastic Habit 방식을 쓰는 이유를 2-3문장으로 설명한다. should_advance=true, next_step=bridge, data_patch=[].\n\n[습관 목표 파트: habit_action→habit_period→habit_frequency→habit_when→habit_amount]\nSMART 습관 문장을 한 필드씩 채워나간다.\n- habit_action: 구체적인 행동\n- habit_period: 며칠/몇 주\n- habit_frequency: 주 몇 회 또는 매일\n- habit_when: 언제/어떤 상황\n- habit_amount: 얼마나\n\n[goal_complete] 버튼으로 처리, 직접 호출 안 함.\n\n[mini→plus→elite 수정 규칙]\n사용자가 이전 레벨을 수정하려 하면 해당 필드에 저장하고 next_step을 그 레벨로 되돌린다.\n\n공통: 정체성 평가·의지력 판단·죄책감 유발 금지. reply는 한국어 1-3문장.",
      },
      {
        role: "user",
        content: JSON.stringify({
          ...body,
          CURRENT_STEP: body.current_step,
          current_step_goal: stepGoal(body.current_step),
          next_step_if_answer: getNextStep(body.current_step),
          IMPORTANT_RULE: `현재 UI 스텝은 "${body.current_step}"이다. 사용자가 현재 스텝에 답변하면 해당 필드에 저장한다. 단, 사용자가 이전 레벨(예: "mini를 바꾸고 싶어")을 명시적으로 언급하면, 그 레벨의 필드에 저장하고 next_step도 그 레벨로 되돌린다.`,
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
            next_step: { type: "string", enum: stepOrder },
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
                      "lifeArea", "whyChange", "goalIdentityStatement",
                      "failureSituation", "failureFeeling",
                      "habitAction", "habitPeriod", "habitFrequency", "habitWhen", "habitAmount",
                      "miniTask", "plusTask", "eliteTask",
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
  const i = stepOrder.indexOf(step);
  return stepOrder[Math.min(i + 1, stepOrder.length - 1)] ?? step;
}

function stepGoal(step: OnboardingStep): string {
  switch (step) {
    case "goal_area":
      return "바꾸고 싶은 삶의 영역을 파악한다. 구체적으로 말하면 lifeArea에 저장 후 advance.";
    case "goal_why":
      return "왜 그 영역을 바꾸고 싶은지 파악한다. whyChange에 저장 후 advance.";
    case "goal_identity":
      return "'나는 [이전 패턴]이 아니라, [새 행동 정체성]인 사람이다.' 형태 문장을 goalIdentityStatement에 저장 후 failure_situation으로 advance. reply에 문장을 quote로 보여주고, 이 목표를 향해 가다가 최근에 흐트러졌던 상황이 있었는지 자연스럽게 물어본다.";
    case "failure_situation":
      return "최근에 목표를 지키지 못했던 구체적인 상황을 파악한다. 판단 없이. failureSituation에 저장 후 failure_feeling으로 advance.";
    case "failure_feeling":
      return "그때 어떤 생각이나 감정이 들었는지 파악한다. failureFeeling에 저장 후 next_step=bridge로 advance.";
    case "bridge":
      return "사용자의 failureSituation과 failureFeeling을 직접 언급하며 공감한다. 이것이 의지력 문제가 아니라 목표가 상황에 맞게 유연하지 않아서임을 설명한다. 그래서 Proof가 SMART 목표로 행동을 구체화하고, Elastic Habit으로 망한 날에도 Mini 하나면 성공인 유연한 기준을 만든다고 설명한다. 마지막에 '이제 같이 만들어볼까요?'로 마무리. should_advance=true, next_step=bridge, data_patch=[].";
    case "habit_action":
      return "구체적인 행동을 habitAction에 저장. 막연하면 예시 들어 도와준다. 답변 오면 advance.";
    case "habit_period":
      return "며칠/몇 주 동안 실험할지 habitPeriod에 저장. 7일/14일/28일 중 권장.";
    case "habit_frequency":
      return "주 몇 회 또는 매일인지 habitFrequency에 저장.";
    case "habit_when":
      return "언제/어떤 상황에서 할지 habitWhen에 저장.";
    case "habit_amount":
      return "얼마나 할지(시간, 양, 거리 등) habitAmount에 저장. 저장 후 next_step은 goal_complete.";
    case "mini":
      return "현재 스텝=mini. Mini는 망한 날에도 가능한 최소 행동. 사용자 답변을 miniTask에 저장, next_step=plus.";
    case "plus":
      return "현재 스텝=plus. Plus는 보통 날의 기본 성공 단위. 사용자가 'mini를 바꾸고 싶다'고 하면 miniTask에 저장하고 next_step=mini로 되돌린다. 아니면 plusTask에 저장, next_step=elite.";
    case "elite":
      return "현재 스텝=elite. Elite는 여유 있는 날의 도전 단위. 사용자가 'mini/plus를 바꾸고 싶다'고 하면 해당 필드에 저장하고 next_step을 mini 또는 plus로 되돌린다. 아니면 eliteTask에 저장, next_step=complete.";
    default:
      return "온보딩 완료.";
  }
}

function fallbackTurn(body: OnboardingControllerRequest): OnboardingControllerResponse {
  const text = body.latest_user_answer?.trim() ?? "";
  switch (body.current_step) {
    case "goal_area":
      return advance("goal_area", { lifeArea: text }, "왜 그 영역을 바꾸고 싶으세요?");
    case "goal_why":
      return advance("goal_why", { whyChange: text }, "이 목표가 이루어지면 어떤 사람이 되어 있을까요? 한 문장으로 말해주세요.");
    case "goal_identity": {
      const statement = `나는 ${body.data.lifeArea || "이 영역"}에서 매일 작은 증거를 쌓아가는 사람이다.`;
      return advance("goal_identity", { goalIdentityStatement: statement }, `"${statement}"\n\n이 목표를 향해 가다가 최근에 흐트러졌던 순간이 있었나요? 어떤 상황이었어요?`);
    }
    case "failure_situation":
      return advance("failure_situation", { failureSituation: text }, "그때 어떤 생각이나 감정이 들었어요?");
    case "failure_feeling": {
      const situation = body.data.failureSituation || "그 상황";
      return advance("failure_feeling", { failureFeeling: text }, `${situation}에서 ${text}했던 거잖아요. 이건 의지력 문제가 아니라, 목표가 그날의 상황에 맞게 유연하지 않아서예요.\n\n그래서 Proof는 SMART 목표로 행동을 구체화하고, Elastic Habit으로 망한 날에도 Mini 하나면 성공인 기준을 만들어요. 이제 같이 만들어볼까요?`);
    }
    case "bridge":
      return { intent: "continue", should_advance: true, next_step: "bridge", data_patch: [], reply: "" };
    case "habit_action":
      return advance("habit_action", { habitAction: text }, "며칠 동안 실험해볼까요? 7일, 14일, 28일 중 선택해주세요.");
    case "habit_period":
      return advance("habit_period", { habitPeriod: text }, "일주일에 몇 번 할 계획인가요?");
    case "habit_frequency":
      return advance("habit_frequency", { habitFrequency: text }, "언제 할 건가요? 예: 저녁 식사 후, 아침 7시에");
    case "habit_when":
      return advance("habit_when", { habitWhen: text }, "한 번에 얼마나 할 건가요? 예: 10분, 3km, 1세트");
    case "habit_amount":
      return advance("habit_amount", { habitAmount: text }, "좋아요, 습관 목표가 완성됐어요. 아래 버튼을 눌러 Elastic Habit 단계를 설정해요.");
    case "mini":
      return advance("mini", { miniTask: text }, "Plus는 보통 날의 기본 성공 단위예요. 어떻게 할까요?");
    case "plus":
      return advance("plus", { plusTask: text }, "Elite는 여유 있는 날 도전하는 단위예요. 어떻게 할까요?");
    case "elite":
      return advance("elite", { eliteTask: text }, "완성됐어요. 이제 매일 체크인을 시작해볼게요.");
    default:
      return stay(body.current_step, {}, "조금 더 구체적으로 말씀해주세요.");
  }
}

function advance(currentStep: OnboardingStep, dataPatch: OnboardingData, reply: string): OnboardingControllerResponse {
  return { intent: "answer", should_advance: true, next_step: getNextStep(currentStep), data_patch: toPatchArray(dataPatch), reply };
}

function stay(currentStep: OnboardingStep, dataPatch: OnboardingData, reply: string): OnboardingControllerResponse {
  return { intent: "question", should_advance: false, next_step: currentStep, data_patch: toPatchArray(dataPatch), reply };
}

function toPatchArray(dataPatch: OnboardingData): OnboardingControllerResponse["data_patch"] {
  return Object.entries(dataPatch).map(([field, value]) => ({ field: field as keyof OnboardingData, value: value ?? "" }));
}
