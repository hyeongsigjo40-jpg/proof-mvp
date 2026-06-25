import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildProofSystemPrompt } from "@/lib/proof-ai-context";

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

type OnboardingField = keyof OnboardingData;

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

const stepOrder: OnboardingStep[] = [
  "goal_area", "goal_why", "goal_identity",
  "failure_situation", "failure_feeling", "bridge",
  "habit_action", "habit_period", "habit_frequency", "habit_when", "habit_amount",
  "goal_complete", "mini", "plus", "elite", "complete",
];

const fieldStep: Record<OnboardingField, OnboardingStep> = {
  lifeArea: "goal_area",
  whyChange: "goal_why",
  goalIdentityStatement: "goal_identity",
  failureSituation: "failure_situation",
  failureFeeling: "failure_feeling",
  habitAction: "habit_action",
  habitPeriod: "habit_period",
  habitFrequency: "habit_frequency",
  habitWhen: "habit_when",
  habitAmount: "habit_amount",
  miniTask: "mini",
  plusTask: "plus",
  eliteTask: "elite",
};

const currentFieldByStep: Partial<Record<OnboardingStep, OnboardingField>> = Object.fromEntries(
  Object.entries(fieldStep).map(([field, step]) => [step, field]),
) as Partial<Record<OnboardingStep, OnboardingField>>;

const fieldLabel: Record<OnboardingField, string> = {
  lifeArea: "삶의 영역",
  whyChange: "바꾸고 싶은 이유",
  goalIdentityStatement: "정체성 문장",
  failureSituation: "최근에 흐트러졌던 상황",
  failureFeeling: "그때 든 생각이나 감정",
  habitAction: "습관 행동",
  habitPeriod: "실험 기간",
  habitFrequency: "빈도",
  habitWhen: "실행 타이밍",
  habitAmount: "실행량",
  miniTask: "Mini",
  plusTask: "Plus",
  eliteTask: "Elite",
};

const lifeAreaOptions = ["공부", "운동", "수면", "일", "감정관리", "인간관계", "연애", "프로젝트"];

const onboardingStepContext =
  "현재 호출은 onboarding_controller다. 전체 목표는 목표 영역, 실패 패턴, SMART 습관, Mini/Plus/Elite 실행 단위를 순서대로 완성하는 것이다.\n" +
  "각 턴은 current_step의 목적에 맞게 사용자의 답변을 구조화해 data_patch에 저장하고, 다음 단계로 넘길 정보를 만든다.\n" +
  "allowed_actions: answer_current_step, ask_one_clarifying_question, correct_previous_level, continue_to_next_step.\n" +
  "forbidden_actions: 목표와 무관한 상담, 장문의 조언, 단계 건너뛰기, 사용자가 말하지 않은 값 날조, 사용자의 의지력 평가.";

