import { useState } from 'react';
import { Lock, RefreshCw, ShieldCheck, UserCheck, Users } from 'lucide-react';
import { apiFetch, setAuthToken } from '../lib/api.ts';
import type { AdmissionConfig, AuthUser, UserRole } from '../shared/schoolRules.ts';
import { AdminControlView } from './AdminControlView.tsx';
import { NodalOfficerView } from './NodalOfficerView.tsx';
import { StaffDashboardView } from './StaffDashboardView.tsx';

interface PortalViewProps {
  currentUser: AuthUser | null;
  academicSession: string;
  onAuthChange: (user: AuthUser | null) => void;
  onAdmissionStatusChanged: (enabled: boolean, config?: AdmissionConfig) => void;
  onSessionUpdated: (session: string) => void;
}

const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateSecurityCode(len = 5): string {
  let code = '';
  for (let i = 0; i < len; i += 1) {
    code += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
  }
  return code;
}

export function PortalView({
  currentUser,
  academicSession,
  onAuthChange,
  onAdmissionStatusChanged,
  onSessionUpdated,
}: PortalViewProps) {
  const [selectedRole, setSelectedRole] = useState<UserRole>('staff');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [securityCode, setSecurityCode] = useState(() => generateSecurityCode());
  const [captchaInput, setCaptchaInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rotateSecurityCode = () => {
    setSecurityCode(generateSecurityCode());
    setCaptchaInput('');
  };

  const handleLogout = () => {
    setAuthToken(null);
    onAuthChange(null);
    setUserId('');
    setPassword('');
    rotateSecurityCode();
    setError(null);
  };

  if (currentUser) {
    if (currentUser.role === 'admin') {
      return (
        <AdminControlView
          user={currentUser}
          academicSession={academicSession}
          onSessionUpdated={onSessionUpdated}
          onLogout={handleLogout}
        />
      );
    }
    if (currentUser.role === 'nodal_officer') {
      return (
        <NodalOfficerView
          user={currentUser}
          onLogout={handleLogout}
          onAdmissionStatusChanged={onAdmissionStatusChanged}
        />
      );
    }
    return (
      <StaffDashboardView
        user={currentUser}
        academicSession={academicSession}
        onLogout={handleLogout}
      />
    );
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const enteredCode = captchaInput.trim().toUpperCase();
    if (!enteredCode) {
      setError('Please enter the Visual Security Code shown below.');
      return;
    }
    if (enteredCode !== securityCode) {
      setError('Invalid Visual Security Code. Please enter the new code carefully.');
      rotateSecurityCode();
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          userId: userId.trim(),
          password,
          expectedRole: selectedRole,
        }),
      });
      setAuthToken(res.token);
      onAuthChange(res.user);
    } catch (err) {
      setError((err as Error).message);
      rotateSecurityCode();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden shadow-xs">
        {/* Institutional MIS Header */}
        <div className="bg-[#082D59] px-6 sm:px-8 py-5 text-white border-b-2 border-[#D97706] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              Employee &amp; School MIS Authentication · Session {academicSession}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white mt-0.5">
              Staff, Administrator &amp; Nodal Officer Portal
            </h1>
          </div>
          <span className="text-xs font-mono text-blue-100 whitespace-nowrap">
            MoE School MIS Module
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Left MIS Instructions Sidebar (Delhi School MIS Pattern) */}
          <aside className="lg:col-span-5 bg-[#F8FAFC] border-b lg:border-b-0 lg:border-r border-slate-200 p-6 sm:p-8 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-lg font-bold text-[#082D59]">
                  MIS Login Guidelines
                </h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Select your authorized institutional module on the right and sign in using your
                  assigned credentials and visual verification code.
                </p>
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-3 text-xs">
                <div>
                  <p className="font-semibold text-[#082D59]">1. Teacher / Staff MIS Login</p>
                  <p className="text-slate-600 mt-0.5 leading-relaxed">
                    Teachers may sign in using either their official <strong>Employee ID</strong>{' '}
                    or <strong>User ID</strong> to register students, mark daily attendance, enter
                    examination marks, and upload class question papers.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-[#082D59]">
                    2. Administrator / Head of School (HoS)
                  </p>
                  <p className="text-slate-600 mt-0.5 leading-relaxed">
                    Manage active academic session, circulars, class marking schemes, result
                    publication, and teacher / nodal officer accounts.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-[#8B1E24]">3. Nodal Officer Registry</p>
                  <p className="text-slate-600 mt-0.5 leading-relaxed">
                    Regulate admission openings, review applicant dossiers, assign evaluation marks,
                    and publish the admission merit list.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded border border-slate-200 bg-white text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-[#082D59]">Credential &amp; Password Assistance</p>
              <p className="leading-relaxed">
                Teachers who forget their password or need class/subject reassignment must contact
                the School Administrator / Head of School with their Employee ID.
              </p>
            </div>
          </aside>

          {/* Right MIS Login Form */}
          <div className="lg:col-span-7 p-6 sm:p-8 space-y-6">
            {/* Module Role Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedRole('staff');
                  setError(null);
                }}
                className={`p-3.5 rounded-md border text-left transition-colors cursor-pointer ${
                  selectedRole === 'staff'
                    ? 'bg-[#082D59] text-white border-[#082D59]'
                    : 'bg-[#F4F6F9] text-slate-900 border-slate-200 hover:border-[#082D59]/50'
                }`}
              >
                <Users className="w-4 h-4 mb-1.5" />
                <p className="text-sm font-semibold">Teacher / Staff</p>
                <p
                  className={`text-[11px] mt-0.5 ${
                    selectedRole === 'staff' ? 'text-blue-100' : 'text-slate-500'
                  }`}
                >
                  Employee ID / User ID
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedRole('admin');
                  setError(null);
                }}
                className={`p-3.5 rounded-md border text-left transition-colors cursor-pointer ${
                  selectedRole === 'admin'
                    ? 'bg-[#082D59] text-white border-[#082D59]'
                    : 'bg-[#F4F6F9] text-slate-900 border-slate-200 hover:border-[#082D59]/50'
                }`}
              >
                <ShieldCheck className="w-4 h-4 mb-1.5" />
                <p className="text-sm font-semibold">Administrator</p>
                <p
                  className={`text-[11px] mt-0.5 ${
                    selectedRole === 'admin' ? 'text-blue-100' : 'text-slate-500'
                  }`}
                >
                  School &amp; Results Control
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedRole('nodal_officer');
                  setError(null);
                }}
                className={`p-3.5 rounded-md border text-left transition-colors cursor-pointer ${
                  selectedRole === 'nodal_officer'
                    ? 'bg-[#8B1E24] text-white border-[#8B1E24]'
                    : 'bg-[#F4F6F9] text-slate-900 border-slate-200 hover:border-[#8B1E24]/50'
                }`}
              >
                <UserCheck className="w-4 h-4 mb-1.5" />
                <p className="text-sm font-semibold">Nodal Officer</p>
                <p
                  className={`text-[11px] mt-0.5 ${
                    selectedRole === 'nodal_officer' ? 'text-amber-100' : 'text-slate-500'
                  }`}
                >
                  Admission Control
                </p>
              </button>
            </div>

            {error && (
              <div className="p-3.5 rounded border border-red-200 bg-red-50 text-sm text-red-800">
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {selectedRole === 'staff' ? 'Employee ID / User ID *' : 'User ID *'}{' '}
                  <span className="font-normal text-slate-500">(Case-insensitive)</span>
                </label>
                <input
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder={
                    selectedRole === 'staff'
                      ? 'Enter Employee ID or User ID'
                      : 'Enter your User ID'
                  }
                  className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password *</label>
                <input
                  type="password"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your Password"
                  className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                />
              </div>

              {/* Visual Security Code (DoE Delhi Edudel MIS Pattern) */}
              <div className="pt-1">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Visual Security Code Verification *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-stretch">
                  <div className="sm:col-span-5 flex items-center justify-between gap-2 px-3 py-2 bg-[#EEF3F9] border border-slate-300 rounded select-none">
                    <span
                      aria-label={`Security Code: ${securityCode.split('').join(' ')}`}
                      className="font-mono text-lg font-bold tracking-[0.28em] text-[#082D59] italic line-through decoration-[#8B1E24]/30"
                    >
                      {securityCode}
                    </span>
                    <button
                      type="button"
                      onClick={rotateSecurityCode}
                      title="Refresh Visual Security Code"
                      aria-label="Refresh Visual Security Code"
                      className="p-1.5 text-[#082D59] hover:bg-white rounded border border-slate-300/80 transition-colors cursor-pointer shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="sm:col-span-7">
                    <input
                      type="text"
                      required
                      maxLength={8}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      value={captchaInput}
                      onChange={(e) => setCaptchaInput(e.target.value.toUpperCase())}
                      placeholder="Enter Visual Code shown on left"
                      className="w-full h-full px-3.5 py-2.5 text-sm font-mono uppercase tracking-wider border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[#082D59]"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full px-5 py-2.5 bg-[#082D59] text-white text-sm font-semibold rounded hover:bg-[#0B3C75] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <Lock className="w-4 h-4" />
                {loading
                  ? 'Authenticating...'
                  : `Sign In as ${
                      selectedRole === 'admin'
                        ? 'Administrator'
                        : selectedRole === 'nodal_officer'
                          ? 'Nodal Officer'
                          : 'Teacher / Staff'
                    }`}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
