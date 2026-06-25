"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, CalendarCheck, Check, Circle, MessageCircle, Minus, PencilLine, Target } from "lucide-react";
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

type GoalData = {
  lifeArea: string;
  whyChange: string;
  identityStatement: string;
};

type Message = {
  role: "assistant" | "user";
  text: string;
};

type DailyPatternTurn = {
  user: string;
  assistant: string;
};

type DailyStage = "checkin" | "tomorrow_confirm" | "pattern_chat" | "goal_edit" | "goal_patch_confirm" | "done";
type HabitTaskPatch = Partial<Record<`${ElasticLevel}Task`, string>>;

type OnboardingData = {
  lifeArea: string;
  whyChange: string;
  goalIdentityStatement: string;
  failureSituation: string;
  failureFeeling: string;
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

type HabitTaskPatchControllerResult = {
  intent: "patch" | "clarify" | "keep";
  reply: string;
  patch: {
    mini_task: string | null;
    plus_task: string | null;
    elite_task: string | null;
  };
  next_step: "confirm_patch" | "ask_clarifying_question" | "close_without_patch";
};

type DailyRecord = {
  day: number;
  status: CheckInStatus;
};

const emptyOnboarding: OnboardingData = {
  lifeArea: "",
  whyChange: "",
  goalIdentityStatement: "",
  failureSituation: "",
  failureFeeling: "",
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

const SERVICE_INTRO =
  "Proof는 목표를 세우는 데서 끝나지 않고, 실제 행동으로 이어지도록 돕는 변화 기록 서비스예요.\n원하는 변화가 왜 자주 막히는지 함께 살펴보고, 매일 남길 수 있는 작은 증거를 쌓아가며 나에게 맞는 실행 방식을 찾아갑니다.";
const ONBOARDING_INTRO =
  "먼저 대화를 통해 옆에 있는 목표와 패턴을 함께 채워볼게요.\n바꾸고 싶은 방향, 반복해서 막히는 상황, 그때의 생각과 감정을 정리한 뒤 바로 실행할 수 있는 작은 습관으로 바꿉니다. 이후에는 매일 체크인으로 성공과 실패를 평가가 아니라 데이터로 기록해 다음 행동을 조정해요.";
const GOAL_AREA_QUESTION =
  "요즘 가장 바꾸고 싶은 삶의 영역은 무엇인가요?\n공부, 운동, 수면, 일, 감정관리, 인간관계 중 어디에 가까운지 자유롭게 말해주세요.";
const HABIT_ACTION_OPENING =
  "이제 목표를 실제 행동으로 바꿔볼게요.\n여기서 정하는 습관은 좋은 다짐이 아니라, 오늘이나 내일부터 바로 할 수 있고, 내가 통제할 수 있고, 완료 여부를 확인할 수 있는 행동이어야 해요.\n그래야 나중에 막혔을 때 나를 탓하는 대신, 행동의 크기나 조건을 조정할 수 있습니다.\n\n어떤 행동으로 시작해볼까요?";
const DAILY_CHECKIN_PROMPT =
  "오늘의 습관은 어떤 흐름이었나요?\n이 체크인은 평가가 아니라 관찰이에요. 잘 됐다면 어떤 조건이 도와줬는지, 안 됐다면 어디서 막혔는지를 남겨볼게요. 기록 자체가 내일의 설계를 더 똑똑하게 만드는 데이터가 됩니다.";

const selfNarrativeKeywords = ["의지", "한심", "원래 그런", "이상해", "못하는 사람", "의지력"];

const statusMeta = {
  mini: { label: "Mini", icon: Check },
  plus: { label: "Plus", icon: Check },
  elite: { label: "Elite", icon: Check },
  not_done: { label: "기록만함", icon: Circle },
  no_response: { label: "무응답", icon: Minus },
  open: { label: "열림", icon: PencilLine },
};

const elasticLevelLabels: Record<ElasticLevel, string> = {
  mini: "Mini",
  plus: "Plus",
  elite: "Elite",
};

const MINI_OPENING = (habitAction: string) =>
  `좋아요. 이제 "${habitAction}"을 Mini / Plus / Elite로 나눌게요.\n목표는 매번 완벽하게 해내는 게 아니라, 컨디션이 낮은 날에도 완전히 실패한 날이 되지 않게 만드는 거예요.\n\nMini는 전체 목표를 그대로 하는 게 아니라, 가장 힘든 날에도 남길 수 있는 최소 증거입니다. 예를 들어 목표가 책 30쪽 읽기라면 Mini는 30쪽이 아니라 책 펼치기, 1쪽 읽기, 3문장 읽기처럼 훨씬 작아야 해요.\n\n너무 쉬워 보여도 괜찮습니다. 이 기준이 있어야 실패한 날에도 기록이 남고, 다음 날 다시 이어갈 수 있어요. "${habitAction}"을 기준으로 Mini는 어디까지 낮추면 좋을까요?`;

const initialMessages: Message[] = [];
const DEBUG_SESSION_KEY = "proof-elastic-debug-session";

function createDebugSessionId() {
  return crypto.randomUUID();
}

function readDebugSessionId() {
  if (typeof window === "undefined") return "";
  const scope = new URLSearchParams(window.location.search).get("scope");
  if (scope?.startsWith("debug:")) {
    const sessionId = scope.slice("debug:".length);
    if (sessionId) {
      window.localStorage.setItem(DEBUG_SESSION_KEY, sessionId);
      return sessionId;
    }
  }
  const current = window.localStorage.getItem(DEBUG_SESSION_KEY);
  if (current) return current;
  const next = createDebugSessionId();
  window.localStorage.setItem(DEBUG_SESSION_KEY, next);
  return next;
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return todayKey(date);
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
  const [patternInput, setPatternInput] = useState("");
  const [dailyPatternTurns, setDailyPatternTurns] = useState<DailyPatternTurn[]>([]);
  const [dailyStage, setDailyStage] = useState<DailyStage>("checkin");
  const [pendingTaskPatch, setPendingTaskPatch] = useState<HabitTaskPatch | null>(null);
  const [nextMini, setNextMini] = useState("");
  const [nextPlus, setNextPlus] = useState("");
  const [nextElite, setNextElite] = useState("");
  const [pending, setPending] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [debugEnabled] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1",
  );
  const [debugCheckInDate, setDebugCheckInDate] = useState(() => todayKey());
  const [debugSessionId, setDebugSessionId] = useState(() => (debugEnabled ? readDebugSessionId() : ""));
  const [debugEvents, setDebugEvents] = useState<OnboardingDebugEvent[]>([]);
  const [goalExpanded, setGoalExpanded] = useState(false);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const storageScope = debugEnabled ? `debug:${debugSessionId}` : LIVE_ELASTIC_SCOPE;
  const activeCheckInDate = debugEnabled ? debugCheckInDate : todayKey();

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
      } else {
        resetOnboardingState();
        showOnboardingOpening();
      }

      setCheckIns(checkIns);
      setRecords(createMonthRecords(checkIns));
      const today = checkIns.find((checkIn) => checkIn.checkin_date === activeCheckInDate);
      if (today) {
        setSelectedCheckIn(today.result);
        setMemo(today.memo ?? "");
        setDailyPatternTurns(parsePatternMemo(today.memo).turns);
        setDailyStage("done");
        setMessages([
          ...buildDailyConversationMessages(checkIns, activeCheckInDate),
          {
            role: "assistant",
            text: `${formatDateLabel(activeCheckInDate)} 기록은 이미 ${statusMeta[today.result].label}로 저장되어 있어요.\n필요하면 아래에서 오늘 기록을 수정할 수 있습니다.`,
          },
        ]);
      } else if (profile?.onboarding_completed_at) {
        setSelectedCheckIn(null);
        setMemo("");
        setDailyPatternTurns([]);
        setPatternInput("");
        setDailyStage("checkin");
        setMessages([
          ...buildDailyConversationMessages(checkIns, activeCheckInDate),
          {
            role: "assistant",
            text: `${formatDateLabel(activeCheckInDate)} 체크인을 시작할게요.\n${DAILY_CHECKIN_PROMPT}`,
          },
        ]);
      }
    }

    void load();
  }, [activeCheckInDate, userId, storageScope]);

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
      lifeArea: nextData.lifeArea,
      whyChange: nextData.whyChange,
      identityStatement: nextData.goalIdentityStatement,
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
    if (step === "bridge") {
      setStep("habit_action");
      assistant(HABIT_ACTION_OPENING);
    }
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
      assistant(DAILY_CHECKIN_PROMPT);
    }
  }

  function handleCheckIn(status: Exclude<CheckInStatus, "open" | "no_response">) {
    setSelectedCheckIn(status);
  }

  async function saveDailyCheckIn(status: Exclude<CheckInStatus, "open" | "no_response">, text: string) {
    const trimmed = text.trim();
    if (!userId || !trimmed) return;

    setMessages((current) => [...current, { role: "user", text: `${statusMeta[status].label}\n${trimmed}` }]);
    setPatternInput("");
    setPending(true);
    try {
      const coachReply = createPatternCoachReply(status, trimmed, 0);
      const patternTurns = [{ user: trimmed, assistant: coachReply }];
      const patternMemo = createPatternMemo(status, patternTurns);
      const hasSelfNarrative = selfNarrativeKeywords.some((keyword) => patternMemo.includes(keyword));
      const saved = await saveElasticCheckIn({
        user_id: userId,
        scope: storageScope,
        checkin_date: activeCheckInDate,
        result: status,
        memo: patternMemo,
        self_narrative_detected: hasSelfNarrative,
      });
      applySavedCheckIn(saved);
      const nextCheckIns = upsertCheckIn(checkIns, saved);
      setCheckIns(nextCheckIns);
      setMessages((current) => [
        ...current,
        ...(hasSelfNarrative
          ? [{ role: "assistant" as const, text: "기억하시죠, 오늘은 그 사람인지가 아니라 이 행동을 했는지만 보기로 했었죠" }]
          : []),
        { role: "assistant", text: `${coachReply}\n\n내일도 습관 목표를 그대로 가져갈까요? 필요하면 오늘 패턴에 맞게 목표를 수정해도 돼요.` },
      ]);
      setMemo(patternMemo);
      setDailyPatternTurns(patternTurns);
      setDailyStage("tomorrow_confirm");
      setSaveMessage(null);
    } finally {
      setPending(false);
    }
  }

  async function keepTomorrowPlan() {
    setPendingTaskPatch(null);
    setMessages((current) => [
      ...current,
      { role: "user", text: "그대로 가져갈게요" },
      {
        role: "assistant",
        text: `좋아요. 내일도 "${data.habitAction || "이 습관"}" 목표를 그대로 이어갈게요.\n내일도 작게라도 꾸준히 가봅시다.`,
      },
    ]);
    setDailyStage("done");
  }

  function requestPatternChat() {
    setMessages((current) => [
      ...current,
      { role: "user", text: "오늘 패턴을 더 이야기해볼게요" },
      { role: "assistant", text: "좋아요. 오늘 흐름에서 더 보고 싶은 지점을 한 문장으로 적어주세요." },
    ]);
    setPatternInput("");
    setDailyStage("pattern_chat");
  }

  function requestHabitGoalEdit() {
    setMessages((current) => [
      ...current,
      { role: "user", text: "습관목표 수정하기" },
      {
        role: "assistant",
        text: "좋아요. 내일 Mini / Plus / Elite 목표를 어떻게 바꿀까요? 바꾸고 싶은 것만 한 문장으로 말해도 돼요.",
      },
    ]);
    setPendingTaskPatch(null);
    setPatternInput("");
    setDailyStage("goal_edit");
  }

  async function savePatternFollowup(text: string) {
    const trimmed = text.trim();
    if (!userId || !trimmed || !selectedCheckIn || selectedCheckIn === "open" || selectedCheckIn === "no_response") return;

    setMessages((current) => [...current, { role: "user", text: trimmed }]);
    setPatternInput("");
    setPending(true);
    try {
      const followupReply = createPatternFollowupReply(trimmed);
      const nextTurns = [...dailyPatternTurns, { user: trimmed, assistant: followupReply }];
      const patternMemo = createPatternMemo(selectedCheckIn, nextTurns);
      const saved = await saveElasticCheckIn({
        user_id: userId,
        scope: storageScope,
        checkin_date: activeCheckInDate,
        result: selectedCheckIn,
        memo: patternMemo,
        self_narrative_detected: selfNarrativeKeywords.some((keyword) => patternMemo.includes(keyword)),
      });
      applySavedCheckIn(saved);
      setCheckIns(upsertCheckIn(checkIns, saved));
      setMemo(patternMemo);
      setDailyPatternTurns(nextTurns);
      setMessages((current) => [
        ...current,
        { role: "assistant", text: `${followupReply}\n\n내일도 습관 목표를 그대로 가져갈까요? 필요하면 목표를 수정해도 돼요.` },
      ]);
      setDailyStage("tomorrow_confirm");
    } finally {
      setPending(false);
    }
  }

  async function saveHabitGoalEditDraft(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages((current) => [...current, { role: "user", text: trimmed }]);
    setPatternInput("");
    setPending(true);
    try {
      const result = await runHabitTaskPatchController(trimmed, data, checkIns);
      const patch = controllerPatchToTaskPatch(result.patch);
      const hasPatch = Object.keys(patch).length > 0;
      setPendingTaskPatch(hasPatch ? patch : null);
      setMessages((current) => [
        ...current,
        { role: "assistant", text: result.reply },
      ]);
      setDailyStage(
        result.next_step === "confirm_patch" && hasPatch
          ? "goal_patch_confirm"
          : result.next_step === "close_without_patch"
            ? "done"
            : "goal_edit",
      );
    } finally {
      setPending(false);
    }
  }

  async function confirmHabitGoalPatch() {
    if (!userId || !pendingTaskPatch) return;

    const nextTasks = {
      mini_task: pendingTaskPatch.miniTask ?? nextMini ?? data.miniTask,
      plus_task: pendingTaskPatch.plusTask ?? nextPlus ?? data.plusTask,
      elite_task: pendingTaskPatch.eliteTask ?? nextElite ?? data.eliteTask,
    };

    setPending(true);
    try {
      await updateElasticTasks(userId, nextTasks, storageScope);
      setData((current) => ({
        ...current,
        miniTask: nextTasks.mini_task,
        plusTask: nextTasks.plus_task,
        eliteTask: nextTasks.elite_task,
      }));
      setNextMini(nextTasks.mini_task);
      setNextPlus(nextTasks.plus_task);
      setNextElite(nextTasks.elite_task);
      setPendingTaskPatch(null);
      setMessages((current) => [
        ...current,
        { role: "user", text: "이대로 저장" },
        { role: "assistant", text: "좋아요. 내일 목표를 저장했어요.\n내일도 작게라도 꾸준히 가봅시다." },
      ]);
      setDailyStage("done");
    } finally {
      setPending(false);
    }
  }

  function retryHabitGoalEdit() {
    setPendingTaskPatch(null);
    setPatternInput("");
    setMessages((current) => [
      ...current,
      { role: "user", text: "다시 수정" },
      { role: "assistant", text: "좋아요. 바꾸고 싶은 Mini / Plus / Elite 목표를 다시 한 문장으로 말해주세요." },
    ]);
    setDailyStage("goal_edit");
  }

  function keepHabitGoalUnchanged() {
    setPendingTaskPatch(null);
    setMessages((current) => [
      ...current,
      { role: "user", text: "그대로 유지" },
      { role: "assistant", text: "좋아요. 내일 목표는 그대로 유지할게요.\n내일도 작게라도 꾸준히 가봅시다." },
    ]);
    setDailyStage("done");
  }

  function editTodayCheckIn() {
    setMessages((current) => [
      ...current,
      { role: "user", text: "오늘 기록 수정할게요" },
      { role: "assistant", text: DAILY_CHECKIN_PROMPT },
    ]);
    setSelectedCheckIn(null);
    setPendingTaskPatch(null);
    setPatternInput("");
    setDailyStage("checkin");
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
    const saved = await saveElasticCheckIn({
      user_id: userId,
      scope: storageScope,
      checkin_date: activeCheckInDate,
      result: "no_response",
    });
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
      recent_failure_date: nextData.failureSituation || null,
      pre_breakdown_feeling: nextData.failureFeeling || null,
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
    setPatternInput("");
    setDailyPatternTurns([]);
    setDailyStage("checkin");
    setPendingTaskPatch(null);
    setNextMini("");
    setNextPlus("");
    setNextElite("");
    setSaveMessage(null);
  }

  async function resetDebugConversation() {
    resetOnboardingState();
    setDebugEvents([]);
    showOnboardingOpening();
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

  async function jumpToDailyCheckIn() {
    const seeded: OnboardingData = {
      lifeArea: data.lifeArea || "[debug] 습관 실험",
      whyChange: data.whyChange || "[debug] 데일리 체크인 확인",
      goalIdentityStatement: data.goalIdentityStatement || "[debug] 나는 작은 증거를 기록하는 사람이다.",
      failureSituation: data.failureSituation || "[debug] 피곤한 날 시작이 밀림",
      failureFeeling: data.failureFeeling || "[debug] 시작 비용이 크게 느껴짐",
      habitAction: data.habitAction && data.habitAction !== "[스킵]" ? data.habitAction : "데일리 체크인 테스트",
      habitPeriod: data.habitPeriod && data.habitPeriod !== "[스킵]" ? data.habitPeriod : "7일",
      habitFrequency: data.habitFrequency && data.habitFrequency !== "[스킵]" ? data.habitFrequency : "매일",
      habitWhen: data.habitWhen && data.habitWhen !== "[스킵]" ? data.habitWhen : "저녁에",
      habitAmount: data.habitAmount && data.habitAmount !== "[스킵]" ? data.habitAmount : "5분",
      miniTask: data.miniTask || "1분만 기록하기",
      plusTask: data.plusTask || "5분 기록하기",
      eliteTask: data.eliteTask || "패턴과 내일 조정까지 적기",
    };

    setData(seeded);
    setGoalData({
      lifeArea: seeded.lifeArea,
      whyChange: seeded.whyChange,
      identityStatement: seeded.goalIdentityStatement,
    });
    setNextMini(seeded.miniTask);
    setNextPlus(seeded.plusTask);
    setNextElite(seeded.eliteTask);
    setSelectedCheckIn(null);
    setMemo("");
    setPatternInput("");
    setDailyPatternTurns([]);
    setDailyStage("checkin");
    setPendingTaskPatch(null);
    setMode("daily");
    setStep("complete");
    setMessages([
      {
        role: "assistant",
        text: `[debug] 데일리 체크인으로 바로 이동했어요.\n${DAILY_CHECKIN_PROMPT}`,
      },
    ]);
    setSaveMessage(null);
    await persistProfile(seeded);
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

  function moveDebugCheckInDate(days: number) {
    setDebugCheckInDate((current) => addDaysToDateKey(current, days));
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

  function showOnboardingOpening() {
    setMessages([
      { role: "assistant", text: SERVICE_INTRO },
      { role: "assistant", text: ONBOARDING_INTRO },
      { role: "assistant", text: GOAL_AREA_QUESTION },
    ]);
  }

  if (loading) return <LoadingState />;

  const isGoalPhase = step !== "mini" && step !== "plus" && step !== "elite" && step !== "complete";
  const trackerSubtitle = buildSmartSentence(data);

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
            {trackerSubtitle ? <p className="tracker-subtitle">{trackerSubtitle}</p> : null}
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

        <section className="daily-overview" aria-label="오늘 체크인과 습관 기준">
          <section className="today-strip">
            <div>
              <div className="band-title">
                <CalendarCheck size={18} aria-hidden="true" />
                <span>오늘 체크인</span>
              </div>
              <p>{selectedCheckIn ? createDailyNote(selectedCheckIn, memo) : "오늘의 선택과 패턴 대화를 남깁니다."}</p>
            </div>
            <span className={`tracker-status ${selectedCheckIn || "open"}`}>{statusMeta[selectedCheckIn || "open"].label}</span>
          </section>

          <div className="level-stack" aria-label="Mini Plus Elite 기준과 월간 횟수">
            <section className="tracker-tile level-mini">
              <div>
                <span>Mini</span>
                <strong>{data.miniTask || "최소 단위"}</strong>
              </div>
              <small>이번 달 {levelCounts.mini}회</small>
            </section>
            <section className="tracker-tile level-plus">
              <div>
                <span>Plus</span>
                <strong>{data.plusTask || "보통 단위"}</strong>
              </div>
              <small>이번 달 {levelCounts.plus}회</small>
            </section>
            <section className="tracker-tile level-elite">
              <div>
                <span>Elite</span>
                <strong>{data.eliteTask || "도전 단위"}</strong>
              </div>
              <small>이번 달 {levelCounts.elite}회</small>
            </section>
          </div>
        </section>

        <section className="month-grid" aria-label="이번 달 기록">
          {records.map((record) => {
            const Icon = statusMeta[record.status].icon;
            const checkIn = checkIns.find((item) => Number(item.checkin_date.slice(-2)) === record.day) ?? null;
            return checkIn ? (
              <Link
                aria-label={`${record.day}일 기록 ${statusMeta[record.status].label}`}
                className={`day-cell ${record.status}`}
                href={`/record?date=${checkIn.checkin_date}&scope=${encodeURIComponent(storageScope)}`}
                key={record.day}
              >
                <span>{record.day}</span>
                <Icon size={17} aria-hidden="true" />
              </Link>
            ) : (
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
                pending={pending}
                stage={dailyStage}
                patternInput={patternInput}
                selectedCheckIn={selectedCheckIn}
                setPatternInput={setPatternInput}
                onCheckIn={handleCheckIn}
                onConfirmHabitGoalPatch={confirmHabitGoalPatch}
                onEditToday={editTodayCheckIn}
                onKeepTomorrowPlan={keepTomorrowPlan}
                onKeepHabitGoalUnchanged={keepHabitGoalUnchanged}
                onRequestHabitGoalEdit={requestHabitGoalEdit}
                onSaveCheckIn={saveDailyCheckIn}
                onSaveHabitGoalEditDraft={saveHabitGoalEditDraft}
                onSavePatternFollowup={savePatternFollowup}
                onRequestPatternChat={requestPatternChat}
                onRetryHabitGoalEdit={retryHabitGoalEdit}
              />
            )}

            {debugEnabled ? (
              <OnboardingDebugPanel
                data={data}
                debugCheckInDate={activeCheckInDate}
                dailyPatternTurns={dailyPatternTurns}
                dailyStage={dailyStage}
                events={debugEvents}
                goalData={goalData}
                memo={memo}
                mode={mode}
                onDebugDateToday={() => setDebugCheckInDate(todayKey())}
                onDebugDateShift={moveDebugCheckInDate}
                onJumpToStep={jumpToStep}
                onJumpToDaily={jumpToDailyCheckIn}
                onNewSession={startNewDebugSession}
                onResetConversation={resetDebugConversation}
                onResetSession={resetCurrentDebugSession}
                onSkipGoal={skipGoalPhase}
                patternInput={patternInput}
                pending={pending}
                pendingTaskPatch={pendingTaskPatch}
                scope={storageScope}
                selectedCheckIn={selectedCheckIn}
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
  "failure_situation", "failure_feeling", "bridge",
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
  debugCheckInDate,
  dailyPatternTurns,
  dailyStage,
  events,
  goalData,
  memo,
  mode,
  onDebugDateShift,
  onDebugDateToday,
  onJumpToStep,
  onJumpToDaily,
  onNewSession,
  onResetConversation,
  onResetSession,
  onSkipGoal,
  patternInput,
  pending,
  pendingTaskPatch,
  scope,
  selectedCheckIn,
  sessionId,
  step,
}: {
  data: OnboardingData;
  debugCheckInDate: string;
  dailyPatternTurns: DailyPatternTurn[];
  dailyStage: DailyStage;
  events: OnboardingDebugEvent[];
  goalData: GoalData;
  memo: string;
  mode: "onboarding" | "daily";
  onDebugDateShift: (days: number) => void;
  onDebugDateToday: () => void;
  onJumpToStep: (step: OnboardingStep) => void;
  onJumpToDaily: () => void;
  onNewSession: () => void;
  onResetConversation: () => void;
  onResetSession: () => void;
  onSkipGoal: () => void;
  patternInput: string;
  pending: boolean;
  pendingTaskPatch: HabitTaskPatch | null;
  scope: string;
  selectedCheckIn: CheckInStatus | null;
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
  const dailyFields: [string, string][] = [
    ["mode", mode],
    ["checkInDate", debugCheckInDate],
    ["dailyStage", dailyStage],
    ["선택", selectedCheckIn ? statusMeta[selectedCheckIn].label : ""],
    ["선택 raw", selectedCheckIn ?? ""],
    ["패턴 입력", patternInput],
    ["대화 턴", dailyPatternTurns.length ? String(dailyPatternTurns.length) : ""],
    ["수정 후보", pendingTaskPatch ? formatTaskPatch(pendingTaskPatch) : ""],
    ["저장 가능", selectedCheckIn && dailyPatternTurns.length > 0 ? "true" : "false"],
  ];
  const memoPreview =
    selectedCheckIn && selectedCheckIn !== "open" && dailyPatternTurns.length > 0
      ? createPatternMemo(selectedCheckIn, dailyPatternTurns)
      : memo;

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
        <button className="debug-btn-accent" disabled={pending} onClick={onJumpToDaily} type="button">데일리 체크인 테스트</button>
        <button disabled={pending} onClick={() => onDebugDateShift(-1)} type="button">날짜 -1일</button>
        <button disabled={pending} onClick={onDebugDateToday} type="button">오늘 날짜</button>
        <button disabled={pending} onClick={() => onDebugDateShift(1)} type="button">날짜 +1일</button>
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
          <div className="debug-data-section">
            <span>Daily</span>
            {dailyFields.map(([label, val]) => (
              <div key={label} className={`debug-data-row${val ? " filled" : " empty"}`}>
                <span>{label}</span>
                <span>{val || "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </details>

      <details open={mode === "daily"}>
        <summary className="debug-section-title">데일리 체크인 디버그</summary>
        {dailyPatternTurns.length ? (
          dailyPatternTurns.map((turn, index) => (
            <div className="debug-turn-body" key={`${turn.user}-${index}`}>
              <div className="debug-turn-input">패턴 {index + 1}: {turn.user}</div>
              <div className="debug-turn-reply">응답 {index + 1}: {turn.assistant}</div>
            </div>
          ))
        ) : (
          <p>아직 패턴 대화가 없습니다.</p>
        )}
        {memoPreview ? <pre>{memoPreview}</pre> : null}
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

  useEffect(() => {
    if (pending || step === "complete" || step === "bridge" || step === "goal_complete") return;
    requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  }, [pending, step]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  if (step === "bridge") {
    return (
      <button className="primary-button" disabled={pending} onClick={onContinue} type="button">
        이제 습관 만들러 가기
      </button>
    );
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
  pending,
  patternInput,
  selectedCheckIn,
  stage,
  setPatternInput,
  onCheckIn,
  onConfirmHabitGoalPatch,
  onEditToday,
  onKeepHabitGoalUnchanged,
  onKeepTomorrowPlan,
  onRequestHabitGoalEdit,
  onSaveCheckIn,
  onSaveHabitGoalEditDraft,
  onSavePatternFollowup,
  onRequestPatternChat,
  onRetryHabitGoalEdit,
}: {
  pending: boolean;
  patternInput: string;
  selectedCheckIn: CheckInStatus | null;
  stage: DailyStage;
  setPatternInput: (value: string) => void;
  onCheckIn: (status: Exclude<CheckInStatus, "open" | "no_response">) => void;
  onConfirmHabitGoalPatch: () => void;
  onEditToday: () => void;
  onKeepHabitGoalUnchanged: () => void;
  onKeepTomorrowPlan: () => void;
  onRequestHabitGoalEdit: () => void;
  onSaveCheckIn: (status: Exclude<CheckInStatus, "open" | "no_response">, text: string) => void;
  onSaveHabitGoalEditDraft: (text: string) => void;
  onSavePatternFollowup: (text: string) => void;
  onRequestPatternChat: () => void;
  onRetryHabitGoalEdit: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerVisible = stage === "checkin" || stage === "pattern_chat" || stage === "goal_edit";

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 130)}px`;
  }, [patternInput, pending, stage]);

  useEffect(() => {
    if (pending || !composerVisible) return;
    requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  }, [composerVisible, pending, stage, selectedCheckIn]);

  function handlePatternSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stage === "goal_edit") {
      onSaveHabitGoalEditDraft(patternInput);
      return;
    }
    if (stage === "pattern_chat") {
      onSavePatternFollowup(patternInput);
      return;
    }
    if (!selectedCheckIn || selectedCheckIn === "open" || selectedCheckIn === "no_response") return;
    onSaveCheckIn(selectedCheckIn, patternInput);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <div className="daily-chat-checkin">
      {stage === "checkin" ? (
        <div className="checkin-buttons daily-quick-replies" aria-label="오늘 상태 선택">
          <button className={selectedCheckIn === "mini" ? "selected mini" : "mini"} disabled={pending} onClick={() => onCheckIn("mini")} type="button">
            Mini
          </button>
          <button className={selectedCheckIn === "plus" ? "selected plus" : "plus"} disabled={pending} onClick={() => onCheckIn("plus")} type="button">
            Plus
          </button>
          <button className={selectedCheckIn === "elite" ? "selected elite" : "elite"} disabled={pending} onClick={() => onCheckIn("elite")} type="button">
            Elite
          </button>
          <button
            className={selectedCheckIn === "not_done" ? "selected not-done" : "not-done"}
            disabled={pending}
            onClick={() => onCheckIn("not_done")}
            type="button"
          >
            기록만함
          </button>
        </div>
      ) : null}

      {stage === "tomorrow_confirm" ? (
        <div className="daily-quick-replies tomorrow-replies" aria-label="내일 목표 확인">
          <button disabled={pending} onClick={onKeepTomorrowPlan} type="button">그대로 가져가기</button>
          <button disabled={pending} onClick={onRequestHabitGoalEdit} type="button">습관목표 수정하기</button>
          <button disabled={pending} onClick={onRequestPatternChat} type="button">패턴 더 이야기하기</button>
          <button disabled={pending} onClick={onEditToday} type="button">오늘 기록 수정</button>
        </div>
      ) : null}

      {stage === "goal_patch_confirm" ? (
        <div className="daily-quick-replies tomorrow-replies" aria-label="습관 목표 수정 확인">
          <button disabled={pending} onClick={onConfirmHabitGoalPatch} type="button">이대로 저장</button>
          <button disabled={pending} onClick={onRetryHabitGoalEdit} type="button">다시 수정</button>
          <button disabled={pending} onClick={onKeepHabitGoalUnchanged} type="button">그대로 유지</button>
        </div>
      ) : null}

      {stage === "done" ? (
        <div className="daily-quick-replies tomorrow-replies" aria-label="오늘 기록 완료">
          <span className="daily-done-chip">오늘 기록 완료</span>
          <button disabled={pending} onClick={onEditToday} type="button">오늘 기록 수정</button>
        </div>
      ) : null}

      {composerVisible ? (
        <form className="chat-composer daily-chat-composer" onSubmit={handlePatternSubmit}>
          <textarea
            disabled={pending}
            value={patternInput}
            onKeyDown={handleKeyDown}
            onChange={(event) => setPatternInput(event.target.value)}
            ref={textareaRef}
            placeholder={
              stage === "pattern_chat"
                ? "예: 집에 돌아오는 순간부터 에너지가 확 떨어졌어요."
                : stage === "goal_edit"
                  ? "예: Plus는 10분 기록하기로 바꾸고, Mini는 1분 시작하기로 낮출래요."
                  : selectedCheckIn
                    ? "예: 퇴근하고 바로 누우니까 다시 시작하기가 어려웠어요."
                    : "먼저 Mini, Plus, Elite, 기록만함 중 하나를 골라주세요."
            }
            rows={1}
          />
          <button
            aria-label={stage === "pattern_chat" ? "패턴 이야기 보내기" : stage === "goal_edit" ? "습관 목표 수정 보내기" : "오늘 습관 기록 보내기"}
            disabled={pending || (stage === "checkin" && !selectedCheckIn) || !patternInput.trim()}
            type="submit"
          >
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </form>
      ) : null}
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

async function runHabitTaskPatchController(
  latestUserAnswer: string,
  data: OnboardingData,
  recentCheckIns: ElasticCheckIn[],
): Promise<HabitTaskPatchControllerResult> {
  try {
    const response = await fetch("/api/elastic/habit-task-patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latest_user_answer: latestUserAnswer,
        profile: {
          habit_name: buildSmartSentence(data) || data.habitAction,
          habit_action: data.habitAction,
          habit_period: data.habitPeriod,
          habit_frequency: data.habitFrequency,
          habit_when: data.habitWhen,
          habit_amount: data.habitAmount,
          mini_task: data.miniTask,
          plus_task: data.plusTask,
          elite_task: data.eliteTask,
        },
        recent_checkins: recentCheckIns.slice(-7).map((checkIn) => ({
          checkin_date: checkIn.checkin_date,
          result: checkIn.result,
          memo: checkIn.memo,
        })),
      }),
    });

    if (!response.ok) throw new Error("Failed");
    return normalizeHabitTaskPatchResult((await response.json()) as HabitTaskPatchControllerResult);
  } catch {
    return {
      intent: "clarify",
      reply: "어떤 기준을 바꿀지 한 번만 더 확인할게요. Mini / Plus / Elite 중 무엇을 어떻게 바꿀까요?",
      patch: { mini_task: null, plus_task: null, elite_task: null },
      next_step: "ask_clarifying_question",
    };
  }
}

function normalizeHabitTaskPatchResult(result: HabitTaskPatchControllerResult): HabitTaskPatchControllerResult {
  const patch = result.patch ?? { mini_task: null, plus_task: null, elite_task: null };
  const normalized = {
    mini_task: normalizePatchValue(patch.mini_task),
    plus_task: normalizePatchValue(patch.plus_task),
    elite_task: normalizePatchValue(patch.elite_task),
  };
  const hasPatch = Boolean(normalized.mini_task || normalized.plus_task || normalized.elite_task);
  return {
    intent: result.intent ?? (hasPatch ? "patch" : "clarify"),
    reply: result.reply || (hasPatch ? `이렇게 바꿔볼게요.\n${formatTaskPatch(controllerPatchToTaskPatch(normalized))}\n이대로 저장할까요?` : "어떤 기준을 바꿀지 한 번만 더 말해주세요."),
    patch: normalized,
    next_step: hasPatch ? "confirm_patch" : result.next_step ?? "ask_clarifying_question",
  };
}

function normalizePatchValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function controllerPatchToTaskPatch(patch: HabitTaskPatchControllerResult["patch"]): HabitTaskPatch {
  return {
    ...(patch.mini_task ? { miniTask: patch.mini_task } : {}),
    ...(patch.plus_task ? { plusTask: patch.plus_task } : {}),
    ...(patch.elite_task ? { eliteTask: patch.elite_task } : {}),
  };
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
      return advanceOnboardingStep(currentStep, { eliteTask: text }, "완성됐어요. 이제부터 체크인은 평가가 아니라 관찰이에요. 어떤 조건에서 움직였고 어디서 막혔는지를 기록하면서 내일의 설계를 더 맞춰볼게요.");
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
  return dataPatch.reduce((next, item) => clearDependentOnboardingFields({ ...next, [item.field]: item.value }, item.field), data);
}

const onboardingFieldOrder: (keyof OnboardingData)[] = [
  "lifeArea",
  "whyChange",
  "goalIdentityStatement",
  "failureSituation",
  "failureFeeling",
  "habitAction",
  "habitPeriod",
  "habitFrequency",
  "habitWhen",
  "habitAmount",
  "miniTask",
  "plusTask",
  "eliteTask",
];

function clearDependentOnboardingFields(data: OnboardingData, changedField: keyof OnboardingData): OnboardingData {
  const changedIndex = onboardingFieldOrder.indexOf(changedField);
  if (changedIndex < 0) return data;

  return onboardingFieldOrder.slice(changedIndex + 1).reduce(
    (next, field) => ({
      ...next,
      [field]: "",
    }),
    data,
  );
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
  const statusText = statusMeta[status]?.label ?? status;
  if (!memo) return statusText;
  const firstLine = memo
    .split("\n")
    .find((line) => line.startsWith("[패턴 "))
    ?.replace(/^\[패턴 \d+\]\s*/, "")
    .trim();
  return firstLine ? `${statusText}: ${firstLine}` : statusText;
}

function createPatternMemo(status: CheckInStatus, turns: DailyPatternTurn[]) {
  const statusText = statusMeta[status]?.label ?? status;
  return [
    `[오늘의 선택] ${statusText}`,
    ...turns.flatMap((turn, index) => [
      `[패턴 ${index + 1}] ${turn.user}`,
      `[코치 응답 ${index + 1}] ${turn.assistant}`,
    ]),
  ].join("\n");
}

function parsePatternMemo(memo: string | null | undefined): { turns: DailyPatternTurn[] } {
  if (!memo) return { turns: [] };

  const turns: DailyPatternTurn[] = [];
  for (const line of memo.split("\n")) {
    const patternMatch = line.match(/^\[패턴 \d+\]\s*(.*)$/);
    if (patternMatch) {
      turns.push({ user: patternMatch[1]?.trim() ?? "", assistant: "" });
      continue;
    }

    const replyMatch = line.match(/^\[코치 응답 \d+\]\s*(.*)$/);
    if (replyMatch) {
      const last = turns.at(-1);
      if (last) last.assistant = replyMatch[1]?.trim() ?? "";
    }
  }

  return { turns };
}

function buildDailyConversationMessages(checkIns: ElasticCheckIn[], activeDate: string): Message[] {
  const pastCheckIns = checkIns
    .filter((checkIn) => checkIn.checkin_date <= activeDate)
    .slice(-7);

  if (!pastCheckIns.length) return [];

  return pastCheckIns.flatMap((checkIn) => {
    const status = checkIn.result;
    const turns = parsePatternMemo(checkIn.memo).turns;
    const label = statusMeta[status]?.label ?? status;
    const header: Message = {
      role: "assistant",
      text: `${formatDateLabel(checkIn.checkin_date)} 기록: ${label}`,
    };

    if (!turns.length) return [header];

    return [
      header,
      ...turns.flatMap((turn, index) => [
        {
          role: "user" as const,
          text: index === 0 ? `${label}\n${turn.user}` : turn.user,
        },
        ...(turn.assistant ? [{ role: "assistant" as const, text: turn.assistant }] : []),
      ]),
    ];
  });
}

function formatDateLabel(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

function createPatternCoachReply(status: CheckInStatus | null, text: string, turnIndex: number) {
  const statusLabel = status ? statusMeta[status].label : "아직 선택 전";
  const hasFriction = ["못", "막", "피곤", "늦", "누웠", "미뤘", "바빠", "까먹", "귀찮", "힘들"].some((keyword) =>
    text.includes(keyword),
  );
  const hasSupport = ["했", "됐다", "잘", "쉬웠", "도움", "성공", "시작", "끝"].some((keyword) => text.includes(keyword));

  if (turnIndex === 0 && !status) {
    return "좋아요. 이제 오늘 기록을 Mini, Plus, Elite, 기록만함 중 어디에 둘지도 같이 선택해두면 패턴이 더 선명해져요.";
  }
  if (hasFriction) {
    return `오늘은 ${statusLabel}로 저장했어요. 핵심은 실패 판정이 아니라 막힌 조건을 잡은 거예요. 방금 적은 지점이 내일 Mini를 더 치밀하게 만드는 단서가 됩니다.`;
  }
  if (hasSupport) {
    return `좋아요. 오늘 ${statusLabel}까지 이어진 조건이 보였어요. 이 조건을 내일도 재현할 수 있게 기록해둘게요.`;
  }
  return `좋아요. 오늘은 ${statusLabel}의 흐름으로 저장했어요. 한 문장이라도 남긴 것 자체가 내일 설계를 위한 데이터예요.`;
}

function createPatternFollowupReply(text: string) {
  const hasFriction = ["못", "막", "피곤", "늦", "누웠", "미뤘", "바빠", "까먹", "귀찮", "힘들"].some((keyword) =>
    text.includes(keyword),
  );
  const hasSupport = ["했", "됐다", "잘", "쉬웠", "도움", "성공", "시작", "끝"].some((keyword) => text.includes(keyword));

  if (hasFriction) {
    return "좋아요. 그 지점은 내일의 의지 문제가 아니라, 시작 비용이 올라가는 조건으로 기록해둘게요.";
  }
  if (hasSupport) {
    return "좋아요. 그 조건은 내일도 다시 써볼 수 있는 성공 단서로 기록해둘게요.";
  }
  return "좋아요. 오늘 패턴을 조금 더 선명하게 기록해둘게요.";
}

function formatTaskPatch(patch: HabitTaskPatch) {
  const items: string[] = [];
  if (patch.miniTask) items.push(`${elasticLevelLabels.mini}: ${patch.miniTask}`);
  if (patch.plusTask) items.push(`${elasticLevelLabels.plus}: ${patch.plusTask}`);
  if (patch.eliteTask) items.push(`${elasticLevelLabels.elite}: ${patch.eliteTask}`);
  return items.join("\n");
}

function mapProfileToData(profile: ElasticProfile): OnboardingData {
  return {
    lifeArea: profile.life_area ?? "",
    whyChange: profile.why_change ?? "",
    goalIdentityStatement: profile.identity_statement ?? "",
    failureSituation: profile.recent_failure_date ?? "",
    failureFeeling: profile.pre_breakdown_feeling ?? "",
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

function getBonusItems(levelCounts: { mini: number; plus: number; elite: number; notDone: number; noResponse: number }) {
  const bonuses: { label: string; points: number }[] = [];
  if (levelCounts.elite >= 10) bonuses.push({ label: "Elite 10회 이상", points: 3 });
  if (levelCounts.elite >= 15) bonuses.push({ label: "Elite 15회 이상", points: 3 });
  if (levelCounts.notDone === 0 && levelCounts.noResponse === 0 && levelCounts.mini + levelCounts.plus + levelCounts.elite >= 30) {
    bonuses.push({ label: "30일 모두 기록", points: 20 });
  }
  return bonuses;
}

function useTypewriter(value: string, speed = 30) {
  const [displayed, setDisplayed] = useState(value);
  const [done, setDone] = useState(true);
  const prev = useRef(value);

  useEffect(() => {
    if (value === prev.current) return;
    prev.current = value;
    if (!value) { setDisplayed(""); setDone(true); return; }
    setDisplayed("");
    setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(value.slice(0, i));
      if (i >= value.length) { clearInterval(id); setDone(true); }
    }, speed);
    return () => clearInterval(id);
  }, [value, speed]);

  return { displayed, done };
}

function TypedField({ value, empty, isIdentity = false }: { value: string; empty: React.ReactNode; isIdentity?: boolean }) {
  const { displayed, done } = useTypewriter(value, isIdentity ? 20 : 30);
  if (!value) return <>{empty}</>;
  return <>{displayed}{!done && <span className="goal-cursor">|</span>}</>;
}

function GoalPanel({ data, goalData, step }: { data: OnboardingData; goalData: GoalData; step: OnboardingStep }) {
  const goalFields: { label: string; value: string; active: boolean; isIdentity?: boolean }[] = [
    { label: "삶의 영역", value: goalData.lifeArea, active: step === "goal_area" },
    { label: "바꾸고 싶은 이유", value: goalData.whyChange, active: step === "goal_why" },
    { label: "정체성 문장", value: goalData.identityStatement, active: step === "goal_identity", isIdentity: true },
  ];

  const habitFields: { label: string; value: string; active: boolean; placeholder: string }[] = [
    { label: "어떤 행동", value: data.habitAction, active: step === "habit_action", placeholder: "예: 토익 LC 공부" },
    { label: "기간", value: data.habitPeriod, active: step === "habit_period", placeholder: "예: 4주" },
    { label: "빈도", value: data.habitFrequency, active: step === "habit_frequency", placeholder: "예: 주 5회" },
    { label: "언제", value: data.habitWhen, active: step === "habit_when", placeholder: "예: 저녁 식사 후" },
    { label: "얼마나", value: data.habitAmount, active: step === "habit_amount", placeholder: "예: 10분" },
  ];

  const patternFields: { label: string; value: string; active: boolean }[] = [
    { label: "최근 실패 상황", value: data.failureSituation, active: step === "failure_situation" },
    { label: "그때 든 생각/감정", value: data.failureFeeling, active: step === "failure_feeling" },
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
          <div key={field.label} className={`goal-field${field.active ? " goal-field-active" : ""}${field.isIdentity ? " goal-field-identity" : ""}`}>
            <span className="goal-field-label">{field.label}</span>
            <p className="goal-field-value">
              <TypedField
                value={field.value}
                isIdentity={field.isIdentity}
                empty={<span className="goal-empty-line" />}
              />
            </p>
          </div>
        ))}
      </div>

      <div className="goal-template goal-pattern-template">
        <p className="goal-section-label">나의 패턴</p>
        {patternFields.map((field) => (
          <div key={field.label} className={`goal-field${field.active ? " goal-field-active" : ""}`}>
            <span className="goal-field-label">{field.label}</span>
            <p className="goal-field-value">
              <TypedField value={field.value} empty={<span className="goal-empty-line" />} />
            </p>
          </div>
        ))}
      </div>

      <div className="goal-template goal-habit-template">
        <p className="goal-section-label">습관 목표</p>
        <div className="habit-fields-grid">
          {habitFields.map((field) => (
            <div key={field.label} className={`goal-field habit-field${field.active ? " goal-field-active" : ""}`}>
              <span className="goal-field-label">{field.label}</span>
              <p className="goal-field-value">
                <TypedField
                  value={field.value}
                  empty={<span className="goal-placeholder">{field.placeholder}</span>}
                />
              </p>
            </div>
          ))}
        </div>
        {(smartSentence || isHabitComplete) && (
          <div className="smart-sentence">
            <span className="goal-field-label">습관 목표 문장</span>
            <p>
              <TypedField value={smartSentence} empty="대화로 완성됩니다" isIdentity />
            </p>
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
