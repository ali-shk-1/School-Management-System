/**
 * components/NavBar.tsx
 *
 * Port of renderNav() from nav.js. Renders the same markup/classes as
 * the original (`nav.navbar`, `.brand`, `.navbar-right`, etc.) so
 * style.css applies unchanged. Page-visibility filtering (hasPageAccess)
 * and the ali-only "Permissions" link match the original exactly.
 */

'use client';

<<<<<<< HEAD
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
=======
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
import { getUser, logout, api } from '@/lib/api-client';
import { isAliUser, hasPageAccess } from '@/lib/permissions-client';
import { initTheme, toggleTheme } from '@/lib/theme';

<<<<<<< HEAD
/** Sidebar resize constraints (desktop only) and localStorage key. */
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 220;
const SIDEBAR_WIDTH_KEY = 'sidebarWidth';

/**
 * Applies the sidebar width to the document as a CSS variable so
 * style.css (--sidebar-width, used by both .navbar and body's
 * padding-left) picks it up immediately — including before React
 * hydrates, via the same inline-script pattern used for the theme.
 */
function applySidebarWidth(width: number) {
  document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
}

export const SIDEBAR_WIDTH_INIT_SCRIPT = `(function(){
  var w = parseInt(localStorage.getItem('${SIDEBAR_WIDTH_KEY}'), 10);
  if (!w || isNaN(w)) w = ${SIDEBAR_DEFAULT_WIDTH};
  w = Math.max(${SIDEBAR_MIN_WIDTH}, Math.min(${SIDEBAR_MAX_WIDTH}, w));
  document.documentElement.style.setProperty('--sidebar-width', w + 'px');
})();`;

/** Sidebar collapse (fully hidden, desktop only) persisted key. */
const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed';

/** Restores the collapsed/expanded state before first paint, same flash-avoidance idea as the width/theme scripts above. */
export const SIDEBAR_COLLAPSED_INIT_SCRIPT = `(function(){
  if (localStorage.getItem('${SIDEBAR_COLLAPSED_KEY}') === '1') {
    document.documentElement.setAttribute('data-sidebar-collapsed', '1');
  }
})();`;

=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
const ALL_PAGES = [
  { href: '/dashboard', label: 'Dashboard', key: 'dashboard' },
  { href: '/fees', label: 'Fees', key: 'fees' },
  { href: '/receipts', label: 'Receipts', key: 'receipts' },
  { href: '/expenses', label: 'Expenses', key: 'expenses' },
  { href: '/tracking', label: 'Tracking', key: 'tracking' },
  { href: '/balance-sheet', label: 'Total', key: 'balance-sheet' },
  { href: '/students', label: 'Students', key: 'students' },
<<<<<<< HEAD
  { href: '/staff', label: 'Staff', key: 'staff' },
] as const;
// Left Students / Left Staff used to be their own top-level sidebar
// links; they're now submenu items under Students/Staff respectively
// (see SUBMENUS below) instead of separate entries in this list.
// Their routes/permission keys (left-students/left-staff) are
// unchanged — see lib/permissions.ts.

/**
 * Sub-links shown under a nav item when it's the active section.
 * Only one section's submenu is open at a time (see `openSection`
 * state below) — switching to a different top-level tab closes
 * whatever submenu was previously open.
 *
 * - fees: the 4 record-browsing tabs from the Fees page (Total Fee /
 *   Students Fee tabs are intentionally left out — not part of this
 *   submenu).
 * - tracking: Fee Tracking is `?mode=fee` (the toggle OFF position,
 *   default is Student Tracking) — see app/(app)/tracking/page.tsx.
 * - students/staff: the "Left" list is its own top-level page/route,
 *   surfaced here as a submenu item instead of a separate sidebar
 *   entry.
 */
const SUBMENUS: Record<string, { href: string; label: string }[]> = {
  fees: [
    { href: '/fees?tab=monthly', label: 'Monthly Records' },
    { href: '/fees?tab=daily', label: 'Daily Collections' },
    { href: '/fees?tab=monthly-defaulters', label: 'Monthly Defaulters' },
    { href: '/fees?tab=history', label: 'Student History' },
  ],
  tracking: [
    { href: '/tracking?mode=fee', label: 'Fee Tracking' },
    { href: '/tracking?mode=student', label: 'Student Tracking' },
  ],
  students: [{ href: '/left-students', label: 'Left Students' }],
  staff: [{ href: '/left-staff', label: 'Left Staff' }],
};

