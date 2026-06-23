"use client";

import { FormEvent, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { LoadingState } from "@/components/LoadingState";
import { copy } from "@/lib/copy";
import { updateCheckInTime } from "@/lib/proof-store";
import { useProofSession } from "@/lib/use-proof-session";

export default function SettingsPage() {
  const { loading, userId, profile, error, refresh } = useProofSession();
  const [checkinTime, setCheckinTime] = useState(profile?.checkin_time ?? "21:00");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.checkin_time) {
      setCheckinTime(profile.checkin_time.slice(0, 5));
    }
  }, [profile?.checkin_time]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) {
      setMessage("먼저 로그인해주세요.");
      return;
    }

    setPending(true);
    setMessage(null);

    try {
      await updateCheckInTime(userId, checkinTime);
      await refresh();
      setMessage("알림 시간을 저장했어요.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "저장하지 못했어요.");
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
        <p className="eyebrow">Settings</p>
        <h1>{copy.settingsTitle}</h1>
        <p>저녁 회고 알림 시간과 카카오 나에게 보내기 연결을 관리합니다.</p>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <form className="form-stack" onSubmit={handleSubmit}>
        <label className="field">
          <span>저녁 회고 시간</span>
          <input
            type="time"
            value={checkinTime}
            onChange={(event) => setCheckinTime(event.target.value)}
            required
          />
        </label>
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? "저장하는 중" : "시간 저장하기"}
        </button>
        {message ? <p className="form-message">{message}</p> : null}
      </form>

      <section className="form-stack">
        <div className="section-heading">
          <h2>카카오 나에게 보내기</h2>
          <p>
            카카오 로그인을 연결하면 설정한 시간에 나와의 채팅방으로 저녁 회고 링크를 보낼 수 있습니다.
            연결하지 않은 사용자는 웹푸시 폴백 대상으로 남깁니다.
          </p>
        </div>
        <span className={`status-chip ${profile?.kakao_linked ? "done" : "pending"}`}>
          {profile?.kakao_linked ? "카카오 연결됨" : "카카오 연결 전"}
        </span>
        <a className="secondary-action no-margin" href={`/api/kakao/login?userId=${encodeURIComponent(userId ?? "")}`}>
          카카오로 연결하기
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      </section>
    </main>
  );
}
