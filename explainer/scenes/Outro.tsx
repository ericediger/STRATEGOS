import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { AnimatedSceneProps } from '@explainer/src/kit/types';
import { easeOut, fadeIn, lerp, pop } from '@explainer/src/kit/anim';
import { useTheme } from '@explainer/src/kit/theme';
import { spansFor } from '@explainer/src/timeline';
import { TargetMark } from './TargetMark';

/**
 * Closing card: one takeaway per sentence of the narration, then the name and, when spec.repoUrl is set, where to
 * get it. Write as many POINTS as the narration has sentences before its last one (the last brings in the name).
 */
const POINTS = [
  { title: '10 minutes', body: 'of your time: scope the question, then review the results.' },
  { title: '3 research teams', body: 'investigate at once, each with its own sources.' },
  { title: 'Every claim checked', body: 'against its original source before any analysis.' },
];

export const Outro: React.FC<AnimatedSceneProps> = ({ scene, spec }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const spans = spansFor(scene, fps);
  const tMark = spans[POINTS.length]?.start ?? spans[spans.length - 1].start;
  const pMark = pop(frame, fps, tMark, { damping: 15, stiffness: 100 });
  const colors = [theme.blue, theme.accent, theme.warm];

  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 170, right: 170, top: 150, display: 'flex', gap: 30 }}>
        {POINTS.map((c, i) => {
          const p = pop(frame, fps, spans[i]?.start ?? 0, { damping: 16 });
          return (
            <div
              key={c.title}
              style={{
                flex: 1,
                padding: '28px 30px 30px',
                borderRadius: 20,
                background: theme.panel,
                border: `1px solid ${theme.line}`,
                borderTop: `5px solid ${colors[i % colors.length]}`,
                boxShadow: '0 26px 60px rgba(0,0,0,.4)',
                opacity: Math.min(1, p * 1.5),
                transform: `translateY(${lerp(36, 0, p)}px)`,
              }}
            >
              <div style={{ fontFamily: theme.display, fontSize: 36, fontWeight: 700, color: theme.ink, letterSpacing: -0.5 }}>{c.title}</div>
              <div style={{ fontSize: 23, color: theme.muted, marginTop: 12, lineHeight: 1.42 }}>{c.body}</div>
            </div>
          );
        })}
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, top: 520, textAlign: 'center', opacity: Math.min(1, pMark * 1.5), transform: `translateY(${lerp(30, 0, pMark)}px)` }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 28 }}>
          <TargetMark size={96} />
          <div style={{ fontFamily: theme.display, fontSize: 104, fontWeight: 700, letterSpacing: 5, color: theme.ink, lineHeight: 1 }}>{spec.name}</div>
        </div>
        <div style={{ margin: '20px auto 0', display: 'flex', justifyContent: 'center', gap: 8 }}>
          {colors.map((c, i) => (
            <div key={i} style={{ height: 5, width: lerp(0, 90, easeOut((frame - tMark - 8 - i * 4) / 18)), borderRadius: 3, background: c }} />
          ))}
        </div>
        {spec.repoUrl ? (
          <div
            style={{
              marginTop: 26,
              display: 'inline-block',
              padding: '12px 24px',
              borderRadius: 14,
              background: theme.panel,
              border: `1px solid ${theme.line}`,
              fontFamily: theme.mono,
              fontSize: 26,
              color: theme.ink,
              opacity: fadeIn(frame, tMark + 14, 12),
            }}
          >
            {spec.repoUrl}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