// left-students/left-staff are their own routes (activePageFromPath
// resolves to these keys, not 'students'/'staff'), but their submenu
// entry lives under the Students/Staff section above — this maps the
// child page's key back to its parent section so that section stays
// expanded and highlighted while on the "Left" page.
const SECTION_PARENT: Record<string, string> = {
  'left-students': 'students',
  'left-staff': 'staff',
};
=======
  { href: '/left-students', label: 'Left Students', key: 'left-students' },
  { href: '/staff', label: 'Staff', key: 'staff' },
  { href: '/left-staff', label: 'Left Staff', key: 'left-staff' },
] as const;
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e

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
<<<<<<< HEAD
  const searchParams = useSearchParams();
  const [, forceRerender] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const draggingRef = useRef(false);
  const navRef = useRef<HTMLElement | null>(null);
  const scrollHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which top-level item's submenu is expanded. Defaults to whatever
  // section is currently active (so landing directly on e.g. /fees
  // shows its submenu right away); switching to a different top-level
  // tab collapses whatever was open before, since `activePage` changing
  // re-syncs this via the effect below.
  const activeSection = SECTION_PARENT[activePage] ?? activePage;
  const [openSection, setOpenSection] = useState<string | null>(
    SUBMENUS[activeSection] ? activeSection : null
  );

  useEffect(() => {
    // Whenever the active top-level page changes, snap the open
    // submenu to match it (open the new section's, close the old
    // one) — this is what makes switching tabs close the previous
    // section's submenu automatically.
    setOpenSection(SUBMENUS[activeSection] ? activeSection : null);
  }, [activeSection]);

  useEffect(() => {
    initTheme();
    // Restore any previously-saved width (covers client-only nav/route
    // changes; the inline SIDEBAR_WIDTH_INIT_SCRIPT in <head> already
    // handles the very first paint so there's no flash on hard reload).
    const saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || '', 10);
    if (!Number.isNaN(saved)) {
      applySidebarWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, saved)));
    }
    // Same idea for the collapsed state — SIDEBAR_COLLAPSED_INIT_SCRIPT
    // already set the attribute pre-paint, this just syncs React state
    // so the arrow icon renders pointing the right way from the start.
    setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
  }, []);

  const handleToggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (next) {
      document.documentElement.setAttribute('data-sidebar-collapsed', '1');
    } else {
      document.documentElement.removeAttribute('data-sidebar-collapsed');
    }
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
  };

  useEffect(() => {
    // Auto-hiding sidebar scrollbar: the .is-scrolling class (see the
    // ::-webkit-scrollbar-thumb / scrollbar-color rules in style.css)
    // is what actually makes the thumb visible — scrolling adds it
    // immediately, then a short debounce removes it again once
    // scrolling has stopped, so the thumb fades out with the CSS
    // transition rather than vanishing the instant the wheel stops.
    // This covers both a normal scroll and an overscroll past the
    // top/bottom limit, since both fire native `scroll` events.
    const el = navRef.current;
    if (!el) return;

    const handleScroll = () => {
      el.classList.add('is-scrolling');
      if (scrollHideTimerRef.current) clearTimeout(scrollHideTimerRef.current);
      scrollHideTimerRef.current = setTimeout(() => {
        el.classList.remove('is-scrolling');
      }, 700);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (scrollHideTimerRef.current) clearTimeout(scrollHideTimerRef.current);
    };
  }, []);

  const handleResizeStart = (e: React.MouseEvent) => {
    // Desktop-only: below the 769px breakpoint the sidebar becomes the
    // horizontal top bar and isn't resizable, so bail out there.
    if (window.innerWidth < 769) return;
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, moveEvent.clientX)
      );
      applySidebarWidth(next);
    };

    const onMouseUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const finalWidth = getComputedStyle(document.documentElement)
        .getPropertyValue('--sidebar-width')
        .trim();
      if (finalWidth) localStorage.setItem(SIDEBAR_WIDTH_KEY, parseInt(finalWidth, 10).toString());
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

