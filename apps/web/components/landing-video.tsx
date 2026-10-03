'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { t, type Locale } from '@athanor/i18n';

/** Same gutter as the page (`EDGE` in landing-view.tsx), so the controls hang on its left edge. */
const EDGE = 'mx-auto w-full max-w-[1440px] px-5 md:px-8'; // i18n-ignore
/** A mono annotation with a 44px-tall hit area around an 11px label. */
const CONTROL = 'bs-label -mx-3 px-3 py-3.5 transition-opacity hover:opacity-70'; // i18n-ignore

/** Length of both cuts, shown on the pill before any metadata has been fetched. */
const DURATION_S = 44;
const IDLE_MS = 2000;
const SEEK_STEP_S = 5;

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Status = 'idle' | 'playing' | 'paused';

/**
 * The landing's video band (docs/DESIGN.md §6 «Web landing»): the 44-second «one day in
 * Athanor» cut, one file per locale, full-bleed between the hero and the first chapter.
 *
 * It is a still until asked: `preload="none"` and a poster, so no video bytes move before the
 * click and nothing on the page plays by itself. The chrome is the page's own register — one
 * concrete pill on the poster, then mono text controls and a 1px progress hairline that fade
 * when the pointer rests. No icon set, no glow, no `aura`: the cyan in the footage is content.
 *
 * The parent keys this component on `locale`, so a language switch remounts it on the other
 * cut's poster rather than swapping the source under a playing element.
 */
export function LandingVideo({ locale: L }: { locale: Locale }) {
  const frame = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(DURATION_S);
  const [awake, setAwake] = useState(true);

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );

  const wake = () => {
    setAwake(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setAwake(false), IDLE_MS);
  };

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    wake();
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  const seekTo = (seconds: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(seconds, 0), duration);
    setTime(v.currentTime);
    wake();
  };

  const seekFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - box.left) / box.width) * duration);
  };

  const onSeekKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') seekTo(time + SEEK_STEP_S);
    else if (e.key === 'ArrowLeft') seekTo(time - SEEK_STEP_S);
    else return;
    e.preventDefault();
  };

  const toggleMuted = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    wake();
  };

  const toggleFullscreen = () => {
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (frame.current?.requestFullscreen) void frame.current.requestFullscreen();
    // iPhone Safari has no element fullscreen; the video's own player is the only one it offers.
    else v?.webkitEnterFullscreen?.();
  };

  const onEnded = () => {
    const v = video.current;
    if (!v) return;
    // load() is what brings the poster back; a rewound video shows its first frame instead.
    v.load();
    setTime(0);
    setStatus('idle');
  };

  const started = status !== 'idle';
  const chrome = started && (awake || status === 'paused');

  return (
    <section
      ref={frame}
      aria-label={t('landing.video.label', L)}
      onPointerMove={started ? wake : undefined}
      className="group relative aspect-video max-h-[calc(100svh-3.5rem)] w-full scroll-mt-14 overflow-hidden border-t border-border bg-iron text-concrete [--ring:var(--color-concrete)] [&:fullscreen]:aspect-auto [&:fullscreen]:max-h-none"
    >
      <video
        ref={video}
        src={`/video/athanor-landing-${L}.mp4`}
        poster={`/video/athanor-landing-${L}.jpg`}
        preload="none"
        playsInline
        onClick={toggle}
        onPlay={() => setStatus('playing')}
        onPause={() => setStatus((s) => (s === 'idle' ? s : 'paused'))}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onEnded={onEnded}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        className="absolute inset-0 size-full object-cover group-[:fullscreen]:object-contain"
      />

      {!started && (
        <button
          type="button"
          onClick={toggle}
          aria-label={t('landing.video.play', L)}
          className="absolute inset-0 flex items-end pb-5 text-left md:pb-7"
        >
          <span className={EDGE}>
            <span className="bs-label inline-flex h-11 items-center gap-2.5 rounded-full bg-concrete px-5 text-iron transition-opacity duration-200 group-hover:opacity-85">
              <svg aria-hidden viewBox="0 0 9 10" className="h-2.5 w-[9px]">
                <path d="M0 0l9 5-9 5z" fill="currentColor" />
              </svg>
              {`${t('landing.video.play', L)} · ${clock(DURATION_S)}`}
            </span>
          </span>
        </button>
      )}

      {started && (
        <div
          className={`absolute inset-x-0 bottom-0 transition-opacity duration-300 focus-within:opacity-100 motion-reduce:transition-none ${
            chrome ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className={`${EDGE} flex items-center gap-6 pb-1 md:gap-7 md:pb-3`}>
            <button type="button" onClick={toggle} className={CONTROL}>
              {t(status === 'playing' ? 'landing.video.pause' : 'landing.video.play', L)}
            </button>
            <span aria-hidden className="bs-label hidden opacity-60 md:inline">
              {`${clock(time)} / ${clock(duration)}`}
            </span>
            <button
              type="button"
              onClick={toggleMuted}
              aria-pressed={!muted}
              className={`${CONTROL} ${muted ? 'line-through opacity-60' : ''}`}
            >
              {t('landing.video.sound', L)}
            </button>
            <button type="button" onClick={toggleFullscreen} className={CONTROL}>
              {t('landing.video.fullscreen', L)}
            </button>
          </div>
        </div>
      )}

      {started && (
        <div
          role="slider"
          tabIndex={0}
          aria-label={t('landing.video.seek', L)}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} / ${clock(duration)}`}
          onKeyDown={onSeekKey}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            seekFromPointer(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e);
          }}
          className="absolute inset-x-0 bottom-0 flex h-3 cursor-pointer touch-none items-end"
        >
          <span className="block h-px w-full bg-concrete/30">
            <span
              className="block h-full bg-concrete"
              style={{ width: `${(time / duration) * 100}%` }}
            />
          </span>
        </div>
      )}
    </section>
  );
}
