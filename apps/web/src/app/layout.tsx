import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: { default: 'GRC Order Desk', template: '%s · GRC Order Desk' },
  description: 'Customer threads, development and bulk orders for G.R. Corporation',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#ffffff' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        {children}
        <Toaster position="bottom-right" toastOptions={{ style: { fontFamily: 'var(--font-sans)' } }} />
      </body>
    </html>
  );
}
