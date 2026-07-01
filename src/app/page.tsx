"use client";

import { FormEvent, KeyboardEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowUp,
  CalendarCheck,
  Check,
  ChevronDown,
  Circle,
  MessageCircle,
  Minus,
  PencilLine,
  WandSparkles,
} from "lucide-react";
import { AuthPanel } from "@/components/AuthPanel";
import { LoadingState } from "@/components/LoadingState";
import { todayKey } from "@/lib/date";
import {
  cacheElasticSessionDraft,
  clearElasticSessionDraft,
  getElasticCheckIns,
  getElasticProfile,
  getElasticSessionDraft,
  LIVE_ELASTIC_SCOPE,
  saveElasticCheckIn,
  saveElasticProfile,
  saveElasticSessionDraft,
} from "@/lib/elastic-store";
import type { ElasticCheckIn, ElasticCheckInStatus, ElasticProfile } from "@/lib/elastic-types";
import { useProofSession } from "@/lib/use-proof-session";

type CheckInStatus = ElasticCheckInStatus | "open";
type DailyChoice = "plus" | "mini" | "not_done";
type AppMode = "onboarding" | "result" | "optional" | "daily";
type OnboardingStep = "goal" | "habit" | "blocker";
type OptionalMode = "menu" | "smart" | "elastic";
type SmartStep = "period" | "frequency" | "when" | "amount" | "done";
type ElasticStep = "mini" | "plus" | "elite" | "done";
type MobileWorkspaceTab = "chat" | "context";

type Message = {
  role: "assistant" | "user";
  text: string;
  emphasizeFirstLine?: boolean;
  variant?: "default" | "question" | "system";
};

type ProofData = {
  goalText: string;
  habitAction: string;
  blockerText: string;
  habitPeriod: string;
  habitFrequency: string;
  habitWhen: string;
  habitAmount: string;
  miniTask: string;
  plusTask: string;
  eliteTask: string;
};

type DailyRecord = {
  day: number;
  dateKey: string;
  status: CheckInStatus;
};

type HomeSessionDraft = {
  version: 2;
  userId: string;
  scope: string;
  activeCheckInDate: string;
  mode: AppMode;
  onboardingStep: OnboardingStep;
  optionalMode: OptionalMode;
  smartStep: SmartStep;
  elasticStep: ElasticStep;
  data: ProofData;
  messages: Message[];
  input: string;
  selectedCheckIn: DailyChoice | null;
  dailyNote: string;
  dailyStage: "checkin" | "done";
  updatedAt: string;
};

const emptyProofData: ProofData = {
  goalText: "",
  habitAction: "",
  blockerText: "",
  habitPeriod: "",
  habitFrequency: "",
  habitWhen: "",
  habitAmount: "",
  miniTask: "",
  plusTask: "",
  eliteTask: "",
};

const onboardingQuestions: Record<OnboardingStep, string> = {
  goal: "이루고 싶은 목표가 무엇인가요?",
  habit: "그 목표를 이루기 위해 반복해야 할 행동, 만들고 싶은 습관은 무엇인가요?",
  blocker: "이 목표를 이루고 습관을 만드는 데 가장 어려운 점은 무엇인가요?",
};

const onboardingPlaceholders: Record<OnboardingStep, string> = {
  goal: "예: 토익 850점 받기 / 영어 실력 늘리기 / 컴활 합격하기",
  habit: "예: 하루 1시간 토익 공부하기 / 주 4회 오픽 스크립트 연습하기",
  blocker: "예: 하루 빠지면 그 뒤로 며칠씩 놓는다",
};

const smartQuestions: Record<Exclude<SmartStep, "done">, string> = {
  period: "SMART 목표를 선택으로 더 구체화해볼게요. 이 목표는 어느 기간 동안 실험해볼까요?",
  frequency: "얼마나 자주 반복하면 좋을까요?",
  when: "언제 또는 어떤 상황에서 하면 가장 현실적일까요?",
  amount: "한 번에 얼마큼 하면 완료라고 볼 수 있을까요?",
};

const elasticQuestions: Record<Exclude<ElasticStep, "done">, string> = {
  mini: "Elastic Habit을 선택으로 설정해볼게요. 아주 힘든 날에도 남길 수 있는 최소 행동은 무엇일까요?",
  plus: "보통 날의 기본 실행 기준은 무엇으로 둘까요?",
  elite: "여유 있는 날의 확장 행동은 무엇으로 둘까요?",
};

const DAILY_CHECKIN_PROMPT =
  "오늘 목표 행동을 했나요?\n\n이 기록은 공부를 평가하려는 게 아니라, 목표와의 연결을 유지하기 위한 기록이에요.";

const statusMeta: Record<CheckInStatus, { label: string; icon: typeof Check; calendarLabel: string }> = {
  plus: { label: "했다", icon: Check, calendarLabel: "했다" },
  mini: { label: "조금 했다", icon: Minus, calendarLabel: "조금" },
  elite: { label: "했다", icon: Check, calendarLabel: "했다+" },
  not_done: { label: "못 했다", icon: Circle, calendarLabel: "못함" },
  no_response: { label: "응답 없음", icon: Minus, calendarLabel: "응답 없음" },
  open: { label: "열림", icon: PencilLine, calendarLabel: "열림" },
};

const completionMessages: Record<DailyChoice, string> = {
  plus: "오늘의 실행이 기록됐어요.\n\n이 조건이 당신에게 잘 맞는지 확인할 수 있습니다.",
  mini: "완벽하지 않아도 연결은 유지됐어요.\n\n오늘의 작은 실행도 다음 루틴의 근거가 됩니다.",
  not_done: "오늘 목표 행동을 못 했어도, 목표와의 연결은 끊기지 않았어요.\n\n오늘의 패턴이 내일 다시 시작할 데이터로 남았습니다.",
};

const KOREAN_WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
const SESSION_DRAFT_KEY_VERSION = 2;

function getDefaultMiniTask(habitAction: string) {
  return habitAction ? `${habitAction} 1분만 시작하기` : "목표 행동 1분만 시작하기";
}

function getDefaultPlusTask(habitAction: string) {
  return habitAction || "목표 행동 하기";
}

function getDefaultEliteTask(habitAction: string) {
  return habitAction ? `${habitAction} 후 한 줄 기록하기` : "목표 행동 후 한 줄 기록하기";
}

