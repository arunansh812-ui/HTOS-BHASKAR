import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import {
  AlertCircle,
  ArrowLeft,
  Award,
  CalendarCheck,
  Camera,
  CameraOff,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  SwitchCamera,
  Upload,
  User,
} from 'lucide-react';
import { crestEmblemImg } from '../assets/schoolImages.ts';
import { apiFetch } from '../lib/api.ts';
import {
  type AttendanceStatus,
  type ClassName,
  type StudentRecord,
  normalizeStudentId,
} from '../shared/schoolRules.ts';
import {
  OfficialResultSheet,
  type OfficialResultAssessmentCol,
  type OfficialResultSubjectRow,
} from './OfficialResultSheet.tsx';

interface TeacherStudentQrRegistryProps {
  students: StudentRecord[];
  assignedClass: ClassName | null;
  assignedSection: string | null;
  onRefreshStudents: () => Promise<void>;
}

interface StudentQrProfileResponse {
  academicSession: string;
  student: {
    id: number;
    studentId: string;
    rollNumber: string;
    boardNo: string | null;
    name: string;
    className: ClassName;
    section: string;
    createdAt: string;
  };
  admissionProfile: {
    applicationCode: string;
    fatherName: string;
    motherName: string;
    dob: string;
    gender: string;
    category: string;
    contactPhone: string;
    contactEmail: string;
    address: string;
    previousSchool: string;
    previousPercentage: string;
    streamApplied: string | null;
  } | null;
  attendance: {
    total: number;
    present: number;
    absent: number;
    leave: number;
    percentage: number | null;
    recentRecords: Array<{
      date: string;
      status: AttendanceStatus;
    }>;
  };
  schemes: OfficialResultAssessmentCol[];
  subjectResults: OfficialResultSubjectRow[];
  summary: {
    grandObtained: number;
    grandMax: number;
    percentage: number;
    overallGrade: string;
    overallGradePoint: string;
    overallRemark: string;
    overallStatus: string;
    compartmentSubjects: string[];
  };
}

export function buildStudentQrPayload(student: {
  studentId: string;
  name: string;
  className: ClassName;
  section: string;
  rollNumber: string;
  boardNo: string | null;
}): string {
  return [
    'MOE-STUDENT',
    `ID: ${normalizeStudentId(student.studentId) || student.studentId}`,
    `Name: ${student.name}`,
    `Class: ${student.className}-${student.section}`,
    `Roll: ${student.rollNumber}`,
    `Board No: ${student.boardNo || 'N/A'}`,
    'School: MoE — Moreden of Education International School',
  ].join('\n');
}

