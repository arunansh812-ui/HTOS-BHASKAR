import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { getApps, initializeApp } from 'firebase/app';
import {
  Bytes,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  limit,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  ALL_SUBJECTS,
  CLASSES,
  type AdmissionConfig,
  type AdmissionStatus,
  type AttendanceStatus,
  type AuthUser,
  type ClassName,
  type MeritListEntry,
  type StaffDesignation,
  type UserRole,
  computeScholasticGrade,
  getSubjectsForClassSection,
  isValidClass,
  isValidSectionForClass,
  normalizeAcademicSession,
  normalizeStudentId,
  validateAdmissionDOB,
  validateFullName,
} from './src/shared/schoolRules.ts';

const PORT = Number(process.env.PORT) || 3000;
const CHUNK_BYTES = 500 * 1024; // 500 KB chunks to stay well within Firestore's 1 MiB document limit
const PORTAL_KEY =
  process.env.PORTAL_BRIDGE_KEY ||
  'moe_portal_951302b9_b5c8_405c_bc1c_4c117be38c7d_7f3a9d2e1b8c4f60';

const firebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);
const firestore: Firestore = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

const col = (name: string) => collection(firestore, 'portals', PORTAL_KEY, name);
const colDoc = (name: string, id: string) => doc(firestore, 'portals', PORTAL_KEY, name, id);

let TOKEN_SECRET = '';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function asyncHandler(
  fn: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void> | void
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch((err: unknown) => {
      if (res.headersSent) return;
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Internal server error.';
      console.error('API Error:', err);
      res.status(500).json({ error: message });
    });
  };
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

const RETRYABLE_FIRESTORE_CODES = new Set([
  'aborted',
  'unavailable',
  'deadline-exceeded',
  'resource-exhausted',
  'internal',
]);

async function withFirestoreRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let attempt = 0;
  let lastErr: unknown;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const code = String((err as { code?: string })?.code || '').toLowerCase();
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const isRetryable =
        RETRYABLE_FIRESTORE_CODES.has(code) ||
        msg.includes('aborted') ||
        msg.includes('unavailable') ||
        msg.includes('deadline') ||
        msg.includes('resource-exhausted') ||
        msg.includes('too much contention');
      if (!isRetryable || attempt >= maxAttempts) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 40);
      const delayMs = Math.min(800, 35 * Math.pow(2, attempt - 1) + jitter);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

// Zero-contention monotonic safe-integer ID generator across horizontal Cloud Run instances
let lastGeneratedMs = 0;
let seqWithinMs = 0;
const INSTANCE_SHARD = crypto.randomInt(10, 99);

function generateUniqueId(): number {
  const now = Date.now();
  if (now > lastGeneratedMs) {
    lastGeneratedMs = now;
    seqWithinMs = 0;
  } else {
    seqWithinMs += 1;
    if (seqWithinMs >= 100) {
      lastGeneratedMs += 1;
      seqWithinMs = 0;
    }
  }
  // Offset from 2024-01-01T00:00:00Z -> ~9e14, safely below Number.MAX_SAFE_INTEGER (9.007e15)
  const relMs = lastGeneratedMs - 1704067200000;
  return relMs * 10000 + INSTANCE_SHARD * 100 + seqWithinMs;
}

// Short-lived in-memory caches (3s TTL) to absorb 200+ req/sec bursts without stale reads
const CACHE_TTL_MS = 3000;
const authUserCache = new Map<number, { user: AuthUser; expiresAt: number }>();
let admissionsCache: { value: boolean; expiresAt: number } | null = null;
let academicSessionCache: { value: string; expiresAt: number } | null = null;

function cacheAuthUser(user: AuthUser): void {
  if (authUserCache.size > 2000) {
    authUserCache.clear();
  }
  authUserCache.set(user.id, { user, expiresAt: Date.now() + CACHE_TTL_MS });
}

function invalidateAuthUser(uid: number): void {
  authUserCache.delete(uid);
}

async function getSetting(key: string): Promise<string | null> {
  if (key === 'admissions_enabled' && admissionsCache && Date.now() < admissionsCache.expiresAt) {
    return admissionsCache.value ? '1' : '0';
  }
  if (key === 'academic_session' && academicSessionCache && Date.now() < academicSessionCache.expiresAt) {
    return academicSessionCache.value;
  }
  const snap = await withFirestoreRetry(() => getDocFromServer(colDoc('settings', key)));
  if (!snap.exists()) return null;
  const val = snap.data()?.value;
  const str = typeof val === 'string' ? val : val !== undefined && val !== null ? String(val) : null;
  if (key === 'admissions_enabled') {
    admissionsCache = { value: str === '1', expiresAt: Date.now() + CACHE_TTL_MS };
  }
  if (key === 'academic_session' && str) {
    academicSessionCache = { value: str, expiresAt: Date.now() + CACHE_TTL_MS };
  }
  return str;
}

async function setSetting(key: string, value: string): Promise<void> {
  await withFirestoreRetry(() =>
    setDoc(
      colDoc('settings', key),
      {
        key,
        value,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    )
  );
  if (key === 'admissions_enabled') {
    admissionsCache = { value: value === '1', expiresAt: Date.now() + CACHE_TTL_MS };
  }
  if (key === 'academic_session') {
    academicSessionCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  }
}

async function getAcademicSession(): Promise<string> {
  const raw = await getSetting('academic_session');
  return raw && raw.trim() ? raw.trim().slice(0, 32) : '2026–2027';
}

const DEFAULT_CLASS_SEATS: Record<string, number> = {
  IV: 40,
  V: 40,
  VI: 40,
  VII: 40,
  VIII: 40,
  IX: 40,
  X: 40,
  XI: 60,
  XII: 40,
};

const DEFAULT_ADMISSION_INSTRUCTIONS =
  'Applicants selected under Provisional Allotment must report to the School Admission Cell with original Birth Certificate, Previous Class Report Card / Transfer Certificate, Aadhaar Copy, and two passport photographs within 7 working days.';

async function getAdmissionConfig(): Promise<AdmissionConfig> {
  const [enabledStr, rawCfg, academicSession] = await Promise.all([
    getSetting('admissions_enabled'),
    getSetting('admissions_config'),
    getAcademicSession(),
  ]);
  const admissionsEnabled = enabledStr === '1';
  let parsed: Partial<AdmissionConfig> = {};
  if (rawCfg) {
    try {
      parsed = JSON.parse(rawCfg) as Partial<AdmissionConfig>;
    } catch {
      parsed = {};
    }
  }
  const openClasses = Array.isArray(parsed.openClasses)
    ? parsed.openClasses.filter((c): c is ClassName => isValidClass(String(c)))
    : [...CLASSES];
  const classSeats: Record<string, number> = { ...DEFAULT_CLASS_SEATS };
  if (parsed.classSeats && typeof parsed.classSeats === 'object') {
    for (const cls of CLASSES) {
      const val = Number(parsed.classSeats[cls]);
      if (Number.isInteger(val) && val >= 0 && val <= 1000) {
        classSeats[cls] = val;
      }
    }
  }
  return {
    admissionsEnabled,
    academicSession,
    openClasses: openClasses.length > 0 ? openClasses : [...CLASSES],
    closingDate:
      typeof parsed.closingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.closingDate)
        ? parsed.closingDate
        : null,
    instructions:
      typeof parsed.instructions === 'string' && parsed.instructions.trim()
        ? parsed.instructions.trim().slice(0, 600)
        : DEFAULT_ADMISSION_INSTRUCTIONS,
    publishMeritList: Boolean(parsed.publishMeritList),
    classSeats,
  };
}

async function saveAdmissionConfig(config: Omit<AdmissionConfig, 'admissionsEnabled'>): Promise<void> {
  await setSetting('admissions_config', JSON.stringify(config));
}

function makeHashDocId(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function deleteDocRefsInBatches(refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 200) {
    const batch = writeBatch(firestore);
    for (const ref of refs.slice(i, i + 200)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

async function saveBinaryToFirestore(
  fileId: string,
  buffer: Buffer,
  mimeType: string,
  originalFilename: string
): Promise<void> {
  const totalChunks = Math.max(1, Math.ceil(buffer.length / CHUNK_BYTES));
  const fileRef = colDoc('stored_files', fileId);

  await setDoc(fileRef, {
    file_id: fileId,
    mime_type: mimeType,
    original_filename: originalFilename,
    file_size: buffer.length,
    chunk_count: totalChunks,
    created_at: new Date().toISOString(),
  });

  // Write chunks in batches of 8 (~4 MB max per commit) to stay safely under Firestore limits
  for (let i = 0; i < totalChunks; i += 8) {
    const batch = writeBatch(firestore);
    const end = Math.min(totalChunks, i + 8);
    for (let idx = i; idx < end; idx += 1) {
      const startByte = idx * CHUNK_BYTES;
      const endByte = Math.min(buffer.length, startByte + CHUNK_BYTES);
      const slice = buffer.subarray(startByte, endByte);
      const chunkRef = doc(fileRef, 'chunks', String(idx).padStart(6, '0'));
      batch.set(chunkRef, {
        index: idx,
        data: Bytes.fromUint8Array(new Uint8Array(slice)),
      });
    }
    await batch.commit();
  }
}

async function readBinaryFromFirestore(fileId: string): Promise<{
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
  fileSize: number;
} | null> {
  const safeId = path.basename(fileId);
  if (!safeId) return null;
  const fileRef = colDoc('stored_files', safeId);
  const metaSnap = await getDocFromServer(fileRef);
  if (!metaSnap.exists()) return null;

  const meta = metaSnap.data()!;
  const chunksSnap = await getDocsFromServer(collection(fileRef, 'chunks'));
  const sortedChunks = [...chunksSnap.docs].sort(
    (a, b) => Number(a.data().index ?? 0) - Number(b.data().index ?? 0)
  );

  const buffers: Buffer[] = [];
  for (const chunkDoc of sortedChunks) {
    const raw = chunkDoc.data().data;
    if (raw instanceof Bytes) {
      buffers.push(Buffer.from(raw.toUint8Array()));
    } else if (
      raw &&
      typeof (raw as { toUint8Array?: () => Uint8Array }).toUint8Array === 'function'
    ) {
      buffers.push(Buffer.from((raw as { toUint8Array: () => Uint8Array }).toUint8Array()));
    } else if (raw instanceof Uint8Array) {
      buffers.push(Buffer.from(raw));
    } else if (typeof raw === 'string') {
      buffers.push(Buffer.from(raw, 'base64'));
    }
  }

  return {
    buffer: Buffer.concat(buffers),
    mimeType: String(meta.mime_type || 'application/octet-stream'),
    originalFilename: String(meta.original_filename || safeId),
    fileSize: Number(meta.file_size || 0),
  };
}

async function deleteBinaryFromFirestore(fileId: string): Promise<void> {
  const safeId = path.basename(fileId);
  if (!safeId) return;
  const fileRef = colDoc('stored_files', safeId);
  const chunksSnap = await getDocsFromServer(collection(fileRef, 'chunks'));
  if (!chunksSnap.empty) {
    await deleteDocRefsInBatches(chunksSnap.docs.map((d) => d.ref));
  }
  await deleteDoc(fileRef);
}

async function initFirestoreDefaults(): Promise<void> {
  const envSecret = process.env.AUTH_SECRET?.trim() || '';
  if (envSecret) {
    TOKEN_SECRET = envSecret;
  } else {
    const secretRef = colDoc('settings', 'auth_secret');
    TOKEN_SECRET = await withFirestoreRetry(() =>
      runTransaction(firestore, async (tx) => {
        const snap = await tx.get(secretRef);
        if (snap.exists() && typeof snap.data()?.value === 'string' && snap.data()?.value) {
          return String(snap.data()!.value);
        }
        const generated = crypto.randomBytes(32).toString('hex');
        tx.set(secretRef, {
          key: 'auth_secret',
          value: generated,
          updatedAt: new Date().toISOString(),
        });
        return generated;
      })
    );
  }

  const admRef = colDoc('settings', 'admissions_enabled');
  await withFirestoreRetry(() =>
    runTransaction(firestore, async (tx) => {
      const snap = await tx.get(admRef);
      if (!snap.exists()) {
        tx.set(admRef, {
          key: 'admissions_enabled',
          value: '0',
          updatedAt: new Date().toISOString(),
        });
      }
    })
  );

  const sessRef = colDoc('settings', 'academic_session');
  await withFirestoreRetry(() =>
    runTransaction(firestore, async (tx) => {
      const snap = await tx.get(sessRef);
      if (!snap.exists()) {
        tx.set(sessRef, {
          key: 'academic_session',
          value: '2026–2027',
          updatedAt: new Date().toISOString(),
        });
      }
    })
  );

  await Promise.all(
    CLASSES.map(async (cls) => {
      const pubRef = colDoc('result_publications', cls);
      const pubSnap = await withFirestoreRetry(() => getDocFromServer(pubRef));
      if (!pubSnap.exists()) {
        await withFirestoreRetry(() =>
          runTransaction(firestore, async (tx) => {
            const inner = await tx.get(pubRef);
            if (!inner.exists()) {
              tx.set(pubRef, {
                class_name: cls,
                is_published: false,
                published_at: null,
                published_by: null,
              });
            }
          })
        );
      }
    })
  );

  const adminSnap = await withFirestoreRetry(() =>
    getDocsFromServer(query(col('users'), where('user_id', '==', 'MOE2026'), limit(1)))
  );
  if (adminSnap.empty) {
    const adminRef = colDoc('users', '1');
    await withFirestoreRetry(() =>
      runTransaction(firestore, async (tx) => {
        const snap = await tx.get(adminRef);
        if (!snap.exists()) {
          tx.set(adminRef, {
            id: 1,
            user_id: 'MOE2026',
            password_hash: hashPassword('202819'),
            role: 'admin',
            name: 'Ministry Administrator',
            employee_id: 'ADM-MOE-01',
            designation: null,
            assigned_class: null,
            assigned_section: null,
            assigned_subjects: [],
            created_at: new Date().toISOString(),
          });
        }
      })
    );
  }
}

interface TokenPayload {
  uid: number;
  userId: string;
  role: UserRole;
  exp: number;
}

function signToken(payload: TokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed || typeof parsed.uid !== 'number' || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface DbUserRow {
  id: number;
  user_id: string;
  user_id_lower?: string;
  password_hash: string;
  role: UserRole;
  name: string;
  employee_id: string | null;
  designation: StaffDesignation | null;
  assigned_class: ClassName | null;
  assigned_section: string | null;
  assigned_subjects: string[] | string;
  created_at: string;
}

function toAuthUser(row: DbUserRow): AuthUser {
  let subjects: string[] = [];
  if (Array.isArray(row.assigned_subjects)) {
    subjects = row.assigned_subjects.map(String);
  } else if (typeof row.assigned_subjects === 'string') {
    try {
      const parsed = JSON.parse(row.assigned_subjects || '[]');
      subjects = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      subjects = [];
    }
  }
  return {
    id: Number(row.id),
    userId: row.user_id,
    role: row.role,
    name: row.name,
    employeeId: row.employee_id ?? null,
    designation: row.designation ?? null,
    assignedClass: row.assigned_class ?? null,
    assignedSection: row.assigned_section ?? null,
    assignedSubjects: subjects,
  };
}

interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

const requireAuth = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
      return;
    }
    const cached = authUserCache.get(payload.uid);
    if (cached && Date.now() < cached.expiresAt) {
      req.authUser = cached.user;
      next();
      return;
    }
    const userSnap = await withFirestoreRetry(() =>
      getDocFromServer(colDoc('users', String(payload.uid)))
    );
    if (!userSnap.exists()) {
      invalidateAuthUser(payload.uid);
      res.status(401).json({ error: 'Account no longer exists.' });
      return;
    }
    const authUser = toAuthUser(userSnap.data() as DbUserRow);
    cacheAuthUser(authUser);
    req.authUser = authUser;
    next();
  }
);

function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }
    next();
  };
}

function decodeBase64File(input: string): { buffer: Buffer; mimeType: string } {
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(input.trim());
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1].toLowerCase(),
      buffer: Buffer.from(dataUrlMatch[2], 'base64'),
    };
  }
  return {
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(input.trim(), 'base64'),
  };
}

