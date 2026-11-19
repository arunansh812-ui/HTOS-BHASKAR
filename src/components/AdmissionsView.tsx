import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpen,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FileText,
  Info,
  Lock,
  Printer,
  RefreshCw,
  Search,
  Upload,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { crestEmblemImg } from '../assets/schoolImages.ts';
import { apiFetch, readFileAsBase64 } from '../lib/api.ts';
import {
  CLASSES,
  DOB_YEAR_LIMITS,
  SENIOR_STREAMS,
  type AdmissionApplication,
  type AdmissionConfig,
  type ClassName,
  type MeritListEntry,
  findEligibleClassesForDOB,
  validateAdmissionDOB,
  validateFullName,
} from '../shared/schoolRules.ts';

interface AdmissionsViewProps {
  admissionsEnabled: boolean;
  admissionConfig?: AdmissionConfig | null;
}

type DeskTab = 'prospectus' | 'apply' | 'status' | 'merit';

const DEFAULT_SEATS: Record<string, number> = {
  IV: 40,
  V: 40,
  VI: 40,
  VII: 40,
  VIII: 40,
  IX: 45,
  X: 45,
  XI: 60,
  XII: 40,
};

export function AdmissionsView({ admissionsEnabled, admissionConfig }: AdmissionsViewProps) {
  const effectiveConfig: AdmissionConfig = useMemo(
    () =>
      admissionConfig || {
        admissionsEnabled,
        academicSession: '2026–2027',
        openClasses: [...CLASSES],
        closingDate: null,
        instructions:
          'Keep student passport photograph, Birth Certificate / Aadhaar, and previous class marksheet ready before applying.',
        publishMeritList: false,
        classSeats: DEFAULT_SEATS,
      },
    [admissionConfig, admissionsEnabled]
  );

  const openClasses = effectiveConfig.openClasses;
  const firstOpenClass: ClassName = openClasses[0] || 'IV';

  const [tab, setTab] = useState<DeskTab>('prospectus');

  // Interactive DOB Eligibility Calculator
  const [calcDob, setCalcDob] = useState('');
  const calcEligibleClasses = useMemo(() => findEligibleClassesForDOB(calcDob), [calcDob]);

  // Guided 3-step Apply Wizard state
  const [applyStep, setApplyStep] = useState<1 | 2 | 3>(1);
  const [studentName, setStudentName] = useState('');
  const [classApplied, setClassApplied] = useState<ClassName>(firstOpenClass);
  const [streamApplied, setStreamApplied] = useState<string>(SENIOR_STREAMS[0]);
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('Male');

  const [fatherName, setFatherName] = useState('');
  const [motherName, setMotherName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [address, setAddress] = useState('');
  const [previousSchool, setPreviousSchool] = useState('');
  const [previousPercentage, setPreviousPercentage] = useState('');
  const [tcNumber, setTcNumber] = useState('');

  // Photograph & Supporting Doc state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [confirmedPhoto, setConfirmedPhoto] = useState<string | null>(null);

  const [docBase64, setDocBase64] = useState<string | null>(null);
  const [docFilename, setDocFilename] = useState<string | null>(null);
  const [declarationChecked, setDeclarationChecked] = useState(false);

  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedApp, setSubmittedApp] = useState<AdmissionApplication | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Track Status state (Dual mode: Application ID OR Student Details)
  const [lookupMode, setLookupMode] = useState<'code' | 'details'>('code');
  const [stAppCode, setStAppCode] = useState('');
  const [stDob, setStDob] = useState('');
  const [stName, setStName] = useState('');
  const [stFather, setStFather] = useState('');
  const [stMother, setStMother] = useState('');
  const [stClass, setStClass] = useState<ClassName>('IV');
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusResult, setStatusResult] = useState<AdmissionApplication | null>(null);

  // Correction Resubmit state
  const [corrStudentName, setCorrStudentName] = useState('');
  const [corrFatherName, setCorrFatherName] = useState('');
  const [corrMotherName, setCorrMotherName] = useState('');
  const [corrPhone, setCorrPhone] = useState('');
  const [corrEmail, setCorrEmail] = useState('');
  const [corrAddress, setCorrAddress] = useState('');
  const [corrPrevSchool, setCorrPrevSchool] = useState('');
  const [corrPrevPct, setCorrPrevPct] = useState('');
  const [corrTcNumber, setCorrTcNumber] = useState('');
  const [corrDocBase64, setCorrDocBase64] = useState<string | null>(null);
  const [corrDocName, setCorrDocName] = useState<string | null>(null);
  const [corrSaving, setCorrSaving] = useState(false);
  const [corrMsg, setCorrMsg] = useState<string | null>(null);

  // Merit List state
  const [meritLoading, setMeritLoading] = useState(false);
  const [meritPublished, setMeritPublished] = useState(effectiveConfig.publishMeritList);
  const [meritSession, setMeritSession] = useState(effectiveConfig.academicSession);
  const [meritEntries, setMeritEntries] = useState<MeritListEntry[]>([]);
  const [meritClassFilter, setMeritClassFilter] = useState<string>('ALL');
  const [meritSearch, setMeritSearch] = useState('');

  useEffect(() => {
    if (openClasses.length > 0 && !openClasses.includes(classApplied)) {
      setClassApplied(openClasses[0]);
    }
  }, [openClasses, classApplied]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {
        // autoplay handled by muted/playsInline
      });
    }
  }, [cameraOpen]);

  const loadMeritList = useCallback(async () => {
    setMeritLoading(true);
    try {
      const res = await apiFetch<{
        published: boolean;
        academicSession: string;
        entries: MeritListEntry[];
      }>('/api/admissions/merit-list');
      setMeritPublished(res.published);
      setMeritSession(res.academicSession);
      setMeritEntries(res.entries || []);
    } catch {
      setMeritPublished(false);
      setMeritEntries([]);
    } finally {
      setMeritLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'merit') {
      void loadMeritList();
    }
  }, [tab, loadMeritList]);

  useEffect(() => {
    if (statusResult && statusResult.status === 'Correction Needed') {
      setCorrStudentName(statusResult.studentName);
      setCorrFatherName(statusResult.fatherName);
      setCorrMotherName(statusResult.motherName);
      setCorrPhone(statusResult.contactPhone);
      setCorrEmail(statusResult.contactEmail || '');
      setCorrAddress(statusResult.address);
      setCorrPrevSchool(statusResult.previousSchool || '');
      setCorrPrevPct(statusResult.previousPercentage || '');
      setCorrTcNumber(statusResult.tcNumber || '');
      setCorrDocBase64(null);
      setCorrDocName(null);
      setCorrMsg(null);
    }
  }, [statusResult]);

  const handleOpenCamera = async () => {
    setCameraError(null);
    setCapturedPreview(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Live camera access is unavailable in this browser. Please upload a passport photo file directly.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
    } catch (err) {
      const msg =
        (err as Error)?.name === 'NotAllowedError'
          ? 'Camera permission denied. Use the Upload Photo File button instead.'
          : 'Unable to open camera on this device. Use the Upload Photo File button instead.';
      setCameraError(msg);
      setCameraOpen(false);
    }
  };

  const handleCapturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setCapturedPreview(dataUrl);
    stopCamera();
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setCameraError('Please select a valid image file (JPG, PNG, or WEBP).');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setCameraError('Photograph file must be 6 MB or smaller.');
      return;
    }
    try {
      const b64 = await readFileAsBase64(file);
      setCapturedPreview(b64);
      setConfirmedPhoto(b64);
      setCameraError(null);
      stopCamera();
    } catch (err) {
      setCameraError((err as Error).message);
    }
  };

  const handleSupportingDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      setStepError('Supporting document must be a PDF, JPG, PNG, or WEBP file.');
      return;
    }
    if (file.size > 5.5 * 1024 * 1024) {
      setStepError('Supporting document must be under 5.5 MB.');
      return;
    }
    try {
      const b64 = await readFileAsBase64(file);
      setDocBase64(b64);
      setDocFilename(file.name);
      setStepError(null);
    } catch (err) {
      setStepError((err as Error).message);
    }
  };

  const validateStep1 = (): string | null => {
    if (!openClasses.includes(classApplied)) {
      return `Admissions for Class ${classApplied} are currently closed by the Nodal Officer.`;
    }
    const nameErr = validateFullName(studentName, "Student's Full Name");
    if (nameErr) return nameErr;
    const dobErr = validateAdmissionDOB(dob, classApplied);
    if (dobErr) return dobErr;
    if ((classApplied === 'XI' || classApplied === 'XII') && !streamApplied) {
      return 'Please select an academic stream for Senior Secondary admission.';
    }
    return null;
  };

  const validateStep2 = (): string | null => {
    const pErr =
      validateFullName(fatherName, "Father's Name") ||
      validateFullName(motherName, "Mother's Name");
    if (pErr) return pErr;
    if (!/^[+\d][\d\s-]{8,16}$/.test(contactPhone.trim())) {
      return 'Please enter a valid 10-digit parent/guardian mobile number.';
    }
    if (address.trim().length < 5) {
      return 'Please enter a complete residential address (at least 5 characters).';
    }
    if (previousPercentage.trim() !== '') {
      const pct = Number(previousPercentage);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) {
        return 'Previous class percentage must be between 0 and 100.';
      }
    }
    return null;
  };

  const goToNextStep = () => {
    setStepError(null);
    if (applyStep === 1) {
      const err = validateStep1();
      if (err) {
        setStepError(err);
        return;
      }
      setApplyStep(2);
      return;
    }
    if (applyStep === 2) {
      const err = validateStep2();
      if (err) {
        setStepError(err);
        return;
      }
      setApplyStep(3);
    }
  };

  const handleApplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStepError(null);

    const err1 = validateStep1();
    if (err1) {
      setApplyStep(1);
      setStepError(err1);
      return;
    }
    const err2 = validateStep2();
    if (err2) {
      setApplyStep(2);
      setStepError(err2);
      return;
    }
    if (!confirmedPhoto) {
      setStepError('Please upload or capture the student photograph before final submission.');
      return;
    }
    if (!declarationChecked) {
      setStepError('Please confirm the parent/guardian declaration checkbox to submit.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{ application: AdmissionApplication }>('/api/admissions/apply', {
        method: 'POST',
        body: JSON.stringify({
          studentName,
          fatherName,
          motherName,
          dob,
          gender,
          address,
          contactPhone,
          contactEmail,
          previousSchool,
          previousPercentage,
          tcNumber,
          classApplied,
          streamApplied: classApplied === 'XI' || classApplied === 'XII' ? streamApplied : null,
          photoBase64: confirmedPhoto,
          documentBase64: docBase64,
          documentFilename: docFilename,
        }),
      });
      setSubmittedApp(res.application);
      setStAppCode(res.application.applicationCode);
      setStDob(res.application.dob);
      setApplyStep(1);
      setStudentName('');
      setFatherName('');
      setMotherName('');
      setDob('');
      setAddress('');
      setContactPhone('');
      setContactEmail('');
      setPreviousSchool('');
      setPreviousPercentage('');
      setTcNumber('');
      setConfirmedPhoto(null);
      setCapturedPreview(null);
      setDocBase64(null);
      setDocFilename(null);
      setDeclarationChecked(false);
    } catch (err) {
      setStepError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const runStatusCheck = async (
    payload:
      | { applicationCode: string; dob: string }
      | { studentName: string; fatherName: string; motherName?: string; dob: string; classApplied: ClassName }
  ) => {
    setStatusError(null);
    setStatusLoading(true);
    try {
      const res = await apiFetch<{ application: AdmissionApplication }>('/api/admissions/status', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setStatusResult(res.application);
    } catch (err) {
      setStatusResult(null);
      setStatusError((err as Error).message);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleCheckStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lookupMode === 'code') {
      await runStatusCheck({ applicationCode: stAppCode.trim().toUpperCase(), dob: stDob });
    } else {
      await runStatusCheck({
        studentName: stName.trim(),
        fatherName: stFather.trim(),
        motherName: stMother.trim(),
        dob: stDob,
        classApplied: stClass,
      });
    }
  };

  const handleRefreshTracked = async () => {
    if (!statusResult) return;
    await runStatusCheck({
      applicationCode: statusResult.applicationCode,
      dob: statusResult.dob,
    });
  };

  const handleCorrectionResubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusResult) return;
    setCorrMsg(null);
    setStatusError(null);
    setCorrSaving(true);
    try {
      const res = await apiFetch<{ application: AdmissionApplication }>('/api/admissions/resubmit', {
        method: 'POST',
        body: JSON.stringify({
          applicationCode: statusResult.applicationCode,
          dob: statusResult.dob,
          studentName: corrStudentName,
          fatherName: corrFatherName,
          motherName: corrMotherName,
          contactPhone: corrPhone,
          contactEmail: corrEmail,
          address: corrAddress,
          previousSchool: corrPrevSchool,
          previousPercentage: corrPrevPct,
          tcNumber: corrTcNumber,
          documentBase64: corrDocBase64,
          documentFilename: corrDocName,
        }),
      });
      setStatusResult(res.application);
      setCorrMsg('Corrections submitted successfully. Application returned to Pending Nodal Officer Review.');
    } catch (err) {
      setStatusError((err as Error).message);
    } finally {
      setCorrSaving(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // clipboard blocked in restricted context
    }
  };

  const dobValidationLive = dob ? validateAdmissionDOB(dob, classApplied) : null;
  const dobHint = DOB_YEAR_LIMITS[classApplied].label;

  const filteredMerit = meritEntries.filter((entry) => {
    if (meritClassFilter !== 'ALL' && entry.classApplied !== meritClassFilter) return false;
    const q = meritSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      entry.studentName.toLowerCase().includes(q) ||
      entry.applicationCode.toLowerCase().includes(q) ||
      (entry.rollNumber || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Institutional Admission Portal Masthead */}
      <div className="no-print bg-white border border-slate-200 rounded-md overflow-hidden shadow-xs">
        <div className="bg-[#082D59] px-6 py-5 text-white flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b-2 border-[#D97706]">
          <div className="flex items-start sm:items-center gap-4">
            <img
              src={crestEmblemImg}
              alt="Moreden of Education International School Crest"
              className="w-14 h-14 object-contain shrink-0 bg-white rounded border border-white/20 p-1"
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                Nodal Officer Admission Registry · Academic Session {effectiveConfig.academicSession}
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white mt-0.5">
                Online Admission &amp; Allotment Portal
              </h1>
              <p className="text-xs text-blue-100 mt-1">
                Grades IV to XII · Regulated exclusively by the Nodal Officer Control Registry
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-center">
            <div
              className={`px-3.5 py-2 rounded border text-xs font-semibold whitespace-nowrap ${
                admissionsEnabled && openClasses.length > 0
                  ? 'border-emerald-300/40 bg-[#0F6B48] text-white'
                  : 'border-red-300/40 bg-[#8B1E24] text-white'
              }`}
            >
              Portal Status:{' '}
              {admissionsEnabled && openClasses.length > 0
                ? `Open (${openClasses.length} ${openClasses.length === 1 ? 'Class' : 'Classes'})`
                : 'Registration Closed'}
            </div>
            {effectiveConfig.closingDate && (
              <div className="px-3.5 py-2 rounded border border-white/20 bg-white/10 text-xs font-medium text-white whitespace-nowrap font-mono tabular-nums">
                Last Date: {effectiveConfig.closingDate}
              </div>
            )}
          </div>
        </div>

        {/* Nodal Officer Official Instructions Strip */}
        {effectiveConfig.instructions && (
          <div className="px-6 py-3.5 bg-[#EEF3F9] flex items-start gap-2.5 text-xs text-[#082D59]">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#8B1E24]" />
            <div>
              <span className="font-bold">Nodal Officer Admission Notice: </span>
              <span className="text-slate-700">{effectiveConfig.instructions}</span>
            </div>
          </div>
        )}
      </div>

      {/* 4-Section Portal Navigation Tabs */}
      <div className="no-print flex flex-wrap gap-1.5 p-1.5 bg-[#E4ECF5] rounded-md border border-slate-200 w-full sm:w-fit">
        {(
          [
            { id: 'prospectus', label: '1. Prospectus & Eligibility', icon: BookOpen },
            { id: 'apply', label: '2. Apply Online', icon: ClipboardCheck },
            { id: 'status', label: '3. Track Status & Allotment', icon: Search },
            { id: 'merit', label: '4. Merit List', icon: Award },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-[#082D59] text-white shadow-xs'
                  : 'text-[#082D59] hover:bg-white/80'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: PROSPECTUS, ELIGIBILITY CALCULATOR & SEAT MATRIX */}
      {tab === 'prospectus' && (
        <div className="space-y-6">
          {/* Step-by-step admission lifecycle */}
          <div className="bg-white border border-slate-200 rounded-md p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold text-slate-900">
                  How the Admission Process Works
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Follow these four transparent steps from eligibility verification to roll allotment.
                </p>
              </div>
              {admissionsEnabled && openClasses.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTab('apply')}
                  className="px-4 py-2 bg-[#0B3C75] text-white text-xs sm:text-sm font-semibold rounded-lg hover:bg-[#144D8A] inline-flex items-center gap-2 cursor-pointer whitespace-nowrap self-start"
                >
                  Start Online Application
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  step: 'Step 01',
                  title: 'Verify Age & Open Class',
                  desc: 'Confirm your child matches the official birth-year window and sanctioned seats for the class.',
                },
                {
                  step: 'Step 02',
                  title: 'Submit Guided Form',
                  desc: 'Complete personal, academic details, upload photo & optional Birth Certificate / Marksheet.',
                },
                {
                  step: 'Step 03',
                  title: 'Evaluation & Merit Ranking',
                  desc: 'Nodal Officer verifies documents, assigns evaluation marks, and publishes the automated Merit List.',
                },
                {
                  step: 'Step 04',
                  title: 'Allotment Slip & Roll No.',
                  desc: 'Track anytime with Application ID + DOB and print your official Allotment Slip.',
                },
              ].map((s) => (
                <div
                  key={s.step}
                  className="p-4 rounded-lg border border-slate-200 bg-[#F4F6F9]/70 space-y-1.5"
                >
                  <p className="text-[11px] font-mono font-bold text-[#7C1D24] uppercase tracking-wider">
                    {s.step}
                  </p>
                  <p className="text-sm font-semibold text-slate-900">{s.title}</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Interactive Child DOB Eligibility Finder + Document Checklist */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#EEF3F9] text-[#0B3C75] flex items-center justify-center shrink-0">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    Interactive Age &amp; Class Eligibility Finder
                  </h2>
                  <p className="text-xs text-slate-500">
                    Select the applicant&apos;s Date of Birth to check which classes they qualify for automatically.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="sm:w-64">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Student Date of Birth
                  </label>
                  <input
                    type="date"
                    value={calcDob}
                    onChange={(e) => setCalcDob(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>
                {calcDob && (
                  <button
                    type="button"
                    onClick={() => setCalcDob('')}
                    className="px-3 py-2 text-xs font-semibold text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer self-start sm:self-end"
                  >
                    Clear Date
                  </button>
                )}
              </div>

              {calcDob ? (
                calcEligibleClasses.length > 0 ? (
                  <div className="space-y-2.5 pt-1">
                    <p className="text-xs font-semibold text-emerald-800">
                      Eligible Classes for DOB <span className="font-mono">{calcDob}</span>:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {calcEligibleClasses.map((cls) => {
                        const isOpen = admissionsEnabled && openClasses.includes(cls);
                        const seats = effectiveConfig.classSeats[cls] ?? 40;
                        return (
                          <div
                            key={cls}
                            className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-2"
                          >
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Class {cls}</p>
                              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                                {seats} seats · {isOpen ? 'Admissions Open' : 'Currently Closed'}
                              </p>
                            </div>
                            {isOpen && (
                              <button
                                type="button"
                                onClick={() => {
                                  setClassApplied(cls);
                                  setDob(calcDob);
                                  setApplyStep(1);
                                  setTab('apply');
                                }}
                                className="px-3 py-1.5 bg-[#0B3C75] text-white text-xs font-semibold rounded-md hover:bg-[#144D8A] cursor-pointer whitespace-nowrap"
                              >
                                Apply Now
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900">
                    The selected birth year does not match Classes IV–XII criteria (2004–2016). Please verify the Date of Birth.
                  </div>
                )
              ) : (
                <p className="text-xs text-slate-500">
                  Tip: Choose a birth date above to pre-fill your eligibility and jump directly into the online form.
                </p>
              )}
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#FFF5EB] text-[#7C1D24] flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    Required Documents Checklist
                  </h2>
                  <p className="text-xs text-slate-500">
                    Keep digital copies ready for smooth online submission.
                  </p>
                </div>
              </div>
              <ul className="space-y-2 text-xs text-slate-700 pt-1">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0B3C75] shrink-0 mt-0.5" />
                  <span>
                    <strong>Passport Size Photograph (Mandatory):</strong> Recent color photo (JPG/PNG or live webcam capture).
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0B3C75] shrink-0 mt-0.5" />
                  <span>
                    <strong>Date of Birth Proof:</strong> Municipal Birth Certificate / Aadhaar Card (optional PDF/Image upload online).
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#0B3C75] shrink-0 mt-0.5" />
                  <span>
                    <strong>Previous Academic Record &amp; TC:</strong> Previous class marksheet and Transfer Certificate number (for Classes V–XII).
                  </span>
                </li>
              </ul>
            </div>
          </div>

          {/* Class-wise Admission Status & Seat Matrix */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Class-Wise Admission Matrix ({effectiveConfig.academicSession})
                </h2>
                <p className="text-xs text-slate-500">
                  Controlled live by the Nodal Officer Registry.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#EEF3F9] border-b border-slate-200 text-xs font-semibold text-[#0B3C75]">
                    <th className="py-3 px-4">Class</th>
                    <th className="py-3 px-4">Birth Year Window</th>
                    <th className="py-3 px-4">Streams / Notes</th>
                    <th className="py-3 px-4">Sanctioned Seats</th>
                    <th className="py-3 px-4">Portal Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
                  {CLASSES.map((cls) => {
                    const isOpen = admissionsEnabled && openClasses.includes(cls);
                    const seats = effectiveConfig.classSeats[cls] ?? DEFAULT_SEATS[cls] ?? 40;
                    const lim = DOB_YEAR_LIMITS[cls];
                    return (
                      <tr key={cls} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-semibold text-slate-900">Class {cls}</td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-700">
                          {lim.minYear} – {lim.maxYear}
                        </td>
                        <td className="py-3 px-4 text-slate-600 text-xs">
                          {cls === 'XI' || cls === 'XII'
                            ? 'Science (PCM / PCB), Commerce, Humanities'
                            : 'General MoE Curriculum'}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-800">
                          {seats}
                        </td>
                        <td className="py-3 px-4">
                          {isOpen ? (
                            <span className="font-semibold text-emerald-700">Open for Registration</span>
                          ) : (
                            <span className="font-medium text-slate-500">Closed by Nodal Officer</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: APPLY ONLINE (3-STEP WIZARD) */}
      {tab === 'apply' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          {!admissionsEnabled || openClasses.length === 0 ? (
            <div className="py-12 text-center max-w-lg mx-auto space-y-4">
              <div className="w-12 h-12 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center mx-auto">
                <Lock className="w-6 h-6" />
              </div>
              <h2 className="font-display text-2xl font-semibold text-slate-900">
                Online Registration Currently Closed
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                New admission registrations are currently closed in the Nodal Officer Registry. Once
                the Nodal Officer opens admissions for Session {effectiveConfig.academicSession},
                the guided application form will appear here immediately.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setTab('prospectus')}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  View Eligibility &amp; Seat Matrix
                </button>
                <button
                  type="button"
                  onClick={() => setTab('status')}
                  className="px-4 py-2 bg-[#0B3C75] text-white text-xs font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer"
                >
                  Track Existing Application
                </button>
              </div>
            </div>
          ) : submittedApp ? (
            <div className="print-sheet space-y-6">
              <div className="no-print p-4 rounded-lg border border-emerald-200 bg-emerald-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-900">
                      Application Registered Successfully!
                    </p>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      Save your Application Reference ID below to track Nodal Officer review or edit
                      if corrections are requested.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyCode(submittedApp.applicationCode)}
                    className="px-3 py-1.5 bg-white border border-emerald-300 text-emerald-900 text-xs font-semibold rounded-lg hover:bg-emerald-100 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedCode ? 'Copied ID' : 'Copy ID'}
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-3 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print Receipt
                  </button>
                </div>
              </div>

              {/* Printable Official Acknowledgement Receipt */}
              <div className="border-2 border-[#0B3C75] rounded-lg p-6 space-y-5">
                <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={crestEmblemImg}
                      alt="School Crest"
                      className="w-12 h-12 object-contain shrink-0"
                    />
                    <div>
                      <p className="text-xs font-semibold text-[#0B3C75] uppercase tracking-wider">
                        Moreden of Education International School
                      </p>
                      <h2 className="font-display text-xl font-semibold text-slate-900">
                        Provisional Admission Registration Receipt
                      </h2>
                      <p className="text-xs font-mono text-slate-500">
                        Submitted on {new Date(submittedApp.createdAt).toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-500">Application ID</p>
                    <p className="font-mono text-base font-bold text-[#7C1D24] tabular-nums">
                      {submittedApp.applicationCode}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
                  <div className="sm:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">Student Name</p>
                      <p className="font-semibold text-slate-900">{submittedApp.studentName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Class &amp; Stream</p>
                      <p className="font-semibold text-slate-900">
                        Class {submittedApp.classApplied}
                        {submittedApp.streamApplied ? ` · ${submittedApp.streamApplied}` : ''}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Father&apos;s Name</p>
                      <p className="font-medium text-slate-800">{submittedApp.fatherName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Mother&apos;s Name</p>
                      <p className="font-medium text-slate-800">{submittedApp.motherName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Date of Birth</p>
                      <p className="font-mono tabular-nums text-slate-800">{submittedApp.dob}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Gender</p>
                      <p className="text-slate-800">{submittedApp.gender}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Contact Phone</p>
                      <p className="font-mono text-slate-800">{submittedApp.contactPhone}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Attached Document</p>
                      <p className="text-slate-800 text-xs">
                        {submittedApp.documentFilename || 'None uploaded'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    <img
                      src={submittedApp.photoUrl}
                      alt={submittedApp.studentName}
                      referrerPolicy="no-referrer"
                      className="w-28 h-32 object-cover rounded-lg border border-slate-300"
                    />
                    <p className="text-[11px] text-slate-500 mt-1.5">Applicant Photo</p>
                  </div>
                </div>
              </div>

              <div className="no-print flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStatusResult(submittedApp);
                    setLookupMode('code');
                    setStAppCode(submittedApp.applicationCode);
                    setStDob(submittedApp.dob);
                    setTab('status');
                  }}
                  className="px-4 py-2 bg-[#0B3C75] text-white text-xs sm:text-sm font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer"
                >
                  Track This Application Now
                </button>
                <button
                  type="button"
                  onClick={() => setSubmittedApp(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs sm:text-sm font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Submit Another Application
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleApplySubmit} className="space-y-6">
              {/* Stepper Header */}
              <div className="border-b border-slate-200 pb-5 space-y-4">
                <div>
                  <h2 className="font-display text-xl font-semibold text-slate-900">
                    Online Admission Form ({effectiveConfig.academicSession})
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Complete all three steps. Only classes currently opened by the Nodal Officer are selectable.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {(
                    [
                      { num: 1, title: '1. Student & Class' },
                      { num: 2, title: '2. Family & Academics' },
                      { num: 3, title: '3. Photo, Docs & Submit' },
                    ] as const
                  ).map((st) => {
                    const isCurrent = applyStep === st.num;
                    const isDone = applyStep > st.num;
                    return (
                      <button
                        key={st.num}
                        type="button"
                        onClick={() => {
                          if (st.num < applyStep) {
                            setStepError(null);
                            setApplyStep(st.num);
                          }
                        }}
                        className={`p-2.5 sm:p-3 rounded-lg border text-left transition-colors ${
                          isCurrent
                            ? 'bg-[#0B3C75] text-white border-[#0B3C75]'
                            : isDone
                              ? 'bg-emerald-50 text-emerald-900 border-emerald-200 cursor-pointer'
                              : 'bg-slate-50 text-slate-500 border-slate-200 cursor-default'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 text-xs font-semibold">
                          <span className="truncate">{st.title}</span>
                          {isDone && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {stepError && (
                <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
                  {stepError}
                </div>
              )}

              {/* STEP 1: STUDENT IDENTITY & CLASS */}
              {applyStep === 1 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Student&apos;s Full Name (as per Birth Certificate) *
                    </label>
                    <input
                      type="text"
                      required
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      placeholder="e.g. Aarav Sharma"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Applying for Class *
                    </label>
                    <select
                      value={classApplied}
                      onChange={(e) => setClassApplied(e.target.value as ClassName)}
                      className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    >
                      {CLASSES.map((cls) => {
                        const isOpen = openClasses.includes(cls);
                        const seats = effectiveConfig.classSeats[cls] ?? 40;
                        return (
                          <option key={cls} value={cls} disabled={!isOpen}>
                            Class {cls} {isOpen ? `(${seats} seats)` : '[Closed by Nodal Officer]'}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {(classApplied === 'XI' || classApplied === 'XII') && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Academic Stream *
                      </label>
                      <select
                        value={streamApplied}
                        onChange={(e) => setStreamApplied(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                      >
                        {SENIOR_STREAMS.map((stream) => (
                          <option key={stream} value={stream}>
                            {stream}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Date of Birth *
                    </label>
                    <input
                      type="date"
                      required
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    />
                    {dob ? (
                      dobValidationLive ? (
                        <p className="text-[11px] text-red-700 mt-1 font-medium">
                          {dobValidationLive}
                        </p>
                      ) : (
                        <p className="text-[11px] text-emerald-700 mt-1 font-medium">
                          Eligible for Class {classApplied} admission criteria.
                        </p>
                      )
                    ) : (
                      <p className="text-[11px] text-slate-500 mt-1">
                        Class {classApplied}: {dobHint}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Gender *
                    </label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
              )}

              {/* STEP 2: FAMILY & PREVIOUS ACADEMIC HISTORY */}
              {applyStep === 2 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Father&apos;s Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={fatherName}
                      onChange={(e) => setFatherName(e.target.value)}
                      placeholder="e.g. Rajesh Sharma"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mother&apos;s Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={motherName}
                      onChange={(e) => setMotherName(e.target.value)}
                      placeholder="e.g. Sunita Sharma"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Parent Contact Mobile *
                    </label>
                    <input
                      type="tel"
                      required
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="e.g. 9876543210"
                      className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Parent Email Address
                    </label>
                    <input
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      placeholder="parent@example.com"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Previous School Name
                    </label>
                    <input
                      type="text"
                      value={previousSchool}
                      onChange={(e) => setPreviousSchool(e.target.value)}
                      placeholder="Last attended recognized school"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Previous %
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={previousPercentage}
                        onChange={(e) => setPreviousPercentage(e.target.value)}
                        placeholder="e.g. 88.5"
                        className="w-full px-3 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        TC Number
                      </label>
                      <input
                        type="text"
                        value={tcNumber}
                        onChange={(e) => setTcNumber(e.target.value)}
                        placeholder="Optional TC No."
                        className="w-full px-3 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Complete Residential Address *
                    </label>
                    <textarea
                      rows={2}
                      required
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="House No., Street, Locality, City, State, PIN"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                    />
                  </div>
                </div>
              )}

              {/* STEP 3: PHOTOGRAPH, DOCUMENTS & DECLARATION */}
              {applyStep === 3 && (
                <div className="space-y-6">
                  {/* Photograph Section */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-[#F4F6F9]/60 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          1. Student Passport Photograph *
                        </h3>
                        <p className="text-xs text-slate-500">
                          Upload a clear passport photo file (JPG/PNG) or capture via device camera.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="px-3.5 py-2 bg-[#0B3C75] text-white text-xs font-semibold rounded-lg hover:bg-[#144D8A] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Upload Photo File</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={handlePhotoUpload}
                            className="hidden"
                          />
                        </label>
                        {!cameraOpen && (
                          <button
                            type="button"
                            onClick={handleOpenCamera}
                            className="px-3.5 py-2 bg-white border border-slate-300 text-slate-800 text-xs font-semibold rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            Use Camera
                          </button>
                        )}
                      </div>
                    </div>

                    {cameraError && (
                      <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900">
                        {cameraError}
                      </div>
                    )}

                    {cameraOpen && (
                      <div className="bg-slate-900 rounded-xl p-4 space-y-3 max-w-md">
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full rounded-lg bg-black aspect-[4/3] object-cover"
                        />
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={handleCapturePhoto}
                            className="px-4 py-2 bg-white text-slate-900 text-xs font-semibold rounded-lg hover:bg-slate-100 cursor-pointer"
                          >
                            Capture Photo
                          </button>
                          <button
                            type="button"
                            onClick={stopCamera}
                            className="px-4 py-2 text-slate-300 text-xs font-medium hover:text-white cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    <canvas ref={canvasRef} className="hidden" />

                    {capturedPreview && !confirmedPhoto && (
                      <div className="border border-slate-200 rounded-xl p-4 space-y-3 max-w-sm bg-white">
                        <p className="text-xs font-semibold text-slate-700">Captured Preview</p>
                        <img
                          src={capturedPreview}
                          alt="Captured student preview"
                          className="w-36 h-40 object-cover rounded-lg border border-slate-300"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmedPhoto(capturedPreview);
                              setCapturedPreview(null);
                            }}
                            className="px-3.5 py-2 bg-[#0B3C75] text-white text-xs font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer"
                          >
                            Confirm This Photo
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCapturedPreview(null);
                              handleOpenCamera();
                            }}
                            className="px-3.5 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 cursor-pointer"
                          >
                            Retake
                          </button>
                        </div>
                      </div>
                    )}

                    {confirmedPhoto && (
                      <div className="flex items-center gap-4 p-3.5 border border-emerald-200 bg-emerald-50 rounded-lg max-w-md">
                        <img
                          src={confirmedPhoto}
                          alt="Confirmed student photograph"
                          className="w-16 h-20 object-cover rounded border border-slate-300 bg-white"
                        />
                        <div className="text-xs space-y-1">
                          <p className="font-semibold text-emerald-900">Photograph Attached</p>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmedPhoto(null);
                              setCapturedPreview(null);
                            }}
                            className="text-[#0B3C75] font-semibold hover:underline cursor-pointer"
                          >
                            Remove / Replace Photo
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Supporting Document Upload */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-[#F4F6F9]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        2. Supporting Document (Optional — Birth Certificate / Marksheet / TC)
                      </h3>
                      <p className="text-xs text-slate-500">
                        PDF or Image up to 5.5 MB. Helps the Nodal Officer verify eligibility faster.
                      </p>
                      {docFilename && (
                        <p className="text-xs font-semibold text-emerald-800 mt-1.5">
                          Attached: {docFilename}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <label className="px-3.5 py-2 bg-white border border-slate-300 text-slate-800 text-xs font-semibold rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                        <Upload className="w-3.5 h-3.5" />
                        <span>{docFilename ? 'Replace File' : 'Attach Document'}</span>
                        <input
                          type="file"
                          accept="application/pdf,image/png,image/jpeg,image/webp"
                          onChange={handleSupportingDocUpload}
                          className="hidden"
                        />
                      </label>
                      {docFilename && (
                        <button
                          type="button"
                          onClick={() => {
                            setDocBase64(null);
                            setDocFilename(null);
                          }}
                          className="px-3 py-2 text-xs text-red-700 font-semibold hover:underline cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Review Summary */}
                  <div className="p-5 rounded-xl border border-slate-200 bg-white space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      3. Review Application Summary
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div>
                        <p className="text-slate-500">Applicant</p>
                        <p className="font-semibold text-slate-900">{studentName}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Class / Stream</p>
                        <p className="font-semibold text-slate-900">
                          Class {classApplied}
                          {classApplied === 'XI' || classApplied === 'XII' ? ` (${streamApplied})` : ''}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">DOB / Gender</p>
                        <p className="font-mono text-slate-800">
                          {dob} · {gender}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Parents &amp; Phone</p>
                        <p className="text-slate-800">
                          {fatherName} · {contactPhone}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Declaration */}
                  <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={declarationChecked}
                      onChange={(e) => setDeclarationChecked(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#0B3C75] focus:ring-[#0B3C75]"
                    />
                    <span>
                      I declare that all particulars furnished above are true and accurate. Admission
                      remains subject to Nodal Officer verification and original document inspection.
                    </span>
                  </label>
                </div>
              )}

              {/* Wizard Footer Actions */}
              <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                {applyStep > 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStepError(null);
                      setApplyStep((prev) => (prev === 3 ? 2 : 1));
                    }}
                    className="px-4 py-2.5 border border-slate-300 text-slate-700 text-xs sm:text-sm font-semibold rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Previous Step
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">Step 1 of 3</span>
                )}

                {applyStep < 3 ? (
                  <button
                    type="button"
                    onClick={goToNextStep}
                    className="px-5 py-2.5 bg-[#0B3C75] text-white text-xs sm:text-sm font-semibold rounded-lg hover:bg-[#144D8A] inline-flex items-center gap-2 cursor-pointer"
                  >
                    Continue to Step {applyStep + 1}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2.5 bg-emerald-700 text-white text-xs sm:text-sm font-semibold rounded-lg hover:bg-emerald-800 disabled:opacity-60 inline-flex items-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {submitting ? 'Submitting Application...' : 'Submit Final Application'}
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      )}

      {/* TAB 3: TRACK STATUS, CORRECTIONS & PROVISIONAL ALLOTMENT SLIP */}
      {tab === 'status' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900">
                Track Application Status &amp; Seat Allotment
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Look up using your Application ID + DOB, or search by Student &amp; Parent details.
              </p>
            </div>

            <div className="inline-flex p-1 bg-[#E4ECF5] rounded-lg gap-1 self-start">
              <button
                type="button"
                onClick={() => {
                  setLookupMode('code');
                  setStatusError(null);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
                  lookupMode === 'code' ? 'bg-[#0B3C75] text-white' : 'text-[#0B3C75]'
                }`}
              >
                By Application ID
              </button>
              <button
                type="button"
                onClick={() => {
                  setLookupMode('details');
                  setStatusError(null);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer whitespace-nowrap ${
                  lookupMode === 'details' ? 'bg-[#0B3C75] text-white' : 'text-[#0B3C75]'
                }`}
              >
                Forgot Application ID
              </button>
            </div>
          </div>

          <form onSubmit={handleCheckStatusSubmit} className="no-print space-y-4">
            {lookupMode === 'code' ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Application ID *
                  </label>
                  <input
                    type="text"
                    required
                    value={stAppCode}
                    onChange={(e) => setStAppCode(e.target.value)}
                    placeholder="e.g. ADM-2026-000123"
                    className="w-full px-3.5 py-2.5 text-sm font-mono uppercase border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Date of Birth *
                  </label>
                  <input
                    type="date"
                    required
                    value={stDob}
                    onChange={(e) => setStDob(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={statusLoading}
                  className="px-4 py-2.5 bg-[#0B3C75] text-white text-sm font-semibold rounded-lg hover:bg-[#144D8A] inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Search className="w-4 h-4" />
                  {statusLoading ? 'Searching...' : 'Track Status'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Student&apos;s Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={stName}
                    onChange={(e) => setStName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Father&apos;s Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={stFather}
                    onChange={(e) => setStFather(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mother&apos;s Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={stMother}
                    onChange={(e) => setStMother(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Date of Birth *
                  </label>
                  <input
                    type="date"
                    required
                    value={stDob}
                    onChange={(e) => setStDob(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Class Applied For *
                  </label>
                  <select
                    value={stClass}
                    onChange={(e) => setStClass(e.target.value as ClassName)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  >
                    {CLASSES.map((cls) => (
                      <option key={cls} value={cls}>
                        Class {cls}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={statusLoading}
                  className="px-4 py-2 bg-[#0B3C75] text-white text-sm font-semibold rounded-lg hover:bg-[#144D8A] inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Search className="w-4 h-4" />
                  {statusLoading ? 'Checking...' : 'Find Application'}
                </button>
              </div>
            )}
          </form>

          {statusError && (
            <div className="no-print p-3.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
              {statusError}
            </div>
          )}

          {corrMsg && (
            <div className="no-print p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
              {corrMsg}
            </div>
          )}

          {statusResult && (
            <div className="print-sheet border border-slate-200 rounded-xl p-6 space-y-6 bg-slate-50/40">
              {/* Top Dossier Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div className="flex items-center gap-3">
                  <img
                    src={crestEmblemImg}
                    alt="School Crest"
                    className="w-11 h-11 object-contain shrink-0"
                  />
                  <div>
                    <p className="text-xs font-mono text-slate-500">
                      Application ID: {statusResult.applicationCode}
                    </p>
                    <h3 className="font-display text-xl font-semibold text-slate-900">
                      {statusResult.studentName}
                    </h3>
                  </div>
                </div>

                <div className="no-print flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRefreshTracked}
                    disabled={statusLoading}
                    className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${statusLoading ? 'animate-spin' : ''}`} />
                    Refresh Status
                  </button>
                  {statusResult.status === 'Approved' && (
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="px-3.5 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print Allotment Slip
                    </button>
                  )}
                </div>
              </div>

              {/* 4-Stage Visual Tracker */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {[
                  {
                    title: '1. Submitted',
                    done: true,
                    sub: new Date(statusResult.createdAt).toLocaleDateString('en-IN'),
                  },
                  {
                    title: '2. Officer Viewed',
                    done: statusResult.viewedByOfficer,
                    sub: statusResult.viewedByOfficer ? 'Dossier Reviewed' : 'Awaiting Review',
                  },
                  {
                    title: '3. Nodal Decision',
                    done: statusResult.status !== 'Pending',
                    sub: statusResult.status,
                  },
                  {
                    title: '4. Allotment',
                    done: statusResult.status === 'Approved' && Boolean(statusResult.rollNumber),
                    sub:
                      statusResult.status === 'Approved'
                        ? `Roll: ${statusResult.rollNumber || 'Assigned'}`
                        : 'Pending Approval',
                  },
                ].map((stage) => (
                  <div
                    key={stage.title}
                    className={`p-3 rounded-lg border ${
                      stage.done
                        ? 'bg-white border-[#0B3C75]/30 text-slate-900'
                        : 'bg-slate-100/70 border-slate-200 text-slate-500'
                    }`}
                  >
                    <p className="font-semibold">{stage.title}</p>
                    <p className="text-[11px] mt-0.5 font-mono truncate">{stage.sub}</p>
                  </div>
                ))}
              </div>

              {/* Outcome Banner */}
              {statusResult.status === 'Approved' && statusResult.rollNumber && (
                <div className="p-5 rounded-xl border-2 border-emerald-600/30 bg-emerald-50 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                        Provisional Admission Allotment Confirmed
                      </p>
                      <p className="text-lg font-display font-semibold text-emerald-950 mt-0.5">
                        Class {statusResult.classApplied}
                        {statusResult.allottedSection ? ` · Section ${statusResult.allottedSection}` : ''}
                        {statusResult.streamApplied ? ` · ${statusResult.streamApplied}` : ''}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] text-emerald-800">Allotted Roll Number</p>
                      <p className="font-mono text-xl font-bold text-emerald-950 tabular-nums">
                        {statusResult.rollNumber}
                      </p>
                    </div>
                  </div>
                  {statusResult.enrolledStudentId && (
                    <p className="text-xs text-emerald-900 border-t border-emerald-200 pt-2">
                      Student Portal Login ID Assigned:{' '}
                      <strong className="font-mono">{statusResult.enrolledStudentId}</strong> (Use in Student Dashboard with Class {statusResult.classApplied} &amp; Section {statusResult.allottedSection || 'A'})
                    </p>
                  )}
                  {statusResult.officerNotes && (
                    <p className="text-xs text-emerald-900">
                      <strong>Nodal Officer Remarks:</strong> {statusResult.officerNotes}
                    </p>
                  )}
                </div>
              )}

              {statusResult.status === 'Waitlisted' && (
                <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-950 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                    Application Placed on Waitlist by Nodal Officer
                  </p>
                  <p className="text-xs text-amber-900">
                    Your application is active in the waiting queue and will be reconsidered as seats open.
                  </p>
                  {statusResult.officerNotes && (
                    <p className="text-xs text-amber-900 pt-1">
                      <strong>Officer Remarks:</strong> {statusResult.officerNotes}
                    </p>
                  )}
                </div>
              )}

              {statusResult.status === 'Correction Needed' && (
                <div className="p-5 rounded-xl border border-amber-300 bg-amber-50 space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-amber-950 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-700" />
                      Action Required: Nodal Officer Requested Corrections
                    </p>
                    <p className="text-xs text-amber-900 mt-1">
                      <strong>Remarks:</strong>{' '}
                      {statusResult.officerNotes ||
                        'Please verify and update your submitted details or supporting document below.'}
                    </p>
                  </div>

                  <form
                    onSubmit={handleCorrectionResubmit}
                    className="no-print bg-white border border-amber-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-3"
                  >
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Student&apos;s Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={corrStudentName}
                        onChange={(e) => setCorrStudentName(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Father&apos;s Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={corrFatherName}
                        onChange={(e) => setCorrFatherName(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Mother&apos;s Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={corrMotherName}
                        onChange={(e) => setCorrMotherName(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Contact Phone *
                      </label>
                      <input
                        type="tel"
                        required
                        value={corrPhone}
                        onChange={(e) => setCorrPhone(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Previous School
                      </label>
                      <input
                        type="text"
                        value={corrPrevSchool}
                        onChange={(e) => setCorrPrevSchool(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Prev. %
                        </label>
                        <input
                          type="text"
                          value={corrPrevPct}
                          onChange={(e) => setCorrPrevPct(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          TC Number
                        </label>
                        <input
                          type="text"
                          value={corrTcNumber}
                          onChange={(e) => setCorrTcNumber(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Address *
                      </label>
                      <input
                        type="text"
                        required
                        value={corrAddress}
                        onChange={(e) => setCorrAddress(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="sm:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                      <label className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                        <Upload className="w-3.5 h-3.5" />
                        <span>{corrDocName ? `New Doc: ${corrDocName}` : 'Upload Updated Document (Optional)'}</span>
                        <input
                          type="file"
                          accept="application/pdf,image/png,image/jpeg,image/webp"
                          onChange={async (ev) => {
                            const f = ev.target.files?.[0];
                            if (!f) return;
                            const b64 = await readFileAsBase64(f);
                            setCorrDocBase64(b64);
                            setCorrDocName(f.name);
                          }}
                          className="hidden"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={corrSaving}
                        className="px-4 py-2 bg-[#0B3C75] text-white text-xs font-semibold rounded-lg hover:bg-[#144D8A] cursor-pointer disabled:opacity-60"
                      >
                        {corrSaving ? 'Resubmitting...' : 'Resubmit Corrections to Nodal Officer'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {statusResult.status === 'Denied' && (
                <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-900 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <XCircle className="w-4 h-4" />
                    Application Not Approved — No Roll Number Assigned
                  </p>
                  {statusResult.denialReason && (
                    <p className="text-xs text-red-800">Reason: {statusResult.denialReason}</p>
                  )}
                </div>
              )}

              {/* Full Submitted Profile Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-2">
                <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Father&apos;s Name</p>
                    <p className="font-medium text-slate-900">{statusResult.fatherName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Mother&apos;s Name</p>
                    <p className="font-medium text-slate-900">{statusResult.motherName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Date of Birth</p>
                    <p className="font-mono tabular-nums text-slate-900">{statusResult.dob}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Class &amp; Stream</p>
                    <p className="font-semibold text-slate-900">
                      Class {statusResult.classApplied}
                      {statusResult.streamApplied ? ` · ${statusResult.streamApplied}` : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Gender</p>
                    <p className="text-slate-800">{statusResult.gender}</p>
                  </div>
                  {statusResult.entranceMarks !== null &&
                    statusResult.entranceMarks !== undefined && (
                      <div>
                        <p className="text-xs text-slate-500">Nodal Evaluation Marks</p>
                        <p className="font-mono font-semibold text-[#0B3C75]">
                          {statusResult.entranceMarks} / 100
                        </p>
                      </div>
                    )}
                  <div>
                    <p className="text-xs text-slate-500">Contact Phone</p>
                    <p className="font-mono text-slate-800">{statusResult.contactPhone}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Previous School</p>
                    <p className="text-slate-800">{statusResult.previousSchool || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">TC / Document</p>
                    <p className="text-slate-800 text-xs">
                      {statusResult.tcNumber ? `TC: ${statusResult.tcNumber}` : 'No TC'} ·{' '}
                      {statusResult.documentFilename || 'No doc'}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-slate-500">Residential Address</p>
                    <p className="text-slate-800">{statusResult.address}</p>
                  </div>
                </div>

                <div className="flex flex-col items-center">
                  <img
                    src={statusResult.photoUrl}
                    alt={statusResult.studentName}
                    referrerPolicy="no-referrer"
                    className="w-32 h-36 object-cover rounded-lg border border-slate-300 bg-white"
                  />
                  <span className="text-[11px] text-slate-500 mt-1.5">Submitted Photograph</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: PUBLISHED MERIT LIST */}
      {tab === 'merit' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900">
                Selected Candidates Merit &amp; Allotment List ({meritSession})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Published publicly only when authorized by the Nodal Officer Control Registry.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadMeritList()}
              disabled={meritLoading}
              className="px-3.5 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer self-start"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${meritLoading ? 'animate-spin' : ''}`} />
              Refresh List
            </button>
          </div>

          {meritLoading ? (
            <div className="py-10 text-center text-sm text-slate-500">Loading merit list...</div>
          ) : !meritPublished ? (
            <div className="py-12 text-center max-w-md mx-auto space-y-2.5">
              <div className="w-11 h-11 rounded-lg bg-[#EEF3F9] text-[#0B3C75] flex items-center justify-center mx-auto">
                <UserCheck className="w-5 h-5" />
              </div>
              <p className="font-display text-lg font-semibold text-slate-900">
                Public Merit List Not Yet Published
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                The Nodal Officer has not published the consolidated merit list yet. Approved
                applicants can still check their individual roll allotment under{' '}
                <strong>Track Status &amp; Allotment</strong>.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <select
                    value={meritClassFilter}
                    onChange={(e) => setMeritClassFilter(e.target.value)}
                    className="px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  >
                    <option value="ALL">All Classes ({meritEntries.length})</option>
                    {CLASSES.map((c) => (
                      <option key={c} value={c}>
                        Class {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={meritSearch}
                    onChange={(e) => setMeritSearch(e.target.value)}
                    placeholder="Search name, ID or roll..."
                    className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B3C75]"
                  />
                </div>
              </div>

              {filteredMerit.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500 border border-slate-200 rounded-lg">
                  No allotted candidates match this filter.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-[#EEF3F9] border-b border-slate-200 text-xs font-semibold text-[#0B3C75]">
                        <th className="py-3 px-4">Merit Rank</th>
                        <th className="py-3 px-4">Application ID</th>
                        <th className="py-3 px-4">Candidate Name</th>
                        <th className="py-3 px-4">Class &amp; Stream</th>
                        <th className="py-3 px-4 text-right">Evaluation Marks</th>
                        <th className="py-3 px-4">Selection Status</th>
                        <th className="py-3 px-4">Roll / Section</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 tabular-nums">
                      {filteredMerit.map((m) => (
                        <tr key={m.applicationCode} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-mono font-bold text-[#0B3C75]">
                            #{m.rank}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-700">
                            {m.applicationCode}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            {m.studentName}
                          </td>
                          <td className="py-3 px-4 text-xs sm:text-sm text-slate-700">
                            Class {m.classApplied}
                            {m.streamApplied ? ` · ${m.streamApplied}` : ''}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900">
                            {m.entranceMarks !== null && m.entranceMarks !== undefined
                              ? `${m.entranceMarks} / 100`
                              : 'Pending'}
                          </td>
                          <td className="py-3 px-4 text-xs font-semibold">
                            {m.status === 'Approved' ? (
                              <span className="text-emerald-700">Approved &amp; Allotted</span>
                            ) : m.withinQuota ? (
                              <span className="text-[#0B3C75]">
                                Merit Selected (#{m.rank} / {m.seatQuota} seats)
                              </span>
                            ) : (
                              <span className="text-amber-700">Merit Waitlist</span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-emerald-800">
                            {m.rollNumber
                              ? `${m.rollNumber} (Sec ${m.allottedSection || 'A'})`
                              : '—'}
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
      )}
    </div>
  );
}
