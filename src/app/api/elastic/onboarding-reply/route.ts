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

type CorrectionRouterResult = {
  intent: "answer_current_step" | "correct_previous_field" | "unclear";
  target_field: OnboardingField | null;
  value: string | null;
  confidence: number;
  reason: string;
};

type HabitActionReviewResult = {
  decision: "save" | "revise_step" | "ask_clarifying_question";
  habit_action: string | null;
  missing_dimensions: ("concrete" | "measurable" | "controllable" | "repeatable")[];
  reply: string;
  reason: string;
};

type HabitPlanParserResult = {
  habitAction: string | null;
  habitPeriod: string | null;
  habitFrequency: string | null;
  habitWhen: string | null;
  habitAmount: string | null;
  confidence: number;
  reason: string;
};

type ElasticLevelReviewResult = {
  decision: "save" | "revise_step" | "ask_clarifying_question";
  task: string | null;
  reply: string;
  reason: string;
};

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

const onboardingStepContext =
  "현재 호출은 onboarding_controller다. 전체 목표는 목표 영역, 실패 패턴, SMART 습관, Mini/Plus/Elite 실행 단위를 순서대로 완성하는 것이다.\n" +
  "각 턴은 current_step의 목적에 맞게 사용자의 답변을 구조화해 data_patch에 저장하고, 다음 단계로 넘길 정보를 만든다.\n" +
  "allowed_actions: answer_current_step, ask_one_clarifying_question, correct_previous_level, continue_to_next_step.\n" +
  "forbidden_actions: 목표와 무관한 상담, 장문의 조언, 단계 건너뛰기, 사용자가 말하지 않은 값 날조, 사용자의 의지력 평가.";

