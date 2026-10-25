import React from 'react';
import { useTheme } from '@explainer/src/kit/theme';

/** The app's own mark: lucide's Target icon, which STRATEGOS shows beside "Collaboration", in an accent tile. */
export const TargetMark: React.FC<{ size: number }> = ({ size }) => {
  const theme = useTheme();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.24,
        background: theme.accent,
        boxShadow: `0 0 60px ${theme.accent}66`,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none" stroke="#F3F5FA" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    </div>
  );
};
