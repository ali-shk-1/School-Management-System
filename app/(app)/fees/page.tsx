'use client';

/**
 * app/fees/page.tsx — direct port of frontend/fees.html.
 *
 * Same four tabs (Monthly Records / Daily Collections / Monthly
 * Defaulters / Student History), same Record Payment + edit-existing
 * modal, same paper/thermal receipt printing (two full inline HTML
 * documents opened in a new tab, same markup/CSS as the original —
 * this is intentional: the receipt is printed from its own window, not
 * rendered as part of the app UI), same `?action=record-payment` query
 * contract (dashboard's "Record Fee" button links here).
 *
 * Permissions (fees.add / fees.edit / fees.delete / fees.custom_date)
 * read from the shared permissions-client cache, same as the original's
 * hasPerm() calls.
 */

import { Fragment, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import AuthedPage from '@/components/AuthedPage';
import Avatar from '@/components/Avatar';
import { api, apiForm as _apiForm, bindPanelKeyboardNavigation, dbg, formatDate, formatMoney, normalizeList } from '@/lib/api-client';
import { showToast } from '@/lib/toast';
import { hasPerm, loadMyPermissions, refreshMyPermissions } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';

// ---- Types (shapes match what the API routes return, per api/fees/*) ----
interface StudentLite {
  student_id: number;
  first_name: string;
  last_name: string | null;
  roll_no: number | null;
  class: string;
  section: string;
  gender: 'male' | 'female' | null;
  father_name?: string | null;
  contact_1?: string | null;
  photo_url?: string | null;
}

interface FeeRow {
  payment_id?: number;
  receipt_no?: number | string;
  student_id: number;
  first_name: string;
  last_name: string | null;
  roll_no: number | null;
  class: string;
  section: string;
  gender: 'male' | 'female' | null;
  academic_month: string;
  amount_due: number | string;
  amount_paid: number | string;
  balance?: number | string;
  payment_date?: string | null;
  contact_1?: string | null;
  father_name?: string | null;
  photo_url?: string | null;
  this_payment_amount?: number | string;
}

interface ReceiptData {
  receipt_no: number | string;
  roll_no: number | string;
  student_name: string;
  class_section: string;
  father_name: string;
  contact_1: string;
  photo_url: string;
  academic_month: string;
  amount_due: number;
  amount_paid: number;
  balance: number;
  payment_date: Date;
  total_fee: number | null;
  discount: number | null;
}

interface ClassFeeRow {
  class_fee_id: number;
  class: string;
  total_fee: number | string;
  updated_at?: string;
  updated_by?: string | null;
}

<<<<<<< HEAD
interface StudentFeeRow {
  student_fee_id: number;
  student_id: number;
  total_fee: number | string;
  updated_at?: string;
  updated_by?: string | null;
  student?: {
    student_id: number;
    roll_no: number | null;
    class: string;
    section: string;
    first_name: string;
    last_name: string | null;
  } | null;
}

=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
// Canonical class list for the Total Fee settings page — playgroup/
// prep/nursery come first (as taught), then grades 1-10. students.class
// is free text in the DB, so this is just the standard set offered in
// the "Add" dropdown; any class actually in use can still be added.
const CLASS_LIST = [
  'Playgroup', 'Nursery', 'Prep',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
];

const SCHOOL_NAME = 'AL Siddeeq Model High School Rawalpindi';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Parses 'YYYY-MM-DD'/'YYYY-MM' directly into "Month YYYY" without ever
// constructing `new Date(...)` — that path is timezone-sensitive and can
// silently shift the displayed month backward by one.
function monthLabel(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})/);
  if (!m) return '—';
  const [, year, month] = m;
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

// Abbreviated month ("Aug 2026") — used where space is tight (e.g. the
// Fee Month badge) so it stays on one line instead of wrapping.
function monthLabelShort(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})/);
  if (!m) return '—';
  const [, year, month] = m;
  return `${MONTH_NAMES[Number(month) - 1].slice(0, 3)} ${year}`;
}

// Bug fix — "Fee Submitted"/Time columns were showing a time 5 hours
// AHEAD of the real deposit time (e.g. 18:20 printed for an actual
// 13:20 submission). payment_date is a Postgres `timestamp` column
// with NO time zone: Postgres's now() (and the ::DATE + CURRENT_TIME
// expression used for custom-dated payments — see app/api/fees/route.ts)
// stores the wall-clock value AS-IS, already in Pakistan local time,
// with no UTC conversion. But Prisma/$queryRaw serializes that naive
// Date to JSON as an ISO string with a trailing "Z" (e.g.
// "2026-08-13T13:20:00.000Z"), which *falsely claims* that literal
// 13:20 is UTC. The backend's own formatPaymentDate() (app/api/fees/
// route.ts) already works around this — for receipt emails — by
// reading the Date back with getUTC*() accessors instead of local
// ones, deliberately bypassing any timezone conversion. This frontend
// never had that fix: `new Date(r.payment_date).toLocaleTimeString()`
// takes the falsely-UTC-labeled 13:20, and — because the browser here
// is *also* in Pakistan (UTC+5) — re-applies the +5 offset on top of
// it, landing on 18:20. Reading with getUTC*() here too undoes the
// double-shift and shows the real submitted time.
function localPaymentDate(dt: Date): Date {
  return new Date(
    dt.getUTCFullYear(),
    dt.getUTCMonth(),
    dt.getUTCDate(),
    dt.getUTCHours(),
    dt.getUTCMinutes(),
    dt.getUTCSeconds()
  );
}

// For a payment_date value fetched from the API (see localPaymentDate
// above for why this workaround is needed).
function fmtPaymentDateTime(dt: Date): string {
  const local = localPaymentDate(dt);
  const datePart = local.toLocaleDateString('en-GB');
  const timePart = local.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${datePart}, ${timePart}`;
}

// For an honest "right now" Date (e.g. `new Date()` at print time) —
// NOT a value read back from payment_date, so no UTC-relabeling
// workaround applies here; format it as ordinary local time.
function fmtDateTime(dt: Date): string {
  const datePart = dt.toLocaleDateString('en-GB');
  const timePart = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${datePart}, ${timePart}`;
}

// Security: receipt printing builds a full HTML document via string
// interpolation and injects it into a popup with document.write(). Fields
// like student name, father's name, class/section, and contact number are
// ordinary user-editable data (entered via the Students form) — without
// escaping, a record containing e.g. `<script>` in its name would execute
// in the print popup for whoever prints that receipt. Escape any such
// value before interpolating it into the receipt HTML.
function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

function getPrintMode(): 'paper' | 'thermal' {
  if (typeof window === 'undefined') return 'paper';
  return localStorage.getItem('feePrintMode') === 'thermal' ? 'thermal' : 'paper';
}
function setPrintModeStorage(mode: 'paper' | 'thermal') {
  localStorage.setItem('feePrintMode', mode === 'thermal' ? 'thermal' : 'paper');
}

function groupDefaultersByMonth(data: FeeRow[]) {
  const groups: Record<string, FeeRow[]> = {};
  data.forEach((r) => {
    const key = String(r.academic_month || '').slice(0, 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });
  return Object.keys(groups)
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({ academic_month: key, count: groups[key].length, defaulters: groups[key] }));
}

const todayStr = new Date().toISOString().slice(0, 10);
const monthStr = new Date().toISOString().slice(0, 7);

export default function FeesPage() {
  return (
    <AuthedPage activePage="fees">
      <Suspense fallback={null}>
        <FeesContent />
      </Suspense>
    </AuthedPage>
  );
}

<<<<<<< HEAD
const FEE_TABS = ['monthly', 'daily', 'monthly-defaulters', 'history', 'total-fee', 'student-fee'] as const;
=======
const FEE_TABS = ['monthly', 'daily', 'monthly-defaulters', 'history', 'total-fee'] as const;
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
type FeeTab = (typeof FEE_TABS)[number];

function isFeeTab(v: string | null): v is FeeTab {
  return !!v && (FEE_TABS as readonly string[]).includes(v);
}

function FeesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [permTick, setPermTick] = useState(0);
  const canAddFees = () => hasPerm('fees.add');
  const canEditFees = () => hasPerm('fees.edit');
  const canDeleteFees = () => hasPerm('fees.delete');
  const canCustomDateFees = () => hasPerm('fees.custom_date');

  const canAddClassFees = () => hasPerm('class-fees.add');
  const canEditClassFees = () => hasPerm('class-fees.edit');
  const canDeleteClassFees = () => hasPerm('class-fees.delete');

<<<<<<< HEAD
  const canAddStudentFees = () => hasPerm('student-fees.add');
  const canEditStudentFees = () => hasPerm('student-fees.edit');
  const canDeleteStudentFees = () => hasPerm('student-fees.delete');

