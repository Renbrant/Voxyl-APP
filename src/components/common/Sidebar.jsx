import { useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Home, Compass, Heart, User, LogIn } from 'lucide-react';
import { cn } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { redirectToLogin } from '@/lib/authRedirect';
import { t } from '@/lib/i18n';

const getNavItems = () => [
  { icon: Home, label: t('navFeed'), path: '/' },
  { icon: Compass, label: t('navExplore'), path: '/explore' },
  { icon: Heart, label: t('navPlaylists'), path: '/playlists' },
  { icon: User, label: t('navProfile'), path: '/profile' },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isAuthed, setIsAuthed] = useState(() => {
    const cached = sessionStorage.getItem('voxyl_authed');
    if (cached === 'true') return true;
    if (cached === 'false') return false;
    return null;
  });

  useEffect(() => {
    base44.auth.isAuthenticated().then(v => {
      sessionStorage.setItem('voxyl_authed', String(v));
      setIsAuthed(v);
    }).catch(() => setIsAuthed(false));
  }, []);

  return (
    <aside
      className="hidden md:flex flex-col w-60 lg:w-64 flex-shrink-0 border-r border-border h-full"
      style={{ background: 'hsl(var(--card))' }}
    >
      <div className="flex items-center gap-2.5 px-6 pt-8 pb-6 select-none">
        <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0">
          <img src="https://media.base44.com/images/public/69e2ae13aa773b21002b1fe4/26d262763_voxyllogo.png" alt="Voxyl" className="w-full h-full object-contain" />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-grotesk font-bold text-gradient">Voxyl</span>
          <span className="text-[10px] text-muted-foreground/50 font-mono leading-none">v2.5</span>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-3 mt-2">
        {getNavItems().map(({ icon: Icon, label, path }) => {
          const isProtected = path === '/playlists' || path === '/profile';
          const active = location.pathname === path ||
            (path !== '/' && location.pathname.startsWith(path));

          const showLogin = path === '/profile' && isAuthed !== true;
          const DisplayIcon = showLogin ? LogIn : Icon;
          const displayLabel = showLogin ? t('loginWithGoogle').split(' ')[0] : label;

          const handleClick = () => {
            if (isProtected && isAuthed === false) {
              redirectToLogin(window.location.href);
              return;
            }
            navigate(path);
          };

          return (
            <button
              key={path}
              onClick={handleClick}
              className={cn(
                "flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                active
                  ? "bg-secondary text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <DisplayIcon size={20} strokeWidth={active ? 2.5 : 1.8} />
              <span>{displayLabel}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}