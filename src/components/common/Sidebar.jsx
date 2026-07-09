import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Home, Compass, Heart, User, LogIn, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
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
  const { isAuthenticated, clerkLoaded, isLoadingAuth, user, navigateToLogin, logout } = useAuth();
  const authReady = clerkLoaded || !isLoadingAuth;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug('[VOXYL SIDEBAR] auth render', {
      clerkLoaded,
      isLoadingAuth,
      isAuthenticated,
      userId: user?.id || null,
      accountSyncPending: Boolean(user?.account_sync_pending),
    });
  }, [clerkLoaded, isAuthenticated, isLoadingAuth, user]);

  return (
    <aside
      className="hidden md:flex flex-col w-60 lg:w-64 flex-shrink-0 border-r border-border h-full"
      style={{ background: 'hsl(var(--card))' }}
    >
      <div className="flex items-center gap-2.5 px-6 pt-8 pb-6 select-none">
        <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0">
          <div className="flex h-full w-full items-center justify-center bg-primary text-sm font-bold text-primary-foreground">V</div>
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

          const showLogin = path === '/profile' && authReady && !isAuthenticated;
          const DisplayIcon = showLogin ? LogIn : Icon;
          const displayLabel = showLogin ? t('loginWithGoogle').split(' ')[0] : label;

          const handleClick = () => {
            if (isProtected && authReady && !isAuthenticated) {
              navigateToLogin();
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

      {isAuthenticated && (
        <div className="mt-auto px-3 pb-5">
          <button
            type="button"
            onClick={() => logout()}
            className="flex w-full items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-secondary/50"
          >
            <LogOut size={20} strokeWidth={1.8} />
            <span>{t('settingsLogout')}</span>
          </button>
        </div>
      )}
    </aside>
  );
}
