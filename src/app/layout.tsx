import type { Metadata } from 'next';
import { Hanken_Grotesk, Marcellus } from 'next/font/google';
import './globals.css';

/** Body text. The design's working font throughout. */
const hankenGrotesk = Hanken_Grotesk({
  variable: '--font-hanken',
  subsets: ['latin'],
  display: 'swap',
});

/** Display face, for headings and the wordmark. */
const marcellus = Marcellus({
  variable: '--font-marcellus',
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Phone Se Mangao — fresh, daily, at your door',
  description: 'Fresh fruits, vegetables and grocery, delivered on your schedule.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${hankenGrotesk.variable} ${marcellus.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
