'use client';

import { useEffect, useState } from 'react';
import { Mandorla } from '@/components/mandorla';
import { markSplashDone } from '@/lib/splash-ready';
import styles from './splash.module.css';

/**
 * Athanor splash intro (DESIGN.md §5). On every load the mandorla draws in from
 * empty — two circles + the vertical lens — then the Kairos star pops at the
 * apex and the tagline fades up. After a hold the screen floods white, then a
 * circular window opens from the centre — rimmed in aura cyan — and grows outward
 * to reveal the landing page *through* the white (an iris/aperture reveal; no
 * element zooms). `markSplashDone` fires as the hole begins to open.
 *
 * Skipped under prefers-reduced-motion. Tokens only: `var(--color-aura)` (the
 * cyan rim of the opening — a moment that matters), `var(--color-gradient-*)`
 * (mandala gradient), `var(--color-background)`; the flood is the generic CSS
 * keyword `white` (not a brand colour).
 *
 * Server-rendered visible so the first paint already covers the page (no flash
 * of the app underneath); the client effect then plays or instantly dismisses.
 */
export function Splash({ tagline }: { tagline: string }) {
  const [stage, setStage] = useState<'show' | 'white' | 'iris' | 'gone'>('show');

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // defer to avoid react-hooks/set-state-in-effect (synchronous setState)
      queueMicrotask(() => {
        setStage('gone');
        markSplashDone();
      });
      return;
    }
    // intro done (~2.1s) → hold → flood white → an iris opens in the white,
    // revealing the page through the growing circle. markSplashDone fires as the
    // hole begins opening (page starting to show → release the gated reveals).
    const toWhite = setTimeout(() => setStage('white'), 5200);
    const toIris = setTimeout(() => {
      setStage('iris');
      markSplashDone();
    }, 5800);
    const toGone = setTimeout(() => setStage('gone'), 5800 + 1200 + 100);
    return () => {
      clearTimeout(toWhite);
      clearTimeout(toIris);
      clearTimeout(toGone);
    };
  }, []);

  if (stage === 'gone') return null;

  return (
    <div className={styles.overlay} aria-hidden>
      {stage !== 'iris' && (
        <div className={styles.scene}>
          <Mandorla idPrefix="splash" className={styles.mark} />
          <div className={styles.ln}>{tagline}</div>
        </div>
      )}
      <div className={styles.iris} data-stage={stage} />
    </div>
  );
}
