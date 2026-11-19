import { useCallback, useEffect, useState } from 'react';
import { Award, BookOpen, CalendarCheck, RefreshCw, Search } from 'lucide-react';
import { apiFetch, useAutoRefresh } from '../lib/api.ts';
import {
  CLASSES,
  type ClassName,
  type MarkingSchemeItem,
  getSectionsForClass,
  normalizeAcademicSession,
  normalizeStudentId,
} from '../shared/schoolRules.ts';
import { AcademicsView } from './AcademicsView.tsx';
import {
  type OfficialResultAssessmentCol,
  OfficialResultSheet,
  type OfficialResultSubjectRow,
} from './OfficialResultSheet.tsx';
import { StudentAttendanceLookup } from './StudentAttendanceLookup.tsx';

const CLASSES_IV_TO_IX: ClassName[] = ['IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const CLASSES_X_TO_XII: ClassName[] = ['X', 'XI', 'XII'];
const PRESET_SESSIONS = ['2027–2028', '2026–2027', '2025–2026', '2024–2025', '2023–2024'];

interface StudentResultPayload {
  published: boolean;
  publicationScope?: 'full' | 'partial';
  academicSession?: string;
  message?: string;
  publishedAt?: string | null;
  student?: {
    studentId: string;
    rollNumber: string;
    boardNo: string | null;
    name: string;
    className: ClassName;
    section: string;
  };
  attendance?: {
    total: number;
    present: number;
    absent: number;
    leave: number;
    percentage: number | null;
  };
  schemes?: OfficialResultAssessmentCol[];
  pendingAssessments?: Array<{ id: number; assessmentName: string; maxMarks: number }>;
  subjectResults?: OfficialResultSubjectRow[];
  summary?: {
    grandObtained: number;
    grandMax: number;
    percentage: number;
    overallGrade: string;
    overallGradePoint: string;
    overallRemark: string;
    overallStatus: string;
    compartmentSubjects?: string[];
  };
}

interface MarkingSchemeLookupPayload {
  className: ClassName;
  subjects: string[];
  isPublished: boolean;
  anyPublished?: boolean;
  publishedAt: string | null;
  schemes: MarkingSchemeItem[];
}

interface StudentDashboardViewProps {
  academicSession?: string;
}

export function StudentDashboardView({
  academicSession = '2026–2027',
}: StudentDashboardViewProps) {
  const sessionOptions = Array.from(
    new Map(
      [academicSession, ...PRESET_SESSIONS]
        .filter(Boolean)
        .map((s) => [normalizeAcademicSession(s), s])
    ).values()
  );

  const [selectedClass, setSelectedClass] = useState<ClassName>('IV');
  const [selectedSection, setSelectedSection] = useState<string>('A');
  const [activeTab, setActiveTab] = useState<'results' | 'attendance' | 'academics'>('results');

  // Exam Results 3-Option Selector
  const [resultOption, setResultOption] = useState<'iv-ix' | 'x-xii' | 'scheme'>('iv-ix');

  // Form states for IV-IX
  const [ivSession, setIvSession] = useState(academicSession);
  const [ivStudentId, setIvStudentId] = useState('');
  const [ivClass, setIvClass] = useState<ClassName>('IV');
  const [ivSection, setIvSection] = useState('A');

  // Form states for X-XII
  const [xSession, setXSession] = useState(academicSession);
  const [xBoardNo, setXBoardNo] = useState('');
  const [xStudentId, setXStudentId] = useState('');
  const [xClass, setXClass] = useState<ClassName>('X');
  const [xSection, setXSection] = useState('A');

  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultData, setResultData] = useState<StudentResultPayload | null>(null);
  const [lastResultQuery, setLastResultQuery] = useState<string | null>(null);

  // Marking scheme preview
  const [schemeData, setSchemeData] = useState<MarkingSchemeLookupPayload | null>(null);
  const [schemeLoading, setSchemeLoading] = useState(false);

  useEffect(() => {
    setIvSession(academicSession);
    setXSession(academicSession);
  }, [academicSession]);

  const dashboardSections = getSectionsForClass(selectedClass);
  const ivSections = getSectionsForClass(ivClass);
  const xSections = getSectionsForClass(xClass);

  useEffect(() => {
    if (!dashboardSections.includes(selectedSection)) {
      setSelectedSection('A');
    }
  }, [selectedClass, dashboardSections, selectedSection]);

  useEffect(() => {
    if (!ivSections.includes(ivSection)) setIvSection('A');
  }, [ivClass, ivSections, ivSection]);

  useEffect(() => {
    if (!xSections.includes(xSection)) setXSection('A');
  }, [xClass, xSections, xSection]);

  const loadScheme = useCallback(
    async (silent = false) => {
      if (!silent) setSchemeLoading(true);
      try {
        const res = await apiFetch<MarkingSchemeLookupPayload>(
          `/api/student/marking-scheme?className=${encodeURIComponent(selectedClass)}&section=${encodeURIComponent(selectedSection)}`
        );
        setSchemeData(res);
      } catch {
        if (!silent) setSchemeData(null);
      } finally {
        if (!silent) setSchemeLoading(false);
      }
    },
    [selectedClass, selectedSection]
  );

  useEffect(() => {
    if (activeTab === 'results' && resultOption === 'scheme') {
      void loadScheme(false);
    }
  }, [activeTab, resultOption, loadScheme]);

  const refreshActiveResult = useCallback(async () => {
    if (!lastResultQuery) return;
    try {
      const res = await apiFetch<StudentResultPayload>(`/api/student/results?${lastResultQuery}`);
      setResultData(res);
      setResultError(null);
    } catch {
      // keep existing display during transient background poll error
    }
  }, [lastResultQuery]);

  useAutoRefresh(
    () => {
      if (activeTab !== 'results') return;
      if (resultOption === 'scheme') {
        void loadScheme(true);
      } else if (lastResultQuery) {
        void refreshActiveResult();
      }
    },
    activeTab === 'results' && (resultOption === 'scheme' || Boolean(lastResultQuery)),
    15000
  );

  const handleFetchResults = async (mode: 'iv-ix' | 'x-xii', e: React.FormEvent) => {
    e.preventDefault();
    setResultError(null);
    setResultData(null);

    const cleanedStudentId =
      mode === 'iv-ix' ? normalizeStudentId(ivStudentId) : normalizeStudentId(xStudentId);
    const cleanedBoardNo = normalizeStudentId(xBoardNo);

    if (!cleanedStudentId) {
      setResultError('Please enter a valid Student ID.');
      return;
    }

    setResultLoading(true);
    try {
      const params =
        mode === 'iv-ix'
          ? new URLSearchParams({
              academicSession: ivSession,
              studentId: cleanedStudentId,
              className: ivClass,
              section: ivSection,
            })
          : new URLSearchParams({
              academicSession: xSession,
              boardNo: cleanedBoardNo,
              studentId: cleanedStudentId,
              className: xClass,
              section: xSection,
            });

      const qs = params.toString();
      setLastResultQuery(qs);
      const res = await apiFetch<StudentResultPayload>(`/api/student/results?${qs}`);
      setResultData(res);
    } catch (err) {
      setLastResultQuery(null);
      setResultError((err as Error).message);
    } finally {
      setResultLoading(false);
    }
  };

  const schemePubSummary = (() => {
    if (!schemeData) return '';
    if (schemeData.isPublished) return 'Results Status: Whole Class Published by Administrator';
    const pubCount = schemeData.schemes.filter((s) => s.isPublished).length;
    if (pubCount > 0) {
      return `Results Status: ${pubCount} of ${schemeData.schemes.length} Assessments Published`;
    }
    return 'Results Status: Not Published Yet';
  })();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-7">
      {/* Header + Class/Section Context Selector */}
      <div className="no-print bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-6 py-4 bg-[#082D59] text-white border-b-2 border-[#D97706] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              Controller of Examinations &amp; Student Services
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold mt-0.5">
              Student Results &amp; Academic Dashboard
            </h1>
          </div>
          <span className="text-xs font-mono text-blue-100 whitespace-nowrap">
            MoE Official Examination Portal
          </span>
        </div>

        <div className="p-5 bg-slate-50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <p className="text-xs sm:text-sm text-slate-600">
            Select your Class (IV–XII) and Section (A–K for IV–X, A–R for XI–XII) to inspect
            published Examination Results, Attendance records, and Question Papers.
          </p>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Class</label>
              <select
                value={selectedClass}
                onChange={(e) => {
                  const cls = e.target.value as ClassName;
                  setSelectedClass(cls);
                  if (CLASSES_IV_TO_IX.includes(cls)) setIvClass(cls);
                  if (CLASSES_X_TO_XII.includes(cls)) setXClass(cls);
                }}
                className="px-3 py-2 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
              >
                {CLASSES.map((c) => (
                  <option key={c} value={c}>
                    Class {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Section</label>
              <select
                value={selectedSection}
                onChange={(e) => {
                  setSelectedSection(e.target.value);
                  setIvSection(e.target.value);
                  setXSection(e.target.value);
                }}
                className="px-3 py-2 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
              >
                {dashboardSections.map((s) => (
                  <option key={s} value={s}>
                    Section {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Dashboard Tabs */}
      <div className="no-print flex flex-wrap items-center gap-1 p-1 bg-[#E4ECF5] rounded-md w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('results')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded inline-flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            activeTab === 'results'
              ? 'bg-[#082D59] text-white shadow-xs'
              : 'text-[#082D59] hover:bg-white/60'
          }`}
        >
          <Award className="w-4 h-4" />
          Exam Results
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('attendance')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded inline-flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            activeTab === 'attendance'
              ? 'bg-[#082D59] text-white shadow-xs'
              : 'text-[#082D59] hover:bg-white/60'
          }`}
        >
          <CalendarCheck className="w-4 h-4" />
          Attendance Dashboard
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('academics')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded inline-flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            activeTab === 'academics'
              ? 'bg-[#082D59] text-white shadow-xs'
              : 'text-[#082D59] hover:bg-white/60'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          Academics (Question Papers)
        </button>
      </div>

      {activeTab === 'results' && (
        <div className="space-y-6">
          {/* First 3 Options for Exam Results */}
          <div className="no-print grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => {
                setResultOption('iv-ix');
                setResultData(null);
                setResultError(null);
                setLastResultQuery(null);
              }}
              className={`text-left p-5 rounded-md border transition-colors cursor-pointer ${
                resultOption === 'iv-ix'
                  ? 'bg-[#082D59] text-white border-[#082D59]'
                  : 'bg-white text-slate-900 border-slate-200 hover:border-[#082D59]/60'
              }`}
            >
              <p
                className={`text-xs font-mono ${
                  resultOption === 'iv-ix' ? 'text-amber-300' : 'text-[#8B1E24]'
                }`}
              >
                Option 01
              </p>
              <p className="text-base font-semibold mt-1">Result for Grades IV to IX</p>
              <p
                className={`text-xs mt-1 ${
                  resultOption === 'iv-ix' ? 'text-blue-100' : 'text-slate-600'
                }`}
              >
                Select Academic Session, Student ID, Class (IV–IX), and Section (A–K).
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setResultOption('x-xii');
                setResultData(null);
                setResultError(null);
                setLastResultQuery(null);
              }}
              className={`text-left p-5 rounded-md border transition-colors cursor-pointer ${
                resultOption === 'x-xii'
                  ? 'bg-[#082D59] text-white border-[#082D59]'
                  : 'bg-white text-slate-900 border-slate-200 hover:border-[#082D59]/60'
              }`}
            >
              <p
                className={`text-xs font-mono ${
                  resultOption === 'x-xii' ? 'text-amber-300' : 'text-[#8B1E24]'
                }`}
              >
                Option 02
              </p>
              <p className="text-base font-semibold mt-1">Result for Grades X to XII</p>
              <p
                className={`text-xs mt-1 ${
                  resultOption === 'x-xii' ? 'text-blue-100' : 'text-slate-600'
                }`}
              >
                Select Academic Session, Board No., Student ID, Class (X–XII), and Section.
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setResultOption('scheme');
                setResultData(null);
                setResultError(null);
                setLastResultQuery(null);
              }}
              className={`text-left p-5 rounded-md border transition-colors cursor-pointer ${
                resultOption === 'scheme'
                  ? 'bg-[#082D59] text-white border-[#082D59]'
                  : 'bg-white text-slate-900 border-slate-200 hover:border-[#082D59]/60'
              }`}
            >
              <p
                className={`text-xs font-mono ${
                  resultOption === 'scheme' ? 'text-amber-300' : 'text-[#8B1E24]'
                }`}
              >
                Option 03
              </p>
              <p className="text-base font-semibold mt-1">Marking Scheme &amp; Status</p>
              <p
                className={`text-xs mt-1 ${
                  resultOption === 'scheme' ? 'text-blue-100' : 'text-slate-600'
                }`}
              >
                View assessment max/passing marks and result publication status.
              </p>
            </button>
          </div>

          {/* Option 1 Form: Grades IV to IX */}
          {resultOption === 'iv-ix' && (
            <form
              onSubmit={(e) => handleFetchResults('iv-ix', e)}
              className="no-print bg-white border border-slate-200 rounded-md p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Academic Session *
                </label>
                <select
                  value={ivSession}
                  onChange={(e) => setIvSession(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                >
                  {sessionOptions.map((sess) => (
                    <option key={sess} value={sess}>
                      {sess}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Student ID *
                </label>
                <input
                  type="text"
                  required
                  value={ivStudentId}
                  onChange={(e) => setIvStudentId(normalizeStudentId(e.target.value))}
                  placeholder="Enter Student ID"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Class (IV to IX) *
                </label>
                <select
                  value={ivClass}
                  onChange={(e) => setIvClass(e.target.value as ClassName)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                >
                  {CLASSES_IV_TO_IX.map((c) => (
                    <option key={c} value={c}>
                      Class {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Section (A to K) *
                </label>
                <select
                  value={ivSection}
                  onChange={(e) => setIvSection(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                >
                  {ivSections.map((s) => (
                    <option key={s} value={s}>
                      Section {s}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={resultLoading}
                className="px-4 py-2 bg-[#082D59] text-white text-sm font-semibold rounded hover:bg-[#0B3C75] inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Search className="w-4 h-4" />
                {resultLoading ? 'Fetching...' : 'Get Result'}
              </button>
            </form>
          )}

          {/* Option 2 Form: Grades X to XII */}
          {resultOption === 'x-xii' && (
            <form
              onSubmit={(e) => handleFetchResults('x-xii', e)}
              className="no-print bg-white border border-slate-200 rounded-md p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Academic Session *
                </label>
                <select
                  value={xSession}
                  onChange={(e) => setXSession(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                >
                  {sessionOptions.map((sess) => (
                    <option key={sess} value={sess}>
                      {sess}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Board No. *
                </label>
                <input
                  type="text"
                  required
                  value={xBoardNo}
                  onChange={(e) => setXBoardNo(normalizeStudentId(e.target.value))}
                  placeholder="Enter Board No."
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Student ID *
                </label>
                <input
                  type="text"
                  required
                  value={xStudentId}
                  onChange={(e) => setXStudentId(normalizeStudentId(e.target.value))}
                  placeholder="Enter Student ID"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Class (X to XII) *
                </label>
                <select
                  value={xClass}
                  onChange={(e) => setXClass(e.target.value as ClassName)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                >
                  {CLASSES_X_TO_XII.map((c) => (
                    <option key={c} value={c}>
                      Class {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Section ({xClass === 'X' ? 'A to K' : 'A to R'}) *
                </label>
                <select
                  value={xSection}
                  onChange={(e) => setXSection(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                >
                  {xSections.map((s) => (
                    <option key={s} value={s}>
                      Section {s}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={resultLoading}
                className="px-4 py-2 bg-[#082D59] text-white text-sm font-semibold rounded hover:bg-[#0B3C75] inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Search className="w-4 h-4" />
                {resultLoading ? 'Fetching...' : 'Get Result'}
              </button>
            </form>
          )}

          {/* Option 3: Marking Scheme Overview */}
          {resultOption === 'scheme' && (
            <div className="bg-white border border-slate-200 rounded-md p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-xl font-semibold text-slate-900">
                    Marking Scheme — Class {selectedClass} (Section {selectedSection})
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configured by the School Administrator.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {schemeData && (
                    <span
                      className={`text-xs font-semibold ${
                        schemeData.isPublished || schemeData.anyPublished
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {schemePubSummary}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => loadScheme(false)}
                    className="px-2.5 py-1 border border-slate-300 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Refresh
                  </button>
                </div>
              </div>

              {schemeLoading ? (
                <p className="text-sm text-slate-500">Loading marking scheme...</p>
              ) : !schemeData || schemeData.schemes.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No assessment marking scheme has been configured for Class {selectedClass} yet.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">Subjects: </span>
                    {schemeData.subjects.join(' · ')}
                  </div>
                  <div className="overflow-x-auto border border-slate-200 rounded-md">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-[#EEF3F9] border-b border-slate-200 text-xs font-semibold text-[#082D59]">
                          <th className="py-2.5 px-4">Assessment Name</th>
                          <th className="py-2.5 px-4 text-right">Maximum Marks</th>
                          <th className="py-2.5 px-4 text-right">Passing Marks</th>
                          <th className="py-2.5 px-4 text-right">Student Result Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 tabular-nums">
                        {schemeData.schemes.map((s) => (
                          <tr key={s.id}>
                            <td className="py-2.5 px-4 font-medium text-slate-900">
                              {s.assessmentName}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono">{s.maxMarks}</td>
                            <td className="py-2.5 px-4 text-right font-mono">{s.passingMarks}</td>
                            <td className="py-2.5 px-4 text-right text-xs font-semibold">
                              {s.isPublished ? (
                                <span className="text-emerald-700">
                                  Published — View in Option 01/02
                                </span>
                              ) : (
                                <span className="text-amber-700">Pending Publication</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {resultError && (
            <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
              {resultError}
            </div>
          )}

          {resultData && !resultData.published && (
            <div className="p-6 rounded-md border border-amber-200 bg-amber-50 text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">Examination Results Pending Publication</p>
                <p className="text-xs text-amber-800 mt-1">{resultData.message}</p>
              </div>
              <button
                type="button"
                onClick={() => refreshActiveResult()}
                className="px-3.5 py-1.5 border border-amber-300 bg-white text-amber-900 text-xs font-semibold rounded hover:bg-amber-100 inline-flex items-center gap-1.5 cursor-pointer self-start sm:self-center"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Check Again
              </button>
            </div>
          )}

          {resultData &&
            resultData.published &&
            resultData.student &&
            resultData.subjectResults &&
            resultData.summary && (
              <OfficialResultSheet
                academicSession={resultData.academicSession}
                publicationScope={resultData.publicationScope || 'full'}
                publishedAt={resultData.publishedAt}
                student={resultData.student}
                attendance={resultData.attendance}
                schemes={resultData.schemes || []}
                pendingAssessments={resultData.pendingAssessments || []}
                subjectResults={resultData.subjectResults}
                summary={resultData.summary}
              />
            )}
        </div>
      )}

      {activeTab === 'attendance' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-md p-5">
            <h2 className="font-display text-xl font-semibold text-[#082D59]">
              Student Attendance Dashboard
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Enter your Student ID, Class, and Section to view your official attendance records.
            </p>
          </div>
          <StudentAttendanceLookup defaultClass={selectedClass} defaultSection={selectedSection} />
        </div>
      )}

      {activeTab === 'academics' && (
        <AcademicsView initialClass={selectedClass} initialSection={selectedSection} embedded />
      )}
    </div>
  );
}