export async function POST(request: Request) {
  const body = (await request.json()) as OnboardingControllerRequest;

  if (!openai) {
    return NextResponse.json(
      fallbackCorrectionTurn(body) ?? tryCreateDeterministicHabitPlanTurn(body) ?? fallbackTurn(body),
    );
  }

  const correction = await routeCorrection(openai, body);
  if (correction) {
    return NextResponse.json(correction);
  }

  if (body.current_step === "habit_action") {
    return NextResponse.json(await createHabitPlanTurn(openai, body));
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
          "[패턴 파트: failure_situation→failure_feeling→bridge]\n- failure_situation: 최근에 목표를 향해 가다가 흐트러졌던 구체적인 상황을 파악한다. 판단 없이 failureSituation에 저장한다.\n- failure_feeling: 그때 든 생각이나 감정을 파악한다. failureFeeling에 저장 후 next_step=bridge.\n- bridge: 사용자의 실패 상황과 감정을 직접 언급하며, 이것이 의지력 문제가 아니라 목표가 상황에 맞게 유연하지 않아서임을 설명한다. 이어서 이제 목표를 '오늘이나 내일부터 바로 할 수 있고, 직접 통제할 수 있고, 완료 여부를 확인할 수 있는 행동'으로 바꿀 것이라고 안내한다. should_advance=true, next_step=bridge, data_patch=[].\n\n" +
          "[습관 목표 파트]\n" +
          "- current_step=habit_action은 사용자의 한 문장에서 habitAction, habitPeriod, habitFrequency, habitWhen, habitAmount를 최대한 함께 추출하는 통합 실행 계획 단계다.\n" +
          "- 사용자가 이미 말한 기간/빈도/시점/양을 다시 묻지 않는다. data_patch에 함께 저장한다.\n" +
          "- habitAction과 habitAmount가 있고 habitFrequency 또는 habitWhen 중 하나가 있으면 실행 계획은 충분하다. habitPeriod가 없으면 '4주'를 기본 실험 기간으로 저장하고 next_step=goal_complete로 진행한다.\n" +
          "- 필수 정보가 부족하면 should_advance=false, next_step=habit_action으로 두고 부족한 정보 하나만 묻는다.\n" +
          "- habit_period, habit_frequency, habit_when, habit_amount 단계는 기존 데이터/디버그 호환용이다. 일반 진행에서는 habit_action에서 한 번에 채우는 것을 우선한다.\n\n" +
          "[habit_action 품질 기준]\n" +
          "- habit_action은 사용자가 오늘/내일 바로 실행할 수 있고, 직접 통제할 수 있고, 구체적이고, 측정 가능한 루틴 행동을 지향한다.\n" +
          "- 단, 이 단계의 역할은 사용자를 막거나 목표를 대신 고치는 것이 아니라, 사용자의 표현을 최대한 보존해 저장하고 다음 필드에서 기간/빈도/시점/양을 채우도록 돕는 것이다.\n" +
          "- 측정 가능하다는 뜻: 완료 여부를 사용자가 yes/no로 판단할 수 있거나, 횟수/시간/분량/대상 수 같은 단위가 들어 있다.\n" +
          "- 구체적이라는 뜻: 무엇을 대상으로 어떤 행동을 하는지가 드러난다. 예: '연애 노력하기'가 아니라 '대화 소재 1개 적기'.\n" +
          "- 사용자가 행동과 측정 기준을 같이 말하면 저장 가능하다. 예: '헬스장에서 웨이트 3종목 하기', '헬스장에서 웨이트 3종목을 60분 동안 하기'는 habit_action으로 저장한다. 이를 '운동복 입기', '가방 챙기기'처럼 더 작은 준비 행동으로 바꾸지 않는다.\n" +
          "- 외부 사건이 있어야 가능한 행동은 저장하지 않는다. 예: '소개팅이나 매칭 직후 연락하기'는 사용자가 매일 만들 수 없는 조건이므로 부적합하다.\n" +
          "- 사용자가 '작지 않다', '추상적이다', '루틴적으로 할 수 있어야 한다', '추천해줘', '행동 말이야'라고 말하면 그것을 habitAction 값으로 저장하지 않는다.\n" +
          "- 기준을 완전히 통과하지 못해도 사용자가 행동 의도를 말했으면 먼저 저장 가능한 표현으로 받아들이고 다음 단계에서 부족한 기준을 채운다. 단순히 더 좋아질 수 있다는 이유로 막지 않는다.\n" +
          "- 정말 저장할 행동이 없거나 메타 답변만 있으면 should_advance=false, data_patch=[]로 두고, 기준을 짧게 설명한 뒤 사용자가 직접 고를 수 있는 후보 2-3개를 제안한다.\n" +
          "- 연애 영역 예시: '매일 저녁 10분 연락 후보 1명 정리하기', '대화 소재 1개 적기', '소개팅 앱 프로필 한 줄 개선하기'.\n\n" +
          "[goal_complete] 버튼으로 처리, 직접 호출하지 않는다.\n\n" +
          "[Mini/Plus/Elite 진행 규칙]\n" +
          "- Mini/Plus/Elite는 사용자가 직접 선택하도록 돕는다. AI가 더 적절하다고 판단해 사용자의 답을 거부하거나 다른 행동으로 바꾸지 않는다.\n" +
          "- 사용자가 현재 레벨에 답하면 그 값을 해당 필드에 저장하고 다음 단계로 진행한다. 레벨 의미와 조금 달라도 막지 말고, 다음 reply에서 기준을 짧게 설명하며 필요하면 나중에 조정할 수 있다고 안내한다.\n" +
          "- Mini는 가장 힘든 날에도 남길 수 있는 최소 증거, Plus는 보통 날의 기본 성공 단위, Elite는 여유 있는 날의 확장 단위라고 설명한다.\n" +
          "- 사용자가 이전 레벨을 수정하려 하면 해당 필드에 저장하고 next_step을 그 레벨로 되돌린다.",
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

  return NextResponse.json(
    await normalizeControllerResponse(openai, body, JSON.parse(response.output_text) as OnboardingControllerResponse),
  );
}

async function routeCorrection(
  client: OpenAI,
  body: OnboardingControllerRequest,
): Promise<OnboardingControllerResponse | null> {
  const text = body.latest_user_answer?.trim() ?? "";
  if (!text) return null;

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "너는 Proof 온보딩의 correction router다. 사용자의 최신 발화가 현재 단계 답변인지, 이전에 수집한 필드를 바꾸려는 정정인지, 애매한지 분류한다.\n\n" +
          "[whole_process]\n목표 영역→바꾸고 싶은 이유→정체성 문장→실패 상황→감정/생각→SMART 습관→Mini/Plus/Elite 순서로 진행한다.\n\n" +
          "[important]\n- 사용자가 현재 질문에 답하고 있으면 answer_current_step이다.\n- 사용자가 이전 답변을 바꾸고 있으면 correct_previous_field다.\n- correct_previous_field는 target_field가 current_step보다 이전 필드일 때만 사용한다.\n- 사용자가 '연애를 못할 것 같은 열등감 때문에'라고 말하는 것은 goal_why 답변이지 lifeArea correction이 아니다.\n- 사용자가 '스마트폰 사용 습관을 줄이고 독서를 하고 싶다, 이렇게 잡을게요'처럼 목표/영역을 다시 정하면 lifeArea correction이다. whyChange로 저장하지 않는다.\n- 사용자가 '아니 그건 이유가 아니라 목표였잖아요', '이유가 잘못 들어갔다'처럼 특정 필드가 틀렸다고만 말하면 correct_previous_field로 분류하고 target_field를 해당 필드로 둔다. 새 값이 없으면 value=null이다.\n- 사용자가 '연애로 할까', '프로젝트 말고 연애', '삶의 영역은 연애로'라고 말하면 lifeArea correction이다.\n- 사용자가 '기간은 4주로 바꿀래'라고 말하면 habitPeriod correction이다.\n- 사용자가 'Mini는 1문제만으로'라고 말하면 miniTask correction이다.\n- 확신이 낮으면 unclear로 둔다.",
      },
      {
        role: "user",
        content: JSON.stringify({
          current_step: body.current_step,
          current_step_goal: stepGoal(body.current_step),
          previous_fields: previousFieldSnapshot(body.current_step, body.data),
          latest_user_answer: text,
          current_field: currentFieldByStep[body.current_step] ?? null,
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "onboarding_correction_router",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["intent", "target_field", "value", "confidence", "reason"],
          properties: {
            intent: { type: "string", enum: ["answer_current_step", "correct_previous_field", "unclear"] },
            target_field: {
              type: ["string", "null"],
              enum: [
                "lifeArea", "whyChange", "goalIdentityStatement",
                "failureSituation", "failureFeeling",
                "habitAction", "habitPeriod", "habitFrequency", "habitWhen", "habitAmount",
                "miniTask", "plusTask", "eliteTask", null,
              ],
            },
            value: { type: ["string", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string" },
          },
        },
      },
    },
  });

  return correctionFromRouter(client, body, JSON.parse(response.output_text) as CorrectionRouterResult);
}

