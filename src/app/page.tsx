"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  ArrowUp,
  CalendarCheck,
  Check,
  Circle,
  Flame,
  MessageCircle,
  Minus,
  PencilLine,
  Target,
} from "lucide-react";

type RecordStatus = "done" | "partial" | "not_done" | "open";

type TrackerState = {
  habit: string;
  goal: string;
  normalAction: string;
  minimumAction: string;
  patterns: string[];
  todayStatus: RecordStatus;
  todayNote: string;
  records: RecordStatus[];
};

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
};

const initialTracker: TrackerState = {
  habit: "아직 정해지지 않음",
  goal: "대화에서 목표가 잡히면 여기에 표시됩니다.",
  normalAction: "정상 버전",
  minimumAction: "최소 버전",
  patterns: [],
  todayStatus: "open",
  todayNote: "",
  records: ["done", "partial", "open", "open", "open", "open", "open"],
};

const initialMessages: ChatMessage[] = [
  {
    role: "assistant",
    text: "요즘 만들고 싶은 습관이나 바꾸고 싶은 하루의 장면이 있어요?",
  },
];

const quickReplies = [
  "토익 공부를 해야 하는데 자꾸 쇼츠 봐",
  "저녁 8시에 RC 10문제, 최소는 3문제",
  "오늘은 3문제만 했어",
  "못 했어. 침대에서 쇼츠 봤어",
];

const statusMeta = {
  done: { label: "완료", icon: Check },
  partial: { label: "일부", icon: Minus },
  not_done: { label: "하지 않음", icon: Circle },
  open: { label: "열림", icon: PencilLine },
};

export default function Home() {
  const [tracker, setTracker] = useState<TrackerState>(initialTracker);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");

  const completionCount = useMemo(
    () => tracker.records.filter((record) => record === "done" || record === "partial").length,
    [tracker.records],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage(input);
  }

  function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (!text) {
      return;
    }

    const nextTracker = updateTrackerFromText(tracker, text);
    setTracker(nextTracker);
    setMessages((current) => [
      ...current,
      { role: "user", text },
      { role: "assistant", text: createAssistantReply(nextTracker, text) },
    ]);
    setInput("");
  }

  return (
    <main className="tracker-workspace">
      <section className="tracker-panel" aria-label="Elastic habit tracker">
        <div className="tracker-header">
          <div>
            <p className="eyebrow">Elastic Habit Tracker</p>
            <h1>{tracker.habit}</h1>
          </div>
          <div className="tracker-score">
            <strong>{completionCount}</strong>
            <span>이번 주 실행</span>
          </div>
        </div>

        <section className="tracker-band goal-band">
          <div className="band-title">
            <Target size={18} aria-hidden="true" />
            <span>목표 그림</span>
          </div>
          <p>{tracker.goal}</p>
        </section>

        <div className="elastic-grid">
          <section className="tracker-tile">
            <span>정상 버전</span>
            <strong>{tracker.normalAction}</strong>
          </section>
          <section className="tracker-tile">
            <span>최소 버전</span>
            <strong>{tracker.minimumAction}</strong>
          </section>
        </div>

        <section className="tracker-band">
          <div className="band-title">
            <Flame size={18} aria-hidden="true" />
            <span>자주 흔들리는 장면</span>
          </div>
          <div className="pattern-list">
            {tracker.patterns.length ? (
              tracker.patterns.map((pattern) => <span key={pattern}>{pattern}</span>)
            ) : (
              <span>대화에서 발견되면 추가됩니다</span>
            )}
          </div>
        </section>

        <section className="today-strip">
          <div>
            <div className="band-title">
              <CalendarCheck size={18} aria-hidden="true" />
              <span>오늘</span>
            </div>
            <p>{tracker.todayNote || "체크인 답변이 들어오면 오늘 기록이 바뀝니다."}</p>
          </div>
          <span className={`tracker-status ${tracker.todayStatus}`}>{statusMeta[tracker.todayStatus].label}</span>
        </section>

        <section className="week-grid" aria-label="이번 주 기록">
          {tracker.records.map((record, index) => {
            const Icon = statusMeta[record].icon;
            return (
              <div className={`day-cell ${record}`} key={`${record}-${index}`}>
                <span>{["월", "화", "수", "목", "금", "토", "일"][index]}</span>
                <Icon size={17} aria-hidden="true" />
              </div>
            );
          })}
        </section>
      </section>

      <aside className="chat-panel" aria-label="AI coach chat">
        <div className="chat-title">
          <MessageCircle size={18} aria-hidden="true" />
          <div>
            <strong>Proof Coach</strong>
            <span>대화가 트래커를 채웁니다</span>
          </div>
        </div>

        <div className="chat-log">
          {messages.map((message, index) => (
            <div className={`chat-bubble ${message.role}`} key={`${message.role}-${index}`}>
              {message.text}
            </div>
          ))}
        </div>

        <div className="quick-replies">
          {quickReplies.map((reply) => (
            <button key={reply} onClick={() => sendMessage(reply)} type="button">
              {reply}
            </button>
          ))}
        </div>

        <form className="chat-composer" onSubmit={handleSubmit}>
          <input
            aria-label="메시지"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="대화로 목표, 최소 행동, 체크인을 남겨보세요"
          />
          <button aria-label="보내기" type="submit">
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </form>
      </aside>
    </main>
  );
}

