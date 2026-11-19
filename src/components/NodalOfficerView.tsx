import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  EyeOff,
  FileDown,
  LogOut,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ToggleLeft,
  ToggleRight,
  X,
  XCircle,
} from 'lucide-react';
import { crestEmblemImg } from '../assets/schoolImages.ts';
import { apiFetch, downloadAuthFile, useAutoRefresh } from '../lib/api.ts';
import {
  CLASSES,
  type AdmissionApplication,
  type AdmissionConfig,
  type AdmissionStatus,
  type AuthUser,
  type ClassName,
  type MeritListEntry,
  getSectionsForClass,
} from '../shared/schoolRules.ts';

interface NodalOfficerViewProps {
  user: AuthUser;
  onLogout: () => void;
  onAdmissionStatusChanged: (enabled: boolean, config?: AdmissionConfig) => void;
}

type FilterTab = 'All' | AdmissionStatus;

const DEFAULT_CONFIG: AdmissionConfig = {
  admissionsEnabled: false,
  academicSession: '2026–2027',
  openClasses: [...CLASSES],
  closingDate: null,
  instructions:
    'Keep student passport photograph, Birth Certificate / Aadhaar, and previous class marksheet ready before applying.',
  publishMeritList: false,
  classSeats: {
    IV: 40,
    V: 40,
    VI: 40,
    VII: 40,
    VIII: 40,
    IX: 45,
    X: 45,
    XI: 60,
    XII: 40,
  },
};

