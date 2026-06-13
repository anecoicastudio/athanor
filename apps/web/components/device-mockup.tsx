import Image from 'next/image';
import { cn } from '@/lib/utils';
import styles from './device-mockup.module.css';

/**
 * Renders the AURIA app screen as a floating, angled 3D device. The `src` image
 * is already a front-on framed phone (its own bezel), so this wrapper only adds
 * the tilt, a glass glare and a soft floor shadow (see device-mockup.module.css)
 * — never a second bezel. Pure presentational; the entrance is handled by the
 * Reveal/Parallax wrappers at the call site.
 */
export function DeviceMockup({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <div className={cn(styles.stage, className)}>
      <div className={styles.device}>
        <Image src={src} alt={alt} width={400} height={852} priority className={styles.screen} />
        <span className={styles.glare} aria-hidden />
        <span className={cn(styles.btn, styles.power)} aria-hidden />
        <span className={cn(styles.btn, styles.vol)} aria-hidden />
        <span className={styles.shadow} aria-hidden />
      </div>
    </div>
  );
}
