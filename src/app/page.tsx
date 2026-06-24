"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, CalendarCheck, Check, Circle, Flame, MessageCircle, Minus, PencilLine, Target } from "lucide-react";
import { AuthPanel } from "@/components/AuthPanel";
import { LoadingState } from "@/components/LoadingState";
import { todayKey } from "@/lib/date";
import {
  deleteElasticScope,
  getElasticCheckIns,
  getElasticProfile,
  LIVE_ELASTIC_SCOPE,
  saveElasticCheckIn,
  saveElasticProfile,
  updateElasticTasks,
} from "@/lib/elastic-store";
import type { ElasticCheckIn, ElasticCheckInStatus, ElasticProfile } from "@/lib/elastic-types";
import { useProofSession } from "@/lib/use-proof-session";

type ElasticLevel = "mini" | "plus" | "elite";
type CheckInStatus = ElasticCheckInStatus | "open";
type OnboardingStep =
  | "goal_area"
  | "goal_why"
  | "goal_identity"
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

type GoalData = {
  lifeArea: string;
  whyChange: string;
  identityStatement: string;
};

type Message = {
  role: "assistant" | "user";
  text: string;
};

type OnboardingData = {
  lifeArea: string;
  whyChange: string;
  goalIdentityStatement: string;
  habitAction: string;
  habitPeriod: string;
  habitFrequency: string;
  habitWhen: string;
  habitAmount: string;
  miniTask: string;
  plusTask: string;
  eliteTask: string;
};

type OnboardingControllerResult = {
  intent: "answer" | "question" | "correction" | "unclear" | "continue";
  should_advance: boolean;
  next_step: OnboardingStep;
  data_patch: {
    field: keyof OnboardingData;
    value: string;
  }[];
  reply: string;
};

type OnboardingTurnResult = {
  final: OnboardingControllerResult;
  raw?: OnboardingControllerResult;
  source: "api" | "fallback";
};

type OnboardingDebugEvent = {
  id: string;
  input: string;
  stepBefore: OnboardingStep;
  raw?: OnboardingControllerResult;
  final: OnboardingControllerResult;
  source: "api" | "fallback";
};

type DailyRecord = {
  day: number;
  status: CheckInStatus;
};

const emptyOnboarding: OnboardingData = {
  lifeArea: "",
  whyChange: "",
  goalIdentityStatement: "",
  habitAction: "",
  habitPeriod: "",
  habitFrequency: "",
  habitWhen: "",
  habitAmount: "",
  miniTask: "",
  plusTask: "",
  eliteTask: "",
};

const emptyGoalData: GoalData = { lifeArea: "", whyChange: "", identityStatement: "" };

const GOAL_AREA_QUESTION =
  "요즘 가장 바꾸고 싶은 삶의 영역은 무엇인가요?\n공부, 운동, 수면, 일, 감정관리, 인간관계 중 어디에 가까운지 자유롭게 말해주세요.";

const selfNarrativeKeywords = ["의지", "한심", "원래 그런", "이상해", "못하는 사람", "의지력"];

const statusMeta = {
  mini: { label: "Mini", icon: Check },
  plus: { label: "Plus", icon: Check },
  elite: { label: "Elite", icon: Check },
  not_done: { label: "안함", icon: Circle },
  no_response: { label: "무응답", icon: Minus },
  open: { label: "열림", icon: PencilLine },
};

const MINI_OPENING = (habitAction: string) =>
  `습관 목표가 완성됐어요. 이제 Elastic Habit의 세 단계를 설정할게요.\n\nMini는 피곤하거나 바쁜 날에도 할 수 있는 가장 작은 행동이에요. "${habitAction}"을 기준으로 Mini는 어떻게 설정할까요?\n예: 1문제만 풀기, 5분만 켜놓기`;

const initialMessages: Message[] = [];
const DEBUG_SESSION_KEY = "proof-elastic-debug-session";

function createDebugSessionId() {
  return crypto.randomUUID();
}

function readDebugSessionId() {
  if (typeof window === "undefined") return "";
  const current = window.localStorage.getItem(DEBUG_SESSION_KEY);
  if (current) return current;
  const next = createDebugSessionId();
  window.localStorage.setItem(DEBUG_SESSION_KEY, next);
  return next;
}

