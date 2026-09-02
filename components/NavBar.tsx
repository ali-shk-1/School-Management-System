/**
 * components/NavBar.tsx
 *
 * Port of renderNav() from nav.js. Renders the same markup/classes as
 * the original (`nav.navbar`, `.brand`, `.navbar-right`, etc.) so
 * style.css applies unchanged. Page-visibility filtering (hasPageAccess)
 * and the ali-only "Permissions" link match the original exactly.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getUser, logout, api } from '@/lib/api-client';
import { isAliUser, hasPageAccess } from '@/lib/permissions-client';
import { initTheme, toggleTheme } from '@/lib/theme';

const ALL_PAGES = [
  { href: '/dashboard', label: 'Dashboard', key: 'dashboard' },
  { href: '/fees', label: 'Fees', key: 'fees' },
  { href: '/receipts', label: 'Receipts', key: 'receipts' },
  { href: '/expenses', label: 'Expenses', key: 'expenses' },
  { href: '/tracking', label: 'Tracking', key: 'tracking' },
  { href: '/balance-sheet', label: 'Total', key: 'balance-sheet' },
  { href: '/students', label: 'Students', key: 'students' },
  { href: '/left-students', label: 'Left Students', key: 'left-students' },
  { href: '/staff', label: 'Staff', key: 'staff' },
  { href: '/left-staff', label: 'Left Staff', key: 'left-staff' },
] as const;

/**
 * Each page's primary GET endpoint(s), so hovering/focusing a nav link
 * can warm the shared GET cache (lib/api-client.ts) a beat before the
 * click actually navigates. On a fast local network this alone often
 * means the data is already cached by the time the new page mounts —
 * no spinner, no freeze. Cheap and safe: api() dedupes in-flight
 * requests, so a hover-then-click never fires the request twice.
 */
const PREFETCH_ENDPOINTS: Record<string, string[]> = {
  students: ['/api/students'],
  'left-students': ['/api/students/left'],
  staff: ['/api/staff', '/api/staff/designations'],
  'left-staff': ['/api/staff/left'],
  receipts: ['/api/fees/receipts'],
};

function prefetchPageData(key: string) {
  const endpoints = PREFETCH_ENDPOINTS[key];
  if (!endpoints) return;
  endpoints.forEach((path) => {
    void api('GET', path).catch(() => {});
  });
}

const THEME_ICON_SUN = (
  <svg className="theme-icon theme-icon-sun" width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="4.5" fill="currentColor" />
    <g stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="M12 2v2.2M12 19.8V22M4.2 4.2l1.55 1.55M18.25 18.25l1.55 1.55M2 12h2.2M19.8 12H22M4.2 19.8l1.55-1.55M18.25 5.75l1.55-1.55" />
    </g>
  </svg>
);

const THEME_ICON_MOON = (
  <svg className="theme-icon theme-icon-moon" width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7z" fill="currentColor" />
  </svg>
);

/**
 * One small icon per nav link, shown to the left of the label. Used in
 * both the mobile top bar and the desktop left sidebar (see .navbar
 * sidebar rules in style.css) — same icon set either way, only the
 * bar's own layout changes between the two. Plain stroke-based SVGs at
 * 16px, matching the theme-toggle icons above (currentColor so they
 * follow the link's own text color/active state automatically).
 */