async function correctionFromRouter(
  client: OpenAI,
  body: OnboardingControllerRequest,
  routed: CorrectionRouterResult,
): Promise<OnboardingControllerResponse | null> {
  if (routed.intent !== "correct_previous_field") return null;
  if (!routed.target_field) return null;
  if (routed.confidence < 0.72) return null;
  if (routed.target_field === currentFieldByStep[body.current_step]) return null;
  if (!isPreviousField(routed.target_field, body.current_step)) return null;

  const value = routed.value?.trim() ?? "";
  if (!value) {
    return {
      intent: "correction",
      should_advance: true,
      next_step: fieldStep[routed.target_field],
      data_patch: [{ field: routed.target_field, value: "" }],
      reply: `${fieldLabel[routed.target_field]}을 다시 잡을게요. ${currentQuestion(fieldStep[routed.target_field], body.data)}`,
    };
  }

  if (routed.target_field === "habitAction") {
    const review = await reviewHabitAction(client, body, value);
    if (review.decision !== "save") {
      return {
        intent: "correction",
        should_advance: true,
        next_step: "habit_action",
        data_patch: [],
        reply: review.reply,
      };
    }
  }

  const nextData = { ...body.data, [routed.target_field]: value };
  return {
    intent: "correction",
    should_advance: false,
    next_step: body.current_step,
    data_patch: [{ field: routed.target_field, value }],
    reply: `${fieldLabel[routed.target_field]}은 "${value}"로 바꿔둘게요. ${currentQuestion(body.current_step, nextData)}`,
  };
}

function previousFieldSnapshot(currentStep: OnboardingStep, data: OnboardingData) {
  return Object.entries(fieldStep)
    .filter(([, step]) => stepOrder.indexOf(step) < stepOrder.indexOf(currentStep))
    .map(([field, step]) => ({
      field,
      label: fieldLabel[field as OnboardingField],
      step,
      value: data[field as OnboardingField] ?? "",
    }));
}

function isPreviousField(field: OnboardingField, currentStep: OnboardingStep) {
  return stepOrder.indexOf(fieldStep[field]) < stepOrder.indexOf(currentStep);
}

function fallbackCorrectionTurn(body: OnboardingControllerRequest): OnboardingControllerResponse | null {
  const text = body.latest_user_answer?.trim() ?? "";
  if (!text) return null;

  const miniMatch = text.match(/(?:mini|미니)\s*(?:는|은|를|을|:)?\s*(.+)/i);
  const plusMatch = text.match(/(?:plus|플러스)\s*(?:는|은|를|을|:)?\s*(.+)/i);
  const eliteMatch = text.match(/(?:elite|엘리트)\s*(?:는|은|를|을|:)?\s*(.+)/i);
  const pairs: [OnboardingField, RegExpMatchArray | null][] = [
    ["miniTask", miniMatch],
    ["plusTask", plusMatch],
    ["eliteTask", eliteMatch],
  ];
  const matched = pairs.find(([field, match]) => match?.[1] && isPreviousField(field, body.current_step));
  if (!matched?.[1]?.[1]) return null;

  const [field, match] = matched;
  const value = match[1].trim();
  const nextData = { ...body.data, [field]: value };
  return {
    intent: "correction",
    should_advance: false,
    next_step: body.current_step,
    data_patch: [{ field, value }],
    reply: `${fieldLabel[field]}은 "${value}"로 바꿔둘게요. ${currentQuestion(body.current_step, nextData)}`,
  };
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
      return "이제 목표를 실제 실행 계획으로 바꿔볼게요. 기간, 빈도, 언제, 행동, 양을 한 문장으로 편하게 말해주세요. 아직 정하지 못한 건 비워도 괜찮아요.";
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
      return "사용자의 failureSituation과 failureFeeling을 직접 언급하며 공감한다. 이것이 의지력 문제가 아니라 목표가 상황에 맞게 유연하지 않아서임을 설명한다. 이어서 Proof가 목표를 지금 당장 가능한, 측정 가능하고, 통제 가능한 습관 행동으로 전환한다고 안내한다. 마지막에 '이제 같이 만들어볼까요?'로 마무리. should_advance=true, next_step=bridge, data_patch=[].";
    case "habit_action":
      return "사용자의 한 문장에서 habitAction, habitPeriod, habitFrequency, habitWhen, habitAmount를 최대한 함께 추출한다. 이미 말한 정보는 다시 묻지 않는다. habitAction과 habitAmount가 있고 habitFrequency 또는 habitWhen 중 하나가 있으면 goal_complete로 진행한다. 부족하면 habit_action에 머물며 부족한 정보 하나만 묻는다.";
    case "habit_period":
      return "며칠/몇 주 동안 실험할지 habitPeriod에 저장. 7일/14일/28일 중 권장.";
    case "habit_frequency":
      return "주 몇 회 또는 매일인지 habitFrequency에 저장.";
    case "habit_when":
      return "언제/어떤 상황에서 할지 habitWhen에 저장.";
    case "habit_amount":
      return "얼마나 할지(시간, 양, 거리 등) habitAmount에 저장. 저장 후 next_step은 goal_complete.";
    case "mini":
      return "현재 스텝=mini. Mini는 가장 힘든 날에도 가능한 최소 증거다. 사용자 답변을 거부하거나 재설계하지 말고 miniTask에 저장한 뒤 Plus로 진행한다.";
    case "plus":
      return "현재 스텝=plus. Plus는 보통 날의 기본 성공 단위다. 사용자가 'mini를 바꾸고 싶다'고 하면 miniTask에 저장하고 next_step=mini로 되돌린다. 아니면 plusTask에 저장하고 Elite로 진행한다.";
    case "elite":
      return "현재 스텝=elite. Elite는 여유 있는 날의 확장 단위다. 사용자가 'mini/plus를 바꾸고 싶다'고 하면 해당 필드에 저장하고 next_step을 mini 또는 plus로 되돌린다. 아니면 eliteTask에 저장하고 완료로 진행한다.";
    default:
      return "온보딩 완료.";
  }
}