function formatApplicationRow(row: DocumentData) {
  return {
    id: Number(row.id),
    applicationCode: String(row.application_code),
    studentName: String(row.student_name),
    fatherName: String(row.father_name),
    motherName: String(row.mother_name),
    dob: String(row.dob),
    gender: String(row.gender),
    category: row.category ? String(row.category) : null,
    address: String(row.address),
    contactPhone: String(row.contact_phone),
    contactEmail: String(row.contact_email || ''),
    previousSchool: String(row.previous_school || ''),
    previousPercentage: String(row.previous_percentage || ''),
    tcNumber: String(row.tc_number || ''),
    classApplied: row.class_applied as ClassName,
    streamApplied: (row.stream_applied as string | null) ?? null,
    entranceMarks:
      typeof row.entrance_marks === 'number' && Number.isFinite(row.entrance_marks)
        ? Number(row.entrance_marks)
        : null,
    photoUrl: `/api/uploads/photos/${encodeURIComponent(String(row.photo_filename))}`,
    hasDocument: Boolean(row.doc_file_id),
    documentFilename: (row.doc_filename as string | null) ?? null,
    status: row.status as AdmissionStatus,
    viewedByOfficer: Boolean(row.viewed_by_officer),
    viewedAt: (row.viewed_at as string | null) ?? null,
    rollNumber: (row.roll_number as string | null) ?? null,
    allottedSection: (row.allotted_section as string | null) ?? null,
    enrolledStudentId: (row.enrolled_student_id as string | null) ?? null,
    denialReason: (row.denial_reason as string | null) ?? null,
    officerNotes: (row.officer_notes as string | null) ?? null,
    decidedAt: (row.decided_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function buildAutoMeritList(
  allRows: DocumentData[],
  classSeats: Record<string, number>
): MeritListEntry[] {
  const candidates = allRows.filter((r) => {
    const status = String(r.status || 'Pending');
    if (status === 'Denied') return false;
    const hasMarks = typeof r.entrance_marks === 'number' && Number.isFinite(r.entrance_marks);
    return hasMarks || status === 'Approved';
  });

  const byClass = new Map<ClassName, DocumentData[]>();
  for (const cls of CLASSES) {
    byClass.set(cls, []);
  }
  for (const row of candidates) {
    const cls = String(row.class_applied) as ClassName;
    if (byClass.has(cls)) {
      byClass.get(cls)!.push(row);
    }
  }

  const result: MeritListEntry[] = [];
  for (const cls of CLASSES) {
    const list = byClass.get(cls) || [];
    list.sort((a, b) => {
      const aHasMarks = typeof a.entrance_marks === 'number' && Number.isFinite(a.entrance_marks);
      const bHasMarks = typeof b.entrance_marks === 'number' && Number.isFinite(b.entrance_marks);
      if (aHasMarks !== bHasMarks) return aHasMarks ? -1 : 1;
      if (aHasMarks && bHasMarks) {
        const scoreDiff = Number(b.entrance_marks) - Number(a.entrance_marks);
        if (scoreDiff !== 0) return scoreDiff;
      }
      const aPrev = Number.parseFloat(String(a.previous_percentage || '0')) || 0;
      const bPrev = Number.parseFloat(String(b.previous_percentage || '0')) || 0;
      if (bPrev !== aPrev) return bPrev - aPrev;
      const aApp = a.status === 'Approved' ? 0 : 1;
      const bApp = b.status === 'Approved' ? 0 : 1;
      if (aApp !== bApp) return aApp - bApp;
      return Number(a.id || 0) - Number(b.id || 0);
    });

    const quota = classSeats[cls] ?? 40;
    list.forEach((r, idx) => {
      const rank = idx + 1;
      result.push({
        id: Number(r.id),
        rank,
        applicationCode: String(r.application_code),
        studentName: String(r.student_name),
        classApplied: cls,
        streamApplied: (r.stream_applied as string | null) ?? null,
        entranceMarks:
          typeof r.entrance_marks === 'number' && Number.isFinite(r.entrance_marks)
            ? Number(r.entrance_marks)
            : null,
        previousPercentage: String(r.previous_percentage || ''),
        status: r.status as AdmissionStatus,
        withinQuota: rank <= quota,
        seatQuota: quota,
        rollNumber: (r.roll_number as string | null) ?? null,
        allottedSection: (r.allotted_section as string | null) ?? null,
        decidedAt: (r.decided_at as string | null) ?? null,
      });
    });
  }
  return result;
}

function sortStudentsByRoll(a: DocumentData, b: DocumentData): number {
  const ai = Number.parseInt(String(a.roll_number), 10) || 0;
  const bi = Number.parseInt(String(b.roll_number), 10) || 0;
  if (ai !== bi) return ai - bi;
  const ar = String(a.roll_number || '');
  const br = String(b.roll_number || '');
  if (ar !== br) return ar.localeCompare(br);
  return Number(a.id || 0) - Number(b.id || 0);
}

async function startServer() {
  await initFirestoreDefaults();

  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/uploads/photos')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  // --- AUTH ---
  app.post(
    '/api/auth/login',
    asyncHandler(async (req: Request, res: Response) => {
      const userId = String(req.body?.userId || '').trim();
      const password = String(req.body?.password || '');
      const expectedRole = req.body?.expectedRole ? String(req.body.expectedRole) : null;

      if (!userId || !password) {
        res.status(400).json({ error: 'User ID and Password are required.' });
        return;
      }

      let snap = await withFirestoreRetry(() =>
        getDocsFromServer(query(col('users'), where('user_id', '==', userId), limit(1)))
      );
      if (snap.empty) {
        snap = await withFirestoreRetry(() =>
          getDocsFromServer(
            query(col('users'), where('user_id_lower', '==', userId.toLowerCase()), limit(1))
          )
        );
      }

      let row = snap.empty ? undefined : (snap.docs[0].data() as DbUserRow);
      if (!row) {
        // Fallback for legacy users and DoE-style Employee ID login for Staff/Teachers
        const allUsersSnap = await withFirestoreRetry(() => getDocsFromServer(col('users')));
        const matchedDoc = allUsersSnap.docs.find((d) => {
          const data = d.data();
          const uidMatch =
            String(data.user_id || '').trim().toLowerCase() === userId.toLowerCase();
          const staffEmpMatch =
            data.role === 'staff' &&
            String(data.employee_id || '').trim().toLowerCase() === userId.toLowerCase();
          return uidMatch || staffEmpMatch;
        });
        if (matchedDoc) {
          row = matchedDoc.data() as DbUserRow;
        }
      }

      if (!row || !verifyPassword(password, row.password_hash)) {
        res.status(401).json({ error: 'Invalid User ID or Password.' });
        return;
      }

      if (expectedRole && row.role !== expectedRole) {
        const roleLabels: Record<string, string> = {
          admin: 'Administrator',
          nodal_officer: 'Nodal Officer',
          staff: 'Staff',
        };
        res.status(403).json({
          error: `This account is registered under ${roleLabels[row.role] || row.role}. Please select the matching portal role.`,
        });
        return;
      }

      const user = toAuthUser(row);
      const token = signToken({
        uid: user.id,
        userId: user.userId,
        role: user.role,
        exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
      });

      res.json({ token, user });
    })
  );

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.authUser });
  });

  // --- PUBLIC STATUS & PHOTOS ---
  app.get(
    '/api/public/status',
    asyncHandler(async (_req: Request, res: Response) => {
      const admissionConfig = await getAdmissionConfig();
      res.json({
        admissionsEnabled: admissionConfig.admissionsEnabled,
        academicSession: admissionConfig.academicSession,
        admissionConfig,
      });
    })
  );

  app.get(
    '/api/uploads/photos/:filename',
    asyncHandler(async (req: Request, res: Response) => {
      const safeName = path.basename(String(req.params.filename || ''));
      if (!safeName) {
        res.status(404).json({ error: 'Photograph not found.' });
        return;
      }
      const file = await readBinaryFromFirestore(safeName);
      if (!file) {
        res.status(404).json({ error: 'Photograph not found.' });
        return;
      }
      res.setHeader('Content-Type', file.mimeType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(file.buffer);
    })
  );

  // --- PUBLIC CIRCULARS ---
  app.get(
    '/api/circulars',
    asyncHandler(async (_req: Request, res: Response) => {
      const snap = await getDocsFromServer(col('circulars'));
      const rows = snap.docs
        .map((d) => d.data())
        .sort((a, b) => Number(b.id) - Number(a.id));

      res.json({
        circulars: rows.map((r) => ({
          id: Number(r.id),
          circularNumber: String(r.circular_number),
          title: String(r.title),
          originalFilename: String(r.original_filename),
          hasPdf: Boolean(r.file_id),
          fileSize: Number(r.file_size),
          createdAt: String(r.created_at),
        })),
      });
    })
  );

  app.get(
    '/api/circulars/:id/download',
    asyncHandler(async (req: Request, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid circular ID.' });
        return;
      }
      const snap = await getDocFromServer(colDoc('circulars', String(id)));
      if (!snap.exists()) {
        res.status(404).json({ error: 'Circular not found.' });
        return;
      }
      const row = snap.data()!;
      const file = await readBinaryFromFirestore(String(row.file_id || ''));
      if (!file) {
        res.status(404).json({ error: 'PDF file not found on server.' });
        return;
      }
      const safeFilename = path.basename(
        String(row.original_filename || `circular-${id}.pdf`)
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeFilename.replace(/"/g, '')}"`
      );
      res.send(file.buffer);
    })
  );

  // --- PUBLIC ACADEMICS / QUESTION PAPERS ---
  app.get(
    '/api/question-papers',
    asyncHandler(async (req: Request, res: Response) => {
      const className = req.query.className ? String(req.query.className) : '';
      const section = req.query.section ? String(req.query.section) : '';

      const snap = className
        ? await withFirestoreRetry(() =>
            getDocsFromServer(query(col('question_papers'), where('class_name', '==', className)))
          )
        : await withFirestoreRetry(() => getDocsFromServer(col('question_papers')));

      let rows = snap.docs.map((d) => d.data());
      if (className && section) {
        rows = rows.filter((r) => String(r.section) === section);
      }
      rows.sort((a, b) => Number(b.id) - Number(a.id));

      res.json({
        papers: rows.map((r) => ({
          id: Number(r.id),
          title: String(r.title),
          className: r.class_name as ClassName,
          section: String(r.section),
          subject: String(r.subject),
          academicYear: String(r.academic_year),
          originalFilename: String(r.original_filename),
          fileSize: Number(r.file_size),
          createdAt: String(r.created_at),
        })),
      });
    })
  );

  app.get(
    '/api/question-papers/:id/download',
    asyncHandler(async (req: Request, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid question paper ID.' });
        return;
      }
      const snap = await getDocFromServer(colDoc('question_papers', String(id)));
      if (!snap.exists()) {
        res.status(404).json({ error: 'Question paper not found.' });
        return;
      }
      const row = snap.data()!;
      const file = await readBinaryFromFirestore(String(row.file_id || ''));
      if (!file) {
        res.status(404).json({ error: 'Question paper file missing on server.' });
        return;
      }
      const safeFilename = path.basename(
        String(row.original_filename || `question-paper-${id}.pdf`)
      );
      res.setHeader('Content-Type', file.mimeType || 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeFilename.replace(/"/g, '')}"`
      );
      res.send(file.buffer);
    })
  );

  // --- PUBLIC ADMISSIONS ---
  app.post(
    '/api/admissions/apply',
    asyncHandler(async (req: Request, res: Response) => {
      const admissionConfig = await getAdmissionConfig();
      if (!admissionConfig.admissionsEnabled) {
        res.status(403).json({
          error: 'Registration Closed. The Nodal Officer has currently closed new admissions.',
        });
        return;
      }

      const studentName = String(req.body?.studentName || '').trim();
      const fatherName = String(req.body?.fatherName || '').trim();
      const motherName = String(req.body?.motherName || '').trim();
      const dob = String(req.body?.dob || '').trim();
      const gender = String(req.body?.gender || '').trim();
      const categoryRaw = req.body?.category ? String(req.body.category).trim().slice(0, 64) : '';
      const category = categoryRaw || null;
      const address = String(req.body?.address || '').trim();
      const contactPhone = String(req.body?.contactPhone || '').trim();
      const contactEmail = String(req.body?.contactEmail || '').trim();
      const previousSchool = String(req.body?.previousSchool || '').trim();
      const previousPercentage = String(req.body?.previousPercentage || '').trim();
      const tcNumber = String(req.body?.tcNumber || '').trim();
      const classApplied = String(req.body?.classApplied || '').trim();
      const streamAppliedRaw = req.body?.streamApplied ? String(req.body.streamApplied).trim() : '';
      const photoBase64 = String(req.body?.photoBase64 || '').trim();
      const documentBase64 = req.body?.documentBase64 ? String(req.body.documentBase64).trim() : '';
      const documentFilenameRaw = req.body?.documentFilename
        ? path.basename(String(req.body.documentFilename).trim())
        : '';

      if (!isValidClass(classApplied)) {
        res.status(400).json({ error: 'Please select a valid class (IV to XII).' });
        return;
      }
      if (!admissionConfig.openClasses.includes(classApplied)) {
        res.status(403).json({
          error: `Admissions for Class ${classApplied} are currently not open in the Nodal Officer registry.`,
        });
        return;
      }

      const nameErr =
        validateFullName(studentName, "Student's Full Name") ||
        validateFullName(fatherName, "Father's Name") ||
        validateFullName(motherName, "Mother's Name");
      if (nameErr) {
        res.status(400).json({ error: nameErr });
        return;
      }

      const dobErr = validateAdmissionDOB(dob, classApplied);
      if (dobErr) {
        res.status(400).json({ error: dobErr });
        return;
      }

      if (!['Male', 'Female', 'Other'].includes(gender)) {
        res.status(400).json({ error: 'Please select a valid gender.' });
        return;
      }

      if (address.length < 5) {
        res.status(400).json({ error: 'Please enter a complete residential address.' });
        return;
      }

      if (!/^[+\d][\d\s-]{8,16}$/.test(contactPhone)) {
        res
          .status(400)
          .json({ error: 'Please enter a valid contact phone number (at least 9 digits).' });
        return;
      }

      if (previousPercentage !== '') {
        const pct = Number(previousPercentage);
        if (Number.isNaN(pct) || pct < 0 || pct > 100) {
          res.status(400).json({ error: 'Previous class percentage must be between 0 and 100.' });
          return;
        }
      }

      if (!photoBase64) {
        res
          .status(400)
          .json({ error: 'Student photograph is required. Please capture or upload a photo.' });
        return;
      }

      const { buffer, mimeType } = decodeBase64File(photoBase64);
      if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) {
        res.status(400).json({ error: 'Invalid or oversized student photograph (max 8 MB).' });
        return;
      }

      let ext = 'jpg';
      let finalMime = 'image/jpeg';
      if (mimeType.includes('png')) {
        ext = 'png';
        finalMime = 'image/png';
      } else if (mimeType.includes('webp')) {
        ext = 'webp';
        finalMime = 'image/webp';
      }

      const photoFilename = `photo_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
      await saveBinaryToFirestore(photoFilename, buffer, finalMime, photoFilename);

      let docFileId: string | null = null;
      let docFilename: string | null = null;
      if (documentBase64) {
        const docParsed = decodeBase64File(documentBase64);
        if (docParsed.buffer.length === 0 || docParsed.buffer.length > 6 * 1024 * 1024) {
          res.status(400).json({ error: 'Supporting document must be 6 MB or smaller.' });
          return;
        }
        const docExt = docParsed.mimeType.includes('pdf')
          ? 'pdf'
          : docParsed.mimeType.includes('png')
            ? 'png'
            : docParsed.mimeType.includes('webp')
              ? 'webp'
              : 'jpg';
        docFileId = `admdoc_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${docExt}`;
        docFilename = documentFilenameRaw || `supporting-document.${docExt}`;
        await saveBinaryToFirestore(
          docFileId,
          docParsed.buffer,
          docParsed.mimeType || 'application/pdf',
          docFilename
        );
      }

      const sessionYearMatch = /\d{4}/.exec(admissionConfig.academicSession);
      const codeYear = sessionYearMatch ? sessionYearMatch[0] : '2026';
      const appId = generateUniqueId();
      const appCode = `ADM-${codeYear}-${String(appId % 1000000).padStart(6, '0')}`;
      const createdAt = new Date().toISOString();
      const streamApplied =
        (classApplied === 'XI' || classApplied === 'XII') && streamAppliedRaw
          ? streamAppliedRaw.slice(0, 48)
          : null;

      const record: DocumentData = {
        id: appId,
        application_code: appCode,
        student_name: studentName,
        father_name: fatherName,
        mother_name: motherName,
        dob,
        gender,
        category,
        address,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        previous_school: previousSchool,
        previous_percentage: previousPercentage,
        tc_number: tcNumber,
        class_applied: classApplied,
        stream_applied: streamApplied,
        entrance_marks: null,
        photo_filename: photoFilename,
        doc_file_id: docFileId,
        doc_filename: docFilename,
        status: 'Pending',
        viewed_by_officer: false,
        viewed_at: null,
        roll_number: null,
        allotted_section: null,
        enrolled_student_id: null,
        denial_reason: null,
        officer_notes: null,
        decided_at: null,
        decided_by: null,
        created_at: createdAt,
      };

      await withFirestoreRetry(() =>
        setDoc(colDoc('admission_applications', String(appId)), record)
      );
      res.status(201).json({ application: formatApplicationRow(record) });
    })
  );

  app.post(
    '/api/admissions/status',
    asyncHandler(async (req: Request, res: Response) => {
      const applicationCode = String(req.body?.applicationCode || '').trim().toUpperCase();
      const studentName = String(req.body?.studentName || '').trim();
      const fatherName = String(req.body?.fatherName || '').trim();
      const motherName = String(req.body?.motherName || '').trim();
      const dob = String(req.body?.dob || '').trim();
      const classApplied = String(req.body?.classApplied || '').trim();

      if (!dob) {
        res.status(400).json({ error: 'Date of Birth is required to track your application.' });
        return;
      }

      const snap = await withFirestoreRetry(() =>
        getDocsFromServer(query(col('admission_applications'), where('dob', '==', dob)))
      );

      let matches: DocumentData[] = [];
      if (applicationCode) {
        matches = snap.docs
          .map((d) => d.data())
          .filter((r) => String(r.application_code || '').trim().toUpperCase() === applicationCode)
          .sort((a, b) => Number(b.id) - Number(a.id));
      } else {
        if (!studentName || !fatherName || !classApplied) {
          res.status(400).json({
            error:
              'Enter Application ID + Date of Birth, OR Student Name, Father Name, Date of Birth, and Class.',
          });
          return;
        }
        const sNorm = studentName.toLowerCase();
        const fNorm = fatherName.toLowerCase();
        const mNorm = motherName.toLowerCase();

        matches = snap.docs
          .map((d) => d.data())
          .filter(
            (r) =>
              String(r.class_applied || '') === classApplied &&
              String(r.student_name || '').trim().toLowerCase() === sNorm &&
              String(r.father_name || '').trim().toLowerCase() === fNorm &&
              (!mNorm || String(r.mother_name || '').trim().toLowerCase() === mNorm)
          )
          .sort((a, b) => Number(b.id) - Number(a.id));
      }

      if (matches.length === 0) {
        res.status(404).json({
          error:
            'No admission application matched those details. Please verify your Application ID / Name and Date of Birth.',
        });
        return;
      }

      res.json({ application: formatApplicationRow(matches[0]) });
    })
  );

  app.post(
    '/api/admissions/resubmit',
    asyncHandler(async (req: Request, res: Response) => {
      const applicationCode = String(req.body?.applicationCode || '').trim().toUpperCase();
      const dob = String(req.body?.dob || '').trim();
      if (!applicationCode || !dob) {
        res.status(400).json({ error: 'Application ID and Date of Birth are required.' });
        return;
      }

      const snap = await withFirestoreRetry(() =>
        getDocsFromServer(
          query(
            col('admission_applications'),
            where('application_code', '==', applicationCode),
            limit(1)
          )
        )
      );
      if (snap.empty) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      const docSnap = snap.docs[0];
      const existing = docSnap.data()!;
      if (String(existing.dob) !== dob) {
        res.status(403).json({ error: 'Date of Birth does not match this Application ID.' });
        return;
      }
      if (existing.status !== 'Correction Needed') {
        res.status(400).json({
          error: 'Only applications marked as Correction Needed by the Nodal Officer can be edited.',
        });
        return;
      }

      const studentName = String(req.body?.studentName ?? existing.student_name).trim();
      const fatherName = String(req.body?.fatherName ?? existing.father_name).trim();
      const motherName = String(req.body?.motherName ?? existing.mother_name).trim();
      const address = String(req.body?.address ?? existing.address).trim();
      const contactPhone = String(req.body?.contactPhone ?? existing.contact_phone).trim();
      const contactEmail = String(req.body?.contactEmail ?? existing.contact_email ?? '').trim();
      const previousSchool = String(req.body?.previousSchool ?? existing.previous_school ?? '').trim();
      const previousPercentage = String(
        req.body?.previousPercentage ?? existing.previous_percentage ?? ''
      ).trim();
      const tcNumber = String(req.body?.tcNumber ?? existing.tc_number ?? '').trim();

      const nameErr =
        validateFullName(studentName, "Student's Full Name") ||
        validateFullName(fatherName, "Father's Name") ||
        validateFullName(motherName, "Mother's Name");
      if (nameErr) {
        res.status(400).json({ error: nameErr });
        return;
      }
      if (address.length < 5) {
        res.status(400).json({ error: 'Please enter a complete residential address.' });
        return;
      }
      if (!/^[+\d][\d\s-]{8,16}$/.test(contactPhone)) {
        res.status(400).json({ error: 'Please enter a valid contact phone number.' });
        return;
      }

      const updates: DocumentData = {
        student_name: studentName,
        father_name: fatherName,
        mother_name: motherName,
        address,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        previous_school: previousSchool,
        previous_percentage: previousPercentage,
        tc_number: tcNumber,
        status: 'Pending',
        viewed_by_officer: false,
        officer_notes: null,
      };

      if (req.body?.documentBase64) {
        const docParsed = decodeBase64File(String(req.body.documentBase64));
        if (docParsed.buffer.length > 0 && docParsed.buffer.length <= 6 * 1024 * 1024) {
          const docExt = docParsed.mimeType.includes('pdf')
            ? 'pdf'
            : docParsed.mimeType.includes('png')
              ? 'png'
              : 'jpg';
          const newDocId = `admdoc_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${docExt}`;
          const newDocName = req.body.documentFilename
            ? path.basename(String(req.body.documentFilename))
            : `document.${docExt}`;
          await saveBinaryToFirestore(
            newDocId,
            docParsed.buffer,
            docParsed.mimeType || 'application/pdf',
            newDocName
          );
          updates.doc_file_id = newDocId;
          updates.doc_filename = newDocName;
        }
      }

      await withFirestoreRetry(() => updateDoc(docSnap.ref, updates));
      res.json({ application: formatApplicationRow({ ...existing, ...updates }) });
    })
  );

  app.get(
    '/api/admissions/merit-list',
    asyncHandler(async (_req: Request, res: Response) => {
      const cfg = await getAdmissionConfig();
      if (!cfg.publishMeritList) {
        res.json({ published: false, academicSession: cfg.academicSession, entries: [] });
        return;
      }
      const snap = await withFirestoreRetry(() => getDocsFromServer(col('admission_applications')));
      const allRows = snap.docs.map((d) => d.data());
      const entries = buildAutoMeritList(allRows, cfg.classSeats);
      res.json({ published: true, academicSession: cfg.academicSession, entries });
    })
  );

  // --- PUBLIC STUDENT ATTENDANCE & RESULTS ---
  app.get(
    '/api/student/attendance',
    asyncHandler(async (req: Request, res: Response) => {
      const studentId = normalizeStudentId(String(req.query.studentId || ''));
      const className = String(req.query.className || '').trim();
      const section = String(req.query.section || '').trim();

      if (!studentId || !isValidClass(className) || !isValidSectionForClass(className, section)) {
        res.status(400).json({ error: 'Valid Student ID, Class, and Section are required.' });
        return;
      }

      const stuSnap = await getDocsFromServer(
        query(col('students'), where('student_id', '==', studentId))
      );
      let student = stuSnap.docs
        .map((d) => d.data())
        .find((s) => s.class_name === className && s.section === section);

      if (!student) {
        const classStudentsSnap = await getDocsFromServer(
          query(col('students'), where('class_name', '==', className))
        );
        student = classStudentsSnap.docs
          .map((d) => d.data())
          .find(
            (s) =>
              s.section === section &&
              normalizeStudentId(String(s.student_id)).toLowerCase() === studentId.toLowerCase()
          );
      }

      if (!student) {
        res.status(404).json({
          error: `No student found with Student ID "${studentId}" in Class ${className}-${section}.`,
        });
        return;
      }

      const attSnap = await getDocsFromServer(
        query(col('attendance'), where('class_name', '==', className))
      );
      const records = attSnap.docs
        .map((d) => d.data())
        .filter(
          (r) =>
            r.section === section &&
            normalizeStudentId(String(r.student_id)).toLowerCase() === studentId.toLowerCase()
        )
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .map((r) => ({
          date: String(r.date),
          status: r.status as AttendanceStatus,
          updated_at: String(r.updated_at),
        }));

      const total = records.length;
      const present = records.filter((r) => r.status === 'Present').length;
      const absent = records.filter((r) => r.status === 'Absent').length;
      const leave = records.filter((r) => r.status === 'Leave').length;

      res.json({
        student: {
          studentId: String(student.student_id),
          rollNumber: String(student.roll_number),
          name: String(student.name),
          className: student.class_name as ClassName,
          section: String(student.section),
        },
        summary: {
          total,
          present,
          absent,
          leave,
          percentage: total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0,
        },
        records,
      });
    })
  );

  app.get(
    '/api/student/marking-scheme',
    asyncHandler(async (req: Request, res: Response) => {
      const className = String(req.query.className || '').trim();
      const section = req.query.section ? String(req.query.section).trim() : 'A';
      if (!isValidClass(className)) {
        res.status(400).json({ error: 'Valid Class (IV to XII) is required.' });
        return;
      }

      const [schemesSnap, pubSnap] = await Promise.all([
        getDocsFromServer(
          query(col('marking_schemes'), where('class_name', '==', className))
        ),
        getDocFromServer(colDoc('result_publications', className)),
      ]);

      const schemes = schemesSnap.docs
        .map((d) => d.data())
        .sort((a, b) => {
          const ordDiff = Number(a.display_order || 0) - Number(b.display_order || 0);
          return ordDiff !== 0 ? ordDiff : Number(a.id) - Number(b.id);
        });

      const pubData = pubSnap.exists() ? pubSnap.data() : undefined;
      const wholePublished = Boolean(pubData?.is_published);
      const anyPublished = schemes.some((s) =>
        typeof s.is_published === 'boolean' ? s.is_published : wholePublished
      );

      res.json({
        className,
        subjects: getSubjectsForClassSection(className, section),
        isPublished: wholePublished,
        anyPublished,
        publishedAt: (pubData?.published_at as string | null) ?? null,
        schemes: schemes.map((s) => {
          const itemPublished =
            typeof s.is_published === 'boolean' ? s.is_published : wholePublished;
          return {
            id: Number(s.id),
            className: s.class_name as ClassName,
            assessmentName: String(s.assessment_name),
            maxMarks: Number(s.max_marks),
            passingMarks: Number(s.passing_marks),
            displayOrder: Number(s.display_order),
            isPublished: itemPublished,
            publishedAt: itemPublished
              ? (s.published_at as string | null) ?? (pubData?.published_at as string | null) ?? null
              : null,
          };
        }),
      });
    })
  );

  app.get(
    '/api/student/results',
    asyncHandler(async (req: Request, res: Response) => {
      const studentId = normalizeStudentId(String(req.query.studentId || ''));
      const className = String(req.query.className || '').trim();
      const section = String(req.query.section || '').trim();
      const boardNo = normalizeStudentId(String(req.query.boardNo || ''));
      const requestedSession = String(req.query.academicSession || '').trim();

      if (!studentId || !isValidClass(className) || !isValidSectionForClass(className, section)) {
        res.status(400).json({ error: 'Valid Student ID, Class, and Section are required.' });
        return;
      }

      const isSeniorBoard = className === 'X' || className === 'XI' || className === 'XII';
      if (isSeniorBoard && !boardNo) {
        res.status(400).json({ error: 'Board No. is required for Classes X to XII results.' });
        return;
      }

      const stuSnap = await withFirestoreRetry(() =>
        getDocsFromServer(query(col('students'), where('student_id', '==', studentId)))
      );
      let student = stuSnap.docs
        .map((d) => d.data())
        .find((s) => s.class_name === className && s.section === section);

      if (!student) {
        const classStuSnap = await withFirestoreRetry(() =>
          getDocsFromServer(query(col('students'), where('class_name', '==', className)))
        );
        student = classStuSnap.docs
          .map((d) => d.data())
          .find(
            (s) =>
              s.section === section &&
              normalizeStudentId(String(s.student_id)).toLowerCase() === studentId.toLowerCase()
          );
      }

      if (!student) {
        res.status(404).json({
          error: `No student record found for Student ID "${studentId}" in Class ${className}-${section}.`,
        });
        return;
      }

      if (
        isSeniorBoard &&
        normalizeStudentId(String(student.board_no || '')).toLowerCase() !== boardNo.toLowerCase()
      ) {
        res.status(404).json({
          error: 'Board No. does not match the student record for this Class and Section.',
        });
        return;
      }

      const [activeSession, pubSnap, schemesSnap, marksSnap, attSnap] = await Promise.all([
        getAcademicSession(),
        withFirestoreRetry(() => getDocFromServer(colDoc('result_publications', className))),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('marking_schemes'), where('class_name', '==', className)))
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('marks'), where('class_name', '==', className)))
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('attendance'), where('class_name', '==', className)))
        ),
      ]);

      const effectiveSession = requestedSession || activeSession;
      const targetSessNorm = normalizeAcademicSession(effectiveSession);
      const activeSessNorm = normalizeAcademicSession(activeSession);

      const pub = pubSnap.exists() ? pubSnap.data() : undefined;
      const wholeClassPublished = Boolean(pub?.is_published);

      const allSchemes = schemesSnap.docs
        .map((d) => d.data())
        .sort((a, b) => {
          const ordDiff = Number(a.display_order || 0) - Number(b.display_order || 0);
          return ordDiff !== 0 ? ordDiff : Number(a.id) - Number(b.id);
        });

      if (allSchemes.length === 0) {
        res.json({
          published: false,
          academicSession: effectiveSession,
          message: `No marking scheme assessments have been configured for Class ${className}.`,
        });
        return;
      }

      const publishedSchemes = allSchemes.filter((s) =>
        typeof s.is_published === 'boolean' ? s.is_published : wholeClassPublished
      );
      const pendingSchemes = allSchemes.filter((s) =>
        typeof s.is_published === 'boolean' ? !s.is_published : !wholeClassPublished
      );

      if (publishedSchemes.length === 0) {
        res.json({
          published: false,
          academicSession: effectiveSession,
          message: `Results for Class ${className} have not been published by the Administrator yet.`,
        });
        return;
      }

      const markRowsAll = marksSnap.docs
        .map((d) => d.data())
        .filter(
          (m) =>
            m.section === section &&
            normalizeStudentId(String(m.student_id)).toLowerCase() === studentId.toLowerCase()
        );

      const markRows = markRowsAll.filter((m) => {
        if (m.academic_session) {
          return normalizeAcademicSession(String(m.academic_session)) === targetSessNorm;
        }
        return targetSessNorm === activeSessNorm;
      });

      if (targetSessNorm !== activeSessNorm && markRows.length === 0) {
        res.json({
          published: false,
          academicSession: effectiveSession,
          message: `No published examination results were found for Academic Session ${effectiveSession} in Class ${className}-${section}.`,
        });
        return;
      }

      const publicationScope: 'full' | 'partial' =
        pendingSchemes.length === 0 ? 'full' : 'partial';

      const publishedDates = publishedSchemes
        .map((s) => (s.published_at as string | null) || null)
        .filter((d): d is string => Boolean(d));
      if (pub?.published_at) publishedDates.push(String(pub.published_at));
      publishedDates.sort();
      const latestPublishedAt =
        publishedDates.length > 0 ? publishedDates[publishedDates.length - 1] : null;

      const markMap = new Map<string, number>();
      for (const m of markRows) {
        markMap.set(`${m.subject}::${m.assessment_id}`, Number(m.marks_obtained));
      }

      const publishedSchemeIds = new Set(publishedSchemes.map((s) => Number(s.id)));
      const baseSubjects = getSubjectsForClassSection(className, section);
      const markedSubjects = Array.from(
        new Set(
          markRows
            .filter((m) => publishedSchemeIds.has(Number(m.assessment_id)))
            .map((m) => String(m.subject))
        )
      );
      const subjects = [
        ...baseSubjects,
        ...markedSubjects.filter((s) => !baseSubjects.includes(s)),
      ];

      const subjectResults = subjects.map((subject) => {
        let totalObtained = 0;
        let totalMax = 0;
        let totalPassing = 0;
        let hasAnyMark = false;
        let allAssessmentsPassed = true;

        const assessments = publishedSchemes.map((sch) => {
          const schId = Number(sch.id);
          const maxMarks = Number(sch.max_marks);
          const passingMarks = Number(sch.passing_marks);
          const val = markMap.get(`${subject}::${schId}`);
          totalMax += maxMarks;
          totalPassing += passingMarks;
          if (val !== undefined) {
            hasAnyMark = true;
            totalObtained += val;
            if (val < passingMarks) {
              allAssessmentsPassed = false;
            }
          }
          return {
            assessmentId: schId,
            assessmentName: String(sch.assessment_name),
            maxMarks,
            passingMarks,
            marksObtained: val ?? null,
            passed: val !== undefined ? val >= passingMarks : null,
          };
        });

        const subjectPct =
          hasAnyMark && totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(2)) : null;
        const gradeInfo = subjectPct !== null ? computeScholasticGrade(subjectPct) : null;
        const subjectPassed = hasAnyMark && totalObtained >= totalPassing && allAssessmentsPassed;

        return {
          subject,
          assessments,
          totalObtained: hasAnyMark ? Number(totalObtained.toFixed(2)) : null,
          totalMax,
          totalPassing,
          percentage: subjectPct,
          grade: gradeInfo?.grade ?? null,
          gradePoint: gradeInfo?.gradePoint ?? null,
          remark: gradeInfo?.remark ?? null,
          status: !hasAnyMark ? 'Not Entered' : subjectPassed ? 'Pass' : 'Needs Improvement',
        };
      });

      const enteredSubjects = subjectResults.filter((s) => s.totalObtained !== null);
      const failedSubjects = enteredSubjects.filter((s) => s.status === 'Needs Improvement');
      const grandObtained = enteredSubjects.reduce((acc, s) => acc + (s.totalObtained ?? 0), 0);
      const grandMax = enteredSubjects.reduce((acc, s) => acc + s.totalMax, 0);
      const percentage = grandMax > 0 ? Number(((grandObtained / grandMax) * 100).toFixed(2)) : 0;
      const overallGradeInfo = enteredSubjects.length > 0 ? computeScholasticGrade(percentage) : null;

      let overallStatus = 'RESULT AWAITED';
      if (enteredSubjects.length > 0) {
        if (failedSubjects.length === 0) {
          overallStatus =
            publicationScope === 'full' ? 'PASS / PROMOTED' : 'QUALIFIED (ASSESSMENT PUBLISHED)';
        } else if (failedSubjects.length <= 2) {
          overallStatus = 'COMPARTMENT';
        } else {
          overallStatus = 'ESSENTIAL REPEAT';
        }
      }

      const attRows = attSnap.docs
        .map((d) => d.data())
        .filter(
          (r) =>
            r.section === section &&
            normalizeStudentId(String(r.student_id)).toLowerCase() === studentId.toLowerCase()
        );
      const attTotal = attRows.length;
      const attPresent = attRows.filter((r) => r.status === 'Present').length;
      const attAbsent = attRows.filter((r) => r.status === 'Absent').length;
      const attLeave = attRows.filter((r) => r.status === 'Leave').length;

      res.json({
        published: true,
        publicationScope,
        publishedAt: latestPublishedAt,
        academicSession: effectiveSession,
        student: {
          studentId: String(student.student_id),
          rollNumber: String(student.roll_number),
          boardNo: (student.board_no as string | null) ?? null,
          name: String(student.name),
          className: student.class_name as ClassName,
          section: String(student.section),
        },
        attendance: {
          total: attTotal,
          present: attPresent,
          absent: attAbsent,
          leave: attLeave,
          percentage: attTotal > 0 ? Number(((attPresent / attTotal) * 100).toFixed(1)) : null,
        },
        schemes: publishedSchemes.map((s) => ({
          id: Number(s.id),
          assessmentName: String(s.assessment_name),
          maxMarks: Number(s.max_marks),
          passingMarks: Number(s.passing_marks),
        })),
        pendingAssessments: pendingSchemes.map((s) => ({
          id: Number(s.id),
          assessmentName: String(s.assessment_name),
          maxMarks: Number(s.max_marks),
        })),
        subjectResults,
        summary: {
          grandObtained: Number(grandObtained.toFixed(2)),
          grandMax,
          percentage,
          overallGrade: overallGradeInfo?.grade ?? '—',
          overallGradePoint: overallGradeInfo?.gradePoint ?? '—',
          overallRemark: overallGradeInfo?.remark ?? 'Pending',
          overallStatus,
          compartmentSubjects: failedSubjects.map((f) => f.subject),
        },
      });
    })
  );

  // --- NODAL OFFICER ROUTES (Admission Process Control Registry) ---
  app.get(
    '/api/nodal/admissions/settings',
    requireAuth,
    requireRole('nodal_officer'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const config = await getAdmissionConfig();
      res.json({ admissionsEnabled: config.admissionsEnabled, config });
    })
  );

  app.post(
    '/api/nodal/admissions/toggle',
    requireAuth,
    requireRole('nodal_officer'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const enabled = Boolean(req.body?.enabled);
      await setSetting('admissions_enabled', enabled ? '1' : '0');
      const config = await getAdmissionConfig();
      res.json({ admissionsEnabled: enabled, config });
    })
  );

  app.put(
    '/api/nodal/admissions/config',
    requireAuth,
    requireRole('nodal_officer'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const current = await getAdmissionConfig();
      const openClassesRaw = Array.isArray(req.body?.openClasses)
        ? req.body.openClasses.map(String).filter((c: string) => isValidClass(c))
        : current.openClasses;
      const closingDateRaw = req.body?.closingDate ? String(req.body.closingDate).trim() : null;
      const closingDate = closingDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(closingDateRaw) ? closingDateRaw : null;
      const instructions =
        String(req.body?.instructions ?? current.instructions).trim().slice(0, 600) ||
        DEFAULT_ADMISSION_INSTRUCTIONS;
      const publishMeritList =
        typeof req.body?.publishMeritList === 'boolean'
          ? req.body.publishMeritList
          : current.publishMeritList;
      const classSeats: Record<string, number> = { ...current.classSeats };
      if (req.body?.classSeats && typeof req.body.classSeats === 'object') {
        for (const cls of CLASSES) {
          const v = Number(req.body.classSeats[cls]);
          if (Number.isInteger(v) && v >= 0 && v <= 1000) {
            classSeats[cls] = v;
          }
        }
      }
      await saveAdmissionConfig({
        academicSession: current.academicSession,
        openClasses: openClassesRaw as ClassName[],
        closingDate,
        instructions,
        publishMeritList,
        classSeats,
      });
      const updated = await getAdmissionConfig();
      res.json({ config: updated });
    })
  );

  app.get(
    '/api/nodal/admissions',
    requireAuth,
    requireRole('nodal_officer'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const status = String(req.query.status || 'All');
      const [snap, cfg] = await Promise.all([
        withFirestoreRetry(() => getDocsFromServer(col('admission_applications'))),
        getAdmissionConfig(),
      ]);
      const allRows = snap.docs
        .map((d) => d.data())
        .sort((a, b) => Number(b.id) - Number(a.id));

      const allowedStatuses = ['Pending', 'Waitlisted', 'Correction Needed', 'Approved', 'Denied'];
      const filteredRows = allowedStatuses.includes(status)
        ? allRows.filter((r) => r.status === status)
        : allRows;

      const counts = {
        total: allRows.length,
        pending: allRows.filter((r) => r.status === 'Pending').length,
        waitlisted: allRows.filter((r) => r.status === 'Waitlisted').length,
        correctionNeeded: allRows.filter((r) => r.status === 'Correction Needed').length,
        approved: allRows.filter((r) => r.status === 'Approved').length,
        denied: allRows.filter((r) => r.status === 'Denied').length,
      };

      const meritList = buildAutoMeritList(allRows, cfg.classSeats);

      res.json({
        applications: filteredRows.map(formatApplicationRow),
        counts,
        meritList,
      });
    })
  );

  app.get(
    '/api/nodal/admissions/:id',
    requireAuth,
    requireRole('nodal_officer'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      const ref = colDoc('admission_applications', String(id));
      const snap = await withFirestoreRetry(() => getDocFromServer(ref));
      if (!snap.exists()) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      const data = snap.data()!;
      if (!data.viewed_by_officer) {
        const now = new Date().toISOString();
        await withFirestoreRetry(() =>
          updateDoc(ref, {
            viewed_by_officer: true,
            viewed_at: now,
          })
        );
        data.viewed_by_officer = true;
        data.viewed_at = now;
      }
      res.json({ application: formatApplicationRow(data) });
    })
  );

  app.get(
    '/api/nodal/admissions/:id/document',
    requireAuth,
    requireRole('nodal_officer'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      const snap = await withFirestoreRetry(() =>
        getDocFromServer(colDoc('admission_applications', String(id)))
      );
      if (!snap.exists() || !snap.data()?.doc_file_id) {
        res.status(404).json({ error: 'Supporting document not attached.' });
        return;
      }
      const row = snap.data()!;
      const file = await readBinaryFromFirestore(String(row.doc_file_id));
      if (!file) {
        res.status(404).json({ error: 'Document file is missing from storage.' });
        return;
      }
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${String(row.doc_filename || file.originalFilename).replace(/"/g, '')}"`
      );
      res.send(file.buffer);
    })
  );

  app.post(
    '/api/nodal/admissions/:id/review',
    requireAuth,
    requireRole('nodal_officer'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      const nextStatus = String(req.body?.status || '').trim();
      const officerNotes = String(req.body?.officerNotes || '').trim().slice(0, 500);
      if (!['Pending', 'Waitlisted', 'Correction Needed'].includes(nextStatus)) {
        res.status(400).json({ error: 'Valid review status (Pending, Waitlisted, or Correction Needed) required.' });
        return;
      }

      const ref = colDoc('admission_applications', String(id));
      const snap = await withFirestoreRetry(() => getDocFromServer(ref));
      if (!snap.exists()) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      const existing = snap.data()!;
      if (existing.status === 'Approved') {
        res.status(400).json({ error: 'Approved applications with allotted roll numbers cannot be moved back.' });
        return;
      }

      const now = new Date().toISOString();
      const updates: DocumentData = {
        status: nextStatus,
        officer_notes: officerNotes || null,
        viewed_by_officer: true,
        viewed_at: existing.viewed_at || now,
        decided_at: now,
        decided_by: req.authUser!.id,
      };
      if (nextStatus === 'Pending') {
        updates.denial_reason = null;
      }

      await withFirestoreRetry(() => updateDoc(ref, updates));
      res.json({ application: formatApplicationRow({ ...existing, ...updates }) });
    })
  );

  app.post(
    '/api/nodal/admissions/:id/marks',
    requireAuth,
    requireRole('nodal_officer'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }

      const rawMarks = req.body?.marks;
      let normalizedMarks: number | null = null;
      if (rawMarks !== null && rawMarks !== undefined && rawMarks !== '') {
        const num = Number(rawMarks);
        if (!Number.isFinite(num) || num < 0 || num > 100) {
          res.status(400).json({ error: 'Nodal Officer evaluation marks must be between 0 and 100.' });
          return;
        }
        normalizedMarks = Number(num.toFixed(2));
      }

      const ref = colDoc('admission_applications', String(id));
      const snap = await withFirestoreRetry(() => getDocFromServer(ref));
      if (!snap.exists()) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      const existing = snap.data()!;
      if (existing.status === 'Denied') {
        res.status(400).json({
          error: 'Denied applications cannot be scored directly. Reopen the application to Pending first.',
        });
        return;
      }

      const now = new Date().toISOString();
      const updates: DocumentData = {
        entrance_marks: normalizedMarks,
        viewed_by_officer: true,
        viewed_at: existing.viewed_at || now,
        decided_at: now,
        decided_by: req.authUser!.id,
      };
      await withFirestoreRetry(() => updateDoc(ref, updates));
      res.json({ application: formatApplicationRow({ ...existing, ...updates }) });
    })
  );

  app.post(
    '/api/nodal/admissions/:id/approve',
    requireAuth,
    requireRole('nodal_officer'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      const sectionRaw = req.body?.section ? String(req.body.section).trim().toUpperCase() : 'A';
      const officerNotes = req.body?.officerNotes ? String(req.body.officerNotes).trim().slice(0, 500) : null;
      const autoEnroll = Boolean(req.body?.autoEnroll);
      const hasMarksOverride =
        req.body?.entranceMarks !== undefined &&
        req.body?.entranceMarks !== null &&
        req.body?.entranceMarks !== '';
      let marksOverride: number | null = null;
      if (hasMarksOverride) {
        const parsed = Number(req.body.entranceMarks);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
          res.status(400).json({ error: 'Evaluation marks must be between 0 and 100.' });
          return;
        }
        marksOverride = Number(parsed.toFixed(2));
      }

      const appRef = colDoc('admission_applications', String(id));
      const academicSession = await getAcademicSession();
      const sessionYearMatch = /\d{4}/.exec(academicSession);
      const rollYear = sessionYearMatch ? sessionYearMatch[0] : '2026';

      const result = await withFirestoreRetry(() =>
        runTransaction(firestore, async (tx) => {
          const appSnap = await tx.get(appRef);
          if (!appSnap.exists()) {
            throw new HttpError(404, 'Application not found.');
          }

          const appRow = appSnap.data()!;
          if (appRow.status === 'Denied') {
            throw new HttpError(
              400,
              'Denied applications cannot be approved directly. Use Reopen to Pending first.'
            );
          }

          if (appRow.status === 'Approved' && appRow.roll_number) {
            return appRow;
          }

          const cls = String(appRow.class_applied) as ClassName;
          const assignedSection = isValidSectionForClass(cls, sectionRaw) ? sectionRaw : 'A';

          // Shard roll sequence counter per class to eliminate cross-class lock contention
          const classRollSeqRef = colDoc('counters', `roll_number_seq_${cls}`);
          const seqSnap = await tx.get(classRollSeqRef);
          const currentSeq = seqSnap.exists() ? Number(seqSnap.data()?.value || 0) : 0;
          const nextRollSeq = currentSeq + 1;
          const candidateRoll = `${rollYear}-${cls}-${String(nextRollSeq).padStart(4, '0')}`;
          const now = new Date().toISOString();

          tx.set(classRollSeqRef, { value: nextRollSeq });
          const updates: DocumentData = {
            status: 'Approved',
            roll_number: candidateRoll,
            allotted_section: assignedSection,
            officer_notes: officerNotes || appRow.officer_notes || null,
            denial_reason: null,
            viewed_by_officer: true,
            viewed_at: appRow.viewed_at || now,
            decided_at: now,
            decided_by: req.authUser!.id,
            ...(hasMarksOverride ? { entrance_marks: marksOverride } : {}),
          };
          tx.update(appRef, updates);

          return { ...appRow, ...updates };
        })
      );

      if (autoEnroll && !result.enrolled_student_id) {
        const cls = String(result.class_applied) as ClassName;
        const sec = String(result.allotted_section || 'A');
        const generatedStudentId = String(result.application_code);
        const rollShort = String(result.roll_number).split('-').pop() || '01';
        const stuIdNum = generateUniqueId();
        const existingStuSnap = await withFirestoreRetry(() =>
          getDocsFromServer(query(col('students'), where('student_id', '==', generatedStudentId), limit(1)))
        );
        if (existingStuSnap.empty) {
          await withFirestoreRetry(() =>
            setDoc(colDoc('students', String(stuIdNum)), {
              id: stuIdNum,
              student_id: generatedStudentId,
              roll_number: rollShort,
              board_no: null,
              name: String(result.student_name),
              class_name: cls,
              section: sec,
              class_section: `${cls}::${sec}`,
              created_by: req.authUser!.id,
              created_at: new Date().toISOString(),
            })
          );
        }
        await withFirestoreRetry(() =>
          updateDoc(appRef, { enrolled_student_id: generatedStudentId })
        );
        result.enrolled_student_id = generatedStudentId;
      }

      res.json({ application: formatApplicationRow(result) });
    })
  );

  app.post(
    '/api/nodal/admissions/:id/deny',
    requireAuth,
    requireRole('nodal_officer'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      const reason = String(req.body?.reason || '').trim();
      const ref = colDoc('admission_applications', String(id));
      const snap = await withFirestoreRetry(() => getDocFromServer(ref));
      if (!snap.exists()) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      const existing = snap.data()!;
      if (existing.status === 'Approved') {
        res
          .status(400)
          .json({ error: 'Approved applications with an assigned roll number cannot be denied.' });
        return;
      }

      const now = new Date().toISOString();
      const updates = {
        status: 'Denied',
        roll_number: null,
        denial_reason: reason || null,
        officer_notes: reason || existing.officer_notes || null,
        viewed_by_officer: true,
        viewed_at: existing.viewed_at || now,
        decided_at: now,
        decided_by: req.authUser!.id,
      };
      await withFirestoreRetry(() => updateDoc(ref, updates));
      res.json({ application: formatApplicationRow({ ...existing, ...updates }) });
    })
  );

  // --- ADMINISTRATOR ROUTES ---
  app.put(
    '/api/admin/settings/session',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const rawSession = String(req.body?.academicSession || '').trim().slice(0, 32);
      if (rawSession.length < 4) {
        res.status(400).json({ error: 'Please enter a valid Academic Session (e.g. 2026–2027).' });
        return;
      }
      await setSetting('academic_session', rawSession);
      res.json({ academicSession: rawSession });
    })
  );

  app.post(
    '/api/admin/circulars',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const circularNumber = String(req.body?.circularNumber || '').trim();
      const title = String(req.body?.title || '').trim();
      const originalFilename = path.basename(String(req.body?.fileName || 'circular.pdf').trim());
      const fileBase64 = String(req.body?.fileBase64 || '').trim();

      if (!circularNumber) {
        res.status(400).json({ error: 'Unique Circular Number is required.' });
        return;
      }
      if (!title) {
        res.status(400).json({ error: 'Circular Name / Title is required.' });
        return;
      }
      if (!fileBase64) {
        res.status(400).json({ error: 'PDF attachment is required.' });
        return;
      }

      const circLower = circularNumber.toLowerCase();
      const existingSnap = await withFirestoreRetry(() =>
        getDocsFromServer(
          query(col('circulars'), where('circular_number_lower', '==', circLower), limit(1))
        )
      );
      if (!existingSnap.empty) {
        res.status(409).json({ error: `Circular Number "${circularNumber}" already exists.` });
        return;
      }

      const { buffer } = decodeBase64File(fileBase64);
      if (buffer.length === 0 || buffer.length > 20 * 1024 * 1024) {
        res.status(400).json({ error: 'Invalid or oversized PDF file (max 20 MB).' });
        return;
      }

      const isPdfHeader = buffer.subarray(0, 4).toString('utf8') === '%PDF';
      if (!isPdfHeader && !originalFilename.toLowerCase().endsWith('.pdf')) {
        res.status(400).json({ error: 'Uploaded file must be a valid PDF document.' });
        return;
      }

      const ensuredFilename = originalFilename.toLowerCase().endsWith('.pdf')
        ? originalFilename
        : `${originalFilename}.pdf`;
      const storedName = `circular_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.pdf`;

      await saveBinaryToFirestore(storedName, buffer, 'application/pdf', ensuredFilename);

      const id = generateUniqueId();
      const createdAt = new Date().toISOString();
      const docData = {
        id,
        circular_number: circularNumber,
        circular_number_lower: circLower,
        title,
        file_id: storedName,
        original_filename: ensuredFilename,
        mime_type: 'application/pdf',
        file_size: buffer.length,
        created_by: req.authUser!.id,
        created_at: createdAt,
      };
      await withFirestoreRetry(() => setDoc(colDoc('circulars', String(id)), docData));

      res.status(201).json({
        circular: {
          id,
          circularNumber,
          title,
          originalFilename: ensuredFilename,
          hasPdf: true,
          fileSize: buffer.length,
          createdAt,
        },
      });
    })
  );

  app.delete(
    '/api/admin/circulars/:id',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Circular not found.' });
        return;
      }
      const ref = colDoc('circulars', String(id));
      const snap = await getDocFromServer(ref);
      if (!snap.exists()) {
        res.status(404).json({ error: 'Circular not found.' });
        return;
      }
      const fileId = String(snap.data()?.file_id || '');
      await deleteDoc(ref);
      if (fileId) {
        await deleteBinaryFromFirestore(fileId);
      }
      res.json({ success: true });
    })
  );

  // Admin Marking Schemes & Result Publication
  app.get(
    '/api/admin/marking-schemes',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const [schemesSnap, pubsSnap] = await Promise.all([
        withFirestoreRetry(() => getDocsFromServer(col('marking_schemes'))),
        withFirestoreRetry(() => getDocsFromServer(col('result_publications'))),
      ]);

      const pubs = pubsSnap.docs.map((d) => d.data());
      const pubMap = new Map<string, DocumentData>();
      for (const p of pubs) {
        pubMap.set(String(p.class_name), p);
      }

      const schemes = schemesSnap.docs
        .map((d) => d.data())
        .sort((a, b) => {
          const cDiff = String(a.class_name).localeCompare(String(b.class_name));
          if (cDiff !== 0) return cDiff;
          const oDiff = Number(a.display_order || 0) - Number(b.display_order || 0);
          return oDiff !== 0 ? oDiff : Number(a.id) - Number(b.id);
        });

      res.json({
        schemes: schemes.map((s) => {
          const clsPub = pubMap.get(String(s.class_name));
          const wholePub = Boolean(clsPub?.is_published);
          return {
            id: Number(s.id),
            className: s.class_name as ClassName,
            assessmentName: String(s.assessment_name),
            maxMarks: Number(s.max_marks),
            passingMarks: Number(s.passing_marks),
            displayOrder: Number(s.display_order),
            isPublished: wholePub || Boolean(s.is_published),
            publishedAt:
              (s.published_at as string | null) ??
              (wholePub ? ((clsPub?.published_at as string | null) ?? null) : null),
          };
        }),
        publications: pubs.map((p) => ({
          className: p.class_name as ClassName,
          isPublished: Boolean(p.is_published),
          publishedAt: (p.published_at as string | null) ?? null,
        })),
      });
    })
  );

  app.post(
    '/api/admin/marking-schemes',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const className = String(req.body?.className || '').trim();
      const assessmentName = String(req.body?.assessmentName || '').trim();
      const maxMarks = Number(req.body?.maxMarks);
      const passingMarks = Number(req.body?.passingMarks);

      if (!isValidClass(className)) {
        res.status(400).json({ error: 'Valid Class (IV to XII) is required.' });
        return;
      }
      if (!assessmentName) {
        res.status(400).json({ error: 'Assessment name is required.' });
        return;
      }
      if (!Number.isFinite(maxMarks) || maxMarks <= 0) {
        res.status(400).json({ error: 'Maximum marks must be a positive number.' });
        return;
      }
      if (!Number.isFinite(passingMarks) || passingMarks < 0 || passingMarks > maxMarks) {
        res.status(400).json({
          error: 'Passing marks must be between 0 and Maximum Marks.',
        });
        return;
      }

      const [classSchemesSnap, pubSnap] = await Promise.all([
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('marking_schemes'), where('class_name', '==', className)))
        ),
        withFirestoreRetry(() => getDocFromServer(colDoc('result_publications', className))),
      ]);
      const classSchemes = classSchemesSnap.docs.map((d) => d.data());

      const dup = classSchemes.some(
        (s) => String(s.assessment_name || '').toLowerCase() === assessmentName.toLowerCase()
      );
      if (dup) {
        res.status(409).json({
          error: `Assessment "${assessmentName}" already exists for Class ${className}.`,
        });
        return;
      }

      const maxOrder = classSchemes.reduce(
        (max, s) => Math.max(max, Number(s.display_order || 0)),
        0
      );
      const nextOrder = maxOrder + 1;

      const id = generateUniqueId();
      await withFirestoreRetry(() =>
        setDoc(colDoc('marking_schemes', String(id)), {
          id,
          class_name: className,
          assessment_name: assessmentName,
          max_marks: maxMarks,
          passing_marks: passingMarks,
          display_order: nextOrder,
          is_published: false,
          published_at: null,
          created_at: new Date().toISOString(),
        })
      );

      // If class was previously marked whole-published, preserve existing published assessments
      // explicitly as published while keeping the new assessment unpublished until Admin publishes it.
      if (pubSnap.exists() && Boolean(pubSnap.data()?.is_published)) {
        const prevPubAt = (pubSnap.data()?.published_at as string | null) ?? new Date().toISOString();
        const batch = writeBatch(firestore);
        for (const d of classSchemesSnap.docs) {
          if (d.data().is_published !== true) {
            batch.update(d.ref, { is_published: true, published_at: prevPubAt });
          }
        }
        batch.update(colDoc('result_publications', className), { is_published: false });
        await withFirestoreRetry(() => batch.commit());
      }

      res.status(201).json({
        scheme: {
          id,
          className,
          assessmentName,
          maxMarks,
          passingMarks,
          displayOrder: nextOrder,
          isPublished: false,
          publishedAt: null,
        },
      });
    })
  );

  app.put(
    '/api/admin/marking-schemes/:id',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Assessment not found.' });
        return;
      }
      const assessmentName = String(req.body?.assessmentName || '').trim();
      const maxMarks = Number(req.body?.maxMarks);
      const passingMarks = Number(req.body?.passingMarks);

      const ref = colDoc('marking_schemes', String(id));
      const snap = await withFirestoreRetry(() => getDocFromServer(ref));
      if (!snap.exists()) {
        res.status(404).json({ error: 'Assessment not found.' });
        return;
      }
      const existing = snap.data()!;

      if (!assessmentName || !Number.isFinite(maxMarks) || maxMarks <= 0) {
        res
          .status(400)
          .json({ error: 'Valid assessment name and positive maximum marks are required.' });
        return;
      }
      if (!Number.isFinite(passingMarks) || passingMarks < 0 || passingMarks > maxMarks) {
        res.status(400).json({ error: 'Passing marks must be between 0 and Maximum Marks.' });
        return;
      }

      const marksSnap = await withFirestoreRetry(() =>
        getDocsFromServer(query(col('marks'), where('assessment_id', '==', id)))
      );
      const highestMark = marksSnap.docs.reduce(
        (max, d) => Math.max(max, Number(d.data().marks_obtained || 0)),
        0
      );
      if (maxMarks < highestMark) {
        res.status(400).json({
          error: `Cannot lower Maximum Marks below ${highestMark} because teacher marks up to ${highestMark} already exist.`,
        });
        return;
      }

      await withFirestoreRetry(() =>
        updateDoc(ref, {
          assessment_name: assessmentName,
          max_marks: maxMarks,
          passing_marks: passingMarks,
        })
      );

      res.json({
        scheme: {
          id,
          className: existing.class_name as ClassName,
          assessmentName,
          maxMarks,
          passingMarks,
          isPublished: Boolean(existing.is_published),
          publishedAt: (existing.published_at as string | null) ?? null,
        },
      });
    })
  );

  // Granular Per-Assessment Result Publication
  app.post(
    '/api/admin/marking-schemes/:id/publish',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Assessment not found.' });
        return;
      }
      const nextPublished = Boolean(req.body?.isPublished);

      const ref = colDoc('marking_schemes', String(id));
      const snap = await withFirestoreRetry(() => getDocFromServer(ref));
      if (!snap.exists()) {
        res.status(404).json({ error: 'Assessment not found.' });
        return;
      }
      const existing = snap.data()!;
      const className = String(existing.class_name);

      const [classSchemesSnap, pubSnap] = await Promise.all([
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('marking_schemes'), where('class_name', '==', className)))
        ),
        withFirestoreRetry(() => getDocFromServer(colDoc('result_publications', className))),
      ]);

      const now = new Date().toISOString();
      const wholeWasPublished = pubSnap.exists() && Boolean(pubSnap.data()?.is_published);
      const prevPubAt = (pubSnap.data()?.published_at as string | null) ?? now;

      const batch = writeBatch(firestore);
      let allPublishedNow = true;

      for (const d of classSchemesSnap.docs) {
        const sData = d.data();
        if (Number(sData.id) === id) {
          batch.update(d.ref, {
            is_published: nextPublished,
            published_at: nextPublished ? now : null,
          });
          if (!nextPublished) allPublishedNow = false;
        } else {
          const siblingState = wholeWasPublished || Boolean(sData.is_published);
          if (wholeWasPublished && sData.is_published !== true) {
            batch.update(d.ref, {
              is_published: true,
              published_at: (sData.published_at as string | null) ?? prevPubAt,
            });
          }
          if (!siblingState) allPublishedNow = false;
        }
      }

      batch.set(colDoc('result_publications', className), {
        class_name: className,
        is_published: classSchemesSnap.docs.length > 0 ? allPublishedNow : nextPublished,
        published_at: allPublishedNow ? now : (pubSnap.data()?.published_at as string | null) ?? null,
        published_by: req.authUser!.id,
      });

      await withFirestoreRetry(() => batch.commit());

      res.json({
        scheme: {
          id,
          className: className as ClassName,
          assessmentName: String(existing.assessment_name),
          isPublished: nextPublished,
          publishedAt: nextPublished ? now : null,
        },
        classWholePublished: allPublishedNow,
      });
    })
  );

  app.delete(
    '/api/admin/marking-schemes/:id',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Assessment not found.' });
        return;
      }
      const ref = colDoc('marking_schemes', String(id));
      const snap = await withFirestoreRetry(() => getDocFromServer(ref));
      if (!snap.exists()) {
        res.status(404).json({ error: 'Assessment not found.' });
        return;
      }

      const marksSnap = await withFirestoreRetry(() =>
        getDocsFromServer(query(col('marks'), where('assessment_id', '==', id)))
      );
      if (!marksSnap.empty) {
        await deleteDocRefsInBatches(marksSnap.docs.map((d) => d.ref));
      }
      await deleteDoc(ref);
      res.json({ success: true });
    })
  );

  app.post(
    '/api/admin/results/publish',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const className = String(req.body?.className || '').trim();
      const isPublished = Boolean(req.body?.isPublished);

      if (!isValidClass(className)) {
        res.status(400).json({ error: 'Valid Class (IV to XII) is required.' });
        return;
      }

      const publishedAt = isPublished ? new Date().toISOString() : null;
      const classSchemesSnap = await withFirestoreRetry(() =>
        getDocsFromServer(query(col('marking_schemes'), where('class_name', '==', className)))
      );

      const batch = writeBatch(firestore);
      batch.set(colDoc('result_publications', className), {
        class_name: className,
        is_published: isPublished,
        published_at: publishedAt,
        published_by: req.authUser!.id,
      });
      for (const d of classSchemesSnap.docs) {
        batch.update(d.ref, {
          is_published: isPublished,
          published_at: publishedAt,
        });
      }
      await withFirestoreRetry(() => batch.commit());

      res.json({
        publication: {
          className,
          isPublished,
          publishedAt,
        },
      });
    })
  );

  // Admin Staff & Nodal Officer Management
  app.get(
    '/api/admin/staff',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const snap = await withFirestoreRetry(() =>
        getDocsFromServer(query(col('users'), where('role', 'in', ['staff', 'nodal_officer'])))
      );
      const rows = snap.docs
        .map((d) => d.data() as DbUserRow)
        .sort((a, b) => Number(b.id) - Number(a.id));
      res.json({ users: rows.map(toAuthUser) });
    })
  );

  app.post(
    '/api/admin/staff',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const role = String(req.body?.role || 'staff') as UserRole;
      const name = String(req.body?.name || '').trim();
      const employeeId = String(req.body?.employeeId || '').trim();
      const userId = String(req.body?.userId || '').trim();
      const password = String(req.body?.password || '');
      const designation = req.body?.designation ? String(req.body.designation) : null;
      const assignedClass = req.body?.assignedClass ? String(req.body.assignedClass) : null;
      const assignedSection = req.body?.assignedSection ? String(req.body.assignedSection) : null;
      const assignedSubjectsRaw = Array.isArray(req.body?.assignedSubjects)
        ? req.body.assignedSubjects.map(String)
        : [];

      if (role !== 'staff' && role !== 'nodal_officer') {
        res.status(400).json({ error: 'Invalid account role.' });
        return;
      }
      const nameErr = validateFullName(name, 'Staff Name');
      if (nameErr) {
        res.status(400).json({ error: nameErr });
        return;
      }
      if (!employeeId || !userId || password.length < 4) {
        res.status(400).json({
          error: 'Employee ID, User ID, and Password (minimum 4 characters) are required.',
        });
        return;
      }

      const userIdLower = userId.toLowerCase();
      const [dupExactSnap, dupLowerSnap] = await Promise.all([
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('users'), where('user_id', '==', userId), limit(1)))
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(
            query(col('users'), where('user_id_lower', '==', userIdLower), limit(1))
          )
        ),
      ]);
      if (!dupExactSnap.empty || !dupLowerSnap.empty) {
        res.status(409).json({ error: `User ID "${userId}" is already in use.` });
        return;
      }

      if (role === 'staff') {
        if (
          !designation ||
          !['Subject Teacher', 'Class Teacher', 'Both'].includes(designation)
        ) {
          res.status(400).json({ error: 'Valid Designation is required for staff.' });
          return;
        }
        if (
          !assignedClass ||
          !isValidClass(assignedClass) ||
          !assignedSection ||
          !isValidSectionForClass(assignedClass, assignedSection)
        ) {
          res.status(400).json({ error: 'Valid Assigned Class and Section are required.' });
          return;
        }
        const allowedSubjects = ALL_SUBJECTS as readonly string[];
        const filteredSubjects = assignedSubjectsRaw.filter((s: string) =>
          allowedSubjects.includes(s)
        );
        if (
          (designation === 'Subject Teacher' || designation === 'Both') &&
          filteredSubjects.length === 0
        ) {
          res.status(400).json({
            error: 'Please assign at least one subject for Subject Teacher or Dual-Role staff.',
          });
          return;
        }

        const id = generateUniqueId();
        const created: DbUserRow = {
          id,
          user_id: userId,
          user_id_lower: userIdLower,
          password_hash: hashPassword(password),
          role: 'staff',
          name,
          employee_id: employeeId,
          designation: designation as StaffDesignation,
          assigned_class: assignedClass,
          assigned_section: assignedSection,
          assigned_subjects: filteredSubjects,
          created_at: new Date().toISOString(),
        };
        await withFirestoreRetry(() => setDoc(colDoc('users', String(id)), created));
        const authUser = toAuthUser(created);
        cacheAuthUser(authUser);
        res.status(201).json({ user: authUser });
        return;
      }

      // Nodal officer account
      const id = generateUniqueId();
      const created: DbUserRow = {
        id,
        user_id: userId,
        user_id_lower: userIdLower,
        password_hash: hashPassword(password),
        role: 'nodal_officer',
        name,
        employee_id: employeeId,
        designation: null,
        assigned_class: null,
        assigned_section: null,
        assigned_subjects: [],
        created_at: new Date().toISOString(),
      };
      await withFirestoreRetry(() => setDoc(colDoc('users', String(id)), created));
      const authUser = toAuthUser(created);
      cacheAuthUser(authUser);
      res.status(201).json({ user: authUser });
    })
  );

  app.put(
    '/api/admin/staff/:id',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Staff or officer record not found.' });
        return;
      }
      const ref = colDoc('users', String(id));
      const snap = await withFirestoreRetry(() => getDocFromServer(ref));
      if (!snap.exists()) {
        res.status(404).json({ error: 'Staff or officer record not found.' });
        return;
      }
      const existing = snap.data() as DbUserRow;
      if (existing.role === 'admin') {
        res.status(404).json({ error: 'Staff or officer record not found.' });
        return;
      }

      const name = String(req.body?.name ?? existing.name).trim();
      const employeeId = String(req.body?.employeeId ?? existing.employee_id ?? '').trim();
      const userId = String(req.body?.userId ?? existing.user_id).trim();
      const newPassword = req.body?.password ? String(req.body.password) : '';

      const nameErr = validateFullName(name, 'Staff Name');
      if (nameErr) {
        res.status(400).json({ error: nameErr });
        return;
      }
      if (!employeeId || !userId) {
        res.status(400).json({ error: 'Employee ID and User ID are required.' });
        return;
      }
      if (newPassword && newPassword.length < 4) {
        res.status(400).json({ error: 'New password must be at least 4 characters.' });
        return;
      }

      const userIdLower = userId.toLowerCase();
      const [dupExactSnap, dupLowerSnap] = await Promise.all([
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('users'), where('user_id', '==', userId)))
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('users'), where('user_id_lower', '==', userIdLower)))
        ),
      ]);
      const hasDup =
        dupExactSnap.docs.some((d) => Number(d.data().id) !== id) ||
        dupLowerSnap.docs.some((d) => Number(d.data().id) !== id);
      if (hasDup) {
        res.status(409).json({ error: `User ID "${userId}" is already in use.` });
        return;
      }

      let designation = existing.designation;
      let assignedClass = existing.assigned_class;
      let assignedSection = existing.assigned_section;
      let assignedSubjects: string[] = Array.isArray(existing.assigned_subjects)
        ? existing.assigned_subjects.map(String)
        : [];

      if (existing.role === 'staff') {
        designation = String(req.body?.designation ?? existing.designation) as StaffDesignation;
        const cls = String(req.body?.assignedClass ?? existing.assigned_class);
        const sec = String(req.body?.assignedSection ?? existing.assigned_section);
        if (!['Subject Teacher', 'Class Teacher', 'Both'].includes(designation)) {
          res.status(400).json({ error: 'Valid Designation is required.' });
          return;
        }
        if (!isValidClass(cls) || !isValidSectionForClass(cls, sec)) {
          res.status(400).json({ error: 'Valid Assigned Class and Section are required.' });
          return;
        }
        assignedClass = cls;
        assignedSection = sec;
        const allowedSubjects = ALL_SUBJECTS as readonly string[];
        const subjectsInput = Array.isArray(req.body?.assignedSubjects)
          ? req.body.assignedSubjects.map(String)
          : assignedSubjects;
        const filtered = subjectsInput.filter((s: string) => allowedSubjects.includes(s));
        if ((designation === 'Subject Teacher' || designation === 'Both') && filtered.length === 0) {
          res.status(400).json({
            error: 'Please assign at least one subject for Subject Teacher or Dual-Role staff.',
          });
          return;
        }
        assignedSubjects = filtered;
      }

      const pwdHash = newPassword ? hashPassword(newPassword) : existing.password_hash;
      const updates: Partial<DbUserRow> = {
        user_id: userId,
        user_id_lower: userIdLower,
        password_hash: pwdHash,
        name,
        employee_id: employeeId,
        designation,
        assigned_class: assignedClass,
        assigned_section: assignedSection,
        assigned_subjects: assignedSubjects,
      };
      await withFirestoreRetry(() => updateDoc(ref, updates));
      invalidateAuthUser(id);

      const updated: DbUserRow = { ...existing, ...updates };
      const authUser = toAuthUser(updated);
      cacheAuthUser(authUser);
      res.json({ user: authUser });
    })
  );

  app.delete(
    '/api/admin/staff/:id',
    requireAuth,
    requireRole('admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Record not found.' });
        return;
      }
      const ref = colDoc('users', String(id));
      const snap = await withFirestoreRetry(() => getDocFromServer(ref));
      if (!snap.exists() || snap.data()?.role === 'admin') {
        res.status(404).json({ error: 'Record not found.' });
        return;
      }
      await withFirestoreRetry(() => deleteDoc(ref));
      invalidateAuthUser(id);
      res.json({ success: true });
    })
  );

  // --- QUESTION PAPERS UPLOAD (Admin or Staff) ---
  app.post(
    '/api/academics/papers',
    requireAuth,
    requireRole('admin', 'staff'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const title = String(req.body?.title || '').trim();
      const className = String(req.body?.className || '').trim();
      const section = String(req.body?.section || '').trim();
      const subject = String(req.body?.subject || '').trim();
      const fallbackSession = await getAcademicSession();
      const academicYear = String(req.body?.academicYear || fallbackSession).trim();
      const originalFilename = path.basename(
        String(req.body?.fileName || 'question_paper.pdf').trim()
      );
      const fileBase64 = String(req.body?.fileBase64 || '').trim();

      if (
        !title ||
        !isValidClass(className) ||
        !isValidSectionForClass(className, section) ||
        !subject
      ) {
        res.status(400).json({ error: 'Title, Class, Section, and Subject are required.' });
        return;
      }

      const user = req.authUser!;
      if (user.role === 'staff') {
        if (user.assignedClass !== className || user.assignedSection !== section) {
          res.status(403).json({
            error: `You can only upload question papers for your assigned Class ${user.assignedClass}-${user.assignedSection}.`,
          });
          return;
        }
      }

      if (!fileBase64) {
        res.status(400).json({ error: 'Please attach a PDF file.' });
        return;
      }

      const { buffer } = decodeBase64File(fileBase64);
      if (buffer.length === 0 || buffer.length > 20 * 1024 * 1024) {
        res.status(400).json({ error: 'Invalid or oversized file (max 20 MB).' });
        return;
      }

      const safeFilename = (
        originalFilename.toLowerCase().endsWith('.pdf')
          ? originalFilename
          : `${originalFilename}.pdf`
      ).slice(0, 240);

      const storedName = `paper_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.pdf`;
      await saveBinaryToFirestore(storedName, buffer, 'application/pdf', safeFilename);

      const id = generateUniqueId();
      const createdAt = new Date().toISOString();
      await withFirestoreRetry(() =>
        setDoc(colDoc('question_papers', String(id)), {
          id,
          title,
          class_name: className,
          section,
          class_section: `${className}::${section}`,
          subject,
          academic_year: academicYear,
          file_id: storedName,
          original_filename: safeFilename,
          file_size: buffer.length,
          uploaded_by: user.id,
          created_at: createdAt,
        })
      );

      res.status(201).json({
        paper: {
          id,
          title,
          className,
          section,
          subject,
          academicYear,
          originalFilename: safeFilename,
          fileSize: buffer.length,
          createdAt,
        },
      });
    })
  );

  app.delete(
    '/api/academics/papers/:id',
    requireAuth,
    requireRole('admin', 'staff'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Question paper not found.' });
        return;
      }
      const ref = colDoc('question_papers', String(id));
      const snap = await getDocFromServer(ref);
      if (!snap.exists()) {
        res.status(404).json({ error: 'Question paper not found.' });
        return;
      }
      const row = snap.data()!;
      const user = req.authUser!;
      if (
        user.role === 'staff' &&
        (row.class_name !== user.assignedClass || row.section !== user.assignedSection)
      ) {
        res.status(403).json({ error: 'You cannot delete papers outside your assigned class.' });
        return;
      }
      const fileId = String(row.file_id || '');
      await deleteDoc(ref);
      if (fileId) {
        await deleteBinaryFromFirestore(fileId);
      }
      res.json({ success: true });
    })
  );

  // --- STAFF ROUTES (Role & Assignment Protected) ---
  app.get(
    '/api/staff/students',
    requireAuth,
    requireRole('staff'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      const snap = await withFirestoreRetry(() =>
        getDocsFromServer(query(col('students'), where('class_name', '==', user.assignedClass)))
      );

      const rows = snap.docs
        .map((d) => d.data())
        .filter((r) => String(r.section) === user.assignedSection)
        .sort(sortStudentsByRoll);

      res.json({
        students: rows.map((r) => ({
          id: Number(r.id),
          studentId: String(r.student_id),
          rollNumber: String(r.roll_number),
          boardNo: (r.board_no as string | null) ?? null,
          name: String(r.name),
          className: r.class_name as ClassName,
          section: String(r.section),
          createdAt: String(r.created_at),
        })),
      });
    })
  );

  // Teacher Student Information & QR Scan Full Dossier Lookup
  const extractStudentIdFromQrInput = (raw: string): string => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof parsed.studentId === 'string' && parsed.studentId.trim()) {
          return normalizeStudentId(parsed.studentId);
        }
        if (typeof parsed.id === 'string' && parsed.id.trim()) {
          return normalizeStudentId(parsed.id);
        }
      } catch {
        // continue to text pattern parsing
      }
    }
    const idLineMatch = /(?:^|\n)\s*(?:Student\s*ID|ID)\s*[:\-]\s*([^\n|]+)/i.exec(trimmed);
    if (idLineMatch && idLineMatch[1]) {
      return normalizeStudentId(idLineMatch[1]);
    }
    return normalizeStudentId(trimmed);
  };

  app.get(
    '/api/staff/student-qr-profile',
    requireAuth,
    requireRole('staff', 'admin'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const rawInput = String(req.query.qrPayload || req.query.studentId || '').trim();
      const parsedStudentId = extractStudentIdFromQrInput(rawInput);

      if (!parsedStudentId) {
        res.status(400).json({ error: 'Please scan a valid Student QR code or enter a Student ID.' });
        return;
      }

      // Direct query first, then normalized fallback across school registry so any student QR resolves cleanly
      const directSnap = await withFirestoreRetry(() =>
        getDocsFromServer(query(col('students'), where('student_id', '==', parsedStudentId)))
      );
      let student: Record<string, unknown> | undefined = directSnap.docs[0]?.data();

      if (!student) {
        const allStuSnap = await withFirestoreRetry(() => getDocsFromServer(col('students')));
        student = allStuSnap.docs
          .map((d) => d.data())
          .find(
            (s) =>
              normalizeStudentId(String(s.student_id)).toLowerCase() ===
              parsedStudentId.toLowerCase()
          );
      }

      if (!student) {
        res.status(404).json({
          error: `No student record found matching Student ID "${parsedStudentId}".`,
        });
        return;
      }

      const cls = student.class_name as ClassName;
      const sec = String(student.section);
      const canonicalSid = normalizeStudentId(String(student.student_id)) || String(student.student_id);

      const [activeSession, schemesSnap, marksSnap, attSnap, pubSnap, admSnap] = await Promise.all([
        getAcademicSession(),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('marking_schemes'), where('class_name', '==', cls)))
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('marks'), where('class_name', '==', cls)))
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('attendance'), where('class_name', '==', cls)))
        ),
        withFirestoreRetry(() => getDocFromServer(colDoc('result_publications', cls))),
        withFirestoreRetry(() => getDocsFromServer(col('admission_applications'))),
      ]);

      // Match admission application record if student was admitted online
      const matchedAdmission = admSnap.docs
        .map((d) => d.data())
        .find(
          (a) =>
            a.enrolled_student_id &&
            normalizeStudentId(String(a.enrolled_student_id)).toLowerCase() ===
              canonicalSid.toLowerCase()
        );

      // Attendance breakdown
      const attRows = attSnap.docs
        .map((d) => d.data())
        .filter(
          (a) =>
            String(a.section) === sec &&
            normalizeStudentId(String(a.student_id)).toLowerCase() === canonicalSid.toLowerCase()
        )
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

      const attTotal = attRows.length;
      const attPresent = attRows.filter((a) => a.status === 'Present').length;
      const attAbsent = attRows.filter((a) => a.status === 'Absent').length;
      const attLeave = attRows.filter((a) => a.status === 'Leave').length;

      // Examination performance breakdown
      const schemes = schemesSnap.docs
        .map((d) => d.data())
        .sort((a, b) => {
          const ordDiff = Number(a.display_order || 0) - Number(b.display_order || 0);
          return ordDiff !== 0 ? ordDiff : Number(a.id) - Number(b.id);
        });

      const pub = pubSnap.exists() ? pubSnap.data() : undefined;
      const wholePublished = Boolean(pub?.is_published);

      const studentMarks = marksSnap.docs
        .map((d) => d.data())
        .filter(
          (m) =>
            String(m.section) === sec &&
            normalizeStudentId(String(m.student_id)).toLowerCase() === canonicalSid.toLowerCase()
        );

      const markMap = new Map<string, number>();
      for (const m of studentMarks) {
        markMap.set(`${m.subject}::${m.assessment_id}`, Number(m.marks_obtained));
      }

      const baseSubjects = getSubjectsForClassSection(cls, sec);
      const markedSubjects = Array.from(new Set(studentMarks.map((m) => String(m.subject))));
      const subjects = [
        ...baseSubjects,
        ...markedSubjects.filter((s) => !baseSubjects.includes(s)),
      ];

      const subjectResults = subjects.map((subject) => {
        let totalObtained = 0;
        let totalMax = 0;
        let totalPassing = 0;
        let hasAnyMark = false;
        let allAssessmentsPassed = true;

        const assessments = schemes.map((sch) => {
          const schId = Number(sch.id);
          const maxMarks = Number(sch.max_marks);
          const passingMarks = Number(sch.passing_marks);
          const val = markMap.get(`${subject}::${schId}`);
          totalMax += maxMarks;
          totalPassing += passingMarks;
          if (val !== undefined) {
            hasAnyMark = true;
            totalObtained += val;
            if (val < passingMarks) allAssessmentsPassed = false;
          }
          return {
            assessmentId: schId,
            assessmentName: String(sch.assessment_name),
            maxMarks,
            passingMarks,
            marksObtained: val ?? null,
            passed: val !== undefined ? val >= passingMarks : null,
          };
        });

        const pct =
          hasAnyMark && totalMax > 0 ? Number(((totalObtained / totalMax) * 100).toFixed(2)) : null;
        const gradeInfo = pct !== null ? computeScholasticGrade(pct) : null;
        const subjectPassed = hasAnyMark && totalObtained >= totalPassing && allAssessmentsPassed;

        return {
          subject,
          assessments,
          totalObtained: hasAnyMark ? Number(totalObtained.toFixed(2)) : null,
          totalMax,
          totalPassing,
          percentage: pct,
          grade: gradeInfo?.grade ?? null,
          gradePoint: gradeInfo?.gradePoint ?? null,
          remark: gradeInfo?.remark ?? null,
          status: !hasAnyMark ? 'Not Entered' : subjectPassed ? 'Pass' : 'Needs Improvement',
        };
      });

      const enteredSubjects = subjectResults.filter((s) => s.totalObtained !== null);
      const failedSubjects = enteredSubjects.filter((s) => s.status === 'Needs Improvement');
      const grandObtained = Number(
        enteredSubjects.reduce((acc, s) => acc + (s.totalObtained ?? 0), 0).toFixed(2)
      );
      const grandMax = enteredSubjects.reduce((acc, s) => acc + s.totalMax, 0);
      const percentage = grandMax > 0 ? Number(((grandObtained / grandMax) * 100).toFixed(2)) : 0;
      const overallGradeInfo = enteredSubjects.length > 0 ? computeScholasticGrade(percentage) : null;

      let overallStatus = 'RESULT AWAITED';
      if (enteredSubjects.length > 0) {
        if (failedSubjects.length === 0) {
          overallStatus = wholePublished ? 'PASS / PROMOTED' : 'QUALIFIED (PREVIEW)';
        } else if (failedSubjects.length <= 2) {
          overallStatus = 'COMPARTMENT';
        } else {
          overallStatus = 'ESSENTIAL REPEAT';
        }
      }

      res.json({
        academicSession: activeSession,
        student: {
          id: Number(student.id),
          studentId: String(student.student_id),
          rollNumber: String(student.roll_number),
          boardNo: (student.board_no as string | null) ?? null,
          name: String(student.name),
          className: cls,
          section: sec,
          createdAt: String(student.created_at),
        },
        admissionProfile: matchedAdmission
          ? {
              applicationCode: String(matchedAdmission.application_code),
              fatherName: String(matchedAdmission.father_name || ''),
              motherName: String(matchedAdmission.mother_name || ''),
              dob: String(matchedAdmission.dob || ''),
              gender: String(matchedAdmission.gender || ''),
              category: String(matchedAdmission.category || 'General'),
              contactPhone: String(matchedAdmission.contact_phone || ''),
              contactEmail: String(matchedAdmission.contact_email || ''),
              address: String(matchedAdmission.address || ''),
              previousSchool: String(matchedAdmission.previous_school || ''),
              previousPercentage: String(matchedAdmission.previous_percentage || ''),
              streamApplied: (matchedAdmission.stream_applied as string | null) ?? null,
            }
          : null,
        attendance: {
          total: attTotal,
          present: attPresent,
          absent: attAbsent,
          leave: attLeave,
          percentage: attTotal > 0 ? Number(((attPresent / attTotal) * 100).toFixed(1)) : null,
          recentRecords: attRows.slice(0, 30).map((a) => ({
            date: String(a.date),
            status: String(a.status) as AttendanceStatus,
          })),
        },
        schemes: schemes.map((s) => ({
          id: Number(s.id),
          assessmentName: String(s.assessment_name),
          maxMarks: Number(s.max_marks),
          passingMarks: Number(s.passing_marks),
          isPublished: typeof s.is_published === 'boolean' ? s.is_published : wholePublished,
        })),
        subjectResults,
        summary: {
          grandObtained,
          grandMax,
          percentage,
          overallGrade: overallGradeInfo?.grade ?? '—',
          overallGradePoint: overallGradeInfo?.gradePoint ?? '—',
          overallRemark: overallGradeInfo?.remark ?? 'Pending',
          overallStatus,
          compartmentSubjects: failedSubjects.map((f) => f.subject),
        },
      });
    })
  );

  app.post(
    '/api/staff/students',
    requireAuth,
    requireRole('staff'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      if (user.designation !== 'Class Teacher' && user.designation !== 'Both') {
        res.status(403).json({
          error:
            'Subject Teachers cannot modify the student registry. Only Class Teachers or Dual-Role staff may register students.',
        });
        return;
      }

      const name = String(req.body?.name || '').trim();
      const rollNumber = String(req.body?.rollNumber || '').trim();
      const studentId = normalizeStudentId(String(req.body?.studentId || ''));
      const boardNo = normalizeStudentId(String(req.body?.boardNo || '')) || null;

      const nameErr = validateFullName(name, 'Student Name');
      if (nameErr) {
        res.status(400).json({ error: nameErr });
        return;
      }
      if (!rollNumber || !studentId) {
        res.status(400).json({ error: 'Student ID and Roll Number are required.' });
        return;
      }

      const scope = `${user.assignedClass}::${user.assignedSection}`;
      const [allStudentsSnap, classSnap] = await Promise.all([
        withFirestoreRetry(() => getDocsFromServer(col('students'))),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('students'), where('class_name', '==', user.assignedClass)))
        ),
      ]);

      const dupStudent = allStudentsSnap.docs.some(
        (d) =>
          normalizeStudentId(String(d.data().student_id || '')).toLowerCase() ===
          studentId.toLowerCase()
      );
      if (dupStudent) {
        res.status(409).json({ error: `Student ID "${studentId}" is already registered.` });
        return;
      }

      const dupRoll = classSnap.docs.some(
        (d) =>
          String(d.data().section) === user.assignedSection &&
          String(d.data().roll_number) === rollNumber
      );
      if (dupRoll) {
        res.status(409).json({
          error: `Roll Number "${rollNumber}" is already assigned in Class ${user.assignedClass}-${user.assignedSection}.`,
        });
        return;
      }

      const id = generateUniqueId();
      const createdAt = new Date().toISOString();
      await withFirestoreRetry(() =>
        setDoc(colDoc('students', String(id)), {
          id,
          student_id: studentId,
          roll_number: rollNumber,
          board_no: boardNo,
          name,
          class_name: user.assignedClass,
          section: user.assignedSection,
          class_section: scope,
          created_by: user.id,
          created_at: createdAt,
        })
      );

      res.status(201).json({
        student: {
          id,
          studentId,
          rollNumber,
          boardNo,
          name,
          className: user.assignedClass,
          section: user.assignedSection,
          createdAt,
        },
      });
    })
  );

  app.put(
    '/api/staff/students/:id',
    requireAuth,
    requireRole('staff'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      if (user.designation !== 'Class Teacher' && user.designation !== 'Both') {
        res.status(403).json({
          error: 'Subject Teachers cannot edit the student registry.',
        });
        return;
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Student not found.' });
        return;
      }
      const ref = colDoc('students', String(id));
      const snap = await withFirestoreRetry(() => getDocFromServer(ref));
      if (!snap.exists()) {
        res.status(404).json({ error: 'Student not found.' });
        return;
      }
      const existing = snap.data()!;
      if (
        existing.class_name !== user.assignedClass ||
        existing.section !== user.assignedSection
      ) {
        res
          .status(403)
          .json({ error: 'Cannot edit students outside your assigned class and section.' });
        return;
      }

      const name = String(req.body?.name || '').trim();
      const rollNumber = String(req.body?.rollNumber || '').trim();
      const boardNo = normalizeStudentId(String(req.body?.boardNo || '')) || null;

      const nameErr = validateFullName(name, 'Student Name');
      if (nameErr) {
        res.status(400).json({ error: nameErr });
        return;
      }
      if (!rollNumber) {
        res.status(400).json({ error: 'Roll Number is required.' });
        return;
      }

      const classSnap = await withFirestoreRetry(() =>
        getDocsFromServer(query(col('students'), where('class_name', '==', user.assignedClass)))
      );
      const dupRoll = classSnap.docs.some((d) => {
        const data = d.data();
        return (
          Number(data.id) !== id &&
          String(data.section) === user.assignedSection &&
          String(data.roll_number) === rollNumber
        );
      });
      if (dupRoll) {
        res.status(409).json({ error: `Roll Number "${rollNumber}" is already assigned.` });
        return;
      }

      await withFirestoreRetry(() =>
        updateDoc(ref, {
          name,
          roll_number: rollNumber,
          board_no: boardNo,
        })
      );

      res.json({
        student: {
          id,
          studentId: String(existing.student_id),
          rollNumber,
          boardNo,
          name,
          className: existing.class_name as ClassName,
          section: String(existing.section),
          createdAt: String(existing.created_at),
        },
      });
    })
  );

  app.delete(
    '/api/staff/students/:id',
    requireAuth,
    requireRole('staff'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      if (user.designation !== 'Class Teacher' && user.designation !== 'Both') {
        res
          .status(403)
          .json({ error: 'Subject Teachers cannot remove students from the registry.' });
        return;
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(404).json({ error: 'Student not found.' });
        return;
      }
      const ref = colDoc('students', String(id));
      const snap = await withFirestoreRetry(() => getDocFromServer(ref));
      if (!snap.exists()) {
        res.status(404).json({ error: 'Student not found.' });
        return;
      }
      const existing = snap.data()!;
      if (
        existing.class_name !== user.assignedClass ||
        existing.section !== user.assignedSection
      ) {
        res
          .status(403)
          .json({ error: 'Cannot delete students outside your assigned class and section.' });
        return;
      }

      const studentId = String(existing.student_id);
      const [marksSnap, attSnap] = await Promise.all([
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('marks'), where('student_id', '==', studentId)))
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('attendance'), where('student_id', '==', studentId)))
        ),
      ]);
      const refsToDelete = [...marksSnap.docs.map((d) => d.ref), ...attSnap.docs.map((d) => d.ref)];
      if (refsToDelete.length > 0) {
        await withFirestoreRetry(() => deleteDocRefsInBatches(refsToDelete));
      }
      await withFirestoreRetry(() => deleteDoc(ref));
      res.json({ success: true });
    })
  );

  // Staff Attendance
  app.get(
    '/api/staff/attendance',
    requireAuth,
    requireRole('staff'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      const date = String(req.query.date || new Date().toISOString().slice(0, 10)).trim();
      const [studentsSnap, attSnap] = await Promise.all([
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('students'), where('class_name', '==', user.assignedClass)))
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('attendance'), where('class_name', '==', user.assignedClass)))
        ),
      ]);

      const students = studentsSnap.docs
        .map((d) => d.data())
        .filter((r) => String(r.section) === user.assignedSection)
        .sort(sortStudentsByRoll);

      const attByStudentId = new Map<string, DocumentData>();
      for (const d of attSnap.docs) {
        const data = d.data();
        if (String(data.section) === user.assignedSection && String(data.date) === date) {
          attByStudentId.set(String(data.student_id), data);
        }
      }

      res.json({
        date,
        canEdit: user.designation === 'Class Teacher' || user.designation === 'Both',
        records: students.map((r) => {
          const att = attByStudentId.get(String(r.student_id));
          return {
            studentDbId: Number(r.id),
            studentId: String(r.student_id),
            rollNumber: String(r.roll_number),
            name: String(r.name),
            className: r.class_name as ClassName,
            section: String(r.section),
            status: (att?.status as AttendanceStatus | undefined) ?? null,
            updatedAt: (att?.updated_at as string | undefined) ?? null,
          };
        }),
      });
    })
  );

  app.post(
    '/api/staff/attendance',
    requireAuth,
    requireRole('staff'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      if (user.designation !== 'Class Teacher' && user.designation !== 'Both') {
        res.status(403).json({
          error:
            'Subject Teachers are not permitted to mark or edit attendance. Only Class Teachers or Dual-Role staff may mark attendance.',
        });
        return;
      }

      const date = String(req.body?.date || '').trim();
      const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required.' });
        return;
      }

      const scope = `${user.assignedClass}::${user.assignedSection}`;
      const stuSnap = await withFirestoreRetry(() =>
        getDocsFromServer(query(col('students'), where('class_name', '==', user.assignedClass)))
      );
      const rosterById = new Map<string, DocumentData>();
      for (const d of stuSnap.docs) {
        const s = d.data();
        if (String(s.section) === user.assignedSection) {
          rosterById.set(String(s.student_id), s);
          rosterById.set(normalizeStudentId(String(s.student_id)), s);
        }
      }

      const now = new Date().toISOString();
      const dateScope = `${scope}::${date}`;
      const writes: Array<{ ref: DocumentReference; data: DocumentData }> = [];

      for (const item of entries) {
        const rawStudentId = String(item?.studentId || '').trim();
        const normStudentId = normalizeStudentId(rawStudentId);
        const status = String(item?.status || '').trim();
        if (!['Present', 'Absent', 'Leave'].includes(status)) {
          res
            .status(400)
            .json({ error: `Invalid attendance status "${status}" for student ${rawStudentId}.` });
          return;
        }
        const stu = rosterById.get(rawStudentId) || rosterById.get(normStudentId);
        if (!stu) {
          res.status(400).json({
            error: `Student ${rawStudentId} is not enrolled in ${user.assignedClass}-${user.assignedSection}.`,
          });
          return;
        }
        const canonicalStudentId = String(stu.student_id);
        const docId = makeHashDocId(`${canonicalStudentId}::${date}`);
        writes.push({
          ref: colDoc('attendance', docId),
          data: {
            student_db_id: Number(stu.id),
            student_id: canonicalStudentId,
            class_name: user.assignedClass,
            section: user.assignedSection,
            date,
            class_section_date: dateScope,
            status,
            marked_by: user.id,
            updated_at: now,
          },
        });
      }

      for (let i = 0; i < writes.length; i += 200) {
        const chunk = writes.slice(i, i + 200);
        await withFirestoreRetry(async () => {
          const batch = writeBatch(firestore);
          for (const w of chunk) {
            batch.set(w.ref, w.data, { merge: true });
          }
          await batch.commit();
        });
      }

      res.json({ success: true, date });
    })
  );

  // Staff Examination Marks
  app.get(
    '/api/staff/marks',
    requireAuth,
    requireRole('staff'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      const subject = String(req.query.subject || user.assignedSubjects[0] || '').trim();
      const [schemesSnap, studentsSnap, marksSnap, pubSnap] = await Promise.all([
        withFirestoreRetry(() =>
          getDocsFromServer(
            query(col('marking_schemes'), where('class_name', '==', user.assignedClass))
          )
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('students'), where('class_name', '==', user.assignedClass)))
        ),
        subject
          ? withFirestoreRetry(() =>
              getDocsFromServer(
                query(col('marks'), where('class_name', '==', user.assignedClass))
              )
            )
          : Promise.resolve(null),
        withFirestoreRetry(() =>
          getDocFromServer(colDoc('result_publications', String(user.assignedClass)))
        ),
      ]);

      const schemes = schemesSnap.docs
        .map((d) => d.data())
        .sort((a, b) => {
          const oDiff = Number(a.display_order || 0) - Number(b.display_order || 0);
          return oDiff !== 0 ? oDiff : Number(a.id) - Number(b.id);
        });

      const students = studentsSnap.docs
        .map((d) => d.data())
        .filter((s) => String(s.section) === user.assignedSection)
        .sort(sortStudentsByRoll);

      const marks = marksSnap
        ? marksSnap.docs
            .map((d) => d.data())
            .filter(
              (m) =>
                String(m.section) === user.assignedSection && String(m.subject) === subject
            )
        : [];

      const pub = pubSnap.exists() ? pubSnap.data() : undefined;
      const wholePublished = Boolean(pub?.is_published);
      const anyPublished = schemes.some((s) =>
        typeof s.is_published === 'boolean' ? s.is_published : wholePublished
      );

      res.json({
        canEdit: user.designation === 'Subject Teacher' || user.designation === 'Both',
        isPublished: wholePublished,
        anyPublished,
        subject,
        schemes: schemes.map((s) => ({
          id: Number(s.id),
          className: s.class_name as ClassName,
          assessmentName: String(s.assessment_name),
          maxMarks: Number(s.max_marks),
          passingMarks: Number(s.passing_marks),
          displayOrder: Number(s.display_order),
          isPublished: typeof s.is_published === 'boolean' ? s.is_published : wholePublished,
          publishedAt: (s.published_at as string | null) ?? null,
        })),
        students: students.map((s) => ({
          id: Number(s.id),
          studentId: String(s.student_id),
          rollNumber: String(s.roll_number),
          name: String(s.name),
          boardNo: (s.board_no as string | null) ?? null,
        })),
        marks: marks.map((m) => ({
          studentId: String(m.student_id),
          assessmentId: Number(m.assessment_id),
          marksObtained: Number(m.marks_obtained),
          updatedAt: String(m.updated_at),
        })),
      });
    })
  );

  app.post(
    '/api/staff/marks',
    requireAuth,
    requireRole('staff'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      if (user.designation !== 'Subject Teacher' && user.designation !== 'Both') {
        res.status(403).json({
          error: 'Only Subject Teachers or Dual-Role teachers may enter examination marks.',
        });
        return;
      }

      const subject = String(req.body?.subject || '').trim();
      if (!subject || !user.assignedSubjects.includes(subject)) {
        res.status(403).json({
          error: `Unauthorized subject "${subject}". You may only enter marks for your assigned subjects: ${user.assignedSubjects.join(', ')}.`,
        });
        return;
      }

      const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
      if (entries.length === 0) {
        res.status(400).json({ error: 'No mark entries provided.' });
        return;
      }

      const scope = `${user.assignedClass}::${user.assignedSection}`;
      const [activeSession, schemesSnap, stuSnap] = await Promise.all([
        getAcademicSession(),
        withFirestoreRetry(() =>
          getDocsFromServer(
            query(col('marking_schemes'), where('class_name', '==', user.assignedClass))
          )
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('students'), where('class_name', '==', user.assignedClass)))
        ),
      ]);

      const schemeMap = new Map(
        schemesSnap.docs.map((d) => {
          const data = d.data();
          return [
            Number(data.id),
            {
              id: Number(data.id),
              assessment_name: String(data.assessment_name),
              max_marks: Number(data.max_marks),
            },
          ];
        })
      );

      const rosterMap = new Map<string, { id: number; name: string; canonicalId: string }>();
      for (const d of stuSnap.docs) {
        const s = d.data();
        if (String(s.section) === user.assignedSection) {
          const rawId = String(s.student_id);
          const canonicalId = normalizeStudentId(rawId) || rawId;
          const info = { id: Number(s.id), name: String(s.name), canonicalId };
          rosterMap.set(rawId, info);
          rosterMap.set(canonicalId.toLowerCase(), info);
        }
      }

      const now = new Date().toISOString();
      const subjectScope = `${scope}::${subject}`;
      const writes: Array<{ ref: DocumentReference; data: DocumentData }> = [];

      for (const entry of entries) {
        const rawStudentId = String(entry?.studentId || '').trim();
        const normStudentId = normalizeStudentId(rawStudentId);
        const assessmentId = Number(entry?.assessmentId);
        const rawMarks = entry?.marksObtained;

        if (rawMarks === '' || rawMarks === null || rawMarks === undefined) {
          continue;
        }
        const marksObtained = Number(rawMarks);

        const stu = rosterMap.get(rawStudentId) || rosterMap.get(normStudentId.toLowerCase());
        if (!stu) {
          res.status(400).json({
            error: `Student "${rawStudentId}" does not belong to Class ${user.assignedClass}-${user.assignedSection}.`,
          });
          return;
        }

        const scheme = schemeMap.get(assessmentId);
        if (!scheme) {
          res.status(400).json({
            error: `Invalid assessment ID ${assessmentId} for Class ${user.assignedClass}.`,
          });
          return;
        }

        if (!Number.isFinite(marksObtained) || marksObtained < 0) {
          res.status(400).json({
            error: `Marks for ${stu.name} (${scheme.assessment_name}) cannot be negative.`,
          });
          return;
        }

        if (marksObtained > scheme.max_marks) {
          res.status(400).json({
            error: `Denied: ${marksObtained} marks for ${stu.name} in ${scheme.assessment_name} exceeds the maximum marks of ${scheme.max_marks}.`,
          });
          return;
        }

        const targetStudentId = stu.canonicalId;
        const docId = makeHashDocId(`${targetStudentId}::${subject}::${assessmentId}`);
        writes.push({
          ref: colDoc('marks', docId),
          data: {
            student_id: targetStudentId,
            class_name: user.assignedClass,
            section: user.assignedSection,
            class_section: scope,
            class_section_subject: subjectScope,
            subject,
            assessment_id: assessmentId,
            marks_obtained: marksObtained,
            academic_session: activeSession,
            entered_by: user.id,
            updated_at: now,
          },
        });
      }

      for (let i = 0; i < writes.length; i += 200) {
        const chunk = writes.slice(i, i + 200);
        await withFirestoreRetry(async () => {
          const batch = writeBatch(firestore);
          for (const w of chunk) {
            batch.set(w.ref, w.data, { merge: true });
          }
          await batch.commit();
        });
      }

      res.json({ success: true });
    })
  );

  app.get(
    '/api/staff/results',
    requireAuth,
    requireRole('staff'),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      const cls = user.assignedClass!;
      const sec = user.assignedSection!;
      const [pubSnap, schemesSnap, studentsSnap, marksSnap, attSnap] = await Promise.all([
        withFirestoreRetry(() => getDocFromServer(colDoc('result_publications', cls))),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('marking_schemes'), where('class_name', '==', cls)))
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('students'), where('class_name', '==', cls)))
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('marks'), where('class_name', '==', cls)))
        ),
        withFirestoreRetry(() =>
          getDocsFromServer(query(col('attendance'), where('class_name', '==', cls)))
        ),
      ]);

      const pub = pubSnap.exists() ? pubSnap.data() : undefined;
      const wholePublished = Boolean(pub?.is_published);

      const schemes = schemesSnap.docs
        .map((d) => d.data())
        .sort((a, b) => {
          const oDiff = Number(a.display_order || 0) - Number(b.display_order || 0);
          return oDiff !== 0 ? oDiff : Number(a.id) - Number(b.id);
        });

      const students = studentsSnap.docs
        .map((d) => d.data())
        .filter((s) => String(s.section) === sec)
        .sort(sortStudentsByRoll);

      const markRows = marksSnap.docs
        .map((d) => d.data())
        .filter((m) => String(m.section) === sec);

      const attByStudent = new Map<string, { total: number; present: number }>();
      for (const d of attSnap.docs) {
        const a = d.data();
        if (String(a.section) !== sec) continue;
        const sid = String(a.student_id);
        const cur = attByStudent.get(sid) || { total: 0, present: 0 };
        cur.total += 1;
        if (a.status === 'Present') cur.present += 1;
        attByStudent.set(sid, cur);
      }

      const baseSubjects = getSubjectsForClassSection(cls, sec);
      const visibleSubjects =
        user.designation === 'Subject Teacher' && user.assignedSubjects.length > 0
          ? Array.from(new Set(user.assignedSubjects))
          : Array.from(
              new Set([
                ...baseSubjects,
                ...user.assignedSubjects,
                ...markRows.map((m) => String(m.subject)),
              ])
            );

      const filteredMarks = markRows.filter((m) => visibleSubjects.includes(String(m.subject)));
      const anyPublished = schemes.some((s) =>
        typeof s.is_published === 'boolean' ? s.is_published : wholePublished
      );
      const academicSession = await getAcademicSession();

      res.json({
        className: cls,
        section: sec,
        academicSession,
        isPublished: wholePublished,
        anyPublished,
        publishedAt: (pub?.published_at as string | null) ?? null,
        subjects: visibleSubjects,
        schemes: schemes.map((s) => ({
          id: Number(s.id),
          assessmentName: String(s.assessment_name),
          maxMarks: Number(s.max_marks),
          passingMarks: Number(s.passing_marks),
          isPublished: typeof s.is_published === 'boolean' ? s.is_published : wholePublished,
          publishedAt: (s.published_at as string | null) ?? null,
        })),
        students: students.map((st) => {
          const att = attByStudent.get(String(st.student_id));
          return {
            studentId: String(st.student_id),
            rollNumber: String(st.roll_number),
            boardNo: (st.board_no as string | null) ?? null,
            name: String(st.name),
            attendancePct:
              att && att.total > 0 ? Number(((att.present / att.total) * 100).toFixed(1)) : null,
            attendanceDays: att ? `${att.present}/${att.total}` : null,
          };
        }),
        marks: filteredMarks.map((m) => ({
          studentId: String(m.student_id),
          subject: String(m.subject),
          assessmentId: Number(m.assessment_id),
          marksObtained: Number(m.marks_obtained),
        })),
      });
    })
  );

  // --- GOOGLE SEARCH GROUNDED ACADEMIC UPDATES ---
  const extractGroundingSources = (resp: {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    }>;
  }): Array<{ title: string; uri: string }> => {
    const chunks = resp?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const seen = new Set<string>();
    const sources: Array<{ title: string; uri: string }> = [];
    for (const chunk of chunks) {
      const uri = String(chunk?.web?.uri || '').trim();
      if (!uri || !/^https?:\/\//i.test(uri) || seen.has(uri)) continue;
      seen.add(uri);
      const title = String(chunk?.web?.title || uri).trim().slice(0, 120);
      sources.push({ title, uri });
      if (sources.length >= 6) break;
    }
    return sources;
  };

  let cachedDefaultEduUpdate: {
    expiresAt: number;
    payload: {
      query: string;
      answer: string;
      sources: Array<{ title: string; uri: string }>;
      updatedAt: string;
    };
  } | null = null;

  const runSearchGroundedEducationLookup = async (topicQuery: string) => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new HttpError(
        503,
        'Live Academic Search is unavailable because the AI service key is not configured.'
      );
    }
    const cleanQuery = topicQuery.trim().slice(0, 300);
    const isDefault = cleanQuery === '__DEFAULT__';
    if (isDefault && cachedDefaultEduUpdate && Date.now() < cachedDefaultEduUpdate.expiresAt) {
      return cachedDefaultEduUpdate.payload;
    }

    const effectivePrompt = isDefault
      ? 'Summarize 3 to 4 key latest public Indian K-12 academic, curriculum, sample question paper, or Class X/XII board examination updates for school students and educators. Use crisp bullet points with dates where available.'
      : `Provide accurate, up-to-date K-12 school education, curriculum, syllabus, or examination guidance about: ${cleanQuery}. Keep the answer concise, structured in crisp bullets, and strictly factual for students, parents, and teachers.`;

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: effectivePrompt,
      config: {
        systemInstruction:
          'You are an academic information desk providing verified public K-12 education updates using Google Search grounding. Never invent dates or circulars; rely strictly on verified web results.',
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const payload = {
      query: isDefault ? 'Latest Academic & Examination Updates' : cleanQuery,
      answer: (response.text || '').trim(),
      sources: extractGroundingSources(response as never),
      updatedAt: new Date().toISOString(),
    };

    if (isDefault && payload.answer) {
      cachedDefaultEduUpdate = {
        expiresAt: Date.now() + 15 * 60 * 1000,
        payload,
      };
    }
    return payload;
  };

  app.get(
    '/api/public/education-updates',
    asyncHandler(async (req: Request, res: Response) => {
      const q = String(req.query.q || '').trim() || '__DEFAULT__';
      try {
        const result = await runSearchGroundedEducationLookup(q);
        res.json(result);
      } catch (err: unknown) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        const msg = String(err instanceof Error ? err.message : err);
        if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
          res.status(429).json({
            error: 'Live Search quota reached temporarily. Please try again later.',
          });
          return;
        }
        if (/503|UNAVAILABLE|high demand/i.test(msg)) {
          res.status(503).json({
            error: 'Live Search service is experiencing temporary high demand. Please retry shortly.',
          });
          return;
        }
        throw err;
      }
    })
  );

  // SEO Crawling Endpoints
  const resolveBaseUrl = (req: Request) => {
    const configured = process.env.APP_URL?.trim();
    if (configured && /^https?:\/\//i.test(configured) && !configured.includes('MY_APP_URL')) {
      return configured.replace(/\/+$/, '');
    }
    const protoHeader = req.headers['x-forwarded-proto'];
    const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader)?.split(',')[0]?.trim() || req.protocol || 'https';
    const hostHeader = req.headers['x-forwarded-host'];
    const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader)?.split(',')[0]?.trim() || req.get('host');
    return host ? `${proto}://${host}` : '';
  };

  app.get('/robots.txt', (req: Request, res: Response) => {
    const baseUrl = resolveBaseUrl(req);
    const sitemapLine = baseUrl ? `Sitemap: ${baseUrl}/sitemap.xml` : 'Sitemap: /sitemap.xml';
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\n${sitemapLine}\n`);
  });

  app.get('/sitemap.xml', (req: Request, res: Response) => {
    const baseUrl = resolveBaseUrl(req);
    const prefix = baseUrl || '';
    const today = new Date().toISOString().slice(0, 10);
    const urls = [
      { loc: `${prefix}/`, priority: '1.0' },
      { loc: `${prefix}/?page=admissions`, priority: '0.9' },
      { loc: `${prefix}/?page=circulars`, priority: '0.8' },
      { loc: `${prefix}/?page=academics`, priority: '0.8' },
      { loc: `${prefix}/?page=student-dashboard`, priority: '0.7' },
    ];
    const items = urls
      .map(
        (u) =>
          `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      )
      .join('\n');
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`
    );
  });

  app.get('/google74c91c16d32cad02.html', (_req: Request, res: Response) => {
    res.type('text/html; charset=utf-8').send('google-site-verification: google74c91c16d32cad02.html');
  });

  // Vite / Static Serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { index: false }));
    app.get('*', (req: Request, res: Response) => {
      const indexPath = path.join(distDir, 'index.html');
      const baseUrl = resolveBaseUrl(req);
      if (!baseUrl) {
        res.sendFile(indexPath);
        return;
      }
      try {
        let html = fs.readFileSync(indexPath, 'utf-8');
        const canonical = `${baseUrl}/`;
        const injectTags = `    <link rel="canonical" href="${canonical}" />\n    <meta property="og:url" content="${canonical}" />\n`;
        html = html
          .replaceAll('content="/og-campus.jpg"', `content="${baseUrl}/og-campus.jpg"`)
          .replaceAll('content="/school-crest.jpg"', `content="${baseUrl}/school-crest.jpg"`)
          .replaceAll('"logo": "/school-crest.jpg"', `"logo": "${baseUrl}/school-crest.jpg"`)
          .replaceAll('"image": "/og-campus.jpg"', `"image": "${baseUrl}/og-campus.jpg"`)
          .replace('</head>', `${injectTags}  </head>`);
        res.type('text/html').send(html);
      } catch {
        res.sendFile(indexPath);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Moreden of Education International School server running on http://0.0.0.0:${PORT}`
    );
  });
}

startServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
