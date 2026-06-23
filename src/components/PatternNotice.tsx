import { copy } from "@/lib/copy";
import type { PatternInsight } from "@/types/proof";

type PatternNoticeProps = {
  insight: PatternInsight | null;
};

export function PatternNotice({ insight }: PatternNoticeProps) {
  if (!insight) {
    return null;
  }

  return (
    <aside className="pattern-notice">
      <span>{copy.patternLead}</span>
      <strong>“{insight.pattern_summary}”</strong>
      <span>{copy.patternTail}</span>
    </aside>
  );
}
