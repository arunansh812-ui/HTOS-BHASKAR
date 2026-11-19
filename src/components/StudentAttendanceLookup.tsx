import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, RefreshCw, Search } from 'lucide-react';
import { apiFetch, useAutoRefresh } from '../lib/api.ts';
import {
  CLASSES,
  type AttendanceStatus,
  type ClassName,
  getSectionsForClass,
  normalizeStudentId,
} from '../shared/schoolRules.ts';

interface AttendanceLookupResponse {
  student: {
    studentId: string;
    rollNumber: string;
    name: string;
    className: ClassName;
    section: string;
  };
  summary: {
    total: number;
    present: number;
    absent: number;
    leave: number;
    percentage: number;
  };
  records: Array<{
    date: string;
    status: AttendanceStatus;
    updated_at: string;
  }>;
}

interface StudentAttendanceLookupProps {
  defaultClass?: ClassName;
  defaultSection?: string;
}

export function StudentAttendanceLookup({
  defaultClass = 'IV',
  defaultSection = 'A',
}: StudentAttendanceLookupProps) {
  const [studentId, setStudentId] = useState('');
  const [className, setClassName] = useState<ClassName>(defaultClass);
  const [section, setSection] = useState(defaultSection);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AttendanceLookupResponse | null>(null);

  const sections = getSectionsForClass(className);

  useEffect(() => {
    setClassName(defaultClass);
  }, [defaultClass]);

  useEffect(() => {
    if (!sections.includes(section)) {
      setSection('A');
    }
  }, [className, sections, section]);

  const fetchAttendance = useCallback(
    async (silent = false) => {
      const cleanedId = normalizeStudentId(studentId);
      if (!cleanedId) return;
      if (!silent) {
        setError(null);
        setLoading(true);
      }
      try {
        const res = await apiFetch<AttendanceLookupResponse>(
          `/api/student/attendance?studentId=${encodeURIComponent(cleanedId)}&className=${encodeURIComponent(className)}&section=${encodeURIComponent(section)}`
        );
        setData(res);
      } catch (err) {
        if (!silent) {
          setData(null);
          setError((err as Error).message);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [studentId, className, section]
  );

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetchAttendance(false);
  };

  useAutoRefresh(() => fetchAttendance(true), Boolean(data), 15000);

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleLookup}
        className="bg-white border border-slate-200 rounded-md p-5 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end"
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Student ID *</label>
          <input
            type="text"
            required
            value={studentId}
            onChange={(e) => setStudentId(normalizeStudentId(e.target.value))}
            placeholder="e.g. STU101"
            className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Class</label>
          <select
            value={className}
            onChange={(e) => setClassName(e.target.value as ClassName)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
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
            value={section}
            onChange={(e) => setSection(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
          >
            {sections.map((s) => (
              <option key={s} value={s}>
                Section {s}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-[#082D59] text-white text-sm font-semibold rounded hover:bg-[#0B3C75] inline-flex items-center justify-center gap-2 cursor-pointer"
        >
          <Search className="w-4 h-4" />
          {loading ? 'Searching...' : 'View Attendance'}
        </button>
      </form>

      {error && (
        <div className="p-3.5 rounded-md border border-red-200 bg-red-50 text-sm text-red-800">
          {error}
        </div>
      )}

      {data && (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-mono text-slate-500">
                Student ID: {data.student.studentId} · Roll No: {data.student.rollNumber}
              </p>
              <h3 className="text-lg font-semibold text-slate-900 mt-0.5">
                {data.student.name} — Class {data.student.className}-{data.student.section}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
              <span className="text-emerald-700 font-semibold">
                Present: {data.summary.present}
              </span>
              <span className="text-red-700 font-semibold">
                Absent: {data.summary.absent}
              </span>
              <span className="text-amber-700 font-semibold">
                Leave: {data.summary.leave}
              </span>
              <span className="text-slate-900 font-bold">
                Attendance: {data.summary.percentage}%
              </span>
              <button
                type="button"
                onClick={() => fetchAttendance(false)}
                className="px-2.5 py-1 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer font-sans"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh
              </button>
            </div>
          </div>

          {data.records.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              <CalendarDays className="w-7 h-7 text-slate-400 mx-auto mb-2" />
              No date-wise attendance records have been marked for this student yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#EEF3F9] border-b border-slate-200 text-xs font-semibold text-[#0B3C75]">
                    <th className="py-2.5 px-5">Date</th>
                    <th className="py-2.5 px-5">Attendance Status</th>
                    <th className="py-2.5 px-5">Last Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.records.map((r) => (
                    <tr key={r.date}>
                      <td className="py-2.5 px-5 font-mono tabular-nums text-slate-900">
                        {r.date}
                      </td>
                      <td
                        className={`py-2.5 px-5 font-semibold ${
                          r.status === 'Present'
                            ? 'text-emerald-700'
                            : r.status === 'Absent'
                              ? 'text-red-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {r.status}
                      </td>
                      <td className="py-2.5 px-5 font-mono tabular-nums text-xs text-slate-500">
                        {new Date(r.updated_at).toLocaleString('en-IN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
