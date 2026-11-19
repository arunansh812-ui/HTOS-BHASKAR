export const CLASSES = ['IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'] as const;
export type ClassName = (typeof CLASSES)[number];

export const ALL_SUBJECTS = [
  'HINDI',
  'ENGLISH',
  'MATHS',
  'SCIENCE',
  'SOCIAL STUDIES',
  'PHYSICS',
  'CHEMISTRY',
  'BIOLOGY',
  'SST',
  'SANSKRIT',
  'COMPUTER',
  'ECONOMICS',
  'ACCOUNTANCY',
  'BUSINESS STUDIES',
  'GK',
] as const;

export const SECTIONS_IV_TO_X = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const;
export const SECTIONS_XI_TO_XII = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R',
] as const;

export type UserRole = 'admin' | 'nodal_officer' | 'staff';
export type StaffDesignation = 'Subject Teacher' | 'Class Teacher' | 'Both';
export type AttendanceStatus = 'Present' | 'Absent' | 'Leave';
export type AdmissionStatus =
  | 'Pending'
  | 'Waitlisted'
  | 'Correction Needed'
  | 'Approved'
  | 'Denied';

export const SENIOR_STREAMS = [
  'Science (PCM)',
  'Science (PCB)',
  'Commerce',
  'Humanities',
] as const;

export function isValidClass(value: string): value is ClassName {
  return (CLASSES as readonly string[]).includes(value);
}

export function getSectionsForClass(cls: ClassName): string[] {
  if (cls === 'XI' || cls === 'XII') {
    return [...SECTIONS_XI_TO_XII];
  }
  return [...SECTIONS_IV_TO_X];
}

export function normalizeStudentId(raw: string): string {
  return String(raw || '').replace(/\s+/g, '');
}

export function normalizeAcademicSession(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/[\u2012\u2013\u2014\u2015-]/g, '-')
    .replace(/\s+/g, '');
}

export function isValidSectionForClass(cls: ClassName, section: string): boolean {
  return getSectionsForClass(cls).includes(section);
}

export function getSubjectsForClassSection(cls: ClassName, section?: string): string[] {
  if (cls === 'IV') {
    return ['HINDI', 'ENGLISH', 'MATHS', 'SCIENCE'];
  }
  if (cls === 'V') {
    return ['HINDI', 'ENGLISH', 'MATHS', 'SCIENCE', 'SOCIAL STUDIES'];
  }
  if (cls === 'VI' || cls === 'VII' || cls === 'VIII' || cls === 'IX' || cls === 'X') {
    return ['HINDI', 'ENGLISH', 'MATHS', 'SCIENCE', 'SST', 'SANSKRIT'];
  }
  // Classes XI and XII
  if (section === 'R') {
    return ['HINDI', 'ENGLISH', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'COMPUTER'];
  }
  return [
    'HINDI',
    'ENGLISH',
    'PHYSICS',
    'CHEMISTRY',
    'MATHS',
    'BIOLOGY',
    'COMPUTER',
    'ECONOMICS',
    'ACCOUNTANCY',
    'BUSINESS STUDIES',
  ];
}

export const DOB_YEAR_LIMITS: Record<
  ClassName,
  { maxYear: number; minYear: number; label: string }
> = {
  IV: { maxYear: 2016, minYear: 2013, label: 'Birth year must be 2016 or earlier (2013–2016)' },
  V: { maxYear: 2015, minYear: 2012, label: 'Birth year must be 2015 or earlier (2012–2015)' },
  VI: { maxYear: 2014, minYear: 2011, label: 'Birth year must be 2014 or earlier (2011–2014)' },
  VII: { maxYear: 2013, minYear: 2010, label: 'Birth year must be 2013 or earlier (2010–2013)' },
  VIII: { maxYear: 2012, minYear: 2009, label: 'Birth year must be 2012 or earlier (2009–2012)' },
  IX: { maxYear: 2010, minYear: 2007, label: 'Birth year must be 2010 or earlier (2007–2010)' },
  X: { maxYear: 2009, minYear: 2006, label: 'Birth year must be 2009 or earlier (2006–2009)' },
  XI: { maxYear: 2008, minYear: 2005, label: 'Birth year must be 2008 or earlier (2005–2008)' },
  XII: { maxYear: 2007, minYear: 2004, label: 'Birth year must be 2007 / 2006 or earlier (2004–2007)' },
};

export function validateFullName(raw: string, fieldLabel = 'Name'): string | null {
  const name = raw.trim();
  if (name.length < 2) {
    return `${fieldLabel} must be at least 2 characters long.`;
  }
  if (name.length > 80) {
    return `${fieldLabel} must be 80 characters or fewer.`;
  }
  if (!/^[A-Za-z][A-Za-z\s.'-]{1,79}$/.test(name)) {
    return `${fieldLabel} must contain only alphabetic characters, spaces, periods, hyphens, or apostrophes.`;
  }
  const lettersOnly = name.replace(/[^A-Za-z]/g, '');
  if (lettersOnly.length < 2) {
    return `${fieldLabel} must include valid alphabetic characters.`;
  }
  if (/^([a-z])\1+$/i.test(lettersOnly)) {
    return `${fieldLabel} does not appear to be a valid name.`;
  }
  return null;
}

export function validateAdmissionDOB(dob: string, cls: ClassName): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return 'Please select a valid Date of Birth (YYYY-MM-DD).';
  }
  const [yStr, mStr, dStr] = dob.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return 'Date of Birth is not a valid calendar date.';
  }
  const limits = DOB_YEAR_LIMITS[cls];
  if (year > limits.maxYear) {
    return `Invalid Date of Birth for Class ${cls}. Minimum age requirement: ${limits.label}.`;
  }
  if (year < limits.minYear) {
    return `Date of Birth year (${year}) is outside the eligible range for Class ${cls} (${limits.minYear}–${limits.maxYear}).`;
  }
  return null;
}