export default function Home() {
  const { loading, userId } = useProofSession();
  const [mode, setMode] = useState<"onboarding" | "daily">("onboarding");
  const [step, setStep] = useState<OnboardingStep>("goal_area");
  const [goalData, setGoalData] = useState<GoalData>(emptyGoalData);
  const [data, setData] = useState<OnboardingData>(emptyOnboarding);
  const [records, setRecords] = useState<DailyRecord[]>(createMonthRecords([]));
  const [checkIns, setCheckIns] = useState<ElasticCheckIn[]>([]);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [selectedCheckIn, setSelectedCheckIn] = useState<CheckInStatus | null>(null);
  const [memo, setMemo] = useState("");
  const [nextMini, setNextMini] = useState("");
  const [nextPlus, setNextPlus] = useState("");
  const [nextElite, setNextElite] = useState("");
  const [miniFailureCount, setMiniFailureCount] = useState(0);
  const [pending, setPending] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [debugEnabled] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1",
  );
  const [debugSessionId, setDebugSessionId] = useState(() => (debugEnabled ? readDebugSessionId() : ""));
  const [debugEvents, setDebugEvents] = useState<OnboardingDebugEvent[]>([]);
  const [goalExpanded, setGoalExpanded] = useState(false);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const storageScope = debugEnabled ? `debug:${debugSessionId}` : LIVE_ELASTIC_SCOPE;

  useEffect(() => {
    async function load() {
      if (!userId) return;

      const [profile, checkIns] = await Promise.all([
        getElasticProfile(userId, storageScope),
        getElasticCheckIns(userId, storageScope),
      ]);
      if (profile?.onboarding_completed_at) {
        const nextData = mapProfileToData(profile);
        setData(nextData);
        setGoalData(mapProfileToGoalData(profile));
        setNextMini(nextData.miniTask);
        setNextPlus(nextData.plusTask);
        setNextElite(nextData.eliteTask);
        setMode("daily");
        setStep("complete");
        setMessages([
          { role: "assistant", text: "오늘 체크인을 남겨주세요. 결과는 왼쪽 Elastic Habit Tracker에 저장됩니다." },
        ]);
      } else {
        resetOnboardingState();
        assistant(GOAL_AREA_QUESTION);
      }

      setCheckIns(checkIns);
      setRecords(createMonthRecords(checkIns));
      setMiniFailureCount(countRecentMiniFailures(checkIns));
      const today = checkIns.find((checkIn) => checkIn.checkin_date === todayKey());
      if (today) {
        setSelectedCheckIn(today.result);
        setMemo(today.memo ?? "");
      }
    }

    void load();
  }, [userId, storageScope]);

  useEffect(() => {
    const chatLog = chatLogRef.current;
    if (!chatLog) return;

    requestAnimationFrame(() => {
      chatLog.scrollTo({ top: chatLog.scrollHeight, behavior: "smooth" });
    });
  }, [messages]);

  const levelCounts = useMemo(
    () => ({
      mini: records.filter((record) => record.status === "mini").length,
      plus: records.filter((record) => record.status === "plus").length,
      elite: records.filter((record) => record.status === "elite").length,
      notDone: records.filter((record) => record.status === "not_done").length,
      noResponse: records.filter((record) => record.status === "no_response").length,
    }),
    [records],
  );
  const completedCount = levelCounts.plus + levelCounts.elite;
  const partialCount = levelCounts.mini;
  const baseScore = levelCounts.mini + levelCounts.plus * 2 + levelCounts.elite * 3;
  const bonusItems = getBonusItems(levelCounts);
  const bonusScore = bonusItems.reduce((sum, item) => sum + item.points, 0);
  const totalScore = baseScore + bonusScore;

  async function handleTextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;

    setMessages((current) => [...current, { role: "user", text }]);
    setInput("");

    if (step === "mini" || step === "plus" || step === "elite") {
      await advanceOnboarding(text);
    } else {
      await advanceGoal(text);
    }
  }

  async function advanceGoal(text: string) {
    setPending(true);
    const currentData = { ...data };
    const turn = await runOnboardingController(step, text, currentData);
    recordDebugEvent(step, text, turn);
    const result = turn.final;

    const nextData = applyOnboardingPatch(currentData, result.data_patch);
    setData(nextData);
    assistant(result.reply);

    if (result.should_advance) {
      setStep(result.next_step);
    }
    setGoalData({
      lifeArea: nextData.lifeArea || goalData.lifeArea,
      whyChange: nextData.whyChange || goalData.whyChange,
      identityStatement: nextData.goalIdentityStatement || goalData.identityStatement,
    });
    setPending(false);
  }

  async function advanceOnboarding(text: string) {
    setPending(true);
    const currentData = { ...data };
    const turn = await runOnboardingController(step, text, currentData);
    recordDebugEvent(step, text, turn);
    await applyOnboardingResult(turn.final, currentData);
    setPending(false);
  }

  async function handleContinueButton() {
    if (step === "goal_complete") {
      setStep("mini");
      assistant(MINI_OPENING(data.habitAction || "이 습관"));
    }
  }

  function recordDebugEvent(stepBefore: OnboardingStep, input: string, turn: OnboardingTurnResult) {
    if (!debugEnabled) return;
    setDebugEvents((current) =>
      [
        {
          id: `${Date.now()}-${current.length}`,
          input,
          stepBefore,
          raw: turn.raw,
          final: turn.final,
          source: turn.source,
        },
        ...current,
      ].slice(0, 6),
    );
  }

  async function applyOnboardingResult(result: OnboardingControllerResult, baseData = data) {
    const nextData = applyOnboardingPatch(baseData, result.data_patch);
    setData(nextData);
    assistant(result.reply);

    if (!result.should_advance) return;

    setStep(result.next_step);

    if (result.next_step === "complete") {
      setNextMini(nextData.miniTask);
      setNextPlus(nextData.plusTask);
      setNextElite(nextData.eliteTask);
      await persistProfile(nextData);
      setMode("daily");
    }
  }

  function handleCheckIn(status: Exclude<CheckInStatus, "open" | "no_response">) {
    setSelectedCheckIn(status);
  }

  async function saveDailyCheckIn() {
    if (!selectedCheckIn || !userId || selectedCheckIn === "open") return;

    const hasSelfNarrative = selfNarrativeKeywords.some((keyword) => memo.includes(keyword));
    const saved = await saveElasticCheckIn({
      user_id: userId,
      scope: storageScope,
      result: selectedCheckIn,
      memo,
      self_narrative_detected: hasSelfNarrative,
    });
    applySavedCheckIn(saved);
    const nextCheckIns = upsertCheckIn(checkIns, saved);
    setCheckIns(nextCheckIns);
    const contextualReply = await createContextualReply("checkin_saved", data, nextCheckIns);
    setMessages((current) => [
      ...current,
      { role: "user", text: createDailyNote(selectedCheckIn, memo) },
      ...(hasSelfNarrative
        ? [{ role: "assistant" as const, text: "기억하시죠, 오늘은 그 사람인지가 아니라 이 행동을 했는지만 보기로 했었죠" }]
        : []),
      { role: "assistant", text: contextualReply },
    ]);
    setMiniFailureCount((current) => (selectedCheckIn === "not_done" ? current + 1 : 0));
    setSaveMessage("체크인을 Supabase에 저장했어요.");
  }

  async function saveNextPlan() {
    if (!userId) return;
    const nextTasks = {
      mini_task: nextMini || data.miniTask,
      plus_task: nextPlus || data.plusTask,
      elite_task: nextElite || data.eliteTask,
    };
    await updateElasticTasks(userId, nextTasks, storageScope);
    const nextData = {
      ...data,
      miniTask: nextTasks.mini_task,
      plusTask: nextTasks.plus_task,
      eliteTask: nextTasks.elite_task,
    };
    setData(nextData);
    assistant(await createContextualReply("plan_saved", nextData, checkIns));
  }

  async function markNoResponse() {
    if (!userId) return;
    const saved = await saveElasticCheckIn({ user_id: userId, scope: storageScope, result: "no_response" });
    applySavedCheckIn(saved);
    const nextCheckIns = upsertCheckIn(checkIns, saved);
    setCheckIns(nextCheckIns);
    assistant(await createContextualReply("no_response_saved", data, nextCheckIns));
  }

  async function persistProfile(nextData: OnboardingData) {
    if (!userId) return;
    await saveElasticProfile({
      user_id: userId,
      scope: storageScope,
      life_area: nextData.lifeArea || null,
      why_change: nextData.whyChange || null,
      identity_statement: nextData.goalIdentityStatement || null,
      habit_name: buildSmartSentence(nextData) || nextData.habitAction,
      habit_action: nextData.habitAction || null,
      habit_period: nextData.habitPeriod || null,
      habit_frequency: nextData.habitFrequency || null,
      habit_when: nextData.habitWhen || null,
      habit_amount: nextData.habitAmount || null,
      identity_motive: "",
      motive_summary: null,
      recent_failure_date: null,
      pre_breakdown_feeling: null,
      actual_breakdown_behavior: null,
      recovery_method: null,
      mini_task: nextData.miniTask,
      plus_task: nextData.plusTask,
      elite_task: nextData.eliteTask,
      monthly_vision: null,
      onboarding_completed_at: new Date().toISOString(),
    });
  }

  function resetOnboardingState() {
    setMode("onboarding");
    setStep("goal_area");
    setGoalData(emptyGoalData);
    setData(emptyOnboarding);
    setRecords(createMonthRecords([]));
    setCheckIns([]);
    setMessages([]);
    setInput("");
    setSelectedCheckIn(null);
    setMemo("");
    setNextMini("");
    setNextPlus("");
    setNextElite("");
    setMiniFailureCount(0);
    setSaveMessage(null);
  }

  async function resetDebugConversation() {
    resetOnboardingState();
    setDebugEvents([]);
    assistant(GOAL_AREA_QUESTION);
  }

  function jumpToStep(target: OnboardingStep) {
    setStep(target);
    setMessages([{ role: "assistant", text: `[debug] ${target} 단계로 이동` }]);
  }

  async function skipGoalPhase() {
    const skipped = {
      ...data,
      lifeArea: "[스킵]",
      whyChange: "[스킵]",
      goalIdentityStatement: "[스킵]",
      habitAction: "[스킵]",
      habitPeriod: "[스킵]",
      habitFrequency: "[스킵]",
      habitWhen: "[스킵]",
      habitAmount: "[스킵]",
    };
    setData(skipped);
    setGoalData({ lifeArea: "[스킵]", whyChange: "[스킵]", identityStatement: "[스킵]" });
    setStep("mini");
    assistant(MINI_OPENING("이 습관"));
  }

  async function resetCurrentDebugSession() {
    if (!userId || !debugEnabled) return;
    setPending(true);
    await deleteElasticScope(userId, storageScope);
    await resetDebugConversation();
    setPending(false);
  }

  function startNewDebugSession() {
    if (!debugEnabled) return;
    const next = createDebugSessionId();
    window.localStorage.setItem(DEBUG_SESSION_KEY, next);
    setDebugSessionId(next);
    setDebugEvents([]);
  }

  function applySavedCheckIn(checkIn: ElasticCheckIn) {
    setRecords((current) =>
      current.map((record) =>
        record.day === Number(checkIn.checkin_date.slice(-2)) ? { ...record, status: checkIn.result } : record,
      ),
    );
    setSelectedCheckIn(checkIn.result);
  }

  function assistant(text: string) {
    setMessages((current) => [...current, { role: "assistant", text }]);
  }

  if (loading) return <LoadingState />;

  const isGoalPhase = step !== "mini" && step !== "plus" && step !== "elite" && step !== "complete";

  return (
    <main className="tracker-workspace">
      {isGoalPhase ? (
        <GoalPanel data={data} goalData={goalData} step={step} />
      ) : (
      <section className="tracker-panel" aria-label="Elastic habit tracker">
        <div className="tracker-header">
          <div>
            <p className="eyebrow">Elastic Habit Tracker</p>
            <h1>{data.habitAction || "습관 설정 중"}</h1>
          </div>
          <div className="tracker-score">
            <strong>{completedCount}</strong>
            <span>Plus/Elite 완료</span>
          </div>
        </div>

        {(goalData.lifeArea || goalData.whyChange || goalData.identityStatement) && (
          <section className="goal-summary-band">
            <button
              className="goal-summary-toggle"
              onClick={() => setGoalExpanded((v) => !v)}
              type="button"
            >
              <span>내 목표</span>
              <span className="goal-summary-preview">
                {goalExpanded ? "▲" : (goalData.identityStatement || goalData.lifeArea)}
              </span>
            </button>
            {goalExpanded && (
              <div className="goal-summary-body">
                {goalData.lifeArea && (
                  <div className="goal-summary-row">
                    <span>삶의 영역</span>
                    <p>{goalData.lifeArea}</p>
                  </div>
                )}
                {goalData.whyChange && (
                  <div className="goal-summary-row">
                    <span>바꾸고 싶은 이유</span>
                    <p>{goalData.whyChange}</p>
                  </div>
                )}
                {goalData.identityStatement && (
                  <div className="goal-summary-row goal-summary-identity">
                    <span>정체성 문장</span>
                    <p>"{goalData.identityStatement}"</p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <div className="elastic-grid">
          <section className="tracker-tile level-mini">
            <span>Mini</span>
            <strong>{data.miniTask || "최소 단위"}</strong>
          </section>
          <section className="tracker-tile level-plus">
            <span>Plus</span>
            <strong>{data.plusTask || "보통 단위"}</strong>
          </section>
          <section className="tracker-tile level-elite">
            <span>Elite</span>
            <strong>{data.eliteTask || "도전 단위"}</strong>
          </section>
        </div>

        <section className="tracker-band">
          <div className="band-title">
            <Flame size={18} aria-hidden="true" />
            <span>V1 개인화</span>
          </div>
          <p>
            {miniFailureCount >= 3
              ? "Mini를 더 쉽게 조정해볼까요?"
              : "V1에서는 Mini 연속 실패만 감지합니다. 감정/회복 데이터는 저장만 합니다."}
          </p>
        </section>

        <section className="today-strip">
          <div>
            <div className="band-title">
              <CalendarCheck size={18} aria-hidden="true" />
              <span>오늘 체크인</span>
            </div>
            <p>{selectedCheckIn ? createDailyNote(selectedCheckIn, memo) : "오늘 어떤 단계까지 했는지 선택합니다."}</p>
          </div>
          <span className={`tracker-status ${selectedCheckIn || "open"}`}>{statusMeta[selectedCheckIn || "open"].label}</span>
        </section>

        <section className="scorecard-strip" aria-label="이번 달 Mini Plus Elite 카운트">
          <div>
            <span>Mini / partial</span>
            <strong>{partialCount}</strong>
          </div>
          <div>
            <span>Plus / 완료</span>
            <strong>{levelCounts.plus}</strong>
          </div>
          <div>
            <span>Elite / 완료</span>
            <strong>{levelCounts.elite}</strong>
          </div>
        </section>

        <section className="elastic-scorecard" aria-label="월간 스코어카드">
          <div className="scorecard-title">Scorecard</div>
          <div className="scorecard-columns">
            <section>
              <span>Counts</span>
              <div className="score-counts">
                <strong className="mini-count">Mini {levelCounts.mini}</strong>
                <strong className="plus-count">Plus {levelCounts.plus}</strong>
                <strong className="elite-count">Elite {levelCounts.elite}</strong>
              </div>
            </section>
            <section>
              <span>Base Scores</span>
              <p>
                {levelCounts.mini} + ({levelCounts.plus} x 2) + ({levelCounts.elite} x 3) = <strong>{baseScore}</strong>
              </p>
            </section>
            <section>
              <span>Bonuses</span>
              {bonusItems.length ? (
                <ul>
                  {bonusItems.map((item) => (
                    <li key={item.label}>
                      {item.label} +{item.points}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>아직 없음</p>
              )}
            </section>
            <section>
              <span>Total Score</span>
              <p>
                {baseScore} + {bonusScore} = <strong>{totalScore}</strong>
              </p>
            </section>
          </div>
        </section>

        <section className="month-grid" aria-label="이번 달 기록">
          {records.map((record) => {
            const Icon = statusMeta[record.status].icon;
            return (
              <div className={`day-cell ${record.status}`} key={record.day}>
                <span>{record.day}</span>
                <Icon size={17} aria-hidden="true" />
              </div>
            );
          })}
        </section>
      </section>
      )}

      <aside className="chat-panel" aria-label="Proof onboarding and check-in">
        <div className="chat-title">
          <MessageCircle size={18} aria-hidden="true" />
          <div>
            <strong>{mode === "onboarding" ? "Proof Onboarding" : "Daily Check-in"}</strong>
            <span>{mode === "onboarding" ? "챗봇 온보딩" : "Supabase 저장 연결됨"}</span>
          </div>
        </div>


        {!userId ? (
          <div className="daily-panel">
            <AuthPanel />
          </div>
        ) : (
          <>
            <div className="chat-log" ref={chatLogRef}>
              {messages.map((message, index) => (
                <div className={`chat-bubble ${message.role}`} key={`${message.role}-${index}`}>
                  {message.text}
                </div>
              ))}
            </div>

            {saveMessage ? <p className="form-message">{saveMessage}</p> : null}

            {mode === "onboarding" ? (
              <OnboardingComposer
                input={input}
                setInput={setInput}
                step={step}
                pending={pending}
                onSubmit={handleTextSubmit}
                onContinue={handleContinueButton}
              />
            ) : (
              <DailyCheckIn
                data={data}
                memo={memo}
                nextElite={nextElite}
                nextMini={nextMini}
                nextPlus={nextPlus}
                selectedCheckIn={selectedCheckIn}
                setMemo={setMemo}
                setNextElite={setNextElite}
                setNextMini={setNextMini}
                setNextPlus={setNextPlus}
                onCheckIn={handleCheckIn}
                onNoResponse={markNoResponse}
                onSaveCheckIn={saveDailyCheckIn}
                onSavePlan={saveNextPlan}
              />
            )}

            {debugEnabled ? (
              <OnboardingDebugPanel
                data={data}
                events={debugEvents}
                goalData={goalData}
                onJumpToStep={jumpToStep}
                onNewSession={startNewDebugSession}
                onResetConversation={resetDebugConversation}
                onResetSession={resetCurrentDebugSession}
                onSkipGoal={skipGoalPhase}
                pending={pending}
                scope={storageScope}
                sessionId={debugSessionId}
                step={step}
              />
            ) : null}
          </>
        )}
      </aside>
    </main>
  );
}

const ALL_STEPS: OnboardingStep[] = [
  "goal_area", "goal_why", "goal_identity",
  "habit_action", "habit_period", "habit_frequency", "habit_when", "habit_amount",
  "goal_complete", "mini", "plus", "elite", "complete",
];

const INTENT_COLOR: Record<string, string> = {
  answer: "#35a942",
  question: "#6a57e8",
  correction: "#e8a010",
  unclear: "#9a4b45",
  continue: "#315b4c",
};

function OnboardingDebugPanel({
  data,
  events,
  goalData,
  onJumpToStep,
  onNewSession,
  onResetConversation,
  onResetSession,
  onSkipGoal,
  pending,
  scope,
  sessionId,
  step,
}: {
  data: OnboardingData;
  events: OnboardingDebugEvent[];
  goalData: GoalData;
  onJumpToStep: (step: OnboardingStep) => void;
  onNewSession: () => void;
  onResetConversation: () => void;
  onResetSession: () => void;
  onSkipGoal: () => void;
  pending: boolean;
  scope: string;
  sessionId: string;
  step: OnboardingStep;
}) {
  const currentIdx = ALL_STEPS.indexOf(step);

  const goalFields: [string, string][] = [
    ["삶의 영역", goalData.lifeArea],
    ["이유", goalData.whyChange],
    ["정체성 문장", goalData.identityStatement],
  ];
  const habitFields: [string, string][] = [
    ["행동", data.habitAction],
    ["기간", data.habitPeriod],
    ["빈도", data.habitFrequency],
    ["언제", data.habitWhen],
    ["얼마나", data.habitAmount],
    ["Mini", data.miniTask],
    ["Plus", data.plusTask],
    ["Elite", data.eliteTask],
  ];

  const [open, setOpen] = useState(false);

  return (
    <section className="debug-panel" aria-label="온보딩 디버그">
      <button className="debug-header-row debug-toggle" onClick={() => setOpen((v) => !v)} type="button">
        <strong className="debug-current-step">{step}</strong>
        <span className="debug-meta-inline">
          {scope} · {sessionId.slice(0, 8)}
        </span>
        <span className="debug-toggle-arrow">{open ? "▲" : "▼"}</span>
      </button>

      {!open ? null : (<>

      {/* Step progress */}
      <div className="debug-step-progress">
        {ALL_STEPS.map((s, i) => (
          <button
            key={s}
            className={`debug-step-chip${i === currentIdx ? " active" : i < currentIdx ? " done" : ""}`}
            disabled={pending}
            onClick={() => onJumpToStep(s)}
            title={s}
            type="button"
          >
            {s.replace("goal_", "g:").replace("habit_", "h:")}
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <div className="debug-actions">
        <button className="debug-btn-accent" disabled={pending} onClick={onSkipGoal} type="button">전체 스킵→mini</button>
        <button disabled={pending} onClick={onResetConversation} type="button">대화 초기화</button>
        <button disabled={pending} onClick={onResetSession} type="button">세션 초기화</button>
        <button disabled={pending} onClick={onNewSession} type="button">새 세션</button>
      </div>

      {/* Current data snapshot */}
      <details open>
        <summary className="debug-section-title">현재 데이터</summary>
        <div className="debug-data-grid">
          <div className="debug-data-section">
            <span>Goal</span>
            {goalFields.map(([label, val]) => (
              <div key={label} className={`debug-data-row${val ? " filled" : " empty"}`}>
                <span>{label}</span>
                <span>{val || "—"}</span>
              </div>
            ))}
          </div>
          <div className="debug-data-section">
            <span>Habit</span>
            {habitFields.map(([label, val]) => (
              <div key={label} className={`debug-data-row${val ? " filled" : " empty"}`}>
                <span>{label}</span>
                <span>{val || "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </details>

      {/* Recent turns */}
      <details open>
        <summary className="debug-section-title">최근 턴 ({events.length})</summary>
        {events.length ? (
          events.map((event) => (
            <details key={event.id} className="debug-turn">
              <summary>
                <span
                  className="debug-intent-badge"
                  style={{ background: INTENT_COLOR[event.final.intent] ?? "#444" }}
                >
                  {event.final.intent}
                </span>
                <span className="debug-turn-route">
                  {event.stepBefore} → {event.final.next_step}
                </span>
                <span className="debug-source-badge">{event.source}</span>
                {event.final.should_advance && <span className="debug-advance-badge">▶</span>}
              </summary>
              <div className="debug-turn-body">
                <div className="debug-turn-input">입력: {event.input || "(없음)"}</div>
                <div className="debug-turn-reply">응답: {event.final.reply}</div>
                {event.final.data_patch.length > 0 && (
                  <pre>{JSON.stringify(event.final.data_patch, null, 2)}</pre>
                )}
              </div>
            </details>
          ))
        ) : (
          <p>아직 턴이 없습니다.</p>
        )}
      </details>
      </>)}
    </section>
  );
}

function OnboardingComposer({
  input,
  onContinue,
  onSubmit,
  pending,
  setInput,
  step,
}: {
  input: string;
  onContinue: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  setInput: (value: string) => void;
  step: OnboardingStep;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 130)}px`;
  }, [input, pending, step]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  if (step === "goal_complete") {
    return (
      <button className="primary-button" disabled={pending} onClick={onContinue} type="button">
        {pending ? "준비하는 중…" : "습관 트래커로 넘어갈게요"}
      </button>
    );
  }

  return (
    <form className="chat-composer" onSubmit={onSubmit}>
      <textarea
        aria-label="온보딩 답변"
        disabled={step === "complete" || pending}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={pending ? "Proof가 생각하는 중…" : step === "complete" ? "온보딩 완료" : "답변을 입력하세요"}
        ref={textareaRef}
        rows={1}
        value={input}
      />
      <button aria-label="보내기" disabled={step === "complete" || pending} type="submit">
        <ArrowUp size={18} aria-hidden="true" />
      </button>
    </form>
  );
}

function DailyCheckIn({
  data,
  memo,
  nextElite,
  nextMini,
  nextPlus,
  selectedCheckIn,
  setMemo,
  setNextElite,
  setNextMini,
  setNextPlus,
  onCheckIn,
  onNoResponse,
  onSaveCheckIn,
  onSavePlan,
}: {
  data: OnboardingData;
  memo: string;
  nextElite: string;
  nextMini: string;
  nextPlus: string;
  selectedCheckIn: CheckInStatus | null;
  setMemo: (value: string) => void;
  setNextElite: (value: string) => void;
  setNextMini: (value: string) => void;
  setNextPlus: (value: string) => void;
  onCheckIn: (status: Exclude<CheckInStatus, "open" | "no_response">) => void;
  onNoResponse: () => void;
  onSaveCheckIn: () => void;
  onSavePlan: () => void;
}) {
  return (
    <div className="daily-panel">
      <section className="daily-card">
        <strong>오늘 {data.habitAction || "습관"} 중 뭘 했어요?</strong>
        <div className="checkin-buttons">
          <button className={selectedCheckIn === "mini" ? "selected mini" : "mini"} onClick={() => onCheckIn("mini")} type="button">
            Mini
          </button>
          <button className={selectedCheckIn === "plus" ? "selected plus" : "plus"} onClick={() => onCheckIn("plus")} type="button">
            Plus
          </button>
          <button className={selectedCheckIn === "elite" ? "selected elite" : "elite"} onClick={() => onCheckIn("elite")} type="button">
            Elite
          </button>
          <button
            className={selectedCheckIn === "not_done" ? "selected not-done" : "not-done"}
            onClick={() => onCheckIn("not_done")}
            type="button"
          >
            안함
          </button>
        </div>
        <textarea
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="선택 메모. 자기비난 키워드가 들어오면 고정 전환 문장을 다시 보여줍니다."
          rows={3}
        />
        <div className="daily-actions">
          <button className="secondary-action no-margin" onClick={onNoResponse} type="button">
            무응답으로 보기
          </button>
          <button className="primary-button" disabled={!selectedCheckIn} onClick={onSaveCheckIn} type="button">
            체크인 저장
          </button>
        </div>
      </section>

      <section className="daily-card">
        <strong>내일 Mini / Plus / Elite 계획</strong>
        <label>
          <span>Mini</span>
          <input value={nextMini} onChange={(event) => setNextMini(event.target.value)} placeholder={data.miniTask} />
        </label>
        <label>
          <span>Plus</span>
          <input value={nextPlus} onChange={(event) => setNextPlus(event.target.value)} placeholder={data.plusTask} />
        </label>
        <label>
          <span>Elite</span>
          <input value={nextElite} onChange={(event) => setNextElite(event.target.value)} placeholder={data.eliteTask} />
        </label>
        <button className="primary-button" onClick={onSavePlan} type="button">
          내일 계획 확인
        </button>
      </section>
    </div>
  );
}

async function runOnboardingController(currentStep: OnboardingStep, latestUserAnswer: string, data: OnboardingData) {
  try {
    const response = await fetch("/api/elastic/onboarding-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_step: currentStep,
        latest_user_answer: latestUserAnswer,
        data,
      }),
    });

    if (!response.ok) throw new Error("Failed");
    const raw = (await response.json()) as OnboardingControllerResult;
    return {
      final: normalizeOnboardingResult(currentStep, latestUserAnswer, data, raw),
      raw,
      source: "api" as const,
    };
  } catch {
    return {
      final: fallbackOnboardingTurn(currentStep, latestUserAnswer, data),
      source: "fallback" as const,
    };
  }
}

function normalizeOnboardingResult(
  _currentStep: OnboardingStep,
  _latestUserAnswer: string,
  _data: OnboardingData,
  result: OnboardingControllerResult,
) {
  return result;
}

function fallbackOnboardingTurn(
  currentStep: OnboardingStep,
  latestUserAnswer: string,
  _data: OnboardingData,
): OnboardingControllerResult {
  const text = latestUserAnswer.trim();
  switch (currentStep) {
    case "mini":
      return advanceOnboardingStep(currentStep, { miniTask: text }, "좋아요. Plus는 보통 날의 기본 성공 단위예요. 어떻게 설정할까요?");
    case "plus":
      return advanceOnboardingStep(currentStep, { plusTask: text }, "좋아요. Elite는 여유 있는 날 도전하는 단위예요. 어떻게 할까요?");
    case "elite":
      return advanceOnboardingStep(currentStep, { eliteTask: text }, "완성됐어요. 이제 매일 체크인을 시작해볼게요.");
    default:
      return stayOnboarding(currentStep, {}, "조금 더 구체적으로 말씀해주세요.");
  }
}

function advanceOnboardingStep(
  currentStep: OnboardingStep,
  dataPatch: Partial<OnboardingData>,
  reply: string,
): OnboardingControllerResult {
  return {
    intent: "answer",
    should_advance: true,
    next_step: getNextOnboardingStep(currentStep),
    data_patch: toOnboardingPatch(dataPatch),
    reply,
  };
}

function stayOnboarding(
  currentStep: OnboardingStep,
  dataPatch: Partial<OnboardingData>,
  reply: string,
): OnboardingControllerResult {
  return {
    intent: "question",
    should_advance: false,
    next_step: currentStep,
    data_patch: toOnboardingPatch(dataPatch),
    reply,
  };
}

function applyOnboardingPatch(
  data: OnboardingData,
  dataPatch: OnboardingControllerResult["data_patch"],
): OnboardingData {
  return dataPatch.reduce((next, item) => ({ ...next, [item.field]: item.value }), data);
}

function toOnboardingPatch(dataPatch: Partial<OnboardingData>): OnboardingControllerResult["data_patch"] {
  return Object.entries(dataPatch).map(([field, value]) => ({
    field: field as keyof OnboardingData,
    value: value ?? "",
  }));
}

function getNextOnboardingStep(currentStep: OnboardingStep): OnboardingStep {
  const steps: OnboardingStep[] = ALL_STEPS;
  const index = steps.indexOf(currentStep);
  return steps[Math.min(index + 1, steps.length - 1)] ?? currentStep;
}

function buildSmartSentence(data: OnboardingData): string {
  const { habitPeriod, habitFrequency, habitWhen, habitAction, habitAmount } = data;
  if (!habitAction) return "";
  const parts: string[] = [];
  if (habitPeriod) parts.push(`${habitPeriod} 동안`);
  if (habitFrequency) parts.push(habitFrequency);
  if (habitWhen) parts.push(`${habitWhen}에`);
  parts.push(habitAction + "을");
  if (habitAmount) parts.push(`${habitAmount} 한다`);
  else parts.push("한다");
  return `나는 ${parts.join(", ")}.`;
}

function createDailyNote(status: CheckInStatus, memo: string) {
  const statusText = status === "not_done" ? "안함" : status === "no_response" ? "무응답" : status;
  return memo ? `${statusText}: ${memo}` : statusText;
}

function mapProfileToData(profile: ElasticProfile): OnboardingData {
  return {
    lifeArea: profile.life_area ?? "",
    whyChange: profile.why_change ?? "",
    goalIdentityStatement: profile.identity_statement ?? "",
    habitAction: profile.habit_action ?? profile.habit_name ?? "",
    habitPeriod: profile.habit_period ?? "",
    habitFrequency: profile.habit_frequency ?? "",
    habitWhen: profile.habit_when ?? "",
    habitAmount: profile.habit_amount ?? "",
    miniTask: profile.mini_task,
    plusTask: profile.plus_task,
    eliteTask: profile.elite_task,
  };
}

function mapProfileToGoalData(profile: ElasticProfile): GoalData {
  return {
    lifeArea: profile.life_area ?? "",
    whyChange: profile.why_change ?? "",
    identityStatement: profile.identity_statement ?? "",
  };
}

function upsertCheckIn(checkIns: ElasticCheckIn[], saved: ElasticCheckIn) {
  return [...checkIns.filter((checkIn) => checkIn.checkin_date !== saved.checkin_date), saved].sort((a, b) =>
    a.checkin_date.localeCompare(b.checkin_date),
  );
}

async function createContextualReply(
  event: "checkin_saved" | "plan_saved" | "no_response_saved",
  data: OnboardingData,
  checkIns: ElasticCheckIn[],
) {
  try {
    const response = await fetch("/api/elastic/contextual-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        today: todayKey(),
        timezone: "Asia/Seoul",
        profile: {
          habit_name: buildSmartSentence(data) || data.habitAction,
          mini_task: data.miniTask,
          plus_task: data.plusTask,
          elite_task: data.eliteTask,
          monthly_vision: "",
        },
        recent_checkins: checkIns.slice(-10).map((checkIn) => ({
          checkin_date: checkIn.checkin_date,
          result: checkIn.result,
          memo: checkIn.memo,
        })),
        scorecard: createScorecardSummary(checkIns),
      }),
    });

    if (!response.ok) throw new Error("Failed");
    const body = (await response.json()) as { reply: string };
    return body.reply;
  } catch {
    if (event === "no_response_saved") {
      return `${todayKey()} 기록은 응답 없음으로 저장했어요. 하지 않음으로 임의 판정하지 않습니다.`;
    }
    if (event === "plan_saved") {
      return `${todayKey()} 기준으로 내일의 Mini/Plus/Elite 계획을 저장했어요.`;
    }
    return `${todayKey()} 체크인을 저장했어요. 최근 기록을 기준으로 다음 체크인을 이어갑니다.`;
  }
}

function createMonthRecords(checkIns: ElasticCheckIn[]): DailyRecord[] {
  const byDay = new Map(checkIns.map((checkIn) => [Number(checkIn.checkin_date.slice(-2)), checkIn.result]));
  return Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    return { day, status: byDay.get(day) ?? "open" };
  });
}

function countRecentMiniFailures(checkIns: ElasticCheckIn[]) {
  let count = 0;
  for (const checkIn of [...checkIns].sort((a, b) => b.checkin_date.localeCompare(a.checkin_date))) {
    if (checkIn.result === "not_done") count += 1;
    else break;
  }
  return count;
}

function getBonusItems(levelCounts: { mini: number; plus: number; elite: number; notDone: number; noResponse: number }) {
  const bonuses: { label: string; points: number }[] = [];
  if (levelCounts.elite >= 10) bonuses.push({ label: "Elite 10회 이상", points: 3 });
  if (levelCounts.elite >= 15) bonuses.push({ label: "Elite 15회 이상", points: 3 });
  if (levelCounts.notDone === 0 && levelCounts.noResponse === 0 && levelCounts.mini + levelCounts.plus + levelCounts.elite >= 30) {
    bonuses.push({ label: "30일 모두 기록", points: 20 });
  }
  return bonuses;
}

function GoalPanel({ data, goalData, step }: { data: OnboardingData; goalData: GoalData; step: OnboardingStep }) {
  const goalFields: { label: string; value: string; active: boolean }[] = [
    { label: "삶의 영역", value: goalData.lifeArea, active: step === "goal_area" },
    { label: "바꾸고 싶은 이유", value: goalData.whyChange, active: step === "goal_why" },
    { label: "정체성 문장", value: goalData.identityStatement, active: step === "goal_identity" },
  ];

  const habitFields: { label: string; value: string; active: boolean; placeholder: string }[] = [
    { label: "어떤 행동", value: data.habitAction, active: step === "habit_action", placeholder: "예: 토익 LC 공부" },
    { label: "기간", value: data.habitPeriod, active: step === "habit_period", placeholder: "예: 4주" },
    { label: "빈도", value: data.habitFrequency, active: step === "habit_frequency", placeholder: "예: 주 5회" },
    { label: "언제", value: data.habitWhen, active: step === "habit_when", placeholder: "예: 저녁 식사 후" },
    { label: "얼마나", value: data.habitAmount, active: step === "habit_amount", placeholder: "예: 10분" },
  ];

  const smartSentence = buildSmartSentence(data);
  const isHabitComplete = step === "goal_complete";

  return (
    <section className="goal-panel" aria-label="목표 설정">
      <div className="goal-panel-header">
        <p className="eyebrow">목표 설정</p>
        <h1>내 목표를 행동으로 바꾸기</h1>
        <p className="goal-panel-desc">원하는 변화가 매일의 작은 행동으로 이어지도록 정리해요.</p>
      </div>

      <div className="goal-template">
        <p className="goal-section-label">목표 &amp; 정체성</p>
        {goalFields.map((field) => (
          <div key={field.label} className={`goal-field${field.active ? " goal-field-active" : ""}${field.label === "정체성 문장" ? " goal-field-identity" : ""}`}>
            <span className="goal-field-label">{field.label}</span>
            <p className="goal-field-value">{field.value || "대화로 채워집니다"}</p>
          </div>
        ))}
      </div>

      <div className="goal-template goal-habit-template">
        <p className="goal-section-label">습관 목표</p>
        <div className="habit-fields-grid">
          {habitFields.map((field) => (
            <div key={field.label} className={`goal-field habit-field${field.active ? " goal-field-active" : ""}`}>
              <span className="goal-field-label">{field.label}</span>
              <p className="goal-field-value">{field.value || <span className="goal-placeholder">{field.placeholder}</span>}</p>
            </div>
          ))}
        </div>
        {(smartSentence || isHabitComplete) && (
          <div className="smart-sentence">
            <span className="goal-field-label">습관 목표 문장</span>
            <p>{smartSentence || "대화로 완성됩니다"}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function createScorecardSummary(checkIns: ElasticCheckIn[]) {
  const mini = checkIns.filter((checkIn) => checkIn.result === "mini").length;
  const plus = checkIns.filter((checkIn) => checkIn.result === "plus").length;
  const elite = checkIns.filter((checkIn) => checkIn.result === "elite").length;
  const notDone = checkIns.filter((checkIn) => checkIn.result === "not_done").length;
  const noResponse = checkIns.filter((checkIn) => checkIn.result === "no_response").length;
  const baseScore = mini + plus * 2 + elite * 3;
  const bonusScore = getBonusItems({ mini, plus, elite, notDone, noResponse }).reduce((sum, item) => sum + item.points, 0);
  return {
    mini,
    plus,
    elite,
    base_score: baseScore,
    bonus_score: bonusScore,
    total_score: baseScore + bonusScore,
  };
}