export function NodalOfficerView({
  user,
  onLogout,
  onAdmissionStatusChanged,
}: NodalOfficerViewProps) {
  const [admissionsEnabled, setAdmissionsEnabled] = useState(false);
  const [config, setConfig] = useState<AdmissionConfig>(DEFAULT_CONFIG);
  const [showPolicyPanel, setShowPolicyPanel] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const [activeTab, setActiveTab] = useState<'queue' | 'merit'>('queue');
  const [filter, setFilter] = useState<FilterTab>('All');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [applications, setApplications] = useState<AdmissionApplication[]>([]);
  const [meritList, setMeritList] = useState<MeritListEntry[]>([]);
  const [meritClassFilter, setMeritClassFilter] = useState<string>('ALL');
  const [meritSearch, setMeritSearch] = useState('');
  const [marksDraft, setMarksDraft] = useState<Record<number, string>>({});
  const [savingMarksId, setSavingMarksId] = useState<number | null>(null);
  const [meritVisibilityBusy, setMeritVisibilityBusy] = useState(false);

  const [counts, setCounts] = useState({
    total: 0,
    pending: 0,
    waitlisted: 0,
    correctionNeeded: 0,
    approved: 0,
    denied: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Dossier View & Officer Decision Modal state
  const [viewingApp, setViewingApp] = useState<AdmissionApplication | null>(null);
  const [allottedSection, setAllottedSection] = useState('A');
  const [officerNotes, setOfficerNotes] = useState('');
  const [dossierMarks, setDossierMarks] = useState('');
  const [autoEnroll, setAutoEnroll] = useState(true);

  // Deny Confirmation Modal state
  const [denyingApp, setDenyingApp] = useState<AdmissionApplication | null>(null);
  const [denyReason, setDenyReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const loadData = useCallback(
    async (statusFilter = filter, mode: 'initial' | 'manual' | 'background' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'manual') setRefreshing(true);
      try {
        const [settingsRes, appsRes] = await Promise.all([
          apiFetch<{ admissionsEnabled: boolean; config?: AdmissionConfig }>(
            '/api/nodal/admissions/settings'
          ),
          apiFetch<{
            applications: AdmissionApplication[];
            meritList?: MeritListEntry[];
            counts: {
              total: number;
              pending: number;
              waitlisted?: number;
              correctionNeeded?: number;
              approved: number;
              denied: number;
            };
          }>(`/api/nodal/admissions?status=${encodeURIComponent(statusFilter)}`),
        ]);
        setAdmissionsEnabled(settingsRes.admissionsEnabled);
        if (settingsRes.config) {
          setConfig(settingsRes.config);
        }
        onAdmissionStatusChanged(settingsRes.admissionsEnabled, settingsRes.config);
        setApplications(appsRes.applications);
        setMeritList(appsRes.meritList || []);
        setMarksDraft((prev) => {
          const next = { ...prev };
          for (const app of appsRes.applications) {
            if (mode !== 'background' || next[app.id] === undefined) {
              next[app.id] =
                app.entranceMarks !== null && app.entranceMarks !== undefined
                  ? String(app.entranceMarks)
                  : '';
            }
          }
          return next;
        });
        setCounts({
          total: appsRes.counts.total,
          pending: appsRes.counts.pending,
          waitlisted: appsRes.counts.waitlisted ?? 0,
          correctionNeeded: appsRes.counts.correctionNeeded ?? 0,
          approved: appsRes.counts.approved,
          denied: appsRes.counts.denied,
        });
      } catch (err) {
        if (mode !== 'background') {
          setFeedback({ type: 'err', msg: (err as Error).message });
        }
      } finally {
        if (mode === 'initial') setLoading(false);
        if (mode === 'manual') setRefreshing(false);
      }
    },
    [filter, onAdmissionStatusChanged]
  );

  useEffect(() => {
    void loadData(filter, 'initial');
  }, [filter, loadData]);

  useAutoRefresh(
    () => loadData(filter, 'background'),
    !viewingApp && !denyingApp && !showPolicyPanel,
    15000
  );

  const handleToggleAdmissions = async () => {
    setFeedback(null);
    try {
      const next = !admissionsEnabled;
      const res = await apiFetch<{ admissionsEnabled: boolean; config?: AdmissionConfig }>(
        '/api/nodal/admissions/toggle',
        {
          method: 'POST',
          body: JSON.stringify({ enabled: next }),
        }
      );
      setAdmissionsEnabled(res.admissionsEnabled);
      if (res.config) setConfig(res.config);
      onAdmissionStatusChanged(res.admissionsEnabled, res.config);
      setFeedback({
        type: 'ok',
        msg: res.admissionsEnabled
          ? 'Admission Portal is now OPEN. Aspirants can submit online applications for enabled classes.'
          : 'Admission Portal is now CLOSED. Public registration is disabled until reopened by Nodal Officer.',
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    }
  };

  const handleToggleOpenClass = (cls: ClassName) => {
    setConfig((prev) => {
      const exists = prev.openClasses.includes(cls);
      const nextClasses = exists
        ? prev.openClasses.filter((c) => c !== cls)
        : CLASSES.filter((c) => c === cls || prev.openClasses.includes(c));
      return { ...prev, openClasses: nextClasses };
    });
  };

  const handleToggleMeritVisibility = async () => {
    if (meritVisibilityBusy) return;
    setFeedback(null);
    setMeritVisibilityBusy(true);
    try {
      const next = !config.publishMeritList;
      const res = await apiFetch<{ config: AdmissionConfig }>('/api/nodal/admissions/config', {
        method: 'PUT',
        body: JSON.stringify({
          openClasses: config.openClasses,
          closingDate: config.closingDate,
          instructions: config.instructions,
          publishMeritList: next,
          classSeats: config.classSeats,
        }),
      });
      setConfig(res.config);
      onAdmissionStatusChanged(res.config.admissionsEnabled, res.config);
      setFeedback({
        type: 'ok',
        msg: res.config.publishMeritList
          ? 'Auto-Generated Merit List is now PUBLISHED on the public Admission Desk.'
          : 'Public Merit List is now HIDDEN from the public Admission Desk (still visible to you here).',
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setMeritVisibilityBusy(false);
    }
  };

  const handleSavePolicyConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSavingPolicy(true);
    try {
      const res = await apiFetch<{ config: AdmissionConfig }>('/api/nodal/admissions/config', {
        method: 'PUT',
        body: JSON.stringify({
          openClasses: config.openClasses,
          closingDate: config.closingDate,
          instructions: config.instructions,
          publishMeritList: config.publishMeritList,
          classSeats: config.classSeats,
        }),
      });
      setConfig(res.config);
      onAdmissionStatusChanged(res.config.admissionsEnabled, res.config);
      setFeedback({
        type: 'ok',
        msg: `Admission Registry policy saved (${res.config?.openClasses?.length ?? 0} open classes · Merit list ${
          res.config.publishMeritList ? 'Published' : 'Hidden'
        }).`,
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleSaveMarks = async (appId: number, rawValue: string) => {
    setFeedback(null);
    const trimmed = rawValue.trim();
    if (trimmed !== '') {
      const num = Number(trimmed);
      if (!Number.isFinite(num) || num < 0 || num > 100) {
        setFeedback({ type: 'err', msg: 'Evaluation marks must be between 0 and 100.' });
        return;
      }
    }
    setSavingMarksId(appId);
    try {
      const res = await apiFetch<{ application: AdmissionApplication }>(
        `/api/nodal/admissions/${appId}/marks`,
        {
          method: 'POST',
          body: JSON.stringify({ marks: trimmed === '' ? null : Number(trimmed) }),
        }
      );
      setApplications((prev) => prev.map((a) => (a.id === appId ? res.application : a)));
      setMarksDraft((prev) => ({
        ...prev,
        [appId]:
          res.application.entranceMarks !== null && res.application.entranceMarks !== undefined
            ? String(res.application.entranceMarks)
            : '',
      }));
      if (viewingApp?.id === appId) {
        setViewingApp(res.application);
        setDossierMarks(
          res.application.entranceMarks !== null && res.application.entranceMarks !== undefined
            ? String(res.application.entranceMarks)
            : ''
        );
      }
      setFeedback({
        type: 'ok',
        msg:
          res.application.entranceMarks !== null
            ? `Saved ${res.application.entranceMarks}/100 marks for ${res.application.studentName} and updated the Merit List.`
            : `Cleared evaluation marks for ${res.application.studentName} and updated the Merit List.`,
      });
      await loadData(filter, 'background');
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setSavingMarksId(null);
    }
  };

  const handleViewApplication = async (id: number) => {
    setFeedback(null);
    try {
      const res = await apiFetch<{ application: AdmissionApplication }>(
        `/api/nodal/admissions/${id}`
      );
      setViewingApp(res.application);
      setAllottedSection(res.application.allottedSection || 'A');
      setOfficerNotes(res.application.officerNotes || '');
      setDossierMarks(
        res.application.entranceMarks !== null && res.application.entranceMarks !== undefined
          ? String(res.application.entranceMarks)
          : ''
      );
      setAutoEnroll(true);
      setApplications((prev) => prev.map((a) => (a.id === id ? res.application : a)));
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    }
  };

  const handleApproveApplication = async (
    app: { id: number; studentName: string },
    opts?: { section?: string; notes?: string; autoEnrollFlag?: boolean; entranceMarks?: string }
  ) => {
    setFeedback(null);
    const marksStr = opts?.entranceMarks?.trim();
    if (marksStr !== undefined && marksStr !== '') {
      const num = Number(marksStr);
      if (!Number.isFinite(num) || num < 0 || num > 100) {
        setFeedback({ type: 'err', msg: 'Evaluation marks must be between 0 and 100.' });
        return;
      }
    }
    setActionBusy(true);
    try {
      const res = await apiFetch<{ application: AdmissionApplication }>(
        `/api/nodal/admissions/${app.id}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            section: opts?.section || 'A',
            officerNotes: opts?.notes || '',
            autoEnroll: opts?.autoEnrollFlag ?? true,
            ...(marksStr !== undefined && marksStr !== '' ? { entranceMarks: Number(marksStr) } : {}),
          }),
        }
      );
      setFeedback({
        type: 'ok',
        msg: `Approved ${res.application.studentName} · Roll No: ${res.application.rollNumber} · Section ${
          res.application.allottedSection || 'A'
        }${
          res.application.enrolledStudentId
            ? ` · Enrolled Student ID: ${res.application.enrolledStudentId}`
            : ''
        }`,
      });
      if (viewingApp?.id === app.id) {
        setViewingApp(res.application);
      }
      await loadData(filter, 'background');
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setActionBusy(false);
    }
  };

  const handleReviewStatus = async (
    app: AdmissionApplication,
    nextStatus: 'Pending' | 'Waitlisted' | 'Correction Needed',
    notes: string
  ) => {
    setFeedback(null);
    setActionBusy(true);
    try {
      const res = await apiFetch<{ application: AdmissionApplication }>(
        `/api/nodal/admissions/${app.id}/review`,
        {
          method: 'POST',
          body: JSON.stringify({
            status: nextStatus,
            officerNotes: notes,
          }),
        }
      );
      setFeedback({
        type: 'ok',
        msg: `Application ${res.application.applicationCode} (${res.application.studentName}) updated to "${res.application.status}".`,
      });
      if (viewingApp?.id === app.id) {
        setViewingApp(res.application);
      }
      await loadData(filter, 'background');
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmDeny = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!denyingApp) return;
    setFeedback(null);
    setActionBusy(true);
    try {
      const res = await apiFetch<{ application: AdmissionApplication }>(
        `/api/nodal/admissions/${denyingApp.id}/deny`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: denyReason.trim() }),
        }
      );
      setFeedback({
        type: 'ok',
        msg: `Application for ${res.application.studentName} marked as Denied. No roll number assigned.`,
      });
      if (viewingApp?.id === denyingApp.id) {
        setViewingApp(res.application);
      }
      setDenyingApp(null);
      setDenyReason('');
      await loadData(filter, 'background');
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setActionBusy(false);
    }
  };

  const handleDownloadSupportingDoc = async (app: AdmissionApplication) => {
    setFeedback(null);
    try {
      await downloadAuthFile(
        `/api/nodal/admissions/${app.id}/document`,
        app.documentFilename || `${app.applicationCode}_document.pdf`
      );
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Application ID',
      'Student Name',
      'Father Name',
      'Mother Name',
      'Class',
      'Stream',
      'DOB',
      'Gender',
      'Phone',
      'Previous %',
      'Officer Marks (/100)',
      'Status',
      'Section',
      'Roll Number',
      'Enrolled Student ID',
    ];
    const escapeCsv = (val: unknown) => {
      const s = String(val ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = filteredApps.map((a) =>
      [
        a.applicationCode,
        a.studentName,
        a.fatherName,
        a.motherName,
        a.classApplied,
        a.streamApplied || '',
        a.dob,
        a.gender,
        a.contactPhone,
        a.previousPercentage || '',
        a.entranceMarks ?? '',
        a.status,
        a.allottedSection || '',
        a.rollNumber || '',
        a.enrolledStudentId || '',
      ]
        .map(escapeCsv)
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `admissions_${filter.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const filteredApps = applications.filter((a) => {
    if (classFilter !== 'ALL' && a.classApplied !== classFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      a.studentName.toLowerCase().includes(q) ||
      a.applicationCode.toLowerCase().includes(q) ||
      a.fatherName.toLowerCase().includes(q) ||
      (a.rollNumber || '').toLowerCase().includes(q) ||
      (a.contactPhone || '').toLowerCase().includes(q)
    );
  });

  const filteredMeritList = meritList.filter((m) => {
    if (meritClassFilter !== 'ALL' && m.classApplied !== meritClassFilter) return false;
    const q = meritSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      m.studentName.toLowerCase().includes(q) ||
      m.applicationCode.toLowerCase().includes(q) ||
      (m.rollNumber || '').toLowerCase().includes(q)
    );
  });

  const statusColorClass = (st: AdmissionStatus) => {
    if (st === 'Approved') return 'text-emerald-700';
    if (st === 'Denied') return 'text-red-700';
    if (st === 'Waitlisted') return 'text-[#0B3C75]';
    if (st === 'Correction Needed') return 'text-[#B45309]';
    return 'text-amber-700';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Nodal Officer Header */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <img
            src={crestEmblemImg}
            alt="School Crest"
            className="w-11 h-11 object-contain shrink-0 rounded border border-slate-200 p-0.5 bg-white"
          />
          <div>
            <p className="text-xs font-mono text-[#7C1D24] font-semibold">
              Nodal Officer Admission Registry · Exclusive Authority · ID: {user.userId}
            </p>
            <h1 className="font-display text-2xl font-semibold text-slate-900 mt-0.5">
              {user.name}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <button
            type="button"
            disabled={refreshing}
            onClick={() => loadData(filter, 'manual')}
            className="px-3 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Master Admission Window & Policy Control Card */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-900">
              Admission Process Master Control
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Portal Window:{' '}
              <strong className={admissionsEnabled ? 'text-emerald-700' : 'text-red-700'}>
                {admissionsEnabled
                  ? `Open (${config?.openClasses?.length ?? 0} classes enabled · Session ${config?.academicSession || '2026–2027'})`
                  : 'Registration Closed'}
              </strong>{' '}
              · Merit List:{' '}
              <strong className={config.publishMeritList ? 'text-[#0B3C75]' : 'text-slate-600'}>
                {config.publishMeritList ? 'Published Publicly' : 'Hidden'}
              </strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={meritVisibilityBusy}
              onClick={handleToggleMeritVisibility}
              className={`px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-lg inline-flex items-center gap-2 cursor-pointer whitespace-nowrap transition-colors border disabled:opacity-60 ${
                config.publishMeritList
                  ? 'border-[#0B3C75] bg-[#0B3C75] text-white hover:bg-[#144D8A]'
                  : 'border-[#7C1D24]/40 bg-[#FFF5EB] text-[#7C1D24] hover:bg-[#FDE8D3]'
              }`}
            >
              {config.publishMeritList ? (
                <>
                  <EyeOff className="w-4 h-4" />
                  Hide Public Merit List
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4" />
                  Show Public Merit List
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowPolicyPanel((p) => !p)}
              className="px-4 py-2.5 border border-[#0B3C75]/40 text-[#0B3C75] bg-[#EEF3F9] text-xs sm:text-sm font-semibold rounded-lg hover:bg-[#E1EAF5] inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Settings className="w-4 h-4" />
              {showPolicyPanel ? 'Hide Policy & Seats' : 'Configure Classes, Seats & Notice'}
            </button>

            <button
              type="button"
              onClick={handleToggleAdmissions}
              className={`px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-lg inline-flex items-center gap-2 cursor-pointer whitespace-nowrap transition-colors ${
                admissionsEnabled
                  ? 'bg-red-700 text-white hover:bg-red-800'
                  : 'bg-emerald-700 text-white hover:bg-emerald-800'
              }`}
            >
              {admissionsEnabled ? (
                <>
                  <ToggleRight className="w-5 h-5" />
                  Close Admissions
                </>
              ) : (
                <>
                  <ToggleLeft className="w-5 h-5" />
                  Enable Admissions
                </>
              )}
            </button>
          </div>
        </div>

        {/* Expandable Nodal Officer Admission Policy & Seat Quota Controls */}
        {showPolicyPanel && (
          <form
            onSubmit={handleSavePolicyConfig}
            className="border-t border-slate-200 pt-5 space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Active Academic Session
                </label>
                <div className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700 flex items-center justify-between">
                  <span>{config.academicSession}</span>
                  <span className="text-[10px] font-sans text-slate-500">Admin Controlled</span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Application Closing Date (Optional)
                </label>
                <input
                  type="date"
                  value={config.closingDate || ''}
                  onChange={(e) =>
                    setConfig({ ...config, closingDate: e.target.value || null })
                  }
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.publishMeritList}
                    onChange={(e) =>
                      setConfig({ ...config, publishMeritList: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-slate-300 text-[#0B3C75]"
                  />
                  <span>Publish Auto-Generated Merit List Publicly</span>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-700">
                Enabled Classes &amp; Sanctioned Seat Quotas
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2.5">
                {CLASSES.map((cls) => {
                  const isOpen = config.openClasses.includes(cls);
                  return (
                    <div
                      key={cls}
                      className={`p-2.5 rounded-lg border space-y-2 ${
                        isOpen
                          ? 'border-[#0B3C75]/40 bg-[#EEF3F9]/70'
                          : 'border-slate-200 bg-slate-50 opacity-75'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleOpenClass(cls)}
                        className="w-full flex items-center justify-between text-xs font-semibold cursor-pointer"
                      >
                        <span className="text-slate-900">Class {cls}</span>
                        <span className={isOpen ? 'text-emerald-700' : 'text-slate-400'}>
                          {isOpen ? 'Open' : 'Off'}
                        </span>
                      </button>
                      <div>
                        <label className="block text-[10px] text-slate-500">Seats</label>
                        <input
                          type="number"
                          min={0}
                          max={1000}
                          value={config.classSeats[cls] ?? 40}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              classSeats: {
                                ...config.classSeats,
                                [cls]: Math.max(0, Number(e.target.value) || 0),
                              },
                            })
                          }
                          className="w-full px-2 py-1 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Public Admission Desk Notice / Instructions
              </label>
              <textarea
                rows={2}
                value={config.instructions}
                onChange={(e) => setConfig({ ...config, instructions: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingPolicy}
                className="px-5 py-2 bg-[#0B3C75] text-white text-xs sm:text-sm font-semibold rounded-lg hover:bg-[#144D8A] inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {savingPolicy ? 'Saving Policy...' : 'Save Registry Settings'}
              </button>
            </div>
          </form>
        )}
      </div>

      {feedback && (
        <div
          className={`no-print p-3.5 rounded-lg border text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* Workspace Sub-View Tabs */}
      <div className="no-print flex flex-wrap items-center gap-1 p-1 bg-[#E4ECF5] rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('queue')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-md inline-flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            activeTab === 'queue'
              ? 'bg-[#0B3C75] text-white shadow-xs'
              : 'text-[#0B3C75] hover:bg-white/60'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          1. Applications &amp; Officer Evaluation ({counts.total})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('merit')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-md inline-flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            activeTab === 'merit'
              ? 'bg-[#0B3C75] text-white shadow-xs'
              : 'text-[#0B3C75] hover:bg-white/60'
          }`}
        >
          <Award className="w-4 h-4" />
          2. Auto-Generated Merit List ({meritList.length})
        </button>
      </div>

      {activeTab === 'queue' && (
        <>
          {/* Pipeline Status Filter Tabs, Class Dropdown, Search & CSV Export */}
          <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#E4ECF5] rounded-lg w-fit">
              {(
                [
                  { id: 'All', label: `All (${counts.total})` },
                  { id: 'Pending', label: `Pending (${counts.pending})` },
                  { id: 'Waitlisted', label: `Waitlisted (${counts.waitlisted})` },
                  { id: 'Correction Needed', label: `Correction (${counts.correctionNeeded})` },
                  { id: 'Approved', label: `Approved (${counts.approved})` },
                  { id: 'Denied', label: `Denied (${counts.denied})` },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer tabular-nums whitespace-nowrap ${
                    filter === f.id
                      ? 'bg-[#0B3C75] text-white shadow-xs'
                      : 'text-[#0B3C75] hover:bg-white/60'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
              >
                <option value="ALL">All Classes</option>
                {CLASSES.map((c) => (
                  <option key={c} value={c}>
                    Class {c}
                  </option>
                ))}
              </select>

              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search student, ID, roll..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                />
              </div>

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={filteredApps.length === 0}
                className="px-3.5 py-2 border border-slate-300 bg-white text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                <FileDown className="w-3.5 h-3.5" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Applications Registry Table */}
          <div className="no-print bg-white border border-slate-200 rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-8 text-sm text-slate-500">Loading admission applications...</div>
            ) : filteredApps.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">
                No {filter === 'All' ? '' : filter.toLowerCase()} admission applications match this view.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#EEF3F9] border-b border-slate-200 text-xs font-semibold text-[#0B3C75]">
                      <th className="py-3 px-4">Application ID</th>
                      <th className="py-3 px-4">Applicant Details</th>
                      <th className="py-3 px-4">Class &amp; Stream</th>
                      <th className="py-3 px-4">DOB / Prev %</th>
                      <th className="py-3 px-4">Evaluation Marks (/100)</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Allotted Roll / Sec</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredApps.map((a) => {
                      const draftVal = marksDraft[a.id] ?? '';
                      const isDenied = a.status === 'Denied';
                      return (
                        <tr key={a.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                            {a.applicationCode}
                            {a.hasDocument && (
                              <p className="text-[10px] text-[#0B3C75] mt-0.5">Document Attached</p>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900">{a.studentName}</p>
                            <p className="text-xs text-slate-500">
                              C/O {a.fatherName} · {a.viewedByOfficer ? 'Viewed' : 'Unviewed'}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-xs sm:text-sm">
                            <span className="font-semibold text-slate-900">Class {a.classApplied}</span>
                            {a.streamApplied && (
                              <p className="text-[11px] text-slate-500">{a.streamApplied}</p>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            <p className="font-mono tabular-nums text-slate-800">{a.dob}</p>
                            <p className="text-slate-500 font-mono">
                              {a.previousPercentage ? `${a.previousPercentage}% prev` : a.gender}
                            </p>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.5"
                                disabled={isDenied}
                                value={draftVal}
                                onChange={(e) =>
                                  setMarksDraft((prev) => ({ ...prev, [a.id]: e.target.value }))
                                }
                                placeholder="0–100"
                                className="w-20 px-2 py-1 text-xs font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#0B3C75] disabled:bg-slate-100"
                              />
                              <button
                                type="button"
                                disabled={isDenied || savingMarksId === a.id}
                                onClick={() => void handleSaveMarks(a.id, draftVal)}
                                className="px-2 py-1 bg-[#0B3C75] text-white text-[11px] font-semibold rounded hover:bg-[#144D8A] cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              >
                                {savingMarksId === a.id ? '...' : 'Save'}
                              </button>
                            </div>
                          </td>
                          <td className={`py-3 px-4 font-semibold text-xs ${statusColorClass(a.status)}`}>
                            {a.status}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-xs">
                            {a.rollNumber ? (
                              <span className="font-bold text-slate-900">
                                {a.rollNumber} ({a.allottedSection || 'A'})
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleViewApplication(a.id)}
                                className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Review Dossier
                              </button>

                              {(a.status === 'Pending' || a.status === 'Waitlisted') && (
                                <>
                                  <button
                                    type="button"
                                    disabled={actionBusy}
                                    onClick={() => handleApproveApplication(a)}
                                    className="px-2.5 py-1.5 bg-emerald-700 text-white rounded-lg text-xs font-semibold hover:bg-emerald-800 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-60"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    disabled={actionBusy}
                                    onClick={() => {
                                      setDenyingApp(a);
                                      setDenyReason('');
                                    }}
                                    className="px-2.5 py-1.5 bg-red-700 text-white rounded-lg text-xs font-semibold hover:bg-red-800 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-60"
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                    Deny
                                  </button>
                                </>
                              )}
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
        </>
      )}

      {activeTab === 'merit' && (
        <div className="no-print bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900">
                Automatic Admission Merit List — Session {config.academicSession}
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Ranked automatically per class by Officer Evaluation Marks (0–100), then Previous
                Class %, and highlighted against sanctioned seat quotas. Public view is currently{' '}
                <strong className={config.publishMeritList ? 'text-emerald-700' : 'text-[#7C1D24]'}>
                  {config.publishMeritList ? 'VISIBLE to Public' : 'HIDDEN from Public'}
                </strong>
                .
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={meritClassFilter}
                onChange={(e) => setMeritClassFilter(e.target.value)}
                className="px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg"
              >
                <option value="ALL">All Classes ({meritList.length})</option>
                {CLASSES.map((c) => (
                  <option key={c} value={c}>
                    Class {c}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={meritSearch}
                onChange={(e) => setMeritSearch(e.target.value)}
                placeholder="Search candidate, ID, roll..."
                className="px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg w-52"
              />
              <button
                type="button"
                disabled={meritVisibilityBusy}
                onClick={handleToggleMeritVisibility}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  config.publishMeritList
                    ? 'bg-amber-600 text-white hover:bg-amber-700'
                    : 'bg-[#0B3C75] text-white hover:bg-[#144D8A]'
                }`}
              >
                {config.publishMeritList ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    Hide Public List
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    Publish Merit List
                  </>
                )}
              </button>
            </div>
          </div>

          {filteredMeritList.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              No non-denied applicants available to rank yet. Submit applications or enter Officer
              Evaluation Marks in Tab 1 to build the Merit List automatically.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#EEF3F9] border-b border-slate-200 text-xs font-semibold text-[#0B3C75]">
                    <th className="py-3 px-4">Class Rank</th>
                    <th className="py-3 px-4">Application ID</th>
                    <th className="py-3 px-4">Candidate Name</th>
                    <th className="py-3 px-4">Class &amp; Stream</th>
                    <th className="py-3 px-4 text-right">Officer Marks (/100)</th>
                    <th className="py-3 px-4 text-right">Prev %</th>
                    <th className="py-3 px-4">Seat Quota</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Roll / Sec</th>
                    <th className="py-3 px-4 text-right">Quick Decision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 tabular-nums">
                  {filteredMeritList.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono font-bold text-[#0B3C75]">
                        #{m.rank}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                        {m.applicationCode}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">{m.studentName}</td>
                      <td className="py-3 px-4 text-xs sm:text-sm text-slate-700">
                        Class {m.classApplied}
                        {m.streamApplied ? ` · ${m.streamApplied}` : ''}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900">
                        {m.entranceMarks !== null && m.entranceMarks !== undefined
                          ? m.entranceMarks
                          : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-600">
                        {m.previousPercentage ? `${m.previousPercentage}%` : '—'}
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold whitespace-nowrap">
                        {m.withinQuota ? (
                          <span className="text-emerald-700">
                            Within Seats (#{m.rank}/{m.seatQuota})
                          </span>
                        ) : (
                          <span className="text-amber-700">
                            Waitlist Queue (#{m.rank}/{m.seatQuota})
                          </span>
                        )}
                      </td>
                      <td className={`py-3 px-4 text-xs font-semibold ${statusColorClass(m.status)}`}>
                        {m.status}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs">
                        {m.rollNumber ? (
                          <span className="font-bold text-emerald-800">
                            {m.rollNumber} ({m.allottedSection || 'A'})
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleViewApplication(m.id)}
                            className="px-2.5 py-1 border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            Dossier
                          </button>
                          {m.status !== 'Approved' && m.status !== 'Denied' && (
                            <>
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() =>
                                  handleApproveApplication({ id: m.id, studentName: m.studentName })
                                }
                                className="px-2.5 py-1 bg-emerald-700 text-white rounded text-xs font-semibold hover:bg-emerald-800 cursor-pointer disabled:opacity-60"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => {
                                  const fullApp = applications.find((a) => a.id === m.id);
                                  if (fullApp) {
                                    setDenyingApp(fullApp);
                                    setDenyReason('');
                                  }
                                }}
                                className="px-2.5 py-1 bg-red-700 text-white rounded text-xs font-semibold hover:bg-red-800 cursor-pointer disabled:opacity-60"
                              >
                                Deny
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PRINTABLE APPLICATION DOSSIER & OFFICER ACTION MODAL */}
      {viewingApp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="print-sheet bg-white border border-slate-200 rounded-xl max-w-3xl w-full p-6 sm:p-8 space-y-6 my-8">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                <img
                  src={crestEmblemImg}
                  alt="Moreden of Education International School Seal"
                  className="w-12 h-12 object-contain"
                />
                <div>
                  <p className="text-xs font-semibold text-[#0B3C75]">
                    Moreden of Education International School
                  </p>
                  <h3 className="font-display text-2xl font-semibold text-slate-900">
                    Admission Application Dossier
                  </h3>
                  <p className="text-xs font-mono text-slate-500">
                    {viewingApp.applicationCode} · Submitted{' '}
                    {new Date(viewingApp.createdAt).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>

              <div className="no-print flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3.5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Dossier
                </button>
                <button
                  type="button"
                  onClick={() => setViewingApp(null)}
                  className="p-2 text-slate-500 hover:text-slate-900 cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
              <div className="sm:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Student&apos;s Full Name</p>
                  <p className="font-semibold text-slate-900">{viewingApp.studentName}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Class &amp; Stream</p>
                  <p className="font-semibold text-slate-900">
                    Class {viewingApp.classApplied}
                    {viewingApp.streamApplied ? ` · ${viewingApp.streamApplied}` : ''}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Father&apos;s Name</p>
                  <p className="font-medium text-slate-900">{viewingApp.fatherName}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Mother&apos;s Name</p>
                  <p className="font-medium text-slate-900">{viewingApp.motherName}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Date of Birth</p>
                  <p className="font-mono tabular-nums text-slate-900">{viewingApp.dob}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Gender</p>
                  <p className="text-slate-900">{viewingApp.gender}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Contact Phone</p>
                  <p className="font-mono text-slate-900">{viewingApp.contactPhone}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Contact Email</p>
                  <p className="text-slate-900">{viewingApp.contactEmail || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Previous School</p>
                  <p className="text-slate-900">{viewingApp.previousSchool || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Previous % / TC Number</p>
                  <p className="font-mono text-slate-900">
                    {viewingApp.previousPercentage ? `${viewingApp.previousPercentage}%` : '—'} ·{' '}
                    {viewingApp.tcNumber || 'No TC'}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-slate-500">Residential Address</p>
                  <p className="text-slate-900">{viewingApp.address}</p>
                </div>
              </div>

              <div className="flex flex-col items-center space-y-2">
                <img
                  src={viewingApp.photoUrl}
                  alt={viewingApp.studentName}
                  referrerPolicy="no-referrer"
                  className="w-36 h-44 object-cover rounded-lg border border-slate-300"
                />
                <p className="text-[11px] text-slate-500">Student Photograph</p>
                {viewingApp.hasDocument && (
                  <button
                    type="button"
                    onClick={() => handleDownloadSupportingDoc(viewingApp)}
                    className="no-print w-full px-2.5 py-1.5 border border-[#0B3C75]/40 text-[#0B3C75] bg-[#EEF3F9] rounded-lg text-[11px] font-semibold hover:bg-[#E1EAF5] inline-flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Supporting Doc
                  </button>
                )}
              </div>
            </div>

            {/* Nodal Officer Decision & Allotment Controls */}
            <div className="border-t border-slate-200 pt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p>
                  <span className="text-slate-500">Current Registry Status: </span>
                  <strong className={statusColorClass(viewingApp.status)}>
                    {viewingApp.status}
                  </strong>
                  {viewingApp.rollNumber && (
                    <span className="ml-3 font-mono font-bold text-slate-900">
                      · Roll No: {viewingApp.rollNumber} (Section{' '}
                      {viewingApp.allottedSection || 'A'})
                    </span>
                  )}
                  {viewingApp.enrolledStudentId && (
                    <span className="ml-2 font-mono text-xs text-emerald-800">
                      · Roster ID: {viewingApp.enrolledStudentId}
                    </span>
                  )}
                </p>
              </div>

              {viewingApp.denialReason && (
                <p className="text-xs text-red-700">Denial Reason: {viewingApp.denialReason}</p>
              )}

              {viewingApp.status !== 'Approved' && viewingApp.status !== 'Denied' && (
                <div className="no-print p-4 rounded-xl border border-slate-200 bg-[#F4F6F9] space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Evaluation Marks (0–100)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.5"
                          value={dossierMarks}
                          onChange={(e) => setDossierMarks(e.target.value)}
                          placeholder="0–100"
                          className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                        />
                        <button
                          type="button"
                          disabled={savingMarksId === viewingApp.id}
                          onClick={() => void handleSaveMarks(viewingApp.id, dossierMarks)}
                          className="px-3 py-2 bg-[#0B3C75] text-white text-xs font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer whitespace-nowrap disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Allot Section (if Approved)
                      </label>
                      <select
                        value={allottedSection}
                        onChange={(e) => setAllottedSection(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      >
                        {getSectionsForClass(viewingApp.classApplied).map((sec) => (
                          <option key={sec} value={sec}>
                            Section {sec}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Nodal Officer Remarks (visible to applicant)
                      </label>
                      <input
                        type="text"
                        value={officerNotes}
                        onChange={(e) => setOfficerNotes(e.target.value)}
                        placeholder="e.g. Report for document check / Upload clearer marksheet..."
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoEnroll}
                      onChange={(e) => setAutoEnroll(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-[#0B3C75]"
                    />
                    <span>
                      Auto-enroll student directly into Class {viewingApp.classApplied}-{allottedSection}{' '}
                      Student Register on Approval
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() =>
                        handleApproveApplication(viewingApp, {
                          section: allottedSection,
                          notes: officerNotes,
                          autoEnrollFlag: autoEnroll,
                          entranceMarks: dossierMarks,
                        })
                      }
                      className="px-4 py-2 bg-emerald-700 text-white text-xs font-semibold rounded-lg hover:bg-emerald-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve &amp; Assign Roll No.
                    </button>

                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() =>
                        handleReviewStatus(
                          viewingApp,
                          'Waitlisted',
                          officerNotes || 'Placed on Nodal Officer merit waitlist.'
                        )
                      }
                      className="px-3.5 py-2 bg-[#0B3C75] text-white text-xs font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer disabled:opacity-60"
                    >
                      Move to Waitlist
                    </button>

                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() =>
                        handleReviewStatus(
                          viewingApp,
                          'Correction Needed',
                          officerNotes ||
                            'Please review submitted particulars or upload supporting proof.'
                        )
                      }
                      className="px-3.5 py-2 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Request Correction
                    </button>

                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => {
                        setDenyingApp(viewingApp);
                        setDenyReason(officerNotes);
                      }}
                      className="px-3.5 py-2 bg-red-700 text-white text-xs font-semibold rounded-lg hover:bg-red-800 cursor-pointer disabled:opacity-60"
                    >
                      Deny Application
                    </button>
                  </div>
                </div>
              )}

              {viewingApp.status === 'Denied' && (
                <div className="no-print flex justify-end">
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() =>
                      handleReviewStatus(viewingApp, 'Pending', 'Reopened by Nodal Officer')
                    }
                    className="px-4 py-2 bg-[#0B3C75] text-white text-xs font-semibold rounded-lg hover:bg-[#144D8A] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reopen Application to Pending
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DENY CONFIRMATION MODAL */}
      {denyingApp && (
        <div className="no-print fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmDeny}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4"
          >
            <h3 className="font-display text-xl font-semibold text-slate-900">
              Confirm Deny Application
            </h3>
            <p className="text-sm text-slate-600">
              Deny application for <strong>{denyingApp.studentName}</strong> (
              {denyingApp.applicationCode})? Denied applications do not receive a roll number (can
              still be reopened later if needed).
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reason for Denial (Visible to Applicant)
              </label>
              <textarea
                rows={3}
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                placeholder="Enter clear reason for denying this application..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDenyingApp(null)}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="px-4 py-2 bg-red-700 text-white text-xs font-semibold rounded-lg hover:bg-red-800 cursor-pointer"
              >
                Confirm Deny
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
