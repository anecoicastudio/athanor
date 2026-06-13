import type { Metadata } from 'next';
import { Hanken_Grotesk, Instrument_Serif } from 'next/font/google';
import { t } from '@auria/i18n';
import './globals.css';
import { cn } from '@/lib/utils';
import { Splash } from '@/components/splash';

const hankenGrotesk = Hanken_Grotesk({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '600'],
});

// Dream register only (DESIGN.md §4): dream quotes + ritual captions, never UI.
const instrumentSerif = Instrument_Serif({
  variable: '--font-serif',
  subsets: ['latin'],
  weight: '400',
  style: 'italic',
});

const description =
  'Auria: reputazione reale, incontri reali, progetti reali. Non un social network — una nuova evoluzione delle community digitali.';

export const metadata: Metadata = {
  title: 'Auria — Dove ogni incontro si accende',
  description,
  openGraph: {
    title: 'Auria — Dove ogni incontro si accende',
    description,
    type: 'website',
    locale: 'it_IT',
    siteName: 'Auria',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={cn(
        'h-full antialiased font-sans',
        hankenGrotesk.variable,
        instrumentSerif.variable,
      )}
    >
      <body className="min-h-full flex flex-col">
        <Splash wordmark={t('app.name', 'it').toUpperCase()} tagline={t('app.tagline', 'it')} />
        {children}
      </body>
    </html>
  );
}
