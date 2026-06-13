'use client';

import { useRef, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { whenSplashDone } from '@/lib/splash-ready';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Reveal — a thin client wrapper that fades + lifts its children into place as
 * they enter the viewport (the calm editorial entrance, scroll-driven). Used
 * around headlines, quotes, and list blocks in the otherwise server-rendered
 * landing.
 *
 * The tween is built only once the splash has lifted (`whenSplashDone`) so the
 * above-the-fold hero doesn't animate — and finish — hidden behind the splash
 * overlay (which would read as a skipped entrance). Under prefers-reduced-motion
 * nothing runs and the content shows statically.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 28,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  /** Initial downward offset in px; the element lifts to 0. */
  y?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      let tween: gsap.core.Tween | undefined;
      const off = whenSplashDone(() => {
        tween = gsap.from(ref.current, {
          opacity: 0,
          y,
          duration: 0.9,
          delay,
          ease: 'power3.out',
          scrollTrigger: { trigger: ref.current, start: 'top 85%', once: true },
        });
      });
      return () => {
        off();
        tween?.scrollTrigger?.kill();
        tween?.kill();
      };
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
