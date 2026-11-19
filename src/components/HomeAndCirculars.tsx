import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Award,
  BookOpen,
  Clock,
  Download,
  FileText,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  Mail,
} from 'lucide-react';
import { apiFetch, downloadPdfFile, useAutoRefresh } from '../lib/api.ts';
import { crestEmblemImg } from '../assets/schoolImages.ts';
import type { AdmissionConfig, CircularItem } from '../shared/schoolRules.ts';
import type { ActivePage } from './TopNav.tsx';

interface HomeViewProps {
  onNavigate: (page: ActivePage) => void;
  admissionsEnabled: boolean;
  admissionConfig?: AdmissionConfig | null;
  academicSession?: string;
}

function isRecentCircular(createdAt: string): boolean {
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= 14 * 24 * 60 * 60 * 1000;
}

export function HomeView({
  onNavigate,
  admissionsEnabled,
  admissionConfig,
  academicSession = '2026–2027',
}: HomeViewProps) {
  const activeSession = admissionConfig?.academicSession || academicSession || '2026–2027';
  const openClasses = Array.isArray(admissionConfig?.openClasses) ? admissionConfig.openClasses : [];
  const openClassCount = openClasses.length;
  const meritPublished = Boolean(admissionConfig?.publishMeritList);

  const [circulars, setCirculars] = useState<CircularItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [noticeTab, setNoticeTab] = useState<'all' | 'pdf'>('all');
  const [tickerPaused, setTickerPaused] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [fontScale, setFontScale] = useState<'sm' | 'md' | 'lg'>('md');

  const applyFontScale = (scale: 'sm' | 'md' | 'lg') => {
    setFontScale(scale);
    if (typeof document !== 'undefined') {
      document.documentElement.style.fontSize =
        scale === 'sm' ? '92%' : scale === 'lg' ? '108%' : '100%';
    }
  };

  const loadCirculars = useCallback(async (isInitial = false) => {
    try {
      const res = await apiFetch<{ circulars: CircularItem[] }>('/api/circulars');
      setCirculars(Array.isArray(res.circulars) ? res.circulars : []);
    } catch {
      if (isInitial) setCirculars([]);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCirculars(true);
  }, [loadCirculars]);

  useAutoRefresh(() => loadCirculars(false), true, 15000);

  const handleDownload = async (c: CircularItem) => {
    setDownloadError(null);
    try {
      await downloadPdfFile(
        `/api/circulars/${c.id}/download`,
        c.originalFilename || `Circular_${c.circularNumber}.pdf`
      );
    } catch (err) {
      setDownloadError((err as Error).message);
    }
  };

  const visibleNotices = (
    noticeTab === 'pdf' ? circulars.filter((c) => c.hasPdf) : circulars
  ).slice(0, 8);

  const tickerItems = circulars.slice(0, 6);

  return (
    <div className="space-y-10 pb-16">
      {/* 0. Official Accessibility & Text-Size Strip */}
      <section className="bg-white border-b border-slate-200">
        <div className="bg-[#062142] text-blue-100 text-[11px] border-b border-[#0B3C75]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <a
                href="#moe-main-gateways"
                className="hover:text-white underline-offset-2 hover:underline whitespace-nowrap"
              >
                Skip to Main Content
              </a>
              <span aria-hidden="true" className="text-blue-400/50">|</span>
              <span className="truncate hidden sm:inline">
                Official Portal · Moreden of Education International School
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-blue-200/80 hidden sm:inline">Text Size:</span>
              <button
                type="button"
                onClick={() => applyFontScale('sm')}
                aria-label="Decrease text size"
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  fontScale === 'sm' ? 'bg-white text-[#062142] font-bold' : 'hover:bg-white/10'
                }`}
              >
                A-
              </button>
              <button
                type="button"
                onClick={() => applyFontScale('md')}
                aria-label="Default text size"
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  fontScale === 'md' ? 'bg-white text-[#062142] font-bold' : 'hover:bg-white/10'
                }`}
              >
                A
              </button>
              <button
                type="button"
                onClick={() => applyFontScale('lg')}
                aria-label="Increase text size"
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  fontScale === 'lg' ? 'bg-white text-[#062142] font-bold' : 'hover:bg-white/10'
                }`}
              >
                A+
              </button>
            </div>
          </div>
        </div>

        {/* 1. Institutional Masthead Band (Formal Seal & Operational Stats) */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <img
                src={crestEmblemImg}
                alt="Moreden of Education International School Official Seal"
                referrerPolicy="no-referrer"
                className="w-16 h-16 sm:w-20 sm:h-20 object-contain shrink-0 border border-slate-200 rounded p-1 bg-white"
              />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#8B1E24]">
                  Official Academic &amp; Examination Portal
                </p>
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#082D59] text-balance mt-0.5">
                  Moreden of Education International School
                </h1>
                <p className="text-xs sm:text-sm text-slate-600 mt-1">
                  Committed to Equity, Discipline &amp; Academic Excellence · Classes IV to XII ·
                  Session{' '}
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {activeSession}
                  </span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6 sm:gap-8 border-t lg:border-t-0 lg:border-l border-slate-200 pt-4 lg:pt-0 lg:pl-8 text-xs shrink-0">
              <div>
                <p className="text-slate-500 font-medium">Academic Wings</p>
                <p className="font-mono font-semibold text-sm text-[#082D59] tabular-nums mt-0.5">
                  IV – XII
                </p>
              </div>
              <div>
                <p className="text-slate-500 font-medium">Admissions</p>
                <p
                  className={`font-semibold text-sm mt-0.5 ${
                    admissionsEnabled && openClassCount > 0 ? 'text-[#0F6B48]' : 'text-slate-700'
                  }`}
                >
                  {admissionsEnabled && openClassCount > 0 ? `Open (${openClassCount})` : 'Closed'}
                </p>
              </div>
              <div>
                <p className="text-slate-500 font-medium">Circulars</p>
                <p className="font-mono font-semibold text-sm text-[#082D59] tabular-nums mt-0.5">
                  {circulars.length} Issued
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Live Notice Ticker Ribbon */}
        <div className="bg-[#0B3C75] text-white border-t border-[#144D8A]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-10 flex items-center gap-4">
            <span className="px-2.5 py-1 bg-[#8B1E24] text-white text-[11px] font-bold uppercase tracking-wider rounded-sm shrink-0">
              In Focus
            </span>

            <div className="flex-1 overflow-hidden relative">
              {tickerItems.length === 0 ? (
                <p className="text-xs text-blue-100 truncate">
                  Academic Session {activeSession} · Official circulars, examination schedules, and
                  admissions notices appear here in real time.
                </p>
              ) : (
                <div
                  className="moe-ticker-track items-center gap-8 text-xs"
                  data-paused={tickerPaused ? 'true' : 'false'}
                >
                  {[...tickerItems, ...tickerItems].map((item, idx) => (
                    <button
                      key={`${item.id}-${idx}`}
                      type="button"
                      onClick={() => (item.hasPdf ? handleDownload(item) : onNavigate('circulars'))}
                      className="inline-flex items-center gap-2 text-blue-50 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <span className="font-mono font-semibold text-amber-300 tabular-nums">
                        [{item.circularNumber}]
                      </span>
                      <span>{item.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {tickerItems.length > 0 && (
              <button
                type="button"
                onClick={() => setTickerPaused((prev) => !prev)}
                aria-label={tickerPaused ? 'Resume notice ticker' : 'Pause notice ticker'}
                className="p-1.5 text-blue-100 hover:text-white rounded border border-white/20 hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              >
                {tickerPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 2. Institutional Portals & Dashboards */}
      <section id="moe-main-gateways" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-xl font-bold text-[#082D59]">
              Institutional Portals &amp; Dashboards
            </h2>
            <p className="text-xs text-slate-500 hidden sm:block">
              Select a portal to access live records, results, or MIS dashboards
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <button
              type="button"
              onClick={() => onNavigate('circulars')}
              className="group text-left bg-white border border-slate-200 rounded-md overflow-hidden hover:border-[#8B1E24] hover:-translate-y-0.5 transition-all duration-150 cursor-pointer flex flex-col"
            >
              <div className="px-4 py-3 bg-[#8B1E24] text-white flex items-center justify-between">
                <span className="text-sm font-semibold">Circulars &amp; Notices</span>
                <FileText className="w-4 h-4 opacity-90 shrink-0" />
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Official administrative circulars, examination schedules, and verified PDF
                  downloads.
                </p>
                <span className="text-xs font-semibold text-[#8B1E24] inline-flex items-center gap-1.5 group-hover:underline">
                  Open Circular Board
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('academics')}
              className="group text-left bg-white border border-slate-200 rounded-md overflow-hidden hover:border-[#0B3C75] hover:-translate-y-0.5 transition-all duration-150 cursor-pointer flex flex-col"
            >
              <div className="px-4 py-3 bg-[#0B3C75] text-white flex items-center justify-between">
                <span className="text-sm font-semibold">Academic Portal</span>
                <BookOpen className="w-4 h-4 opacity-90 shrink-0" />
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Class IV–XII subject curricula, section frameworks (A–K / A–R), and question
                  papers.
                </p>
                <span className="text-xs font-semibold text-[#0B3C75] inline-flex items-center gap-1.5 group-hover:underline">
                  Browse Question Bank
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('student-dashboard')}
              className="group text-left bg-white border border-slate-200 rounded-md overflow-hidden hover:border-[#0F6B48] hover:-translate-y-0.5 transition-all duration-150 cursor-pointer flex flex-col"
            >
              <div className="px-4 py-3 bg-[#0F6B48] text-white flex items-center justify-between">
                <span className="text-sm font-semibold">Examination Results</span>
                <Award className="w-4 h-4 opacity-90 shrink-0" />
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Session-wise Grades IV–XII scholastic marksheets, assessment schemes, and
                  attendance.
                </p>
                <span className="text-xs font-semibold text-[#0F6B48] inline-flex items-center gap-1.5 group-hover:underline">
                  Check Result Portal
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('admissions')}
              className="group text-left bg-white border border-slate-200 rounded-md overflow-hidden hover:border-[#B45309] hover:-translate-y-0.5 transition-all duration-150 cursor-pointer flex flex-col"
            >
              <div className="px-4 py-3 bg-[#B45309] text-white flex items-center justify-between">
                <span className="text-sm font-semibold">Admissions Desk</span>
                <UserPlus className="w-4 h-4 opacity-90 shrink-0" />
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  {admissionsEnabled && openClassCount > 0
                    ? `Session ${activeSession} open for ${openClassCount} ${
                        openClassCount === 1 ? 'class' : 'classes'
                      }. Apply online and track status.`
                    : 'View age eligibility rules, track submitted forms, and inspect published merit lists.'}
                </p>
                <span className="text-xs font-semibold text-[#B45309] inline-flex items-center gap-1.5 group-hover:underline">
                  Open Admission Desk
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('portal')}
              className="group text-left bg-white border border-slate-200 rounded-md overflow-hidden hover:border-[#082D59] hover:-translate-y-0.5 transition-all duration-150 cursor-pointer flex flex-col"
            >
              <div className="px-4 py-3 bg-[#082D59] text-white flex items-center justify-between">
                <span className="text-sm font-semibold">Staff / Admin Portal</span>
                <ShieldCheck className="w-4 h-4 opacity-90 shrink-0" />
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Teacher MIS login (Employee ID / User ID), Administrator Control, and Nodal
                  Officer portal.
                </p>
                <span className="text-xs font-semibold text-[#082D59] inline-flex items-center gap-1.5 group-hover:underline">
                  Open MIS Dashboard
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </button>
          </div>
        </div>
      </section>

      {/* 3. Dual-Column Official Notice Center ("Latest @ MoE") & Institutional Quick Desk */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left 7 Cols: Live Circulars & Public Notifications Ledger */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-md overflow-hidden">
            <div className="px-5 py-4 bg-[#082D59] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b-2 border-[#D97706]">
              <div>
                <h2 className="font-display text-lg font-semibold">
                  Latest Circulars &amp; Official Notifications
                </h2>
                <p className="text-xs text-blue-100">
                  Chronological official notices issued by School Administration
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center bg-[#062142] p-0.5 rounded text-xs">
                  <button
                    type="button"
                    onClick={() => setNoticeTab('all')}
                    className={`px-2.5 py-1 rounded-sm font-medium cursor-pointer transition-colors whitespace-nowrap ${
                      noticeTab === 'all' ? 'bg-white text-[#082D59]' : 'text-blue-100 hover:text-white'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setNoticeTab('pdf')}
                    className={`px-2.5 py-1 rounded-sm font-medium cursor-pointer transition-colors whitespace-nowrap ${
                      noticeTab === 'pdf' ? 'bg-white text-[#082D59]' : 'text-blue-100 hover:text-white'
                    }`}
                  >
                    With PDF
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('circulars')}
                  className="text-xs font-semibold text-amber-300 hover:underline inline-flex items-center gap-1 cursor-pointer whitespace-nowrap ml-1"
                >
                  View Archive
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {downloadError && (
              <div className="m-4 p-3 rounded border border-red-200 bg-red-50 text-xs text-red-800">
                {downloadError}
              </div>
            )}

            <div className="divide-y divide-slate-200">
              {loading ? (
                <div className="p-8 text-sm text-slate-500">Loading circular archive...</div>
              ) : visibleNotices.length === 0 ? (
                <div className="p-10 text-center flex flex-col items-center justify-center">
                  <FileText className="w-8 h-8 text-slate-400 mb-2" />
                  <p className="text-sm font-semibold text-slate-800">
                    No circulars match this filter yet.
                  </p>
                  <p className="text-xs text-slate-500 mt-1 max-w-md">
                    Circulars uploaded in Administrator Control appear immediately on this board
                    with circular numbers and downloadable PDFs.
                  </p>
                </div>
              ) : (
                visibleNotices.map((c, index) => {
                  const isNew = index < 2 || isRecentCircular(c.createdAt);
                  return (
                    <div
                      key={c.id}
                      className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                          <span className="font-semibold text-[#8B1E24]">
                            Circular No. {c.circularNumber}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{new Date(c.createdAt).toLocaleDateString('en-IN')}</span>
                          {isNew && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-sans font-bold text-[#0F6B48] uppercase tracking-wide text-[11px]">
                                New
                              </span>
                            </>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-slate-900 leading-snug">
                          {c.title}
                        </p>
                        {c.originalFilename && (
                          <p className="text-xs text-slate-500 truncate">
                            Attachment: {c.originalFilename}
                          </p>
                        )}
                      </div>

                      {c.hasPdf && (
                        <button
                          type="button"
                          onClick={() => handleDownload(c)}
                          className="px-3.5 py-1.5 bg-[#0B3C75] text-white text-xs font-semibold rounded hover:bg-[#082D59] transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-center"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download PDF
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right 5 Cols: Academic Wings & Admission Desk */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
              <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-[#082D59]">
                  Academic Wings &amp; Section Framework
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('academics')}
                  className="text-xs font-semibold text-[#0B3C75] hover:underline cursor-pointer whitespace-nowrap"
                >
                  Curriculum →
                </button>
              </div>
              <div className="divide-y divide-slate-200 text-xs sm:text-sm">
                <div className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900">Preparatory Wing (Classes IV – V)</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Foundation Languages, Maths, EVS &amp; Computer
                    </p>
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#082D59] whitespace-nowrap">
                    Sec A–K
                  </span>
                </div>
                <div className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900">
                      Middle &amp; Secondary (Classes VI – X)
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Hindi, English, Maths, Science, SST, Sanskrit
                    </p>
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#082D59] whitespace-nowrap">
                    Sec A–K
                  </span>
                </div>
                <div className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900">
                      Senior Secondary (Classes XI – XII)
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Science (PCM/PCB), Commerce &amp; Humanities Streams
                    </p>
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#082D59] whitespace-nowrap">
                    Sec A–R
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
              <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-[#082D59]">
                  Admission &amp; Merit Window
                </h3>
                <span
                  className={`text-xs font-semibold ${
                    admissionsEnabled && openClassCount > 0 ? 'text-[#0F6B48]' : 'text-[#8B1E24]'
                  }`}
                >
                  {admissionsEnabled && openClassCount > 0 ? 'Active Window' : 'Currently Closed'}
                </span>
              </div>
              <div className="p-5 space-y-4 text-xs sm:text-sm">
                <dl className="space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Academic Session</dt>
                    <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                      {activeSession}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Open Classes</dt>
                    <dd className="font-medium text-slate-900 text-right">
                      {openClassCount > 0 ? openClasses.join(', ') : 'Awaiting Nodal Notice'}
                    </dd>
                  </div>
                  {admissionConfig?.closingDate && (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Application Closing Date</dt>
                      <dd className="font-mono font-semibold text-[#8B1E24] tabular-nums">
                        {admissionConfig.closingDate}
                      </dd>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Public Merit List</dt>
                    <dd className="font-semibold text-slate-900">
                      {meritPublished ? 'Published Online' : 'Managed by Nodal Officer'}
                    </dd>
                  </div>
                </dl>

                <div className="pt-2 flex flex-wrap items-center gap-2.5 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => onNavigate('admissions')}
                    className="px-4 py-2 bg-[#082D59] text-white text-xs font-semibold rounded hover:bg-[#0B3C75] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Open Admission Desk
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('portal')}
                    className="px-4 py-2 bg-white text-slate-700 text-xs font-semibold rounded border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Nodal Officer Login
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Administrative Offices Directory */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white border border-slate-200 rounded-md p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
            <div>
              <h2 className="font-display text-xl font-bold text-[#082D59]">
                Institutional Offices &amp; Administrative Helpdesk
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 mt-1">
                Direct academic, examination, and admission inquiries to the respective institutional
                desk.
              </p>
            </div>
            <p className="text-xs text-slate-600 inline-flex items-center gap-1.5 whitespace-nowrap">
              <Clock className="w-3.5 h-3.5 text-[#0B3C75]" />
              Mon – Sat · 08:00 AM – 02:30 PM
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 text-xs sm:text-sm">
            <div className="space-y-1">
              <p className="font-semibold text-slate-900">Controller of Examinations Cell</p>
              <p className="text-slate-600">Grades IV–IX &amp; Board Classes X–XII Results</p>
              <p className="font-mono text-xs text-[#0B3C75] inline-flex items-center gap-1.5 pt-1">
                <Mail className="w-3.5 h-3.5" />
                exams@moreden.edu
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-slate-900">Nodal Officer Admission Registry</p>
              <p className="text-slate-600">Entrance Evaluation, Merit List &amp; Roll Allotment</p>
              <p className="font-mono text-xs text-[#0B3C75] inline-flex items-center gap-1.5 pt-1">
                <Mail className="w-3.5 h-3.5" />
                admissions@moreden.edu
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-slate-900">Principal&apos;s Secretariat</p>
              <p className="text-slate-600">Official Circulars &amp; Faculty Administration</p>
              <p className="font-mono text-xs text-[#0B3C75] inline-flex items-center gap-1.5 pt-1">
                <Mail className="w-3.5 h-3.5" />
                office@moreden.edu
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function CircularsView() {
  const [circulars, setCirculars] = useState<CircularItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchCirculars = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await apiFetch<{ circulars: CircularItem[] }>('/api/circulars');
      setCirculars(Array.isArray(res.circulars) ? res.circulars : []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchCirculars(false);
  }, [fetchCirculars]);

  useAutoRefresh(() => fetchCirculars(false), true, 15000);

  const filtered = circulars.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.title.toLowerCase().includes(q) ||
      c.circularNumber.toLowerCase().includes(q) ||
      (c.originalFilename || '').toLowerCase().includes(q)
    );
  });

  const handleDownload = async (c: CircularItem) => {
    setError(null);
    try {
      await downloadPdfFile(
        `/api/circulars/${c.id}/download`,
        c.originalFilename || `Circular_${c.circularNumber}.pdf`
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-6 py-4 bg-[#082D59] text-white border-b-2 border-[#D97706]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
            Official Public Archive
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold mt-0.5">
            School Circulars &amp; Notifications
          </h1>
        </div>
        <div className="p-5 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-xs sm:text-sm text-slate-600">
            Official school circulars indexed by Circular Number, Issue Date, and Subject Title.
          </p>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by circular number or title..."
                className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
              />
            </div>
            <button
              type="button"
              onClick={() => fetchCirculars(true)}
              disabled={refreshing}
              className="px-3.5 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded hover:bg-slate-100 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded border border-red-200 bg-red-50 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        {loading ? (
          <div className="p-8 text-sm text-slate-500">Loading circulars...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-9 h-9 text-slate-400 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-800">
              {circulars.length === 0
                ? 'No circulars have been issued yet.'
                : 'No circulars match your search.'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Authorized administrators can publish new circulars from Administrator Control.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#082D59] text-white text-xs font-semibold">
                  <th className="py-3.5 px-5">Circular Number</th>
                  <th className="py-3.5 px-5">Subject / Title</th>
                  <th className="py-3.5 px-5">Issue Date</th>
                  <th className="py-3.5 px-5">Attachment</th>
                  <th className="py-3.5 px-5 text-right">Document</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-3.5 px-5 font-mono tabular-nums font-semibold text-[#8B1E24] whitespace-nowrap">
                      {c.circularNumber}
                    </td>
                    <td className="py-3.5 px-5 font-medium text-slate-900">{c.title}</td>
                    <td className="py-3.5 px-5 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleDateString('en-IN')}
                    </td>
                    <td className="py-3.5 px-5 text-xs text-slate-600">
                      {c.originalFilename || 'PDF Document'}
                      {c.fileSize ? ` (${Math.max(1, Math.round(c.fileSize / 1024))} KB)` : ''}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      {c.hasPdf ? (
                        <button
                          type="button"
                          onClick={() => handleDownload(c)}
                          className="px-3.5 py-1.5 bg-[#0B3C75] text-white text-xs font-semibold rounded hover:bg-[#082D59] transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download PDF
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Unavailable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