export async function POST(request: Request) {
  const body = (await request.json()) as OnboardingControllerRequest;
  const correction = detectPreviousFieldCorrection(body);

  if (correction) {
    return NextResponse.json(correction);
  }

  if (!openai) {
    return NextResponse.json(fallbackTurn(body));
  }

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          buildProofSystemPrompt("온보딩 진행자", onboardingStepContext) +
          "\n\n[step_flow]\n" +
          "[목표 파트: goal_area→goal_why→goal_identity]\n자연스러운 대화로 진행. goal_identity에서 '나는 [이전 패턴]이 아니라, [새 행동 정체성]인 사람이다.' 형태 문장을 goalIdentityStatement에 저장.\n\n" +
          "[패턴 파트: failure_situation→failure_feeling→bridge]\n- failure_situation: 최근에 목표를 향해 가다가 흐트러졌던 구체적인 상황을 파악한다. 판단 없이 failureSituation에 저장한다.\n- failure_feeling: 그때 든 생각이나 감정을 파악한다. failureFeeling에 저장 후 next_step=bridge.\n- bridge: 사용자의 실패 상황과 감정을 직접 언급하며, 이것이 의지력 문제가 아니라 목표가 상황에 맞게 유연하지 않아서임을 설명한다. 그래서 Proof가 SMART 목표와 Elastic Habit 방식을 쓰는 이유를 2-3문장으로 설명한다. should_advance=true, next_step=bridge, data_patch=[].\n\n" +
          "[습관 목표 파트: habit_action→habit_period→habit_frequency→habit_when→habit_amount]\nSMART 습관 문장을 한 필드씩 채워나간다.\n- habit_action: 구체적인 행동\n- habit_period: 며칠/몇 주\n- habit_frequency: 주 몇 회 또는 매일\n- habit_when: 언제/어떤 상황\n- habit_amount: 얼마나\n\n" +
          "[goal_complete] 버튼으로 처리, 직접 호출하지 않는다.\n\n" +
          "[mini→plus→elite 수정 규칙]\n사용자가 이전 레벨을 수정하려 하면 해당 필드에 저장하고 next_step을 그 레벨로 되돌린다.",
      },
      {
        role: "user",
        content: JSON.stringify({
          product_context: "Proof는 목표→패턴→SMART 습관→Elastic Habit→daily check-in으로 이어지는 루프다.",
          ...body,
          CURRENT_STEP: body.current_step,
          current_step_goal: stepGoal(body.current_step),
          next_step_if_answer: getNextStep(body.current_step),
          forbidden_actions: [
            "judge_user",
            "change_plan_without_confirmation",
            "give_generic_motivation",
            "ask_multiple_questions",
            "skip_current_step",
          ],
          correction_rule:
            "사용자가 이전 답변을 바꾸는 발화를 하면 현재 단계 답변으로 저장하지 않는다. 예: current_step=goal_why에서 '연애로 할까'는 whyChange가 아니라 lifeArea correction이다. 예: current_step=habit_frequency에서 '기간은 4주로 할래'는 habitPeriod correction이다. correction이면 intent='correction', should_advance=false, next_step=current_step, data_patch에는 수정할 이전 필드만 넣고 reply에서 수정 확인 후 현재 질문을 다시 한다.",
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

function detectPreviousFieldCorrection(body: OnboardingControllerRequest): OnboardingControllerResponse | null {
  const text = body.latest_user_answer?.trim() ?? "";
  if (!text) return null;

  const field = detectCorrectionField(text, body.current_step);
  if (!field || field === currentFieldByStep[body.current_step]) return null;
  if (!isPreviousField(field, body.current_step)) return null;

  const value = extractCorrectionValue(field, text);
  if (!value) return null;

  const nextData = { ...body.data, [field]: value };
  return {
    intent: "correction",
    should_advance: false,
    next_step: body.current_step,
    data_patch: [{ field, value }],
    reply: `${fieldLabel[field]}은 "${value}"로 바꿔둘게요. ${currentQuestion(body.current_step, nextData)}`,
  };
}

function detectCorrectionField(text: string, currentStep: OnboardingStep): OnboardingField | null {
  const normalized = text.toLowerCase();
  const strongCorrection = hasStrongCorrectionCue(text);

  if (/\bmini\b|미니/i.test(text)) return "miniTask";
  if (/\bplus\b|플러스/i.test(text)) return "plusTask";
  if (/\belite\b|엘리트/i.test(text)) return "eliteTask";
  if (/삶의\s*영역|관심\s*영역|영역|분야/.test(text)) return "lifeArea";
  if (/바꾸고\s*싶은\s*이유|이유/.test(text)) return "whyChange";
  if (/정체성|정체성\s*문장/.test(text)) return "goalIdentityStatement";
  if (/감정|생각|느낌|기분/.test(text)) return "failureFeeling";
  if (/실패\s*상황|흐트러졌던\s*상황|상황은|상황을|사건은|사건을|순간은|순간을/.test(text)) return "failureSituation";
  if (/습관\s*행동|행동은|행동을|뭘\s*할|무엇을\s*할/.test(text)) return "habitAction";
  if (/기간|며칠|몇\s*주|몇주|동안/.test(text)) return "habitPeriod";
  if (/빈도|주\s*몇|몇\s*번|몇번|매일/.test(text)) return "habitFrequency";
  if (/언제|타이밍|시간대|몇\s*시에/.test(text)) return "habitWhen";
  if (/얼마나|실행량/.test(text)) return "habitAmount";

  const matchedLifeAreas = lifeAreaOptions.filter((option) => normalized.includes(option.toLowerCase()));
  if (strongCorrection && matchedLifeAreas.length > 0 && stepOrder.indexOf(currentStep) > stepOrder.indexOf("goal_area")) {
    return "lifeArea";
  }

  return null;
}

function hasStrongCorrectionCue(text: string) {
  return /아니|말고|그게\s*아니라|그건\s*아니|바꿀|바꾸|수정|정정|다시|생각해보니|차라리|로\s*할|으로\s*할|로\s*갈|으로\s*갈|로\s*잡|으로\s*잡|로\s*정|으로\s*정|가\s*맞|이\s*맞|로\s*하고|으로\s*하고/.test(text);
}

function isPreviousField(field: OnboardingField, currentStep: OnboardingStep) {
  return stepOrder.indexOf(fieldStep[field]) < stepOrder.indexOf(currentStep);
}

function extractCorrectionValue(field: OnboardingField, text: string) {
  if (field === "lifeArea") {
    const matches = lifeAreaOptions.filter((option) => text.includes(option));
    return matches.at(-1) ?? cleanupCorrectionText(text, field);
  }

  return cleanupCorrectionText(text, field);
}

function cleanupCorrectionText(text: string, field: OnboardingField) {
  const fieldPatterns: Record<OnboardingField, RegExp> = {
    lifeArea: /삶의\s*영역|관심\s*영역|영역|분야/g,
    whyChange: /바꾸고\s*싶은\s*이유|이유/g,
    goalIdentityStatement: /정체성\s*문장|정체성/g,
    failureSituation: /실패\s*상황|흐트러졌던\s*상황|상황|사건|순간/g,
    failureFeeling: /감정|생각|느낌|기분/g,
    habitAction: /습관\s*행동|행동/g,
    habitPeriod: /기간/g,
    habitFrequency: /빈도/g,
    habitWhen: /언제|타이밍|시간대/g,
    habitAmount: /얼마나|실행량/g,
    miniTask: /\bmini\b|미니/gi,
    plusTask: /\bplus\b|플러스/gi,
    eliteTask: /\belite\b|엘리트/gi,
  };

  return text
    .replace(fieldPatterns[field], "")
    .replace(/^(음|어|아|그럼|그러면|좋아|좋아요|아니|그게\s*아니라|그건\s*아니고|생각해보니|차라리)\s*/g, "")
    .replace(/^(은|는|을|를|이|가|:|-)\s*/g, "")
    .replace(/\s*(로|으로)?\s*(할까|할게|할래|하고\s*싶어|하고\s*싶다|잡을게|정할게|바꿀게)\s*$/g, "")
    .trim();
}

function currentQuestion(step: OnboardingStep, data: OnboardingData) {
  switch (step) {
    case "goal_why":
      return `${data.lifeArea || "그 영역"}을 바꾸고 싶은 이유는 무엇인가요?`;
    case "goal_identity":
      return "이 목표가 이루어지면 어떤 사람이 되어 있을까요? 한 문장으로 말해주세요.";
    case "failure_situation":
      return "이 목표를 향해 가다가 최근에 흐트러졌던 순간이 있었나요? 어떤 상황이었어요?";
    case "failure_feeling":
      return "그때 어떤 생각이나 감정이 들었어요?";
    case "habit_action":
      return "어떤 행동을 습관으로 만들고 싶으세요?";
    case "habit_period":
      return "며칠 동안 실험해볼까요? 7일, 14일, 28일 중 선택해주세요.";
    case "habit_frequency":
      return "일주일에 몇 번 할 계획인가요?";
    case "habit_when":
      return "언제 할 건가요? 예: 저녁 식사 후, 아침 7시에";
    case "habit_amount":
      return "한 번에 얼마나 할 건가요? 예: 10분, 3km, 1세트";
    case "mini":
      return "Mini는 어떻게 설정할까요?";
    case "plus":
      return "Plus는 보통 날의 기본 성공 단위예요. 어떻게 설정할까요?";
    case "elite":
      return "Elite는 여유 있는 날 도전하는 단위예요. 어떻게 설정할까요?";
    default:
      return "이어서 진행할게요.";
  }
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
