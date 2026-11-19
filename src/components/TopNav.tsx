import type { AuthUser } from '../shared/schoolRules.ts';
import { crestEmblemImg } from '../assets/schoolImages.ts';

export type ActivePage =
  | 'home'
  | 'circulars'
  | 'academics'
  | 'admissions'
  | 'student-dashboard'
  | 'portal';

interface TopNavProps {
  activePage: ActivePage;
  onNavigate: (page: ActivePage) => void;
  currentUser: AuthUser | null;
}

export function TopNav({ activePage, onNavigate, currentUser }: TopNavProps) {
  const navItems: Array<{ id: ActivePage; label: string }> = [
    { id: 'home', label: 'Home' },
    { id: 'circulars', label: 'Circulars' },
    { id: 'academics', label: 'Academics' },
    { id: 'admissions', label: 'Admissions' },
    { id: 'student-dashboard', label: 'Student Dashboard' },
  ];

  const portalLabel = currentUser
    ? currentUser.role === 'admin'
      ? 'Admin Control'
      : currentUser.role === 'nodal_officer'
        ? 'Nodal Control'
        : 'Staff Dashboard'
    : 'Staff & Admin Portal';

  return (
    <header className="no-print sticky top-0 z-40 bg-[#082D59] text-white border-b border-[#0B3C75] shadow-xs">
      <div className="h-1 w-full bg-gradient-to-r from-[#D97706] via-[#FFFFFF]/80 to-[#0F6B48]" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="inline-flex items-center gap-3 font-display text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          <img
            src={crestEmblemImg}
            alt="Moreden of Education International School Crest"
            referrerPolicy="no-referrer"
            className="w-9 h-9 object-contain shrink-0 bg-white rounded p-0.5 border border-white/20"
          />
          <span className="truncate max-w-[190px] sm:max-w-none">
            Moreden of Education International School
          </span>
        </button>

        <nav
          aria-label="Main institutional navigation"
          className="hidden lg:flex items-center gap-6 text-sm font-medium"
        >
          {navItems.map((item) => {
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`py-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  isActive
                    ? 'text-white border-amber-400 font-semibold'
                    : 'text-blue-100/90 border-transparent hover:text-white hover:border-blue-300/60'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('portal')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
              activePage === 'portal'
                ? 'bg-white text-[#082D59] border-white'
                : 'bg-[#8B1E24] text-white border-[#A92B32] hover:bg-[#70161B]'
            }`}
          >
            {portalLabel}
          </button>
        </div>
      </div>

      <nav
        aria-label="Mobile institutional navigation"
        className="lg:hidden bg-[#062142] border-t border-white/10 px-4 py-2 flex items-center gap-5 overflow-x-auto text-xs font-medium"
      >
        {navItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`py-1 whitespace-nowrap shrink-0 cursor-pointer ${
                isActive ? 'text-amber-300 font-semibold underline underline-offset-4' : 'text-blue-100'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
