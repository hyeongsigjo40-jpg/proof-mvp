"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, X } from "lucide-react";
import { LoadingState } from "@/components/LoadingState";
import { PatternNotice } from "@/components/PatternNotice";
import { copy, resultLabels } from "@/lib/copy";
import { tomorrowKey } from "@/lib/date";
import {
  ensureNoResponseForPastPlans,
  getCheckInForPlan,
  getLatestInsight,
  getTodayPlan,
  getTomorrowPlan,
  saveCheckIn,
  savePlan,
} from "@/lib/proof-store";
import { useProofSession } from "@/lib/use-proof-session";
import type { CheckIn, CheckInResult, DailyPlan, PatternInsight } from "@/types/proof";

const resultOptions = [
  { value: "done", icon: Check },
  { value: "partial", icon: Minus },
  { value: "not_done", icon: X },
] satisfies { value: Exclude<CheckInResult, "no_response">; icon: typeof Check }[];

export default function EveningPage() {
  const router = useRouter();
  const { loading, userId, profile, error } = useProofSession();
  const [todayPlan, setTodayPlan] = useState<DailyPlan | null>(null);
  const [tomorrowPlan, setTomorrowPlan] = useState<DailyPlan | null>(null);
  const [todayCheckIn, setTodayCheckIn] = useState<CheckIn | null>(null);
  const [insight, setInsight] = useState<PatternInsight | null>(null);
  const [result, setResult] = useState<Exclude<CheckInResult, "no_response">>("done");
  const [contextText, setContextText] = useState("");
  const [planText, setPlanText] = useState("");
  const [minimumPlanText, setMinimumPlanText] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && userId && !profile) {
      router.replace("/onboarding");
    }
  }, [loading, profile, router, userId]);

  useEffect(() => {
    async function load() {
      if (!userId || !profile) {
        return;
      }

      await ensureNoResponseForPastPlans(userId);
      const [currentPlan, nextPlan, latestInsight] = await Promise.all([
        getTodayPlan(userId),
        getTomorrowPlan(userId),
        getLatestInsight(userId),
      ]);
      setTodayPlan(currentPlan);
      setTomorrowPlan(nextPlan);
      setInsight(latestInsight);
      setPlanText(nextPlan?.plan_text ?? "");
      setMinimumPlanText(nextPlan?.minimum_plan_text ?? "");

      if (currentPlan) {
        setTodayCheckIn(await getCheckInForPlan(currentPlan.id));
      }
    }

    void load();
  }, [profile, userId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) {
      setFormError("먼저 로그인해주세요.");
      return;
    }

    setPending(true);
    setFormError(null);

    try {
      if (todayPlan && !todayCheckIn) {
        const savedCheckIn = await saveCheckIn(userId, {
          plan_id: todayPlan.id,
          result,
          context_text: result === "done" ? "" : contextText,
        });
        setTodayCheckIn(savedCheckIn);
      }

      const savedPlan = await savePlan(userId, {
        date: tomorrowKey(),
        plan_text: planText.trim(),
        minimum_plan_text: minimumPlanText.trim(),
      });
      setTomorrowPlan(savedPlan);
      router.push("/record");
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "저장하지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return <LoadingState />;
  }

  return (
    <main className="page-shell">
      <section className="page-heading">
        <p className="eyebrow">저녁 회고</p>
        <h1>{copy.eveningTitle}</h1>
        <p>
          {(profile?.checkin_time ?? "21:00").slice(0, 5)}에 오늘을 확인하고, 같은 흐름에서 내일의 한 줄을
          정합니다.
        </p>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <form className="form-stack" onSubmit={handleSubmit}>
        <section className="flow-section">
          <div className="section-heading">
            <h2>1. 오늘 확인</h2>
            <p>{todayPlan ? todayPlan.plan_text : "오늘 확인할 계획이 없어요. 내일 계획부터 정해도 됩니다."}</p>
          </div>

          {todayPlan?.minimum_plan_text ? <small>최소 버전: {todayPlan.minimum_plan_text}</small> : null}

          {todayPlan && todayCheckIn ? (
            <span className={`status-chip ${todayCheckIn.result}`}>{resultLabels[todayCheckIn.result]}</span>
          ) : null}

          {todayPlan && !todayCheckIn ? (
            <>
              <fieldset className="field">
                <legend>결과</legend>
                <div className="result-grid">
                  {resultOptions.map((option) => {
                    const Icon = option.icon;
                    return (
                      <label
                        className={result === option.value ? "result-card selected" : "result-card"}
                        key={option.value}
                      >
                        <input
                          checked={result === option.value}
                          name="result"
                          onChange={() => setResult(option.value)}
                          type="radio"
                        />
                        <Icon size={20} aria-hidden="true" />
                        <span>{resultLabels[option.value]}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {result !== "done" ? (
                <label className="field">
                  <span>{copy.contextQuestion}</span>
                  <textarea
                    value={contextText}
                    onChange={(event) => setContextText(event.target.value)}
                    placeholder={copy.contextPlaceholder}
                    rows={3}
                  />
                </label>
              ) : null}
            </>
          ) : null}
        </section>

        <PatternNotice insight={insight} />

        <section className="flow-section">
          <div className="section-heading">
            <h2>2. 내일 계획</h2>
            <p>시간, 장소, 행동량이 보이게 한 문장으로 적습니다.</p>
          </div>

          <label className="field">
            <span>계획 한 줄</span>
            <textarea
              required
              value={planText}
              onChange={(event) => setPlanText(event.target.value)}
              placeholder={copy.planPlaceholder}
              rows={4}
            />
          </label>

          <label className="field">
            <span>{copy.minimumPlanLabel}</span>
            <input
              value={minimumPlanText}
              onChange={(event) => setMinimumPlanText(event.target.value)}
              placeholder={copy.minimumPlanPlaceholder}
            />
          </label>
        </section>

        {formError ? <p className="error-text">{formError}</p> : null}
        <button className="primary-button" disabled={pending || !planText.trim()} type="submit">
          {pending ? "저장하는 중" : tomorrowPlan ? "저녁 회고 다시 저장하기" : "저녁 회고 저장하기"}
        </button>
      </form>
    </main>
  );
}
