"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowUp, CalendarCheck, Check, Circle, Flame, MessageCircle, Minus, PencilLine, Target } from "lucide-react";
import { AuthPanel } from "@/components/AuthPanel";
import { LoadingState } from "@/components/LoadingState";
import { todayKey } from "@/lib/date";
import {
  getElasticCheckIns,
  getElasticProfile,
  saveElasticCheckIn,
  saveElasticProfile,
  updateElasticTasks,
} from "@/lib/elastic-store";
import type { ElasticCheckIn, ElasticCheckInStatus, ElasticProfile } from "@/lib/elastic-types";
import { useProofSession } from "@/lib/use-proof-session";

type ElasticLevel = "mini" | "plus" | "elite";
type CheckInStatus = ElasticCheckInStatus | "open";
type OnboardingStep =
  | "habit"
  | "motive"
  | "transition"
  | "failure_date"
  | "feeling"
  | "behavior"
  | "recovery"
  | "mini"
  | "plus"
  | "elite"
  | "vision"
  | "complete";

type Message = {
  role: "assistant" | "user";
  text: string;
};

type OnboardingData = {
  habitName: string;
  identityMotive: string;
  motiveSummary: string;
  recentFailureDate: string;
  preBreakdownFeeling: string;
  actualBreakdownBehavior: string;
  recoveryMethod: string;
  miniTask: string;
  plusTask: string;
  eliteTask: string;
  monthlyVision: string;
};

type DailyRecord = {
  day: number;
  status: CheckInStatus;
};

const emptyOnboarding: OnboardingData = {
  habitName: "",
  identityMotive: "",
  motiveSummary: "",
  recentFailureDate: "",
  preBreakdownFeeling: "",
  actualBreakdownBehavior: "",
  recoveryMethod: "",
  miniTask: "",
  plusTask: "",
  eliteTask: "",
  monthlyVision: "",
};

const selfNarrativeKeywords = ["의지", "한심", "원래 그런", "이상해", "못하는 사람", "의지력"];

const statusMeta = {
  mini: { label: "Mini", icon: Check },
  plus: { label: "Plus", icon: Check },
  elite: { label: "Elite", icon: Check },
  not_done: { label: "안함", icon: Circle },
  no_response: { label: "무응답", icon: Minus },
  open: { label: "열림", icon: PencilLine },
};

const initialMessages: Message[] = [{ role: "assistant", text: "지금 이루고 싶은 습관이 뭔가요?" }];

