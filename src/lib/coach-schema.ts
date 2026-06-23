import type { CoachQuestion, CoachSynthesis } from "@/types/proof";

export type CoachBaseInput = {
  habit_name: string;
  usual_breakdown_context: string;
  usual_breakdown_behavior: string;
};

export type CoachAnswer = {
  question_id: string;
  question: string;
  answer: string;
};

export type CoachQuestionResponse = {
  questions: CoachQuestion[];
};

export type CoachSynthesisResponse = CoachSynthesis;

export const fallbackQuestions: CoachQuestion[] = [
  {
    id: "desired_scene",
    label: "이 습관이 자리 잡으면 4주 뒤 어떤 장면이 보이나요?",
    helper: "시간, 장소, 행동량, 기분보다 관찰 가능한 모습을 적습니다.",
    placeholder: "예: 평일 저녁 8시에 책상에 앉아 토익 RC 10문제를 풀고 채점까지 끝낸다.",
  },
  {
    id: "real_goal",
    label: "이번 달에는 어느 정도면 충분히 의미 있나요?",
    helper: "큰 목표 대신 4주 안에 확인 가능한 기준으로 씁니다.",
    placeholder: "예: 주 3회, 회당 30분, 총 12회 기록이 남는다.",
  },
  {
    id: "last_breakdown",
    label: "가장 최근에 무너진 날을 아주 구체적으로 복기하면요?",
    helper: "언제, 어디서, 직전 행동, 손에 들고 있던 것까지 적습니다.",
    placeholder: "예: 수요일 밤 9시, 침대에서 폰을 들고 유튜브 쇼츠를 켰다.",
  },
  {
    id: "trigger_signal",
    label: "무너지기 직전에 반복해서 보이는 신호가 있나요?",
    helper: "감정 분석보다 행동 신호를 찾습니다.",
    placeholder: "예: 책상에 앉기 전에 침대에 눕는다. 충전기를 침대 옆에 꽂는다.",
  },
  {
    id: "minimum_action",
    label: "그날 컨디션이 낮아도 할 수 있는 최소 행동은 무엇인가요?",
    helper: "너무 작아서 시작할 수밖에 없는 수준이면 좋습니다.",
    placeholder: "예: RC 3문제만 풀고 답 표시하기.",
  },
];
