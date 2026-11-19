import { Printer, X } from 'lucide-react';
import { crestEmblemImg } from '../assets/schoolImages.ts';
import type { ClassName } from '../shared/schoolRules.ts';

export interface OfficialResultAssessmentCol {
  id: number;
  assessmentName: string;
  maxMarks: number;
  passingMarks: number;
  isPublished?: boolean;
}

export interface OfficialResultSubjectRow {
  subject: string;
  assessments: Array<{
    assessmentId: number;
    assessmentName: string;
    maxMarks: number;
    passingMarks: number;
    marksObtained: number | null;
    passed: boolean | null;
  }>;
  totalObtained: number | null;
  totalMax: number;
  totalPassing: number;
  percentage: number | null;
  grade: string | null;
  gradePoint: string | null;
  remark: string | null;
  status: string;
}

export interface OfficialResultSheetProps {
  academicSession?: string;
  publicationScope?: 'full' | 'partial' | 'unpublished';
  publishedAt?: string | null;
  isPreview?: boolean;
  onClose?: () => void;
  student: {
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
  } | null;
  schemes: OfficialResultAssessmentCol[];
  pendingAssessments?: Array<{ id: number; assessmentName: string; maxMarks: number }>;
  subjectResults: OfficialResultSubjectRow[];
  summary: {
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

const SCHOLASTIC_SCALE = [
  { grade: 'A1', range: '91–100%', gp: '10.0', desc: 'Outstanding' },
  { grade: 'A2', range: '81–90%', gp: '9.0', desc: 'Excellent' },
  { grade: 'B1', range: '71–80%', gp: '8.0', desc: 'Very Good' },
  { grade: 'B2', range: '61–70%', gp: '7.0', desc: 'Good' },
  { grade: 'C1', range: '51–60%', gp: '6.0', desc: 'Above Average' },
  { grade: 'C2', range: '41–50%', gp: '5.0', desc: 'Average' },
  { grade: 'D', range: '33–40%', gp: '4.0', desc: 'Marginal (Pass)' },
  { grade: 'E1/E2', range: '00–32%', gp: '—', desc: 'Needs Improvement' },
];

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function intToWords(n: number): string {
  if (n < 0 || !Number.isFinite(n)) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rem = n % 100;
    return rem ? `${ONES[h]} Hundred ${intToWords(rem)}` : `${ONES[h]} Hundred`;
  }
  if (n < 100000) {
    const th = Math.floor(n / 1000);
    const rem = n % 1000;
    return rem ? `${intToWords(th)} Thousand ${intToWords(rem)}` : `${intToWords(th)} Thousand`;
  }
  return String(n);
}

function marksToWords(value: number): string {
  const fixed = Number(value.toFixed(2));
  const whole = Math.floor(fixed);
  const decimalStr = String(fixed).split('.')[1];
  const base = intToWords(whole);
  if (!decimalStr) return `${base} Only`;
  const decimalWords = decimalStr
    .split('')
    .map((d) => ONES[Number(d)] || d)
    .join(' ');
  return `${base} Point ${decimalWords} Only`;
}

export function OfficialResultSheet({
  academicSession = '2026–2027',
  publicationScope = 'full',
  publishedAt,
  isPreview = false,
  onClose,
  student,
  attendance,
  schemes,
  pendingAssessments = [],
  subjectResults,
  summary,
}: OfficialResultSheetProps) {
  const isSeniorBoard =
    student.className === 'X' || student.className === 'XI' || student.className === 'XII';

  const statusTone =
    summary.overallStatus.includes('PASS') || summary.overallStatus.includes('QUALIFIED')
      ? 'bg-emerald-950 text-white border-emerald-800'
      : summary.overallStatus === 'COMPARTMENT'
        ? 'bg-[#7C1D24] text-white border-[#5D1319]'
        : summary.overallStatus === 'ESSENTIAL REPEAT'
          ? 'bg-red-950 text-white border-red-800'
          : 'bg-[#0B3C75] text-white border-[#082C57]';

  const formattedPublishedDate = publishedAt
    ? new Date(publishedAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : isPreview
      ? 'Internal Staff Preview'
      : new Date().toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });

  const declarationLabel =
    publicationScope === 'full'
      ? 'Whole Session Published'
      : publicationScope === 'partial'
        ? 'Assessment-Wise Release'
        : 'Pending Publication (Preview)';