export default function Home() {
  return (
    <Suspense fallback={<LoadingState />}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const { loading, userId } = useProofSession();
  const [mode, setMode] = useState<AppMode>("onboarding");
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("goal");
  const [optionalMode, setOptionalMode] = useState<OptionalMode>("menu");
  const [smartStep, setSmartStep] = useState<SmartStep>("period");
  const [elasticStep, setElasticStep] = useState<ElasticStep>("mini");
  const [data, setData] = useState<ProofData>(emptyProofData);
  const [records, setRecords] = useState<DailyRecord[]>(createMonthRecords([], todayKey()));
  const [checkIns, setCheckIns] = useState<ElasticCheckIn[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [selectedCheckIn, setSelectedCheckIn] = useState<DailyChoice | null>(null);
  const [dailyNote, setDailyNote] = useState("");
  const [dailyStage, setDailyStage] = useState<"checkin" | "done">("checkin");
  const [pending, setPending] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<MobileWorkspaceTab>("chat");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const storageScope = searchParams.get("scope") || LIVE_ELASTIC_SCOPE;
  const activeCheckInDate = todayKey();
  const mobileView = searchParams.get("view");

  useEffect(() => {
    setActiveMobileTab(mobileView === "goal" ? "context" : "chat");
  }, [mobileView]);

  useEffect(() => {
    let cancelled = false;
    setDraftHydrated(false);

    async function load() {
      if (!userId) {
        setDraftHydrated(true);
        return;
      }

      const [profile, loadedCheckIns, rawDraft] = await Promise.all([
        getElasticProfile(userId, storageScope),
        getElasticCheckIns(userId, storageScope),
        getElasticSessionDraft<HomeSessionDraft>(userId, storageScope),
      ]);
      if (cancelled) return;

      setCheckIns(loadedCheckIns);
      setRecords(createMonthRecords(loadedCheckIns, activeCheckInDate));

      const draft = normalizeHomeSessionDraft(rawDraft, userId, storageScope);
      if (profile?.onboarding_completed_at) {
        const nextData = mapProfileToProofData(profile);
        setData(nextData);
        loadDailyState(nextData, loadedCheckIns);
      } else if (draft) {
        hydrateFromDraft(draft, loadedCheckIns);
      } else {
        resetOnboardingState();
        showOnboardingOpening();
      }

      setDraftHydrated(true);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [activeCheckInDate, storageScope, userId]);

  useEffect(() => {
    const chatLog = chatLogRef.current;
    if (!chatLog) return;

    requestAnimationFrame(() => {
      chatLog.scrollTo({ top: chatLog.scrollHeight, behavior: "smooth" });
    });
  }, [messages]);

  useEffect(() => {
    if (!userId || !draftHydrated || mode === "daily") return;

    const draft: HomeSessionDraft = {
      version: SESSION_DRAFT_KEY_VERSION,
      userId,
      scope: storageScope,
      activeCheckInDate,
      mode,
      onboardingStep,
      optionalMode,
      smartStep,
      elasticStep,
      data,
      messages: messages.map(sanitizeMessageForStorage),
      input,
      selectedCheckIn,
      dailyNote,
      dailyStage,
      updatedAt: new Date().toISOString(),
    };

    cacheElasticSessionDraft(userId, storageScope, draft);
    const timeout = window.setTimeout(() => {
      void saveElasticSessionDraft(userId, storageScope, draft);
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [
    activeCheckInDate,
    dailyNote,
    dailyStage,
    data,
    draftHydrated,
    elasticStep,
    input,
    messages,
    mode,
    onboardingStep,
    optionalMode,
    selectedCheckIn,
    smartStep,
    storageScope,
    userId,
  ]);

  const levelCounts = useMemo(
    () => ({
      mini: records.filter((record) => record.status === "mini").length,
      plus: records.filter((record) => record.status === "plus" || record.status === "elite").length,
      notDone: records.filter((record) => record.status === "not_done").length,
    }),
    [records],
  );
  const calendarMeta = getCalendarMeta(activeCheckInDate);
  const calendarCells = createCalendarCells(records, calendarMeta.firstWeekday);
  const mobileContextTitle = mode === "daily" ? "Habit Tracker" : mode === "optional" ? "선택 설정" : "첫 구조";
  const mobileContextSubtitle = data.goalText || onboardingQuestions[onboardingStep];
  const chatSubtitle = mode === "daily"
    ? `${formatDateLabel(activeCheckInDate)} · ${statusMeta[selectedCheckIn || "open"].label}`
    : mode === "optional"
      ? optionalMode === "smart"
        ? "SMART 목표"
        : optionalMode === "elastic"
          ? "Elastic Habit"
          : "선택 설정"
      : mode === "result"
        ? "목표 구조 확인"
        : onboardingQuestions[onboardingStep];

  function hydrateFromDraft(draft: HomeSessionDraft, loadedCheckIns: ElasticCheckIn[]) {
    setMode(draft.mode);
    setOnboardingStep(draft.onboardingStep);
    setOptionalMode(draft.optionalMode);
    setSmartStep(draft.smartStep);
    setElasticStep(draft.elasticStep);
    setData(draft.data);
    setMessages(draft.messages);
    setInput(draft.input);
    setSelectedCheckIn(draft.selectedCheckIn);
    setDailyNote(draft.dailyNote);
    setDailyStage(draft.dailyStage);
    setRecords(createMonthRecords(loadedCheckIns, activeCheckInDate));
    setCheckIns(loadedCheckIns);
    setPending(false);
    setSaveMessage(null);
  }

  function loadDailyState(nextData: ProofData, loadedCheckIns: ElasticCheckIn[]) {
    setMode("daily");
    setOptionalMode("menu");
    setInput("");
    const today = loadedCheckIns.find((checkIn) => checkIn.checkin_date === activeCheckInDate);
    if (today && (today.result === "plus" || today.result === "mini" || today.result === "not_done")) {
      const parsed = parseCheckInMemo(today.memo);
      setSelectedCheckIn(today.result);
      setDailyNote(parsed.note);
      setDailyStage("done");
      setMessages([
        ...buildDailyConversationMessages(loadedCheckIns, activeCheckInDate),
        {
          role: "assistant",
          text: `${formatDateLabel(activeCheckInDate)} 기록은 이미 "${statusMeta[today.result].label}"로 저장되어 있어요.\n필요하면 아래에서 오늘 기록을 수정할 수 있습니다.`,
        },
      ]);
      return;
    }

    setSelectedCheckIn(null);
    setDailyNote("");
    setDailyStage("checkin");
    setMessages([
      ...buildDailyConversationMessages(loadedCheckIns, activeCheckInDate),
      {
        role: "assistant",
        text: `${formatDateLabel(activeCheckInDate)} 기록을 시작할게요.\n${DAILY_CHECKIN_PROMPT}`,
        emphasizeFirstLine: true,
        variant: "question",
      },
    ]);
    setData(nextData);
  }

  function resetOnboardingState() {
    setMode("onboarding");
    setOnboardingStep("goal");
    setOptionalMode("menu");
    setSmartStep("period");
    setElasticStep("mini");
    setData(emptyProofData);
    setInput("");
    setSelectedCheckIn(null);
    setDailyNote("");
    setDailyStage("checkin");
    setSaveMessage(null);
  }

  function showOnboardingOpening() {
    setMessages([
      {
        role: "assistant",
        text: "Proof는 원하는 변화를 매일의 작은 행동으로 이어주는 서비스예요.\n먼저 딱 세 가지만 정리하고, 바로 매일 기록을 시작할게요.",
        emphasizeFirstLine: true,
      },
      { role: "assistant", text: onboardingQuestions.goal, emphasizeFirstLine: true, variant: "question" },
    ]);
  }

  function appendAssistant(text: string, options: Partial<Message> = {}) {
    setMessages((current) => [...current, { role: "assistant", text, ...options }]);
  }

  async function handleOnboardingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || pending) return;

    const userTurn: Message = { role: "user", text };
    const nextMessages = [...messages, userTurn];
    const nextData = applyOnboardingAnswer(data, onboardingStep, text);
    setMessages(nextMessages);
    setData(nextData);
    setInput("");

    if (onboardingStep !== "blocker") {
      const nextStep = nextOnboardingStep(onboardingStep);
      setOnboardingStep(nextStep);
      setMessages([
        ...nextMessages,
        { role: "assistant", text: onboardingQuestions[nextStep], emphasizeFirstLine: true, variant: "question" },
      ]);
      return;
    }

    setPending(true);
    try {
      const refined = await refineOnboardingStructure(nextData);
      const completedData = withDefaultElasticTasks(refined);
      setData(completedData);
      await persistProfile(completedData);
      if (userId) await clearElasticSessionDraft(userId, storageScope);
      setMode("result");
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          text: "목표를 위한 첫 구조가 만들어졌어요.\n이제 목표, 반복 행동, 핵심 병목을 보고 바로 매일 기록을 시작할 수 있습니다.",
          emphasizeFirstLine: true,
          variant: "system",
        },
      ]);
    } catch (caught) {
      setSaveMessage(caught instanceof Error ? caught.message : "첫 구조를 만들지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  async function startDailyTracker() {
    const completedData = withDefaultElasticTasks(data);
    setData(completedData);
    await persistProfile(completedData);
    if (userId) await clearElasticSessionDraft(userId, storageScope);
    setMode("daily");
    setOptionalMode("menu");
    setSelectedCheckIn(null);
    setDailyNote("");
    setDailyStage("checkin");
    setInput("");
    setMessages([
      {
        role: "assistant",
        text: `${formatDateLabel(activeCheckInDate)} 기록을 시작할게요.\n${DAILY_CHECKIN_PROMPT}`,
        emphasizeFirstLine: true,
        variant: "question",
      },
    ]);
  }

  function openOptionalSettings() {
    setMode("optional");
    setOptionalMode("menu");
    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        text: "선택 설정으로 넘어왔어요.\nSMART 목표와 Elastic Habit은 각각 따로 설정할 수 있고, 둘 다 하지 않아도 바로 기록을 시작할 수 있어요.",
        emphasizeFirstLine: true,
      },
    ]);
  }

  function startSmartChat() {
    setOptionalMode("smart");
    setSmartStep("period");
    setInput("");
    appendAssistant(smartQuestions.period, { emphasizeFirstLine: true, variant: "question" });
  }

  function startElasticChat() {
    setOptionalMode("elastic");
    setElasticStep("mini");
    setInput("");
    appendAssistant(elasticQuestions.mini, { emphasizeFirstLine: true, variant: "question" });
  }

  function returnToOptionalMenu() {
    setOptionalMode("menu");
    setInput("");
    appendAssistant("선택 설정으로 돌아왔어요. 더 설정할 항목을 고르거나 바로 기록을 시작할 수 있어요.");
  }

  async function handleOptionalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || pending) return;

    const userTurn: Message = { role: "user", text };
    setMessages((current) => [...current, userTurn]);
    setInput("");

    if (optionalMode === "smart") {
      const nextData = applySmartAnswer(data, smartStep, text);
      setData(nextData);
      const nextStep = nextSmartStep(smartStep);
      if (nextStep === "done") {
        setSmartStep("done");
        setOptionalMode("menu");
        await persistProfile(withDefaultElasticTasks(nextData));
        appendAssistant(`SMART 목표가 저장됐어요.\n${buildSmartSentence(nextData)}\n\n다른 선택 설정을 하거나 바로 기록을 시작할 수 있어요.`, {
          emphasizeFirstLine: true,
          variant: "system",
        });
      } else {
        setSmartStep(nextStep);
        appendAssistant(smartQuestions[nextStep], { emphasizeFirstLine: true, variant: "question" });
      }
      return;
    }

    if (optionalMode === "elastic") {
      const nextData = applyElasticAnswer(data, elasticStep, text);
      setData(nextData);
      const nextStep = nextElasticStep(elasticStep);
      if (nextStep === "done") {
        setElasticStep("done");
        setOptionalMode("menu");
        await persistProfile(nextData);
        appendAssistant(`Elastic Habit이 저장됐어요.\n${formatElasticSummary(nextData)}\n\n다른 선택 설정을 하거나 바로 기록을 시작할 수 있어요.`, {
          emphasizeFirstLine: true,
          variant: "system",
        });
      } else {
        setElasticStep(nextStep);
        appendAssistant(elasticQuestions[nextStep], { emphasizeFirstLine: true, variant: "question" });
      }
    }
  }

  function selectDailyChoice(choice: DailyChoice) {
    setSelectedCheckIn(choice);
    setSaveMessage(null);
  }

  async function saveDailyCheckIn() {
    if (!userId || !selectedCheckIn || pending) return;

    const note = dailyNote.trim();
    const reply = completionMessages[selectedCheckIn];
    const userText = note ? `${statusMeta[selectedCheckIn].label}\n${note}` : statusMeta[selectedCheckIn].label;
    const nextMessages: Message[] = [
      ...messages,
      { role: "user", text: userText },
      { role: "assistant", text: reply, emphasizeFirstLine: true, variant: "system" },
    ];

    setPending(true);
    setSaveMessage(null);
    try {
      const saved = await saveElasticCheckIn({
        user_id: userId,
        scope: storageScope,
        checkin_date: activeCheckInDate,
        result: selectedCheckIn,
        memo: createCheckInMemo(selectedCheckIn, note, reply),
        self_narrative_detected: hasSelfNarrative(note),
      });
      const nextCheckIns = upsertCheckIn(checkIns, saved);
      setCheckIns(nextCheckIns);
      setRecords(createMonthRecords(nextCheckIns, activeCheckInDate));
      setMessages(nextMessages);
      setDailyStage("done");
    } catch (caught) {
      setSaveMessage(caught instanceof Error ? caught.message : "기록을 저장하지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  function editTodayCheckIn() {
    setSelectedCheckIn(null);
    setDailyNote("");
    setDailyStage("checkin");
    setMessages((current) => [
      ...current,
      { role: "user", text: "오늘 기록 수정할게요" },
      { role: "assistant", text: DAILY_CHECKIN_PROMPT, emphasizeFirstLine: true, variant: "question" },
    ]);
  }

  async function persistProfile(nextData: ProofData) {
    if (!userId) return;
    const completedData = withDefaultElasticTasks(nextData);
    await saveElasticProfile({
      user_id: userId,
      scope: storageScope,
      life_area: completedData.goalText || null,
      why_change: null,
      identity_statement: null,
      habit_name: completedData.goalText,
      habit_action: completedData.habitAction || null,
      habit_period: completedData.habitPeriod || null,
      habit_frequency: completedData.habitFrequency || null,
      habit_when: completedData.habitWhen || null,
      habit_amount: completedData.habitAmount || null,
      identity_motive: "",
      motive_summary: null,
      recent_failure_date: completedData.blockerText || null,
      pre_breakdown_feeling: null,
      actual_breakdown_behavior: null,
      recovery_method: null,
      mini_task: completedData.miniTask,
      plus_task: completedData.plusTask,
      elite_task: completedData.eliteTask,
      monthly_vision: null,
      last_onboarding_step: "complete",
      onboarding_completed_at: new Date().toISOString(),
    });
  }

  if (loading || !draftHydrated) return <LoadingState />;

  const contextPanel = mode === "daily" ? (
    <TrackerPanel
      calendarCells={calendarCells}
      calendarMeta={calendarMeta}
      checkIns={checkIns}
      data={data}
      dailyStage={dailyStage}
      levelCounts={levelCounts}
      mobileOpen={mobileContextOpen}
      mobileSubtitle={mobileContextSubtitle}
      mobileTitle={mobileContextTitle}
      onToggleMobileOpen={() => setMobileContextOpen((current) => !current)}
      selectedCheckIn={selectedCheckIn}
      storageScope={storageScope}
    />
  ) : mode === "result" ? (
    <OnboardingResultPanel
      data={data}
      mobileOpen={mobileContextOpen}
      mobileSubtitle={mobileContextSubtitle}
      mobileTitle={mobileContextTitle}
      onOpenOptional={openOptionalSettings}
      onStartDaily={startDailyTracker}
      onToggleMobileOpen={() => setMobileContextOpen((current) => !current)}
      pending={pending}
    />
  ) : mode === "optional" ? (
    <OptionalSetupPanel
      data={data}
      mobileOpen={mobileContextOpen}
      mobileSubtitle={mobileContextSubtitle}
      mobileTitle={mobileContextTitle}
      onStartDaily={startDailyTracker}
      onStartElastic={startElasticChat}
      onStartSmart={startSmartChat}
      onToggleMobileOpen={() => setMobileContextOpen((current) => !current)}
      optionalMode={optionalMode}
      pending={pending}
    />
  ) : (
    <OnboardingProgressPanel
      data={data}
      mobileOpen={mobileContextOpen}
      mobileSubtitle={mobileContextSubtitle}
      mobileTitle={mobileContextTitle}
      onToggleMobileOpen={() => setMobileContextOpen((current) => !current)}
      step={onboardingStep}
    />
  );

  return (
    <main className={`tracker-workspace mobile-tab-${activeMobileTab}`}>
      {contextPanel}

      <aside className="chat-panel" aria-label="Proof onboarding and check-in">
        <div className="chat-title">
          <MessageCircle size={18} aria-hidden="true" />
          <div>
            <strong>{mode === "daily" ? "Daily Check-in" : mode === "optional" ? "선택 설정" : "첫 목표 만들기"}</strong>
            <span>{chatSubtitle}</span>
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
                <div
                  className={`chat-bubble ${message.role}${message.variant ? ` ${message.variant}` : ""}`}
                  key={`${message.role}-${index}`}
                >
                  {renderMessageText(message)}
                </div>
              ))}
            </div>

            {saveMessage ? <p className="form-message">{saveMessage}</p> : null}

            {mode === "onboarding" ? (
              <TextComposer
                ariaLabel="온보딩 답변"
                disabled={pending}
                input={input}
                onSubmit={handleOnboardingSubmit}
                pending={pending}
                placeholder={pending ? "Proof가 정리하는 중..." : onboardingPlaceholders[onboardingStep]}
                setInput={setInput}
              />
            ) : null}

            {mode === "optional" && optionalMode !== "menu" ? (
              <OptionalComposer
                disabled={pending}
                input={input}
                onBack={returnToOptionalMenu}
                onSubmit={handleOptionalSubmit}
                pending={pending}
                placeholder={optionalMode === "smart" ? "답변을 입력하세요" : "기준을 입력하세요"}
                setInput={setInput}
              />
            ) : null}

            {mode === "daily" ? (
              <DailyCheckIn
                dailyNote={dailyNote}
                dailyStage={dailyStage}
                onEditToday={editTodayCheckIn}
                onSave={saveDailyCheckIn}
                onSelect={selectDailyChoice}
                pending={pending}
                selectedCheckIn={selectedCheckIn}
                setDailyNote={setDailyNote}
              />
            ) : null}
          </>
        )}
      </aside>
    </main>
  );
}

