import type { Metadata, Viewport } from 'next';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
<<<<<<< HEAD
import { SIDEBAR_WIDTH_INIT_SCRIPT, SIDEBAR_COLLAPSED_INIT_SCRIPT } from '@/components/NavBar';
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
import './globals.css';

export const metadata: Metadata = {
  title: 'School Management',
  description: 'School management system for students, staff, fees, and expenses.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'School Mgmt',
  },
  icons: {
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4f46e5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Registers the PWA service worker, same as the original's inline <head> snippet on every page. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}`,
          }}
        />
        {/* Sets data-theme before first paint to avoid a flash of the wrong theme, matching the original's per-page inline script. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
<<<<<<< HEAD
        {/* Restores any saved sidebar width before first paint, same flash-avoidance idea as the theme script above. */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_WIDTH_INIT_SCRIPT }} />
        {/* Restores the collapsed sidebar state before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_COLLAPSED_INIT_SCRIPT }} />
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
      </head>
      <body>{children}</body>
    </html>
  );
}