function updateTrackerFromText(current: TrackerState, text: string): TrackerState {
  const lower = text.toLowerCase();
  const next: TrackerState = {
    ...current,
    patterns: [...current.patterns],
    records: [...current.records],
  };

  if (text.includes("토익") || lower.includes("toeic")) {
    next.habit = "토익 공부";
    next.goal = "저녁에 책상으로 돌아와 문제를 풀고 기록을 남기는 하루";
  }

  if (text.includes("운동")) {
    next.habit = "운동";
    next.goal = "몸을 움직이는 시간을 하루 안에 작게라도 확보하는 흐름";
  }

  const rcMatch = text.match(/RC\s?(\d+)/i);
  const genericCount = text.match(/(\d+)\s?(문제|분|개|쪽|페이지)/);
  if (rcMatch) {
    next.normalAction = `RC ${rcMatch[1]}문제`;
  } else if (genericCount && !text.includes("최소")) {
    next.normalAction = `${genericCount[1]}${genericCount[2]}`;
  }

  const minimumMatch = text.match(/최소(?:는|로|:)?\s?(?:RC\s?)?(\d+)\s?(문제|분|개|쪽|페이지)?/i);
  if (minimumMatch) {
    const unit = minimumMatch[2] ?? "문제";
    next.minimumAction = text.includes("RC") ? `RC ${minimumMatch[1]}${unit}` : `${minimumMatch[1]}${unit}`;
  }

  for (const pattern of ["쇼츠", "침대", "유튜브", "인스타", "폰", "퇴근 후", "피곤"]) {
    if (text.includes(pattern) && !next.patterns.includes(pattern)) {
      next.patterns.push(pattern);
    }
  }

  if (text.includes("했어") || text.includes("했다") || text.includes("완료")) {
    next.todayStatus = text.includes("못") ? "not_done" : text.includes("만") || text.includes("조금") ? "partial" : "done";
    next.todayNote = text;
    next.records[2] = next.todayStatus;
  }

  if (text.includes("못 했") || text.includes("못했") || text.includes("안 했") || text.includes("안했")) {
    next.todayStatus = "not_done";
    next.todayNote = text;
    next.records[2] = "not_done";
  }

  return next;
}

function createAssistantReply(tracker: TrackerState, text: string) {
  if (tracker.todayStatus === "partial") {
    return "좋아요. 일부 실행으로 기록할게요. 최소 버전이 실제로 작동했는지도 왼쪽에 남겨둘게요.";
  }

  if (tracker.todayStatus === "not_done") {
    return "기록했어요. 지금은 평가보다 장면이 중요해요. 다음 계획에서는 이 패턴을 피하는 첫 행동을 같이 잡아볼게요.";
  }

  if (text.includes("최소") || text.includes("RC")) {
    return "정상 버전과 최소 버전을 트래커에 반영했어요. 오늘 체크인은 대화로 바로 남길 수 있어요.";
  }

  if (tracker.habit !== "아직 정해지지 않음") {
    return "좋아요. 목표 장면을 왼쪽에 잡아뒀어요. 어느 정도면 충분한 하루인지 정상 버전과 최소 버전을 정해볼까요?";
  }

  return "좋아요. 그 장면을 조금 더 구체화해볼게요. 언제, 어디서, 무엇을 하면 충분한 하루에 가까울까요?";
}