export default function Home() {
  const { loading, userId, error } = useProofSession();
  const [mode, setMode] = useState<"onboarding" | "daily">("onboarding");
  const [step, setStep] = useState<OnboardingStep>("habit");
  const [data, setData] = useState<OnboardingData>(emptyOnboarding);
  const [records, setRecords] = useState<DailyRecord[]>(createMonthRecords([]));
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

  useEffect(() => {
    async function load() {
      if (!userId) return;

      const [profile, checkIns] = await Promise.all([getElasticProfile(userId), getElasticCheckIns(userId)]);
      if (profile?.onboarding_completed_at) {
        const nextData = mapProfileToData(profile);
        setData(nextData);
        setNextMini(nextData.miniTask);
        setNextPlus(nextData.plusTask);
        setNextElite(nextData.eliteTask);
        setMode("daily");
        setStep("complete");
        setMessages([
          { role: "assistant", text: "오늘 체크인을 남겨주세요. 결과는 왼쪽 Elastic Habit Tracker에 저장됩니다." },
        ]);
      }

      setRecords(createMonthRecords(checkIns));
      setMiniFailureCount(countRecentMiniFailures(checkIns));
      const today = checkIns.find((checkIn) => checkIn.checkin_date === todayKey());
      if (today) {
        setSelectedCheckIn(today.result);
        setMemo(today.memo ?? "");
      }
    }

    void load();
  }, [userId]);

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

  async function handleTextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;

    setMessages((current) => [...current, { role: "user", text }]);
    setInput("");
    await advanceOnboarding(text);
  }

  async function advanceOnboarding(text: string) {
    if (step === "habit") {
      setData((current) => ({ ...current, habitName: text }));
      assistant("이걸 왜 만들고 싶으세요?");
      setStep("motive");
      return;
    }

    if (step === "motive") {
      setPending(true);
      const motiveSummary = await summarizeMotive(text);
      setData((current) => ({ ...current, identityMotive: text, motiveSummary }));
      assistant(createTransitionText(motiveSummary));
      setStep("transition");
      setPending(false);
      return;
    }

    if (step === "failure_date") {
      setData((current) => ({ ...current, recentFailureDate: text }));
      assistant("무너지기 직전, 기분이 어땠어요?");
      setStep("feeling");
      return;
    }

    if (step === "feeling") {
      setData((current) => ({ ...current, preBreakdownFeeling: text }));
      assistant("그때 실제로 뭘 했어요?");
      setStep("behavior");
      return;
    }

    if (step === "behavior") {
      setData((current) => ({ ...current, actualBreakdownBehavior: text }));
      assistant("그 다음엔 보통 어떻게 다시 시작해요?");
      setStep("recovery");
      return;
    }

    if (step === "recovery") {
      setData((current) => ({ ...current, recoveryMethod: text }));
      assistant(`${data.habitName || "이 습관"}을 세 단계로 나눠볼게요. Mini, 즉 최소 단위는 무엇으로 할까요?`);
      setStep("mini");
      return;
    }

    if (step === "mini") {
      setData((current) => ({ ...current, miniTask: text }));
      assistant("Plus, 즉 보통 단위는 무엇으로 할까요?");
      setStep("plus");
      return;
    }

    if (step === "plus") {
      setData((current) => ({ ...current, plusTask: text }));
      assistant("Elite, 즉 도전 단위는 무엇으로 할까요?");
      setStep("elite");
      return;
    }

    if (step === "elite") {
      setData((current) => ({ ...current, eliteTask: text }));
      assistant("이게 잘 되면, 한 달 뒤 뭐가 달라져 있을까요? 구체적이고 관찰 가능한 장면으로 적어주세요.");
      setStep("vision");
      return;
    }

    if (step === "vision") {
      const next = { ...data, monthlyVision: text };
      setData(next);
      setNextMini(next.miniTask);
      setNextPlus(next.plusTask);
      setNextElite(next.eliteTask);
      await persistProfile(next);
      assistant("저장했어요. 이제 일상 화면에는 한 달 뒤의 관찰 가능한 변화와 Mini/Plus/Elite만 두고 볼게요.");
      setStep("complete");
      setMode("daily");
    }
  }

  function continueAfterTransition() {
    assistant("최근에 못 지킨 날이 언제였어요?");
    setStep("failure_date");
  }

  function handleCheckIn(status: Exclude<CheckInStatus, "open" | "no_response">) {
    setSelectedCheckIn(status);
  }

  async function saveDailyCheckIn() {
    if (!selectedCheckIn || !userId || selectedCheckIn === "open") return;

    const hasSelfNarrative = selfNarrativeKeywords.some((keyword) => memo.includes(keyword));
    const saved = await saveElasticCheckIn({
      user_id: userId,
      result: selectedCheckIn,
      memo,
      self_narrative_detected: hasSelfNarrative,
    });
    applySavedCheckIn(saved);
    setMessages((current) => [
      ...current,
      { role: "user", text: createDailyNote(selectedCheckIn, memo) },
      ...(hasSelfNarrative
        ? [{ role: "assistant" as const, text: "기억하시죠, 오늘은 그 사람인지가 아니라 이 행동을 했는지만 보기로 했었죠" }]
        : []),
      { role: "assistant", text: "오늘 기록을 저장했어요. 이제 내일의 세 단계는 그대로 둘지 조정할지 확인해볼게요." },
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
    await updateElasticTasks(userId, nextTasks);
    setData((current) => ({
      ...current,
      miniTask: nextTasks.mini_task,
      plusTask: nextTasks.plus_task,
      eliteTask: nextTasks.elite_task,
    }));
    assistant("내일 계획을 Supabase에 저장했어요. Mini는 계속 가장 쉽게 시작할 수 있는 단위로 유지합니다.");
  }

  async function markNoResponse() {
    if (!userId) return;
    const saved = await saveElasticCheckIn({ user_id: userId, result: "no_response" });
    applySavedCheckIn(saved);
    assistant("응답 없음으로 구분해 저장했어요. 시스템이 임의로 하지 않음으로 판정하지 않습니다.");
  }

  async function persistProfile(nextData: OnboardingData) {
    if (!userId) return;
    await saveElasticProfile({
      user_id: userId,
      habit_name: nextData.habitName,
      identity_motive: nextData.identityMotive,
      motive_summary: nextData.motiveSummary,
      recent_failure_date: nextData.recentFailureDate || null,
      pre_breakdown_feeling: nextData.preBreakdownFeeling || null,
      actual_breakdown_behavior: nextData.actualBreakdownBehavior || null,
      recovery_method: nextData.recoveryMethod || null,
      mini_task: nextData.miniTask,
      plus_task: nextData.plusTask,
      elite_task: nextData.eliteTask,
      monthly_vision: nextData.monthlyVision,
      onboarding_completed_at: new Date().toISOString(),
    });
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

  return (
    <main className="tracker-workspace">
      <section className="tracker-panel" aria-label="Elastic habit tracker">
        <div className="tracker-header">
          <div>
            <p className="eyebrow">Elastic Habit Tracker</p>
            <h1>{data.habitName || "습관 설정 중"}</h1>
          </div>
          <div className="tracker-score">
            <strong>{completedCount}</strong>
            <span>Plus/Elite 완료</span>
          </div>
        </div>

        <section className="tracker-band goal-band">
          <div className="band-title">
            <Target size={18} aria-hidden="true" />
            <span>한 달 뒤 관찰 가능한 변화</span>
          </div>
          <p>{data.monthlyVision || "온보딩 마지막 답변이 끝나면 이곳에 고정됩니다."}</p>
        </section>

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

      <aside className="chat-panel" aria-label="Proof onboarding and check-in">
        <div className="chat-title">
          <MessageCircle size={18} aria-hidden="true" />
          <div>
            <strong>{mode === "onboarding" ? "Proof Onboarding" : "Daily Check-in"}</strong>
            <span>{mode === "onboarding" ? "고정 5단계 시나리오" : "Supabase 저장 연결됨"}</span>
          </div>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        {!userId ? (
          <div className="daily-panel">
            <AuthPanel />
          </div>
        ) : (
          <>
            <div className="chat-log">
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
                onContinue={continueAfterTransition}
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
          </>
        )}
      </aside>
    </main>
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
  if (step === "transition") {
    return (
      <button className="primary-button" onClick={onContinue} type="button">
        최근 실패 구체화로
      </button>
    );
  }

  return (
    <form className="chat-composer" onSubmit={onSubmit}>
      <input
        aria-label="온보딩 답변"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder={pending ? "GPT가 동기를 요약하는 중" : step === "complete" ? "온보딩 완료" : "답변을 입력하세요"}
        disabled={step === "complete" || pending}
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
        <strong>오늘 {data.habitName} 중 뭘 했어요?</strong>
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

async function summarizeMotive(identityMotive: string) {
  try {
    const response = await fetch("/api/elastic/summarize-motive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity_motive: identityMotive }),
    });
    if (!response.ok) throw new Error("Failed");
    const data = (await response.json()) as { summary: string };
    return data.summary;
  } catch {
    return identityMotive.length > 24 ? `${identityMotive.slice(0, 24)}...` : identityMotive;
  }
}

function createTransitionText(motiveSummary: string) {
  return `그러니까 ${motiveSummary}이 진짜 이유시네요. 그거 충분히 이해돼요.
근데 그걸 매일 도달했는지로 재려고 하면 오히려 매일 흔들릴 수 있어요.
그래서 지금부터는 '그런 사람인지'가 아니라 '오늘 이 행동을 했는지'만 보려고 해요.`;
}

function createDailyNote(status: CheckInStatus, memo: string) {
  const statusText = status === "not_done" ? "안함" : status === "no_response" ? "무응답" : status;
  return memo ? `${statusText}: ${memo}` : statusText;
}

function mapProfileToData(profile: ElasticProfile): OnboardingData {
  return {
    habitName: profile.habit_name,
    identityMotive: profile.identity_motive,
    motiveSummary: profile.motive_summary ?? "",
    recentFailureDate: profile.recent_failure_date ?? "",
    preBreakdownFeeling: profile.pre_breakdown_feeling ?? "",
    actualBreakdownBehavior: profile.actual_breakdown_behavior ?? "",
    recoveryMethod: profile.recovery_method ?? "",
    miniTask: profile.mini_task,
    plusTask: profile.plus_task,
    eliteTask: profile.elite_task,
    monthlyVision: profile.monthly_vision,
  };
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
