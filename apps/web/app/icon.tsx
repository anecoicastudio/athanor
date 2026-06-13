import { ImageResponse } from 'next/og';
import { semantic } from '@auria/config';
import { mandorlaDataUri } from '@/lib/mandorla-svg';

// Browser-tab / favicon icon — the mandorla on the dark canvas. Auto-wired by
// the Next file convention (replaces the need for a static PNG).
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: semantic.background,
      }}
    >
      <img src={mandorlaDataUri(6)} width={28} height={28} alt="" />
    </div>,
    { ...size },
  );
}
