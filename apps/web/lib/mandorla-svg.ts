import { gradient, semantic } from '@athanor/config';

/**
 * Brand mandorla as an SVG data URI — for `next/og` ImageResponse, where the
 * CSS design tokens aren't available (Satori renders an isolated tree). Colors
 * still come from @athanor/config (never literal hex), per brand rule 4: two
 * vesica circles in the mandala gradient + the cyan Kairos star at the apex.
 */
export function mandorlaDataUri(stroke = 4): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${gradient[1]}"/>
<stop offset="50%" stop-color="${gradient[2]}"/>
<stop offset="100%" stop-color="${gradient[3]}"/>
</linearGradient></defs>
<circle cx="38" cy="54" r="26" stroke="url(#g)" stroke-width="${stroke}"/>
<circle cx="62" cy="54" r="26" stroke="url(#g)" stroke-width="${stroke}"/>
<path d="M50 14 L53.5 26 L65.5 29.5 L53.5 33 L50 45 L46.5 33 L34.5 29.5 L46.5 26 Z" fill="${semantic.aura}"/>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
