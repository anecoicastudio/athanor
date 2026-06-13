import { ImageResponse } from 'next/og';
import { semantic } from '@auria/config';
import { mandorlaDataUri } from '@/lib/mandorla-svg';

// iOS home-screen icon (180×180), mandorla on the dark canvas. Auto-wired.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
      <img src={mandorlaDataUri(4)} width={132} height={132} alt="" />
    </div>,
    { ...size },
  );
}
