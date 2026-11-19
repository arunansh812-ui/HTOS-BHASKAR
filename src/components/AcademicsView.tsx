import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Download, ExternalLink, FileText, Globe, RefreshCw, Search } from 'lucide-react';
import { apiFetch, downloadPdfFile, useAutoRefresh } from '../lib/api.ts';
import {
  CLASSES,
  type ClassName,
  type QuestionPaperItem,
  getSectionsForClass,
  getSubjectsForClassSection,
} from '../shared/schoolRules.ts';

interface AcademicsViewProps {
  initialClass?: ClassName;
  initialSection?: string;
  embedded?: boolean;
}

interface SearchGroundedUpdate {
  query: string;
  answer: string;
  sources: Array<{ title: string; uri: string }>;
  updatedAt: string;
}

export function AcademicsView({
  initialClass = 'IV',
  initialSection = 'A',
  embedded = false,
}: AcademicsViewProps) {
  const [selectedClass, setSelectedClass] = useState<ClassName>(initialClass);
  const [selectedSection, setSelectedSection] = useState<string>(initialSection);
  const [papers, setPapers] = useState<QuestionPaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [syllabusQuery, setSyllabusQuery] = useState('');
  const [searchResult, setSearchResult] = useState<SearchGroundedUpdate | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const availableSections = getSectionsForClass(selectedClass);
  const subjects = getSubjectsForClassSection(selectedClass, selectedSection);

  useEffect(() => {
    setSelectedClass(initialClass);
  }, [initialClass]);

  useEffect(() => {
    if (!availableSections.includes(selectedSection)) {
      setSelectedSection('A');
    }
  }, [selectedClass, availableSections, selectedSection]);

  const fetchPapers = useCallback(
    async (mode: 'initial' | 'manual' | 'background' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      if (mode === 'manual') setRefreshing(true);
      try {
        const res = await apiFetch<{ papers: QuestionPaperItem[] }>(
          `/api/question-papers?className=${encodeURIComponent(selectedClass)}&section=${encodeURIComponent(selectedSection)}`
        );
        setPapers(Array.isArray(res.papers) ? res.papers : []);
        setError(null);
      } catch (err) {
        if (mode !== 'background') setError((err as Error).message);
      } finally {
        if (mode === 'initial') setLoading(false);
        if (mode === 'manual') setRefreshing(false);
      }
    },
    [selectedClass, selectedSection]
  );

  useEffect(() => {
    void fetchPapers('initial');
  }, [fetchPapers]);

  useAutoRefresh(() => fetchPapers('background'), true, 15000);

  const handleDownload = async (paper: QuestionPaperItem) => {
    setError(null);
    try {
      await downloadPdfFile(
        `/api/question-papers/${paper.id}/download`,
        paper.originalFilename || `${paper.title}.pdf`
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCurriculumLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const q =
      syllabusQuery.trim() ||
      `Class ${selectedClass} K-12 curriculum syllabus and sample question papers`;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await apiFetch<SearchGroundedUpdate>(
        `/api/public/education-updates?q=${encodeURIComponent(q)}`
      );
      setSearchResult(res);
    } catch (err) {
      setSearchError((err as Error).message);
    } finally {
      setSearchLoading(false);
    }
  };

  return (
    <div className={embedded ? 'space-y-6' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6'}>
      {!embedded && (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="px-6 py-4 bg-[#082D59] text-white border-b-2 border-[#D97706]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              Academic &amp; Curriculum Division
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold mt-0.5">
              Academics, Syllabus &amp; Question Paper Bank
            </h1>
          </div>
          <div className="px-6 py-3.5 bg-slate-50 text-xs sm:text-sm text-slate-600">
            Select your Class (IV–XII) and Section (A–K for IV–X, A–R for XI–XII) to inspect
            prescribed subjects and download section-wise examination papers.
          </div>
        </div>
      )}

      {/* Class & Section Selector */}
      <div className="bg-white border border-slate-200 rounded-md p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Select Class (IV to XII)
          </label>
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value as ClassName)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
          >
            {CLASSES.map((cls) => (
              <option key={cls} value={cls}>
                Class {cls}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Select Section ({selectedClass === 'XI' || selectedClass === 'XII' ? 'A to R' : 'A to K'})
          </label>
          <select
            value={selectedSection}
            onChange={(e) => setSelectedSection(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
          >
            {availableSections.map((sec) => (
              <option key={sec} value={sec}>
                Section {sec}
              </option>
            ))}
          </select>
        </div>

        <div className="text-xs text-slate-600 py-1.5">
          Active Scope:{' '}
          <span className="font-mono font-semibold text-[#082D59]">
            Class {selectedClass} — Section {selectedSection}
          </span>
        </div>
      </div>

      {/* Prescribed Subjects */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[#8B1E24]" />
          <h2 className="text-xs sm:text-sm font-semibold text-[#082D59]">
            Prescribed Subjects for Class {selectedClass}
            {(selectedClass === 'XI' || selectedClass === 'XII') && selectedSection === 'R'
              ? ' (Section R)'
              : ''}
          </h2>
        </div>
        <div className="p-5 text-sm text-slate-800 font-medium">{subjects.join(' · ')}</div>
      </div>

      {error && (
        <div className="p-3 rounded-md border border-red-200 bg-red-50 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Uploaded Question Papers */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-5 py-3.5 bg-[#082D59] text-white flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">
            Question Papers Repository — Class {selectedClass}-{selectedSection}
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-blue-100 tabular-nums font-mono">
              {papers.length} {papers.length === 1 ? 'paper' : 'papers'}
            </span>
            <button
              type="button"
              onClick={() => fetchPapers('manual')}
              disabled={refreshing}
              className="px-2.5 py-1 bg-white/10 border border-white/25 text-white text-xs font-semibold rounded hover:bg-white/20 inline-flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-sm text-slate-500">Loading question papers...</div>
        ) : papers.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-800">
              No question papers uploaded yet for Class {selectedClass}-{selectedSection}.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Teachers and Administrators can upload section-wise question papers from their portals.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {papers.map((p) => (
              <div
                key={p.id}
                className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-[#8B1E24]">{p.subject}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">Session {p.academicYear}</span>
                    <span aria-hidden="true">·</span>
                    <span>{p.originalFilename}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{p.title}</p>
                </div>

                <button
                  type="button"
                  onClick={() => handleDownload(p)}
                  className="px-4 py-2 bg-[#0B3C75] text-white text-xs font-semibold rounded hover:bg-[#082D59] transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-center"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Paper
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Google Search Grounded Curriculum & Exam Reference Lookup */}
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#0F6B48]" />
            <h3 className="text-sm font-semibold text-[#082D59]">
              Curriculum &amp; Exam Reference Lookup (Web Search Grounded)
            </h3>
          </div>
          <span className="text-[11px] text-slate-500">
            Live verified K-12 syllabus &amp; board examination guidance
          </span>
        </div>

        <div className="p-5 space-y-4">
          <form onSubmit={handleCurriculumLookup} className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={syllabusQuery}
                onChange={(e) => setSyllabusQuery(e.target.value)}
                placeholder={`e.g. Class ${selectedClass} syllabus, sample question paper pattern, exam schedule...`}
                className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
              />
            </div>
            <button
              type="submit"
              disabled={searchLoading}
              className="px-4 py-2 bg-[#0F6B48] text-white text-xs sm:text-sm font-semibold rounded hover:bg-[#0B5337] disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
            >
              {searchLoading ? 'Searching Web...' : 'Search Live Guidance'}
            </button>
          </form>

          {searchError && (
            <div className="p-3 rounded border border-amber-200 bg-amber-50 text-xs text-amber-900">
              {searchError}
            </div>
          )}

          {searchResult && (
            <div className="p-4 rounded border border-slate-200 bg-[#F6F8FA] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span className="font-semibold text-[#082D59]">{searchResult.query}</span>
                <span className="font-mono tabular-nums">
                  Verified {new Date(searchResult.updatedAt).toLocaleTimeString('en-IN')}
                </span>
              </div>
              <div className="text-xs sm:text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                {searchResult.answer}
              </div>
              {searchResult.sources.length > 0 && (
                <div className="pt-2.5 border-t border-slate-200 space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Google Search Sources
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {searchResult.sources.map((src) => (
                      <a
                        key={src.uri}
                        href={src.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#0B3C75] hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        <span>{src.title}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
