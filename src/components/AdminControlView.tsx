import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  FileText,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
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
  CLASSES,
  type AuthUser,
  type CircularItem,
  type ClassName,
  type MarkingSchemeItem,
  type QuestionPaperItem,
  type StaffDesignation,
  getSectionsForClass,
  getSubjectsForClassSection,
  validateFullName,
} from '../shared/schoolRules.ts';

interface AdminControlViewProps {
  user: AuthUser;
  academicSession?: string;
  onSessionUpdated?: (session: string) => void;
  onLogout: () => void;
}

interface PublicationItem {
  className: ClassName;
  isPublished: boolean;
  publishedAt: string | null;
}

interface CreatedCredentialsInfo {
  name: string;
  roleLabel: string;
  userId: string;
  classInfo?: string;
}

export function AdminControlView({
  user,
  academicSession = '2026–2027',
  onSessionUpdated,
  onLogout,
}: AdminControlViewProps) {
  const [tab, setTab] = useState<'circulars' | 'results' | 'staff' | 'papers'>('circulars');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sessionDraft, setSessionDraft] = useState(academicSession);
  const [sessionSaving, setSessionSaving] = useState(false);

  // Circulars state
  const [circulars, setCirculars] = useState<CircularItem[]>([]);
  const [circNumber, setCircNumber] = useState('');
  const [circTitle, setCircTitle] = useState('');
  const [circFile, setCircFile] = useState<File | null>(null);
  const [circSubmitting, setCircSubmitting] = useState(false);
  const circFileRef = useRef<HTMLInputElement | null>(null);

  // Marking Schemes & Result Publication state
  const [schemeClass, setSchemeClass] = useState<ClassName>('IV');
  const [schemes, setSchemes] = useState<MarkingSchemeItem[]>([]);
  const [publications, setPublications] = useState<PublicationItem[]>([]);
  const [assessName, setAssessName] = useState('');
  const [assessMax, setAssessMax] = useState('100');
  const [assessPass, setAssessPass] = useState('33');
  const [editingSchemeId, setEditingSchemeId] = useState<number | null>(null);
  const [publishingId, setPublishingId] = useState<number | null>(null);

  // Staff & Nodal Officer state
  const [staffList, setStaffList] = useState<AuthUser[]>([]);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [accountRole, setAccountRole] = useState<'staff' | 'nodal_officer'>('staff');
  const [staffName, setStaffName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [staffUserId, setStaffUserId] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [designation, setDesignation] = useState<StaffDesignation>('Both');
  const [assignedClass, setAssignedClass] = useState<ClassName>('IV');
  const [assignedSection, setAssignedSection] = useState('A');
  const [assignedSubjects, setAssignedSubjects] = useState<string[]>([]);
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffDeletingId, setStaffDeletingId] = useState<number | null>(null);
  const [staffFormFeedback, setStaffFormFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<CreatedCredentialsInfo | null>(null);
  const [copiedCreds, setCopiedCreds] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffRoleFilter, setStaffRoleFilter] = useState<'all' | 'staff' | 'nodal_officer'>('all');

  // Question Papers state
  const [papers, setPapers] = useState<QuestionPaperItem[]>([]);
  const [paperTitle, setPaperTitle] = useState('');
  const [paperClass, setPaperClass] = useState<ClassName>('IV');
  const [paperSection, setPaperSection] = useState('A');
  const [paperSubject, setPaperSubject] = useState('HINDI');
  const [paperYear, setPaperYear] = useState(academicSession || '2026–2027');
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [paperUploading, setPaperUploading] = useState(false);
  const paperFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (academicSession) {
      setSessionDraft(academicSession);
      setPaperYear(academicSession);
    }
  }, [academicSession]);

  const handleSaveAcademicSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = sessionDraft.trim();
    if (cleaned.length < 4) {
      setFeedback({ type: 'err', msg: 'Please enter a valid Academic Session (e.g. 2026–2027).' });
      return;
    }
    setFeedback(null);
    setSessionSaving(true);
    try {
      const res = await apiFetch<{ academicSession: string }>('/api/admin/settings/session', {
        method: 'PUT',
        body: JSON.stringify({ academicSession: cleaned }),
      });
      setSessionDraft(res.academicSession);
      setPaperYear(res.academicSession);
      onSessionUpdated?.(res.academicSession);
      setFeedback({
        type: 'ok',
        msg: `Global Academic Session updated to "${res.academicSession}" across the entire MoE portal.`,
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setSessionSaving(false);
    }
  };

  const loadCirculars = useCallback(async () => {
    const res = await apiFetch<{ circulars: CircularItem[] }>('/api/circulars');
    setCirculars(res.circulars);
  }, []);

  const loadSchemes = useCallback(async () => {
    const res = await apiFetch<{
      schemes: MarkingSchemeItem[];
      publications: PublicationItem[];
    }>('/api/admin/marking-schemes');
    setSchemes(res.schemes);
    setPublications(res.publications);
  }, []);

  const loadStaff = useCallback(async () => {
    const res = await apiFetch<{ users: AuthUser[] }>('/api/admin/staff');
    setStaffList(res.users);
  }, []);

  const loadPapers = useCallback(async () => {
    const res = await apiFetch<{ papers: QuestionPaperItem[] }>('/api/question-papers');
    setPapers(res.papers);
  }, []);

  const syncCurrentTab = useCallback(
    async (silent = true) => {
      if (!silent) setRefreshing(true);
      try {
        if (tab === 'circulars') await loadCirculars();
        else if (tab === 'results') await loadSchemes();
        else if (tab === 'staff') await loadStaff();
        else if (tab === 'papers') await loadPapers();
      } catch (err) {
        if (!silent) setFeedback({ type: 'err', msg: (err as Error).message });
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [tab, loadCirculars, loadSchemes, loadStaff, loadPapers]
  );

  useEffect(() => {
    Promise.all([loadCirculars(), loadSchemes(), loadStaff(), loadPapers()]).catch((err) => {
      setFeedback({ type: 'err', msg: (err as Error).message });
    });
  }, [loadCirculars, loadSchemes, loadStaff, loadPapers]);

  useEffect(() => {
    void syncCurrentTab(true);
  }, [tab, syncCurrentTab]);

  useAutoRefresh(() => syncCurrentTab(true), true, 15000);

  const availableSections = getSectionsForClass(assignedClass);
  const availableSubjects = [...ALL_SUBJECTS];

  useEffect(() => {
    if (!availableSections.includes(assignedSection)) {
      setAssignedSection('A');
    }
  }, [assignedClass, availableSections, assignedSection]);

  const paperSections = getSectionsForClass(paperClass);
  const paperSubjects = [...ALL_SUBJECTS];

  useEffect(() => {
    if (!paperSections.includes(paperSection)) setPaperSection('A');
  }, [paperClass, paperSections, paperSection]);

  // Handlers: Circulars
  const handleSelectCircFile = (file: File | null) => {
    if (!file) {
      setCircFile(null);
      return;
    }
    if (file.size > MAX_UPLOAD_PDF_BYTES) {
      setFeedback({
        type: 'err',
        msg: 'Circular PDF is too large (max 18 MB). Please choose a smaller PDF file.',
      });
      setCircFile(null);
      if (circFileRef.current) circFileRef.current.value = '';
      return;
    }
    setCircFile(file);
  };

  const handleAddCircular = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!circFile) {
      setFeedback({ type: 'err', msg: 'Please choose a PDF file for the circular.' });
      return;
    }
    if (circFile.size > MAX_UPLOAD_PDF_BYTES) {
      setFeedback({
        type: 'err',
        msg: 'Circular PDF is too large (max 18 MB). Please choose a smaller PDF file.',
      });
      return;
    }
    setCircSubmitting(true);
    try {
      const b64 = await readFileAsBase64(circFile);
      const res = await apiFetch<{ circular: CircularItem }>('/api/admin/circulars', {
        method: 'POST',
        body: JSON.stringify({
          circularNumber: circNumber.trim(),
          title: circTitle.trim(),
          fileName: circFile.name,
          fileBase64: b64,
        }),
      });
      setCircNumber('');
      setCircTitle('');
      setCircFile(null);
      if (circFileRef.current) circFileRef.current.value = '';
      setCirculars((prev) => [res.circular, ...prev.filter((c) => c.id !== res.circular.id)]);
      loadCirculars().catch(() => {});
      setFeedback({ type: 'ok', msg: 'Circular published successfully.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setCircSubmitting(false);
    }
  };

  const handleDeleteCircular = async (id: number) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/circulars/${id}`, { method: 'DELETE' });
      await loadCirculars();
      setFeedback({ type: 'ok', msg: 'Circular deleted.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    }
  };

  // Handlers: Marking Scheme & Results
  const handleSaveScheme = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      if (editingSchemeId) {
        await apiFetch(`/api/admin/marking-schemes/${editingSchemeId}`, {
          method: 'PUT',
          body: JSON.stringify({
            assessmentName: assessName.trim(),
            maxMarks: Number(assessMax),
            passingMarks: Number(assessPass),
          }),
        });
        setFeedback({ type: 'ok', msg: 'Assessment updated.' });
      } else {
        await apiFetch('/api/admin/marking-schemes', {
          method: 'POST',
          body: JSON.stringify({
            className: schemeClass,
            assessmentName: assessName.trim(),
            maxMarks: Number(assessMax),
            passingMarks: Number(assessPass),
          }),
        });
        setFeedback({ type: 'ok', msg: `Assessment added for Class ${schemeClass}.` });
      }
      setAssessName('');
      setAssessMax('100');
      setAssessPass('33');
      setEditingSchemeId(null);
      await loadSchemes();
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    }
  };

  const handleDeleteScheme = async (id: number) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/marking-schemes/${id}`, { method: 'DELETE' });
      await loadSchemes();
      setFeedback({ type: 'ok', msg: 'Assessment removed.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    }
  };

  const handleTogglePublish = async (cls: ClassName, nextState: boolean) => {
    setFeedback(null);
    try {
      await apiFetch('/api/admin/results/publish', {
        method: 'POST',
        body: JSON.stringify({ className: cls, isPublished: nextState }),
      });
      await loadSchemes();
      setFeedback({
        type: 'ok',
        msg: nextState
          ? `Whole Class ${cls} Results (all assessments) are now published to students.`
          : `All results for Class ${cls} have been unpublished.`,
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    }
  };

  const handleToggleAssessmentPublish = async (s: MarkingSchemeItem) => {
    if (publishingId === s.id) return;
    setFeedback(null);
    setPublishingId(s.id);
    const nextState = !Boolean(s.isPublished);
    try {
      await apiFetch(`/api/admin/marking-schemes/${s.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ isPublished: nextState }),
      });
      await loadSchemes();
      setFeedback({
        type: 'ok',
        msg: nextState
          ? `Assessment "${s.assessmentName}" for Class ${s.className} is now published to students.`
          : `Assessment "${s.assessmentName}" for Class ${s.className} has been unpublished.`,
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setPublishingId(null);
    }
  };

  // Handlers: Staff & Nodal Officers
  const resetStaffForm = () => {
    setEditingUserId(null);
    setAccountRole('staff');
    setStaffName('');
    setEmployeeId('');
    setStaffUserId('');
    setStaffPassword('');
    setDesignation('Both');
    setAssignedClass('IV');
    setAssignedSection('A');
    setAssignedSubjects([]);
  };

  const handleStartEditStaff = (u: AuthUser) => {
    setStaffFormFeedback(null);
    setEditingUserId(u.id);
    setAccountRole(u.role === 'nodal_officer' ? 'nodal_officer' : 'staff');
    setStaffName(u.name);
    setEmployeeId(u.employeeId || '');
    setStaffUserId(u.userId);
    setStaffPassword('');
    if (u.role === 'staff') {
      setDesignation(u.designation || 'Both');
      setAssignedClass(u.assignedClass || 'IV');
      setAssignedSection(u.assignedSection || 'A');
      setAssignedSubjects(u.assignedSubjects || []);
    }
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (staffSaving) return;
    setFeedback(null);
    setStaffFormFeedback(null);

    const trimmedName = staffName.trim();
    const trimmedEmp = employeeId.trim();
    const trimmedUserId = staffUserId.trim();

    const nameErr = validateFullName(
      trimmedName,
      accountRole === 'nodal_officer' ? 'Officer Name' : 'Staff Name'
    );
    if (nameErr) {
      setFeedback({ type: 'err', msg: nameErr });
      setStaffFormFeedback({ type: 'err', msg: nameErr });
      return;
    }
    if (!trimmedEmp || !trimmedUserId) {
      const msg = 'Employee ID and User ID are required.';
      setFeedback({ type: 'err', msg });
      setStaffFormFeedback({ type: 'err', msg });
      return;
    }
    if (!editingUserId && staffPassword.length < 4) {
      const msg = 'Password must be at least 4 characters long.';
      setFeedback({ type: 'err', msg });
      setStaffFormFeedback({ type: 'err', msg });
      return;
    }
    if (editingUserId && staffPassword && staffPassword.length < 4) {
      const msg = 'New password must be at least 4 characters long.';
      setFeedback({ type: 'err', msg });
      setStaffFormFeedback({ type: 'err', msg });
      return;
    }
    if (
      accountRole === 'staff' &&
      (designation === 'Subject Teacher' || designation === 'Both') &&
      assignedSubjects.length === 0
    ) {
      const msg = `Please check at least one subject below for ${designation}.`;
      setFeedback({ type: 'err', msg });
      setStaffFormFeedback({ type: 'err', msg });
      return;
    }

    setStaffSaving(true);
    try {
      const payload = {
        role: accountRole,
        name: trimmedName,
        employeeId: trimmedEmp,
        userId: trimmedUserId,
        ...(staffPassword ? { password: staffPassword } : {}),
        ...(accountRole === 'staff'
          ? {
              designation,
              assignedClass,
              assignedSection,
              assignedSubjects,
            }
          : {}),
      };

      if (editingUserId) {
        const res = await apiFetch<{ user: AuthUser }>(`/api/admin/staff/${editingUserId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setStaffList((prev) =>
          prev.map((item) => (item.id === res.user.id ? res.user : item))
        );
        const msg = `Updated account for ${res.user.name} (User ID: ${res.user.userId}).`;
        setFeedback({ type: 'ok', msg });
        setStaffFormFeedback({ type: 'ok', msg });
        setCreatedCredentials(null);
      } else {
        const res = await apiFetch<{ user: AuthUser }>('/api/admin/staff', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setStaffList((prev) => [
          res.user,
          ...prev.filter((item) => item.id !== res.user.id),
        ]);
        const roleLabel =
          res.user.role === 'nodal_officer'
            ? 'Nodal Officer'
            : res.user.designation || 'Teaching Staff';
        const msg = `Added ${roleLabel}: ${res.user.name} (User ID: ${res.user.userId}). Saved to database.`;
        setFeedback({ type: 'ok', msg });
        setStaffFormFeedback({ type: 'ok', msg });
        setCopiedCreds(false);
        setCreatedCredentials({
          name: res.user.name,
          roleLabel,
          userId: res.user.userId,
          classInfo:
            res.user.role === 'staff'
              ? `Class ${res.user.assignedClass}-${res.user.assignedSection}`
              : undefined,
        });
      }
      resetStaffForm();
      loadStaff().catch(() => {
        // Optimistic list already reflects the saved record cleanly
      });
    } catch (err) {
      const msg = (err as Error).message;
      setFeedback({ type: 'err', msg });
      setStaffFormFeedback({ type: 'err', msg });
    } finally {
      setStaffSaving(false);
    }
  };

  const handleDeleteStaff = async (id: number) => {
    if (staffDeletingId === id) return;
    setFeedback(null);
    setStaffFormFeedback(null);
    setStaffDeletingId(id);
    try {
      await apiFetch(`/api/admin/staff/${id}`, { method: 'DELETE' });
      if (editingUserId === id) resetStaffForm();
      setStaffList((prev) => prev.filter((item) => item.id !== id));
      setFeedback({ type: 'ok', msg: 'Account deleted.' });
      loadStaff().catch(() => {});
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setStaffDeletingId(null);
    }
  };

  const toggleSubjectCheckbox = (sub: string) => {
    setAssignedSubjects((prev) =>
      prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub]
    );
  };

  // Handlers: Question Papers
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
      setFeedback({ type: 'err', msg: 'Please select a question paper PDF file.' });
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
          className: paperClass,
          section: paperSection,
          subject: paperSubject,
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
      setFeedback({ type: 'ok', msg: 'Question paper uploaded and saved to Academics.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setPaperUploading(false);
    }
  };

  const handleDeletePaper = async (id: number) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/academics/papers/${id}`, { method: 'DELETE' });
      await loadPapers();
      setFeedback({ type: 'ok', msg: 'Question paper deleted.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    }
  };

  const filteredStaffList = staffList.filter((u) => {
    if (staffRoleFilter !== 'all' && u.role !== staffRoleFilter) return false;
    const q = staffSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      u.userId.toLowerCase().includes(q) ||
      (u.employeeId || '').toLowerCase().includes(q) ||
      (u.designation || '').toLowerCase().includes(q) ||
      (u.assignedClass || '').toLowerCase().includes(q)
    );
  });

  const classSchemes = schemes.filter((s) => s.className === schemeClass);
  const classPublication = publications.find((p) => p.className === schemeClass);
  const classPublishedCount = classSchemes.filter((s) => Boolean(s.isPublished)).length;
  const isWholeClassPublished = Boolean(classPublication?.isPublished);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Workspace Header */}
      <div className="bg-white border border-slate-200 border-t-4 border-t-[#082D59] rounded-md p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-mono text-[#8B1E24] font-semibold">
            Administrator Control · User ID: {user.userId}
          </p>
          <h1 className="font-display text-2xl font-semibold text-[#082D59] mt-0.5">
            {user.name}
          </h1>
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

      {/* Global Academic Session Control (Applies to Entire MoE Portal) */}
      <form
        onSubmit={handleSaveAcademicSession}
        className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#EEF3F9] text-[#0B3C75] flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Global Academic Session Control
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Active Session: <strong className="font-mono text-[#0B3C75]">{academicSession}</strong>{' '}
              · Automatically updates Home, Admission Desk, Merit List, Question Papers &amp; Official Report Cards.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input
            type="text"
            required
            maxLength={32}
            value={sessionDraft}
            onChange={(e) => setSessionDraft(e.target.value)}
            placeholder="e.g. 2026–2027"
            aria-label="Global Academic Session"
            className="w-40 px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
          />
          <button
            type="submit"
            disabled={sessionSaving}
            className="px-4 py-2 bg-[#0B3C75] text-white text-xs sm:text-sm font-semibold rounded-lg hover:bg-[#144D8A] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            {sessionSaving ? 'Updating...' : 'Save Session'}
          </button>
        </div>
      </form>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-[#E4ECF5] rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setTab('circulars')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-md inline-flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            tab === 'circulars'
              ? 'bg-[#0B3C75] text-white shadow-sm'
              : 'text-[#0B3C75] hover:bg-white/60'
          }`}
        >
          <FileText className="w-4 h-4" />
          1. Add Circular
        </button>
        <button
          type="button"
          onClick={() => setTab('results')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-md inline-flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            tab === 'results'
              ? 'bg-[#0B3C75] text-white shadow-sm'
              : 'text-[#0B3C75] hover:bg-white/60'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          2. Enable Results &amp; Marking Scheme
        </button>
        <button
          type="button"
          onClick={() => setTab('staff')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-md inline-flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            tab === 'staff'
              ? 'bg-[#0B3C75] text-white shadow-sm'
              : 'text-[#0B3C75] hover:bg-white/60'
          }`}
        >
          <Users className="w-4 h-4" />
          3. Staff &amp; Nodal Officers
        </button>
        <button
          type="button"
          onClick={() => setTab('papers')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-md inline-flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            tab === 'papers'
              ? 'bg-[#0B3C75] text-white shadow-sm'
              : 'text-[#0B3C75] hover:bg-white/60'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          4. Academics Papers
        </button>
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

      {/* TAB 1: CIRCULARS */}
      {tab === 'circulars' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleAddCircular}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h2 className="font-display text-xl font-semibold text-slate-900">
              Publish New Circular
            </h2>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Circular Number * (Unique)
              </label>
              <input
                type="text"
                required
                value={circNumber}
                onChange={(e) => setCircNumber(e.target.value)}
                placeholder="e.g. CIR-2026-001"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Circular Name / Title *
              </label>
              <input
                type="text"
                required
                value={circTitle}
                onChange={(e) => setCircTitle(e.target.value)}
                placeholder="e.g. Annual Examination Schedule 2026-27"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Circular PDF Attachment * <span className="font-normal text-slate-500">(Max 18 MB)</span>
              </label>
              <input
                ref={circFileRef}
                type="file"
                accept=".pdf,application/pdf"
                required
                onChange={(e) => handleSelectCircFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100"
              />
            </div>

            <button
              type="submit"
              disabled={circSubmitting}
              className="w-full px-4 py-2.5 bg-[#0B3C75] text-white text-sm font-semibold rounded-lg hover:bg-[#144D8A] inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {circSubmitting ? 'Publishing...' : 'Publish Circular'}
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Published Circulars</h3>
              <span className="text-xs text-slate-500 tabular-nums">{circulars.length} total</span>
            </div>
            {circulars.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No circulars published yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {circulars.map((c) => (
                  <div key={c.id} className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-mono font-semibold text-[#0B3C75]">
                        Circular No: {c.circularNumber}
                      </p>
                      <p className="text-sm font-semibold text-slate-900 truncate">{c.title}</p>
                      <p className="text-xs text-slate-500">{c.originalFilename}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.hasPdf && (
                        <button
                          type="button"
                          onClick={() =>
                            downloadPdfFile(
                              `/api/circulars/${c.id}/download`,
                              c.originalFilename || `Circular_${c.circularNumber}.pdf`
                            )
                          }
                          className="p-2 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                          title="Download PDF"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteCircular(c.id)}
                        className="p-2 text-red-700 border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer"
                        title="Delete Circular"
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

      {/* TAB 2: ENABLE RESULTS & MARKING SCHEME */}
      {tab === 'results' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Select Class (IV to XII)
                </label>
                <select
                  value={schemeClass}
                  onChange={(e) => {
                    setSchemeClass(e.target.value as ClassName);
                    setEditingSchemeId(null);
                  }}
                  className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                >
                  {CLASSES.map((c) => (
                    <option key={c} value={c}>
                      Class {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-slate-600 max-w-md">
                <p className="font-semibold text-slate-800">
                  Class {schemeClass} Subjects:
                </p>
                <p className="mt-0.5">
                  {getSubjectsForClassSection(
                    schemeClass,
                    schemeClass === 'XI' || schemeClass === 'XII' ? 'R' : 'A'
                  ).join(' · ')}
                  {(schemeClass === 'XI' || schemeClass === 'XII') && ' (Section R stream)'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`text-xs font-semibold ${
                  isWholeClassPublished || classPublishedCount > 0
                    ? 'text-emerald-700'
                    : 'text-amber-700'
                }`}
              >
                {classSchemes.length === 0
                  ? 'Add assessments below first'
                  : isWholeClassPublished
                    ? 'Whole Class Published to Students'
                    : classPublishedCount > 0
                      ? `${classPublishedCount} / ${classSchemes.length} Assessments Published (Partial)`
                      : 'Hidden from Students'}
              </span>
              <button
                type="button"
                disabled={!isWholeClassPublished && classSchemes.length === 0}
                onClick={() => handleTogglePublish(schemeClass, !isWholeClassPublished)}
                className={`px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors disabled:opacity-50 ${
                  isWholeClassPublished
                    ? 'bg-amber-600 text-white hover:bg-amber-700'
                    : 'bg-emerald-700 text-white hover:bg-emerald-800'
                }`}
              >
                {isWholeClassPublished
                  ? 'Unpublish Whole Class'
                  : 'Publish Whole Class Results (All Assessments)'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <form
              onSubmit={handleSaveScheme}
              className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <h2 className="font-display text-xl font-semibold text-slate-900">
                {editingSchemeId
                  ? `Edit Assessment (Class ${schemeClass})`
                  : `Add Assessment to Class ${schemeClass}`}
              </h2>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assessment Name *
                </label>
                <input
                  type="text"
                  required
                  value={assessName}
                  onChange={(e) => setAssessName(e.target.value)}
                  placeholder="e.g. Half Yearly Exam, Unit Test 1, Practical"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Maximum Marks *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    required
                    value={assessMax}
                    onChange={(e) => setAssessMax(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Passing Marks *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    value={assessPass}
                    onChange={(e) => setAssessPass(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-[#0B3C75] text-white text-sm font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer"
                >
                  {editingSchemeId ? 'Save Changes' : 'Add Assessment'}
                </button>
                {editingSchemeId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSchemeId(null);
                      setAssessName('');
                      setAssessMax('100');
                      setAssessPass('33');
                    }}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Configured Assessments — Class {schemeClass}
                </h3>
                <span className="text-xs text-slate-500 tabular-nums">
                  {classSchemes.length} assessments
                </span>
              </div>
              {classSchemes.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No assessments configured for Class {schemeClass} yet. Add assessments on the
                  left — then publish them individually below or publish the whole class above.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#EEF3F9] border-b border-slate-200 text-xs font-semibold text-[#0B3C75]">
                        <th className="py-2.5 px-4">Assessment</th>
                        <th className="py-2.5 px-4 text-right">Max Marks</th>
                        <th className="py-2.5 px-4 text-right">Passing Marks</th>
                        <th className="py-2.5 px-4 text-center">Student Status</th>
                        <th className="py-2.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 tabular-nums">
                      {classSchemes.map((s) => {
                        const isAssessPub = Boolean(s.isPublished);
                        return (
                          <tr key={s.id}>
                            <td className="py-3 px-4 font-medium text-slate-900">
                              {s.assessmentName}
                            </td>
                            <td className="py-3 px-4 text-right font-mono">{s.maxMarks}</td>
                            <td className="py-3 px-4 text-right font-mono">{s.passingMarks}</td>
                            <td className="py-3 px-4 text-center">
                              <button
                                type="button"
                                disabled={publishingId === s.id}
                                onClick={() => handleToggleAssessmentPublish(s)}
                                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer transition-colors disabled:opacity-50 whitespace-nowrap ${
                                  isAssessPub
                                    ? 'bg-emerald-700 text-white hover:bg-amber-600'
                                    : 'border border-[#0B3C75] text-[#0B3C75] hover:bg-[#EEF3F9]'
                                }`}
                                title={
                                  isAssessPub
                                    ? 'Click to unpublish this specific assessment'
                                    : 'Click to publish only this specific assessment to students'
                                }
                              >
                                {publishingId === s.id
                                  ? 'Updating...'
                                  : isAssessPub
                                    ? 'Published (Unpublish)'
                                    : 'Publish Assessment'}
                              </button>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSchemeId(s.id);
                                    setAssessName(s.assessmentName);
                                    setAssessMax(String(s.maxMarks));
                                    setAssessPass(String(s.passingMarks));
                                  }}
                                  className="p-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
                                  title="Edit"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteScheme(s.id)}
                                  className="p-1.5 border border-red-200 rounded text-red-700 hover:bg-red-50 cursor-pointer"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
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

          {/* All Classes Publication Matrix */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Result Publication Overview (All Classes IV–XII)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-3">
              {CLASSES.map((cls) => {
                const pub = publications.find((p) => p.className === cls);
                const clsSch = schemes.filter((s) => s.className === cls);
                const pubCount = clsSch.filter((s) => Boolean(s.isPublished)).length;
                const isPub = Boolean(pub?.isPublished);
                return (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => handleTogglePublish(cls, !isPub)}
                    className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                      isPub
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                        : pubCount > 0
                          ? 'border-amber-300 bg-amber-50 text-amber-900'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <p className="text-xs font-mono font-semibold">Class {cls}</p>
                    <p className="text-[11px] font-semibold mt-1">
                      {isPub
                        ? 'Whole Published'
                        : pubCount > 0
                          ? `Partial (${pubCount}/${clsSch.length})`
                          : 'Unpublished'}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: STAFF & NODAL OFFICERS */}
      {tab === 'staff' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSaveStaff}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-slate-900">
                {editingUserId ? 'Edit Staff / Officer' : 'Add Staff or Nodal Officer'}
              </h2>
              {editingUserId && (
                <button
                  type="button"
                  onClick={resetStaffForm}
                  className="text-xs font-semibold text-slate-600 hover:underline cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            {!editingUserId && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Account Type
                </label>
                <select
                  value={accountRole}
                  onChange={(e) => setAccountRole(e.target.value as 'staff' | 'nodal_officer')}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                >
                  <option value="staff">Teaching Staff</option>
                  <option value="nodal_officer">Nodal Officer (Set User ID &amp; Password)</option>
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {accountRole === 'nodal_officer' ? 'Officer Name *' : 'Staff Name *'}
                </label>
                <input
                  type="text"
                  required
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                  placeholder="Full Name"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Employee ID *
                </label>
                <input
                  type="text"
                  required
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="e.g. EMP-204"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">User ID *</label>
                <input
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={staffUserId}
                  onChange={(e) => setStaffUserId(e.target.value)}
                  placeholder="Login User ID"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {editingUserId ? 'New Password (optional)' : 'Password *'}
                </label>
                <input
                  type="password"
                  required={!editingUserId}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={staffPassword}
                  onChange={(e) => setStaffPassword(e.target.value)}
                  placeholder={editingUserId ? 'Leave blank to keep' : 'Min 4 chars'}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                />
              </div>
            </div>

            {accountRole === 'staff' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Designation *
                  </label>
                  <select
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value as StaffDesignation)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  >
                    <option value="Subject Teacher">1. Subject Teacher (Marks only)</option>
                    <option value="Class Teacher">2. Class Teacher (Registry &amp; Attendance)</option>
                    <option value="Both">3. Both (Class &amp; Subject Teacher)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Assigned Class *
                    </label>
                    <select
                      value={assignedClass}
                      onChange={(e) => setAssignedClass(e.target.value as ClassName)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    >
                      {CLASSES.map((c) => (
                        <option key={c} value={c}>
                          Class {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Assigned Section *
                    </label>
                    <select
                      value={assignedSection}
                      onChange={(e) => setAssignedSection(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    >
                      {availableSections.map((s) => (
                        <option key={s} value={s}>
                          Section {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Assigned Subject(s)
                    {designation === 'Class Teacher'
                      ? ' (Optional for Class Teacher)'
                      : ' * (Select at least one)'}
                  </label>
                  <div className="grid grid-cols-2 gap-2 border border-slate-200 rounded-lg p-3 bg-slate-50/70">
                    {availableSubjects.map((sub) => (
                      <label
                        key={sub}
                        className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={assignedSubjects.includes(sub)}
                          onChange={() => toggleSubjectCheckbox(sub)}
                          className="rounded border-slate-300 text-[#0B3C75]"
                        />
                        <span>{sub}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {staffFormFeedback && (
              <div
                className={`p-3 rounded-lg border text-xs font-medium ${
                  staffFormFeedback.type === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                {staffFormFeedback.msg}
              </div>
            )}

            {createdCredentials && (
              <div className="p-3.5 rounded-lg border border-[#0B3C75]/30 bg-[#EEF3F9] text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#0B3C75]">
                    Account Saved — Share Login User ID
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const text = `MoE School Portal Login\nName: ${createdCredentials.name}\nRole: ${createdCredentials.roleLabel}${createdCredentials.classInfo ? `\nClass: ${createdCredentials.classInfo}` : ''}\nUser ID: ${createdCredentials.userId}\nPortal: ${window.location.origin}`;
                      navigator.clipboard?.writeText(text).then(() => setCopiedCreds(true));
                    }}
                    className="px-2.5 py-1 bg-white border border-[#0B3C75]/30 rounded text-[#0B3C75] font-semibold hover:bg-blue-50 inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedCreds ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedCreds ? 'Copied' : 'Copy Details'}
                  </button>
                </div>
                <p className="font-mono text-slate-800">
                  User ID: <strong>{createdCredentials.userId}</strong> · {createdCredentials.roleLabel}
                  {createdCredentials.classInfo ? ` · ${createdCredentials.classInfo}` : ''}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={staffSaving}
              className="w-full px-4 py-2.5 bg-[#0B3C75] text-white text-sm font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer disabled:opacity-60"
            >
              {staffSaving
                ? editingUserId
                  ? 'Updating Account...'
                  : 'Creating Account...'
                : editingUserId
                  ? 'Update Assignment & Credentials'
                  : 'Create Account'}
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Enrolled Staff &amp; Nodal Officers
                </h3>
                <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                  Showing {filteredStaffList.length} of {staffList.length} accounts
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={staffSearch}
                  onChange={(e) => setStaffSearch(e.target.value)}
                  placeholder="Search name / User ID / Emp ID..."
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75] w-48"
                />
                <select
                  value={staffRoleFilter}
                  onChange={(e) =>
                    setStaffRoleFilter(e.target.value as 'all' | 'staff' | 'nodal_officer')
                  }
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="all">All Roles</option>
                  <option value="staff">Teaching Staff</option>
                  <option value="nodal_officer">Nodal Officers</option>
                </select>
              </div>
            </div>

            {staffList.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No staff accounts created yet. Add a teacher on the left.
              </div>
            ) : filteredStaffList.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No accounts match your search filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {filteredStaffList.map((u) => (
                  <div
                    key={u.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono">
                        <span className="font-semibold text-[#0B3C75]">User: {u.userId}</span>
                        <span aria-hidden="true">·</span>
                        <span>Emp ID: {u.employeeId}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans font-semibold text-slate-700">
                          {u.role === 'nodal_officer' ? 'Nodal Officer' : u.designation}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900">{u.name}</p>
                      {u.role === 'staff' && (
                        <p className="text-xs text-slate-600">
                          Class {u.assignedClass}-{u.assignedSection}
                          {u.assignedSubjects.length > 0 &&
                            ` · Subjects: ${u.assignedSubjects.join(', ')}`}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEditStaff(u)}
                        className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={staffDeletingId === u.id}
                        onClick={() => handleDeleteStaff(u.id)}
                        className="p-1.5 border border-red-200 rounded-lg text-red-700 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                        title="Delete"
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

      {/* TAB 4: QUESTION PAPERS */}
      {tab === 'papers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleUploadPaper}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h2 className="font-display text-xl font-semibold text-slate-900">
              Upload Question Paper
            </h2>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Question Paper Title *
              </label>
              <input
                type="text"
                required
                value={paperTitle}
                onChange={(e) => setPaperTitle(e.target.value)}
                placeholder="e.g. Half Yearly Science Paper"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Class</label>
                <select
                  value={paperClass}
                  onChange={(e) => setPaperClass(e.target.value as ClassName)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {CLASSES.map((c) => (
                    <option key={c} value={c}>
                      Class {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Section</label>
                <select
                  value={paperSection}
                  onChange={(e) => setPaperSection(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {paperSections.map((s) => (
                    <option key={s} value={s}>
                      Section {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Subject</label>
                <select
                  value={paperSubject}
                  onChange={(e) => setPaperSubject(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  {paperSubjects.map((sub) => (
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
                className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-700"
              />
            </div>

            <button
              type="submit"
              disabled={paperUploading}
              className="w-full px-4 py-2.5 bg-[#0B3C75] text-white text-sm font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer disabled:opacity-60"
            >
              {paperUploading ? 'Uploading Paper...' : 'Upload Question Paper'}
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Uploaded Question Papers</h3>
              <span className="text-xs text-slate-500 tabular-nums">{papers.length} files</span>
            </div>
            {papers.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No question papers uploaded yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {papers.map((p) => (
                  <div key={p.id} className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-mono text-[#0B3C75]">
                        Class {p.className}-{p.section} · {p.subject} · {p.academicYear}
                      </p>
                      <p className="text-sm font-semibold text-slate-900 truncate">{p.title}</p>
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
                        onClick={() => handleDeletePaper(p.id)}
                        className="p-2 text-red-700 border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer"
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
