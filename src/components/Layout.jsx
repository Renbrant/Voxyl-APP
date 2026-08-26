import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import AudioPlayer from './player/AudioPlayer';
import { usePlayer } from '@/lib/PlayerContext';
import FollowRequestsBell from '@/components/notifications/FollowRequestsBell';
import Sidebar from '@/components/common/Sidebar';
import { useAuth } from '@/lib/AuthContext';
import { t } from '@/lib/i18n';
import { Home, Compass, Users, Heart, User } from 'lucide-react';
import { ACTIVE_PRIMARY_NAVIGATION } from '@/lib/primaryNavigation';
import { voxylApi } from '@/api/voxylApiClient';

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

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentEpisode } = usePlayer();
  const { isAuthenticated, clerkLoaded, isLoadingAuth, apiUser, navigateToLogin } = useAuth();
  const authReady = clerkLoaded || !isLoadingAuth;
  const peopleSummaryQuery = useQuery({
    queryKey: ['people-summary', apiUser?.id],
    enabled: Boolean(isAuthenticated && apiUser?.id),
    queryFn: () => voxylApi.people.summary(),
    refetchInterval: 30000,
  });
  const peopleRequestsCount = Number(peopleSummaryQuery.data?.counts?.requests) || 0;
  const tabHistory = useRef({});

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
      <Sidebar peopleRequestsCount={peopleRequestsCount} />

      <div className="flex flex-col flex-1 min-w-0 relative bg-background">
      <main
        className="flex-1 overflow-y-auto"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))'
        }}
      >
        <div className="md:w-full md:px-6">
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
          {getNavItems().map(({ id, icon: Icon, label, path }) => {
            // For protected tabs, redirect to login if not authed
            const isProtected = path === '/library' || path === '/profile';
            const active = location.pathname === path ||
              (path !== '/' && location.pathname.startsWith(path));

            const handleClick = () => {
              if (isProtected && authReady && !isAuthenticated) {
                navigateToLogin();
                return;
              }
              handleNavClick(path);
            };


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
                  <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
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
                <span className="text-xs font-medium">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
      </div>
    </div>
  );
}
