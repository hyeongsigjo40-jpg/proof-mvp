"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AuthPanel } from "@/components/AuthPanel";
import { LoadingState } from "@/components/LoadingState";
import { copy } from "@/lib/copy";
import { useProofSession } from "@/lib/use-proof-session";

export default function Home() {
  const { loading, userId, profile, error } = useProofSession();

  if (loading) {
    return <LoadingState />;
  }

  return (
    <main className="page-shell home-shell">
      <section className="hero">
        <p className="eyebrow">Proof MVP</p>
        <h1>{copy.appSummary}</h1>
        <p>
          처음에는 세 가지만 입력하고, 매일 한 줄 계획과 짧은 확인을 이어갑니다. 기록이 쌓이면 자주
          흔들리는 상황을 다음 계획에 반영합니다.
        </p>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {!userId ? <AuthPanel /> : null}

      {userId ? (
        <Link className="primary-button wide-button" href={profile ? "/evening" : "/onboarding"}>
          {profile ? "저녁 회고로" : "세 가지 입력하기"}
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      ) : null}
    </main>
  );
}
