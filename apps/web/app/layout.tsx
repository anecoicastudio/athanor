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

export const metadata: Metadata = {
  title: 'Auria — Dove ogni incontro si accende',
  description: 'Where the right people meet at the right moment.',
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
