/**
 * StalenessBadge — Compact inline badge showing dossier staleness level.
 * Colors by level: fresh (green), aging (amber), stale (magenta), never_refreshed (gray).
 */

import { CheckCircle, Clock, AlertTriangle, Minus } from 'lucide-react';
import type { StalenessLevel } from '../types';

interface StalenessBadgeProps {
  level: StalenessLevel;
  tooltip?: string;
}

const LEVEL_CONFIG: Record<StalenessLevel, { label: string; bg: string; text: string; Icon: typeof CheckCircle }> = {
  fresh: { label: 'Fresh', bg: '#2DBE8C', text: '#FFFFFF', Icon: CheckCircle },
  aging: { label: 'Aging', bg: '#F59E0B', text: '#FFFFFF', Icon: Clock },
  stale: { label: 'Stale', bg: '#C651C9', text: '#FFFFFF', Icon: AlertTriangle },
  never_refreshed: { label: 'Never Refreshed', bg: '#9CA3AF', text: '#FFFFFF', Icon: Minus },
};

export function StalenessBadge({ level, tooltip }: StalenessBadgeProps) {
  const config = LEVEL_CONFIG[level];
  const { Icon } = config;

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded leading-none"
      style={{ backgroundColor: config.bg, color: config.text }}
      title={tooltip}
      aria-label={`Staleness: ${config.label}${tooltip ? ` — ${tooltip}` : ''}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {config.label}
    </span>
  );
}
