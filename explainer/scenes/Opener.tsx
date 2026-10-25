import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { AnimatedSceneProps } from '@explainer/src/kit/types';
import { easeOut, fadeIn, fadeOut, lerp, pop } from '@explainer/src/kit/anim';
import { useTheme } from '@explainer/src/kit/theme';
import { spansFor } from '@explainer/src/timeline';
import { TargetMark } from './TargetMark';

/**
 * Cold open in two beats, one per sentence of the narration.
 * 1. The problem: a pile of sources, each marked Unchecked.
 * 2. The payoff: the marks flip to Verified, the pile clears, and STRATEGOS lands with its five phases
 *    (the labels of the app's own phase bar).
 * The sources are invented; they stand for the reading a competitive analysis needs.
 */
const SOURCES = [
  'Orbitask pricing page, saved three weeks ago',
  'Analyst note on Nordic field-service software',
  'Crewlyst launch announcement',
  'Reseller forum thread on discounts',
  'Conference talk transcript, Q2',
];

const PHASES = ['Define Scope', 'Research', 'Verify Sources', 'Analyze', 'Deliverables'];

export const Opener: React.FC<AnimatedSceneProps> = ({ scene, spec }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [s0, s1] = spansFor(scene, fps);
  const t0 = s0?.start ?? 0;
  const t1 = s1?.start ?? 90;
  // The pile clears a little after the marks have flipped, then the name lands.
  const tClear = t1 + 22;
  const tName = tClear + 6;
  const pHead = pop(frame, fps, Math.max(0, t0 - 4), { damping: 16 });
  const pileOut = fadeOut(frame, tClear, 12);
  const pName = pop(frame, fps, tName, { damping: 15, stiffness: 110 });

  return (
    <AbsoluteFill>
      {/* Beat 1: the problem */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', opacity: Math.min(1, pHead * 1.5) * pileOut }}>
        <div style={{ fontFamily: theme.display, fontSize: 70, fontWeight: 700, color: theme.ink, letterSpacing: -1.5 }}>
          Weeks of reading. <span style={{ color: theme.red }}>Sources nobody checked.</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 460, width: 1000, top: 300, display: 'flex', flexDirection: 'column', gap: 18, opacity: pileOut, transform: `translateY(${lerp(0, -30, 1 - pileOut)}px)` }}>
        {SOURCES.map((s, i) => {
          const at = t0 + 8 + Math.round(((s0 ? s0.end - s0.start : 80) * 0.7 * i) / SOURCES.length);
          const p = pop(frame, fps, at, { damping: 16 });
          const verified = frame >= t1 + i * 3;
          return (
            <div
              key={s}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 22,
                padding: '20px 26px',
                borderRadius: 14,
                background: theme.panel,
                border: `1px solid ${theme.line}`,
                opacity: Math.min(1, p * 1.5),
                transform: `translateX(${lerp(i % 2 ? 60 : -60, 0, p)}px) rotate(${lerp(i % 2 ? 1.5 : -1.5, 0, p)}deg)`,
                boxShadow: '0 18px 40px rgba(0,0,0,.35)',
              }}
            >
              <div style={{ width: 34, height: 42, borderRadius: 6, background: theme.panel2, border: `1px solid ${theme.line}`, flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: 30, color: theme.ink }}>{s}</div>
              <div
                style={{
                  padding: '8px 18px',
                  borderRadius: 8,
                  fontSize: 22,
                  fontWeight: 600,
                  color: verified ? theme.warm : theme.red,
                  background: verified ? '#123528' : '#3A1A3D',
                  border: `1px solid ${verified ? theme.warm : theme.red}55`,
                }}
              >
                {verified ? 'Verified' : 'Unchecked'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Beat 2: the payoff */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 300, textAlign: 'center', opacity: Math.min(1, pName * 1.5), transform: `translateY(${lerp(34, 0, pName)}px) scale(${lerp(0.94, 1, pName)})` }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 34 }}>
          <TargetMark size={116} />
          <div style={{ fontFamily: theme.display, fontSize: 132, fontWeight: 700, letterSpacing: 6, color: theme.ink, lineHeight: 1 }}>{spec.name}</div>
        </div>
        <div style={{ margin: '28px auto 0', height: 5, width: lerp(0, 260, easeOut((frame - tName - 10) / 20)), borderRadius: 3, background: theme.accent }} />
        <div style={{ marginTop: 28, fontSize: 40, color: theme.muted, opacity: fadeIn(frame, tName + 12, 12) }}>Competitive intelligence in five steps</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 690, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14 }}>
        {PHASES.map((label, i) => {
          const p = pop(frame, fps, tName + 18 + i * 6, { damping: 15 });
          return (
            <React.Fragment key={label}>
              {i > 0 ? <div style={{ width: 26, height: 3, borderRadius: 2, background: theme.line, opacity: Math.min(1, p * 1.5) }} /> : null}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '16px 24px',
                  borderRadius: 12,
                  background: '#10352A',
                  border: `1px solid ${theme.warm}44`,
                  color: theme.warm,
                  fontSize: 27,
                  fontWeight: 600,
                  opacity: Math.min(1, p * 1.5),
                  transform: `translateY(${lerp(24, 0, p)}px)`,
                }}
              >
                <span style={{ width: 30, height: 30, borderRadius: 15, border: `2.5px solid ${theme.warm}`, display: 'grid', placeItems: 'center', fontSize: 17 }}>{i + 1}</span>
                {label}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
