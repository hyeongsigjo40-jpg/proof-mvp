import type { CheckIn } from "@/types/proof";

const stopWords = new Set([
  "그리고",
  "그냥",
  "너무",
  "계속",
  "하다",
  "하고",
  "있었어요",
  "있었음",
  "했어요",
  "했습니다",
  "에서",
  "으로",
  "보다",
]);

export function generatePatternSummary(checkIns: CheckIn[]) {
  const texts = checkIns
    .filter((checkIn) => checkIn.result !== "done" && checkIn.context_text)
    .map((checkIn) => checkIn.context_text ?? "");

  if (texts.length < 5) {
    return null;
  }

  const counts = new Map<string, number>();

  for (const text of texts) {
    const words = text
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 2 && !stopWords.has(word));

    for (const word of words) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  const [topWord] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return topWord ?? null;
}
