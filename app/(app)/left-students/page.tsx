'use client';

/**
 * app/left-students/page.tsx — direct port of frontend/left-students.html.
 * Same edit modal, same boys/girls narrowing filter, same
 * confirm()-gated delete flow.
 */

import { useEffect, useMemo, useState } from 'react';
import AuthedPage from '@/components/AuthedPage';
import Avatar from '@/components/Avatar';
import { api, formatDate, normalizeList } from '@/lib/api-client';
import { showToast } from '@/lib/toast';
import { hasPerm, loadMyPermissions, refreshMyPermissions } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';

interface LeftStudent {
  left_student_id: number;
  first_name: string;
  last_name: string | null;
  roll_no: number | null;
  class: string | null;
  section: string | null;
  gender: 'male' | 'female' | null;
  father_name: string | null;
  email: string | null;
  contact_1: string | null;
  contact_2: string | null;
  address: string | null;
  admission_date: string | null;
  left_date: string | null;
  left_reason: string | null;
  photo_url?: string | null;
}

// Capitalizes just the first letter of a name so "ali" -> "Ali" while
// leaving the rest of the string untouched. Applied on save to
// first_name/last_name/father_name — same helper as the Students page.
function capitalizeFirst(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

const emptyForm = {
  left_student_id: '' as string | number,
  first_name: '',
  last_name: '',
  roll_no: '',
  class: '',
  section: '',
  gender: '',
  father_name: '',
  email: '',
  contact_1: '',
  contact_2: '',
  address: '',
  admission_date: '',
  left_date: '',
  left_reason: '',
};

export default function LeftStudentsPage() {
  return (
    <AuthedPage activePage="left-students">
      <LeftStudentsContent />
    </AuthedPage>
  );
}

function LeftStudentsContent() {
  const [allLeftStudents, setAllLeftStudents] = useState<LeftStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filterBoys, setFilterBoys] = useState(false);
  const [filterGirls, setFilterGirls] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [, setPermTick] = useState(0);

  // Perf: cap rendered rows regardless of how many students have left
  // over the school's history — same reasoning as the Students page.
  const PAGE_SIZE = 100;
  const [tablePage, setTablePage] = useState(1);

  async function loadLeftStudents() {
    setLoading(true);
    try {
      // limit=0: this page filters client-side (boys/girls toggle), same
      // reasoning as the Students page — opt out of the new server-side
      // default cap since the full list is needed for that to work.
      const res = await api('GET', '/api/students/left?limit=0');
      setAllLeftStudents(normalizeList<LeftStudent>(res, ['former_students', 'students', 'data']));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadMyPermissions();
      setPermTick((n) => n + 1);
      await loadLeftStudents();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLiveUpdates({
    'left-students.changed': () => loadLeftStudents(),
    'permissions.changed': () => refreshMyPermissions(() => setPermTick((n) => n + 1)),
  });

  const filtered = useMemo(() => {
    const wantBoys = filterBoys;
    const wantGirls = filterGirls;
    const genderNarrowed = wantBoys !== wantGirls;
    return allLeftStudents.filter(
      (s) => !genderNarrowed || (wantBoys && s.gender === 'male') || (wantGirls && s.gender === 'female')
    );
  }, [allLeftStudents, filterBoys, filterGirls]);

  useEffect(() => {
    setTablePage(1);
  }, [filterBoys, filterGirls, allLeftStudents]);

  const totalTablePages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const pagedLeftStudents = useMemo(
    () => filtered.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE),
    [filtered, tablePage]
  );

  function editLeftStudent(id: number) {
    const s = allLeftStudents.find((x) => x.left_student_id === id);
    if (!s) return;
    setForm({
      left_student_id: s.left_student_id,
      first_name: s.first_name || '',
      last_name: s.last_name || '',
      roll_no: s.roll_no ? String(s.roll_no) : '',
      class: s.class || '',
      section: s.section || '',
      gender: s.gender || '',
      father_name: s.father_name || '',
      email: s.email || '',
      contact_1: s.contact_1 || '',
      contact_2: s.contact_2 || '',
      address: s.address || '',
      admission_date: s.admission_date ? s.admission_date.slice(0, 10) : '',
      left_date: s.left_date ? s.left_date.slice(0, 10) : '',
      left_reason: s.left_reason || '',
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  async function saveLeftStudent() {
    const id = form.left_student_id;
    const body = {
      first_name: capitalizeFirst(form.first_name),
      last_name: capitalizeFirst(form.last_name),
      roll_no: form.roll_no || null,
      class: form.class.trim(),
      section: form.section.trim(),
      gender: form.gender || null,
      father_name: capitalizeFirst(form.father_name),
      email: form.email.trim(),
      contact_1: form.contact_1.trim(),
      contact_2: form.contact_2.trim(),
      address: form.address.trim(),
      admission_date: form.admission_date || null,
      left_date: form.left_date || null,
      left_reason: form.left_reason.trim(),
    };
    if (!body.first_name) {
      showToast('First name is required.', 'error');
      return;
    }
    try {
      await api('PUT', `/api/students/left/${id}`, body);
      showToast('Left student record updated.');
      closeModal();
      loadLeftStudents();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function deleteLeftStudent(id: number) {
    const s = allLeftStudents.find((x) => x.left_student_id === id);
    if (
      !confirm(
        `Delete left-student record for "${s ? s.first_name + ' ' + s.last_name : 'this student'}"? This cannot be undone.`
      )
    )
      return;
    try {
      await api('DELETE', `/api/students/left/${id}`);
      showToast('Left student record deleted.');
      loadLeftStudents();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  const canEdit = hasPerm('left-students.edit');
  const canDelete = hasPerm('left-students.delete');

  return (
    <>
      <div className={`modal-overlay${modalOpen ? ' open' : ''}`}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">Edit Left Student Record</h2>
            <button className="modal-close" onClick={closeModal} aria-label="Close">
              ×
            </button>
          </div>
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="left-student-first-name">First Name *</label>
                <input
                  id="left-student-first-name"
                  type="text"
                  required
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="left-student-last-name">Last Name</label>
                <input
                  id="left-student-last-name"
                  type="text"
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="left-student-roll-no">Roll No</label>
                <input
                  id="left-student-roll-no"
                  type="number"
                  min={1}
                  value={form.roll_no}
                  onChange={(e) => setForm({ ...form, roll_no: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="left-student-class">Class</label>
                <input id="left-student-class" type="text" value={form.class} onChange={(e) => setForm({ ...form, class: e.target.value })} />
              </div>
              <div className="form-group">
                <label htmlFor="left-student-section">Section</label>
                <input
                  id="left-student-section"
                  type="text"
                  value={form.section}
                  onChange={(e) => setForm({ ...form, section: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="left-student-gender">Gender</label>
                <select id="left-student-gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option value="">Not specified</option>
                  <option value="male">Boy</option>
                  <option value="female">Girl</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="left-student-father-s-name">Father's Name</label>
                <input
                  id="left-student-father-s-name"
                  type="text"
                  value={form.father_name}
                  onChange={(e) => setForm({ ...form, father_name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="left-student-email">Email</label>
                <input id="left-student-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="left-student-contact-1">Contact 1</label>
                <input
                  id="left-student-contact-1"
                  type="text"
                  value={form.contact_1}
                  onChange={(e) => setForm({ ...form, contact_1: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="left-student-contact-2">Contact 2</label>
                <input
                  id="left-student-contact-2"
                  type="text"
                  value={form.contact_2}
                  onChange={(e) => setForm({ ...form, contact_2: e.target.value })}
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="left-student-address">Address</label>
              <input
                id="left-student-address"
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="left-student-admission-date">Admission Date</label>
                <input
                  id="left-student-admission-date"
                  type="date"
                  value={form.admission_date}
                  onChange={(e) => setForm({ ...form, admission_date: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="left-student-left-date">Left Date</label>
                <input
                  id="left-student-left-date"
                  type="date"
                  value={form.left_date}
                  onChange={(e) => setForm({ ...form, left_date: e.target.value })}
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="left-student-reason">Reason</label>
              <input
                id="left-student-reason"
                type="text"
                placeholder="Reason for leaving"
                value={form.left_reason}
                onChange={(e) => setForm({ ...form, left_reason: e.target.value })}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={saveLeftStudent}>
                Save
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Left Students</h1>
        </div>
        <div className="card mb-4">
          <div className="filters">
            <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
              <input type="checkbox" checked={filterBoys} onChange={(e) => setFilterBoys(e.target.checked)} /> Boys
            </label>
            <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
              <input type="checkbox" checked={filterGirls} onChange={(e) => setFilterGirls(e.target.checked)} /> Girls
            </label>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Photo</th>
                  <th>Roll No</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>Section</th>
                  <th>Gender</th>
                  <th>Admission</th>
                  <th>Left Date</th>
                  <th>Reason</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} className="loading">
                      Loading…
                    </td>
                  </tr>
                ) : loadFailed ? (
                  <tr>
                    <td colSpan={11} className="empty">
                      Failed to load left students.
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="empty">
                      No left students found.
                    </td>
                  </tr>
                ) : (
                  pagedLeftStudents.map((s, i) => (
                    <tr key={s.left_student_id}>
                      <td>{(tablePage - 1) * PAGE_SIZE + i + 1}</td>
                      <td>
                        <Avatar src={s.photo_url} name={`${s.first_name} ${s.last_name || ''}`} />
                      </td>
                      <td>{s.roll_no || '—'}</td>
                      <td>
                        {s.first_name} {s.last_name}
                      </td>
                      <td>{s.class || '—'}</td>
                      <td>{s.section || '—'}</td>
                      <td>{s.gender === 'male' ? 'Boy' : s.gender === 'female' ? 'Girl' : '—'}</td>
                      <td>{formatDate(s.admission_date)}</td>
                      <td>{formatDate(s.left_date)}</td>
                      <td>{s.left_reason || '—'}</td>
                      <td>
                        {canEdit && (
                          <button className="btn btn-outline btn-sm" onClick={() => editLeftStudent(s.left_student_id)}>
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button className="btn btn-danger btn-sm" onClick={() => deleteLeftStudent(s.left_student_id)}>
                            Delete
                          </button>
                        )}
                        {!canEdit && !canDelete && '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loading && !loadFailed && totalTablePages > 1 && (
            <div className="pagination-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 0' }}>
              <button
                className="btn btn-outline btn-sm"
                disabled={tablePage <= 1}
                onClick={() => setTablePage((p) => Math.max(p - 1, 1))}
              >
                Prev
              </button>
              <span className="text-muted text-xs">
                Page {tablePage} of {totalTablePages} ({filtered.length} students)
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
      </div>
    </>
  );
}