function OnboardingProgressPanel({
  data,
  mobileOpen,
  mobileSubtitle,
  mobileTitle,
  onToggleMobileOpen,
  step,
}: {
  data: ProofData;
  mobileOpen: boolean;
  mobileSubtitle: string;
  mobileTitle: string;
  onToggleMobileOpen: () => void;
  step: OnboardingStep;
}) {
  const fields = [
    { id: "goal" as const, label: "나의 목표", value: data.goalText, placeholder: "무엇을 이루고 싶은지" },
    { id: "habit" as const, label: "나의 반복 행동", value: data.habitAction, placeholder: "매일 또는 매주 반복할 행동" },
    { id: "blocker" as const, label: "나의 핵심 병목", value: data.blockerText, placeholder: "가장 자주 막히는 지점" },
  ];

  return (
    <section className={`goal-panel mobile-context-panel${mobileOpen ? " mobile-open" : ""}`} aria-label="온보딩 진행">
      <MobileContextToggle
        open={mobileOpen}
        subtitle={mobileSubtitle}
        title={mobileTitle}
        onToggle={onToggleMobileOpen}
      />
      <div className="mobile-context-body">
        <div className="goal-panel-header">
          <p className="eyebrow">Proof Setup</p>
          <h1>세 가지만 정리하고 바로 기록하기</h1>
          <p className="goal-panel-desc">목표, 반복 행동, 막히는 지점만 먼저 잡으면 오늘부터 기록을 시작할 수 있어요.</p>
        </div>

        <div className="goal-template structure-cards">
          {fields.map((field) => (
            <div key={field.id} className={`goal-field${step === field.id ? " goal-field-active" : ""}`}>
              <span className="goal-field-label">{field.label}</span>
              <p className="goal-field-value">{field.value || <span className="goal-placeholder">{field.placeholder}</span>}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OnboardingResultPanel({
  data,
  mobileOpen,
  mobileSubtitle,
  mobileTitle,
  onOpenOptional,
  onStartDaily,
  onToggleMobileOpen,
  pending,
}: {
  data: ProofData;
  mobileOpen: boolean;
  mobileSubtitle: string;
  mobileTitle: string;
  onOpenOptional: () => void;
  onStartDaily: () => void;
  onToggleMobileOpen: () => void;
  pending: boolean;
}) {
  return (
    <section className={`goal-panel mobile-context-panel${mobileOpen ? " mobile-open" : ""}`} aria-label="온보딩 결과">
      <MobileContextToggle
        open={mobileOpen}
        subtitle={mobileSubtitle}
        title={mobileTitle}
        onToggle={onToggleMobileOpen}
      />
      <div className="mobile-context-body">
        <div className="goal-panel-header result-header">
          <p className="eyebrow">첫 구조 완성</p>
          <h1>목표를 위한 첫 구조가 만들어졌어요.</h1>
          <p className="goal-panel-desc">
            지금 만든 목표, 반복 행동, 핵심 병목은 언제든 수정할 수 있어요.
            앞으로 기록이 쌓일수록 당신의 패턴과 성공조건은 더 정확해집니다.
          </p>
        </div>

        <StructureSummaryCards data={data} />

        <div className="result-actions">
          <button className="primary-button" disabled={pending} onClick={onStartDaily} type="button">
            <CalendarCheck size={17} aria-hidden="true" />
            매일 기록 시작하기
          </button>
          <button className="secondary-action no-margin" disabled={pending} onClick={onOpenOptional} type="button">
            <WandSparkles size={17} aria-hidden="true" />
            더 정확하게 설정하기
          </button>
        </div>
      </div>
    </section>
  );
}

function OptionalSetupPanel({
  data,
  mobileOpen,
  mobileSubtitle,
  mobileTitle,
  onStartDaily,
  onStartElastic,
  onStartSmart,
  onToggleMobileOpen,
  optionalMode,
  pending,
}: {
  data: ProofData;
  mobileOpen: boolean;
  mobileSubtitle: string;
  mobileTitle: string;
  onStartDaily: () => void;
  onStartElastic: () => void;
  onStartSmart: () => void;
  onToggleMobileOpen: () => void;
  optionalMode: OptionalMode;
  pending: boolean;
}) {
  const smartSentence = buildSmartSentence(data);
  const elasticSummary = formatElasticSummary(data);

  return (
    <section className={`goal-panel mobile-context-panel${mobileOpen ? " mobile-open" : ""}`} aria-label="선택 설정">
      <MobileContextToggle
        open={mobileOpen}
        subtitle={mobileSubtitle}
        title={mobileTitle}
        onToggle={onToggleMobileOpen}
      />
      <div className="mobile-context-body">
        <div className="goal-panel-header">
          <p className="eyebrow">Optional Setup</p>
          <h1>더 정확하게 설정하기</h1>
          <p className="goal-panel-desc">필수는 아니에요. 필요한 항목만 채팅으로 더 구체화하고, 언제든 바로 기록을 시작할 수 있습니다.</p>
        </div>

        <StructureSummaryCards data={data} compact />

        <div className="optional-settings-grid">
          <section className={`optional-setting-card${optionalMode === "smart" ? " active" : ""}`}>
            <div>
              <span className="goal-field-label">SMART 목표</span>
              <h2>기간, 빈도, 시점, 양 정하기</h2>
              <p>{smartSentence || "아직 선택 설정을 하지 않았어요."}</p>
            </div>
            <button className="secondary-action no-margin" disabled={pending} onClick={onStartSmart} type="button">
              {smartSentence ? "SMART 다시 설정" : "SMART 설정하기"}
            </button>
          </section>

          <section className={`optional-setting-card${optionalMode === "elastic" ? " active" : ""}`}>
            <div>
              <span className="goal-field-label">Elastic Habit</span>
              <h2>Mini / Plus / Elite 정하기</h2>
              <p>{elasticSummary || "아직 선택 설정을 하지 않았어요."}</p>
            </div>
            <button className="secondary-action no-margin" disabled={pending} onClick={onStartElastic} type="button">
              {elasticSummary ? "Elastic 다시 설정" : "Elastic 설정하기"}
            </button>
          </section>
        </div>

        <button className="primary-button wide-button" disabled={pending} onClick={onStartDaily} type="button">
          매일 기록 시작하기
        </button>
      </div>
    </section>
  );
}

function StructureSummaryCards({ compact = false, data }: { compact?: boolean; data: ProofData }) {
  return (
    <div className={`structure-summary-grid${compact ? " compact" : ""}`}>
      <section className="structure-card">
        <span>나의 목표</span>
        <p>{data.goalText || "아직 정리되지 않았어요."}</p>
      </section>
      <section className="structure-card">
        <span>나의 반복 행동</span>
        <p>{data.habitAction || "아직 정리되지 않았어요."}</p>
      </section>
      <section className="structure-card">
        <span>나의 핵심 병목</span>
        <p>{data.blockerText || "아직 정리되지 않았어요."}</p>
      </section>
    </div>
  );
}

function TrackerPanel({
  calendarCells,
  calendarMeta,
  checkIns,
  data,
  dailyStage,
  levelCounts,
  mobileOpen,
  mobileSubtitle,
  mobileTitle,
  onToggleMobileOpen,
  selectedCheckIn,
  storageScope,
}: {
  calendarCells: (DailyRecord | null)[];
  calendarMeta: ReturnType<typeof getCalendarMeta>;
  checkIns: ElasticCheckIn[];
  data: ProofData;
  dailyStage: "checkin" | "done";
  levelCounts: { mini: number; plus: number; notDone: number };
  mobileOpen: boolean;
  mobileSubtitle: string;
  mobileTitle: string;
  onToggleMobileOpen: () => void;
  selectedCheckIn: DailyChoice | null;
  storageScope: string;
}) {
  return (
    <section className={`tracker-panel mobile-context-panel${mobileOpen ? " mobile-open" : ""}`} aria-label="Habit tracker">
      <MobileContextToggle
        open={mobileOpen}
        subtitle={mobileSubtitle}
        title={mobileTitle}
        onToggle={onToggleMobileOpen}
      />
      <div className="mobile-context-body">
        <div className="tracker-header">
          <div>
            <p className="eyebrow">Habit Tracker</p>
            <h1>{data.habitAction || "매일 기록"}</h1>
            <p className="tracker-subtitle">성공/실패 판정보다 목표와의 연결을 매일 남기는 화면입니다.</p>
          </div>
          <div className="tracker-score connection-score">
            <strong>{levelCounts.plus + levelCounts.mini + levelCounts.notDone}</strong>
            <span>이번 달 기록</span>
          </div>
        </div>

        <StructureSummaryCards data={data} compact />

        <section className="daily-overview daily-overview-simple" aria-label="오늘 체크인과 기록 요약">
          <section className="today-strip">
            <div>
              <div className="band-title">
                <CalendarCheck size={18} aria-hidden="true" />
                <span>오늘 체크인</span>
              </div>
              <p>{dailyStage === "done" && selectedCheckIn ? completionMessages[selectedCheckIn].split("\n")[0] : "오늘 목표 행동을 했나요?"}</p>
            </div>
            <span className={`tracker-status ${selectedCheckIn || "open"}`}>
              {statusMeta[selectedCheckIn || "open"].label}
            </span>
          </section>

          <div className="connection-counts" aria-label="이번 달 연결 기록">
            <section className="tracker-tile level-plus">
              <span>했다</span>
              <strong>{levelCounts.plus}회</strong>
            </section>
            <section className="tracker-tile level-mini">
              <span>조금 했다</span>
              <strong>{levelCounts.mini}회</strong>
            </section>
            <section className="tracker-tile level-not-done">
              <span>못 했다</span>
              <strong>{levelCounts.notDone}회</strong>
            </section>
          </div>
        </section>

        <section className="calendar-board" aria-label={`${calendarMeta.koreanMonth} 기록 달력`}>
          <div className="calendar-heading">
            <strong>{calendarMeta.englishMonth}</strong>
            <span>{calendarMeta.koreanMonth}</span>
          </div>
          <div className="calendar-weekdays" aria-hidden="true">
            {KOREAN_WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="month-grid">
            {calendarCells.map((record, index) => {
              if (!record) return <div className="day-cell is-empty" key={`empty-${index}`} aria-hidden="true" />;

              const Icon = statusMeta[record.status].icon;
              const checkIn = checkIns.find((item) => item.checkin_date === record.dateKey) ?? null;
              const isToday = record.dateKey === todayKey();
              const showStatus = record.status !== "open";
              const cell = (
                <>
                  <span>{record.day}</span>
                  {showStatus ? (
                    <div className="day-status">
                      <Icon size={17} aria-hidden="true" />
                      <small>{statusMeta[record.status].calendarLabel}</small>
                    </div>
                  ) : null}
                </>
              );

              return checkIn ? (
                <Link
                  aria-label={`${record.day}일 기록 ${statusMeta[record.status].label}`}
                  className={`day-cell ${record.status}${isToday ? " is-today" : ""}`}
                  href={`/record?date=${checkIn.checkin_date}&scope=${encodeURIComponent(storageScope)}`}
                  key={record.dateKey}
                >
                  {cell}
                </Link>
              ) : (
                <div className={`day-cell ${record.status}${isToday ? " is-today" : ""}`} key={record.dateKey}>
                  {cell}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}

function TextComposer({
  ariaLabel,
  disabled,
  input,
  onSubmit,
  pending,
  placeholder,
  setInput,
}: {
  ariaLabel: string;
  disabled: boolean;
  input: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  placeholder: string;
  setInput: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 130)}px`;
  }, [input, pending]);

  useEffect(() => {
    if (disabled) return;
    requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  }, [disabled]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form className="chat-composer" onSubmit={onSubmit}>
      <textarea
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={input}
      />
      <button aria-label="보내기" disabled={disabled || !input.trim()} type="submit">
        <ArrowUp size={18} aria-hidden="true" />
      </button>
    </form>
  );
}

function OptionalComposer({
  disabled,
  input,
  onBack,
  onSubmit,
  pending,
  placeholder,
  setInput,
}: {
  disabled: boolean;
  input: string;
  onBack: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  placeholder: string;
  setInput: (value: string) => void;
}) {
  return (
    <div className="elastic-composer">
      <TextComposer
        ariaLabel="선택 설정 답변"
        disabled={disabled}
        input={input}
        onSubmit={onSubmit}
        pending={pending}
        placeholder={pending ? "저장하는 중..." : placeholder}
        setInput={setInput}
      />
      <button className="secondary-action no-margin" disabled={pending} onClick={onBack} type="button">
        선택 설정으로 돌아가기
      </button>
    </div>
  );
}

function DailyCheckIn({
  dailyNote,
  dailyStage,
  onEditToday,
  onSave,
  onSelect,
  pending,
  selectedCheckIn,
  setDailyNote,
}: {
  dailyNote: string;
  dailyStage: "checkin" | "done";
  onEditToday: () => void;
  onSave: () => void;
  onSelect: (choice: DailyChoice) => void;
  pending: boolean;
  selectedCheckIn: DailyChoice | null;
  setDailyNote: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 130)}px`;
  }, [dailyNote]);

  if (dailyStage === "done") {
    return (
      <div className="daily-quick-replies tomorrow-replies" aria-label="오늘 기록 완료">
        <span className="daily-done-chip">오늘 기록 완료</span>
        <button disabled={pending} onClick={onEditToday} type="button">오늘 기록 수정</button>
      </div>
    );
  }

  return (
    <div className="daily-chat-checkin">
      <div className="checkin-buttons daily-quick-replies daily-outcome-buttons" aria-label="오늘 목표 행동 여부">
        <button className={selectedCheckIn === "plus" ? "selected plus" : "plus"} disabled={pending} onClick={() => onSelect("plus")} type="button">
          했다
        </button>
        <button className={selectedCheckIn === "mini" ? "selected mini" : "mini"} disabled={pending} onClick={() => onSelect("mini")} type="button">
          조금 했다
        </button>
        <button className={selectedCheckIn === "not_done" ? "selected not-done" : "not-done"} disabled={pending} onClick={() => onSelect("not_done")} type="button">
          못 했다
        </button>
      </div>

      <label className="daily-note-label">
        <span>오늘 왜 그렇게 됐나요?</span>
        <textarea
          disabled={pending}
          onChange={(event) => setDailyNote(event.target.value)}
          placeholder="예: 피곤해서 시작을 못 했어요 / 할 양이 많아 보여서 미뤘어요 / 조금이라도 해냈어요"
          ref={textareaRef}
          rows={3}
          value={dailyNote}
        />
      </label>

      <button className="primary-button wide-button" disabled={pending || !selectedCheckIn} onClick={onSave} type="button">
        {pending ? "기록하는 중" : "기록 완료"}
      </button>
    </div>
  );
}

function MobileContextToggle({
  onToggle,
  open,
  subtitle,
  title,
}: {
  onToggle: () => void;
  open: boolean;
  subtitle: string;
  title: string;
}) {
  return (
    <button
      aria-expanded={open}
      className="mobile-context-toggle"
      onClick={onToggle}
      type="button"
    >
      <span>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      <ChevronDown className="mobile-context-chevron" size={18} aria-hidden="true" />
    </button>
  );
}

function renderMessageText(message: Message) {
  if (!message.emphasizeFirstLine) return message.text;

  const [firstLine, ...restLines] = message.text.split("\n");
  const rest = restLines.join("\n");
  return (
    <>
      <strong className="chat-bubble-lead">{firstLine}</strong>
      {rest ? `\n${rest}` : null}
    </>
  );
}

function applyOnboardingAnswer(data: ProofData, step: OnboardingStep, value: string): ProofData {
  if (step === "goal") return { ...data, goalText: value };
  if (step === "habit") return { ...data, habitAction: value };
  return { ...data, blockerText: value };
}

function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  if (step === "goal") return "habit";
  if (step === "habit") return "blocker";
  return "blocker";
}

async function refineOnboardingStructure(data: ProofData): Promise<ProofData> {
  try {
    const response = await fetch("/api/elastic/summarize-onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal: data.goalText,
        habit: data.habitAction,
        blocker: data.blockerText,
      }),
    });
    if (!response.ok) throw new Error("Failed");
    const refined = (await response.json()) as { goal: string; habit: string; blocker: string };
    return {
      ...data,
      goalText: refined.goal?.trim() || data.goalText,
      habitAction: refined.habit?.trim() || data.habitAction,
      blockerText: refined.blocker?.trim() || data.blockerText,
    };
  } catch {
    return {
      ...data,
      goalText: normalizeSentence(data.goalText),
      habitAction: normalizeSentence(data.habitAction),
      blockerText: normalizeSentence(data.blockerText),
    };
  }
}

function normalizeSentence(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function withDefaultElasticTasks(data: ProofData): ProofData {
  return {
    ...data,
    miniTask: data.miniTask || getDefaultMiniTask(data.habitAction),
    plusTask: data.plusTask || getDefaultPlusTask(data.habitAction),
    eliteTask: data.eliteTask || getDefaultEliteTask(data.habitAction),
  };
}

function applySmartAnswer(data: ProofData, step: SmartStep, value: string): ProofData {
  if (step === "period") return { ...data, habitPeriod: value };
  if (step === "frequency") return { ...data, habitFrequency: value };
  if (step === "when") return { ...data, habitWhen: value };
  if (step === "amount") return { ...data, habitAmount: value };
  return data;
}

function nextSmartStep(step: SmartStep): SmartStep {
  if (step === "period") return "frequency";
  if (step === "frequency") return "when";
  if (step === "when") return "amount";
  return "done";
}

function applyElasticAnswer(data: ProofData, step: ElasticStep, value: string): ProofData {
  if (step === "mini") return { ...data, miniTask: value };
  if (step === "plus") return { ...data, plusTask: value };
  if (step === "elite") return { ...data, eliteTask: value };
  return data;
}

function nextElasticStep(step: ElasticStep): ElasticStep {
  if (step === "mini") return "plus";
  if (step === "plus") return "elite";
  return "done";
}

function buildSmartSentence(data: ProofData) {
  const parts: string[] = [];
  if (data.habitPeriod) parts.push(`${data.habitPeriod} 동안`);
  if (data.habitFrequency) parts.push(data.habitFrequency);
  if (data.habitWhen) parts.push(`${data.habitWhen}에`);
  const action = data.habitAmount
    ? `${data.habitAction} ${data.habitAmount}`
    : data.habitAction;
  if (action) parts.push(action);
  if (!parts.length || !data.habitPeriod || !data.habitFrequency || !data.habitWhen || !data.habitAmount) return "";
  return parts.join(", ");
}

function formatElasticSummary(data: ProofData) {
  if (!data.miniTask && !data.plusTask && !data.eliteTask) return "";
  return [
    data.miniTask ? `Mini: ${data.miniTask}` : "",
    data.plusTask ? `Plus: ${data.plusTask}` : "",
    data.eliteTask ? `Elite: ${data.eliteTask}` : "",
  ].filter(Boolean).join("\n");
}

function mapProfileToProofData(profile: ElasticProfile): ProofData {
  const goalText = profile.habit_name || profile.life_area || "";
  const habitAction = profile.habit_action || profile.plus_task || "";
  return {
    goalText,
    habitAction,
    blockerText: profile.recent_failure_date ?? "",
    habitPeriod: profile.habit_period ?? "",
    habitFrequency: profile.habit_frequency ?? "",
    habitWhen: profile.habit_when ?? "",
    habitAmount: profile.habit_amount ?? "",
    miniTask: profile.mini_task || getDefaultMiniTask(habitAction),
    plusTask: profile.plus_task || getDefaultPlusTask(habitAction),
    eliteTask: profile.elite_task || getDefaultEliteTask(habitAction),
  };
}

function createCheckInMemo(status: DailyChoice, note: string, reply: string) {
  return [
    `[오늘의 선택] ${statusMeta[status].label}`,
    ...(note ? [`[패턴 1] ${note}`] : []),
    `[코치 응답 1] ${reply.replace(/\n+/g, " ")}`,
  ].join("\n");
}

function parseCheckInMemo(memo: string | null | undefined) {
  if (!memo) return { note: "" };
  const note = memo
    .split("\n")
    .find((line) => line.startsWith("[패턴 1]"))
    ?.replace("[패턴 1]", "")
    .trim();
  return { note: note ?? "" };
}

function buildDailyConversationMessages(checkIns: ElasticCheckIn[], activeDate: string): Message[] {
  return checkIns
    .filter((checkIn) => checkIn.checkin_date < activeDate)
    .slice(-3)
    .flatMap((checkIn) => {
      const status = statusMeta[checkIn.result]?.label ?? checkIn.result;
      const note = parseCheckInMemo(checkIn.memo).note;
      return [
        {
          role: "assistant" as const,
          text: `${formatDateLabel(checkIn.checkin_date)} 기록: ${status}${note ? `\n${note}` : ""}`,
        },
      ];
    });
}

function hasSelfNarrative(text: string) {
  return ["의지", "한심", "원래 그런", "못하는 사람", "완전히 망"].some((keyword) => text.includes(keyword));
}

function createMonthRecords(checkIns: ElasticCheckIn[], dateKey: string): DailyRecord[] {
  const { year, monthIndex, daysInMonth, monthKey } = getCalendarMeta(dateKey);
  const byDate = new Map(
    checkIns
      .filter((checkIn) => checkIn.checkin_date.startsWith(monthKey))
      .map((checkIn) => [checkIn.checkin_date, checkIn.result as CheckInStatus]),
  );

  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const recordDateKey = todayKey(new Date(year, monthIndex, day));
    return { day, dateKey: recordDateKey, status: byDate.get(recordDateKey) ?? "open" };
  });
}

function createCalendarCells(records: DailyRecord[], firstWeekday: number) {
  const leadingEmptyCells = Array.from<null>({ length: firstWeekday }).fill(null);
  const cells = [
    ...leadingEmptyCells,
    ...records,
  ];
  const trailingEmptyCount = (7 - (cells.length % 7)) % 7;
  return [
    ...cells,
    ...Array.from<null>({ length: trailingEmptyCount }).fill(null),
  ];
}

function getCalendarMeta(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  const year = date.getFullYear();
  const monthIndex = date.getMonth();
  const month = monthIndex + 1;
  const firstDate = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  return {
    year,
    monthIndex,
    daysInMonth,
    firstWeekday: firstDate.getDay(),
    monthKey: `${year}-${`${month}`.padStart(2, "0")}`,
    englishMonth: firstDate.toLocaleString("en-US", { month: "long" }).toUpperCase(),
    koreanMonth: `${month}월`,
  };
}

function formatDateLabel(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

function upsertCheckIn(checkIns: ElasticCheckIn[], saved: ElasticCheckIn) {
  return [...checkIns.filter((checkIn) => checkIn.checkin_date !== saved.checkin_date), saved].sort((a, b) =>
    a.checkin_date.localeCompare(b.checkin_date),
  );
}

function sanitizeMessageForStorage(message: Message): Message {
  return {
    role: message.role,
    text: message.text,
    ...(message.emphasizeFirstLine ? { emphasizeFirstLine: true } : {}),
    ...(message.variant ? { variant: message.variant } : {}),
  };
}

function normalizeHomeSessionDraft(raw: unknown, userId: string, scope: string): HomeSessionDraft | null {
  if (!isRecord(raw) || raw.version !== SESSION_DRAFT_KEY_VERSION || raw.userId !== userId || raw.scope !== scope) return null;
  const mode = readEnum(raw.mode, ["onboarding", "result", "optional", "daily"] as const) ?? "onboarding";
  return {
    version: SESSION_DRAFT_KEY_VERSION,
    userId,
    scope,
    activeCheckInDate: readString(raw.activeCheckInDate) || todayKey(),
    mode,
    onboardingStep: readEnum(raw.onboardingStep, ["goal", "habit", "blocker"] as const) ?? "goal",
    optionalMode: readEnum(raw.optionalMode, ["menu", "smart", "elastic"] as const) ?? "menu",
    smartStep: readEnum(raw.smartStep, ["period", "frequency", "when", "amount", "done"] as const) ?? "period",
    elasticStep: readEnum(raw.elasticStep, ["mini", "plus", "elite", "done"] as const) ?? "mini",
    data: normalizeProofData(raw.data),
    messages: normalizeMessages(raw.messages),
    input: readString(raw.input),
    selectedCheckIn: readEnum(raw.selectedCheckIn, ["plus", "mini", "not_done"] as const),
    dailyNote: readString(raw.dailyNote),
    dailyStage: readEnum(raw.dailyStage, ["checkin", "done"] as const) ?? "checkin",
    updatedAt: readString(raw.updatedAt) || new Date(0).toISOString(),
  };
}

function normalizeProofData(value: unknown): ProofData {
  const source = isRecord(value) ? value : {};
  return {
    goalText: readString(source.goalText),
    habitAction: readString(source.habitAction),
    blockerText: readString(source.blockerText),
    habitPeriod: readString(source.habitPeriod),
    habitFrequency: readString(source.habitFrequency),
    habitWhen: readString(source.habitWhen),
    habitAmount: readString(source.habitAmount),
    miniTask: readString(source.miniTask),
    plusTask: readString(source.plusTask),
    eliteTask: readString(source.eliteTask),
  };
}

function normalizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || (item.role !== "assistant" && item.role !== "user") || typeof item.text !== "string") {
      return [];
    }
    return [
      {
        role: item.role,
        text: item.text,
        ...(item.emphasizeFirstLine === true ? { emphasizeFirstLine: true } : {}),
        ...(item.variant === "question" || item.variant === "system" || item.variant === "default"
          ? { variant: item.variant }
          : {}),
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readEnum<const T extends readonly string[]>(value: unknown, options: T): T[number] | null {
  return typeof value === "string" && options.includes(value) ? value : null;
}
