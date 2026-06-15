import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import AudioPlayer from './player/AudioPlayer';
import { usePlayer } from '@/lib/PlayerContext';
import FollowRequestsBell from '@/components/notifications/FollowRequestsBell';
import Sidebar from '@/components/common/Sidebar';
import { base44 } from '@/api/base44Client';
import { redirectToLogin } from '@/lib/authRedirect';
import { t } from '@/lib/i18n';
import { Home, Compass, Heart, User, LogIn } from 'lucide-react';

const getNavItems = () => [
  { icon: Home, label: t('navFeed'), path: '/' },
  { icon: Compass, label: t('navExplore'), path: '/explore' },
  { icon: Heart, label: t('navPlaylists'), path: '/playlists' },
  { icon: User, label: t('navProfile'), path: '/profile' },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentEpisode } = usePlayer();
  const tabHistory = useRef({});
  // Use cached value to avoid flash on navigation
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
    }).catch(() => {
      sessionStorage.setItem('voxyl_authed', 'false');
      setIsAuthed(false);
    });
  }, []);

  const handleNavClick = (path) => {
    const active = location.pathname === path ||
      (path !== '/' && location.pathname.startsWith(path));

    if (active) {
      navigate(path, { replace: true });
    } else {
      const saved = tabHistory.current[path];
      navigate(saved || path);
    }
    const currentTab = getNavItems().find(n => n.path !== '/'
      ? location.pathname.startsWith(n.path)
      : location.pathname === '/');
    if (currentTab) {
      tabHistory.current[currentTab.path] = location.pathname;
    }
  };

  return (
    <div
      className="flex bg-background relative"
      style={{ height: '100dvh', background: '#0f0d0b' }}
    >
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0 relative">
      <main
        className="flex-1 overflow-y-auto"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))'
        }}
      >
        <div className="md:max-w-5xl md:mx-auto md:w-full md:px-2">
          <Outlet />
        </div>
      </main>

      {currentEpisode && <AudioPlayer />}
      <FollowRequestsBell />

      <nav
        className="md:hidden fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md border-t border-border z-50"
        style={{
          userSelect: 'none',
          WebkitUserSelect: 'none',
          background: 'hsl(var(--card))',
          height: 'calc(4rem + env(safe-area-inset-bottom, 0px))',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="h-16 flex items-center justify-around px-2">
          {getNavItems().map(({ icon: Icon, label, path }) => {
            // For protected tabs, redirect to login if not authed
            const isProtected = path === '/playlists' || path === '/profile';
            const active = location.pathname === path ||
              (path !== '/' && location.pathname.startsWith(path));

            const handleClick = () => {
              if (isProtected && isAuthed === false) {
                redirectToLogin(window.location.href);
                return;
              }
              handleNavClick(path);
            };

            // Show login icon for profile tab when not authed or still loading (no cache)
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
      </div>
    </div>
  );
}