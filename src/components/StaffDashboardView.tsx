import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BookOpen,
  CalendarCheck,
  ClipboardList,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  LogOut,
  QrCode,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react';
import {
  MAX_UPLOAD_PDF_BYTES,
  apiFetch,
  downloadPdfFile,
  readFileAsBase64,
  useAutoRefresh,
} from '../lib/api.ts';
import {
  ALL_SUBJECTS,
  type AttendanceStatus,
  type AuthUser,
  type ClassName,
  type MarkingSchemeItem,
  type QuestionPaperItem,
  type StudentRecord,
  computeScholasticGrade,
  getSubjectsForClassSection,
  normalizeStudentId,
  validateFullName,
} from '../shared/schoolRules.ts';
import { OfficialResultSheet, type OfficialResultSubjectRow } from './OfficialResultSheet.tsx';
import { StudentAttendanceLookup } from './StudentAttendanceLookup.tsx';
import { TeacherStudentQrRegistry } from './TeacherStudentQrRegistry.tsx';

interface StaffDashboardViewProps {
  user: AuthUser;
  academicSession?: string;
  onLogout: () => void;
}

interface StaffAttendanceRow {
  studentDbId: number;
  studentId: string;
  rollNumber: string;
  name: string;
  className: ClassName;
  section: string;
  status: AttendanceStatus | null;
  updatedAt?: string | null;
}

interface StaffMarksPayload {
  canEdit: boolean;
  isPublished: boolean;
  anyPublished?: boolean;
  subject: string;
  schemes: MarkingSchemeItem[];
  students: Array<{ id: number; studentId: string; rollNumber: string; name: string; boardNo: string | null }>;
  marks: Array<{ studentId: string; assessmentId: number; marksObtained: number }>;
}

interface StaffResultsStudent {
  studentId: string;
  rollNumber: string;
  boardNo: string | null;
  name: string;
  attendancePct?: number | null;
  attendanceDays?: string | null;
}

interface StaffResultsPayload {
  className: ClassName;
  section: string;
  academicSession?: string;
  isPublished: boolean;
  anyPublished?: boolean;
  publishedAt: string | null;
  subjects: string[];
  schemes: Array<{
    id: number;
    assessmentName: string;
    maxMarks: number;
    passingMarks: number;
    isPublished?: boolean;
    publishedAt?: string | null;
  }>;
  students: StaffResultsStudent[];
  marks: Array<{ studentId: string; subject: string; assessmentId: number; marksObtained: number }>;
}

