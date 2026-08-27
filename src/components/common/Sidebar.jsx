import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Home, Compass, Users, Heart, User, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { t } from '@/lib/i18n';
import { APP_VERSION_LABEL } from '@/lib/version';
import { ACTIVE_PRIMARY_NAVIGATION } from '@/lib/primaryNavigation';

const NAV_ICONS = Object.freeze({
  home: Home,
  discover: Compass,
  people: Users,
  library: Heart,
  profile: User,
});

const getNavItems = () => ACTIVE_PRIMARY_NAVIGATION.map(item => ({
  ...item,
  icon: NAV_ICONS[item.icon],
  label: t(item.labelKey),
}));

export default function Sidebar({ peopleRequestsCount = 0 }) {
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
        <div className="w-9 h-9 flex items-center justify-center flex-shrink-0">
          <img
            src="/branding/voxyl-symbol-transparent.png"
            alt="Voxyl"
            className="h-full w-full object-contain"
          />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-grotesk font-bold text-gradient">Voxyl</span>
          <span className="text-[10px] text-muted-foreground/50 font-mono leading-none">{APP_VERSION_LABEL}</span>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-3 mt-2">
        {getNavItems().map(({ id, icon: Icon, label, path }) => {
          const isProtected = path === '/library' || path === '/profile';
          const active = location.pathname === path ||
            (path !== '/' && location.pathname.startsWith(path));


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
              <div className="relative flex-shrink-0">
                <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                {id === 'people' && peopleRequestsCount > 0 && (
                  <>
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -right-2 -top-2 min-w-[18px] h-[18px] rounded-full bg-primary px-1 text-[10px] font-bold leading-[18px] text-primary-foreground shadow-md"
                    >
                      {peopleRequestsCount > 9 ? '9+' : peopleRequestsCount}
                    </span>
                    <span className="sr-only">{t('peopleRequests')}: {peopleRequestsCount}</span>
                  </>
                )}
              </div>
              <span>{label}</span>
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
