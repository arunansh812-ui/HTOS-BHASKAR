import { useCallback, useEffect, useState } from 'react';
import { AcademicsView } from './components/AcademicsView.tsx';
import { AdmissionsView } from './components/AdmissionsView.tsx';
import { CircularsView, HomeView } from './components/HomeAndCirculars.tsx';
import { PortalView } from './components/PortalView.tsx';
import { StudentDashboardView } from './components/StudentDashboardView.tsx';
import { type ActivePage, TopNav } from './components/TopNav.tsx';
import { apiFetch, getAuthToken, setAuthToken, useAutoRefresh } from './lib/api.ts';
import type { AdmissionConfig, AuthUser } from './shared/schoolRules.ts';

const VALID_PAGES: readonly ActivePage[] = ['home', 'circulars', 'academics', 'student-dashboard', 'admissions', 'portal'];

function getInitialPage(): ActivePage {
  if (typeof window === 'undefined') return 'home';
  const param = new URLSearchParams(window.location.search).get('page') as ActivePage | null;
  return param && VALID_PAGES.includes(param) ? param : 'home';
}

export default function App() {
  const [activePage, setActivePage] = useState<ActivePage>(getInitialPage);
  const [admissionsEnabled, setAdmissionsEnabled] = useState(false);
  const [admissionConfig, setAdmissionConfig] = useState<AdmissionConfig | null>(null);
  const [academicSession, setAcademicSession] = useState('2026–2027');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const syncGlobalState = useCallback(async (isInitial = false) => {
    apiFetch<{
      admissionsEnabled: boolean;
      academicSession?: string;
      admissionConfig?: AdmissionConfig;
    }>('/api/public/status')
      .then((res) => {
        setAdmissionsEnabled(res.admissionsEnabled);
        if (res.academicSession) {
          setAcademicSession(res.academicSession);
        }
        if (res.admissionConfig) {
          setAdmissionConfig(res.admissionConfig);
          if (res.admissionConfig.academicSession) {
            setAcademicSession(res.admissionConfig.academicSession);
          }
        }
      })
      .catch(() => {
        if (isInitial) setAdmissionsEnabled(false);
      });

    if (getAuthToken()) {
      apiFetch<{ user: AuthUser }>('/api/auth/me')
        .then((res) => setCurrentUser(res.user))
        .catch((err: Error) => {
          const msg = err.message.toLowerCase();
          if (
            isInitial ||
            msg.includes('invalid') ||
            msg.includes('expired') ||
            msg.includes('authentication') ||
            msg.includes('unauthorized')
          ) {
            setAuthToken(null);
            setCurrentUser(null);
          }
        });
    }
  }, []);

  useEffect(() => {
    const canonicalUrl = window.location.origin + window.location.pathname;
    let canonicalLink = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.rel = 'canonical';
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.href = canonicalUrl;

    let ogUrlMeta = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (!ogUrlMeta) {
      ogUrlMeta = document.createElement('meta');
      ogUrlMeta.setAttribute('property', 'og:url');
      document.head.appendChild(ogUrlMeta);
    }
    ogUrlMeta.content = canonicalUrl;

    const absOgImage = window.location.origin + '/og-campus.jpg';
    const ogImg = document.querySelector<HTMLMetaElement>('meta[property="og:image"]');
    if (ogImg) ogImg.content = absOgImage;
    const twImg = document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]');
    if (twImg) twImg.content = absOgImage;

    void syncGlobalState(true);
  }, [syncGlobalState]);

  useAutoRefresh(() => syncGlobalState(false), true, 15000);

  const handleNavigate = (page: ActivePage) => {
    setActivePage(page);
    const url = new URL(window.location.href);
    if (page === 'home') url.searchParams.delete('page');
    else url.searchParams.set('page', page);
    window.history.replaceState({}, '', url.toString());
    void syncGlobalState(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAdmissionStatusChanged = useCallback(
    (enabled: boolean, config?: AdmissionConfig) => {
      setAdmissionsEnabled(enabled);
      if (config) {
        setAdmissionConfig(config);
      }
      void syncGlobalState(false);
    },
    [syncGlobalState]
  );

  const handleSessionUpdated = useCallback(
    (nextSession: string) => {
      setAcademicSession(nextSession);
      setAdmissionConfig((prev) => (prev ? { ...prev, academicSession: nextSession } : prev));
      void syncGlobalState(false);
    },
    [syncGlobalState]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F6F9] text-slate-900">
      <TopNav
        activePage={activePage}
        onNavigate={handleNavigate}
        currentUser={currentUser}
      />

      <main className="flex-1">
        {activePage === 'home' && (
          <HomeView
            onNavigate={handleNavigate}
            admissionsEnabled={admissionsEnabled}
            admissionConfig={admissionConfig}
            academicSession={academicSession}
          />
        )}
        {activePage === 'circulars' && <CircularsView />}
        {activePage === 'academics' && <AcademicsView />}
        {activePage === 'admissions' && (
          <AdmissionsView
            admissionsEnabled={admissionsEnabled}
            admissionConfig={admissionConfig}
          />
        )}
        {activePage === 'student-dashboard' && (
          <StudentDashboardView academicSession={academicSession} />
        )}
        {activePage === 'portal' && (
          <PortalView
            currentUser={currentUser}
            academicSession={academicSession}
            onAuthChange={setCurrentUser}
            onAdmissionStatusChanged={handleAdmissionStatusChanged}
            onSessionUpdated={handleSessionUpdated}
          />
        )}
      </main>

      <footer className="no-print border-t-4 border-[#D97706] bg-[#062142] text-blue-100 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 text-xs">
          <div className="space-y-2.5">
            <p className="font-display text-base font-bold text-white">
              Moreden of Education International School
            </p>
            <p className="text-blue-200/80 leading-relaxed">
              Official school web portal serving Classes IV to XII. Committed to equitable,
              transparent academic governance and student services.
            </p>
            <p className="font-mono text-amber-300 tabular-nums">
              Academic Session: {academicSession}
            </p>
          </div>

          <div className="space-y-2.5">
            <p className="font-semibold text-white uppercase tracking-wider text-[11px]">
              Public Portals
            </p>
            <ul className="space-y-1.5">
              <li>
                <button type="button" onClick={() => handleNavigate('home')} className="hover:text-white cursor-pointer">
                  Institutional Home
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNavigate('circulars')} className="hover:text-white cursor-pointer">
                  Circulars &amp; Notifications
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNavigate('academics')} className="hover:text-white cursor-pointer">
                  Academics &amp; Question Papers
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNavigate('student-dashboard')} className="hover:text-white cursor-pointer">
                  Examination Results &amp; Attendance
                </button>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5">
            <p className="font-semibold text-white uppercase tracking-wider text-[11px]">
              Admissions &amp; Governance
            </p>
            <ul className="space-y-1.5">
              <li>
                <button type="button" onClick={() => handleNavigate('admissions')} className="hover:text-white cursor-pointer">
                  Online Admission Form
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNavigate('admissions')} className="hover:text-white cursor-pointer">
                  Track Status &amp; Merit List
                </button>
              </li>
              <li>
                <button type="button" onClick={() => handleNavigate('portal')} className="hover:text-white cursor-pointer">
                  Staff, Admin &amp; Nodal Officer Login
                </button>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5">
            <p className="font-semibold text-white uppercase tracking-wider text-[11px]">
              Official Contact Desks
            </p>
            <div className="space-y-1.5 text-blue-200/90">
              <p>Examination Cell: <span className="font-mono text-white">exams@moreden.edu</span></p>
              <p>Nodal Admissions: <span className="font-mono text-white">admissions@moreden.edu</span></p>
              <p>Principal&apos;s Office: <span className="font-mono text-white">office@moreden.edu</span></p>
              <p className="text-blue-200/70 pt-1">Mon – Sat · 08:00 AM – 02:30 PM</p>
            </div>
          </div>
        </div>

        <div className="bg-[#041831] border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-blue-200/80">
            <p>
              © {new Date().getFullYear()} Moreden of Education International School · Grades IV to XII
            </p>
            <p>Official MoE Institutional Portal</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