async function createHabitPlanTurn(
  client: OpenAI,
  body: OnboardingControllerRequest,
): Promise<OnboardingControllerResponse> {
  const parsed = await parseHabitPlanWithGPT(client, body);
  const parsedData: OnboardingData = {
    habitAction: parsed.habitAction ?? "",
    habitPeriod: parsed.habitPeriod ?? "",
    habitFrequency: parsed.habitFrequency ?? "",
    habitWhen: parsed.habitWhen ?? "",
    habitAmount: parsed.habitAmount ?? "",
  };
  const merged: OnboardingData = {
    ...body.data,
    ...Object.fromEntries(Object.entries(parsedData).filter(([, value]) => Boolean(value))),
  };
  const dataPatch = createHabitPlanPatch(body.data, merged);

  if (!merged.habitAction) {
    return stay(
      "habit_action",
      dataPatch,
      "좋아요. 실행 계획으로 만들려면 먼저 어떤 행동을 할지 필요해요. 예: 헬스장에서 웨이트 3종목 하기, 밤 11시에 책 10쪽 읽기처럼 말해주세요.",
    );
  }

  if (!merged.habitAmount) {
    return stay(
      "habit_action",
      dataPatch,
      `좋아요. "${merged.habitAction}"로 잡아둘게요. 한 번에 얼마나 할까요? 예: 20분, 3종목, 10쪽처럼 완료 기준을 말해주세요.`,
    );
  }

  if (!merged.habitFrequency && !merged.habitWhen) {
    return stay(
      "habit_action",
      dataPatch,
      `좋아요. "${merged.habitAction}" ${merged.habitAmount} 기준으로 잡아둘게요. 얼마나 자주 하거나 언제 할까요? 예: 주 3회, 매일 밤 11시, 퇴근 후처럼 말해주세요.`,
    );
  }

  if (!merged.habitPeriod) merged.habitPeriod = "4주";

  return {
    intent: "answer",
    should_advance: true,
    next_step: "goal_complete",
    data_patch: toPatchArray(createHabitPlanPatch(body.data, merged)),
    reply: `좋아요. 이렇게 실행 계획을 잡아볼게요.\n\n${formatHabitPlanSummary(merged)}\n\n이제 이 행동을 Mini / Plus / Elite로 나눠서, 컨디션이 낮은 날에도 완전히 실패한 날이 되지 않게 만들 거예요.`,
  };
}

