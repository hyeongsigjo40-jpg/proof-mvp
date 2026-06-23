"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LoadingState } from "@/components/LoadingState";
import { copy, resultLabels } from "@/lib/copy";
import { formatDate, isThisWeek } from "@/lib/date";
import { getRecords } from "@/lib/proof-store";
import { useProofSession } from "@/lib/use-proof-session";
import type { RecordItem } from "@/types/proof";

export default function RecordPage() {
  const { loading, userId, error } = useProofSession();
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [recordError, setRecordError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!userId) {
        return;
      }

      try {
        setRecords(await getRecords(userId));
      } catch (caught) {
        setRecordError(caught instanceof Error ? caught.message : "기록을 불러오지 못했어요.");
      }
    }

    void load();
  }, [userId]);

  const weeklyStats = useMemo(() => {
    const weeklyRecords = records.filter((record) => isThisWeek(record.date));
    const completedCount = weeklyRecords.filter(
      (record) => record.check_in?.result === "done" || record.check_in?.result === "partial",
    ).length;
    const counts = {
      done: weeklyRecords.filter((record) => record.check_in?.result === "done").length,
      partial: weeklyRecords.filter((record) => record.check_in?.result === "partial").length,
      no_response: weeklyRecords.filter((record) => record.check_in?.result === "no_response").length,
      not_done: weeklyRecords.filter((record) => record.check_in?.result === "not_done").length,
    };
    return { total: weeklyRecords.length, completedCount, counts };
  }, [records]);

  if (loading) {
    return <LoadingState />;
  }

  return (
    <main className="page-shell">
      <section className="page-heading">
        <p className="eyebrow">A3 트랙레코드</p>
        <h1>{copy.recordTitle}</h1>
        <p>
          이번 주 {weeklyStats.total}번 중 {weeklyStats.completedCount}번 실행
        </p>
      </section>

      {error || recordError ? <p className="error-text">{error ?? recordError}</p> : null}

      {records.length > 0 ? (
        <section className="count-row" aria-label="이번 주 상태별 기록">
          <span>완료 {weeklyStats.counts.done}</span>
          <span>일부 {weeklyStats.counts.partial}</span>
          <span>응답 없음 {weeklyStats.counts.no_response}</span>
          <span>하지 않음 {weeklyStats.counts.not_done}</span>
        </section>
      ) : null}

      {records.length === 0 ? (
        <section className="empty-state">
          <p>{copy.emptyRecord}</p>
          <Link className="primary-button wide-button" href="/evening">
            저녁 회고로 가기
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>
      ) : (
        <div className="record-list">
          {records.map((record) => (
            <article className="record-item" key={record.id}>
              <div>
                <time>{formatDate(record.date)}</time>
                <p>{record.plan_text}</p>
                {record.minimum_plan_text ? <small>최소 버전: {record.minimum_plan_text}</small> : null}
                {record.check_in?.context_text ? <blockquote>{record.check_in.context_text}</blockquote> : null}
              </div>
              <span className={`status-chip ${record.check_in?.result ?? "pending"}`}>
                {record.check_in ? resultLabels[record.check_in.result] : "확인 전"}
              </span>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
