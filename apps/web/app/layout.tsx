import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { cn } from '@/lib/utils';

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '600'],
});

export const metadata: Metadata = {
  title: 'Kaira — Il momento giusto, le persone giuste',
  description: 'Where the right people meet at the right moment.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className={cn('h-full antialiased font-sans', inter.variable)}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
