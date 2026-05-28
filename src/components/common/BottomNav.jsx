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

export default function BottomNav() {
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
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md border-t border-border z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', userSelect: 'none', WebkitUserSelect: 'none', background: 'hsl(var(--card))' }}
    >
      <div className="flex items-center justify-around px-2 py-3">
        {getNavItems().map(({ icon: Icon, label, path }) => {
          const isProtected = path === '/playlists' || path === '/profile';
          const active = location.pathname === path ||
            (path !== '/' && location.pathname.startsWith(path));

          const handleClick = () => {
            if (isProtected && isAuthed === false) {
              redirectToLogin(window.location.href);
              return;
            }
            navigate(path);
          };

          const showLogin = path === '/profile' && isAuthed !== true;
          const DisplayIcon = showLogin ? LogIn : Icon;
          const displayLabel = showLogin ? t('loginWithGoogle').split(' ')[0] : label;

          return (
            <button
              key={path}
              onClick={handleClick}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition-all duration-200 active:scale-95",
                active ? "text-primary" : "text-muted-foreground"
              )}
              style={{ WebkitTapHighlightColor: 'transparent', background: 'none', border: 'none' }}
            >
              <div className={cn(
                "relative",
                active && "after:absolute after:-bottom-0.5 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-primary"
              )}>
                <DisplayIcon size={22} strokeWidth={active ? 2.5 : 1.8} />
              </div>
              <span className="text-xs font-medium">{displayLabel}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}