export interface AuthUser {
  id: number;
  userId: string;
  role: UserRole;
  name: string;
  employeeId: string | null;
  designation: StaffDesignation | null;
  assignedClass: ClassName | null;
  assignedSection: string | null;
  assignedSubjects: string[];
}

export interface CircularItem {
  id: number;
  circularNumber: string;
  title: string;
  originalFilename: string | null;
  hasPdf: boolean;
  fileSize: number | null;
  createdAt: string;
}

export interface QuestionPaperItem {
  id: number;
  title: string;
  className: ClassName;
  section: string;
  subject: string;
  academicYear: string;
  originalFilename: string;
  fileSize: number;
  createdAt: string;
}

export interface AdmissionConfig {
  admissionsEnabled: boolean;
  academicSession: string;
  openClasses: ClassName[];
  closingDate: string | null;
  instructions: string;
  publishMeritList: boolean;
  classSeats: Record<string, number>;
}

export interface AdmissionApplication {
  id: number;
  applicationCode: string;
  studentName: string;
  fatherName: string;
  motherName: string;
  dob: string;
  gender: string;
  category?: string | null;
  address: string;
  contactPhone: string;
  contactEmail: string;
  previousSchool: string;
  previousPercentage: string;
  tcNumber: string;
  classApplied: ClassName;
  streamApplied: string | null;
  entranceMarks: number | null;
  photoUrl: string;
  hasDocument: boolean;
  documentFilename: string | null;
  status: AdmissionStatus;
  viewedByOfficer: boolean;
  viewedAt: string | null;
  rollNumber: string | null;
  allottedSection: string | null;
  enrolledStudentId: string | null;
  denialReason: string | null;
  officerNotes: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface MeritListEntry {
  id: number;
  rank: number;
  applicationCode: string;
  studentName: string;
  classApplied: ClassName;
  streamApplied: string | null;
  entranceMarks: number | null;
  previousPercentage: string;
  status: AdmissionStatus;
  withinQuota: boolean;
  seatQuota: number;
  rollNumber: string | null;
  allottedSection: string | null;
  decidedAt: string | null;
}

export function findEligibleClassesForDOB(dob: string): ClassName[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return [];
  const year = Number(dob.split('-')[0]);
  return CLASSES.filter((cls) => {
    const lim = DOB_YEAR_LIMITS[cls];
    return year >= lim.minYear && year <= lim.maxYear;
  });
}

export interface StudentRecord {
  id: number;
  studentId: string;
  rollNumber: string;
  boardNo: string | null;
  name: string;
  className: ClassName;
  section: string;
  createdAt: string;
}

export interface AttendanceRecord {
  id: number;
  studentId: string;
  studentName: string;
  rollNumber: string;
  className: ClassName;
  section: string;
  date: string;
  status: AttendanceStatus;
  updatedAt: string;
}

export interface MarkingSchemeItem {
  id: number;
  className: ClassName;
  assessmentName: string;
  maxMarks: number;
  passingMarks: number;
  displayOrder: number;
  isPublished?: boolean;
  publishedAt?: string | null;
}

export interface ScholasticGradeInfo {
  grade: string;
  gradePoint: string;
  remark: string;
}

export function computeScholasticGrade(percentage: number): ScholasticGradeInfo {
  if (percentage >= 91) return { grade: 'A1', gradePoint: '10.0', remark: 'Outstanding' };
  if (percentage >= 81) return { grade: 'A2', gradePoint: '9.0', remark: 'Excellent' };
  if (percentage >= 71) return { grade: 'B1', gradePoint: '8.0', remark: 'Very Good' };
  if (percentage >= 61) return { grade: 'B2', gradePoint: '7.0', remark: 'Good' };
  if (percentage >= 51) return { grade: 'C1', gradePoint: '6.0', remark: 'Above Average' };
  if (percentage >= 41) return { grade: 'C2', gradePoint: '5.0', remark: 'Average' };
  if (percentage >= 33) return { grade: 'D', gradePoint: '4.0', remark: 'Marginal (Pass)' };
  if (percentage >= 21) return { grade: 'E1', gradePoint: '—', remark: 'Needs Improvement' };
  return { grade: 'E2', gradePoint: '—', remark: 'Needs Improvement' };
}

export interface MarkEntry {
  id: number;
  studentId: string;
  className: ClassName;
  section: string;
  subject: string;
  assessmentId: number;
  marksObtained: number;
  updatedAt: string;
}
