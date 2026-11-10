'use client';

/**
 * app/students/page.tsx — direct port of frontend/students.html.
 * Same modal-based add/edit form, same profile view modal, same photo
 * upload (file takes precedence over URL, same field-order-before-file
 * multipart contract), same filters, same leave/delete confirm() flows.
 */

import { useEffect, useDeferredValue, useMemo, useRef, useState } from 'react';
import AuthedPage from '@/components/AuthedPage';
import Avatar from '@/components/Avatar';
import { api, apiForm, dbg, formatDate, normalizeList } from '@/lib/api-client';
import { showToast } from '@/lib/toast';
import { hasPerm, loadMyPermissions, refreshMyPermissions } from '@/lib/permissions-client';
import { useLiveUpdates } from '@/lib/useLiveUpdates';
import { bindPanelKeyboardNavigation } from '@/lib/api-client';


interface Student {
  student_id: number;
  first_name: string;
  last_name: string | null;
  roll_no: number | null;
  class: string;
  section: string;
  gender: 'male' | 'female' | null;
  father_name: string | null;
  admission_date: string | null;
  fee_start_month: string | null;
  contact_1: string | null;
  contact_2: string | null;
  email: string | null;
  photo_url: string | null;
  address: string | null;
}

// Capitalizes just the first letter of a name so "ali" -> "Ali" while
// leaving the rest of the string untouched (doesn't force-lowercase the
// remainder, so "McDonald" or "ALI" stay as typed apart from that first
// character). Applied on save to first_name/last_name/father_name.
function capitalizeFirst(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function makeEmptyForm() {
  return {
    student_id: '' as string | number,
    first_name: '',
    last_name: '',
    roll_no: '',
    class: '',
    section: '',
    gender: '',
    father_name: '',
    admission_date: new Date().toISOString().slice(0, 10),
    fee_start_month: '',
    contact_1: '',
    contact_2: '',
    email: '',
    photo_url: '',
    address: '',
  };
}

export default function StudentsPage() {
  return (
    <AuthedPage activePage="students">
      <StudentsContent />
    </AuthedPage>
  );
}

function StudentsContent() {
  // Left Students now lives at its own /left-students route (see
  // NavBar) rather than as a tab here.

  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [filterBoys, setFilterBoys] = useState(false);
  const [filterGirls, setFilterGirls] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(() => makeEmptyForm());
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const photoFileInputRef = useRef<HTMLInputElement>(null);

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileStudent, setProfileStudent] = useState<Student | null>(null);

  // Change Section flow: step 1 picks a student (search reuses the same
  // pattern as the main table search), step 2 confirms the move. Kept
  // as its own small modal rather than repurposing the edit modal so
  // this stays a focused, single-purpose action instead of a full edit
  // form the user has to navigate around.
  const [changeSectionOpen, setChangeSectionOpen] = useState(false);
  const [changeSectionStep, setChangeSectionStep] = useState<'pick' | 'confirm'>('pick');
  const [changeSectionSearch, setChangeSectionSearch] = useState('');
  const [changeSectionStudent, setChangeSectionStudent] = useState<Student | null>(null);
  const [changeSectionClass, setChangeSectionClass] = useState('');
  const [changeSectionSection, setChangeSectionSection] = useState('');
  const [changeSectionSaving, setChangeSectionSaving] = useState(false);

  const [permTick, setPermTick] = useState(0); // bump to re-render after permissions change
  const formRef = useRef<HTMLFormElement>(null);

  // Perf: the full roster is still fetched/searched client-side (see
  // `filtered` below — that instant-search UX is intentional and stays),
  // but rendering every matched row into the DOM at once got slower
  // every year of admissions. Capping rendered rows per page keeps the
  // table fast to paint/scroll regardless of roster size, without
  // changing how search/filter feels.
  const PAGE_SIZE = 100;
  const [tablePage, setTablePage] = useState(1);

  async function loadStudents() {
    setLoading(true);
    try {
      // limit=0: this page does instant client-side search/filter across
      // the whole roster (see `filtered` below), so it still needs every
      // row up front — but the backend default LIMIT now exists to
      // protect every other/future caller that doesn't need that, so we
      // opt out explicitly here rather than relying on an implicit
      // unbounded default.
      const res = await api('GET', '/api/students?limit=0');
      dbg('students raw', res);
      const list = normalizeList<Student>(res, ['students', 'data']);
      setAllStudents(list);
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
      await loadStudents();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (formRef.current) {
      return bindPanelKeyboardNavigation(formRef.current);
    }
  }, [modalOpen]);

  useLiveUpdates({
    'students.changed': () => loadStudents(),
    'permissions.changed': () => refreshMyPermissions(() => setPermTick((n) => n + 1)),
  });

  // Deferred copies of the text filters: typing updates the input
  // instantly (search/filterClass/filterSection stay in sync with each
  // keystroke so the box never feels laggy), while the expensive
  // filter+re-render of the whole table trails a frame behind via
  // React's scheduler. This is what stops "type -> table freezes for a
  // moment -> results appear" — the input itself never blocks.
  const deferredSearch = useDeferredValue(search);
  const deferredFilterClass = useDeferredValue(filterClass);
  const deferredFilterSection = useDeferredValue(filterSection);

  const filtered = useMemo(() => {
    const q = deferredSearch.toLowerCase();
    const clsQ = deferredFilterClass.trim().toLowerCase();
    const secQ = deferredFilterSection.trim().toLowerCase();
    const wantBoys = filterBoys;
    const wantGirls = filterGirls;
    const genderNarrowed = wantBoys !== wantGirls;
    return allStudents.filter((s) => {
      const name = `${s.first_name} ${s.last_name} ${s.roll_no}`.toLowerCase();
      return (
        (!q || name.includes(q)) &&
        (!clsQ || (s.class || '').toLowerCase().includes(clsQ)) &&
        (!secQ || (s.section || '').toLowerCase().includes(secQ)) &&
        (!genderNarrowed || (wantBoys && s.gender === 'male') || (wantGirls && s.gender === 'female'))
      );
    });
  }, [allStudents, deferredSearch, deferredFilterClass, deferredFilterSection, filterBoys, filterGirls]);

  // Reset to page 1 whenever the result set changes shape (new search,
  // filter change, or the roster itself reloading) so the user never
  // lands on a now-empty trailing page.
  useEffect(() => {
    setTablePage(1);
  }, [deferredSearch, deferredFilterClass, deferredFilterSection, filterBoys, filterGirls, allStudents]);

  const totalTablePages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const pagedStudents = useMemo(
    () => filtered.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE),
    [filtered, tablePage]
  );

  function setPhotoPreviewFor(src: string) {
    setPhotoPreview(src);
  }

  function openModal(student: Student | null = null) {
    setForm({
      student_id: student ? student.student_id : '',
      first_name: student ? student.first_name : '',
      last_name: student ? student.last_name || '' : '',
      roll_no: student ? String(student.roll_no ?? '') : '',
      class: student ? student.class : '',
      section: student ? student.section : '',
      gender: student ? student.gender || '' : '',
      father_name: student ? student.father_name || '' : '',
      admission_date: student ? (student.admission_date ? student.admission_date.slice(0, 10) : '') : new Date().toISOString().slice(0, 10),
      fee_start_month: student ? (student.fee_start_month ? student.fee_start_month.slice(0, 7) : '') : '',
      contact_1: student ? student.contact_1 || '' : '',
      contact_2: student ? student.contact_2 || '' : '',
      email: student ? student.email || '' : '',
      photo_url: student ? student.photo_url || '' : '',
      address: student ? student.address || '' : '',
    });
    setPhotoFile(null);
    if (photoFileInputRef.current) photoFileInputRef.current.value = '';
    setPhotoPreviewFor(student ? student.photo_url || '' : '');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setPhotoFile(null);
    if (photoFileInputRef.current) photoFileInputRef.current.value = '';
    setPhotoPreviewFor('');
  }

  function viewStudent(id: number) {
    const s = allStudents.find((x) => x.student_id === id);
    if (!s) return;
    setProfileStudent(s);
    setProfileOpen(true);
  }

  function closeProfileModal() {
    setProfileOpen(false);
    setProfileStudent(null);
  }

  function previewSelectedPhoto(file: File | null) {
    setPhotoFile(file);
    if (!file) {
      setPhotoPreviewFor(form.photo_url.trim());
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhotoPreviewFor(String(reader.result));
    reader.readAsDataURL(file);
  }

  function editStudent(id: number) {
    const s = allStudents.find((x) => x.student_id === id);
    if (s) openModal(s);
  }

  // ── Change Section flow ─────────────────────────────────────────
  function openChangeSectionModal() {
    setChangeSectionStep('pick');
    setChangeSectionSearch('');
    setChangeSectionStudent(null);
    setChangeSectionClass('');
    setChangeSectionSection('');
    setChangeSectionOpen(true);
  }

  function closeChangeSectionModal() {
    if (changeSectionSaving) return; // don't let a stray click cancel mid-save
    setChangeSectionOpen(false);
    setChangeSectionStudent(null);
  }

  function pickChangeSectionStudent(s: Student) {
    setChangeSectionStudent(s);
    // Pre-fill with the student's current class/section so the field
    // starts somewhere sensible — the user still has to actually
    // change it (checked before saving below) rather than being able
    // to "confirm" a no-op move.
    setChangeSectionClass(s.class);
    setChangeSectionSection(s.section);
    setChangeSectionStep('confirm');
  }

  async function confirmChangeSection() {
    if (!changeSectionStudent) return;
    const newClass = changeSectionClass.trim();
    const newSection = changeSectionSection.trim();

    if (!newClass || !newSection) {
      showToast('Please choose both a class and a section.', 'error');
      return;
    }
    if (!/^[A-Za-z]$/.test(newSection) && !/^[A-Za-z]+-[A-Za-z]$/.test(newSection)) {
      showToast('Section must be a single letter (A, B, C) or a stream + letter like Csc-A, Bio-B, Arts-A.', 'error');
      return;
    }
    const noChange =
      newClass.toLowerCase() === changeSectionStudent.class.toLowerCase() &&
      newSection.toUpperCase() === changeSectionStudent.section.toUpperCase();
    if (noChange) {
      showToast('That is the same class and section the student is already in.', 'error');
      return;
    }

    setChangeSectionSaving(true);
    try {
      // Deliberately omit roll_no: the student's roll number in their
      // OLD class/section is simply left as-is — nobody else there is
      // renumbered or shifted to fill the gap, so that section's
      // existing roll numbers stay exactly as they were (Roll 10
      // becoming vacant in 10-A doesn't get reused or reshuffled).
      // Leaving roll_no out of this PUT is what makes the backend
      // (app/api/students/[id]/route.ts) auto-assign the next
      // available roll number scoped to the NEW class+section+gender —
      // see its `scopeChanged` / MAX_ATTEMPTS retry-on-collision logic,
      // which already guarantees this can't collide with or overwrite
      // an existing student there.
      const body = {
        first_name: changeSectionStudent.first_name,
        last_name: changeSectionStudent.last_name || '',
        class: newClass,
        section: newSection,
        gender: changeSectionStudent.gender || null,
        father_name: changeSectionStudent.father_name || '',
        contact_1: changeSectionStudent.contact_1 || '',
        contact_2: changeSectionStudent.contact_2 || '',
        email: changeSectionStudent.email || null,
        photo_url: changeSectionStudent.photo_url || null,
        address: changeSectionStudent.address || '',
        admission_date: changeSectionStudent.admission_date
          ? changeSectionStudent.admission_date.slice(0, 10)
          : null,
        fee_start_month: changeSectionStudent.fee_start_month
          ? changeSectionStudent.fee_start_month.slice(0, 7) + '-01'
          : null,
        // roll_no intentionally omitted — see comment above.
      };
      const res: any = await api('PUT', `/api/students/${changeSectionStudent.student_id}`, body);
      const newRoll = res?.student?.roll_no;
      showToast(
        `${changeSectionStudent.first_name} moved to ${newClass}-${newSection}` +
          (newRoll != null ? ` with Roll No ${newRoll}.` : '.'),
        'success'
      );
      setChangeSectionOpen(false);
      setChangeSectionStudent(null);
      loadStudents();
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setChangeSectionSaving(false);
    }
  }

  const changeSectionResults = useMemo(() => {
    const q = changeSectionSearch.trim().toLowerCase();
    if (!q) return [];
    return allStudents
      .filter((s) => {
        const name = `${s.first_name} ${s.last_name} ${s.roll_no} ${s.class} ${s.section}`.toLowerCase();
        return name.includes(q);
      })
      .slice(0, 20); // cap results — this is a picker, not the full table
  }, [allStudents, changeSectionSearch]);

  async function saveStudent() {
    const id = form.student_id;
    const body = {
      first_name: capitalizeFirst(form.first_name),
      last_name: capitalizeFirst(form.last_name),
      roll_no: form.roll_no ? parseInt(form.roll_no, 10) : null,
      class: form.class.trim(),
      section: form.section.trim(),
      gender: form.gender || null,
      father_name: capitalizeFirst(form.father_name),
      admission_date: form.admission_date || null,
      fee_start_month: form.fee_start_month ? `${form.fee_start_month}-01` : null,
      contact_1: form.contact_1.trim(),
      contact_2: form.contact_2.trim(),
      email: form.email.trim() || null,
      photo_url: form.photo_url.trim() || null,
      address: form.address.trim(),
    };

    if (!body.first_name || !body.class || !body.section) {
      showToast('Please fill all required fields.', 'error');
      return;
    }
    if (!/^[A-Za-z]$/.test(body.section) && !/^[A-Za-z]+-[A-Za-z]$/.test(body.section)) {
      showToast('Section must be a single letter (A, B, C) or a stream + letter like Csc-A, Bio-B, Arts-A.', 'error');
      return;
    }
    if (!body.gender) {
      showToast('Please select a gender.', 'error');
      return;
    }

    try {
      const createBody: any = {
        ...body,
        photo_url: photoFile ? null : body.photo_url,
      };

      if (id) {
        if (photoFile) {
          const formData = new FormData();
          // NOTE: text fields must be appended BEFORE the file field.
          // multer/busboy streams multipart fields in the order they
          // arrive, and our dynamic destination() function (which sorts
          // photos into uploads/<gender>/<class>/<section>/<roll_no>.ext)
          // needs class/section/roll_no/gender already parsed from
          // req.body by the time it runs for the photo part.
          formData.append('first_name', body.first_name);
          formData.append('class', body.class);
          formData.append('section', body.section);
          formData.append('roll_no', String(body.roll_no || ''));
          formData.append('gender', body.gender || '');
          formData.append('photo', photoFile);
          const upload: any = await apiForm('/api/students/upload-photo', formData);
          body.photo_url = upload.url;
        }

        await api('PUT', `/api/students/${id}`, body);
        showToast('Student updated.', 'success');
      } else {
        const studentRes: any = await api('POST', '/api/students', createBody);
        if (photoFile) {
          const uploadForm = new FormData();
          uploadForm.append('first_name', studentRes.student.first_name);
          uploadForm.append('class', studentRes.student.class);
          uploadForm.append('section', studentRes.student.section);
          uploadForm.append('roll_no', String(studentRes.student.roll_no || ''));
          uploadForm.append('gender', studentRes.student.gender || '');
          uploadForm.append('photo', photoFile);
          const upload: any = await apiForm('/api/students/upload-photo', uploadForm);
          await api('PUT', `/api/students/${studentRes.student.student_id}`, { ...body, photo_url: upload.url });
        }

        showToast('Student added.', 'success');
      }
      closeModal();
      loadStudents();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function deleteStudent(id: number) {
    const s = allStudents.find((x) => x.student_id === id);
    const name = s ? `${s.first_name} ${s.last_name}` : 'this student';
    if (!confirm(`Delete student "${name}"? This cannot be undone.`)) return;
    try {
      await api('DELETE', `/api/students/${id}`);
      showToast('Student deleted.');
      loadStudents();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  async function leaveStudent(id: number) {
    const s = allStudents.find((x) => x.student_id === id);
    const name = s ? `${s.first_name} ${s.last_name}` : 'this student';
    if (!confirm(`Mark student "${name}" as left the school?`)) return;
    try {
      await api('POST', `/api/students/${id}/leave`, { left_reason: 'Left school' });
      showToast('Student moved to left students records.', 'success');
      loadStudents();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  }

  return (
    <>
      {/* Add/Edit Modal */}
      <div className={`modal-overlay${modalOpen ? ' open' : ''}`}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">{form.student_id ? 'Edit Student' : 'Add Student'}</h2>
            <button className="modal-close" onClick={closeModal} aria-label="Close">
              ×
            </button>
          </div>
          <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="student-first-name">First Name *</label>
                <input
                  id="student-first-name"
                  type="text"
                  required
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="student-last-name">Last Name</label>
                <input
                  id="student-last-name"
                  type="text"
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="student-roll-no">Roll No</label>
                <input
                  id="student-roll-no"
                  type="number"
                  placeholder="Leave blank for auto assign"
                  value={form.roll_no}
                  onChange={(e) => setForm({ ...form, roll_no: e.target.value })}
                />
                <small className="text-secondary block mt-1">
                  If no roll number is entered, the system assigns the next available number within this class,
                  section, and gender (each combination has its own independent numbering).
                </small>
              </div>
              <div className="form-group">
                <label htmlFor="student-class">Class *</label>
                <input
                  id="student-class"
                  type="text"
                  required
                  placeholder="playgroup, nursery, prep or 1-10"
                  value={form.class}
                  onChange={(e) => setForm({ ...form, class: e.target.value })}
                />
                <small className="text-secondary block mt-1">
                  Enter a valid class name. Only playgroup, nursery, prep, and 1 through 10 are accepted.
                </small>
              </div>
              <div className="form-group">
                <label htmlFor="student-section">Section *</label>
                <input
                  id="student-section"
                  type="text"
                  placeholder="A, B, C or Csc-A, Bio-B, Arts-A"
                  maxLength={10}
                  value={form.section}
                  onChange={(e) => setForm({ ...form, section: e.target.value })}
                />
                <small className="text-secondary block mt-1">
                  Enter a single letter (A, B, C) or a stream name + letter (e.g. Csc-A, Bio-B, Arts-A).
                </small>
              </div>
              <div className="form-group">
                <label htmlFor="student-gender">Gender *</label>
                <select id="student-gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option value="" disabled>Select gender…</option>
                  <option value="male">Boy</option>
                  <option value="female">Girl</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="student-father-s-name">Father's Name</label>
                <input
                  id="student-father-s-name"
                  type="text"
                  value={form.father_name}
                  onChange={(e) => setForm({ ...form, father_name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="student-admission-date">Admission Date</label>
                <input
                  id="student-admission-date"
                  type="date"
                  value={form.admission_date}
                  onChange={(e) => setForm({ ...form, admission_date: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="student-fee-start-month">Fee Start Month</label>
                <input
                  id="student-fee-start-month"
                  type="month"
                  value={form.fee_start_month}
                  onChange={(e) => setForm({ ...form, fee_start_month: e.target.value })}
                />
                <small className="text-secondary block mt-1">
                  Use Month-YYYY to control when fee billing begins. Leave blank to use admission month.
                </small>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="student-contact-1">Contact 1</label>
                <input
                  id="student-contact-1"
                  type="text"
                  placeholder="03xx-xxxxxxx or 03xxxxxxxxx"
                  value={form.contact_1}
                  onChange={(e) => setForm({ ...form, contact_1: e.target.value })}
                />
                <small className="text-secondary block mt-1">
                  Mobile (03xx-xxxxxxx) or landline (051-xxxxxxx). Dashes optional — saved in this format automatically.
                </small>
              </div>
              <div className="form-group">
                <label htmlFor="student-contact-2">Contact 2</label>
                <input
                  id="student-contact-2"
                  type="text"
                  placeholder="Optional"
                  value={form.contact_2}
                  onChange={(e) => setForm({ ...form, contact_2: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="student-email">Email</label>
                <input
                  id="student-email"
                  type="email"
                  placeholder="student@example.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="student-photo-url">Photo URL</label>
                <input
                  id="student-photo-url"
                  type="url"
                  placeholder="https://example.com/photo.jpg"
                  value={form.photo_url}
                  onChange={(e) => {
                    setForm({ ...form, photo_url: e.target.value });
                    if (!photoFile) setPhotoPreviewFor(e.target.value.trim());
                  }}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group w-full">
                <label htmlFor="student-upload-photo">Upload Photo</label>
                <input
                  id="student-upload-photo"
                  ref={photoFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => previewSelectedPhoto(e.target.files?.[0] || null)}
                />
                <small className="text-secondary block mt-1">
                  If you choose a file, it will be uploaded and used instead of the Photo URL.
                </small>
              </div>
            </div>
            <div className={`form-row ${photoPreview ? 'flex' : 'hidden'}`}>
              <div className="form-group w-full">
                <span className="form-group-caption">Photo Preview</span>
                <div className="border border-[#ccc] rounded-lg overflow-hidden w-40 h-40 flex items-center justify-center bg-input-bg">
                  {photoPreview && (
                    <img src={photoPreview} alt="Photo preview" className="max-w-full max-h-full block" />
                  )}
                </div>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="student-address">Address</label>
              <textarea
                id="student-address"
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closeModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={saveStudent}>
                Save Student
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Change Section Modal — two steps: pick a student, then
          confirm the new class/section. */}
      <div className={`modal-overlay${changeSectionOpen ? ' open' : ''}`}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">Change Section</h2>
            <button className="modal-close" onClick={closeChangeSectionModal} aria-label="Close">
              ×
            </button>
          </div>

          {changeSectionStep === 'pick' && (
            <>
              <div className="form-group">
                <label htmlFor="change-section-search">Search Student</label>
                <input
                  id="change-section-search"
                  type="text"
                  autoFocus
                  placeholder="Search name, roll no, class, section…"
                  value={changeSectionSearch}
                  onChange={(e) => setChangeSectionSearch(e.target.value)}
                />
              </div>
              <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {changeSectionSearch.trim() === '' ? (
                  <p className="text-secondary text-sm px-1">Start typing to find a student.</p>
                ) : changeSectionResults.length === 0 ? (
                  <p className="text-secondary text-sm px-1">No matching students.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Roll No</th>
                        <th>Name</th>
                        <th>Class</th>
                        <th>Section</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {changeSectionResults.map((s) => (
                        <tr key={s.student_id}>
                          <td>{s.roll_no}</td>
                          <td>
                            <strong>
                              {s.first_name} {s.last_name}
                            </strong>
                          </td>
                          <td>{s.class}</td>
                          <td>{s.section}</td>
                          <td>
                            <button className="btn btn-outline btn-sm" onClick={() => pickChangeSectionStudent(s)}>
                              Select
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={closeChangeSectionModal}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {changeSectionStep === 'confirm' && changeSectionStudent && (
            <>
              <div className="card mb-4" style={{ background: 'var(--panel-2)' }}>
                <div className="flex items-center gap-3">
                  <Avatar
                    src={changeSectionStudent.photo_url}
                    name={`${changeSectionStudent.first_name} ${changeSectionStudent.last_name || ''}`}
                  />
                  <div>
                    <strong>
                      {changeSectionStudent.first_name} {changeSectionStudent.last_name}
                    </strong>
                    <div className="text-secondary text-sm">
                      Currently Roll No {changeSectionStudent.roll_no} · {changeSectionStudent.class}-
                      {changeSectionStudent.section}
                    </div>
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="change-section-new-class">New Class *</label>
                  <input
                    id="change-section-new-class"
                    type="text"
                    placeholder="playgroup, nursery, prep or 1-10"
                    value={changeSectionClass}
                    onChange={(e) => setChangeSectionClass(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="change-section-new-section">New Section *</label>
                  <input
                    id="change-section-new-section"
                    type="text"
                    placeholder="A, B, C or Csc-A, Bio-B, Arts-A"
                    maxLength={10}
                    value={changeSectionSection}
                    onChange={(e) => setChangeSectionSection(e.target.value)}
                  />
                </div>
              </div>
              <small className="text-secondary block mt-1 mb-4">
                The student's current Roll No ({changeSectionStudent.roll_no}) stays reserved and untouched
                in {changeSectionStudent.class}-{changeSectionStudent.section} — no one else there is
                renumbered. In {changeSectionClass || '…'}-{changeSectionSection || '…'}, the student is
                automatically given the next available Roll No; nothing existing is overwritten.
              </small>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setChangeSectionStep('pick')}
                  disabled={changeSectionSaving}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={confirmChangeSection}
                  disabled={changeSectionSaving}
                >
                  {changeSectionSaving ? 'Moving…' : 'Confirm Move'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Profile Modal */}
      <div className={`modal-overlay${profileOpen ? ' open' : ''}`}>
        <div className="modal">
          <div className="modal-header">
            <h2 className="modal-title">Student Profile</h2>
            <button className="modal-close" onClick={closeProfileModal} aria-label="Close">
              ×
            </button>
          </div>
          <div className="profile-card">
            <div className="profile-photo">
              {profileStudent?.photo_url && (
                <img
                  src={profileStudent.photo_url}
                  alt="Student photo"
                  width={120}
                  height={120}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
            </div>
            <div className="profile-details">
              <div>
                <strong>
                  {profileStudent ? `${profileStudent.first_name} ${profileStudent.last_name || ''}` : ''}
                </strong>
              </div>
              <div>Class / Section: {profileStudent ? `${profileStudent.class || '—'} ${profileStudent.section || ''}` : ''}</div>
              <div>
                Gender:{' '}
                {profileStudent
                  ? profileStudent.gender === 'male'
                    ? 'Boy'
                    : profileStudent.gender === 'female'
                    ? 'Girl'
                    : '—'
                  : ''}
              </div>
              <div>Roll No: {profileStudent?.roll_no || '—'}</div>
              <div>Father: {profileStudent?.father_name || '—'}</div>
              <div>Contact: {profileStudent?.contact_1 || '—'}</div>
              <div>Email: {profileStudent?.email || '—'}</div>
              <div className="whitespace-pre-wrap mt-2">Address: {profileStudent?.address || '—'}</div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline" onClick={closeProfileModal}>
              Close
            </button>
          </div>
        </div>
      </div>

      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Students</h1>
          <div className="flex gap-2.5 items-center">
            {hasPerm('students.edit') && (
              <button className="btn btn-outline transition-transform duration-150 active:scale-95" onClick={openChangeSectionModal}>
                Change Section
              </button>
            )}
            {hasPerm('students.add') && (
              <button className="btn btn-primary transition-transform duration-150 active:scale-95" onClick={() => openModal()}>
                + Add Student
              </button>
            )}
          </div>
        </div>

        <>
        <div className="card mb-4">
          <div className="filters">
            <input
              className="search-box"
              type="text"
              placeholder="Search name, roll no…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <input
              className="search-box max-w-[220px]"
              type="text"
              placeholder="Filter by class"
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
            />
            <input
              className="search-box max-w-[160px]"
              type="text"
              placeholder="Filter by section"
              value={filterSection}
              onChange={(e) => setFilterSection(e.target.value)}
            />
            <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
              <input type="checkbox" checked={filterBoys} onChange={(e) => setFilterBoys(e.target.checked)} /> Boys
            </label>
            <label className="flex items-center gap-1 text-[13px] font-medium whitespace-nowrap">
              <input type="checkbox" checked={filterGirls} onChange={(e) => setFilterGirls(e.target.checked)} /> Girls
            </label>
            <span className="text-secondary text-sm font-semibold ml-auto">
              {filtered.length} student{filtered.length !== 1 ? 's' : ''}
            </span>
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
                  <th>Father</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Admitted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={12} className="loading">
                      Loading…
                    </td>
                  </tr>
                ) : loadFailed ? (
                  <tr>
                    <td colSpan={12} className="empty">
                      Failed to load students.
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="empty">
                      No students found.
                    </td>
                  </tr>
                ) : (
                  pagedStudents.map((s, i) => (
                    <tr key={s.student_id}>
                      <td>{(tablePage - 1) * PAGE_SIZE + i + 1}</td>
                      <td>
                        <Avatar src={s.photo_url} name={`${s.first_name} ${s.last_name || ''}`} />
                      </td>
                      <td>{s.roll_no}</td>
                      <td>
                        <strong>
                          {s.first_name} {s.last_name}
                        </strong>
                      </td>
                      <td>{s.class}</td>
                      <td>{s.section}</td>
                      <td>{s.gender === 'male' ? 'Boy' : s.gender === 'female' ? 'Girl' : '—'}</td>
                      <td>{s.father_name || '—'}</td>
                      <td>{s.contact_1 || '—'}</td>
                      <td>{s.email || '—'}</td>
                      <td className="text-muted text-xs">
                        {s.admission_date ? formatDate(s.admission_date) : '—'}
                      </td>
                      <td>
                        <button className="btn btn-outline btn-sm" onClick={() => viewStudent(s.student_id)}>
                          View
                        </button>
                        {hasPerm('students.edit') && (
                          <button className="btn btn-outline btn-sm" onClick={() => editStudent(s.student_id)}>
                            Edit
                          </button>
                        )}
                        {hasPerm('students.leave') && (
                          <button className="btn btn-warning btn-sm" onClick={() => leaveStudent(s.student_id)}>
                            Leave
                          </button>
                        )}
                        {hasPerm('students.delete') && (
                          <button className="btn btn-danger btn-sm" onClick={() => deleteStudent(s.student_id)}>
                            Delete
                          </button>
                        )}
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
        </>
      </div>
    </>
  );
}