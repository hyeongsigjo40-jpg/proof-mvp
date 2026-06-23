"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Minus, X } from "lucide-react";
import { LoadingState } from "@/components/LoadingState";
import { copy, resultLabels } from "@/lib/copy";
import { getPendingCheckInPlan, saveCheckIn } from "@/lib/proof-store";
import { useProofSession } from "@/lib/use-proof-session";
import type { CheckInResult, DailyPlan } from "@/types/proof";

const resultOptions = [
  { value: "done", icon: Check },
  { value: "partial", icon: Minus },
  { value: "not_done", icon: X },
] satisfies { value: CheckInResult; icon: typeof Check }[];

export default function CheckInPage() {
  const router = useRouter();
  const { loading, userId, profile, error } = useProofSession();
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [result, setResult] = useState<CheckInResult>("done");
  const [contextText, setContextText] = useState("");
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

      setPlan(await getPendingCheckInPlan(userId));
    }

    void load();
  }, [profile, userId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !plan) {
      return;
    }

    setPending(true);
    setFormError(null);

    try {
      await saveCheckIn(userId, {
        plan_id: plan.id,
        result,
        context_text: result === "done" ? "" : contextText,
      });
      router.push("/record");
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "기록하지 못했어요.");
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
        <p className="eyebrow">A9 체크인</p>
        <h1>{copy.checkInTitle}</h1>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      {!plan ? (
        <section className="empty-state">
          <p>{copy.missedPlan}</p>
          <Link className="primary-button wide-button" href="/plan">
            계획하러 가기
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>
      ) : (
        <form className="form-stack" onSubmit={handleSubmit}>
          <article className="plan-summary">
            <span>오늘의 계획</span>
            <p>{plan.plan_text}</p>
            {plan.minimum_plan_text ? <small>최소 버전: {plan.minimum_plan_text}</small> : null}
          </article>

          <fieldset className="field">
            <legend>결과</legend>
            <div className="result-grid">
              {resultOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <label className={result === option.value ? "result-card selected" : "result-card"} key={option.value}>
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

          {formError ? <p className="error-text">{formError}</p> : null}
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? "기록하는 중" : "기록하기"}
          </button>
        </form>
      )}
    </main>
  );
}
