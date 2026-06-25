"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { LoadingState } from "@/components/LoadingState";
import { formatDate } from "@/lib/date";
import { getElasticCheckIns, LIVE_ELASTIC_SCOPE } from "@/lib/elastic-store";
import type { ElasticCheckIn, ElasticCheckInStatus } from "@/lib/elastic-types";
import { useProofSession } from "@/lib/use-proof-session";

type ParsedMemo = {
  fallback: string;
  patterns: {
    user: string;
    assistant: string;
  }[];
};

const statusLabels: Record<ElasticCheckInStatus, string> = {
  mini: "Mini",
  plus: "Plus",
  elite: "Elite",
  not_done: "기록만함",
  no_response: "무응답",
};

export default function RecordPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RecordNotebook />
    </Suspense>
  );
}

function RecordNotebook() {
  const { loading, userId, error } = useProofSession();
  const searchParams = useSearchParams();
  const selectedDate = searchParams.get("date");
  const selectedView = searchParams.get("view");
  const showingScorecard = selectedView === "scorecard";
  const scope = searchParams.get("scope") || LIVE_ELASTIC_SCOPE;
  const trackerHref = scope === LIVE_ELASTIC_SCOPE ? "/" : `/?debug=1&scope=${encodeURIComponent(scope)}`;
  const [checkIns, setCheckIns] = useState<ElasticCheckIn[]>([]);
  const [recordError, setRecordError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!userId) return;

      try {
        setCheckIns(await getElasticCheckIns(userId, scope));
      } catch (caught) {
        setRecordError(caught instanceof Error ? caught.message : "기록을 불러오지 못했어요.");
      }
    }

    void load();
  }, [scope, userId]);

  const sortedCheckIns = useMemo(
    () => [...checkIns].sort((a, b) => b.checkin_date.localeCompare(a.checkin_date)),
    [checkIns],
  );
  const selectedCheckIn = useMemo(
    () =>
      sortedCheckIns.find((checkIn) => checkIn.checkin_date === selectedDate) ??
      sortedCheckIns[0] ??
      null,
    [selectedDate, sortedCheckIns],
  );
  const selectedMemo = useMemo(() => parseCheckInMemo(selectedCheckIn?.memo ?? null), [selectedCheckIn]);
  const scorecard = useMemo(() => createRecordScorecard(checkIns), [checkIns]);

  if (loading) return <LoadingState />;

  return (
    <main className="page-shell record-notebook-page">
      <section className="page-heading record-notebook-heading">
        <div>
          <p className="eyebrow">Habit Notebook</p>
          <h1>습관 기록장</h1>
          <p>날짜별로 남긴 선택, 패턴, Proof 응답을 메모처럼 다시 봅니다.</p>
        </div>
        <Link className="secondary-action" href={trackerHref}>
          <ArrowLeft size={17} aria-hidden="true" />
          트래커로
        </Link>
      </section>

      {error || recordError ? <p className="error-text">{error ?? recordError}</p> : null}

      {sortedCheckIns.length === 0 ? (
        <section className="empty-state">
          <p>아직 저장된 습관 기록이 없습니다.</p>
          <Link className="primary-button wide-button" href={trackerHref}>
            오늘 체크인으로 가기
          </Link>
        </section>
      ) : (
          <section className="record-notebook">
            <aside className="record-date-list" aria-label="날짜별 습관 기록">
              <Link
                className={showingScorecard ? "record-date-row active" : "record-date-row"}
                href={`/record?view=scorecard&scope=${encodeURIComponent(scope)}`}
              >
                <span>Scorecard</span>
                <strong className="status-chip score">{scorecard.totalScore}점</strong>
              </Link>
              {sortedCheckIns.map((checkIn) => (
                <Link
                  className={!showingScorecard && checkIn.checkin_date === selectedCheckIn?.checkin_date ? "record-date-row active" : "record-date-row"}
                  href={`/record?date=${checkIn.checkin_date}&scope=${encodeURIComponent(scope)}`}
                  key={checkIn.id}
                >
                  <span>{formatDate(checkIn.checkin_date)}</span>
                  <strong className={`status-chip ${checkIn.result}`}>{statusLabels[checkIn.result]}</strong>
                </Link>
              ))}
            </aside>

            {showingScorecard ? (
              <article className="record-note">
                <header className="record-note-header">
                  <div>
                    <p className="eyebrow">Monthly Score</p>
                    <h2>Scorecard</h2>
                  </div>
                  <span className="status-chip score">{scorecard.totalScore}점</span>
                </header>
                <section className="elastic-scorecard" aria-label="월간 스코어카드">
                  <div className="scorecard-title">Scorecard</div>
                  <div className="scorecard-columns">
                    <section>
                      <span>Counts</span>
                      <div className="score-counts">
                        <strong className="mini-count">Mini {scorecard.mini}</strong>
                        <strong className="plus-count">Plus {scorecard.plus}</strong>
                        <strong className="elite-count">Elite {scorecard.elite}</strong>
                      </div>
                    </section>
                    <section>
                      <span>Base Scores</span>
                      <p>
                        {scorecard.mini} + ({scorecard.plus} x 2) + ({scorecard.elite} x 3) = <strong>{scorecard.baseScore}</strong>
                      </p>
                    </section>
                    <section>
                      <span>Bonuses</span>
                      {scorecard.bonuses.length ? (
                        <ul>
                          {scorecard.bonuses.map((item) => (
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
                        {scorecard.baseScore} + {scorecard.bonusScore} = <strong>{scorecard.totalScore}</strong>
                      </p>
                    </section>
                  </div>
                </section>
              </article>
            ) : selectedCheckIn ? (
              <article className="record-note">
                <header className="record-note-header">
                  <div>
                    <p className="eyebrow">Daily Note</p>
                    <h2>{formatDate(selectedCheckIn.checkin_date)}</h2>
                  </div>
                  <span className={`status-chip ${selectedCheckIn.result}`}>{statusLabels[selectedCheckIn.result]}</span>
                </header>

                {selectedMemo.patterns.length ? (
                  <div className="record-note-body">
                    {selectedMemo.patterns.map((pattern, index) => (
                      <section className="record-note-block" key={`${pattern.user}-${index}`}>
                        <div className="record-note-label">
                          <BookOpen size={16} aria-hidden="true" />
                          <span>오늘의 패턴</span>
                        </div>
                        <p>{pattern.user}</p>
                        {pattern.assistant ? (
                          <>
                            <div className="record-note-label proof">
                              <span>Proof 응답</span>
                            </div>
                            <p>{pattern.assistant}</p>
                          </>
                        ) : null}
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="record-note-empty">{selectedMemo.fallback || "이 날짜에는 세부 메모가 없습니다."}</p>
                )}
              </article>
            ) : null}
          </section>
      )}
    </main>
  );
}

function parseCheckInMemo(memo: string | null): ParsedMemo {
  if (!memo) return { fallback: "", patterns: [] };

  const lines = memo.split("\n").map((line) => line.trim()).filter(Boolean);
  const patterns: ParsedMemo["patterns"] = [];

  for (const line of lines) {
    const patternMatch = line.match(/^\[패턴 \d+\]\s*(.*)$/);
    if (patternMatch) {
      patterns.push({ user: patternMatch[1] ?? "", assistant: "" });
      continue;
    }

    const replyMatch = line.match(/^\[코치 응답 \d+\]\s*(.*)$/);
    if (replyMatch) {
      const last = patterns.at(-1);
      if (last) last.assistant = replyMatch[1] ?? "";
    }
  }

  return {
    fallback: lines.filter((line) => !line.startsWith("[오늘의 선택]")).join("\n"),
    patterns,
  };
}

function createRecordScorecard(checkIns: ElasticCheckIn[]) {
  const mini = checkIns.filter((checkIn) => checkIn.result === "mini").length;
  const plus = checkIns.filter((checkIn) => checkIn.result === "plus").length;
  const elite = checkIns.filter((checkIn) => checkIn.result === "elite").length;
  const notDone = checkIns.filter((checkIn) => checkIn.result === "not_done").length;
  const noResponse = checkIns.filter((checkIn) => checkIn.result === "no_response").length;
  const baseScore = mini + plus * 2 + elite * 3;
  const bonuses = getRecordBonusItems({ mini, plus, elite, notDone, noResponse });
  const bonusScore = bonuses.reduce((sum, item) => sum + item.points, 0);

  return {
    mini,
    plus,
    elite,
    baseScore,
    bonuses,
    bonusScore,
    totalScore: baseScore + bonusScore,
  };
}

function getRecordBonusItems(levelCounts: { mini: number; plus: number; elite: number; notDone: number; noResponse: number }) {
  const bonuses: { label: string; points: number }[] = [];
  if (levelCounts.elite >= 10) bonuses.push({ label: "Elite 10회 이상", points: 3 });
  if (levelCounts.elite >= 15) bonuses.push({ label: "Elite 15회 이상", points: 3 });
  if (levelCounts.notDone === 0 && levelCounts.noResponse === 0 && levelCounts.mini + levelCounts.plus + levelCounts.elite >= 30) {
    bonuses.push({ label: "30일 모두 기록", points: 20 });
  }
  return bonuses;
}