function formatDateDisplay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function TeacherStudentQrRegistry({
  students,
  assignedClass,
  assignedSection,
  onRefreshStudents,
}: TeacherStudentQrRegistryProps) {
  const [mode, setMode] = useState<'registry' | 'scanner'>('registry');
  const [searchQuery, setSearchQuery] = useState('');
  const [boardFilter, setBoardFilter] = useState<'all' | 'with-board' | 'no-board'>('all');
  const [refreshingList, setRefreshingList] = useState(false);

  // Cached QR Data URLs keyed by a composite signature so edits regenerate cleanly
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [printSingleStudentId, setPrintSingleStudentId] = useState<string | null>(null);

  // Full student dossier state
  const [dossier, setDossier] = useState<StudentQrProfileResponse | null>(null);
  const [dossierQrUrl, setDossierQrUrl] = useState<string>('');
  const [loadingDossier, setLoadingDossier] = useState(false);
  const [dossierError, setDossierError] = useState<string | null>(null);
  const [lastScannedLabel, setLastScannedLabel] = useState<string | null>(null);
  const [showMarksheetModal, setShowMarksheetModal] = useState(false);

  // Manual lookup state
  const [manualId, setManualId] = useState('');

  // Camera scanner state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [scannerMsg, setScannerMsg] = useState<{ type: 'info' | 'ok' | 'err'; text: string } | null>(
    null
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scanLockRef = useRef<boolean>(false);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const qCompact = normalizeStudentId(q).toLowerCase();
    return students.filter((s) => {
      if (boardFilter === 'with-board' && !s.boardNo) return false;
      if (boardFilter === 'no-board' && s.boardNo) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.rollNumber.toLowerCase().includes(q) ||
        s.studentId.toLowerCase().includes(q) ||
        normalizeStudentId(s.studentId).toLowerCase().includes(qCompact) ||
        (s.boardNo || '').toLowerCase().includes(q)
      );
    });
  }, [students, searchQuery, boardFilter]);

  // Generate QR data URLs for all displayed students
  useEffect(() => {
    let cancelled = false;
    const generateMissing = async () => {
      const updates: Record<string, string> = {};
      for (const s of students) {
        const sig = `${s.studentId}|${s.name}|${s.rollNumber}|${s.className}|${s.section}|${s.boardNo || ''}`;
        if (qrMap[sig]) continue;
        try {
          const url = await QRCode.toDataURL(buildStudentQrPayload(s), {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 240,
            color: { dark: '#082D59', light: '#FFFFFF' },
          });
          updates[sig] = url;
        } catch {
          // Ignore individual QR render errors
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setQrMap((prev) => ({ ...prev, ...updates }));
      }
    };
    generateMissing();
    return () => {
      cancelled = true;
    };
  }, [students, qrMap]);

  // Generate QR data URL for currently loaded dossier student (works even if student is from another class)
  useEffect(() => {
    let cancelled = false;
    if (!dossier) {
      setDossierQrUrl('');
      return;
    }
    QRCode.toDataURL(buildStudentQrPayload(dossier.student), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
      color: { dark: '#082D59', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setDossierQrUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDossierQrUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [dossier]);

  // Clear single-card print filter after printing completes
  useEffect(() => {
    const handleAfterPrint = () => setPrintSingleStudentId(null);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraStarting(false);
    scanLockRef.current = false;
  }, []);

  // Always stop camera when leaving scanner mode or unmounting
  useEffect(() => {
    if (mode !== 'scanner') {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [mode, stopCamera]);

  const fetchStudentDossier = useCallback(
    async (input: { qrPayload?: string; studentId?: string; sourceLabel: string }) => {
      setLoadingDossier(true);
      setDossierError(null);
      setShowMarksheetModal(false);
      try {
        const params = new URLSearchParams();
        if (input.qrPayload) {
          params.set('qrPayload', input.qrPayload);
        } else if (input.studentId) {
          params.set('studentId', normalizeStudentId(input.studentId));
        }
        const data = await apiFetch<StudentQrProfileResponse>(
          `/api/staff/student-qr-profile?${params.toString()}`
        );
        setDossier(data);
        setLastScannedLabel(input.sourceLabel);
        setScannerMsg({
          type: 'ok',
          text: `Loaded full student record for ${data.student.name} (ID: ${data.student.studentId}, Class ${data.student.className}-${data.student.section}).`,
        });
      } catch (err) {
        const msg = (err as Error).message || 'Unable to load student information.';
        setDossierError(msg);
        setScannerMsg({ type: 'err', text: msg });
      } finally {
        setLoadingDossier(false);
      }
    },
    []
  );

  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (decoded && decoded.data && !scanLockRef.current) {
          scanLockRef.current = true;
          stopCamera();
          fetchStudentDossier({
            qrPayload: decoded.data,
            sourceLabel: 'Live Camera QR Scan',
          });
          return;
        }
      }
    }

    rafRef.current = requestAnimationFrame(scanFrame);
  }, [fetchStudentDossier, stopCamera]);

  const startCamera = useCallback(
    async (preferredFacing: 'environment' | 'user' = facingMode) => {
      stopCamera();
      setScannerMsg(null);
      setDossierError(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setScannerMsg({
          type: 'err',
          text: 'Camera access is not available in this browser context. Use "Upload Student QR Image" or "Manual Student ID Lookup" below.',
        });
        return;
      }

      setCameraStarting(true);
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: preferredFacing } },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
        streamRef.current = stream;
        setCameraActive(true);
        setCameraStarting(false);

        requestAnimationFrame(() => {
          const video = videoRef.current;
          if (!video || !streamRef.current) return;
          video.srcObject = streamRef.current;
          video.setAttribute('playsinline', 'true');
          video
            .play()
            .then(() => {
              rafRef.current = requestAnimationFrame(scanFrame);
            })
            .catch(() => {
              setScannerMsg({
                type: 'err',
                text: 'Camera stream started but video playback was blocked. Tap Start Camera again or upload a QR image.',
              });
              stopCamera();
            });
        });
      } catch (err) {
        setCameraStarting(false);
        setCameraActive(false);
        setScannerMsg({
          type: 'err',
          text: `Unable to access camera (${(err as Error).message || 'permission denied'}). You can still upload a Student QR image or enter the Student ID manually.`,
        });
      }
    },
    [facingMode, scanFrame, stopCamera]
  );

  const handleFlipCamera = () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    if (cameraActive) {
      startCamera(nextFacing);
    }
  };

  const handleUploadQrImage = (file: File | null) => {
    if (!file) return;
    setScannerMsg({ type: 'info', text: 'Decoding QR code from uploaded image...' });
    setDossierError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          setScannerMsg({ type: 'err', text: 'Unable to read image canvas in this browser.' });
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (!decoded || !decoded.data) {
          setScannerMsg({
            type: 'err',
            text: 'No valid QR code was detected in that image. Please upload a clear, uncropped Student QR PNG.',
          });
          return;
        }
        fetchStudentDossier({
          qrPayload: decoded.data,
          sourceLabel: `Uploaded QR Image (${file.name})`,
        });
      };
      img.onerror = () => {
        setScannerMsg({ type: 'err', text: 'Unable to load the selected image file.' });
      };
      img.src = String(reader.result || '');
    };
    reader.onerror = () => {
      setScannerMsg({ type: 'err', text: 'Failed to read the selected file.' });
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleManualLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = normalizeStudentId(manualId);
    if (!cleaned) {
      setScannerMsg({ type: 'err', text: 'Please enter a Student ID to look up.' });
      return;
    }
    fetchStudentDossier({
      studentId: cleaned,
      sourceLabel: `Manual ID Lookup (${cleaned})`,
    });
  };

  const handleDownloadQrPng = (dataUrl: string, studentId: string, name: string) => {
    if (!dataUrl) return;
    const safeId = normalizeStudentId(studentId) || 'student';
    const safeName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `MoE-QR-${safeId}${safeName ? `-${safeName}` : ''}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintSingleCard = (studentId: string) => {
    setPrintSingleStudentId(studentId);
    setTimeout(() => {
      window.print();
    }, 60);
  };

  const handlePrintAllCards = () => {
    setPrintSingleStudentId(null);
    setTimeout(() => {
      window.print();
    }, 60);
  };

  const handleRefreshRegistry = async () => {
    setRefreshingList(true);
    try {
      await onRefreshStudents();
    } finally {
      setRefreshingList(false);
    }
  };

  const openStudentFromRegistry = (student: StudentRecord) => {
    setMode('scanner');
    setManualId(student.studentId);
    fetchStudentDossier({
      studentId: student.studentId,
      sourceLabel: 'Student Registry Record',
    });
  };

  const getQrSig = (s: StudentRecord) =>
    `${s.studentId}|${s.name}|${s.rollNumber}|${s.className}|${s.section}|${s.boardNo || ''}`;

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="no-print bg-white border border-slate-200 rounded-md p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-[#082D59]">
            Student Information &amp; QR Code Registry
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Class {assignedClass || '—'}-{assignedSection || '—'} · Each registered student has a
            unique QR code. Scan any student QR code to retrieve their complete live academic,
            attendance, and family profile.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex p-1 bg-[#E4ECF5] rounded-md">
            <button
              type="button"
              onClick={() => {
                setMode('registry');
                setDossier(null);
                setDossierError(null);
              }}
              className={`px-3.5 py-2 text-xs font-semibold rounded inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                mode === 'registry'
                  ? 'bg-[#082D59] text-white'
                  : 'text-[#082D59] hover:bg-white/70'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              Student QR Registry ({students.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('scanner');
                setScannerMsg(null);
              }}
              className={`px-3.5 py-2 text-xs font-semibold rounded inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                mode === 'scanner'
                  ? 'bg-[#082D59] text-white'
                  : 'text-[#082D59] hover:bg-white/70'
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" />
              Scan Student QR
            </button>
          </div>
        </div>
      </div>

      {/* MODE 1: STUDENT QR REGISTRY */}
      {mode === 'registry' && (
        <div className="space-y-5">
          {/* Search, Filter & Print Controls */}
          <div className="no-print bg-white border border-slate-200 rounded-md p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by Student Name, Roll No., Student ID, or Board No..."
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                />
              </div>

              <select
                value={boardFilter}
                onChange={(e) =>
                  setBoardFilter(e.target.value as 'all' | 'with-board' | 'no-board')
                }
                aria-label="Filter by Board Registration Number"
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
              >
                <option value="all">All Registered Students</option>
                <option value="with-board">With Board Roll / Reg. No.</option>
                <option value="no-board">Without Board No.</option>
              </select>

              <span className="text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
                {filteredStudents.length} / {students.length} shown
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={refreshingList}
                onClick={handleRefreshRegistry}
                className="px-3 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-md hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshingList ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              {filteredStudents.length > 0 && (
                <button
                  type="button"
                  onClick={handlePrintAllCards}
                  className="px-3.5 py-2 bg-[#0B3C75] text-white text-xs font-semibold rounded-md hover:bg-[#144D8A] inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print All Class QR Cards
                </button>
              )}
            </div>
          </div>

          {/* Print Header (Visible only when printing) */}
          <div className="hidden print:block border-b-2 border-[#082D59] pb-3 mb-4">
            <p className="text-xs font-bold uppercase tracking-wider text-[#8B1E24]">
              MoE — Moreden of Education International School
            </p>
            <h3 className="text-lg font-bold text-[#082D59]">
              Student QR Identity Registry · Class {assignedClass || '—'}-{assignedSection || '—'}
            </h3>
          </div>

          {/* Student QR Grid */}
          {students.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-md p-10 text-center space-y-2">
              <QrCode className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-800">
                No Students Registered in Class {assignedClass}-{assignedSection}
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Register students under <strong>1. Register</strong> to automatically generate each
                student&apos;s scannable QR identity card here.
              </p>
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-md p-8 text-center text-sm text-slate-500">
              No students match the current search or filter criteria.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 print:grid-cols-2 print:gap-3">
              {filteredStudents.map((stu) => {
                const qrUrl = qrMap[getQrSig(stu)];
                const hideInPrint =
                  printSingleStudentId !== null && printSingleStudentId !== stu.studentId;
                return (
                  <div
                    key={stu.id}
                    className={`bg-white border border-slate-200 rounded-md overflow-hidden flex flex-col break-inside-avoid ${
                      hideInPrint ? 'print:hidden' : ''
                    }`}
                  >
                    {/* Card Masthead */}
                    <div className="bg-[#082D59] text-white px-4 py-2.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <img
                          src={crestEmblemImg}
                          alt="MoE School Crest"
                          referrerPolicy="no-referrer"
                          className="w-6 h-6 object-contain bg-white rounded-sm p-0.5 shrink-0"
                        />
                        <span className="text-[11px] font-bold uppercase tracking-wider truncate">
                          MoE Student QR Card
                        </span>
                      </div>
                      <span className="text-[11px] font-mono font-semibold text-amber-200 shrink-0 tabular-nums">
                        Class {stu.className}-{stu.section}
                      </span>
                    </div>

                    {/* Card Body */}
                    <div className="p-4 flex items-center gap-4 flex-1">
                      <div className="w-28 h-28 shrink-0 border border-slate-200 rounded bg-white p-1.5 flex items-center justify-center">
                        {qrUrl ? (
                          <img
                            src={qrUrl}
                            alt={`QR Code for ${stu.name} (${stu.studentId})`}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="text-[10px] font-mono text-slate-400 text-center">
                            Generating QR...
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <h3 className="text-sm font-bold text-slate-900 leading-snug break-words">
                          {stu.name}
                        </h3>
                        <dl className="text-xs space-y-1 tabular-nums">
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-slate-500">Student ID</dt>
                            <dd className="font-mono font-bold text-[#082D59]">{stu.studentId}</dd>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-slate-500">Roll No.</dt>
                            <dd className="font-mono font-semibold text-slate-800">
                              {stu.rollNumber}
                            </dd>
                          </div>
                          {stu.boardNo && (
                            <div className="flex items-center justify-between gap-2">
                              <dt className="text-slate-500">Board No.</dt>
                              <dd className="font-mono font-semibold text-slate-700 truncate">
                                {stu.boardNo}
                              </dd>
                            </div>
                          )}
                        </dl>
                      </div>
                    </div>

                    {/* Card Actions (Hidden in Print) */}
                    <div className="no-print px-3.5 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openStudentFromRegistry(stu)}
                        className="px-2.5 py-1.5 bg-[#0B3C75] text-white text-xs font-semibold rounded hover:bg-[#144D8A] inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Full Info
                      </button>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={!qrUrl}
                          onClick={() => handleDownloadQrPng(qrUrl || '', stu.studentId, stu.name)}
                          className="px-2.5 py-1.5 border border-slate-300 bg-white text-slate-700 text-xs font-semibold rounded hover:bg-slate-100 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          title="Download QR PNG"
                        >
                          <Download className="w-3.5 h-3.5" />
                          PNG
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePrintSingleCard(stu.studentId)}
                          className="px-2.5 py-1.5 border border-slate-300 bg-white text-slate-700 text-xs font-semibold rounded hover:bg-slate-100 inline-flex items-center gap-1 cursor-pointer"
                          title="Print Student QR Card"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Print
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODE 2: SCAN STUDENT QR & FULL INFORMATION DOSSIER */}
      {mode === 'scanner' && (
        <div className="space-y-6">
          {/* Scanner Panel (Hidden in Print when Dossier is visible) */}
          <div className="no-print grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Live Camera QR Scanner */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-md overflow-hidden">
              <div className="px-5 py-3.5 bg-[#EEF3F9] border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Camera className="w-4 h-4 text-[#082D59]" />
                  <h3 className="text-sm font-semibold text-[#082D59]">
                    Live Camera QR Scanner
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  {cameraActive && (
                    <button
                      type="button"
                      onClick={handleFlipCamera}
                      className="px-2.5 py-1.5 text-xs font-semibold border border-slate-300 bg-white text-slate-700 rounded hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <SwitchCamera className="w-3.5 h-3.5" />
                      Flip Camera
                    </button>
                  )}
                  {!cameraActive ? (
                    <button
                      type="button"
                      disabled={cameraStarting}
                      onClick={() => startCamera(facingMode)}
                      className="px-3.5 py-1.5 bg-[#082D59] text-white text-xs font-semibold rounded hover:bg-[#144D8A] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      {cameraStarting ? 'Starting Camera...' : 'Start Camera'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="px-3.5 py-1.5 bg-[#8B1E24] text-white text-xs font-semibold rounded hover:bg-[#70161B] inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <CameraOff className="w-3.5 h-3.5" />
                      Stop Camera
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4">
                <div className="relative w-full aspect-[16/10] bg-slate-950 rounded-md overflow-hidden flex items-center justify-center">
                  {cameraActive ? (
                    <>
                      <video
                        ref={videoRef}
                        muted
                        playsInline
                        className="w-full h-full object-cover"
                      />
                      {/* Scanning Reticle Frame */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="w-48 h-48 sm:w-56 sm:h-56 relative">
                          <span className="absolute top-0 left-0 w-7 h-7 border-t-4 border-l-4 border-amber-400" />
                          <span className="absolute top-0 right-0 w-7 h-7 border-t-4 border-r-4 border-amber-400" />
                          <span className="absolute bottom-0 left-0 w-7 h-7 border-b-4 border-l-4 border-amber-400" />
                          <span className="absolute bottom-0 right-0 w-7 h-7 border-b-4 border-r-4 border-amber-400" />
                        </div>
                      </div>
                      <div className="pointer-events-none absolute bottom-3 inset-x-0 text-center">
                        <span className="px-3 py-1 bg-slate-950/75 text-white text-xs font-medium rounded">
                          Align any Student QR Card inside the frame
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-center px-6 py-8 space-y-3">
                      <ScanLine className="w-10 h-10 text-slate-400 mx-auto" />
                      <p className="text-sm font-semibold text-white">
                        Ready to Scan Student QR Code
                      </p>
                      <p className="text-xs text-slate-300 max-w-sm mx-auto">
                        Click <strong>Start Camera</strong> to scan a printed or on-screen student
                        QR code, or upload a saved QR PNG on the right.
                      </p>
                    </div>
                  )}
                  <canvas ref={canvasRef} className="hidden" />
                </div>
              </div>
            </div>

            {/* Right: Upload QR Image & Manual Lookup */}
            <div className="lg:col-span-5 space-y-4">
              {/* Upload QR Image */}
              <div className="bg-white border border-slate-200 rounded-md p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4 text-[#082D59]" />
                  <h3 className="text-sm font-semibold text-[#082D59]">
                    Upload Student QR Image
                  </h3>
                </div>
                <p className="text-xs text-slate-600">
                  Select a downloaded Student QR PNG or photo to decode and retrieve the full
                  student profile without a camera.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleUploadQrImage(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3.5 file:rounded-md file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-[#082D59] hover:file:bg-slate-100 cursor-pointer"
                />
              </div>

              {/* Manual Student ID Lookup */}
              <form
                onSubmit={handleManualLookup}
                className="bg-white border border-slate-200 rounded-md p-5 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-[#082D59]" />
                  <h3 className="text-sm font-semibold text-[#082D59]">
                    Direct Student ID Lookup
                  </h3>
                </div>
                <p className="text-xs text-slate-600">
                  Enter any Student ID across the school (spaces are removed automatically).
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={manualId}
                    onChange={(e) => setManualId(e.target.value)}
                    placeholder="e.g. STU2026001 or 1234"
                    className="flex-1 px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                  <button
                    type="submit"
                    disabled={loadingDossier}
                    className="px-4 py-2 bg-[#0B3C75] text-white text-xs font-semibold rounded-md hover:bg-[#144D8A] cursor-pointer disabled:opacity-60 whitespace-nowrap"
                  >
                    {loadingDossier ? 'Loading...' : 'Fetch Info'}
                  </button>
                </div>
              </form>

              {scannerMsg && (
                <div
                  className={`p-3.5 rounded-md border text-xs flex items-start gap-2.5 ${
                    scannerMsg.type === 'ok'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : scannerMsg.type === 'err'
                        ? 'border-red-200 bg-red-50 text-red-900'
                        : 'border-slate-200 bg-slate-50 text-slate-800'
                  }`}
                >
                  {scannerMsg.type === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#0F6B48]" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#8B1E24]" />
                  )}
                  <span>{scannerMsg.text}</span>
                </div>
              )}
            </div>
          </div>

          {/* Loading State */}
          {loadingDossier && (
            <div className="bg-white border border-slate-200 rounded-md p-8 text-center text-sm text-slate-600">
              Retrieving complete student registry, attendance, and examination records...
            </div>
          )}

          {/* Error State */}
          {!loadingDossier && dossierError && !dossier && (
            <div className="bg-white border border-red-200 rounded-md p-6 text-sm text-red-800 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 text-[#8B1E24]" />
              <span>{dossierError}</span>
            </div>
          )}

          {/* FULL STUDENT INFORMATION DOSSIER */}
          {!loadingDossier && dossier && (
            <div className="bg-white border-2 border-[#082D59] rounded-md overflow-hidden">
              {/* Official Dossier Header */}
              <div className="bg-[#EEF3F9] border-b-2 border-[#082D59] px-5 sm:px-6 py-5">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center gap-4">
                    <img
                      src={crestEmblemImg}
                      alt="Moreden of Education International School Crest"
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 object-contain bg-white p-1 border border-slate-300 shrink-0"
                    />
                    <div className="space-y-0.5">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-[#8B1E24]">
                        MoE — Moreden of Education International School · Complete Student Dossier
                      </p>
                      <h3 className="font-display text-2xl font-bold text-[#082D59] leading-tight">
                        {dossier.student.name}
                      </h3>
                      <p className="text-xs text-slate-700 font-mono tabular-nums">
                        Student ID: <strong>{dossier.student.studentId}</strong> · Class{' '}
                        <strong>
                          {dossier.student.className}-{dossier.student.section}
                        </strong>{' '}
                        · Roll No. <strong>{dossier.student.rollNumber}</strong> · Session{' '}
                        <strong>{dossier.academicSession}</strong>
                      </p>
                      {lastScannedLabel && (
                        <p className="no-print text-[11px] text-slate-500">
                          Retrieved via: {lastScannedLabel}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-start lg:self-center">
                    {dossierQrUrl && (
                      <div className="w-20 h-20 bg-white border border-slate-300 rounded p-1 shrink-0">
                        <img
                          src={dossierQrUrl}
                          alt={`QR for ${dossier.student.name}`}
                          className="w-full h-full object-contain"
                        />
                      </div>
                    )}
                    <div className="no-print flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setShowMarksheetModal(true)}
                        className="px-3 py-2 bg-[#082D59] text-white text-xs font-semibold rounded hover:bg-[#144D8A] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Award className="w-3.5 h-3.5" />
                        Official Marksheet
                      </button>
                      <button
                        type="button"
                        disabled={!dossierQrUrl}
                        onClick={() =>
                          handleDownloadQrPng(
                            dossierQrUrl,
                            dossier.student.studentId,
                            dossier.student.name
                          )
                        }
                        className="px-3 py-2 border border-slate-300 bg-white text-slate-800 text-xs font-semibold rounded hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download QR
                      </button>
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="px-3 py-2 border border-slate-300 bg-white text-slate-800 text-xs font-semibold rounded hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Print Dossier
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMode('registry');
                          setDossier(null);
                        }}
                        className="px-3 py-2 border border-slate-300 bg-white text-slate-700 text-xs font-semibold rounded hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        Registry
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-5 sm:p-6 space-y-6">
                {/* 1. Registry Identity & Admission / Family Profile */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Registry Identity Table */}
                  <div className="border border-slate-200 rounded-md overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                      <User className="w-4 h-4 text-[#082D59]" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#082D59]">
                        School Registry Identity
                      </h4>
                    </div>
                    <table className="w-full text-left border-collapse text-xs">
                      <tbody className="divide-y divide-slate-200 tabular-nums">
                        <tr>
                          <th className="py-2.5 px-3.5 bg-slate-50/60 font-semibold text-slate-600 w-40">
                            Full Name
                          </th>
                          <td className="py-2.5 px-3.5 font-semibold text-slate-900">
                            {dossier.student.name}
                          </td>
                        </tr>
                        <tr>
                          <th className="py-2.5 px-3.5 bg-slate-50/60 font-semibold text-slate-600">
                            Student ID
                          </th>
                          <td className="py-2.5 px-3.5 font-mono font-bold text-[#082D59]">
                            {dossier.student.studentId}
                          </td>
                        </tr>
                        <tr>
                          <th className="py-2.5 px-3.5 bg-slate-50/60 font-semibold text-slate-600">
                            Class &amp; Section
                          </th>
                          <td className="py-2.5 px-3.5 font-semibold text-slate-900">
                            Class {dossier.student.className} — Section {dossier.student.section}
                          </td>
                        </tr>
                        <tr>
                          <th className="py-2.5 px-3.5 bg-slate-50/60 font-semibold text-slate-600">
                            Class Roll Number
                          </th>
                          <td className="py-2.5 px-3.5 font-mono font-semibold text-slate-900">
                            {dossier.student.rollNumber}
                          </td>
                        </tr>
                        <tr>
                          <th className="py-2.5 px-3.5 bg-slate-50/60 font-semibold text-slate-600">
                            Board Roll / Reg. No.
                          </th>
                          <td className="py-2.5 px-3.5 font-mono text-slate-800">
                            {dossier.student.boardNo || 'Not Assigned'}
                          </td>
                        </tr>
                        <tr>
                          <th className="py-2.5 px-3.5 bg-slate-50/60 font-semibold text-slate-600">
                            Registered On
                          </th>
                          <td className="py-2.5 px-3.5 text-slate-700">
                            {formatDateDisplay(dossier.student.createdAt)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Admission & Guardian Profile */}
                  <div className="border border-slate-200 rounded-md overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#082D59]">
                        Admission &amp; Family Particulars
                      </h4>
                      {dossier.admissionProfile && (
                        <span className="text-[11px] font-mono text-slate-600">
                          App: {dossier.admissionProfile.applicationCode}
                        </span>
                      )}
                    </div>
                    {dossier.admissionProfile ? (
                      <table className="w-full text-left border-collapse text-xs">
                        <tbody className="divide-y divide-slate-200 tabular-nums">
                          <tr>
                            <th className="py-2 px-3.5 bg-slate-50/60 font-semibold text-slate-600 w-40">
                              Father&apos;s Name
                            </th>
                            <td className="py-2 px-3.5 text-slate-900 font-medium">
                              {dossier.admissionProfile.fatherName || '—'}
                            </td>
                          </tr>
                          <tr>
                            <th className="py-2 px-3.5 bg-slate-50/60 font-semibold text-slate-600">
                              Mother&apos;s Name
                            </th>
                            <td className="py-2 px-3.5 text-slate-900 font-medium">
                              {dossier.admissionProfile.motherName || '—'}
                            </td>
                          </tr>
                          <tr>
                            <th className="py-2 px-3.5 bg-slate-50/60 font-semibold text-slate-600">
                              DOB / Gender / Category
                            </th>
                            <td className="py-2 px-3.5 text-slate-800">
                              {formatDateDisplay(dossier.admissionProfile.dob)} ·{' '}
                              {dossier.admissionProfile.gender || '—'} ·{' '}
                              {dossier.admissionProfile.category || 'General'}
                            </td>
                          </tr>
                          <tr>
                            <th className="py-2 px-3.5 bg-slate-50/60 font-semibold text-slate-600">
                              Contact Phone &amp; Email
                            </th>
                            <td className="py-2 px-3.5 text-slate-800">
                              <span className="font-mono">
                                {dossier.admissionProfile.contactPhone || '—'}
                              </span>
                              {dossier.admissionProfile.contactEmail && (
                                <span className="block text-slate-600">
                                  {dossier.admissionProfile.contactEmail}
                                </span>
                              )}
                            </td>
                          </tr>
                          <tr>
                            <th className="py-2 px-3.5 bg-slate-50/60 font-semibold text-slate-600">
                              Residential Address
                            </th>
                            <td className="py-2 px-3.5 text-slate-800">
                              {dossier.admissionProfile.address || '—'}
                            </td>
                          </tr>
                          <tr>
                            <th className="py-2 px-3.5 bg-slate-50/60 font-semibold text-slate-600">
                              Previous School &amp; %
                            </th>
                            <td className="py-2 px-3.5 text-slate-800">
                              {dossier.admissionProfile.previousSchool || '—'}
                              {dossier.admissionProfile.previousPercentage
                                ? ` (${dossier.admissionProfile.previousPercentage}%)`
                                : ''}
                              {dossier.admissionProfile.streamApplied
                                ? ` · Stream: ${dossier.admissionProfile.streamApplied}`
                                : ''}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-5 text-xs text-slate-600 leading-relaxed">
                        This student was enrolled directly through the Class Teacher Registry (no
                        online admission application record linked). Core identity, attendance, and
                        examination records are synced live below.
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Attendance Overview & Recent Log */}
                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CalendarCheck className="w-4 h-4 text-[#082D59]" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#082D59]">
                        Attendance Summary
                      </h4>
                    </div>
                    <span className="text-xs font-mono font-semibold text-slate-700 tabular-nums">
                      {dossier.attendance.percentage !== null
                        ? `${dossier.attendance.percentage}% Attendance`
                        : 'No Attendance Recorded'}
                    </span>
                  </div>

                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 tabular-nums">
                      <div className="border border-slate-200 rounded p-3 bg-slate-50/50">
                        <p className="text-[11px] text-slate-500 font-semibold">Total Marked</p>
                        <p className="text-lg font-mono font-bold text-slate-900">
                          {dossier.attendance.total}
                        </p>
                      </div>
                      <div className="border border-emerald-200 rounded p-3 bg-emerald-50/50">
                        <p className="text-[11px] text-emerald-800 font-semibold">Present</p>
                        <p className="text-lg font-mono font-bold text-[#0F6B48]">
                          {dossier.attendance.present}
                        </p>
                      </div>
                      <div className="border border-red-200 rounded p-3 bg-red-50/50">
                        <p className="text-[11px] text-red-800 font-semibold">Absent</p>
                        <p className="text-lg font-mono font-bold text-[#8B1E24]">
                          {dossier.attendance.absent}
                        </p>
                      </div>
                      <div className="border border-amber-200 rounded p-3 bg-amber-50/50">
                        <p className="text-[11px] text-amber-800 font-semibold">Leave</p>
                        <p className="text-lg font-mono font-bold text-amber-700">
                          {dossier.attendance.leave}
                        </p>
                      </div>
                      <div className="border border-slate-200 rounded p-3 bg-[#EEF3F9]/60">
                        <p className="text-[11px] text-[#082D59] font-semibold">Attendance %</p>
                        <p className="text-lg font-mono font-bold text-[#082D59]">
                          {dossier.attendance.percentage !== null
                            ? `${dossier.attendance.percentage}%`
                            : '—'}
                        </p>
                      </div>
                    </div>

                    {dossier.attendance.recentRecords.length > 0 && (
                      <div className="max-h-48 overflow-y-auto border border-slate-200 rounded">
                        <table className="w-full text-left border-collapse text-xs tabular-nums">
                          <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                            <tr>
                              <th className="py-2 px-3.5">Date</th>
                              <th className="py-2 px-3.5 text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {dossier.attendance.recentRecords.map((rec) => (
                              <tr key={rec.date}>
                                <td className="py-2 px-3.5 font-mono text-slate-800">{rec.date}</td>
                                <td
                                  className={`py-2 px-3.5 text-right font-semibold ${
                                    rec.status === 'Present'
                                      ? 'text-[#0F6B48]'
                                      : rec.status === 'Absent'
                                        ? 'text-[#8B1E24]'
                                        : 'text-amber-700'
                                  }`}
                                >
                                  {rec.status}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Academic & Examination Marks */}
                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-[#082D59]" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#082D59]">
                        Examination Performance ({dossier.academicSession})
                      </h4>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
                      <span>
                        Aggregate:{' '}
                        <strong>
                          {dossier.summary.grandMax > 0
                            ? `${dossier.summary.grandObtained} / ${dossier.summary.grandMax}`
                            : '—'}
                        </strong>
                      </span>
                      <span>
                        Percentage:{' '}
                        <strong>
                          {dossier.summary.grandMax > 0 ? `${dossier.summary.percentage}%` : '—'}
                        </strong>
                      </span>
                      <span>
                        Grade: <strong>{dossier.summary.overallGrade}</strong>
                      </span>
                      <span className="font-semibold text-[#082D59]">
                        {dossier.summary.overallStatus}
                      </span>
                    </div>
                  </div>

                  {dossier.schemes.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">
                      No examination marking scheme configured for Class {dossier.student.className}{' '}
                      yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs tabular-nums">
                        <thead>
                          <tr className="bg-[#EEF3F9] border-b border-slate-200 text-[#082D59] font-semibold">
                            <th className="py-2.5 px-3.5">Subject</th>
                            {dossier.schemes.map((sch) => (
                              <th key={sch.id} className="py-2.5 px-3 text-right whitespace-nowrap">
                                {sch.assessmentName}
                                <span className="block text-[10px] font-mono font-normal text-slate-500">
                                  Max {sch.maxMarks}
                                </span>
                              </th>
                            ))}
                            <th className="py-2.5 px-3 text-right">Total</th>
                            <th className="py-2.5 px-3 text-right">%</th>
                            <th className="py-2.5 px-3 text-center">Grade</th>
                            <th className="py-2.5 px-3.5 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {dossier.subjectResults.map((sub) => (
                            <tr key={sub.subject}>
                              <td className="py-2.5 px-3.5 font-semibold text-slate-900">
                                {sub.subject}
                              </td>
                              {sub.assessments.map((a) => (
                                <td
                                  key={a.assessmentId}
                                  className={`py-2.5 px-3 text-right font-mono ${
                                    a.marksObtained !== null && a.passed === false
                                      ? 'text-[#8B1E24] font-bold'
                                      : 'text-slate-800'
                                  }`}
                                >
                                  {a.marksObtained !== null ? a.marksObtained : '—'}
                                </td>
                              ))}
                              <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                                {sub.totalObtained !== null
                                  ? `${sub.totalObtained}/${sub.totalMax}`
                                  : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                                {sub.percentage !== null ? `${sub.percentage}%` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-center font-mono font-bold text-[#082D59]">
                                {sub.grade ?? '—'}
                              </td>
                              <td
                                className={`py-2.5 px-3.5 text-right font-semibold whitespace-nowrap ${
                                  sub.status === 'Pass'
                                    ? 'text-[#0F6B48]'
                                    : sub.status === 'Needs Improvement'
                                      ? 'text-[#8B1E24]'
                                      : 'text-slate-400'
                                }`}
                              >
                                {sub.status}
                              </td>
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

          {/* Official Marksheet Modal */}
          {showMarksheetModal && dossier && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-start justify-center p-4 overflow-y-auto">
              <div className="max-w-5xl w-full my-6">
                <OfficialResultSheet
                  academicSession={dossier.academicSession}
                  publicationScope="full"
                  isPreview={true}
                  onClose={() => setShowMarksheetModal(false)}
                  student={{
                    studentId: dossier.student.studentId,
                    rollNumber: dossier.student.rollNumber,
                    boardNo: dossier.student.boardNo,
                    name: dossier.student.name,
                    className: dossier.student.className,
                    section: dossier.student.section,
                  }}
                  attendance={
                    dossier.attendance.total > 0
                      ? {
                          total: dossier.attendance.total,
                          present: dossier.attendance.present,
                          absent: dossier.attendance.absent,
                          leave: dossier.attendance.leave,
                          percentage: dossier.attendance.percentage,
                        }
                      : null
                  }
                  schemes={dossier.schemes}
                  subjectResults={dossier.subjectResults}
                  summary={dossier.summary}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
