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
    return NextResponse.json(fallbackCorrectionTurn(body) ?? fallbackTurn(body));
  }

  const correction = await routeCorrection(openai, body);
  if (correction) {
    return NextResponse.json(correction);
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
          "[습관 목표 파트: habit_action→habit_period→habit_frequency→habit_when→habit_amount]\nSMART 습관 문장을 한 필드씩 채워나간다.\n- habit_action: 구체적인 행동\n- habit_period: 며칠/몇 주\n- habit_frequency: 주 몇 회 또는 매일\n- habit_when: 언제/어떤 상황\n- habit_amount: 얼마나\n\n" +
          "[habit_action 품질 기준]\n" +
          "- habit_action은 사용자가 오늘/내일 바로 실행할 수 있고, 직접 통제할 수 있고, 구체적이고, 측정 가능한 루틴 행동이어야 한다.\n" +
          "- 측정 가능하다는 뜻: 완료 여부를 사용자가 yes/no로 판단할 수 있거나, 횟수/시간/분량/대상 수 같은 단위가 들어 있다.\n" +
          "- 구체적이라는 뜻: 무엇을 대상으로 어떤 행동을 하는지가 드러난다. 예: '연애 노력하기'가 아니라 '대화 소재 1개 적기'.\n" +
          "- 외부 사건이 있어야 가능한 행동은 저장하지 않는다. 예: '소개팅이나 매칭 직후 연락하기'는 사용자가 매일 만들 수 없는 조건이므로 부적합하다.\n" +
          "- 사용자가 '작지 않다', '추상적이다', '루틴적으로 할 수 있어야 한다', '추천해줘', '행동 말이야'라고 말하면 그것을 habitAction 값으로 저장하지 않는다.\n" +
          "- 기준을 통과하지 못하면 should_advance=false, data_patch=[]로 두고, 부족한 차원 하나만 좁히는 질문 또는 현재 영역에 맞는 구체 후보 2-3개를 제안한다.\n" +
          "- 연애 영역 예시: '매일 저녁 10분 연락 후보 1명 정리하기', '대화 소재 1개 적기', '소개팅 앱 프로필 한 줄 개선하기'.\n\n" +
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
      return "이제 목표를 실제 행동으로 바꿔볼게요. 오늘이나 내일부터 바로 할 수 있고, 내가 통제할 수 있고, 완료 여부를 확인할 수 있는 행동이어야 해요. 어떤 행동으로 시작해볼까요?";
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
      return "구체적이고 사용자가 직접 통제할 수 있는 루틴 행동을 habitAction에 저장한다. 외부 사건이 있어야만 가능한 행동, 추상적인 방향, 메타 피드백, 추천 요청은 저장하지 않는다. 막연하면 2-3개의 구체 후보를 제안하고 should_advance=false.";
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

async function normalizeControllerResponse(
  client: OpenAI,
  body: OnboardingControllerRequest,
  result: OnboardingControllerResponse,
): Promise<OnboardingControllerResponse> {
  if (body.current_step === "mini" || body.current_step === "plus" || body.current_step === "elite") {
    return normalizeElasticLevelResponse(client, body, result);
  }
  if (body.current_step !== "habit_action") return result;

  const habitActionPatch = result.data_patch.find((patch) => patch.field === "habitAction");
  const proposed = habitActionPatch?.value.trim() ?? "";

  if (!habitActionPatch) return result;
  const review = await reviewHabitAction(client, body, proposed);
  if (review.decision !== "save") {
    return stay(
      "habit_action",
      {},
      review.reply,
    );
  }

  return {
    ...result,
    data_patch: result.data_patch.map((patch) =>
      patch.field === "habitAction" && review.habit_action ? { ...patch, value: review.habit_action } : patch,
    ),
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
          "- Elite는 여유 있는 날의 확장 단위다. Plus보다 더 크거나 깊어야 한다.\n" +
          "- 레벨 간 크기 관계가 깨지면 저장하지 않는다. Mini < Plus <= Elite 흐름이 되어야 한다.\n" +
          "- 사용자가 현재 레벨의 의미를 오해하면 decision='revise_step'으로 두고, 왜 막는지 짧게 설명한 뒤 적절한 예시 2-3개를 제안한다.\n" +
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
      return advance("habit_action", { habitAction: text }, "며칠 동안 실험해볼까요? 7일, 14일, 28일 중 선택해주세요.");
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
