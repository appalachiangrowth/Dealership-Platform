import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from '@/components/toast';

export const metadata: Metadata = {
  title: 'Happy Motors – Dealer Portal',
  description: 'Manage your dealership website, vehicles and inquiries',
  robots: { index: false, follow: false },
  // public/favicon.ico (the Happy Motors build is served under /admin: NEXT_PUBLIC_BASE_PATH)
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/favicon.ico`, shortcut: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/favicon.ico` },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&family=Poppins:wght@500;700&display=swap"
        />
      </head>
      <body className="min-h-full font-sans">
        <ToastProvider>
          <SessionProvider>{children}</SessionProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
