"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/LoadingState";
import type { CoachAnswer, CoachQuestionResponse, CoachSynthesisResponse } from "@/lib/coach-schema";
import { copy } from "@/lib/copy";
import { saveProfile } from "@/lib/proof-store";
import { useProofSession } from "@/lib/use-proof-session";
import type { CoachQuestion, CoachSynthesis } from "@/types/proof";

const breakdownOptions = ["아침 기상 직후", "저녁 퇴근·하교 후", "마감 직전", "기타"];

export default function OnboardingPage() {
  const router = useRouter();
  const { loading, userId, profile, error } = useProofSession();
  const [habitName, setHabitName] = useState("");
  const [context, setContext] = useState(breakdownOptions[0]);
  const [customContext, setCustomContext] = useState("");
  const [behavior, setBehavior] = useState("");
  const [questions, setQuestions] = useState<CoachQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [synthesis, setSynthesis] = useState<CoachSynthesis | null>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && profile) {
      router.replace("/plan");
    }
  }, [loading, profile, router]);

  const baseInput = {
    habit_name: habitName.trim(),
    usual_breakdown_context: context === "기타" ? customContext.trim() : context,
    usual_breakdown_behavior: behavior.trim(),
  };

  async function handleGenerateQuestions() {
    setPending(true);
    setFormError(null);
    setSynthesis(null);

    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "questions", baseInput }),
      });

      if (!response.ok) {
        throw new Error("질문을 만들지 못했어요.");
      }

      const data = (await response.json()) as CoachQuestionResponse;
      setQuestions(data.questions);
      setAnswers(Object.fromEntries(data.questions.map((question) => [question.id, ""])));
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "질문을 만들지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  async function handleGenerateSynthesis() {
    setPending(true);
    setFormError(null);

    try {
      const coachAnswers: CoachAnswer[] = questions.map((question) => ({
        question_id: question.id,
        question: question.label,
        answer: answers[question.id]?.trim() ?? "",
      }));
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "synthesis", baseInput, answers: coachAnswers }),
      });

      if (!response.ok) {
        throw new Error("행동 강령을 만들지 못했어요.");
      }

      setSynthesis((await response.json()) as CoachSynthesisResponse);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "행동 강령을 만들지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) {
      setFormError("먼저 로그인해주세요.");
      return;
    }

    if (!synthesis) {
      setFormError("행동 강령을 먼저 만들어주세요.");
      return;
    }

    setPending(true);
    setFormError(null);

    try {
      await saveProfile(userId, {
        ...baseInput,
        ...synthesis,
      });
      router.push("/plan");
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
        <p className="eyebrow">Layer 0</p>
        <h1>{copy.onboardingTitle}</h1>
        <p>{copy.onboardingDescription}</p>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <form className="form-stack" onSubmit={handleSubmit}>
        <label className="field">
          <span>{copy.habitLabel}</span>
          <input
            required
            value={habitName}
            onChange={(event) => setHabitName(event.target.value)}
            placeholder={copy.habitPlaceholder}
          />
        </label>

        <fieldset className="field">
          <legend>{copy.breakdownContextLabel}</legend>
          <div className="segmented-options">
            {breakdownOptions.map((option) => (
              <label className={context === option ? "option-pill selected" : "option-pill"} key={option}>
                <input
                  checked={context === option}
                  name="context"
                  onChange={() => setContext(option)}
                  type="radio"
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {context === "기타" ? (
          <label className="field">
            <span>기타 상황</span>
            <input
              required
              value={customContext}
              onChange={(event) => setCustomContext(event.target.value)}
              placeholder="예: 수업 사이 공강"
            />
          </label>
        ) : null}

        <label className="field">
          <span>{copy.breakdownBehaviorLabel}</span>
          <input
            required
            value={behavior}
            onChange={(event) => setBehavior(event.target.value)}
            placeholder={copy.breakdownBehaviorPlaceholder}
          />
        </label>

        {formError ? <p className="error-text">{formError}</p> : null}
        <button
          className="secondary-action no-margin"
          disabled={pending || !habitName.trim() || !behavior.trim() || (context === "기타" && !customContext.trim())}
          onClick={handleGenerateQuestions}
          type="button"
        >
          {pending && questions.length === 0 ? "만드는 중" : copy.coachQuestionsButton}
        </button>

        {questions.length > 0 ? (
          <section className="coach-section">
            <div className="section-heading">
              <h2>구체 질문</h2>
              <p>목적, 목표, 실패 장면을 행동으로 볼 수 있게 좁힙니다.</p>
            </div>
            {questions.map((question) => (
              <label className="field" key={question.id}>
                <span>{question.label}</span>
                <small>{question.helper}</small>
                <textarea
                  required
                  rows={3}
                  value={answers[question.id] ?? ""}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }
                  placeholder={question.placeholder}
                />
              </label>
            ))}
            <button
              className="secondary-action no-margin"
              disabled={pending || questions.some((question) => !answers[question.id]?.trim())}
              onClick={handleGenerateSynthesis}
              type="button"
            >
              {pending && questions.length > 0 ? "만드는 중" : copy.coachSynthesisButton}
            </button>
          </section>
        ) : null}

        {synthesis ? (
          <section className="coach-result">
            <h2>행동 강령</h2>
            <h3>목표 그림</h3>
            <p>{synthesis.goal_picture}</p>
            <h3>무너지는 그림</h3>
            <p>{synthesis.failure_picture}</p>
            <h3>행동</h3>
            <ul>
              {synthesis.action_code.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <h3>피드백 루프</h3>
            <p>{synthesis.feedback_loop}</p>
          </section>
        ) : null}

        <button className="primary-button" disabled={pending || !synthesis} type="submit">
          {pending && synthesis ? "저장하는 중" : "저장하고 계획하기"}
        </button>
      </form>
    </main>
  );
}
