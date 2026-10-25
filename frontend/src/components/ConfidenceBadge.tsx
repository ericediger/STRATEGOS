/**
 * ConfidenceBadge — Compact inline badge showing confidence rating.
 * Colors by rating: High (green), Medium (blue), Low (magenta).
 */

interface ConfidenceBadgeProps {
  rating: 'High' | 'Medium' | 'Low';
  tooltip?: string;
}

const RATING_STYLES: Record<string, { bg: string; text: string }> = {
  High: { bg: '#2DBE8C', text: '#FFFFFF' },
  Medium: { bg: '#4C7DF0', text: '#FFFFFF' },
  Low: { bg: '#C651C9', text: '#FFFFFF' },
};

const DEFAULT_TOOLTIP = 'Project-level confidence rating based on verification results. Per-section differentiation coming in a future update.';

export function ConfidenceBadge({ rating, tooltip }: ConfidenceBadgeProps) {
  const style = RATING_STYLES[rating];
  const resolvedTooltip = tooltip || DEFAULT_TOOLTIP;

  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded leading-none"
      style={{ backgroundColor: style.bg, color: style.text }}
      title={resolvedTooltip}
      aria-label={`Confidence: ${rating} — ${resolvedTooltip}`}
    >
      {rating}
    </span>
  );
}