=======
  const [, forceRerender] = useState(0);

  useEffect(() => {
    initTheme();
  }, []);

>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
  const user = getUser();
  const pages = ALL_PAGES.filter((p) => p.key === 'dashboard' || hasPageAccess(p.key));
  const showPermissions = isAliUser();

  const handleToggleTheme = () => {
    toggleTheme();
    forceRerender((n) => n + 1);
  };

  return (
<<<<<<< HEAD
    <>
    <nav className="navbar" ref={navRef as React.RefObject<HTMLElement>}>
=======
    <nav className="navbar">
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
      <Link className="brand" href="/dashboard">
        <img src="/icon-192.png" alt="" width={22} height={22} className="brand-icon" />
        <span>School Mgmt</span>
      </Link>
      <nav>
<<<<<<< HEAD
        {pages.map((p) => {
          const submenu = SUBMENUS[p.key];
          const isOpen = openSection === p.key;
          return (
            <div key={p.key} className={`nav-section${submenu ? ' has-submenu' : ''}${isOpen ? ' open' : ''}`}>
              <Link
                href={p.href}
                className={activePage === p.key || pathname === p.href || activeSection === p.key ? 'active' : ''}
                onMouseEnter={() => prefetchPageData(p.key)}
                onFocus={() => prefetchPageData(p.key)}
                onClick={() => {
                  // Clicking a top-level item that has a submenu: if
                  // its submenu is already open, clicking it again
                  // closes it (e.g. Students open -> click Students ->
                  // just the Students page, submenu tucked away).
                  // Otherwise it opens (and any other open submenu
                  // closes). Plain page links with no submenu of their
                  // own always close whatever was open, since they
                  // navigate to a different page entirely.
                  setOpenSection((current) => {
                    if (!submenu) return null;
                    return current === p.key ? null : p.key;
                  });
                }}
              >
                <span className="nav-icon">{NAV_ICONS[p.key]}</span>
                <span className="nav-label">{p.label}</span>
                {submenu && (
                  <svg className="nav-submenu-caret" width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </Link>
              {submenu && (
                <div className="nav-submenu">
                  <div>
                    {submenu.map((s) => {
                      const [sPath, sQuery] = s.href.split('?');
                      const sParams = new URLSearchParams(sQuery || '');
                      // A submenu link is "active" when its path matches
                      // and every query param it cares about matches the
                      // current URL's value for that param (falling back
                      // to each page's own default when the param is
                      // absent from the current URL — e.g. Fees with no
                      // ?tab= defaults to 'monthly', Tracking with no
                      // ?mode= defaults to 'student').
                      const defaults: Record<string, string> = { tab: 'monthly', mode: 'student', period: 'month' };
                      const isActive =
                        pathname === sPath &&
                        Array.from(sParams.entries()).every(
                          ([k, v]) => (searchParams.get(k) ?? defaults[k]) === v
                        );
                      return (
                        <Link
                          key={s.href}
                          href={s.href}
                          className={isActive ? 'active' : ''}
                          onClick={() => setOpenSection(null)}
                        >
                          {s.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
=======
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
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
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
<<<<<<< HEAD
    {/* Drag handle and collapse toggle live OUTSIDE the <nav>
        deliberately: .navbar gets `transform: translateX(...)` while
        collapsed (see [data-sidebar-collapsed] .navbar in style.css),
        and a `transform` on an ancestor becomes the containing block
        for any `position: fixed` descendant — so if these buttons were
        inside .navbar they'd slide off-screen along with the sidebar
        instead of staying fixed to the viewport, leaving no visible
        way to bring the sidebar back. Sitting outside .navbar (as
        siblings, both still `position: fixed`) means they always
        resolve against the viewport regardless of the sidebar's own
        transform. */}
    <div
      className="sidebar-resize-handle"
      onMouseDown={handleResizeStart}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
    />
    {/* Collapse toggle: a small round button pinned near the top of
        the sidebar's edge. Clicking it hides the sidebar entirely and
        the page content slides over to fill the freed space (see
        [data-sidebar-collapsed] rules in style.css); clicking again
        brings it back. Desktop-only, same as the resize handle. */}
    <button
      type="button"
      className="sidebar-collapse-toggle"
      onClick={handleToggleCollapsed}
      aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
      title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    </>
  );
}
=======
  );
}
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