async function parseHabitPlanWithGPT(
  client: OpenAI,
  body: OnboardingControllerRequest,
): Promise<HabitPlanParserResult> {
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          buildProofSystemPrompt(
            "실행 계획 파서",
            "현재 호출은 habit_plan_parser다. 사용자의 자연어 답변에서 실행 계획 필드를 구조화한다.",
          ) +
          "\n\n[parse_rules]\n" +
          "- habitAction에는 사용자가 실제로 할 행동만 넣는다. 기간, 빈도, 실행 시점, 실행량은 habitAction에서 제외한다.\n" +
          "- habitPeriod는 실험 기간이다. 예: 2주, 4주, 14일.\n" +
          "- habitFrequency는 반복 빈도다. 예: 매일, 주 3회, 일주일에 5번.\n" +
          "- habitWhen은 실행 시점이나 상황이다. 예: 퇴근 후, 밤 11시, 저녁 식사 후.\n" +
          "- habitAmount는 한 번의 완료 기준이다. 예: 60분, 10쪽, 20문제, 3종목.\n" +
          "- 사용자가 말하지 않은 값은 null로 둔다. 절대 추측해서 채우지 않는다.\n" +
          "- 기존 프로필에 이미 값이 있고 사용자가 새로 말하지 않았으면 null로 둔다. 기존 값 병합은 코드가 한다.\n" +
          "- 사용자가 '그렇게 해줘', '그걸로 할게'처럼 위임하면 existing_profile의 기존 값과 latest_user_answer 맥락에서 확정 가능한 값만 반환한다.\n" +
          "- 장소가 행동의 의미를 구체화하면 habitAction에 포함한다. 예: '헬스장을 주 3회 가서 운동하려고' → habitAction='헬스장에 가서 운동하기', habitFrequency='주 3회'.\n" +
          "- 행동은 자연스럽고 짧게 정리한다. 예: '2주 동안 매일 밤 11시에 책 10쪽 읽기' → habitAction='책 읽기', habitAmount='10쪽'.\n" +
          "- 예: '4주 동안 주 3회, 퇴근 후 헬스장에서 웨이트 3종목을 60분 하기' → habitAction='헬스장에서 웨이트 3종목 하기', habitPeriod='4주', habitFrequency='주 3회', habitWhen='퇴근 후', habitAmount='60분'.\n" +
          "- 예: '4주 동안 주 5회 저녁에 토익 LC 20문제 풀기' → habitAction='토익 LC 문제 풀기', habitPeriod='4주', habitFrequency='주 5회', habitWhen='저녁', habitAmount='20문제'.",
      },
      {
        role: "user",
        content: JSON.stringify({
          latest_user_answer: body.latest_user_answer ?? "",
          existing_profile: {
            habitAction: body.data.habitAction,
            habitPeriod: body.data.habitPeriod,
            habitFrequency: body.data.habitFrequency,
            habitWhen: body.data.habitWhen,
            habitAmount: body.data.habitAmount,
          },
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "habit_plan_parser",
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "habitAction",
            "habitPeriod",
            "habitFrequency",
            "habitWhen",
            "habitAmount",
            "confidence",
            "reason",
          ],
          properties: {
            habitAction: { type: ["string", "null"] },
            habitPeriod: { type: ["string", "null"] },
            habitFrequency: { type: ["string", "null"] },
            habitWhen: { type: ["string", "null"] },
            habitAmount: { type: ["string", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string" },
          },
        },
      },
    },
  });

  return JSON.parse(response.output_text) as HabitPlanParserResult;
}

function tryCreateDeterministicHabitPlanTurn(body: OnboardingControllerRequest): OnboardingControllerResponse | null {
  if (body.current_step !== "habit_action") return null;

  const text = body.latest_user_answer?.trim() ?? "";
  if (!text) return null;

  const parsed = parseHabitPlanText(text);
  const merged: OnboardingData = {
    ...body.data,
    ...Object.fromEntries(Object.entries(parsed).filter(([, value]) => Boolean(value))),
  };
  if (!merged.habitAction && isMetaHabitActionReply(text)) return null;

  const dataPatch = createHabitPlanPatch(body.data, merged);
  if (!merged.habitAction) {
    return stay(
      "habit_action",
      dataPatch,
      "좋아요. 실행 계획으로 만들려면 먼저 어떤 행동을 할지 필요해요. 예: 헬스장에서 웨이트 3종목 하기, 밤 11시에 책 10쪽 읽기처럼 말해주세요.",
    );
  }

  if (!merged.habitAmount) {
    return stay(
      "habit_action",
      dataPatch,
      `좋아요. "${merged.habitAction}"로 잡아둘게요. 한 번에 얼마나 할까요? 예: 20분, 3종목, 10쪽처럼 완료 기준을 말해주세요.`,
    );
  }

  if (!merged.habitFrequency && !merged.habitWhen) {
    return stay(
      "habit_action",
      dataPatch,
      `좋아요. "${merged.habitAction}" ${merged.habitAmount} 기준으로 잡아둘게요. 얼마나 자주 하거나 언제 할까요? 예: 주 3회, 매일 밤 11시, 퇴근 후처럼 말해주세요.`,
    );
  }

  if (!merged.habitPeriod) merged.habitPeriod = "4주";

  return {
    intent: "answer",
    should_advance: true,
    next_step: "goal_complete",
    data_patch: toPatchArray(createHabitPlanPatch(body.data, merged)),
    reply: `좋아요. 이렇게 실행 계획을 잡아볼게요.\n\n${formatHabitPlanSummary(merged)}\n\n이제 이 행동을 Mini / Plus / Elite로 나눠서, 컨디션이 낮은 날에도 완전히 실패한 날이 되지 않게 만들 거예요.`,
  };
}

function isMetaHabitActionReply(text: string) {
  return /(추천|해줘|그렇게|그걸로|모르겠|아무거나|예시|다시|너무|넓|구체)/.test(text);
}

function parseHabitPlanText(text: string): Partial<OnboardingData> {
  return {
    habitAction: extractHabitAction(text),
    habitPeriod: extractHabitPeriod(text),
    habitFrequency: extractHabitFrequency(text),
    habitWhen: extractHabitWhen(text),
    habitAmount: extractHabitAmount(text),
  };
}

function createHabitPlanPatch(previous: OnboardingData, next: OnboardingData): Partial<OnboardingData> {
  const patch: Partial<OnboardingData> = {};
  const fields: (keyof OnboardingData)[] = [
    "habitAction",
    "habitPeriod",
    "habitFrequency",
    "habitWhen",
    "habitAmount",
  ];
  for (const field of fields) {
    const value = next[field]?.trim();
    if (value && value !== previous[field]) patch[field] = value;
  }
  return patch;
}