  const attendanceText =
    attendance && attendance.total > 0
      ? `${attendance.present} / ${attendance.total} Days (${attendance.percentage}%)`
      : 'Not Recorded';

  return (
    <div className="print-sheet bg-white border-2 border-[#0B3C75] rounded-md overflow-hidden shadow-sm">
      {/* Staff Preview Banner (Hidden on Official Student View & Print) */}
      {isPreview && (
        <div className="no-print px-5 py-2.5 bg-amber-50 border-b border-amber-300 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950">
          <span className="font-semibold">
            {publicationScope === 'unpublished'
              ? 'STAFF INTERNAL PREVIEW — NOT YET PUBLISHED TO STUDENTS'
              : publicationScope === 'partial'
                ? 'STAFF PREVIEW — INCLUDES ASSESSMENTS NOT YET PUBLISHED TO STUDENTS'
                : 'STAFF PREVIEW — OFFICIAL PUBLISHED STATEMENT OF MARKS'}
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 rounded border border-amber-400 bg-white text-slate-800 font-semibold hover:bg-amber-100 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <X className="w-3.5 h-3.5" />
              Close Preview
            </button>
          )}
        </div>
      )}

      {/* Official MoE Examination Branch Masthead */}
      <div className="bg-[#EEF3F9] border-b-2 border-[#0B3C75] px-5 sm:px-8 py-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-4">
            <img
              src={crestEmblemImg}
              alt="Moreden of Education International School Crest"
              referrerPolicy="no-referrer"
              className="w-16 h-16 object-contain shrink-0 bg-white p-1 border border-slate-400"
            />
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#7C1D24]">
                MoE Examination &amp; Academic Council · Examination Branch
              </p>
              <h2 className="font-display text-lg sm:text-2xl font-bold text-[#0B3C75] leading-tight tracking-tight">
                MOREDEN OF EDUCATION INTERNATIONAL SCHOOL
              </h2>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-900">
                Provisional Statement of Marks / Progress Report — Academic Session {academicSession}
              </p>
              <p className="text-[11px] text-slate-600">
                Class IV–XII Scholastic Evaluation · Medium: English · Grading: MoE 8-Point Scale
                (Min. Pass 33% / Grade D)
              </p>
            </div>
          </div>

          <div className="no-print flex items-center gap-2 self-start sm:self-center shrink-0">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2 bg-[#0B3C75] text-white text-xs font-semibold rounded hover:bg-[#144D8A] inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              Print Official Marksheet
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-2 border border-slate-300 bg-white rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Institutional Saffron Rule */}
      <div className="h-1 bg-[#E06B10]" />

      <div className="p-5 sm:p-8 space-y-6">
        {/* Partial Assessment Notice */}
        {publicationScope === 'partial' && pendingAssessments.length > 0 && (
          <div className="p-3 border border-amber-400 bg-amber-50 text-xs text-amber-950">
            <strong>Assessment-Wise Result Declaration:</strong> Only assessments officially
            published by the School Administrator are shown below. Assessments pending publication:{' '}
            <span className="font-semibold">
              {pendingAssessments.map((p) => p.assessmentName).join(', ')}
            </span>
            .
          </div>
        )}

        {/* Section A: Official Candidate Particulars Tabular Grid */}
        <div className="border border-slate-400 overflow-hidden">
          <div className="bg-[#0B3C75] text-white px-4 py-2 text-xs font-bold uppercase tracking-wider flex flex-wrap items-center justify-between gap-2">
            <span>Candidate &amp; Academic Particulars</span>
            <span className="font-mono text-[11px] text-amber-200 tabular-nums">
              Date of Declaration: {formattedPublishedDate}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <tbody className="divide-y divide-slate-300">
                <tr>
                  <th className="py-2 px-3 bg-slate-50 border-r border-slate-300 font-semibold text-slate-700 w-36">
                    Student Name
                  </th>
                  <td className="py-2 px-3 border-r border-slate-300 font-bold text-slate-900 uppercase">
                    {student.name}
                  </td>
                  <th className="py-2 px-3 bg-slate-50 border-r border-slate-300 font-semibold text-slate-700 w-40">
                    Student ID
                  </th>
                  <td className="py-2 px-3 font-mono font-bold text-[#0B3C75] tabular-nums">
                    {student.studentId}
                  </td>
                </tr>
                <tr>
                  <th className="py-2 px-3 bg-slate-50 border-r border-slate-300 font-semibold text-slate-700">
                    Class &amp; Section
                  </th>
                  <td className="py-2 px-3 border-r border-slate-300 font-bold text-slate-900">
                    Class {student.className} — Section {student.section}
                  </td>
                  <th className="py-2 px-3 bg-slate-50 border-r border-slate-300 font-semibold text-slate-700">
                    Class Roll Number
                  </th>
                  <td className="py-2 px-3 font-mono font-bold text-slate-900 tabular-nums">
                    {student.rollNumber}
                  </td>
                </tr>
                <tr>
                  <th className="py-2 px-3 bg-slate-50 border-r border-slate-300 font-semibold text-slate-700">
                    Board Roll / Reg. No.
                  </th>
                  <td className="py-2 px-3 border-r border-slate-300 font-mono font-semibold text-slate-900 tabular-nums">
                    {student.boardNo || (isSeniorBoard ? 'Not Assigned' : 'N/A (School Exam)')}
                  </td>
                  <th className="py-2 px-3 bg-slate-50 border-r border-slate-300 font-semibold text-slate-700">
                    Total Attendance
                  </th>
                  <td className="py-2 px-3 font-mono font-semibold text-slate-900 tabular-nums">
                    {attendanceText}
                  </td>
                </tr>
                <tr>
                  <th className="py-2 px-3 bg-slate-50 border-r border-slate-300 font-semibold text-slate-700">
                    Academic Session
                  </th>
                  <td className="py-2 px-3 border-r border-slate-300 font-mono font-semibold text-slate-900">
                    {academicSession}
                  </td>
                  <th className="py-2 px-3 bg-slate-50 border-r border-slate-300 font-semibold text-slate-700">
                    Release Scope
                  </th>
                  <td className="py-2 px-3 font-semibold text-slate-800">{declarationLabel}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Part I: Scholastic Areas — Two-Row Official Marks Table */}
        <div className="border border-slate-400 overflow-hidden">
          <div className="bg-[#EEF3F9] border-b border-slate-400 px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#0B3C75]">
            Part I — Scholastic Areas (Assessment-Wise Marks &amp; Positional Grade)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-[11px] font-bold uppercase text-slate-800">
                  <th
                    rowSpan={2}
                    className="py-2 px-2.5 border-r border-slate-300 text-center w-10 align-middle"
                  >
                    S.No.
                  </th>
                  <th
                    rowSpan={2}
                    className="py-2 px-3 border-r border-slate-300 align-middle min-w-[140px]"
                  >
                    Subject Name
                  </th>
                  {schemes.length > 0 && (
                    <th
                      colSpan={schemes.length}
                      className="py-1.5 px-3 border-r border-slate-300 text-center bg-[#E4ECF5] text-[#0B3C75]"
                    >
                      Published Assessment Marks
                    </th>
                  )}
                  <th
                    colSpan={2}
                    className="py-1.5 px-3 border-r border-slate-300 text-center bg-[#E4ECF5] text-[#0B3C75]"
                  >
                    Subject Aggregate
                  </th>
                  <th
                    rowSpan={2}
                    className="py-2 px-2.5 border-r border-slate-300 text-right align-middle whitespace-nowrap"
                  >
                    % Score
                  </th>
                  <th
                    rowSpan={2}
                    className="py-2 px-2.5 border-r border-slate-300 text-center align-middle whitespace-nowrap"
                  >
                    Grade
                  </th>
                  <th
                    rowSpan={2}
                    className="py-2 px-2.5 border-r border-slate-300 text-center align-middle whitespace-nowrap"
                  >
                    GP
                  </th>
                  <th
                    rowSpan={2}
                    className="py-2 px-3 text-right align-middle whitespace-nowrap"
                  >
                    Subject Status
                  </th>
                </tr>

                <tr className="bg-slate-50 border-b border-slate-400 text-[11px] font-semibold text-slate-800 tabular-nums">
                  {schemes.map((s) => (
                    <th
                      key={s.id}
                      className="py-2 px-2.5 border-r border-slate-300 text-right whitespace-nowrap"
                    >
                      <span className="block text-slate-900 font-bold">{s.assessmentName}</span>
                      <span className="block text-[10px] font-mono font-normal text-slate-500">
                        Max {s.maxMarks} / Pass {s.passingMarks}
                        {isPreview && s.isPublished === false ? ' (Unpublished)' : ''}
                      </span>
                    </th>
                  ))}
                  <th className="py-2 px-2.5 border-r border-slate-300 text-right whitespace-nowrap">
                    Obtained
                  </th>
                  <th className="py-2 px-2.5 border-r border-slate-300 text-right whitespace-nowrap">
                    Max Marks
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-300 tabular-nums">
                {subjectResults.map((sub, idx) => (
                  <tr key={sub.subject} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-2.5 border-r border-slate-300 text-center font-mono text-slate-600">
                      {String(idx + 1).padStart(2, '0')}
                    </td>
                    <td className="py-2.5 px-3 border-r border-slate-300 font-bold text-slate-900">
                      {sub.subject}
                    </td>
                    {sub.assessments.map((a) => {
                      const belowPass = a.marksObtained !== null && a.passed === false;
                      return (
                        <td
                          key={a.assessmentId}
                          className={`py-2.5 px-2.5 border-r border-slate-300 text-right font-mono ${
                            belowPass ? 'text-[#7C1D24] font-bold' : 'text-slate-900'
                          }`}
                        >
                          {a.marksObtained !== null ? `${a.marksObtained}${belowPass ? '*' : ''}` : '—'}
                        </td>
                      );
                    })}
                    <td className="py-2.5 px-2.5 border-r border-slate-300 text-right font-mono font-bold text-slate-900">
                      {sub.totalObtained !== null ? sub.totalObtained : '—'}
                    </td>
                    <td className="py-2.5 px-2.5 border-r border-slate-300 text-right font-mono text-slate-600">
                      {sub.totalMax}
                    </td>
                    <td className="py-2.5 px-2.5 border-r border-slate-300 text-right font-mono text-slate-800">
                      {sub.percentage !== null ? `${sub.percentage}%` : '—'}
                    </td>
                    <td className="py-2.5 px-2.5 border-r border-slate-300 text-center font-mono font-bold text-[#0B3C75]">
                      {sub.grade ?? '—'}
                    </td>
                    <td className="py-2.5 px-2.5 border-r border-slate-300 text-center font-mono text-slate-700">
                      {sub.gradePoint ?? '—'}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-bold text-[11px] whitespace-nowrap ${
                        sub.status === 'Pass'
                          ? 'text-emerald-800'
                          : sub.status === 'Needs Improvement'
                            ? 'text-[#7C1D24]'
                            : 'text-slate-400'
                      }`}
                    >
                      {sub.status === 'Pass'
                        ? 'PASS'
                        : sub.status === 'Needs Improvement'
                          ? 'COMPARTMENT / IMP.'
                          : 'NOT ENTERED'}
                    </td>
                  </tr>
                ))}
              </tbody>

              <tfoot>
                <tr className="bg-[#EEF3F9] border-t-2 border-[#0B3C75] font-bold text-xs text-[#0B3C75] tabular-nums">
                  <td
                    colSpan={2 + schemes.length}
                    className="py-2.5 px-3 border-r border-slate-300 text-right uppercase tracking-wide"
                  >
                    Grand Total (Evaluated Subjects)
                  </td>
                  <td className="py-2.5 px-2.5 border-r border-slate-300 text-right font-mono">
                    {summary.grandMax > 0 ? summary.grandObtained : '—'}
                  </td>
                  <td className="py-2.5 px-2.5 border-r border-slate-300 text-right font-mono">
                    {summary.grandMax > 0 ? summary.grandMax : '—'}
                  </td>
                  <td className="py-2.5 px-2.5 border-r border-slate-300 text-right font-mono">
                    {summary.grandMax > 0 ? `${summary.percentage}%` : '—'}
                  </td>
                  <td className="py-2.5 px-2.5 border-r border-slate-300 text-center font-mono">
                    {summary.overallGrade}
                  </td>
                  <td className="py-2.5 px-2.5 border-r border-slate-300 text-center font-mono">
                    {summary.overallGradePoint}
                  </td>
                  <td className="py-2.5 px-3 text-right">{summary.overallRemark}</td>
                </tr>
                {summary.grandMax > 0 && (
                  <tr className="bg-white border-t border-slate-300 text-xs text-slate-800">
                    <td
                      colSpan={7 + schemes.length}
                      className="py-2 px-3"
                    >
                      <span className="font-semibold text-slate-600">
                        Total Marks Obtained (In Words):{' '}
                      </span>
                      <span className="font-semibold text-slate-900">
                        {marksToWords(summary.grandObtained)}
                      </span>{' '}
                      <span className="text-slate-500 font-mono">
                        (Out of {summary.grandMax})
                      </span>
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        </div>

        {/* Final Official Result Declaration Box */}
        <div
          className={`p-4 sm:p-5 border-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${statusTone}`}
        >
          <div className="space-y-1 text-xs sm:text-sm">
            <p className="text-[11px] uppercase tracking-wider opacity-85">
              Official Result &amp; Promotion Status
            </p>
            <p className="text-base sm:text-xl font-bold tracking-wide">{summary.overallStatus}</p>
            {summary.compartmentSubjects && summary.compartmentSubjects.length > 0 && (
              <p className="text-xs text-amber-200">
                Subject(s) placed under Compartment / Re-Appear:{' '}
                <strong>{summary.compartmentSubjects.join(', ')}</strong>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-6 font-mono tabular-nums text-xs sm:text-sm">
            <div>
              <p className="text-[11px] opacity-80">Grand Aggregate</p>
              <p className="font-bold">
                {summary.grandObtained} / {summary.grandMax}
              </p>
            </div>
            <div>
              <p className="text-[11px] opacity-80">Percentage</p>
              <p className="font-bold">{summary.percentage}%</p>
            </div>
            <div>
              <p className="text-[11px] opacity-80">Overall Grade</p>
              <p className="font-bold">
                {summary.overallGrade} (GP {summary.overallGradePoint})
              </p>
            </div>
          </div>
        </div>

        {/* MoE Standard 8-Point Scholastic Grading Scale Table */}
        <div className="border border-slate-300 overflow-hidden">
          <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#0B3C75]">
            MoE Standard 8-Point Scholastic Grading Scale
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-center border-collapse text-[11px] tabular-nums">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-300 text-slate-700 font-semibold">
                  {SCHOLASTIC_SCALE.map((item) => (
                    <th key={item.grade} className="py-1.5 px-2 border-r last:border-r-0 border-slate-300">
                      {item.grade}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-200 font-mono text-slate-800">
                  {SCHOLASTIC_SCALE.map((item) => (
                    <td key={item.grade} className="py-1.5 px-2 border-r last:border-r-0 border-slate-300">
                      {item.range}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-slate-200 font-mono text-slate-600">
                  {SCHOLASTIC_SCALE.map((item) => (
                    <td key={item.grade} className="py-1 px-2 border-r last:border-r-0 border-slate-300">
                      GP: {item.gp}
                    </td>
                  ))}
                </tr>
                <tr className="text-slate-600">
                  {SCHOLASTIC_SCALE.map((item) => (
                    <td key={item.grade} className="py-1 px-2 border-r last:border-r-0 border-slate-300">
                      {item.desc}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Official Signatories & Verification Disclaimer */}
        <div className="pt-3 border-t border-slate-300 space-y-5">
          <p className="text-[11px] text-slate-600">
            <strong>Abbreviations &amp; Rules:</strong> Marks marked with <code>*</code> indicate
            scores below the assessment minimum passing threshold. Qualifying grade is{' '}
            <strong>D (33%)</strong> in each subject as per Moreden of Education International School
            examination norms.
          </p>

          <div className="grid grid-cols-3 gap-4 pt-8 text-center text-xs text-slate-800">
            <div>
              <div className="border-t border-slate-500 mx-4 pt-1.5 font-semibold">
                Prepared By · Class Teacher
              </div>
            </div>
            <div>
              <div className="border-t border-slate-500 mx-4 pt-1.5 font-semibold">
                Checked By · Examination I/C
              </div>
            </div>
            <div>
              <div className="border-t border-slate-500 mx-4 pt-1.5 font-semibold">
                Principal / Head of School
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 text-center border-t border-slate-200 pt-3">
            Note: This is an electronically generated Provisional Statement of Marks from the
            Moreden of Education International School Examination Portal. Any discrepancy should be
            reported to the School Examination Cell within 7 working days.
          </p>
        </div>
      </div>
    </div>
  );
}
