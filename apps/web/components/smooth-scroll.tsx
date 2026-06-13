'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Smooth-scroll provider (DESIGN.md §11, 2026-06-13 — the sanctioned parallax
 * override of §10). Lenis drives the page scroll and feeds GSAP ScrollTrigger
 * so the <Reveal>/<Parallax> wrappers stay in sync. Mounted once in the root
 * layout, wrapping the page.
 *
 * Under prefers-reduced-motion it does nothing — native scroll, no Lenis, and
 * the wrappers below render their content statically.
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis();
    lenis.on('scroll', ScrollTrigger.update);

    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