export function StaffDashboardView({ user, academicSession, onLogout }: StaffDashboardViewProps) {
  const defaultTab = user.designation === 'Subject Teacher' ? 'marks' : 'register';
  const [tab, setTab] = useState<
    'register' | 'attendance' | 'marks' | 'student-attendance' | 'results' | 'student-qr' | 'papers'
  >(defaultTab);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const canEditRegistryAndAttendance =
    user.designation === 'Class Teacher' || user.designation === 'Both';
  const canEditMarks = user.designation === 'Subject Teacher' || user.designation === 'Both';
  const isSeniorBoard =
    user.assignedClass === 'X' || user.assignedClass === 'XI' || user.assignedClass === 'XII';

  // 1. Register state
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [stuSearch, setStuSearch] = useState('');
  const [stuName, setStuName] = useState('');
  const [stuRoll, setStuRoll] = useState('');
  const [stuId, setStuId] = useState('');
  const [stuBoardNo, setStuBoardNo] = useState('');
  const [editingStudentDbId, setEditingStudentDbId] = useState<number | null>(null);
  const [stuSaving, setStuSaving] = useState(false);

  // 2. Attendance state
  const [attDate, setAttDate] = useState(new Date().toISOString().slice(0, 10));
  const [attRows, setAttRows] = useState<StaffAttendanceRow[]>([]);
  const [attDraft, setAttDraft] = useState<Record<string, AttendanceStatus>>({});
  const [attDirty, setAttDirty] = useState(false);
  const [attSaving, setAttSaving] = useState(false);

  // 3. Examination Marks state
  const [selectedSubject, setSelectedSubject] = useState(user.assignedSubjects[0] || '');
  const [marksData, setMarksData] = useState<StaffMarksPayload | null>(null);
  const [marksDraft, setMarksDraft] = useState<Record<string, string>>({});
  const [marksDirty, setMarksDirty] = useState(false);
  const [marksSaving, setMarksSaving] = useState(false);

  // 5. Examination Results state
  const [resultsData, setResultsData] = useState<StaffResultsPayload | null>(null);
  const [resultsSubject, setResultsSubject] = useState('');
  const [resultsViewMode, setResultsViewMode] = useState<'subject' | 'consolidated'>('subject');
  const [previewStudent, setPreviewStudent] = useState<StaffResultsStudent | null>(null);

  // 6. Question Papers state
  const classPaperSubjects = user.assignedClass
    ? Array.from(
        new Set([
          ...user.assignedSubjects,
          ...getSubjectsForClassSection(user.assignedClass, user.assignedSection || 'A'),
          ...ALL_SUBJECTS,
        ])
      )
    : [...ALL_SUBJECTS];
  const paperSubjectOptions =
    user.designation === 'Subject Teacher' && user.assignedSubjects.length > 0
      ? user.assignedSubjects
      : classPaperSubjects;

  const [papers, setPapers] = useState<QuestionPaperItem[]>([]);
  const [paperTitle, setPaperTitle] = useState('');
  const [paperSubject, setPaperSubject] = useState(paperSubjectOptions[0] || ALL_SUBJECTS[0]);
  const [paperYear, setPaperYear] = useState(academicSession || '2026–2027');
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [paperUploading, setPaperUploading] = useState(false);
  const [paperDeletingId, setPaperDeletingId] = useState<number | null>(null);
  const paperFileRef = useRef<HTMLInputElement | null>(null);

  const subjectsKey = user.assignedSubjects.join('|');

  useEffect(() => {
    if (academicSession) {
      setPaperYear(academicSession);
    }
  }, [academicSession]);

  useEffect(() => {
    setTab(user.designation === 'Subject Teacher' ? 'marks' : 'register');
    setFeedback(null);
  }, [user.id, user.designation]);

  useEffect(() => {
    const subs = subjectsKey ? subjectsKey.split('|') : [];
    setSelectedSubject((prev) => (prev && subs.includes(prev) ? prev : subs[0] || ''));
    setPaperSubject((prev) => (prev && paperSubjectOptions.includes(prev) ? prev : subs[0] || ALL_SUBJECTS[0]));
  }, [subjectsKey]);

  const loadStudents = useCallback(async () => {
    const res = await apiFetch<{ students: StudentRecord[] }>('/api/staff/students');
    setStudents(res.students);
  }, []);

  const loadAttendance = useCallback(async (date: string) => {
    const res = await apiFetch<{ records: StaffAttendanceRow[] }>(
      `/api/staff/attendance?date=${encodeURIComponent(date)}`
    );
    setAttRows(res.records);
    const nextDraft: Record<string, AttendanceStatus> = {};
    for (const r of res.records) {
      nextDraft[r.studentId] = r.status || 'Present';
    }
    setAttDraft(nextDraft);
    setAttDirty(false);
  }, []);

  const loadMarks = useCallback(async (subject: string) => {
    if (!subject) {
      setMarksData(null);
      return;
    }
    const res = await apiFetch<StaffMarksPayload>(
      `/api/staff/marks?subject=${encodeURIComponent(subject)}`
    );
    setMarksData(res);
    const draft: Record<string, string> = {};
    for (const m of res.marks) {
      draft[`${m.studentId}::${m.assessmentId}`] = String(m.marksObtained);
    }
    setMarksDraft(draft);
    setMarksDirty(false);
  }, []);

  const loadResults = useCallback(async () => {
    const res = await apiFetch<StaffResultsPayload>('/api/staff/results');
    setResultsData(res);
    if (res.subjects.length > 0) {
      setResultsSubject((prev) => (prev && res.subjects.includes(prev) ? prev : res.subjects[0]));
    }
  }, []);

  const loadPapers = useCallback(async () => {
    if (!user.assignedClass || !user.assignedSection) return;
    const res = await apiFetch<{ papers: QuestionPaperItem[] }>(
      `/api/question-papers?className=${encodeURIComponent(user.assignedClass)}&section=${encodeURIComponent(user.assignedSection)}`
    );
    setPapers(res.papers);
  }, [user.assignedClass, user.assignedSection]);

  const syncCurrentTab = useCallback(
    async (silent = true) => {
      if (!silent) setRefreshing(true);
      try {
        if ((tab === 'register' || tab === 'student-qr') && (!silent || !editingStudentDbId)) {
          await loadStudents();
        } else if (tab === 'attendance' && (!silent || !attDirty)) {
          await loadAttendance(attDate);
        } else if (tab === 'marks' && (!silent || !marksDirty)) {
          await loadMarks(selectedSubject);
        } else if (tab === 'results') {
          await loadResults();
        } else if (tab === 'papers') {
          await loadPapers();
        }
      } catch (e) {
        if (!silent) setFeedback({ type: 'err', msg: (e as Error).message });
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [
      tab,
      attDate,
      selectedSubject,
      editingStudentDbId,
      attDirty,
      marksDirty,
      loadStudents,
      loadAttendance,
      loadMarks,
      loadResults,
      loadPapers,
    ]
  );

  useEffect(() => {
    setFeedback(null);
    if (tab === 'register' || tab === 'student-qr') {
      loadStudents().catch((e) => setFeedback({ type: 'err', msg: (e as Error).message }));
    } else if (tab === 'attendance') {
      loadAttendance(attDate).catch((e) => setFeedback({ type: 'err', msg: (e as Error).message }));
    } else if (tab === 'marks') {
      loadMarks(selectedSubject).catch((e) =>
        setFeedback({ type: 'err', msg: (e as Error).message })
      );
    } else if (tab === 'results') {
      loadResults().catch((e) => setFeedback({ type: 'err', msg: (e as Error).message }));
    } else if (tab === 'papers') {
      loadPapers().catch((e) => setFeedback({ type: 'err', msg: (e as Error).message }));
    }
  }, [
    tab,
    attDate,
    selectedSubject,
    user.assignedClass,
    user.assignedSection,
    loadStudents,
    loadAttendance,
    loadMarks,
    loadResults,
    loadPapers,
  ]);

  useAutoRefresh(() => syncCurrentTab(true), !previewStudent, 15000);

  // 1. Register Handlers
  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stuSaving) return;
    setFeedback(null);
    const nameErr = validateFullName(stuName, 'Student Name');
    if (nameErr) {
      setFeedback({ type: 'err', msg: nameErr });
      return;
    }
    setStuSaving(true);
    try {
      if (editingStudentDbId) {
        await apiFetch(`/api/staff/students/${editingStudentDbId}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: stuName.trim(),
            rollNumber: stuRoll.trim(),
            boardNo: stuBoardNo.trim() || null,
          }),
        });
        setFeedback({ type: 'ok', msg: 'Student record updated.' });
      } else {
        await apiFetch('/api/staff/students', {
          method: 'POST',
          body: JSON.stringify({
            name: stuName.trim(),
            rollNumber: stuRoll.trim(),
            studentId: normalizeStudentId(stuId),
            boardNo: normalizeStudentId(stuBoardNo) || null,
          }),
        });
        setFeedback({
          type: 'ok',
          msg: `Student registered in Class ${user.assignedClass}-${user.assignedSection}.`,
        });
      }
      setStuName('');
      setStuRoll('');
      setStuId('');
      setStuBoardNo('');
      setEditingStudentDbId(null);
      await loadStudents();
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setStuSaving(false);
    }
  };

  const handleDeleteStudent = async (id: number) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/staff/students/${id}`, { method: 'DELETE' });
      await loadStudents();
      setFeedback({ type: 'ok', msg: 'Student removed from class registry.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    }
  };

  // 2. Attendance Handler
  const handleBulkAttendance = (status: AttendanceStatus) => {
    const next: Record<string, AttendanceStatus> = {};
    for (const r of attRows) {
      next[r.studentId] = status;
    }
    setAttDraft(next);
    setAttDirty(true);
  };

  const handleSaveAttendance = async () => {
    setFeedback(null);
    setAttSaving(true);
    try {
      const entries = attRows.map((r) => ({
        studentId: r.studentId,
        status: attDraft[r.studentId] || 'Present',
      }));
      await apiFetch('/api/staff/attendance', {
        method: 'POST',
        body: JSON.stringify({ date: attDate, entries }),
      });
      await loadAttendance(attDate);
      setFeedback({ type: 'ok', msg: `Attendance saved for ${attDate}.` });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setAttSaving(false);
    }
  };

  // 3. Marks Validation & Save
  const invalidMarkKeys = new Set<string>();
  if (marksData) {
    for (const stu of marksData.students) {
      for (const sch of marksData.schemes) {
        const key = `${stu.studentId}::${sch.id}`;
        const raw = marksDraft[key];
        if (raw !== undefined && raw !== '') {
          const num = Number(raw);
          if (!Number.isFinite(num) || num < 0 || num > sch.maxMarks) {
            invalidMarkKeys.add(key);
          }
        }
      }
    }
  }

  const handleSaveMarks = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!marksData) return;

    if (invalidMarkKeys.size > 0) {
      setFeedback({
        type: 'err',
        msg: 'Marks entry denied: One or more scores exceed the Maximum Marks or are negative. Please correct highlighted cells before saving.',
      });
      return;
    }

    const entries: Array<{ studentId: string; assessmentId: number; marksObtained: number }> = [];
    for (const stu of marksData.students) {
      for (const sch of marksData.schemes) {
        const raw = marksDraft[`${stu.studentId}::${sch.id}`];
        if (raw !== undefined && raw.trim() !== '') {
          const val = Number(raw);
          if (val > sch.maxMarks || val < 0 || !Number.isFinite(val)) {
            setFeedback({
              type: 'err',
              msg: `Denied: Marks for ${stu.name} in ${sch.assessmentName} must be between 0 and ${sch.maxMarks}.`,
            });
            return;
          }
          entries.push({
            studentId: stu.studentId,
            assessmentId: sch.id,
            marksObtained: val,
          });
        }
      }
    }

    if (entries.length === 0) {
      setFeedback({ type: 'err', msg: 'Please enter at least one mark before saving.' });
      return;
    }

    setMarksSaving(true);
    try {
      await apiFetch('/api/staff/marks', {
        method: 'POST',
        body: JSON.stringify({ subject: selectedSubject, entries }),
      });
      await loadMarks(selectedSubject);
      setFeedback({
        type: 'ok',
        msg: `Examination marks saved for ${selectedSubject} (${user.assignedClass}-${user.assignedSection}).`,
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setMarksSaving(false);
    }
  };

  // 6. Paper Upload & Delete
  const handleSelectPaperFile = (file: File | null) => {
    if (!file) {
      setPaperFile(null);
      return;
    }
    if (file.size > MAX_UPLOAD_PDF_BYTES) {
      setFeedback({
        type: 'err',
        msg: 'Question paper PDF is too large (max 18 MB). Please choose a smaller PDF file.',
      });
      setPaperFile(null);
      if (paperFileRef.current) paperFileRef.current.value = '';
      return;
    }
    setPaperFile(file);
  };

  const handleUploadPaper = async (e: React.FormEvent) => {
    e.preventDefault();
    if (paperUploading) return;
    setFeedback(null);
    if (!paperFile) {
      setFeedback({ type: 'err', msg: 'Please attach a PDF file.' });
      return;
    }
    if (paperFile.size > MAX_UPLOAD_PDF_BYTES) {
      setFeedback({
        type: 'err',
        msg: 'Question paper PDF is too large (max 18 MB). Please choose a smaller PDF file.',
      });
      return;
    }
    setPaperUploading(true);
    try {
      const b64 = await readFileAsBase64(paperFile);
      const res = await apiFetch<{ paper: QuestionPaperItem }>('/api/academics/papers', {
        method: 'POST',
        body: JSON.stringify({
          title: paperTitle.trim(),
          className: user.assignedClass,
          section: user.assignedSection,
          subject: paperSubject || paperSubjectOptions[0] || 'GENERAL',
          academicYear: paperYear,
          fileName: paperFile.name,
          fileBase64: b64,
        }),
      });
      setPaperTitle('');
      setPaperFile(null);
      if (paperFileRef.current) paperFileRef.current.value = '';
      setPapers((prev) => [res.paper, ...prev.filter((p) => p.id !== res.paper.id)]);
      loadPapers().catch(() => {});
      setFeedback({ type: 'ok', msg: 'Question paper uploaded to Academics.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setPaperUploading(false);
    }
  };

  const handleDeletePaper = async (id: number) => {
    if (paperDeletingId === id) return;
    setFeedback(null);
    setPaperDeletingId(id);
    try {
      await apiFetch(`/api/academics/papers/${id}`, { method: 'DELETE' });
      await loadPapers();
      setFeedback({ type: 'ok', msg: 'Question paper removed from Academics.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setPaperDeletingId(null);
    }
  };

  const filteredStudents = students.filter((s) => {
    const q = stuSearch.trim().toLowerCase();
    const qNoSpace = normalizeStudentId(q);
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.rollNumber.toLowerCase().includes(q) ||
      s.studentId.toLowerCase().includes(q) ||
      normalizeStudentId(s.studentId).toLowerCase().includes(qNoSpace) ||
      (s.boardNo || '').toLowerCase().includes(q)
    );
  });

  const attSummary = attRows.reduce(
    (acc, r) => {
      const val = attDraft[r.studentId] || 'Present';
      if (val === 'Present') acc.present += 1;
      else if (val === 'Absent') acc.absent += 1;
      else acc.leave += 1;
      if (r.status !== null) acc.savedCount += 1;
      return acc;
    },
    { present: 0, absent: 0, leave: 0, savedCount: 0 }
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Staff Profile Banner */}
      <div className="bg-white border border-slate-200 border-t-4 border-t-[#082D59] rounded-md p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-mono text-[#8B1E24] font-semibold">
            Staff Dashboard · {user.designation} · Class {user.assignedClass}-{user.assignedSection}{' '}
            · Emp ID: {user.employeeId}
          </p>
          <h1 className="font-display text-2xl font-semibold text-[#082D59] mt-0.5">
            {user.name}
          </h1>
          {user.assignedSubjects.length > 0 && (
            <p className="text-xs text-slate-600 mt-1">
              Assigned Subjects: <strong>{user.assignedSubjects.join(', ')}</strong>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <button
            type="button"
            disabled={refreshing}
            onClick={() => syncCurrentTab(false)}
            className="px-3 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Data
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>

      {/* 5 Required Options + Question Paper Upload */}
      <div className="no-print flex flex-wrap items-center gap-1 p-1 bg-[#E4ECF5] rounded-lg w-fit">
        {(
          [
            { id: 'register', label: '1. Register', icon: UserPlus },
            { id: 'attendance', label: '2. Attendance', icon: CalendarCheck },
            { id: 'marks', label: '3. Examination Marks', icon: FileSpreadsheet },
            { id: 'student-attendance', label: '4. Student Attendance Dashboard', icon: Search },
            { id: 'results', label: '5. Examination Results', icon: Award },
            { id: 'student-qr', label: '6. Student Info & QR', icon: QrCode },
            { id: 'papers', label: 'Question Papers', icon: BookOpen },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id);
                setFeedback(null);
              }}
              className={`px-3.5 py-2 text-xs font-semibold rounded-md inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                tab === item.id
                  ? 'bg-[#0B3C75] text-white shadow-sm'
                  : 'text-[#0B3C75] hover:bg-white/60'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-lg border text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* 1. REGISTER */}
      {tab === 'register' && (
        <div className="space-y-6">
          {!canEditRegistryAndAttendance && (
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-start gap-3 text-sm text-amber-900">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" />
              <div>
                <p className="font-semibold">Student Roster (View-Only for Subject Teacher)</p>
                <p className="text-xs text-amber-800 mt-0.5">
                  Your designation is <strong>Subject Teacher</strong>. You can view and search the
                  student roster below to check Roll Numbers and Student IDs, while Class Teachers
                  or Dual-Role (Both) teachers manage additions, edits, and removals.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {canEditRegistryAndAttendance && (
              <form
                onSubmit={handleSaveStudent}
                className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-semibold text-slate-900">
                    {editingStudentDbId ? 'Edit Student' : 'Register Student'}
                  </h2>
                  {editingStudentDbId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingStudentDbId(null);
                        setStuName('');
                        setStuRoll('');
                        setStuId('');
                        setStuBoardNo('');
                      }}
                      className="text-xs text-slate-600 hover:underline cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                </div>

                <p className="text-xs text-slate-500">
                  Automatically assigned to{' '}
                  <strong>
                    Class {user.assignedClass} — Section {user.assignedSection}
                  </strong>
                </p>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Student Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={stuName}
                    onChange={(e) => setStuName(e.target.value)}
                    placeholder="Full Name"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Roll Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={stuRoll}
                    onChange={(e) => setStuRoll(e.target.value)}
                    placeholder="e.g. 01"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>

                {!editingStudentDbId && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Student ID *
                    </label>
                    <input
                      type="text"
                      required
                      value={stuId}
                      onChange={(e) => setStuId(normalizeStudentId(e.target.value))}
                      placeholder="e.g. STU2026001 or 1234"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Spaces are automatically removed (e.g. <span className="font-mono">12 3 4</span> becomes <span className="font-mono font-semibold">1234</span>).
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Board No. {isSeniorBoard ? '(Required for X–XII results)' : '(Optional)'}
                  </label>
                  <input
                    type="text"
                    required={isSeniorBoard}
                    value={stuBoardNo}
                    onChange={(e) => setStuBoardNo(e.target.value)}
                    placeholder="Board Roll / Reg No."
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={stuSaving}
                  className="w-full px-4 py-2.5 bg-[#0B3C75] text-white text-sm font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer disabled:opacity-60"
                >
                  {stuSaving
                    ? editingStudentDbId
                      ? 'Updating...'
                      : 'Registering...'
                    : editingStudentDbId
                      ? 'Update Student'
                      : 'Register Student'}
                </button>
              </form>
            )}

            <div
              className={`${
                canEditRegistryAndAttendance ? 'lg:col-span-8' : 'lg:col-span-12'
              } bg-white border border-slate-200 rounded-xl overflow-hidden`}
            >
              <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Enrolled Students — Class {user.assignedClass}-{user.assignedSection}
                  </h3>
                  <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                    Showing {filteredStudents.length} of {students.length} students
                  </p>
                </div>
                <input
                  type="text"
                  value={stuSearch}
                  onChange={(e) => setStuSearch(e.target.value)}
                  placeholder="Search Roll No, Student ID, or Name..."
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75] w-full sm:w-60"
                />
              </div>
              {students.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No students registered in Class {user.assignedClass}-{user.assignedSection} yet.
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No students match &ldquo;{stuSearch}&rdquo;.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#EEF3F9] border-b border-slate-200 text-xs font-semibold text-[#0B3C75]">
                        <th className="py-2.5 px-4">Roll No.</th>
                        <th className="py-2.5 px-4">Student ID</th>
                        <th className="py-2.5 px-4">Student Name</th>
                        <th className="py-2.5 px-4">Board No.</th>
                        {canEditRegistryAndAttendance && (
                          <th className="py-2.5 px-4 text-right">Actions</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 tabular-nums">
                      {filteredStudents.map((s) => (
                        <tr key={s.id}>
                          <td className="py-2.5 px-4 font-mono font-semibold">{s.rollNumber}</td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-600">
                            {s.studentId}
                          </td>
                          <td className="py-2.5 px-4 font-medium text-slate-900">{s.name}</td>
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-600">
                            {s.boardNo || '—'}
                          </td>
                          {canEditRegistryAndAttendance && (
                            <td className="py-2.5 px-4 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingStudentDbId(s.id);
                                    setStuName(s.name);
                                    setStuRoll(s.rollNumber);
                                    setStuId(s.studentId);
                                    setStuBoardNo(s.boardNo || '');
                                  }}
                                  className="p-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
                                  title="Edit Student"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteStudent(s.id)}
                                  className="p-1.5 border border-red-200 rounded text-red-700 hover:bg-red-50 cursor-pointer"
                                  title="Remove Student"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. ATTENDANCE */}
      {tab === 'attendance' && (
        <div className="space-y-4">
          {!canEditRegistryAndAttendance && (
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-start gap-3 text-sm text-amber-900">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" />
              <div>
                <p className="font-semibold">Attendance Marking Restricted</p>
                <p className="text-xs text-amber-800 mt-0.5">
                  Subject Teachers cannot mark or modify daily attendance. Only Class Teachers or
                  Dual-Role (Both) teachers can record attendance.
                </p>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Attendance Date
                  </label>
                  <input
                    type="date"
                    value={attDate}
                    onChange={(e) => setAttDate(e.target.value)}
                    className="px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>
                <div className="text-xs text-slate-600 pt-4">
                  Class {user.assignedClass}-{user.assignedSection}
                  {attRows.length > 0 && (
                    <span
                      className={`ml-2 font-semibold ${
                        attSummary.savedCount > 0 ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      ·{' '}
                      {attSummary.savedCount > 0
                        ? `Saved (${attSummary.savedCount}/${attRows.length})`
                        : 'Not Yet Marked'}
                    </span>
                  )}
                </div>
              </div>

              {canEditRegistryAndAttendance && attRows.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleBulkAttendance('Present')}
                    className="px-3 py-2 text-xs font-semibold border border-emerald-300 text-emerald-800 bg-emerald-50 rounded-lg hover:bg-emerald-100 cursor-pointer"
                  >
                    Mark All Present
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkAttendance('Absent')}
                    className="px-3 py-2 text-xs font-semibold border border-red-200 text-red-800 bg-red-50 rounded-lg hover:bg-red-100 cursor-pointer"
                  >
                    Mark All Absent
                  </button>
                  <button
                    type="button"
                    disabled={attSaving}
                    onClick={handleSaveAttendance}
                    className="px-5 py-2.5 bg-[#0B3C75] text-white text-sm font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer disabled:opacity-60"
                  >
                    {attSaving ? 'Saving...' : 'Save Date-wise Attendance'}
                  </button>
                </div>
              )}
            </div>

            {attRows.length > 0 && (
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-5 text-xs font-mono tabular-nums">
                <span className="text-emerald-700 font-semibold">
                  Present: {attSummary.present}
                </span>
                <span className="text-red-700 font-semibold">Absent: {attSummary.absent}</span>
                <span className="text-amber-700 font-semibold">Leave: {attSummary.leave}</span>
                <span className="text-slate-600">Total Students: {attRows.length}</span>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {attRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No students enrolled in Class {user.assignedClass}-{user.assignedSection}. Register
                students first.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#EEF3F9] border-b border-slate-200 text-xs font-semibold text-[#0B3C75]">
                      <th className="py-3 px-4">Roll No.</th>
                      <th className="py-3 px-4">Student ID</th>
                      <th className="py-3 px-4">Student Name</th>
                      <th className="py-3 px-4 text-right">Attendance ({attDate})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {attRows.map((r) => {
                      const current = attDraft[r.studentId] || 'Present';
                      return (
                        <tr key={r.studentId}>
                          <td className="py-3 px-4 font-mono font-semibold tabular-nums">
                            {r.rollNumber}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-600">
                            {r.studentId}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-900">{r.name}</td>
                          <td className="py-3 px-4 text-right">
                            {canEditRegistryAndAttendance ? (
                              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 gap-1">
                                {(['Present', 'Absent', 'Leave'] as const).map((status) => (
                                  <button
                                    key={status}
                                    type="button"
                                    onClick={() => {
                                      setAttDraft((prev) => ({
                                        ...prev,
                                        [r.studentId]: status,
                                      }));
                                      setAttDirty(true);
                                    }}
                                    className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                                      current === status
                                        ? status === 'Present'
                                          ? 'bg-emerald-700 text-white'
                                          : status === 'Absent'
                                            ? 'bg-red-700 text-white'
                                            : 'bg-amber-600 text-white'
                                        : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                  >
                                    {status}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs font-semibold text-slate-600">
                                {r.status || 'Not Marked'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. EXAMINATION MARKS */}
      {tab === 'marks' && (
        <div className="space-y-6">
          {!canEditMarks ? (
            <div className="p-6 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-900">
              <p className="font-semibold">Examination Marks Entry Restricted</p>
              <p className="text-xs text-amber-800 mt-1">
                Your designation is <strong>Class Teacher</strong>. Marks entry is restricted to
                Subject Teachers or Dual-Role (Both) teachers assigned to subjects by the
                Administrator. To view all subject marks entered for Class {user.assignedClass}-
                {user.assignedSection}, open <strong>5. Examination Results</strong>.
              </p>
            </div>
          ) : user.assignedSubjects.length === 0 ? (
            <div className="p-6 rounded-xl border border-slate-200 bg-white text-sm text-slate-600">
              No subjects have been assigned to you by the Administrator.
            </div>
          ) : (
            <form onSubmit={handleSaveMarks} className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Assigned Subject
                    </label>
                    <select
                      value={selectedSubject}
                      onChange={(e) => setSelectedSubject(e.target.value)}
                      className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    >
                      {user.assignedSubjects.map((sub) => (
                        <option key={sub} value={sub}>
                          {sub}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-xs text-slate-600 pt-4">
                    Class {user.assignedClass}-{user.assignedSection}
                    {marksData && (
                      <span className="ml-2 font-semibold text-slate-800">
                        ·{' '}
                        {marksData.isPublished
                          ? 'Published to Students (All Assessments)'
                          : marksData.anyPublished
                            ? 'Partially Published · All marks visible to Teachers'
                            : 'Pending Publication · All marks remain visible to Teachers'}
                      </span>
                    )}
                    {invalidMarkKeys.size > 0 && (
                      <span className="ml-2 font-semibold text-red-700">
                        · {invalidMarkKeys.size} invalid score(s)
                      </span>
                    )}
                  </div>
                </div>

                {marksData && marksData.schemes.length > 0 && marksData.students.length > 0 && (
                  <button
                    type="submit"
                    disabled={marksSaving || invalidMarkKeys.size > 0}
                    className="px-5 py-2.5 bg-[#0B3C75] text-white text-sm font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer disabled:opacity-50"
                  >
                    {marksSaving ? 'Saving Marks...' : 'Save Examination Marks'}
                  </button>
                )}
              </div>

              {!marksData || marksData.schemes.length === 0 ? (
                <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-sm text-slate-500">
                  <ClipboardList className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  Administrator has not configured a Marking Scheme (Assessments &amp; Maximum
                  Marks) for Class {user.assignedClass} yet.
                </div>
              ) : marksData.students.length === 0 ? (
                <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-sm text-slate-500">
                  No students are registered in Class {user.assignedClass}-{user.assignedSection}{' '}
                  yet.
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#EEF3F9] border-b border-slate-200 text-xs font-semibold text-[#0B3C75]">
                        <th className="py-3 px-4">Roll No.</th>
                        <th className="py-3 px-4">Student ID</th>
                        <th className="py-3 px-4">Student Name</th>
                        {marksData.schemes.map((sch) => (
                          <th key={sch.id} className="py-3 px-4 whitespace-nowrap">
                            {sch.assessmentName}
                            <span className="block text-[11px] font-mono font-normal text-slate-500">
                              Max: {sch.maxMarks} · Pass: {sch.passingMarks} ·{' '}
                              <span
                                className={
                                  sch.isPublished ? 'text-emerald-700 font-semibold' : 'text-amber-700'
                                }
                              >
                                {sch.isPublished ? 'Published' : 'Teacher Only'}
                              </span>
                            </span>
                          </th>
                        ))}
                        <th className="py-3 px-4 text-right whitespace-nowrap">Total</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 tabular-nums">
                      {marksData.students.map((stu) => {
                        let rowTotal = 0;
                        let rowMax = 0;
                        let rowPassTotal = 0;
                        let hasAny = false;
                        let allAssessmentsPassed = true;
                        let hasInvalid = false;

                        for (const sch of marksData.schemes) {
                          rowMax += sch.maxMarks;
                          rowPassTotal += sch.passingMarks;
                          const k = `${stu.studentId}::${sch.id}`;
                          if (invalidMarkKeys.has(k)) hasInvalid = true;
                          const raw = marksDraft[k];
                          if (raw !== undefined && raw.trim() !== '') {
                            const val = Number(raw);
                            if (Number.isFinite(val)) {
                              hasAny = true;
                              rowTotal += val;
                              if (val < sch.passingMarks) {
                                allAssessmentsPassed = false;
                              }
                            }
                          }
                        }

                        const rowPassed =
                          hasAny &&
                          !hasInvalid &&
                          allAssessmentsPassed &&
                          rowTotal >= rowPassTotal;

                        return (
                          <tr key={stu.studentId}>
                            <td className="py-3 px-4 font-mono font-semibold">{stu.rollNumber}</td>
                            <td className="py-3 px-4 font-mono text-xs text-slate-600">
                              {stu.studentId}
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-900">{stu.name}</td>
                            {marksData.schemes.map((sch) => {
                              const key = `${stu.studentId}::${sch.id}`;
                              const val = marksDraft[key] ?? '';
                              const isInvalid = invalidMarkKeys.has(key);
                              return (
                                <td key={sch.id} className="py-3 px-4">
                                  <input
                                    type="number"
                                    min={0}
                                    max={sch.maxMarks}
                                    step="0.5"
                                    value={val}
                                    onChange={(e) => {
                                      setMarksDraft((prev) => ({
                                        ...prev,
                                        [key]: e.target.value,
                                      }));
                                      setMarksDirty(true);
                                    }}
                                    placeholder={`0–${sch.maxMarks}`}
                                    className={`w-28 px-2.5 py-1.5 text-sm font-mono rounded-lg border focus:outline-none ${
                                      isInvalid
                                        ? 'border-red-500 bg-red-50 text-red-900 focus:ring-2 focus:ring-red-500'
                                        : 'border-slate-300 focus:ring-2 focus:ring-[#0B3C75]'
                                    }`}
                                  />
                                  {isInvalid && (
                                    <p className="text-[11px] font-semibold text-red-700 mt-1">
                                      Denied: 0–{sch.maxMarks}
                                    </p>
                                  )}
                                </td>
                              );
                            })}
                            <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                              {hasAny ? `${Number(rowTotal.toFixed(2))} / ${rowMax}` : '—'}
                            </td>
                            <td className="py-3 px-4 text-right text-xs font-semibold whitespace-nowrap">
                              {!hasAny ? (
                                <span className="text-slate-400">Pending</span>
                              ) : hasInvalid ? (
                                <span className="text-red-700">Invalid</span>
                              ) : rowPassed ? (
                                <span className="text-emerald-700">Pass</span>
                              ) : (
                                <span className="text-[#7C1D24]">Needs Improvement</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </form>
          )}
        </div>
      )}

      {/* 4. STUDENT ATTENDANCE DASHBOARD */}
      {tab === 'student-attendance' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="font-display text-xl font-semibold text-slate-900">
              Student Attendance Dashboard
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Integrated student attendance lookup connected directly to the shared attendance
              database.
            </p>
          </div>
          <StudentAttendanceLookup
            defaultClass={user.assignedClass || 'IV'}
            defaultSection={user.assignedSection || 'A'}
          />
        </div>
      )}

      {/* 5. EXAMINATION RESULTS */}
      {tab === 'results' && (
        <div className="space-y-4">
          {resultsData && (
            <>
              <div className="no-print bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl font-semibold text-slate-900">
                    Examination Results — Class {resultsData.className}-{resultsData.section}
                  </h2>
                  <p className="text-xs mt-1">
                    Student Publication Status:{' '}
                    <strong
                      className={
                        resultsData.isPublished || resultsData.anyPublished
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                      }
                    >
                      {resultsData.isPublished
                        ? 'Whole Class Published to Students'
                        : resultsData.anyPublished
                          ? `Partial (${resultsData.schemes.filter((s) => s.isPublished).length}/${resultsData.schemes.length} Assessments Published) · All Marks Visible to Teachers`
                          : 'Not Published Yet · All Marks Visible to Teachers Before Publication'}
                    </strong>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {resultsData.subjects.length > 1 && (
                    <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-[#E4ECF5]">
                      <button
                        type="button"
                        onClick={() => setResultsViewMode('subject')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                          resultsViewMode === 'subject'
                            ? 'bg-[#0B3C75] text-white'
                            : 'text-[#0B3C75]'
                        }`}
                      >
                        By Subject
                      </button>
                      <button
                        type="button"
                        onClick={() => setResultsViewMode('consolidated')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                          resultsViewMode === 'consolidated'
                            ? 'bg-[#0B3C75] text-white'
                            : 'text-[#0B3C75]'
                        }`}
                      >
                        All Subjects Sheet
                      </button>
                    </div>
                  )}

                  {resultsViewMode === 'subject' && resultsData.subjects.length > 0 && (
                    <select
                      value={resultsSubject}
                      onChange={(e) => setResultsSubject(e.target.value)}
                      className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      {resultsData.subjects.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {resultsData.students.length === 0 || resultsData.schemes.length === 0 ? (
                <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-sm text-slate-500">
                  No students or marking scheme assessments found for this class yet.
                </div>
              ) : resultsViewMode === 'consolidated' ? (
                <div className="no-print bg-white border border-slate-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#EEF3F9] border-b border-slate-200 text-xs font-semibold text-[#0B3C75]">
                        <th className="py-3 px-4">Roll No.</th>
                        <th className="py-3 px-4">Student Name</th>
                        {resultsData.subjects.map((sub) => (
                          <th key={sub} className="py-3 px-3 text-right whitespace-nowrap">
                            {sub}
                          </th>
                        ))}
                        <th className="py-3 px-4 text-right whitespace-nowrap">Grand Total</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">%</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">Official Report Card</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 tabular-nums">
                      {resultsData.students.map((stu) => {
                        const perSubMax = resultsData.schemes.reduce((a, b) => a + b.maxMarks, 0);
                        let grandObt = 0;
                        let grandMaxEntered = 0;
                        return (
                          <tr key={stu.studentId}>
                            <td className="py-3 px-4 font-mono font-semibold">{stu.rollNumber}</td>
                            <td className="py-3 px-4 font-medium text-slate-900">{stu.name}</td>
                            {resultsData.subjects.map((sub) => {
                              const subMarks = resultsData.marks.filter(
                                (m) => m.studentId === stu.studentId && m.subject === sub
                              );
                              if (subMarks.length === 0) {
                                return (
                                  <td key={sub} className="py-3 px-3 text-right font-mono text-slate-400">
                                    —
                                  </td>
                                );
                              }
                              const subTotal = subMarks.reduce((a, b) => a + b.marksObtained, 0);
                              grandObt += subTotal;
                              grandMaxEntered += perSubMax;
                              return (
                                <td key={sub} className="py-3 px-3 text-right font-mono">
                                  {Number(subTotal.toFixed(2))}
                                </td>
                              );
                            })}
                            <td className="py-3 px-4 text-right font-mono font-semibold">
                              {grandMaxEntered > 0
                                ? `${Number(grandObt.toFixed(2))} / ${grandMaxEntered}`
                                : '—'}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-semibold text-[#0B3C75]">
                              {grandMaxEntered > 0
                                ? `${((grandObt / grandMaxEntered) * 100).toFixed(1)}%`
                                : '—'}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={() => setPreviewStudent(stu)}
                                className="px-2.5 py-1 border border-[#0B3C75]/40 text-[#0B3C75] text-xs font-semibold rounded-md hover:bg-[#EEF3F9] inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                View Card
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="no-print bg-white border border-slate-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#EEF3F9] border-b border-slate-200 text-xs font-semibold text-[#0B3C75]">
                        <th className="py-3 px-4">Roll No.</th>
                        <th className="py-3 px-4">Student ID</th>
                        <th className="py-3 px-4">Student Name</th>
                        {resultsData.schemes.map((sch) => (
                          <th key={sch.id} className="py-3 px-4 text-right whitespace-nowrap">
                            {sch.assessmentName} (/{sch.maxMarks})
                            <span className="block text-[10px] font-normal text-slate-500">
                              {sch.isPublished ? 'Published' : 'Teacher Only'}
                            </span>
                          </th>
                        ))}
                        <th className="py-3 px-4 text-right">Total</th>
                        <th className="py-3 px-4 text-right">%</th>
                        <th className="py-3 px-4 text-right">Status</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">Official Report Card</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 tabular-nums">
                      {resultsData.students.map((stu) => {
                        let total = 0;
                        let maxTotal = 0;
                        let passTotal = 0;
                        let hasAny = false;
                        let allAssessmentsPassed = true;
                        const cells = resultsData.schemes.map((sch) => {
                          maxTotal += sch.maxMarks;
                          passTotal += sch.passingMarks;
                          const mark = resultsData.marks.find(
                            (m) =>
                              m.studentId === stu.studentId &&
                              m.subject === resultsSubject &&
                              m.assessmentId === sch.id
                          );
                          if (mark !== undefined) {
                            hasAny = true;
                            total += mark.marksObtained;
                            if (mark.marksObtained < sch.passingMarks) {
                              allAssessmentsPassed = false;
                            }
                          }
                          return (
                            <td key={sch.id} className="py-3 px-4 text-right font-mono">
                              {mark !== undefined ? mark.marksObtained : '—'}
                            </td>
                          );
                        });
                        const passed = hasAny && allAssessmentsPassed && total >= passTotal;
                        const pct = hasAny && maxTotal > 0 ? ((total / maxTotal) * 100).toFixed(1) : null;
                        return (
                          <tr key={stu.studentId}>
                            <td className="py-3 px-4 font-mono font-semibold">{stu.rollNumber}</td>
                            <td className="py-3 px-4 font-mono text-xs text-slate-600">
                              {stu.studentId}
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-900">{stu.name}</td>
                            {cells}
                            <td className="py-3 px-4 text-right font-mono font-semibold">
                              {hasAny ? `${Number(total.toFixed(2))} / ${maxTotal}` : '—'}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-slate-700">
                              {pct !== null ? `${pct}%` : '—'}
                            </td>
                            <td className="py-3 px-4 text-right text-xs font-semibold">
                              {!hasAny ? (
                                <span className="text-slate-400">Not Entered</span>
                              ) : passed ? (
                                <span className="text-emerald-700">Pass</span>
                              ) : (
                                <span className="text-[#7C1D24]">Needs Improvement</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={() => setPreviewStudent(stu)}
                                className="px-2.5 py-1 border border-[#0B3C75]/40 text-[#0B3C75] text-xs font-semibold rounded-md hover:bg-[#EEF3F9] inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                View Card
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Teacher Official Report Card Preview Modal */}
              {previewStudent && (() => {
                const subjectRows: OfficialResultSubjectRow[] = resultsData.subjects.map((sub) => {
                  let totalObt = 0;
                  let totalMax = 0;
                  let totalPass = 0;
                  let hasAny = false;
                  let allAssessPassed = true;
                  const assessments = resultsData.schemes.map((sch) => {
                    totalMax += sch.maxMarks;
                    totalPass += sch.passingMarks;
                    const found = resultsData.marks.find(
                      (m) =>
                        m.studentId === previewStudent.studentId &&
                        m.subject === sub &&
                        m.assessmentId === sch.id
                    );
                    if (found !== undefined) {
                      hasAny = true;
                      totalObt += found.marksObtained;
                      if (found.marksObtained < sch.passingMarks) allAssessPassed = false;
                    }
                    return {
                      assessmentId: sch.id,
                      assessmentName: sch.assessmentName,
                      maxMarks: sch.maxMarks,
                      passingMarks: sch.passingMarks,
                      marksObtained: found ? found.marksObtained : null,
                      passed: found ? found.marksObtained >= sch.passingMarks : null,
                    };
                  });
                  const pct =
                    hasAny && totalMax > 0 ? Number(((totalObt / totalMax) * 100).toFixed(2)) : null;
                  const g = pct !== null ? computeScholasticGrade(pct) : null;
                  const subPassed = hasAny && totalObt >= totalPass && allAssessPassed;
                  return {
                    subject: sub,
                    assessments,
                    totalObtained: hasAny ? Number(totalObt.toFixed(2)) : null,
                    totalMax,
                    totalPassing: totalPass,
                    percentage: pct,
                    grade: g?.grade ?? null,
                    gradePoint: g?.gradePoint ?? null,
                    remark: g?.remark ?? null,
                    status: !hasAny ? 'Not Entered' : subPassed ? 'Pass' : 'Needs Improvement',
                  };
                });

                const entered = subjectRows.filter((r) => r.totalObtained !== null);
                const failed = entered.filter((r) => r.status === 'Needs Improvement');
                const grandObtained = Number(
                  entered.reduce((acc, r) => acc + (r.totalObtained ?? 0), 0).toFixed(2)
                );
                const grandMax = entered.reduce((acc, r) => acc + r.totalMax, 0);
                const percentage =
                  grandMax > 0 ? Number(((grandObtained / grandMax) * 100).toFixed(2)) : 0;
                const overallG = entered.length > 0 ? computeScholasticGrade(percentage) : null;
                let overallStatus = 'RESULT AWAITED';
                if (entered.length > 0) {
                  if (failed.length === 0) {
                    overallStatus = resultsData.isPublished
                      ? 'PASS / PROMOTED'
                      : 'QUALIFIED (PREVIEW)';
                  } else if (failed.length <= 2) {
                    overallStatus = 'COMPARTMENT';
                  } else {
                    overallStatus = 'ESSENTIAL REPEAT';
                  }
                }

                const [presStr, totStr] = (previewStudent.attendanceDays || '0/0').split('/');
                const attObj =
                  Number(totStr) > 0
                    ? {
                        total: Number(totStr),
                        present: Number(presStr),
                        absent: 0,
                        leave: 0,
                        percentage: previewStudent.attendancePct ?? null,
                      }
                    : null;

                return (
                  <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-start justify-center p-4 overflow-y-auto">
                    <div className="max-w-5xl w-full my-6">
                      <OfficialResultSheet
                        academicSession={resultsData.academicSession || academicSession || '2026–2027'}
                        publicationScope={
                          resultsData.isPublished
                            ? 'full'
                            : resultsData.anyPublished
                              ? 'partial'
                              : 'unpublished'
                        }
                        publishedAt={resultsData.publishedAt}
                        isPreview={true}
                        onClose={() => setPreviewStudent(null)}
                        student={{
                          studentId: previewStudent.studentId,
                          rollNumber: previewStudent.rollNumber,
                          boardNo: previewStudent.boardNo,
                          name: previewStudent.name,
                          className: resultsData.className,
                          section: resultsData.section,
                        }}
                        attendance={attObj}
                        schemes={resultsData.schemes}
                        subjectResults={subjectRows}
                        summary={{
                          grandObtained,
                          grandMax,
                          percentage,
                          overallGrade: overallG?.grade ?? '—',
                          overallGradePoint: overallG?.gradePoint ?? '—',
                          overallRemark: overallG?.remark ?? 'Pending',
                          overallStatus,
                          compartmentSubjects: failed.map((f) => f.subject),
                        }}
                      />
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* 6. STUDENT INFORMATION & QR REGISTRY */}
      {tab === 'student-qr' && (
        <TeacherStudentQrRegistry
          students={students}
          assignedClass={user.assignedClass}
          assignedSection={user.assignedSection}
          onRefreshStudents={loadStudents}
        />
      )}

      {/* QUESTION PAPERS UPLOAD */}
      {tab === 'papers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleUploadPaper}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h2 className="font-display text-xl font-semibold text-slate-900">
              Upload Question Paper ({user.assignedClass}-{user.assignedSection})
            </h2>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Title *</label>
              <input
                type="text"
                required
                value={paperTitle}
                onChange={(e) => setPaperTitle(e.target.value)}
                placeholder="e.g. Unit Test 1 Question Paper"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Subject</label>
              <select
                value={paperSubject}
                onChange={(e) => setPaperSubject(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              >
                {paperSubjectOptions.map((sub) => (
                  <option key={sub} value={sub}>
                    {sub}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Academic Session
              </label>
              <input
                type="text"
                required
                value={paperYear}
                onChange={(e) => setPaperYear(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                PDF File * <span className="font-normal text-slate-500">(Max 18 MB)</span>
              </label>
              <input
                ref={paperFileRef}
                type="file"
                accept=".pdf,application/pdf"
                required
                onChange={(e) => handleSelectPaperFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50"
              />
            </div>
            <button
              type="submit"
              disabled={paperUploading}
              className="w-full px-4 py-2.5 bg-[#0B3C75] text-white text-sm font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer disabled:opacity-60"
            >
              {paperUploading ? 'Uploading Paper...' : 'Upload to Academics'}
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Papers for Class {user.assignedClass}-{user.assignedSection}
              </h3>
              <span className="text-xs text-slate-500 tabular-nums">{papers.length} files</span>
            </div>
            {papers.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No papers uploaded for this class and section yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {papers.map((p) => (
                  <div key={p.id} className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-mono text-[#0B3C75]">
                        {p.subject} · {p.academicYear}
                      </p>
                      <p className="text-sm font-semibold text-slate-900 truncate">{p.title}</p>
                      <p className="text-xs text-slate-500 truncate">{p.originalFilename}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          downloadPdfFile(
                            `/api/question-papers/${p.id}/download`,
                            p.originalFilename || `${p.title}.pdf`
                          )
                        }
                        className="p-2 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                        title="Download PDF"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={paperDeletingId === p.id}
                        onClick={() => handleDeletePaper(p.id)}
                        className="p-2 text-red-700 border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer disabled:opacity-50"
                        title="Delete Paper"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
