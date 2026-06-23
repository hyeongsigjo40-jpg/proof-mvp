"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { LoadingState } from "@/components/LoadingState";
import { PatternNotice } from "@/components/PatternNotice";
import { copy } from "@/lib/copy";
import { getLatestInsight, getTodayPlan, savePlan } from "@/lib/proof-store";
import { useProofSession } from "@/lib/use-proof-session";
import type { DailyPlan, PatternInsight } from "@/types/proof";

export default function PlanPage() {
  const router = useRouter();
  const { loading, userId, profile, error } = useProofSession();
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [insight, setInsight] = useState<PatternInsight | null>(null);
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

      const [todayPlan, latestInsight] = await Promise.all([getTodayPlan(userId), getLatestInsight(userId)]);
      setPlan(todayPlan);
      setInsight(latestInsight);
      setPlanText(todayPlan?.plan_text ?? "");
      setMinimumPlanText(todayPlan?.minimum_plan_text ?? "");
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
      const saved = await savePlan(userId, {
        plan_text: planText.trim(),
        minimum_plan_text: minimumPlanText.trim(),
      });
      setPlan(saved);
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
        <p className="eyebrow">A1 계획</p>
        <h1>{copy.planTitle}</h1>
        <p>{profile?.habit_name ? `지금 다루는 습관: ${profile.habit_name}` : "오늘의 한 줄을 정합니다."}</p>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      <PatternNotice insight={insight} />

      {profile?.goal_picture || profile?.failure_picture || profile?.action_code?.length ? (
        <section className="coach-result compact">
          {profile.goal_picture ? (
            <>
              <h3>목표 그림</h3>
              <p>{profile.goal_picture}</p>
            </>
          ) : null}
          {profile.failure_picture ? (
            <>
              <h3>무너지는 그림</h3>
              <p>{profile.failure_picture}</p>
            </>
          ) : null}
          {profile.action_code?.length ? (
            <>
              <h3>행동 강령</h3>
              <ul>
                {profile.action_code.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      <form className="form-stack" onSubmit={handleSubmit}>
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

        {formError ? <p className="error-text">{formError}</p> : null}
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? "저장하는 중" : plan ? "계획 다시 저장하기" : "계획 저장하기"}
        </button>
      </form>

      {plan ? (
        <Link className="secondary-action" href="/check-in">
          체크인으로 이동
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      ) : null}
    </main>
  );
}