const NAV_ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  fees: (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth={1.8} />
      <path d="M12 7v10M9.5 9.3c0-1.1 1.1-2 2.5-2s2.5.7 2.5 1.8c0 2.4-5 1.3-5 3.7 0 1.1 1.1 1.9 2.5 1.9s2.5-.8 2.5-1.9" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  ),
  receipts: (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3z" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  ),
  expenses: (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 17 9 11l4 4 8-8" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 6h6v6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  tracking: (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  'balance-sheet': (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke="currentColor" strokeWidth={1.6} />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  ),
  students: (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth={1.7} />
      <path d="M4.5 20c1-3.7 4-5.5 7.5-5.5s6.5 1.8 7.5 5.5" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
    </svg>
  ),
  'left-students': (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10" cy="8" r="3.2" stroke="currentColor" strokeWidth={1.6} />
      <path d="M3.5 20c1-3.4 3.6-5 6.5-5M17 8l4 4m0-4-4 4" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  ),
  staff: (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth={1.6} />
      <circle cx="17" cy="8.5" r="2.4" stroke="currentColor" strokeWidth={1.6} />
      <path d="M3 20c.8-3.3 3-5 6-5s5.2 1.7 6 5M15.5 13.3c2 .2 3.6 1.6 4.2 4.2" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  ),
  'left-staff': (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth={1.6} />
      <path d="M3 20c.8-3.3 3-5 6-5s5.2 1.7 6 5M16 8l4 4m0-4-4 4" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  ),
  permissions: (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
      <path d="M9 12.3l2 2 4-4.3" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  'db-admin': (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <ellipse cx="12" cy="6" rx="7.5" ry="2.7" stroke="currentColor" strokeWidth={1.6} />
      <path d="M4.5 6v6c0 1.5 3.3 2.7 7.5 2.7s7.5-1.2 7.5-2.7V6M4.5 12v6c0 1.5 3.3 2.7 7.5 2.7s7.5-1.2 7.5-2.7v-6" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  ),
};

/**
 * activePage: the page `key` to mark active. Pages pass their own key
 * (matches ALL_PAGES entries) exactly like renderNav(activePage) did.
 * refreshToken: bump this (e.g. from refreshMyPermissions) to force a
 * re-render after permissions/page-visibility change — mirrors the
 * original re-calling renderNav() from refreshMyPermissions().
 */
export default function NavBar({ activePage }: { activePage: string }) {
  const pathname = usePathname();
  const [, forceRerender] = useState(0);

  useEffect(() => {
    initTheme();
  }, []);

  const user = getUser();
  const pages = ALL_PAGES.filter((p) => p.key === 'dashboard' || hasPageAccess(p.key));
  const showPermissions = isAliUser();

  const handleToggleTheme = () => {
    toggleTheme();
    forceRerender((n) => n + 1);
  };

  return (
    <nav className="navbar">
      <Link className="brand" href="/dashboard">
        <img src="/icon-192.png" alt="" width={22} height={22} className="brand-icon" />
        <span>School Mgmt</span>
      </Link>
      <nav>
        {pages.map((p) => (
          <Link
            key={p.key}
            href={p.href}
            className={activePage === p.key || pathname === p.href ? 'active' : ''}
            onMouseEnter={() => prefetchPageData(p.key)}
            onFocus={() => prefetchPageData(p.key)}
          >
            <span className="nav-icon">{NAV_ICONS[p.key]}</span>
            <span className="nav-label">{p.label}</span>
          </Link>
        ))}
        {showPermissions && (
          <Link href="/permissions" className={activePage === 'permissions' ? 'active' : ''}>
            <span className="nav-icon">{NAV_ICONS['permissions']}</span>
            <span className="nav-label">Permissions</span>
          </Link>
        )}
        {showPermissions && (
          <Link href="/db-admin" className={activePage === 'db-admin' ? 'active' : ''}>
            <span className="nav-icon">{NAV_ICONS['db-admin']}</span>
            <span className="nav-label">DB Admin</span>
          </Link>
        )}
      </nav>
      <div className="navbar-right">
        <button
          className="theme-toggle"
          id="themeToggleBtn"
          type="button"
          aria-label="Toggle dark mode"
          title="Toggle dark / light mode"
          onClick={handleToggleTheme}
        >
          {THEME_ICON_SUN}
          {THEME_ICON_MOON}
        </button>
        <span className="navbar-user">
          {user?.username || ''}
          {user?.role ? ` · ${user.role}` : ''}
        </span>
        <button className="logout-btn" onClick={() => logout()}>
          Logout
        </button>
      </div>
    </nav>
  );
}