function extractHabitAction(text: string) {
  const normalized = normalizeDeterministicHabitAction(text);
  if (!hasHabitActionSignal(normalized)) return "";
  return normalized;
}

function hasHabitActionSignal(text: string) {
  return /(헬스장|웨이트|러닝머신|스트레칭|스쿼트|운동|공부|독서|읽|쓰기|쓰|정리|기록|걷|뛰|달리|명상|연습|복습|문제|요가|필라테스)/.test(text);
}

function extractHabitPeriod(text: string) {
  return text.match(/\d+\s*(?:일|주|개월|달)\s*(?:동안|간)?/)?.[0]?.replace(/\s+/g, " ").trim() ?? "";
}

function extractHabitFrequency(text: string) {
  if (/매일|매일마다|매일\s*\d+/.test(text)) return "매일";
  return text.match(/주\s*\d+\s*회|일주일에\s*\d+\s*(?:번|회)|하루에\s*\d+\s*(?:번|회)/)?.[0]?.replace(/\s+/g, " ").trim() ?? "";
}

function extractHabitWhen(text: string) {
  const match = text.match(/(?:퇴근 후|출근 전|점심시간|아침|오전|오후|저녁|밤|자기 전|기상 후|식사 후)(?:\s*\d+\s*시)?/);
  return match?.[0]?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeDeterministicHabitAction(text: string) {
  const weightTraining = normalizeWeightTrainingAction(text);
  if (weightTraining) return weightTraining;
  if (/헬스장/.test(text) && /운동/.test(text)) return "헬스장에 가서 운동하기";

  return text
    .replace(/\s+/g, " ")
    .replace(/^나는\s*/, "")
    .replace(/하려고$/, "하기")
    .replace(/할거야$/, "하기")
    .replace(/할 거야$/, "하기")
    .replace(/운동할거야$/, "운동하기")
    .replace(/운동할 거야$/, "운동하기")
    .replace(/헬스장 가서/g, "헬스장에서")
    .replace(/(\d+\s*종목)하기/g, "$1 하기")
    .trim();
}

function normalizeWeightTrainingAction(text: string) {
  if (!/(웨이트|근력)/.test(text)) return null;

  const location = /헬스장/.test(text) ? "헬스장에서 " : "";
  const count = text.match(/\d+\s*종목/)?.[0] ?? "";
  return `${location}웨이트${count ? ` ${count}` : ""} 하기`;
}

function extractHabitAmount(text: string) {
  if (/(웨이트|근력)/.test(text)) {
    const time = text.match(/\d+\s*(?:분|시간)/)?.[0] ?? "";
    const count = text.match(/\d+\s*종목/)?.[0] ?? "";
    return time || count;
  }

  const amountSource = text
    .replace(/주\s*\d+\s*회/g, "")
    .replace(/일주일에\s*\d+\s*(?:번|회)/g, "")
    .replace(/하루에\s*\d+\s*(?:번|회)/g, "")
    .replace(/\d+\s*(?:일|주|개월|달)\s*(?:동안|간)?/g, "");
  const amounts = amountSource.match(/\d+\s*(?:분|시간|회|세트|종목|km|킬로|쪽|문제|개|장|줄)/g) ?? [];
  return amounts.join(", ");
}

function formatHabitPlanSummary(data: OnboardingData) {
  return [
    `기간: ${data.habitPeriod || "4주"}`,
    `빈도: ${data.habitFrequency || "정하지 않음"}`,
    `언제: ${data.habitWhen || "정하지 않음"}`,
    `행동: ${data.habitAction || "정하지 않음"}`,
    `양: ${data.habitAmount || "정하지 않음"}`,
  ].join("\n");
}

function getMissingHabitPlanReply(data: OnboardingData) {
  if (!data.habitAction) {
    return "실행 계획으로 만들려면 먼저 어떤 행동을 할지 필요해요. 예: 헬스장에서 웨이트 3종목 하기, 밤 11시에 책 10쪽 읽기처럼 말해주세요.";
  }
  if (!data.habitAmount) {
    return `좋아요. "${data.habitAction}"로 잡아둘게요. 한 번에 얼마나 할까요? 예: 20분, 3종목, 10쪽처럼 완료 기준을 말해주세요.`;
  }
  if (!data.habitFrequency && !data.habitWhen) {
    return `좋아요. "${data.habitAction}" ${data.habitAmount} 기준으로 잡아둘게요. 얼마나 자주 하거나 언제 할까요? 예: 주 3회, 매일 밤 11시, 퇴근 후처럼 말해주세요.`;
  }
  return "좋아요. 실행 계획에 필요한 정보를 조금만 더 채워볼게요.";
}

async function normalizeControllerResponse(
  client: OpenAI,
  body: OnboardingControllerRequest,
  result: OnboardingControllerResponse,
): Promise<OnboardingControllerResponse> {
  void client;
  if (body.current_step === "mini" || body.current_step === "plus" || body.current_step === "elite") return result;
  if (body.current_step === "habit_action") return normalizeHabitPlanResult(body, result);

  return result;
}

function normalizeHabitPlanResult(
  body: OnboardingControllerRequest,
  result: OnboardingControllerResponse,
): OnboardingControllerResponse {
  const nextData: OnboardingData = { ...body.data };
  for (const patch of result.data_patch) {
    nextData[patch.field] = patch.value;
  }

  if (!nextData.habitAction || !nextData.habitAmount || (!nextData.habitFrequency && !nextData.habitWhen)) {
    return {
      ...result,
      should_advance: false,
      next_step: "habit_action",
      reply: result.reply || getMissingHabitPlanReply(nextData),
    };
  }

  if (!nextData.habitPeriod) {
    nextData.habitPeriod = "4주";
  }

  return {
    ...result,
    should_advance: true,
    next_step: "goal_complete",
    data_patch: toPatchArray(createHabitPlanPatch(body.data, nextData)),
    reply: `좋아요. 이렇게 실행 계획을 잡아볼게요.\n\n${formatHabitPlanSummary(nextData)}\n\n이제 이 행동을 Mini / Plus / Elite로 나눠서, 컨디션이 낮은 날에도 완전히 실패한 날이 되지 않게 만들 거예요.`,
  };
}

async function normalizeElasticLevelResponse(
  client: OpenAI,
  body: OnboardingControllerRequest,
  result: OnboardingControllerResponse,
): Promise<OnboardingControllerResponse> {
  const targetField = currentFieldByStep[body.current_step];
  if (!targetField) return result;
  const taskPatch = result.data_patch.find((patch) => patch.field === targetField);
  if (!taskPatch) return result;

  const review = await reviewElasticLevelTask(client, body, body.current_step as ElasticLevelStep, taskPatch.value);
  if (review.decision !== "save") {
    return stay(body.current_step, {}, review.reply);
  }

  return {
    ...result,
    data_patch: result.data_patch.map((patch) =>
      patch.field === targetField && review.task ? { ...patch, value: review.task } : patch,
    ),
  };
}

type ElasticLevelStep = "mini" | "plus" | "elite";

async function reviewElasticLevelTask(
  client: OpenAI,
  body: OnboardingControllerRequest,
  level: ElasticLevelStep,
  proposedTask: string,
): Promise<ElasticLevelReviewResult> {
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          buildProofSystemPrompt(
            "Elastic Habit 레벨 검토자",
            "현재 호출은 elastic_level_quality_gate다. 목적은 Mini/Plus/Elite 후보가 각 레벨의 의미에 맞는지 검토하는 것이다.",
          ) +
          "\n\n[level_rules]\n" +
          "- Mini는 가장 힘든 날에도 가능한 최소 증거다. 원래 습관 목표와 같은 양이면 저장하지 않는다. 너무 작아 보여야 정상이다.\n" +
          "- Plus는 보통 날의 기본 성공 단위다. 보통 원래 습관 목표와 같거나 살짝 낮은 수준이다.\n" +
          "- Elite는 여유 있는 날의 확장 단위다. Plus보다 양이 더 많거나, 같은 양에 메모/요약/발췌/문제풀이/정리 같은 추가 깊이가 있으면 저장한다.\n" +
          "- 예: Plus가 '책 30쪽 읽기'라면 Elite 후보 '책 45쪽 읽기', '책 60쪽 읽기', '책 30쪽 읽고 핵심 3개 정리하기', '책 30쪽 읽고 5분 메모하기'는 모두 저장 가능하다.\n" +
          "- 네가 방금 제안한 예시를 사용자가 그대로 고르면 절대 다시 거부하지 않는다. 그 후보가 규칙에 맞으면 decision='save'다.\n" +
          "- 사용자가 '네가 알아서 넣어줘', '그렇게 해줘', '일단 확정할게'처럼 위임하거나 확정하면, 직전 제안이나 현재 맥락에서 가장 합리적인 저장 가능한 task를 선택해 decision='save'로 둔다.\n" +
          "- 레벨 간 크기 관계는 Mini < Plus <= Elite 흐름이다. 단, Elite의 <=는 양만이 아니라 깊이까지 포함한 확장성을 뜻한다.\n" +
          "- 사용자가 현재 레벨의 의미를 오해한 경우에만 decision='revise_step'으로 두고, 왜 막는지 짧게 설명한 뒤 적절한 예시 2-3개를 제안한다.\n" +
          "- 사용자의 제안이 저장 가능한데도 더 좋게 만들 수 있다는 이유만으로 막지 않는다. 저장 가능한 후보는 저장하고 다음 단계로 진행한다.\n" +
          "- 애매하면 한 가지 질문만 한다.\n" +
          "- 저장 가능하면 task에는 군더더기를 제거한 실행 문장만 넣는다.",
      },
      {
        role: "user",
        content: JSON.stringify({
          level,
          proposed_task: proposedTask,
          habit_action: body.data.habitAction,
          habit_period: body.data.habitPeriod,
          habit_frequency: body.data.habitFrequency,
          habit_when: body.data.habitWhen,
          habit_amount: body.data.habitAmount,
          current_tasks: {
            mini: body.data.miniTask,
            plus: body.data.plusTask,
            elite: body.data.eliteTask,
          },
          latest_user_answer: body.latest_user_answer,
          review_question: "이 proposed_task를 현재 level에 저장해도 되는가?",
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "elastic_level_review",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["decision", "task", "reply", "reason"],
          properties: {
            decision: { type: "string", enum: ["save", "revise_step", "ask_clarifying_question"] },
            task: { type: ["string", "null"] },
            reply: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
  });

  return JSON.parse(response.output_text) as ElasticLevelReviewResult;
}

async function reviewHabitAction(
  client: OpenAI,
  body: OnboardingControllerRequest,
  proposedHabitAction: string,
): Promise<HabitActionReviewResult> {
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          buildProofSystemPrompt(
            "습관 행동 품질 검토자",
            "현재 호출은 habit_action_quality_gate다. 목적은 온보딩 컨트롤러가 만든 habitAction 후보가 실제로 저장 가능한 습관 행동인지 검토하는 것이다.",
          ) +
          "\n\n[quality_criteria]\n" +
          "- 저장 가능한 habit_action은 사용자가 직접 통제할 수 있어야 한다.\n" +
          "- 오늘이나 내일부터 반복 가능한 루틴 행동이어야 한다.\n" +
          "- 구체적이어야 한다. 대상과 행동이 보여야 한다.\n" +
          "- 측정 가능해야 한다. 완료 여부가 yes/no로 판단되거나 횟수, 시간, 분량, 대상 수 같은 단위가 있어야 한다.\n" +
          "- 너무 추상적인 의도, 목표 영역, 감정, 메타 피드백, 질문, 불만, 재설계 요청은 habit_action으로 저장하지 않는다.\n" +
          "- 외부 사건이 발생해야만 가능한 행동은 루틴 행동으로 저장하지 않는다.\n" +
          "- 부적합하면 decision='revise_step', habit_action=null, missing_dimensions에 부족한 기준을 넣고, reply에서 왜 저장하지 않는지 짧게 인정한 뒤 현재 목표 영역에 맞는 구체 후보 2-3개를 제안한다.\n" +
          "- 애매하면 decision='ask_clarifying_question'으로 부족한 기준 하나만 묻는다.\n" +
          "- 같은 턴에서 여러 질문을 하지 않는다.\n" +
          "- 적합하면 decision='save'이고, habit_action에는 군더더기를 제거한 실행 행동만 넣는다.",
      },
      {
        role: "user",
        content: JSON.stringify({
          current_step: body.current_step,
          latest_user_answer: body.latest_user_answer,
          proposed_habit_action: proposedHabitAction,
          existing_profile: body.data,
          review_question:
            "이 proposed_habit_action을 habitAction 필드에 저장해도 되는가? 아니면 사용자가 행동 단계를 다시 설계하자는 문맥인가?",
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "habit_action_review",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["decision", "habit_action", "missing_dimensions", "reply", "reason"],
          properties: {
            decision: { type: "string", enum: ["save", "revise_step", "ask_clarifying_question"] },
            habit_action: { type: ["string", "null"] },
            missing_dimensions: {
              type: "array",
              items: { type: "string", enum: ["concrete", "measurable", "controllable", "repeatable"] },
            },
            reply: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
  });

  return JSON.parse(response.output_text) as HabitActionReviewResult;
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
      return advance("failure_feeling", { failureFeeling: text }, `${situation}에서 ${text}했던 거잖아요. 이건 의지력 문제가 아니라, 목표가 그날의 상황에 맞게 유연하지 않아서예요.\n\n이제 이 목표를 오늘이나 내일부터 바로 할 수 있고, 내가 통제할 수 있고, 완료 여부를 확인할 수 있는 행동으로 바꿔볼게요. 그래야 막혔을 때 나를 탓하는 대신, 행동의 크기나 조건을 조정할 수 있습니다. 이제 같이 만들어볼까요?`);
    }
    case "bridge":
      return { intent: "continue", should_advance: true, next_step: "bridge", data_patch: [], reply: "" };
    case "habit_action":
      return stay("habit_action", {}, "기간, 빈도, 언제, 행동, 양을 한 문장으로 말해주세요. 예: 4주 동안 주 3회, 퇴근 후 헬스장에서 웨이트 3종목을 60분 하기");
    case "habit_period":
      return advance("habit_period", { habitPeriod: text }, "일주일에 몇 번 할 계획인가요?");
    case "habit_frequency":
      return advance("habit_frequency", { habitFrequency: text }, "언제 할 건가요? 예: 저녁 식사 후, 아침 7시에");
    case "habit_when":
      return advance("habit_when", { habitWhen: text }, "한 번에 얼마나 할 건가요? 예: 10분, 3km, 1세트");
    case "habit_amount":
      return advance("habit_amount", { habitAmount: text }, "좋아요, 습관 목표가 완성됐어요. 다음은 이 행동을 Mini / Plus / Elite로 나눠서, 컨디션이 낮은 날에도 완전히 실패한 날이 되지 않게 만들 거예요.");
    case "mini":
      return advance("mini", { miniTask: text }, "Plus는 보통 날의 기본 성공 단위예요. 어떻게 할까요?");
    case "plus":
      return advance("plus", { plusTask: text }, "Elite는 여유 있는 날 도전하는 단위예요. 어떻게 할까요?");
    case "elite":
      return advance("elite", { eliteTask: text }, "완성됐어요. 이제부터 체크인은 평가가 아니라 관찰이에요. 어떤 조건에서 움직였고 어디서 막혔는지를 기록하면서 내일의 설계를 더 맞춰볼게요.");
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