=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
  const [allStudents, setAllStudents] = useState<StudentLite[]>([]);

  const initialTabParam = searchParams.get('tab');
  const [tab, setTabState] = useState<FeeTab>(isFeeTab(initialTabParam) ? initialTabParam : 'monthly');

  // Keep the URL's ?tab= in sync with the active tab so it's shareable /
  // bookmarkable and survives back/forward navigation. Uses replace (not
  // push) so switching tabs doesn't spam browser history, and preserves
  // any other existing query params (e.g. ?action=...).
  function setTab(next: FeeTab) {
    setTabState(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'monthly') {
      params.delete('tab');
    } else {
      params.set('tab', next);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // ---- Stats ----
  const [statCollected, setStatCollected] = useState('—');
  const [statDefaulters, setStatDefaulters] = useState<string | number>('—');
  const [statToday, setStatToday] = useState('—');

  // ---- Monthly tab ----
  const [monthFilter, setMonthFilter] = useState(monthStr);
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [feeFilterBoys, setFeeFilterBoys] = useState(false);
  const [feeFilterGirls, setFeeFilterGirls] = useState(false);
  const [feeSearch, setFeeSearch] = useState('');
  const [monthlyData, setMonthlyData] = useState<FeeRow[]>([]);
  const [monthlyLoadFailed, setMonthlyLoadFailed] = useState(false);

  // ---- Daily tab ----
  const [dailyDateFilter, setDailyDateFilter] = useState(todayStr);
  const [dailyFilterBoys, setDailyFilterBoys] = useState(false);
  const [dailyFilterGirls, setDailyFilterGirls] = useState(false);
  const [dailyList, setDailyList] = useState<FeeRow[]>([]);
  const [dailyLoadFailed, setDailyLoadFailed] = useState(false);
  const [dailyLoaded, setDailyLoaded] = useState(false);

  // ---- Monthly defaulters tab ----
<<<<<<< HEAD
  // Blank by default (same pattern as Tracking's Student Track): nothing is
  // fetched/rendered until the user either toggles a specific month or
  // presses "Show All" (which shows every overdue month). "Clear" resets
  // back to blank.
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
  const [defMonthFilter, setDefMonthFilter] = useState(monthStr);
  const [defFilterBoys, setDefFilterBoys] = useState(false);
  const [defFilterGirls, setDefFilterGirls] = useState(false);
  const [defSearch, setDefSearch] = useState('');
  const [defClassFilter, setDefClassFilter] = useState('');
  const [defSectionFilter, setDefSectionFilter] = useState('');
  const [defaultersList, setDefaultersList] = useState<FeeRow[]>([]);
  const [defaultersLoadFailed, setDefaultersLoadFailed] = useState(false);
  const [defaultersLoaded, setDefaultersLoaded] = useState(false);
<<<<<<< HEAD
  // false/null = blank state; 'month' = showing only defMonthFilter's
  // defaulters; 'all' = "Show All" pressed, showing every overdue month.
  const [defaultersView, setDefaultersView] = useState<'blank' | 'month' | 'all'>('blank');
  const DEFAULTERS_PAGE_SIZE = 100;
  const [defaultersPage, setDefaultersPage] = useState(1);
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e

  // ---- History tab ----
  const [historySearch, setHistorySearch] = useState('');
  const [historyResultsOpen, setHistoryResultsOpen] = useState(false);
  const [historyStudentId, setHistoryStudentId] = useState<number | null>(null);
  const [historyList, setHistoryList] = useState<FeeRow[]>([]);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyWrapRef = useRef<HTMLDivElement>(null);

  // ---- Total Fee tab (global per-class fee settings) ----
  const [classFees, setClassFees] = useState<ClassFeeRow[]>([]);
  const [classFeesLoaded, setClassFeesLoaded] = useState(false);
  const [classFeesLoadFailed, setClassFeesLoadFailed] = useState(false);
  const [newFeeClass, setNewFeeClass] = useState('');
  const [newFeeAmount, setNewFeeAmount] = useState('');
  const [editingClassFeeId, setEditingClassFeeId] = useState<number | null>(null);
  const [editingClassFeeAmount, setEditingClassFeeAmount] = useState('');

<<<<<<< HEAD
  // ---- Students Fee tab (per-student total fee override) ----
  const [studentFees, setStudentFees] = useState<StudentFeeRow[]>([]);
  const [studentFeesLoaded, setStudentFeesLoaded] = useState(false);
  const [studentFeesLoadFailed, setStudentFeesLoadFailed] = useState(false);
  const [newStudentFeeSearch, setNewStudentFeeSearch] = useState('');
  const [newStudentFeeResultsOpen, setNewStudentFeeResultsOpen] = useState(false);
  const [newStudentFeeStudentId, setNewStudentFeeStudentId] = useState<number | null>(null);
  const [newStudentFeeAmount, setNewStudentFeeAmount] = useState('');
  const [editingStudentFeeId, setEditingStudentFeeId] = useState<number | null>(null);
  const [editingStudentFeeAmount, setEditingStudentFeeAmount] = useState('');
  const newStudentFeeWrapRef = useRef<HTMLDivElement>(null);
  // Search + pagination (20/page) for the Students Fee tab list below the add form.
  const [studentFeeListSearch, setStudentFeeListSearch] = useState('');
  const STUDENT_FEE_PAGE_SIZE = 20;
  const [studentFeePage, setStudentFeePage] = useState(1);

=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
  // ---- Print mode toggle ----
  const [thermalMode, setThermalMode] = useState(false);

  // ---- Payment modal ----
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payModalTitle, setPayModalTitle] = useState('Record Fee Payment');
  const [paySaveLabel, setPaySaveLabel] = useState('Record Payment');
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [payStudentSearch, setPayStudentSearch] = useState('');
  const [payStudentSel, setPayStudentSel] = useState<number | ''>('');
  const [payResultsOpen, setPayResultsOpen] = useState(false);
  const [payStudentDisabled, setPayStudentDisabled] = useState(false);
  const [payMonth, setPayMonth] = useState(monthStr);
  const [payMonthDisabled, setPayMonthDisabled] = useState(false);
  const [payDue, setPayDue] = useState('');
  const [payPaid, setPayPaid] = useState('');
  const [existingPayInfo, setExistingPayInfo] = useState('');
  const [payRecentHistory, setPayRecentHistory] = useState<FeeRow[]>([]);
  const [showCustomDateGroup, setShowCustomDateGroup] = useState(false);
  const [useCustomDate, setUseCustomDate] = useState(false);
  const [customDate, setCustomDate] = useState(todayStr);
  const payWrapRef = useRef<HTMLDivElement>(null);
  const payFormRef = useRef<HTMLFormElement>(null);

  // ---- Receipt modal ----
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  async function loadStudents() {
    try {
<<<<<<< HEAD
      // ?limit=0 = unbounded. /api/students defaults to a 100-row page
      // (see app/api/students/route.ts) for the Students list's own
      // pagination — but this page loads the roster once into memory
      // and searches it client-side for History / Pay Student / Student
      // Fee, so a capped fetch here silently hid every student past
      // the 100th (ordered by class/section/roll_no) from all three
      // pickers, even though they exist and show up fine on /students.
      const res = await api('GET', '/api/students?limit=0');
=======
      const res = await api('GET', '/api/students');
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
      const list = normalizeList<StudentLite>(res, ['students', 'data']);
      list.sort((a, b) => a.class.localeCompare(b.class) || (a.roll_no ?? 0) - (b.roll_no ?? 0));
      setAllStudents(list);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }

  async function loadStats(month = monthFilter) {
    try {
      const [feeSum, todayFees, monthlyDefaultersRes] = await Promise.all([
        api('GET', `/api/fees/summary/monthly?month=${month}-01`),
        api('GET', `/api/fees/daily?date=${todayStr}`),
        api('GET', `/api/fees/monthly-defaulters?month=${month}-01`),
      ]);

      setStatCollected(formatMoney((feeSum as any)?.total_paid || 0));

      const defList = normalizeList<FeeRow>(monthlyDefaultersRes, ['defaulters']);
      const defaulterCount =
        (monthlyDefaultersRes as any)?.total_overdue_months ??
        defList.reduce((sum, r: any) => sum + (+r.overdue_months || 0), 0);
      setStatDefaulters(defaulterCount);

      const todayTotal = normalizeList<FeeRow>(todayFees, ['payments', 'data']).reduce(
        (s, r) => s + (+r.amount_paid || 0),
        0
      );
      setStatToday(formatMoney(todayTotal));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('loadStats error:', e);
    }
  }

  async function loadMonthlyRecords() {
    setMonthlyLoadFailed(false);
    try {
      let url = `/api/fees?month=${monthFilter}-01`;
      if (classFilter) url += `&class=${classFilter}`;
      const raw = await api('GET', url);
      dbg('fees monthly raw', raw);
      setMonthlyData(normalizeList<FeeRow>(raw, ['fees', 'payments', 'data']));
      loadStats();
    } catch {
      setMonthlyLoadFailed(true);
    }
  }

  async function loadDailyRecords() {
    setDailyLoadFailed(false);
    try {
      const raw = await api('GET', `/api/fees/daily?date=${dailyDateFilter}`);
      setDailyList(normalizeList<FeeRow>(raw, ['payments', 'data']));
      setDailyLoaded(true);
    } catch {
      setDailyLoadFailed(true);
      setDailyLoaded(true);
    }
  }

  async function loadMonthlyDefaulters() {
    setDefaultersLoadFailed(false);
    try {
<<<<<<< HEAD
      // The API returns every overdue month up to & including the given
      // month (cumulative). "Show All" asks for everything through the
      // current month; toggling a specific month still fetches through
      // that month, but the UI then narrows display to just that one
      // month client-side (see filteredDefaulters below).
      const targetMonth = defaultersView === 'all' ? monthStr : defMonthFilter;
      const raw = await api('GET', `/api/fees/monthly-defaulters?month=${targetMonth}-01`);
=======
      const raw = await api('GET', `/api/fees/monthly-defaulters?month=${defMonthFilter}-01`);
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
      setDefaultersList(normalizeList<FeeRow>(raw, ['defaulters', 'data']));
      setDefaultersLoaded(true);
    } catch {
      setDefaultersLoadFailed(true);
      setDefaultersLoaded(true);
    }
  }

  async function loadStudentHistory(id: number | null) {
    if (!id) return;
    setHistoryLoadFailed(false);
    try {
      const res = await api('GET', `/api/fees/student/${id}`);
      dbg('student history raw', res);
      const data = normalizeList<FeeRow>(res, ['payments', 'fees', 'data']);
      setHistoryList(data);
      setHistoryLoaded(true);
    } catch {
      setHistoryLoadFailed(true);
      setHistoryLoaded(true);
    }
  }

  async function loadClassFees() {
    setClassFeesLoadFailed(false);
    try {
      const raw = await api('GET', '/api/class-fees');
      setClassFees(normalizeList<ClassFeeRow>(raw, ['class_fees', 'data']));
      setClassFeesLoaded(true);
    } catch {
      setClassFeesLoadFailed(true);
      setClassFeesLoaded(true);
    }
  }

  async function addClassFee() {
    const cls = newFeeClass.trim();
    const amount = parseFloat(newFeeAmount);
    if (!cls) {
      showToast('Select a class.', 'error');
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      showToast('Enter a valid total fee amount.', 'error');
      return;
    }
    try {
      await api('POST', '/api/class-fees', { class: cls, total_fee: amount });
      showToast('Total fee saved.', 'success');
      setNewFeeClass('');
      setNewFeeAmount('');
      loadClassFees();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  function startEditClassFee(row: ClassFeeRow) {
    setEditingClassFeeId(row.class_fee_id);
    setEditingClassFeeAmount(String(row.total_fee));
  }
  function cancelEditClassFee() {
    setEditingClassFeeId(null);
    setEditingClassFeeAmount('');
  }
  async function saveEditClassFee(id: number) {
    const amount = parseFloat(editingClassFeeAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      showToast('Enter a valid total fee amount.', 'error');
      return;
    }
    try {
      await api('PUT', `/api/class-fees/${id}`, { total_fee: amount });
      showToast('Total fee updated.', 'success');
      cancelEditClassFee();
      loadClassFees();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }
  async function deleteClassFee(id: number) {
    if (!confirm('Delete the total fee record for this class?')) return;
    try {
      await api('DELETE', `/api/class-fees/${id}`);
      showToast('Total fee record deleted.', 'success');
      loadClassFees();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  // Classes not yet configured — offered in the "Add" dropdown.
  const availableClassesToAdd = useMemo(() => {
    const used = new Set(classFees.map((c) => c.class));
    return CLASS_LIST.filter((c) => !used.has(c));
  }, [classFees]);

<<<<<<< HEAD
  async function loadStudentFees() {
    setStudentFeesLoadFailed(false);
    try {
      const raw = await api('GET', '/api/student-fees');
      setStudentFees(normalizeList<StudentFeeRow>(raw, ['student_fees', 'data']));
      setStudentFeesLoaded(true);
    } catch {
      setStudentFeesLoadFailed(true);
      setStudentFeesLoaded(true);
    }
  }

  async function addStudentFee() {
    const studentId = newStudentFeeStudentId;
    const amount = parseFloat(newStudentFeeAmount);
    if (!studentId) {
      showToast('Select a student.', 'error');
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      showToast('Enter a valid total fee amount.', 'error');
      return;
    }
    try {
      await api('POST', '/api/student-fees', { student_id: studentId, total_fee: amount });
      showToast('Student total fee saved.', 'success');
      setNewStudentFeeSearch('');
      setNewStudentFeeStudentId(null);
      setNewStudentFeeAmount('');
      loadStudentFees();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  function startEditStudentFee(row: StudentFeeRow) {
    setEditingStudentFeeId(row.student_fee_id);
    setEditingStudentFeeAmount(String(row.total_fee));
  }
  function cancelEditStudentFee() {
    setEditingStudentFeeId(null);
    setEditingStudentFeeAmount('');
  }
  async function saveEditStudentFee(id: number) {
    const amount = parseFloat(editingStudentFeeAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      showToast('Enter a valid total fee amount.', 'error');
      return;
    }
    try {
      await api('PUT', `/api/student-fees/${id}`, { total_fee: amount });
      showToast('Student total fee updated.', 'success');
      cancelEditStudentFee();
      loadStudentFees();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }
  async function deleteStudentFee(id: number) {
    if (!confirm('Delete the total fee record for this student?')) return;
    try {
      await api('DELETE', `/api/student-fees/${id}`);
      showToast('Student total fee record deleted.', 'success');
      loadStudentFees();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  // Students not yet configured — offered in the "Add" search below.
  const newStudentFeeMatches = useMemo(() => {
    const used = new Set(studentFees.map((r) => r.student_id));
    const pool = allStudents.filter((s) => !used.has(s.student_id));
    const q = newStudentFeeSearch.trim().toLowerCase();
    const matches = q
      ? pool.filter(
          (s) =>
            `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
            String(s.roll_no).includes(q) ||
            `${s.class}-${s.section}`.toLowerCase().includes(q)
        )
      : pool;
    return matches.slice(0, 50);
  }, [allStudents, studentFees, newStudentFeeSearch]);

  // Search + pagination (20/page) over the configured Students Fee list itself.
  const deferredStudentFeeListSearch = useDeferredValue(studentFeeListSearch);
  const filteredStudentFees = useMemo(() => {
    const q = deferredStudentFeeListSearch.trim().toLowerCase();
    if (!q) return studentFees;
    return studentFees.filter((row) => {
      const name = row.student ? `${row.student.first_name} ${row.student.last_name || ''}` : '';
      const cls = row.student ? `${row.student.class}-${row.student.section}` : '';
      return name.toLowerCase().includes(q) || cls.toLowerCase().includes(q) || String(row.student_id).includes(q);
    });
  }, [studentFees, deferredStudentFeeListSearch]);
  useEffect(() => {
    setStudentFeePage(1);
  }, [deferredStudentFeeListSearch, studentFees]);
  const studentFeeTotalPages = Math.max(Math.ceil(filteredStudentFees.length / STUDENT_FEE_PAGE_SIZE), 1);
  const pagedStudentFees = useMemo(
    () => filteredStudentFees.slice((studentFeePage - 1) * STUDENT_FEE_PAGE_SIZE, studentFeePage * STUDENT_FEE_PAGE_SIZE),
    [filteredStudentFees, studentFeePage]
  );

  function studentFeePickerLabel(s: StudentLite) {
    return `${s.class}-${s.section} | ${s.first_name} ${s.last_name}`;
  }
  function selectNewStudentFeeStudent(studentId: number) {
    const student = allStudents.find((s) => s.student_id === studentId);
    setNewStudentFeeSearch(student ? studentFeePickerLabel(student) : '');
    setNewStudentFeeStudentId(studentId);
    setNewStudentFeeResultsOpen(false);
  }

  // Looked up from the Record Payment form (see the Total Fee field
  // next to Father's Name) — a student's own override wins, otherwise
  // fall back to their class's total fee, otherwise null (field hides).
  function totalFeeForStudent(student: StudentLite | undefined | null): number | null {
    if (!student) return null;
    const own = studentFees.find((r) => r.student_id === student.student_id);
    if (own) return +own.total_fee;
    const classLabel = baseClassFromSection(`${student.class}-${student.section}`) || student.class;
    const classFeeRow = classFees.find((c) => c.class === classLabel);
    return classFeeRow ? +classFeeRow.total_fee : null;
  }

=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
  // class_section is stored as e.g. "5-A" / "Nursery-A" — strip the
  // trailing "-<section>" to get the plain class label for lookups.
  function baseClassFromSection(classSection: string): string {
    return classSection.replace(/-[^-]*$/, '');
  }

  // Keep tab state in sync when the URL's ?tab= changes from outside a
  // setTab() call (e.g. browser back/forward, or an external link landing
  // directly on a specific tab).
  useEffect(() => {
    const urlTab = searchParams.get('tab');
    const resolved: FeeTab = isFeeTab(urlTab) ? urlTab : 'monthly';
    setTabState((current) => (current === resolved ? current : resolved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    (async () => {
      const isThermal = getPrintMode() === 'thermal';
      setThermalMode(isThermal);
      await loadMyPermissions();
      setPermTick((n) => n + 1);
      await loadStudents();
      await loadMonthlyRecords();
      loadStats();
      loadClassFees();

      const action = searchParams.get('action');
      if (action === 'record-payment' && hasPerm('fees.add')) {
        openPayModal();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMonthlyRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthFilter, classFilter]);

  useEffect(() => {
    if (tab === 'daily') loadDailyRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dailyDateFilter]);

  useEffect(() => {
<<<<<<< HEAD
    // Blank by default: only fetch once the user has picked a month to
    // toggle to, or pressed "Show All" — never just on opening the tab.
    if (tab === 'monthly-defaulters' && defaultersView !== 'blank') loadMonthlyDefaulters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, defMonthFilter, defaultersView]);
=======
    if (tab === 'monthly-defaulters') loadMonthlyDefaulters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, defMonthFilter]);
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e

  useEffect(() => {
    if (historyStudentId) loadStudentHistory(historyStudentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyStudentId]);

  useEffect(() => {
    if (tab === 'total-fee' && !classFeesLoaded) loadClassFees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

<<<<<<< HEAD
  // Loaded lazily on first need — either the Students Fee tab itself,
  // or opening Record Payment (its Total Fee field next to Father's
  // Name looks student overrides up), whichever happens first.
  useEffect(() => {
    if ((tab === 'student-fee' || payModalOpen) && !studentFeesLoaded) loadStudentFees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, payModalOpen]);

=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
  useLiveUpdates({
    'fees.changed': () => {
      loadMonthlyRecords();
      loadStats();
      loadDailyRecords();
<<<<<<< HEAD
      if (defaultersView !== 'blank') loadMonthlyDefaulters();
=======
      loadMonthlyDefaulters();
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
    },
    'students.changed': () => loadStudents(),
    'permissions.changed': () => refreshMyPermissions(() => setPermTick((n) => n + 1)),
    'class-fees.changed': () => loadClassFees(),
<<<<<<< HEAD
    'student-fees.changed': () => loadStudentFees(),
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
  });

  useEffect(() => {
    if (payFormRef.current) {
      return bindPanelKeyboardNavigation(payFormRef.current);
    }
  }, [payModalOpen]);

  // Close payStudentResults / historyStudentResults on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const payWrap = payWrapRef.current;
      if (payWrap && !payWrap.contains(e.target as Node)) setPayResultsOpen(false);
      const histWrap = historyWrapRef.current;
      if (histWrap && !histWrap.contains(e.target as Node)) setHistoryResultsOpen(false);
<<<<<<< HEAD
      const newStudentFeeWrap = newStudentFeeWrapRef.current;
      if (newStudentFeeWrap && !newStudentFeeWrap.contains(e.target as Node)) setNewStudentFeeResultsOpen(false);
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  // Deferred search text: same technique as the Students page — typing
  // stays instantly responsive while the (larger, avatar-bearing) fee
  // tables trail a frame behind, so this tab never feels "stuck".
  const deferredFeeSearch = useDeferredValue(feeSearch);
  const deferredDefSearch = useDeferredValue(defSearch);

  // ---------------- Monthly tab filtering ----------------
  const filteredMonthly = useMemo(() => {
    const q = deferredFeeSearch.toLowerCase().trim();
    let list = monthlyData;
    if (q) {
      list = list.filter(
        (r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) || String(r.roll_no || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter) {
      list = list.filter((r) => {
        const due = +r.amount_due,
          paid = +r.amount_paid;
        if (statusFilter === 'paid') return paid >= due;
        if (statusFilter === 'partial') return paid > 0 && paid < due;
        if (statusFilter === 'unpaid') return paid === 0;
        return true;
      });
    }
    const wantBoys = feeFilterBoys,
      wantGirls = feeFilterGirls;
    if (wantBoys !== wantGirls) {
      list = list.filter((r) => (wantBoys && r.gender === 'male') || (wantGirls && r.gender === 'female'));
    }
    return list;
  }, [monthlyData, deferredFeeSearch, statusFilter, feeFilterBoys, feeFilterGirls]);

  const monthlyTableTitle = useMemo(() => {
    const count = filteredMonthly.length;
    const [y, m] = monthFilter.split('-');
    if (!y || !m) return `${count} Students Who Deposited Their Fee`;
    return `${count} Students Who Deposited Their Fee In ${MONTH_NAMES[Number(m) - 1]} ${y}`;
  }, [monthFilter, filteredMonthly]);

  // ---------------- Daily tab filtering ----------------
  const filteredDaily = useMemo(() => {
    let data = dailyList;
    const wantBoys = dailyFilterBoys,
      wantGirls = dailyFilterGirls;
    if (wantBoys !== wantGirls) {
      data = data.filter((r) => (wantBoys && r.gender === 'male') || (wantGirls && r.gender === 'female'));
    }
    return data;
  }, [dailyList, dailyFilterBoys, dailyFilterGirls]);
  const dailyTotal = useMemo(() => filteredDaily.reduce((s, r) => s + +r.amount_paid, 0), [filteredDaily]);

  // ---------------- Monthly defaulters filtering ----------------
  const filteredDefaulters = useMemo(() => {
<<<<<<< HEAD
    // Blank by default — nothing renders until "Show All" or a month toggle.
    if (defaultersView === 'blank') return [];
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
    const q = deferredDefSearch.toLowerCase().trim();
    let filtered = defaultersList.filter(
      (r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) || String(r.roll_no || '').toLowerCase().includes(q)
    );
<<<<<<< HEAD
    // Toggled to a single month: narrow the (cumulative) fetched data down
    // to just that month's defaulters, same as if it were fetched alone.
    if (defaultersView === 'month') {
      filtered = filtered.filter((r) => String(r.academic_month || '').slice(0, 7) === defMonthFilter);
    }
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
    const wantBoys = defFilterBoys,
      wantGirls = defFilterGirls;
    if (wantBoys !== wantGirls) {
      filtered = filtered.filter((r) => (wantBoys && r.gender === 'male') || (wantGirls && r.gender === 'female'));
    }
    if (defClassFilter) {
      filtered = filtered.filter((r) => String(r.class ?? '').toLowerCase().includes(defClassFilter.toLowerCase()));
    }
    if (defSectionFilter) {
      filtered = filtered.filter((r) => String(r.section ?? '').toLowerCase() === defSectionFilter.toLowerCase());
    }
    return filtered;
<<<<<<< HEAD
  }, [defaultersList, deferredDefSearch, defFilterBoys, defFilterGirls, defClassFilter, defSectionFilter, defaultersView, defMonthFilter]);

  // Reset to page 1 whenever the visible result set changes shape.
  useEffect(() => {
    setDefaultersPage(1);
  }, [filteredDefaulters]);
  const defaultersTotalPages = Math.max(Math.ceil(filteredDefaulters.length / DEFAULTERS_PAGE_SIZE), 1);
  const pagedDefaulters = useMemo(
    () => filteredDefaulters.slice((defaultersPage - 1) * DEFAULTERS_PAGE_SIZE, defaultersPage * DEFAULTERS_PAGE_SIZE),
    [filteredDefaulters, defaultersPage]
  );
  const groupedDefaulters = useMemo(() => groupDefaultersByMonth(pagedDefaulters), [pagedDefaulters]);
=======
  }, [defaultersList, deferredDefSearch, defFilterBoys, defFilterGirls, defClassFilter, defSectionFilter]);
  const groupedDefaulters = useMemo(() => groupDefaultersByMonth(filteredDefaulters), [filteredDefaulters]);
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e

  const historyTotals = useMemo(() => {
    let totalDue = 0,
      totalPaid = 0;
    historyList.forEach((r) => {
      totalDue += +r.amount_due || 0;
      totalPaid += +r.amount_paid || 0;
    });
    return { totalDue, totalPaid };
  }, [historyList]);

  const historyMatches = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    const matches = q
      ? allStudents.filter(
          (s) =>
            `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
            String(s.roll_no).includes(q) ||
            `${s.class}-${s.section}`.toLowerCase().includes(q)
        )
      : allStudents;
    return matches.slice(0, 50);
  }, [allStudents, historySearch]);

  const payMatches = useMemo(() => {
    const q = payStudentSearch.toLowerCase().trim();
    let matches = allStudents;
    if (q) {
      matches = allStudents.filter(
        (s) => String(s.roll_no || '').toLowerCase().includes(q) || `${s.first_name} ${s.last_name}`.toLowerCase().includes(q)
      );
    }
    return matches.slice(0, 30);
  }, [allStudents, payStudentSearch]);

  // ---------------- Print mode toggle ----------------
  function onPrintModeToggle(checked: boolean) {
    setThermalMode(checked);
    setPrintModeStorage(checked ? 'thermal' : 'paper');
  }

  // ---------------- Payment modal ----------------
  function openPayModal() {
    if (!canAddFees()) return;
    setEditingPaymentId(null);
    setPayStudentSel('');
    setPayStudentSearch('');
    setPayStudentDisabled(false);
    setPayMonthDisabled(false);
    setPayResultsOpen(false);
    setPayMonth(monthStr);
    setPayDue('');
    setPayPaid('');
    setExistingPayInfo('');
    setPayRecentHistory([]);
    setPayModalTitle('Record Fee Payment');
    setPaySaveLabel('Record Payment');
    setShowCustomDateGroup(canCustomDateFees());
    setUseCustomDate(false);
    setCustomDate(todayStr);
    setPayModalOpen(true);
  }

  function closePayModal() {
    setEditingPaymentId(null);
    setPayStudentDisabled(false);
    setPayMonthDisabled(false);
    setPayModalOpen(false);
  }

  function onUseCustomDateToggle(checked: boolean) {
    setUseCustomDate(checked);
    if (checked && !customDate) setCustomDate(todayStr);
  }

  function quickPay(studentId: number, name: string, due: number, paid: number, academicMonth: string) {
    openPayModal();
    setPayStudentSel(studentId);
    setPayStudentSearch(name);
    if (academicMonth) {
      setPayMonth(String(academicMonth).slice(0, 7));
      setPayMonthDisabled(true);
    }
    setPayDue(String(due));
    setPayPaid(String(due - paid));
    setPayModalTitle(academicMonth ? `Settle Balance — ${name} (${monthLabel(academicMonth)})` : `Record Payment — ${name}`);
    onStudentChangeFor(studentId, academicMonth ? String(academicMonth).slice(0, 7) : monthStr);
  }

  function editFeeRecord(paymentId: number, name: string, due: number, paid: number) {
    if (!canEditFees()) return;
    openPayModal();
    setEditingPaymentId(paymentId);
    setPayStudentSearch(name);
    setPayStudentDisabled(true);
    setPayMonthDisabled(true);
    setPayDue(String(due));
    setPayPaid(String(paid));
    setPayModalTitle(`Edit Payment — ${name}`);
    setPaySaveLabel('Save Changes');
    setShowCustomDateGroup(false);
  }

  function selectPayStudent(studentId: number) {
    const s = allStudents.find((st) => st.student_id === studentId);
    if (!s) return;
    setPayStudentSel(studentId);
    setPayStudentSearch(`Roll ${s.roll_no} — ${s.first_name} ${s.last_name}`);
    setPayResultsOpen(false);
    onStudentChangeFor(studentId, payMonth, true);
  }

  // Builds the last-4-calendar-months list (most recent first, ending at
  // `anchorMonth`) as "YYYY-MM" strings — always 4 entries regardless of
  // whether a payment exists for each one.
  function lastFourMonths(anchorMonth: string): string[] {
    const m = String(anchorMonth || monthStr).match(/^(\d{4})-(\d{2})$/);
    const [y, mo] = m ? [Number(m[1]), Number(m[2])] : [new Date().getFullYear(), new Date().getMonth() + 1];
    const out: string[] = [];
    for (let i = 0; i < 4; i++) {
      let year = y;
      let month = mo - i;
      while (month <= 0) {
        month += 12;
        year -= 1;
      }
      out.push(`${year}-${String(month).padStart(2, '0')}`);
    }
    return out;
  }

  async function onStudentChangeFor(id: number | string, month: string, forceRefresh = false) {
    if (!id) {
      setExistingPayInfo('');
      setPayRecentHistory([]);
      return;
    }
    try {
      const res = await api('GET', `/api/fees/student/${id}`);
      const data = normalizeList<FeeRow>(res, ['payments', 'fees', 'data']);

      // One row per month (a student can have more than one payment row in
      // the same month — e.g. installments — so collapse those into a
      // single summarized row before doing anything else).
      const byMonth = new Map<string, { academic_month: string; amount_due: number; amount_paid: number }>();
      data.forEach((r) => {
        const key = r.academic_month ? String(r.academic_month).slice(0, 7) : '';
        if (!key) return;
        const due = +r.amount_due || 0;
        const paid = +r.amount_paid || 0;
        const existingRow = byMonth.get(key);
        if (existingRow) {
          existingRow.amount_due += due;
          existingRow.amount_paid += paid;
        } else {
          byMonth.set(key, { academic_month: key, amount_due: due, amount_paid: paid });
        }
      });

      // Always show the last 4 calendar months (relative to the month
      // currently selected in the form), one row each, even if some of
      // them have no payment on record — those show as "No record".
      const last4 = lastFourMonths(month);
      const monthRows = last4.map(
        (key) => byMonth.get(key) || { academic_month: key, amount_due: 0, amount_paid: 0, no_record: true }
      );
      setPayRecentHistory(monthRows as unknown as FeeRow[]);

      // Warning banner if a fee record already exists for the month
      // currently selected in the form.
      const existing = byMonth.get(month);
      if (existing) {
        setExistingPayInfo(
          `⚠️ Fee already submitted for ${monthLabel(existing.academic_month + '-01')}: Due ${formatMoney(
            existing.amount_due
          )}, Paid ${formatMoney(existing.amount_paid)}, Balance ${formatMoney(
            existing.amount_due - existing.amount_paid
          )}. Submitting again will add another entry for this month.`
        );
      } else {
        setExistingPayInfo('');
      }
    } catch {
      if (forceRefresh) setPayRecentHistory([]);
      // matches original's empty catch
    }
  }

  async function deleteFeeRecord(paymentId: number) {
    if (!canDeleteFees()) return;
    if (!confirm('Delete this fee payment record? This cannot be undone.')) return;
    try {
      await api('DELETE', `/api/fees/${paymentId}`);
      showToast('Payment record deleted.', 'success');
      loadMonthlyRecords();
<<<<<<< HEAD
      if (dailyLoaded) loadDailyRecords();
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
      loadStats();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function savePayment() {
    const due = parseFloat(payDue) || 0;
    const paid = parseFloat(payPaid) || 0;

    if (editingPaymentId) {
      try {
        await api('PUT', `/api/fees/${editingPaymentId}`, { amount_due: due, amount_paid: paid });
        showToast('Payment record updated.', 'success');
        closePayModal();
        loadMonthlyRecords();
<<<<<<< HEAD
        if (dailyLoaded) loadDailyRecords();
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
        loadStats();
      } catch (e: any) {
        showToast(e.message, 'error');
      }
      return;
    }

    if (!payStudentSel) {
      showToast('Select a student.', 'error');
      return;
    }
    if (!payMonth) {
      showToast('Select a month.', 'error');
      return;
    }
    if (paid < 0) {
      showToast('Amount paid cannot be negative.', 'error');
      return;
    }
    if (due > 0 && paid <= 0) {
      showToast('Enter a payment amount for a due fee.', 'error');
      return;
    }
    if (payPaid.trim() === '') {
      const proceed = confirm('No amount entered for "Amount Paid". Continue with 0?');
      if (!proceed) return;
    }

    const useCD = canCustomDateFees() && useCustomDate;
    if (useCD && !customDate) {
      showToast('Pick a deposit date, or uncheck the custom date option.', 'error');
      return;
    }

    // Duplicate-month guard: existingPayInfo is set by onStudentChangeFor
    // whenever a fee record already exists for this student+month (see
    // that function above). The red-bordered banner in the form already
    // shows this passively — but a banner is easy to miss when someone
    // is moving quickly through several students in a row, which is
    // exactly when an accidental double-submission is most likely. This
    // adds an explicit stop: submitting while that duplicate is still
    // showing requires an extra confirmation naming the student and
    // month, so a double-entry can only happen on purpose.
    if (existingPayInfo) {
      const studentLabel =
        allStudents.find((s) => s.student_id === parseInt(String(payStudentSel), 10))?.first_name || 'this student';
      const proceed = confirm(
        `A fee record already exists for ${studentLabel} for ${monthLabel(payMonth + '-01')}.\n\nSubmitting again will add ANOTHER entry for the same month. Continue?`
      );
      if (!proceed) return;
    }

    try {
      const body: any = {
        student_id: parseInt(String(payStudentSel), 10),
        academic_month: payMonth + '-01',
        amount_due: due,
        amount_paid: paid,
        print_mode: getPrintMode(),
      };
      if (useCD) body.payment_date = customDate;

      const res = await api('POST', '/api/fees', body);
      showToast('Payment recorded!', 'success');
      closePayModal();
      loadMonthlyRecords();
      loadStats();

      const p = (res as any)?.payment;
      if (p) openReceiptModal(p);
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  // ---------------- Receipt ----------------
  function normalizeReceiptData(r: FeeRow): ReceiptData {
    const s = r.student_id ? allStudents.find((st) => st.student_id === r.student_id) : null;
    const first_name = r.first_name || s?.first_name || '';
    const last_name = r.last_name || s?.last_name || '';
    const roll_no = r.roll_no ?? s?.roll_no;
    const cls = r.class || s?.class;
    const section = r.section || s?.section;
    const father_name = r.father_name || s?.father_name;
    const contact_1 = r.contact_1 || s?.contact_1;
    const photo_url = r.photo_url || s?.photo_url || '';

    const due = +r.amount_due || 0;
    const cumulativePaid = +r.amount_paid || 0;
    const thisPayment = r.this_payment_amount != null ? +r.this_payment_amount : cumulativePaid;

    // class_fees.class is stored section-less (e.g. "5", "Nursery"), but
    // cls here can carry a "-<section>" suffix depending on the source
    // row, so strip it via baseClassFromSection before the lookup below —
    // otherwise it silently misses and Total Fee/Discount never render.
    const classLabel = baseClassFromSection(`${cls || ''}${section ? '-' + section : ''}`) || String(cls || '');
    const classFeeRow = classFees.find((c) => c.class === classLabel);
    const totalFee = classFeeRow ? +classFeeRow.total_fee : null;
    const discount = totalFee != null ? Math.max(0, totalFee - due) : null;

    return {
      receipt_no: r.receipt_no ?? r.payment_id ?? '—',
      roll_no: roll_no ?? '—',
      student_name: `${first_name} ${last_name}`.trim() || '—',
      class_section: `${cls || ''}${section ? '-' + section : ''}` || '—',
      father_name: father_name || '—',
      contact_1: contact_1 || '—',
      photo_url: photo_url || '',
      academic_month: monthLabel(r.academic_month),
      amount_due: due,
      amount_paid: thisPayment,
      balance: due - cumulativePaid,
      // Fallback new Date() here only fires for legacy rows with no
      // stored payment_date at all — rendered through fmtPaymentDateTime
      // (see its comment), which expects the fake-UTC-labeled shape the
      // API actually returns. A same-instant real Date read back with
      // getUTC*() there would itself show as UTC instead of local, but
      // this path is a last-resort label for data that's already
      // missing its real timestamp, not a case worth a second code path.
      payment_date: r.payment_date ? new Date(r.payment_date) : new Date(),
      total_fee: totalFee,
      discount,
    };
  }

  function openReceiptModal(paymentRow: FeeRow) {
    setReceiptData(normalizeReceiptData(paymentRow));
    setReceiptModalOpen(true);
  }
  function closeReceiptModal() {
    setReceiptModalOpen(false);
  }

  function printMonthlyReceipt(i: number) {
    const d = normalizeReceiptData(filteredMonthly[i]);
    setReceiptData(d);
    printReceiptWith(d);
  }
  function printDailyReceipt(i: number) {
    const d = normalizeReceiptData(filteredDaily[i]);
    setReceiptData(d);
    printReceiptWith(d);
  }
  // ---------------- Daily collection day-sheet (paper record) ----------------
  // New feature: a printable paper record of every fee payment recorded on
  // the selected day — Student / Father / Class-Section / Month / Amount
  // Due / Paid / Balance — plus a matching .xlsx download, both built from
  // exactly the rows currently on screen (filteredDaily), so what's printed
  // always matches what's visible (including the Boys/Girls filters).
  function dailySheetRows() {
    return filteredDaily.map((r) => {
      const due = +r.amount_due || 0;
      const paid = +r.amount_paid || 0;
      const balance = r.balance != null ? +r.balance : due - paid;
      return {
        student: `${r.first_name} ${r.last_name || ''}`.trim(),
        father: r.father_name || '—',
        classSection: `${r.class || ''}${r.section ? '-' + r.section : ''}`,
        month: monthLabel(r.academic_month),
        due,
        paid,
        balance,
      };
    });
  }

  function printDailyCollectionSheet() {
    const rows = dailySheetRows();
    if (rows.length === 0) {
      showToast('No payments to print for this date.', 'error');
      return;
    }
    const win = window.open('', '_blank');
    if (!win) {
      showToast('Please allow pop-ups to print the day sheet.', 'error');
      return;
    }
    const dateLabel = new Date(`${dailyDateFilter}T00:00:00`).toLocaleDateString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const bodyRows = rows
      .map(
        (r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.student)}</td>
          <td>${escapeHtml(r.father)}</td>
          <td>${escapeHtml(r.classSection)}</td>
          <td>${escapeHtml(r.month)}</td>
          <td class="num">${formatMoney(r.due)}</td>
          <td class="num paid">${formatMoney(r.paid)}</td>
          <td class="num ${r.balance > 0 ? 'due' : ''}">${r.balance > 0 ? formatMoney(r.balance) : '—'}</td>
        </tr>`
      )
      .join('');

    const totalsRow = rows.reduce(
      (acc, r) => ({ due: acc.due + r.due, paid: acc.paid + r.paid, balance: acc.balance + r.balance }),
      { due: 0, paid: 0, balance: 0 }
    );

    // Stripped-down print sheet: A4 portrait (standard paper-record
    // size, not landscape), no school name/logo, no "printed at"
    // timestamp, no signature blocks, no footer credit line — just the
    // date this sheet covers and the table of fields requested (#,
    // Student, Father, Class/Section, Month, Due, Paid, Balance) plus
    // a totals row. Font size is kept small (10px) so 8 columns fit
    // comfortably within A4's narrower portrait width without
    // wrapping awkwardly.
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Daily Fee Collection — ${escapeHtml(dateLabel)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 14mm 10mm; }
  body { font-family: Arial, sans-serif; color: #1a1a2e; padding: 0; }
  .date-line { font-size: 12px; font-weight: 700; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { border: 1px solid #ccc; padding: 5px 6px; text-align: left; }
  th { background: #f0f0f0; color: #333; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .paid { color: #2d7a4f; font-weight: 700; }
  .due { color: #b3261e; font-weight: 700; }
  tfoot td { font-weight: 700; background: #f7f7f7; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="date-line">${escapeHtml(dateLabel)}</div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Student</th>
        <th>Father</th>
        <th>Class / Section</th>
        <th>Month</th>
        <th class="num">Amount Due</th>
        <th class="num">Paid</th>
        <th class="num">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="5">Total</td>
        <td class="num">${formatMoney(totalsRow.due)}</td>
        <td class="num paid">${formatMoney(totalsRow.paid)}</td>
        <td class="num ${totalsRow.balance > 0 ? 'due' : ''}">${totalsRow.balance > 0 ? formatMoney(totalsRow.balance) : '—'}</td>
      </tr>
    </tfoot>
  </table>
  <script>
    window.onload = function () { window.print(); };
  <\/script>
</body>
</html>`;

    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  // Excel export of the same day sheet, via ExcelJS — dynamically
  // imported so its parser isn't shipped in the main Fees page bundle
  // for the vast majority of visits that never export.
  //
  // Switched from the `xlsx` (SheetJS) package to `exceljs` for this
  // export specifically because bold formatting was requested: SheetJS's
  // free/community build accepts a cell `.s.font.bold` style object
  // without erroring, but silently drops it when writing the actual
  // .xlsx file — verified by inspecting the written file's styles.xml,
  // which came back with only the single default (non-bold) font
  // defined even with `cellStyles: true` passed to writeFile. ExcelJS
  // writes real font styling to the file, confirmed the same way.
  async function downloadDailyCollectionExcel() {
    const rows = dailySheetRows();
    if (rows.length === 0) {
      showToast('No payments to export for this date.', 'error');
      return;
    }
    try {
      const ExcelJS = (await import('exceljs')).default;
      const totals = rows.reduce(
        (acc, r) => ({ due: acc.due + r.due, paid: acc.paid + r.paid, balance: acc.balance + r.balance }),
        { due: 0, paid: 0, balance: 0 }
      );

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Daily Collection');
      ws.columns = [
        { header: '#', key: 'no', width: 4 },
        { header: 'Student', key: 'student', width: 24 },
        { header: 'Father', key: 'father', width: 22 },
        { header: 'Class / Section', key: 'classSection', width: 14 },
        { header: 'Month', key: 'month', width: 14 },
        { header: 'Amount Due', key: 'due', width: 12 },
        { header: 'Paid', key: 'paid', width: 12 },
        { header: 'Balance', key: 'balance', width: 12 },
      ];
      // Header row bold — standard convention, and the sheet has no
      // colored header band to otherwise mark it apart from the data.
      ws.getRow(1).font = { bold: true };

      rows.forEach((r, i) => {
        const row = ws.addRow({
          no: i + 1,
          student: r.student,
          father: r.father,
          classSection: r.classSection,
          month: r.month,
          due: r.due,
          paid: r.paid,
          balance: r.balance,
        });
        // Bold any row that still has an outstanding balance — the one
        // thing on this sheet someone reviewing the day's collection
        // actually needs to spot at a glance (who still owes money),
        // versus fully-settled rows which don't need to stand out.
        if (r.balance > 0) row.font = { bold: true };
      });

      // Blank spacer row, then the totals row — bolded so the sum
      // reads clearly apart from the individual entries above it.
      ws.addRow([]);
      const totalsRow = ws.addRow(['', '', '', '', 'Total', totals.due, totals.paid, totals.balance]);
      totalsRow.font = { bold: true };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily-fee-collection-${dailyDateFilter}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Failed to generate Excel file.', 'error');
    }
  }

  function printHistoryReceipt(i: number) {
    const row = { ...historyList[i], student_id: historyStudentId! } as FeeRow;
    const s = allStudents.find((st) => st.student_id === historyStudentId);
    if (s) Object.assign(row, { roll_no: s.roll_no, first_name: s.first_name, last_name: s.last_name, class: s.class, section: s.section });
    const d = normalizeReceiptData(row);
    setReceiptData(d);
    printReceiptWith(d);
  }

  function printReceipt() {
    if (receiptData) printReceiptWith(receiptData);
  }

  function printReceiptWith(d: ReceiptData) {
    if (getPrintMode() === 'thermal') {
      printThermalReceipt(d);
    } else {
      printPaperReceipt(d);
    }
  }

  function printPaperReceipt(d: ReceiptData) {
    const win = window.open('', '_blank');
    if (!win) {
      showToast('Please allow pop-ups to print the receipt.', 'error');
      return;
    }
    const printedAt = new Date();
    const SCHOOL_LOGO_URL = new URL('school-logo.png', window.location.href).href;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Fee Receipt — ${escapeHtml(d.student_name)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 14mm; }
  body { font-family: Arial, sans-serif; color: #1a1a2e; padding: 0; }
  body, body * { font-weight: 700 !important; }
  .receipt { max-width: 170mm; margin: 0 auto; border: 1px solid #ccc; border-radius: 8px; padding: 22px 26px; }
  .header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #1a1a2e; padding-bottom: 12px; margin-bottom: 16px; }
  .header img { width: 56px; height: 56px; object-fit: contain; }
  .receipt-photo { width: 100px; height: 100px; margin: 0 auto 14px; border-radius: 12px; overflow: hidden; border: 1px solid #ddd; }
  .receipt-photo img { width: 100%; height: 100%; object-fit: cover; }
  .header .school-name { font-size: 17px; font-weight: 700; }
  .header .sub { font-size: 11px; color: #666; margin-top: 2px; }
  .header .affiliation { font-size: 10px; color: #666; margin-top: 3px; }
  .title { text-align: center; font-size: 13px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #444; margin-bottom: 16px; }
  table.info { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
  table.info td { padding: 5px 4px; vertical-align: top; }
  table.info td.label { color: #666; width: 120px; }
  table.fee { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.fee th, table.fee td { border: 1px solid #ddd; padding: 7px 9px; text-align: left; }
  table.fee th { background: #f0f0f0; color: #555; }
  .paid { color: #2d7a4f; font-weight: 700; }
  .due  { color: #b3261e; font-weight: 700; }
  .discount-note { font-size: 10.5px; color: #b3261e; font-style: italic; margin-top: 6px; }
  .remarks { margin-top: 14px; font-size: 12px; color: #444; }
  .remarks .label { color: #666; margin-right: 4px; }
  .remarks .line { display: inline-block; border-bottom: 1px solid #bbb; min-width: 60%; }
  .footer { display: flex; justify-content: space-between; margin-top: 56px; font-size: 11px; color: #666; }
  .footer .sign-block { width: 150px; text-align: center; }
  .footer .sign-line { border-top: 1px solid #999; padding-top: 4px; }
  .meta { text-align: right; font-size: 10px; color: #707070; margin-top: -5px; margin-bottom: 12px; }
  .thanks { text-align: center; font-size: 12px; font-weight: 700; color: #444; margin-top: 24px; }
  .credit { text-align: center; font-size: 8px; color: #707070; margin-top: 6px; }
  @media print {
    body { padding: 0; }
    .receipt { border: none; }
  }
</style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <img src="${SCHOOL_LOGO_URL}" onerror="this.style.display='none'" alt="Logo"/>
      <div>
        <div class="school-name">${SCHOOL_NAME}</div>
        <div class="sub">Fee Payment Receipt</div>
        <div class="affiliation">Affiliated with Board of Intermediate and Secondary Education Rawalpindi</div>
      </div>
    </div>

    <div class="title">Fee Receipt</div>
    <div class="meta">Receipt No: ${escapeHtml(d.receipt_no)} &nbsp;|&nbsp; Fee Submitted: ${fmtPaymentDateTime(d.payment_date)} &nbsp;|&nbsp; Printed: ${fmtDateTime(printedAt)}</div>
    ${d.photo_url ? `<div class="receipt-photo"><img src="${escapeHtml(d.photo_url)}" alt="Student photo" onerror="this.style.display='none'"/></div>` : ''}
    <table class="info">
      <tr><td class="label">Student Name</td><td>${escapeHtml(d.student_name)}</td>
          <td class="label">Roll No.</td><td>${escapeHtml(d.roll_no)}</td></tr>
      <tr><td class="label">Class / Section</td><td>${escapeHtml(d.class_section)}</td>
          <td class="label">Father's Name</td><td>${escapeHtml(d.father_name)}</td></tr>
      <tr><td class="label">Contact</td><td>${escapeHtml(d.contact_1)}</td>
          <td class="label">Fee Month</td><td>${escapeHtml(d.academic_month)}</td></tr>
    </table>

    <table class="fee">
      <thead><tr><th>Description</th><th>Amount (Rs.)</th></tr></thead>
      <tbody>
        ${d.total_fee != null ? `<tr><td>Total Fee</td><td>${d.total_fee.toLocaleString('en-PK')}</td></tr>` : ''}
        ${d.discount != null && d.discount > 0 ? `<tr><td>Discount</td><td class="paid">-${d.discount.toLocaleString('en-PK')}</td></tr>` : ''}
        <tr><td>${d.discount != null && d.discount > 0 ? 'Payable after Discount' : 'Amount Due'}</td><td>${d.amount_due.toLocaleString('en-PK')}</td></tr>
        <tr><td>Amount Paid</td><td class="paid">${d.amount_paid.toLocaleString('en-PK')}</td></tr>
        <tr><td>Balance</td><td class="${d.balance > 0 ? 'due' : ''}">${d.balance.toLocaleString('en-PK')}</td></tr>
      </tbody>
    </table>

    ${d.discount != null && d.discount > 0 ? '<div class="discount-note">* This discount is valid for 1 year only.</div>' : ''}

    <div class="footer">
      <div class="sign-block">
        <div class="sign-line">Signature</div>
      </div>
      <div class="sign-block">
        <div class="sign-line">Stamp</div>
      </div>
    </div>

    <div class="remarks"><span class="label">Remarks:</span><span class="line">&nbsp;</span></div>

    <div class="thanks">Thank you for your payment!</div>
    <div class="credit">Software provided by alixtech.vercel.app &nbsp;|&nbsp; 0310-5203080</div>
  </div>
  <script>
    window.onload = function () { window.print(); };
  <\/script>
</body>
</html>`;

    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function printThermalReceipt(d: ReceiptData) {
    const printedAt = new Date();
    const win = window.open('', '_blank');
    if (!win) {
      showToast('Please allow pop-ups to print the receipt.', 'error');
      return;
    }

    const row = (label: string, value: string | number, strong = false) => `<div class="row${strong ? ' strong' : ''}"><span>${label}</span><span>${value}</span></div>`;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Receipt — ${escapeHtml(d.student_name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { margin: 0 !important; padding: 0 !important; }
  @page { size: 80mm auto; margin: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
<<<<<<< HEAD
    color: #000; width: 68mm; margin: 0 auto; padding: 2mm 4mm;
=======
    color: #000; width: 76mm; margin: 0 auto; padding: 2mm;
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
    font-size: 12px; line-height: 1.5;
    font-weight: 400;
    -webkit-font-smoothing: none;
  }
  .receipt-box {
    border: 1.5px solid #000;
<<<<<<< HEAD
    outline: 1.5px solid #000;
    outline-offset: -1.5px;
    padding: 8px 10px;
=======
    padding: 8px;
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
  }
  .center { text-align: center; }
  .school-name { font-size: 17px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; }
  .sub { font-size: 10px; margin-top: 3px; font-weight: 400; color: #000; }
  .contact-line { font-size: 10px; margin-top: 3px; color: #000; font-weight: 700; }
  .divider { border-top: 1px dashed #000; margin: 7px 0; }
  .divider-solid { border-top: 1.5px solid #000; margin: 7px 0; }
  .section-box { border: 1px solid #000; border-radius: 3px; padding: 6px 7px; margin: 7px 0; }
<<<<<<< HEAD
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 2px 1px 0; }
  .row span:first-child { color: #000; font-weight: 700; flex-shrink: 0; }
  .row span:last-child { font-weight: 400; text-align: right; padding-right: 2px; word-break: break-word; }
=======
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
  .row span:first-child { color: #000; font-weight: 700; }
  .row span:last-child { font-weight: 400; text-align: right; }
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
  .title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; border-bottom: 1px dashed #000; padding-bottom: 3px; }
  .amount-paid { font-weight: 700 !important; }
  .strong-value { font-weight: 700 !important; }
  .discount-note { font-size: 10px; font-style: italic; margin: 6px 0 0; }
  .total-box { border: 1.5px solid #000; border-radius: 3px; padding: 6px 7px; margin-top: 7px; background: #f2f2f2; }
  .total-box .row span { font-size: 13px; font-weight: 700 !important; }
  .footer { margin-top: 10px; font-size: 10px; text-align: center; font-weight: 400; padding-top: 8px; border-top: 1px dashed #000; }
  .footer .thanks { font-weight: 700; margin-bottom: 3px; font-size: 12px; }
  .footer .credit { font-size: 9px; color: #000; margin-top: 8px; margin-bottom: 0; font-weight: 700; }
  @media print {
<<<<<<< HEAD
    html, body { width: 68mm; padding: 2mm 4mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
=======
    html, body { width: 76mm; padding: 2mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
  }
</style>
</head>
<body>
<div class="receipt-box">
  <div class="center">
    <div class="school-name">${SCHOOL_NAME}</div>
    <div class="sub">Fee Payment Receipt</div>
    <div class="contact-line">051-4831802 &nbsp; 051-4834045</div>
  </div>
  <div class="divider-solid"></div>

  ${row('Receipt No.', escapeHtml(d.receipt_no))}
  ${row('Fee Submitted', fmtPaymentDateTime(d.payment_date))}
  ${row('Printed', fmtDateTime(printedAt))}

  <div class="section-box">
    <div class="title">Student Details</div>
    ${row('Name', `<span class="strong-value">${escapeHtml(d.student_name)}</span>`)}
    ${row('Roll No.', escapeHtml(d.roll_no))}
    ${row('Class', escapeHtml(d.class_section))}
    ${row('Father Name', escapeHtml(d.father_name))}
  </div>

  <div class="section-box">
    <div class="title">Fee Details</div>
    ${row('Month', escapeHtml(d.academic_month))}
    ${d.total_fee != null ? row('Total Fee', d.total_fee.toLocaleString('en-PK')) : ''}
    ${d.discount != null && d.discount > 0 ? row('Discount', `-${d.discount.toLocaleString('en-PK')}`) : ''}
    ${row(d.discount != null && d.discount > 0 ? 'Payable after Discount' : 'Amount Due', d.amount_due.toLocaleString('en-PK'))}
    ${row('Balance', d.balance.toLocaleString('en-PK'))}
  </div>

  <div class="total-box">
    ${row('Amount Paid', `<span class="amount-paid">Rs. ${d.amount_paid.toLocaleString('en-PK')}</span>`)}
  </div>

  ${d.discount != null && d.discount > 0 ? '<div class="discount-note center">* This discount is valid for 1 year only.</div>' : ''}

  <div class="footer">
    <div class="thanks">Thank you</div>
    <div>Stamp</div>
    <div class="credit">Software provided by alixtech.vercel.app<br/>0310-5203080</div>
  </div>
</div>
  <script>
    window.onload = function () { window.print(); };
  <\/script>
</body>
</html>`;

    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function historyStudentLabel(s: StudentLite) {
    return `${s.class}-${s.section} | ${s.first_name} ${s.last_name}`;
  }
  function selectHistoryStudent(studentId: number) {
    const student = allStudents.find((s) => s.student_id === studentId);
    setHistorySearch(student ? historyStudentLabel(student) : '');
    setHistoryStudentId(studentId);
    setHistoryResultsOpen(false);
  }

  return (
    <>
      {/* Record Payment Modal */}
      <div className={`modal-overlay${payModalOpen ? ' open' : ''}`}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">{payModalTitle}</h2>
            <button className="modal-close" onClick={closePayModal} aria-label="Close">
              ×
            </button>
          </div>
          <form ref={payFormRef} onSubmit={(e) => e.preventDefault()}>
            <div className="form-group relative" ref={payWrapRef as any}>
              <label htmlFor="fee-student">Student *</label>
              <input id="fee-student"
                type="text"
                placeholder="Type roll no. or name…"
                autoComplete="off"
                className="mini-input"
                disabled={payStudentDisabled}
                value={payStudentSearch}
                onChange={(e) => {
                  setPayStudentSearch(e.target.value);
                  setPayStudentSel('');
                  setPayResultsOpen(true);
                }}
                onFocus={() => setPayResultsOpen(true)}
              />
              {payResultsOpen && (
                <div className="popup-panel block absolute z-20 left-0 right-0 top-full max-h-[180px] overflow-y-auto">
                  {payMatches.length === 0 ? (
                    <div className="text-muted px-2.5 py-2 text-xs">No matching student.</div>
                  ) : (
                    payMatches.map((s) => (
                      <div
                        key={s.student_id}
                        className="popup-option px-2.5 py-2 cursor-pointer text-[13px]"
                        onMouseDown={() => selectPayStudent(s.student_id)}
                      >
                        Roll {s.roll_no} — {s.first_name} {s.last_name} <span className="text-muted">({s.class}-{s.section})</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            {payStudentSel && (() => {
              const selStudent = allStudents.find((st) => st.student_id === payStudentSel);
<<<<<<< HEAD
              const selTotalFee = totalFeeForStudent(selStudent);
              return (
                <>
                  {selStudent?.father_name && (
                    <div className="form-group -mt-1">
                      <label htmlFor="fee-father-s-name">Father's Name</label>
                      <input id="fee-father-s-name" type="text" value={selStudent.father_name} disabled readOnly />
                    </div>
                  )}
                  {selTotalFee != null && (
                    <div className="form-group -mt-1">
                      <label htmlFor="fee-total-fee">Total Fee</label>
                      <input id="fee-total-fee" type="text" value={formatMoney(selTotalFee)} disabled readOnly />
                    </div>
                  )}
                </>
              );
=======
              return selStudent?.father_name ? (
                <div className="form-group -mt-1">
                  <label htmlFor="fee-father-s-name">Father's Name</label>
                  <input id="fee-father-s-name" type="text" value={selStudent.father_name} disabled readOnly />
                </div>
              ) : null;
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
            })()}
            <div className="form-group">
              <label htmlFor="fee-academic-month">Academic Month *</label>
              <input id="fee-academic-month"
                type="month"
                value={payMonth}
                disabled={payMonthDisabled}
                onChange={(e) => {
                  const newMonth = e.target.value;
                  setPayMonth(newMonth);
                  if (payStudentSel) onStudentChangeFor(payStudentSel, newMonth);
                }}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="fee-amount-due-rs">Amount Due (Rs.)</label>
                <input id="fee-amount-due-rs" type="number" step="0.01" placeholder="0" value={payDue} onChange={(e) => setPayDue(e.target.value)} onWheel={(e) => (e.target as HTMLInputElement).blur()} />
              </div>
              <div className="form-group">
                <label htmlFor="fee-amount-paid-rs">Amount Paid (Rs.) *</label>
                <input id="fee-amount-paid-rs" type="number" step="0.01" placeholder="0" value={payPaid} onChange={(e) => setPayPaid(e.target.value)} onWheel={(e) => (e.target as HTMLInputElement).blur()} />
              </div>
            </div>
            {showCustomDateGroup && (
              <div className="form-group">
                <label>
                  <input type="checkbox" checked={useCustomDate} onChange={(e) => onUseCustomDateToggle(e.target.checked)} />
                  Deposit on a different day (e.g. fee came in yesterday)
                </label>
                {useCustomDate && (
                  <input type="date" aria-label="Custom deposit date" className="mt-1.5 block" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
                )}
                <div className="text-muted text-xs mt-1">
                  This payment (and its receipt) will appear under the collection totals for the date you pick instead of today.
                </div>
              </div>
            )}
            <div className="text-muted text-xs mb-2.5">
              For free students, enter 0 for both Amount Due and Amount Paid.
            </div>
            {existingPayInfo && (
              <div
                className="p-2.5 rounded mb-2.5 text-xs font-medium"
                style={{
                  background: 'var(--danger-bg)',
                  border: '1px solid var(--danger-fg)',
                  borderLeft: '4px solid var(--danger-fg)',
                  color: 'var(--danger-text)',
                }}
              >
                {existingPayInfo}
              </div>
            )}
            {payRecentHistory.length > 0 && (
              <div className="mb-2.5">
                <div className="text-muted text-xs mb-1">Last 4 months on record</div>
                <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr className="text-muted text-left">
                      <th className="py-1 pr-2">Month</th>
                      <th className="py-1 pr-2">Paid</th>
                      <th className="py-1 pr-2">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payRecentHistory.map((r: any) => {
                      const due = +r.amount_due || 0;
                      const paid = +r.amount_paid || 0;
                      const balance = due - paid;
                      const isSelectedMonth = String(r.academic_month) === payMonth;
                      return (
                        <tr
                          key={String(r.academic_month)}
                          style={isSelectedMonth ? { background: 'var(--danger-bg)', color: 'var(--danger-text)' } : undefined}
                        >
                          <td className="py-1 pr-2">{monthLabel(r.academic_month + '-01')}</td>
                          {r.no_record ? (
                            <td className="py-1 pr-2 text-muted" colSpan={2}>No record</td>
                          ) : (
                            <>
                              <td className="py-1 pr-2">{formatMoney(paid)}</td>
                              <td className="py-1 pr-2">{formatMoney(balance)}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closePayModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-success" onClick={savePayment}>
                {paySaveLabel}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Payment Receipt Modal */}
      <div className={`modal-overlay${receiptModalOpen ? ' open' : ''}`}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">Payment Recorded</h2>
            <button className="modal-close" onClick={closeReceiptModal} aria-label="Close">
              ×
            </button>
          </div>
          <div className="px-0.5 pt-1 pb-3.5 text-[13px] text-text">
            <div className="text-center mb-2.5">
              <div className="text-[32px]">✅</div>
              <div>Payment saved successfully.</div>
            </div>
            {receiptData && (
              <div className="popup-panel rounded-md px-3 py-2.5 leading-relaxed">
                {receiptData.photo_url && (
                  <div className="mb-3 flex justify-center">
                    <img
                      src={receiptData.photo_url}
                      alt="Student photo"
                      width={120}
                      height={120}
                      className="border-input w-[120px] h-[120px] object-cover rounded-2xl"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
                <div>
                  <strong>{receiptData.student_name}</strong> &nbsp; (Roll {receiptData.roll_no}, Class {receiptData.class_section})
                </div>
                <div>
                  Month: <strong>{receiptData.academic_month}</strong>
                </div>
                <div>
                  Amount Paid: <strong className="fee-paid">{formatMoney(receiptData.amount_paid)}</strong>
                  {receiptData.balance > 0 && (
                    <>
                      {' '}
                      &nbsp;|&nbsp; Balance: <strong className="fee-unpaid">{formatMoney(receiptData.balance)}</strong>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline" onClick={closeReceiptModal}>
              Close
            </button>
            <button className="btn btn-success" onClick={printReceipt}>
              🖨 Print Receipt
            </button>
          </div>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Fee Management</h1>
          <div className="flex items-center gap-3.5">
            <div className="period-switch" title="Choose which receipt layout printing uses">
              <span className={`period-label${thermalMode ? ' inactive' : ''}`}>Paper</span>
              <label className="toggle-switch" aria-label="Switch receipt print layout between Paper and Thermal">
                <input type="checkbox" checked={thermalMode} onChange={(e) => onPrintModeToggle(e.target.checked)} />
                <span className="toggle-slider"></span>
              </label>
              <span className={`period-label${!thermalMode ? ' inactive' : ''}`}>Thermal</span>
            </div>
            {canAddFees() && (
              <button className="btn btn-success transition-transform duration-150 active:scale-95" onClick={openPayModal}>
                + Record Payment
              </button>
            )}
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="label">Collected (Month)</div>
            <div className="value">{statCollected}</div>
          </div>
          <div className="stat-card">
            <div className="label">Monthly Defaulters</div>
            <div className="value">{statDefaulters}</div>
          </div>
          <div className="stat-card">
            <div className="label">Collected Today</div>
            <div className="value">{statToday}</div>
          </div>
        </div>

        <div className="flex gap-0.5 mb-4 border-b border-border overflow-x-auto">
          <button className={`tab-btn${tab === 'monthly' ? ' active' : ''}`} onClick={() => setTab('monthly')}>
            Monthly Records
          </button>
          <button className={`tab-btn${tab === 'daily' ? ' active' : ''}`} onClick={() => setTab('daily')}>
            Daily Collections
          </button>
          <button className={`tab-btn${tab === 'monthly-defaulters' ? ' active' : ''}`} onClick={() => setTab('monthly-defaulters')}>
            Monthly Defaulters
          </button>
          <button className={`tab-btn${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
            Student History
          </button>
          <button className={`tab-btn${tab === 'total-fee' ? ' active' : ''}`} onClick={() => setTab('total-fee')}>
            Total Fee
          </button>
<<<<<<< HEAD
          <button className={`tab-btn${tab === 'student-fee' ? ' active' : ''}`} onClick={() => setTab('student-fee')}>
            Students Fee
          </button>
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
        </div>

        {/* MONTHLY TAB */}
        {tab === 'monthly' && (
          <div>
            <div className="card mb-3">
              <div className="filters">
                <label className="text-muted text-xs" htmlFor="fees-monthly-tab-month">
                  Month:
                </label>
                <input id="fees-monthly-tab-month" type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} />
                <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                  <option value="">All Classes</option>
                  <option>Nursery</option>
                  <option>KG</option>
                  <option>1</option>
                  <option>2</option>
                  <option>3</option>
                  <option>4</option>
                  <option>5</option>
                  <option>6</option>
                  <option>7</option>
                  <option>8</option>
                  <option>9</option>
                  <option>10</option>
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All Status</option>
                  <option value="paid">Paid</option>
                  <option value="partial">Partial</option>
                  <option value="unpaid">Unpaid</option>
                </select>
                <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                  <input type="checkbox" checked={feeFilterBoys} onChange={(e) => setFeeFilterBoys(e.target.checked)} /> Boys
                </label>
                <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                  <input type="checkbox" checked={feeFilterGirls} onChange={(e) => setFeeFilterGirls(e.target.checked)} /> Girls
                </label>
                <input
                  type="text"
                  placeholder="Search student…"
                  className="mini-input w-[180px]"
                  value={feeSearch}
                  onChange={(e) => setFeeSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="card">
              <div className="section-title">{monthlyTableTitle}</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Photo</th>
                      <th>Roll</th>
                      <th>Student</th>
                      <th>Class</th>
                      <th>Section</th>
                      <th>Fee Month</th>
                      <th>Due</th>
                      <th>Paid</th>
                      <th>Balance</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyLoadFailed ? (
                      <tr>
                        <td colSpan={13} className="empty">
                          Failed to load.
                        </td>
                      </tr>
                    ) : filteredMonthly.length === 0 ? (
                      <tr>
                        <td colSpan={13} className="empty">
                          No records found.
                        </td>
                      </tr>
                    ) : (
                      filteredMonthly.map((r, i) => {
                        const due = +r.amount_due || 0;
                        const paid = +r.amount_paid || 0;
                        const bal = due - paid;
                        const canPay = bal > 0;
                        let stCls: string, stLabel: string;
                        if (due === 0 && paid === 0) {
                          stCls = 'badge-success';
                          stLabel = 'Free';
                        } else if (paid >= due) {
                          stCls = 'badge-success';
                          stLabel = 'Paid';
                        } else if (paid > 0) {
                          stCls = 'badge-warning';
                          stLabel = 'Partial';
                        } else {
                          stCls = 'badge-danger';
                          stLabel = 'Unpaid';
                        }
                        return (
                          <tr key={r.payment_id ?? `${r.student_id}-${i}`}>
                            <td>{i + 1}</td>
                            <td>
                              <Avatar src={r.photo_url} name={`${r.first_name} ${r.last_name || ''}`} />
                            </td>
                            <td>{r.roll_no}</td>
                            <td>
                              {r.first_name} {r.last_name}
                            </td>
                            <td>{r.class}</td>
                            <td>{r.section}</td>
                            <td>
                              <span className="badge badge-info whitespace-nowrap">{monthLabelShort(r.academic_month)}</span>
                            </td>
                            <td>{formatMoney(due)}</td>
                            <td className={paid >= due ? 'fee-paid' : paid > 0 ? 'fee-partial' : 'fee-unpaid'}>{formatMoney(paid)}</td>
                            <td>{bal > 0 ? formatMoney(bal) : '—'}</td>
                            <td>
                              <span className={`badge ${stCls}`}>{stLabel}</span>
                            </td>
                            <td>{r.payment_date ? formatDate(r.payment_date) : '—'}</td>
                            <td className="whitespace-nowrap">
                              {canPay && (
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() => quickPay(r.student_id, `${r.first_name} ${r.last_name}`, due, paid, r.academic_month)}
                                >
                                  Pay
                                </button>
                              )}
                              <button className="btn btn-outline btn-sm" title="Print receipt" onClick={() => printMonthlyReceipt(i)}>
                                🖨
                              </button>
                              {canEditFees() && r.payment_id && (
                                <button
                                  className="btn btn-outline btn-sm"
                                  title="Edit record"
                                  onClick={() => editFeeRecord(r.payment_id!, `${r.first_name} ${r.last_name}`, due, paid)}
                                >
                                  ✏️
                                </button>
                              )}
                              {canDeleteFees() && r.payment_id && (
                                <button className="btn btn-outline btn-sm" title="Delete record" onClick={() => deleteFeeRecord(r.payment_id!)}>
                                  🗑
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* DAILY TAB */}
        {tab === 'daily' && (
          <div>
            <div className="card mb-3">
              <div className="filters">
                <label className="text-secondary text-xs" htmlFor="fees-daily-tab-date">Date:</label>
                <input id="fees-daily-tab-date" type="date" value={dailyDateFilter} onChange={(e) => setDailyDateFilter(e.target.value)} />
                <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                  <input type="checkbox" checked={dailyFilterBoys} onChange={(e) => setDailyFilterBoys(e.target.checked)} /> Boys
                </label>
                <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                  <input type="checkbox" checked={dailyFilterGirls} onChange={(e) => setDailyFilterGirls(e.target.checked)} /> Girls
                </label>
                <button
                  className="btn btn-outline btn-sm"
                  title="Print a paper record of this day's fee collection (Student / Father / Class-Section / Month / Amount Due / Paid / Balance)"
                  onClick={printDailyCollectionSheet}
                  disabled={filteredDaily.length === 0}
                >
                  🖨 Print Day Sheet
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  title="Download this day's fee collection as an Excel sheet"
                  onClick={downloadDailyCollectionExcel}
                  disabled={filteredDaily.length === 0}
                >
                  ⬇ Excel
                </button>
              </div>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Photo</th>
                      <th>Student</th>
                      <th>Class</th>
                      <th>Section</th>
                      <th>Month</th>
                      <th>Amount Paid</th>
                      <th>Time</th>
<<<<<<< HEAD
                      <th>Actions</th>
=======
                      <th>Receipt</th>
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
                    </tr>
                  </thead>
                  <tbody>
                    {!dailyLoaded ? (
                      <tr>
                        <td colSpan={9} className="loading">
                          Select date
                        </td>
                      </tr>
                    ) : dailyLoadFailed ? (
                      <tr>
                        <td colSpan={9} className="empty">
                          Failed to load.
                        </td>
                      </tr>
                    ) : filteredDaily.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="empty">
                          No payments on this date.
                        </td>
                      </tr>
                    ) : (
                      filteredDaily.map((r, i) => (
                        <tr key={r.payment_id ?? `${r.student_id}-${i}`}>
                          <td>{i + 1}</td>
                          <td>
                            <Avatar src={r.photo_url} name={`${r.first_name} ${r.last_name || ''}`} />
                          </td>
                          <td>
                            {r.first_name} {r.last_name}
                          </td>
                          <td>{r.class}</td>
                          <td>{r.section}</td>
                          <td>{monthLabel(r.academic_month)}</td>
                          <td className="fee-paid">{formatMoney(r.amount_paid)}</td>
                          <td className="text-muted text-xs">
                            {r.payment_date ? localPaymentDate(new Date(r.payment_date)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}
                          </td>
<<<<<<< HEAD
                          <td className="whitespace-nowrap">
                            <button className="btn btn-outline btn-sm" title="Print receipt" onClick={() => printDailyReceipt(i)}>
                              🖨
                            </button>
                            {canEditFees() && r.payment_id && (
                              <button
                                className="btn btn-outline btn-sm"
                                title="Edit record"
                                onClick={() => editFeeRecord(r.payment_id!, `${r.first_name} ${r.last_name}`, +r.amount_due || 0, +r.amount_paid || 0)}
                              >
                                ✏️
                              </button>
                            )}
                            {canDeleteFees() && r.payment_id && (
                              <button className="btn btn-outline btn-sm" title="Delete record" onClick={() => deleteFeeRecord(r.payment_id!)}>
                                🗑
                              </button>
                            )}
=======
                          <td>
                            <button className="btn btn-outline btn-sm" title="Print receipt" onClick={() => printDailyReceipt(i)}>
                              🖨
                            </button>
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {filteredDaily.length > 0 && (
                <div className="amount-success text-right text-[13px] font-semibold pt-2.5">
                  Total Collected: {formatMoney(dailyTotal)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* MONTHLY DEFAULTERS TAB */}
        {tab === 'monthly-defaulters' && (
          <div>
            <div className="card mb-3">
              <div className="filters">
                <label className="text-secondary text-xs" htmlFor="fees-defaulters-tab-month">Month:</label>
<<<<<<< HEAD
                <input
                  id="fees-defaulters-tab-month"
                  type="month"
                  value={defMonthFilter}
                  onChange={(e) => {
                    setDefMonthFilter(e.target.value);
                    setDefaultersView('month');
                  }}
                />
=======
                <input id="fees-defaulters-tab-month" type="month" value={defMonthFilter} onChange={(e) => setDefMonthFilter(e.target.value)} />
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
                <input
                  type="text"
                  placeholder="Class"
                  className="border-input px-2.5 py-[7px] rounded text-[13px] w-[90px]"
                  value={defClassFilter}
                  onChange={(e) => setDefClassFilter(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Section"
                  className="border-input px-2.5 py-[7px] rounded text-[13px] w-[90px]"
                  value={defSectionFilter}
                  onChange={(e) => setDefSectionFilter(e.target.value)}
                />
                <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                  <input type="checkbox" checked={defFilterBoys} onChange={(e) => setDefFilterBoys(e.target.checked)} /> Boys
                </label>
                <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
                  <input type="checkbox" checked={defFilterGirls} onChange={(e) => setDefFilterGirls(e.target.checked)} /> Girls
                </label>
                <input
                  type="text"
                  placeholder="Search student…"
                  className="border-input px-2.5 py-[7px] rounded text-[13px] flex-1 min-w-[180px]"
                  value={defSearch}
                  onChange={(e) => setDefSearch(e.target.value)}
                />
<<<<<<< HEAD
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setDefaultersView('all')}
                >
                  Show All
                </button>
                {defaultersView !== 'blank' && (
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setDefaultersView('blank');
                      setDefSearch('');
                      setDefClassFilter('');
                      setDefSectionFilter('');
                      setDefFilterBoys(false);
                      setDefFilterGirls(false);
                    }}
                  >
                    Clear
                  </button>
                )}
                {defaultersView !== 'blank' && defaultersLoaded && !defaultersLoadFailed && (
=======
                {defaultersLoaded && !defaultersLoadFailed && (
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
                  <span className="text-secondary text-sm font-semibold ml-auto">
                    {filteredDefaulters.length} defaulter month{filteredDefaulters.length !== 1 ? 's' : ''} total
                  </span>
                )}
              </div>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Photo</th>
                      <th>Month</th>
                      <th>Roll</th>
                      <th>Student</th>
                      <th>Class</th>
                      <th>Section</th>
                      <th>Due</th>
                      <th>Paid</th>
                      <th>Balance</th>
                      <th>Contact</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
<<<<<<< HEAD
                    {defaultersView === 'blank' ? (
                      <tr>
                        <td colSpan={12} className="empty">
                          Toggle a month above or press &quot;Show All&quot; to view defaulters.
                        </td>
                      </tr>
                    ) : !defaultersLoaded ? (
=======
                    {!defaultersLoaded ? (
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
                      <tr>
                        <td colSpan={12} className="loading">
                          Loading…
                        </td>
                      </tr>
                    ) : defaultersLoadFailed ? (
                      <tr>
                        <td colSpan={12} className="empty">
                          Failed to load.
                        </td>
                      </tr>
                    ) : groupedDefaulters.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="empty">
                          {defSearch || defFilterBoys || defFilterGirls ? 'No matching students.' : 'No monthly defaulters. 🎉'}
                        </td>
                      </tr>
                    ) : (
                      (() => {
                        let rowCounter = 0;
                        return groupedDefaulters.map((group) => (
                          <Fragment key={`group-${group.academic_month}`}>
                            <tr className="group-header-row" key={`hdr-${group.academic_month}`}>
                              <td colSpan={12} className="font-semibold px-2.5 py-2">
                                {monthLabel(group.academic_month)} — {group.count} defaulter{group.count !== 1 ? 's' : ''}
                              </td>
                            </tr>
                            {group.defaulters.map((r) => {
                              rowCounter += 1;
                              const due = +r.amount_due || 0;
                              const paid = +r.amount_paid || 0;
                              const canPay = due > 0 && paid < due;
                              return (
                                <tr key={`${group.academic_month}-${r.student_id}`}>
                                  <td>{rowCounter}</td>
                                  <td>
                                    <Avatar src={r.photo_url} name={`${r.first_name} ${r.last_name || ''}`} />
                                  </td>
                                  <td>{monthLabel(r.academic_month)}</td>
                                  <td>{r.roll_no}</td>
                                  <td>
                                    {r.first_name} {r.last_name}
                                  </td>
                                  <td>{r.class}</td>
                                  <td>{r.section}</td>
                                  <td className={due > 0 ? 'fee-unpaid' : ''}>{formatMoney(r.amount_due)}</td>
                                  <td className="fee-paid">{formatMoney(r.amount_paid)}</td>
                                  <td className={due - paid > 0 ? 'fee-unpaid' : ''}>{formatMoney(r.balance)}</td>
                                  <td>{r.contact_1 || '—'}</td>
                                  <td>
                                    {canPay && canAddFees() ? (
                                      <button
                                        className="btn btn-outline btn-sm"
                                        onClick={() => quickPay(r.student_id, `${r.first_name} ${r.last_name}`, due, paid, r.academic_month)}
                                      >
                                        Pay
                                      </button>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </Fragment>
                        ));
                      })()
                    )}
                  </tbody>
                </table>
              </div>
<<<<<<< HEAD
              {defaultersView !== 'blank' && defaultersLoaded && !defaultersLoadFailed && defaultersTotalPages > 1 && (
                <div className="pagination-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 0' }}>
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={defaultersPage <= 1}
                    onClick={() => setDefaultersPage((p) => Math.max(p - 1, 1))}
                  >
                    Prev
                  </button>
                  <span className="text-muted text-xs">
                    Page {defaultersPage} of {defaultersTotalPages} ({filteredDefaulters.length} defaulter rows)
                  </span>
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={defaultersPage >= defaultersTotalPages}
                    onClick={() => setDefaultersPage((p) => Math.min(p + 1, defaultersTotalPages))}
                  >
                    Next
                  </button>
                </div>
              )}
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
            </div>
          </div>
        )}

        {/* HISTORY TAB */}
        {tab === 'history' && (
          <div>
            <div className="card mb-3">
              <div className="filters">
                <div ref={historyWrapRef} className="relative min-w-[280px]">
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="Search student by name or roll no…"
                    className="border-input w-full px-2.5 py-[7px] rounded text-[13px] box-border"
                    value={historySearch}
                    onChange={(e) => {
                      setHistorySearch(e.target.value);
                      setHistoryResultsOpen(true);
                    }}
                    onFocus={() => setHistoryResultsOpen(true)}
                  />
                  {historyResultsOpen && (
                    <div className="popup-panel block absolute top-full left-0 right-0 z-20 max-h-[260px] overflow-y-auto rounded-b">
                      {historyMatches.length === 0 ? (
                        <div className="text-muted px-2.5 py-2 text-[13px]">
                          No matching students.
                        </div>
                      ) : (
                        historyMatches.map((s) => (
                          <div
                            key={s.student_id}
                            className="popup-option"
                            onMouseDown={() => selectHistoryStudent(s.student_id)}
                          >
                            {historyStudentLabel(s)}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Month</th>
                      <th>Due</th>
                      <th>Paid</th>
                      <th>Balance</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th>Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!historyStudentId ? (
                      <tr>
                        <td colSpan={8} className="empty">
                          Select a student above.
                        </td>
                      </tr>
                    ) : !historyLoaded ? (
                      <tr>
                        <td colSpan={8} className="loading">
                          Loading…
                        </td>
                      </tr>
                    ) : historyLoadFailed ? (
                      <tr>
                        <td colSpan={8} className="empty">
                          Failed to load.
                        </td>
                      </tr>
                    ) : historyList.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="empty">
                          No payment history.
                        </td>
                      </tr>
                    ) : (
                      historyList.map((r, i) => {
                        const due = +r.amount_due || 0;
                        const paid = +r.amount_paid || 0;
                        const bal = due - paid;
                        let stCls: string, stLabel: string;
                        if (due === 0 && paid === 0) {
                          stCls = 'badge-success';
                          stLabel = 'Free';
                        } else if (paid >= due) {
                          stCls = 'badge-success';
                          stLabel = 'Paid';
                        } else if (paid > 0) {
                          stCls = 'badge-warning';
                          stLabel = 'Partial';
                        } else {
                          stCls = 'badge-danger';
                          stLabel = 'Unpaid';
                        }
                        return (
                          <tr key={r.payment_id ?? i}>
                            <td>{i + 1}</td>
                            <td>{monthLabel(r.academic_month)}</td>
                            <td>{formatMoney(due)}</td>
                            <td className={paid >= due ? 'fee-paid' : paid > 0 ? 'fee-partial' : 'fee-unpaid'}>{formatMoney(paid)}</td>
                            <td>{bal > 0 ? formatMoney(bal) : '—'}</td>
                            <td>
                              <span className={`badge ${stCls}`}>{stLabel}</span>
                            </td>
                            <td>{r.payment_date ? formatDate(r.payment_date) : '—'}</td>
                            <td>
                              <button className="btn btn-outline btn-sm" title="Print receipt" onClick={() => printHistoryReceipt(i)}>
                                🖨
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {historyList.length > 0 && (
                <div className="text-secondary pt-2 text-[13px]">
                  Total Due: <strong>{formatMoney(historyTotals.totalDue)}</strong> &nbsp;|&nbsp; Total Paid:{' '}
                  <strong className="fee-paid">{formatMoney(historyTotals.totalPaid)}</strong> &nbsp;|&nbsp; Outstanding:{' '}
                  <strong className="fee-unpaid">{formatMoney(historyTotals.totalDue - historyTotals.totalPaid)}</strong>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TOTAL FEE TAB (global per-class fee settings) */}
        {tab === 'total-fee' && (
          <div>
            <div className="card mb-3">
              <div className="text-secondary text-[13px] mb-2">
                Set the total (full) fee for each class. This is used only to print the discount line on
                receipts — it does not change monthly Amount Due/Paid/Balance anywhere else.
              </div>
              {canAddClassFees() && (
                <div className="filters">
                  <select
                    className="border-input px-2.5 py-[7px] rounded text-[13px]"
                    value={newFeeClass}
                    onChange={(e) => setNewFeeClass(e.target.value)}
                  >
                    <option value="">Select class…</option>
                    {availableClassesToAdd.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Total fee (Rs.)"
                    className="border-input px-2.5 py-[7px] rounded text-[13px] w-[160px]"
                    value={newFeeAmount}
                    onChange={(e) => setNewFeeAmount(e.target.value)}
                  />
                  <button className="btn btn-success btn-sm" onClick={addClassFee}>
                    + Add
                  </button>
                </div>
              )}
            </div>

            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Class</th>
                      <th>Total Fee (Rs.)</th>
                      <th>Last Updated</th>
                      <th>Updated By</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!classFeesLoaded ? (
                      <tr>
                        <td colSpan={6} className="loading">
                          Loading…
                        </td>
                      </tr>
                    ) : classFeesLoadFailed ? (
                      <tr>
                        <td colSpan={6} className="empty">
                          Failed to load.
                        </td>
                      </tr>
                    ) : classFees.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="empty">
                          No class total fees configured yet.
                        </td>
                      </tr>
                    ) : (
                      classFees.map((row, i) => (
                        <tr key={row.class_fee_id}>
                          <td>{i + 1}</td>
                          <td>{row.class}</td>
                          <td>
                            {editingClassFeeId === row.class_fee_id ? (
                              <input
                                type="number"
                                step="0.01"
                                autoFocus
                                className="border-input px-2 py-1 rounded text-[13px] w-[120px]"
                                value={editingClassFeeAmount}
                                onChange={(e) => setEditingClassFeeAmount(e.target.value)}
                              />
                            ) : (
                              formatMoney(row.total_fee)
                            )}
                          </td>
                          <td>{row.updated_at ? formatDate(row.updated_at) : '—'}</td>
                          <td>{row.updated_by || '—'}</td>
                          <td>
                            <div className="flex gap-1.5">
                              {editingClassFeeId === row.class_fee_id ? (
                                <>
                                  <button className="btn btn-success btn-sm" onClick={() => saveEditClassFee(row.class_fee_id)}>
                                    Save
                                  </button>
                                  <button className="btn btn-outline btn-sm" onClick={cancelEditClassFee}>
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  {canEditClassFees() && (
                                    <button className="btn btn-outline btn-sm" onClick={() => startEditClassFee(row)}>
                                      Edit
                                    </button>
                                  )}
                                  {canDeleteClassFees() && (
                                    <button className="btn btn-outline btn-sm" onClick={() => deleteClassFee(row.class_fee_id)}>
                                      Delete
                                    </button>
                                  )}
                                  {!canEditClassFees() && !canDeleteClassFees() && '—'}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
<<<<<<< HEAD

        {/* STUDENTS FEE TAB (per-student total fee override) */}
        {tab === 'student-fee' && (
          <div>
            <div className="card mb-3">
              <div className="text-secondary text-[13px] mb-2">
                Set the total (full) fee for an individual student — this overrides the class-wide Total Fee
                for that one student only (e.g. a sibling discount or scholarship). It's shown as a read-only
                "Total Fee" field next to Father's Name when recording that student's payment.
              </div>
              {canAddStudentFees() && (
                <div className="filters">
                  <div ref={newStudentFeeWrapRef} className="relative min-w-[280px]">
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="Search student by name or roll no…"
                      className="border-input w-full px-2.5 py-[7px] rounded text-[13px] box-border"
                      value={newStudentFeeSearch}
                      onChange={(e) => {
                        setNewStudentFeeSearch(e.target.value);
                        setNewStudentFeeStudentId(null);
                        setNewStudentFeeResultsOpen(true);
                      }}
                      onFocus={() => setNewStudentFeeResultsOpen(true)}
                    />
                    {newStudentFeeResultsOpen && (
                      <div className="popup-panel block absolute top-full left-0 right-0 z-20 max-h-[260px] overflow-y-auto rounded-b">
                        {newStudentFeeMatches.length === 0 ? (
                          <div className="text-muted px-2.5 py-2 text-[13px]">
                            No matching students.
                          </div>
                        ) : (
                          newStudentFeeMatches.map((s) => (
                            <div
                              key={s.student_id}
                              className="popup-option"
                              onMouseDown={() => selectNewStudentFeeStudent(s.student_id)}
                            >
                              {studentFeePickerLabel(s)}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Total fee (Rs.)"
                    className="border-input px-2.5 py-[7px] rounded text-[13px] w-[160px]"
                    value={newStudentFeeAmount}
                    onChange={(e) => setNewStudentFeeAmount(e.target.value)}
                  />
                  <button className="btn btn-success btn-sm" onClick={addStudentFee}>
                    + Add
                  </button>
                </div>
              )}
            </div>

            <div className="card mb-3">
              <div className="filters">
                <input
                  type="text"
                  placeholder="Search student by name or class…"
                  className="border-input px-2.5 py-[7px] rounded text-[13px] flex-1 min-w-[220px]"
                  value={studentFeeListSearch}
                  onChange={(e) => setStudentFeeListSearch(e.target.value)}
                />
                {studentFeesLoaded && !studentFeesLoadFailed && (
                  <span className="text-secondary text-sm font-semibold ml-auto">
                    {filteredStudentFees.length} record{filteredStudentFees.length !== 1 ? 's' : ''} total
                  </span>
                )}
              </div>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Student</th>
                      <th>Class</th>
                      <th>Total Fee (Rs.)</th>
                      <th>Last Updated</th>
                      <th>Updated By</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!studentFeesLoaded ? (
                      <tr>
                        <td colSpan={7} className="loading">
                          Loading…
                        </td>
                      </tr>
                    ) : studentFeesLoadFailed ? (
                      <tr>
                        <td colSpan={7} className="empty">
                          Failed to load.
                        </td>
                      </tr>
                    ) : filteredStudentFees.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="empty">
                          {studentFeeListSearch ? 'No matching students.' : 'No student total fees configured yet.'}
                        </td>
                      </tr>
                    ) : (
                      pagedStudentFees.map((row, i) => (
                        <tr key={row.student_fee_id}>
                          <td>{(studentFeePage - 1) * STUDENT_FEE_PAGE_SIZE + i + 1}</td>
                          <td>
                            {row.student
                              ? `${row.student.first_name} ${row.student.last_name || ''}`.trim()
                              : `#${row.student_id}`}
                          </td>
                          <td>{row.student ? `${row.student.class}-${row.student.section}` : '—'}</td>
                          <td>
                            {editingStudentFeeId === row.student_fee_id ? (
                              <input
                                type="number"
                                step="0.01"
                                autoFocus
                                className="border-input px-2 py-1 rounded text-[13px] w-[120px]"
                                value={editingStudentFeeAmount}
                                onChange={(e) => setEditingStudentFeeAmount(e.target.value)}
                              />
                            ) : (
                              formatMoney(row.total_fee)
                            )}
                          </td>
                          <td>{row.updated_at ? formatDate(row.updated_at) : '—'}</td>
                          <td>{row.updated_by || '—'}</td>
                          <td>
                            <div className="flex gap-1.5">
                              {editingStudentFeeId === row.student_fee_id ? (
                                <>
                                  <button className="btn btn-success btn-sm" onClick={() => saveEditStudentFee(row.student_fee_id)}>
                                    Save
                                  </button>
                                  <button className="btn btn-outline btn-sm" onClick={cancelEditStudentFee}>
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  {canEditStudentFees() && (
                                    <button className="btn btn-outline btn-sm" onClick={() => startEditStudentFee(row)}>
                                      Edit
                                    </button>
                                  )}
                                  {canDeleteStudentFees() && (
                                    <button className="btn btn-outline btn-sm" onClick={() => deleteStudentFee(row.student_fee_id)}>
                                      Delete
                                    </button>
                                  )}
                                  {!canEditStudentFees() && !canDeleteStudentFees() && '—'}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {!studentFeesLoaded || studentFeesLoadFailed ? null : studentFeeTotalPages > 1 && (
                <div className="pagination-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 0' }}>
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={studentFeePage <= 1}
                    onClick={() => setStudentFeePage((p) => Math.max(p - 1, 1))}
                  >
                    Prev
                  </button>
                  <span className="text-muted text-xs">
                    Page {studentFeePage} of {studentFeeTotalPages} ({filteredStudentFees.length} records)
                  </span>
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={studentFeePage >= studentFeeTotalPages}
                    onClick={() => setStudentFeePage((p) => Math.min(p + 1, studentFeeTotalPages))}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
=======
>>>>>>> 745f1823290bc92d675237a5ec8114f7c8833b2e
      </div>

      <style jsx>{`
        .tab-btn {
          background: none;
          border: none;
          padding: 8px 18px;
          font-size: 13px;
          cursor: pointer;
          color: var(--muted);
          border-bottom: 2px solid transparent;
          font-weight: 500;
        }
        .tab-btn.active {
          color: var(--text);
          border-bottom-color: var(--text);
        }
        .tab-btn:hover {
          color: var(--text);
        }
        .period-switch {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .period-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
        }
        .period-label.inactive {
          color: var(--muted);
          font-weight: 400;
        }
        @media (max-width: 768px) {
          .tab-btn {
            padding: 10px 16px;
            min-height: 40px;
            white-space: nowrap;
          }
        }
      `}</style>
    </>
  );
}