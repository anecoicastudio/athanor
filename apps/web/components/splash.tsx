'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import styles from './splash.module.css';

/**
 * Auria splash intro (DESIGN.md §5). On first load of a session the mandorla
 * draws in from empty — two circles + the vertical lens — then the Kairos star
 * pops at the apex, the wordmark + tagline fade up, and the overlay fades out to
 * reveal the app. The "start" (empty → draw) is visible from frame 0.
 *
 * Plays once per session (sessionStorage) and is skipped under
 * prefers-reduced-motion. Tokens only: `var(--color-aura)` (cyan accent),
 * `var(--color-gradient-*)` (mandala gradient), `var(--color-background)`.
 *
 * Server-rendered visible so the first paint already covers the page (no flash
 * of the app underneath); the client effect then plays or instantly dismisses.
 */
export function Splash({ wordmark, tagline }: { wordmark: string; tagline: string }) {
  const [stage, setStage] = useState<'show' | 'out' | 'gone'>('show');

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const seen = sessionStorage.getItem('auria-splash-seen');
    if (reduce || seen) {
      // defer to avoid react-hooks/set-state-in-effect (synchronous setState)
      queueMicrotask(() => setStage('gone'));
      return;
    }
    sessionStorage.setItem('auria-splash-seen', '1');
    const toOut = setTimeout(() => setStage('out'), 2600);
    const toGone = setTimeout(() => setStage('gone'), 2600 + 800);
    return () => {
      clearTimeout(toOut);
      clearTimeout(toGone);
    };
  }, []);

  if (stage === 'gone') return null;

  return (
    <div className={cn(styles.overlay, stage === 'out' && styles.out)} aria-hidden>
      <svg viewBox="0 0 100 100" className={styles.mark} fill="none">
        <defs>
          <linearGradient id="splash-mandala" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-gradient-1)" />
            <stop offset="50%" stopColor="var(--color-gradient-2)" />
            <stop offset="100%" stopColor="var(--color-gradient-3)" />
          </linearGradient>
          <radialGradient id="splash-glow" cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="var(--color-aura)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--color-aura)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="splash-star-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-aura)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--color-aura)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* two overlapping circles — draw in (faint mandala stroke) */}
        <circle
          className={styles.drawStroke}
          cx="35"
          cy="50"
          r="30"
          stroke="url(#splash-mandala)"
          strokeOpacity="0.4"
          strokeWidth="1.1"
        />
        <circle
          className={styles.drawStroke}
          cx="65"
          cy="50"
          r="30"
          stroke="url(#splash-mandala)"
          strokeOpacity="0.4"
          strokeWidth="1.1"
        />

        {/* the vertical lens-almond — mandala fill + cyan stroke, draws after */}
        <path
          className={cn(styles.drawStroke, styles.lens)}
          d="M50 24 A30 30 0 0 1 50 76 A30 30 0 0 1 50 24 Z"
          fill="url(#splash-mandala)"
          fillOpacity="0.3"
          stroke="var(--color-aura)"
          strokeWidth="1.2"
        />
        {/* soft cyan glow inside the lens */}
        <path
          className={styles.glow}
          d="M50 24 A30 30 0 0 1 50 76 A30 30 0 0 1 50 24 Z"
          fill="url(#splash-glow)"
        />

        {/* three ascending dots */}
        <circle
          className={styles.dotRise}
          cx="50"
          cy="62"
          r="1.9"
          fill="var(--color-aura)"
          style={{ animationDelay: '1.2s' }}
        />
        <circle
          className={styles.dotRise}
          cx="50"
          cy="50"
          r="1.9"
          fill="var(--color-aura)"
          style={{ animationDelay: '1.35s' }}
        />
        <circle
          className={styles.dotRise}
          cx="50"
          cy="38"
          r="1.9"
          fill="var(--color-aura)"
          style={{ animationDelay: '1.5s' }}
        />

        {/* Kairos star at the lens apex — pops in: glow + elongated sparkle + core */}
        <g className={styles.sparkPop} transform="translate(50,24)">
          <circle cx="0" cy="0" r="18" fill="url(#splash-star-glow)" />
          <path d="M0 -14 L2 -2 L14 0 L2 2 L0 14 L-2 2 L-14 0 L-2 -2 Z" fill="var(--color-aura)" />
          <circle cx="0" cy="0" r="2.2" fill="var(--color-foreground)" />
        </g>
      </svg>

      <div className={styles.wm}>{wordmark}</div>
      <div className={styles.ln}>{tagline}</div>
    </div>
  );
}
