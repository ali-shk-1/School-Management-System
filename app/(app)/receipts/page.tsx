'use client';

/**
 * app/receipts/page.tsx — direct port of frontend/receipts.html.
 * Read-only ledger of every fee receipt issued (sequential receipt
 * numbers), with a from/to date filter plus a free-text search across
 * receipt #, name, roll no., and class.
 */

import { useEffect, useMemo, useState } from 'react';
import AuthedPage from '@/components/AuthedPage';
import Avatar from '@/components/Avatar';
import { api, dbg, formatDate, formatMoney } from '@/lib/api-client';
import { loadMyPermissions, refreshMyPermissions } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';

interface ReceiptRow {
  receipt_no: number | string;
  student_name?: string;
  roll_no?: number | string | null;
  class?: string;
  section?: string;
  academic_month?: string;
  amount_due?: number | string;
  amount_paid?: number | string;
  print_mode?: string;
  issued_at?: string;
  issued_by?: string;
  photo_url?: string | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Same month-label formatting used across the Fees pages, so a stored
// 'YYYY-MM-01' date reads as e.g. "August 2026" here too.
function monthLabel(d?: string | null): string {
  if (!d) return '—';
  const m = String(d).match(/^(\d{4})-(\d{2})/);
  if (!m) return '—';
  return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

export default function ReceiptsPage() {
  return (
    <AuthedPage activePage="receipts">
      <ReceiptsContent />
    </AuthedPage>
  );
}

function ReceiptsContent() {
  const [permTick, setPermTick] = useState(0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [list, setList] = useState<ReceiptRow[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function loadReceipts() {
    setLoadFailed(false);
    try {
      const params: string[] = [];
      if (from) params.push(`from=${from}`);
      if (to) params.push(`to=${to}`);
      // Perf/correctness: search now goes to the server (backed by the
      // payment_receipts trgm index) instead of filtering only whatever
      // page of rows happened to already be loaded — otherwise, once the
      // backend caps unfiltered results by default, a search with no
      // date range set would silently only search the most recent page
      // of receipts instead of the full history, which defeats the
      // point of "verify this receipt number is legitimate".
      const q = search.trim().replace(/^#/, '');
      if (q) params.push(`search=${encodeURIComponent(q)}`);
      // No filters at all (first load, or Clear pressed): explicitly ask
      // for everything rather than silently relying on the server's
      // default page size, since this page still does its own client-side
      // rendering of the full result set.
      if (!from && !to && !q) params.push('limit=0');
      const qs = params.length ? `?${params.join('&')}` : '';
      const data = await api('GET', `/api/fees/receipts${qs}`);
      dbg('receipts', data);
      setList((data as any)?.receipts || []);
      setLoaded(true);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setLoadFailed(true);
      setLoaded(true);
    }
  }

  function clearFilters() {
    setFrom('');
    setTo('');
    setSearch('');
  }

  useEffect(() => {
    (async () => {
      await loadMyPermissions();
      setPermTick((n) => n + 1);
      await loadReceipts();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadReceipts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  // Search now hits the server (see loadReceipts), so debounce it —
  // otherwise every keystroke would fire its own request. 300ms matches
  // the debounce already used for live-update refreshes elsewhere.
  useEffect(() => {
    const t = setTimeout(() => {
      loadReceipts();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useLiveUpdates({
    'fees.changed': () => loadReceipts(),
    'permissions.changed': () => refreshMyPermissions(() => setPermTick((n) => n + 1)),
  });

  // The server now applies the search filter (see loadReceipts), so
  // `list` already reflects it — kept as a pass-through so the render
  // logic below doesn't need to change.
  const filtered = list;

  // Perf: cap rendered rows regardless of how many receipts have ever
  // been issued — same reasoning as the Students page.
  const PAGE_SIZE = 100;
  const [tablePage, setTablePage] = useState(1);
  useEffect(() => {
    setTablePage(1);
  }, [list]);
  const totalTablePages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const pagedReceipts = useMemo(
    () => filtered.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE),
    [filtered, tablePage]
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Receipts</h1>
      </div>

      <div className="text-muted text-xs mb-3">
        Every fee payment gets a sequential receipt number automatically. Use this list to confirm a printed or
        reported receipt number is legitimate — no receipt images are stored here, only the record details.
      </div>

      <div className="card mb-3">
        <div className="filters">
          <label className="text-muted text-xs" htmlFor="receipts-filter-from">
            From:
          </label>
          <input id="receipts-filter-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <label className="text-muted text-xs" htmlFor="receipts-filter-to">
            To:
          </label>
          <input id="receipts-filter-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn btn-outline btn-sm" onClick={clearFilters}>
            Clear
          </button>
        </div>
        <div className="filters mb-0">
          <input
            type="text"
            placeholder="Search receipt #, name, roll no., or class…"
            className="mini-input flex-1 min-w-[220px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {loaded && !loadFailed && (
            <span className="text-[13px] font-semibold text-muted whitespace-nowrap">
              {filtered.length} receipt{filtered.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Receipt #</th>
                <th>Photo</th>
                <th>Student</th>
                <th>Roll</th>
                <th>Class</th>
                <th>Month</th>
                <th>Due</th>
                <th>Paid</th>
                <th>Mode</th>
                <th>Issued</th>
                <th>Issued By</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr>
                  <td colSpan={11} className="loading">
                    Loading…
                  </td>
                </tr>
              ) : loadFailed ? (
                <tr>
                  <td colSpan={11} className="empty">
                    Failed to load.
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="empty">
                    No receipts found.
                  </td>
                </tr>
              ) : (
                pagedReceipts.map((r) => (
                  <tr key={r.receipt_no}>
                    <td>
                      <strong>#{r.receipt_no}</strong>
                    </td>
                    <td>
                      <Avatar src={r.photo_url} name={r.student_name || '?'} />
                    </td>
                    <td>{r.student_name || '—'}</td>
                    <td>{r.roll_no ?? '—'}</td>
                    <td>
                      {r.class || ''}
                      {r.section ? '-' + r.section : ''}
                    </td>
                    <td>{monthLabel(r.academic_month)}</td>
                    <td>{formatMoney(r.amount_due)}</td>
                    <td className="amount-success">{formatMoney(r.amount_paid)}</td>
                    <td>
                      <span className={`mode-pill ${r.print_mode === 'thermal' ? 'thermal' : 'paper'}`}>
                        {r.print_mode === 'thermal' ? 'Thermal' : 'Paper'}
                      </span>
                    </td>
                    <td>{r.issued_at ? formatDate(r.issued_at) : '—'}</td>
                    <td>{r.issued_by || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {loaded && !loadFailed && totalTablePages > 1 && (
          <div className="pagination-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 0' }}>
            <button
              className="btn btn-outline btn-sm"
              disabled={tablePage <= 1}
              onClick={() => setTablePage((p) => Math.max(p - 1, 1))}
            >
              Prev
            </button>
            <span className="text-muted text-xs">
              Page {tablePage} of {totalTablePages} ({filtered.length} receipts)
            </span>
            <button
              className="btn btn-outline btn-sm"
              disabled={tablePage >= totalTablePages}
              onClick={() => setTablePage((p) => Math.min(p + 1, totalTablePages))}
            >
              Next
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        .mode-pill {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .mode-pill.paper {
          background: var(--panel-2, #eef1f7);
          color: #3a4a6b;
        }
        .mode-pill.thermal {
          background: #fdeee9;
          color: #b3542b;
        }
        /* These pills use fixed light-mode pastel colors (like the app's
           other badges did before), which read fine on a light page but
           lose contrast once the background goes dark. Brighten them for
           dark mode specifically, matching .badge-info/.badge-warning in
           style.css. :global() is needed since <style jsx> is scoped to
           this component and [data-theme="dark"] lives on <html>, outside
           that scope. */
        :global([data-theme='dark']) .mode-pill.paper {
          background: #1b2e40;
          color: #8fc4f5;
        }
        :global([data-theme='dark']) .mode-pill.thermal {
          background: #3d201d;
          color: #ff9c8f;
        }
      `}</style>
    </div>
  );
}