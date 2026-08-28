import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Download, ListMusic, LogIn, Mic, RefreshCw } from 'lucide-react';
import VoxylHeader from '@/components/common/VoxylHeader';
import { voxylApi } from '@/api/voxylApiClient';
import { useAuth } from '@/lib/AuthContext';
import { t } from '@/lib/i18n';
import { getDownloads } from '@/lib/downloads';
import { getCache, setCache, TTL_5MIN } from '@/lib/appCache';
import { getCachedContent, setCachedContent } from '@/lib/savedContentCache';
import {
  loadLikedPlaylistsForRecords,
  loadPlaylistLikeRecords,
  loadPodcastLikeRecords,
  playlistLikeIds,
  savedContentQueryKeys,
} from '@/lib/savedContentQueries';

const LIBRARY_CARDS = [
  {
    key: 'mine',
    labelKey: 'playlistsMine',
    path: '/library/my-playlists',
    icon: ListMusic,
  },
  {
    key: 'followed',
    labelKey: 'playlistsLiked',
    path: '/library/followed-playlists',
    icon: ListMusic,
  },
  {
    key: 'podcasts',
    labelKey: 'playlistsTabPodcasts',
    path: '/library/liked-podcasts',
    icon: Mic,
  },
  {
    key: 'downloads',
    labelKey: 'playlistsTabDownloads',
    path: '/library/downloads',
    icon: Download,
  },
];

function LibraryCard({ label, count, icon: Icon, loading, error, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-[112px] rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex h-full items-center gap-4">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon size={21} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          {loading ? (
            <div className="mt-2 h-7 w-12 animate-pulse rounded bg-secondary" />
          ) : error ? (
            <p className="mt-1 text-xs text-muted-foreground">—</p>
          ) : (
            <p className="mt-1 text-2xl font-bold text-foreground">{count}</p>
          )}
        </div>
        <ChevronRight size={18} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
    </button>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    user,
    isAuthenticated,
    isLoadingAuth,
    accountSyncError,
    navigateToLogin,
    checkUserAuth,
  } = useAuth();
  const canLoadUserData = Boolean(user && !user.account_sync_pending && !accountSyncError);

  const myPlaylistsQuery = useQuery({
    queryKey: ['my-playlists', user?.id],
    enabled: canLoadUserData,
    queryFn: async () => {
      const cacheKey = `my-playlists-${user.id}`;
      const cached = getCache(cacheKey);
      if (cached) return cached;
      const data = await voxylApi.entities.Playlist.filter({ creator_id: user.id }, '-created_date', 50);
      setCache(cacheKey, data, TTL_5MIN);
      setCachedContent(user.id, 'MY_PLAYLISTS', data);
      return data;
    },
    initialData: () => {
      if (!canLoadUserData) return undefined;
      return getCachedContent(user.id, 'MY_PLAYLISTS') || getCache(`my-playlists-${user.id}`) || undefined;
    },
  });

  const playlistLikesQuery = useQuery({
    queryKey: savedContentQueryKeys.playlistLikes(user?.id),
    enabled: canLoadUserData,
    queryFn: () => loadPlaylistLikeRecords(user.id),
    initialData: () => {
      if (!canLoadUserData) return undefined;
      return getCachedContent(user.id, 'LIKED_PLAYLISTS') || getCache(`liked-playlists-${user.id}`) || undefined;
    },
  });

  const likedPlaylistIds = playlistLikeIds(playlistLikesQuery.data || []);
  const followedPlaylistsQuery = useQuery({
    queryKey: savedContentQueryKeys.likedPlaylists(user?.id, likedPlaylistIds),
    enabled: canLoadUserData && playlistLikesQuery.isSuccess && likedPlaylistIds.length > 0,
    queryFn: () => loadLikedPlaylistsForRecords(playlistLikesQuery.data || [], myPlaylistsQuery.data || []),
  });

  const likedPodcastsQuery = useQuery({
    queryKey: savedContentQueryKeys.podcastLikes(user?.id),
    enabled: canLoadUserData,
    queryFn: () => loadPodcastLikeRecords(user.id),
    initialData: () => {
      if (!canLoadUserData) return undefined;
      return getCachedContent(user.id, 'LIKED_PODCASTS') || getCache(`liked-podcasts-${user.id}`) || undefined;
    },
  });

  const downloadsCount = useMemo(() => getDownloads().length, []);
  const followedLoading = playlistLikesQuery.isLoading || (
    likedPlaylistIds.length > 0 && followedPlaylistsQuery.isLoading
  );
  const followedError = playlistLikesQuery.isError || followedPlaylistsQuery.isError;

  const counts = {
    mine: myPlaylistsQuery.data?.length || 0,
    followed: likedPlaylistIds.length === 0 ? 0 : followedPlaylistsQuery.data?.length || 0,
    podcasts: likedPodcastsQuery.data?.length || 0,
    downloads: downloadsCount,
  };

  const states = {
    mine: { loading: myPlaylistsQuery.isLoading, error: myPlaylistsQuery.isError },
    followed: { loading: followedLoading, error: followedError },
    podcasts: { loading: likedPodcastsQuery.isLoading, error: likedPodcastsQuery.isError },
    downloads: { loading: false, error: false },
  };

  const handleRetry = () => {
    queryClient.invalidateQueries({ queryKey: ['my-playlists', user?.id] });
    queryClient.invalidateQueries({ queryKey: savedContentQueryKeys.playlistLikes(user?.id) });
    queryClient.invalidateQueries({ queryKey: ['saved-content', 'liked-playlists', user?.id] });
    queryClient.invalidateQueries({ queryKey: savedContentQueryKeys.podcastLikes(user?.id) });
  };

  if (!isLoadingAuth && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-5">
        <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center glow-primary">
          <LogIn size={28} className="text-white" />
        </div>
        <div>
          <h2 className="text-xl font-grotesk font-bold text-foreground mb-1">{t('loginToAccess')}</h2>
          <p className="text-sm text-muted-foreground">{t('loginToAccessHint')}</p>
        </div>
        <button
          type="button"
          onClick={navigateToLogin}
          className="px-6 py-3 rounded-2xl gradient-primary text-white font-semibold text-sm glow-primary"
        >
          {t('loginWithGoogle')}
        </button>
      </div>
    );
  }

  if (accountSyncError) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center">
          <RefreshCw size={28} className="text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-grotesk font-bold text-foreground mb-1">Account sync needed</h2>
          <p className="text-sm text-muted-foreground">{accountSyncError.message}</p>
        </div>
        <button
          type="button"
          onClick={checkUserAuth}
          className="px-6 py-3 rounded-2xl gradient-primary text-white font-semibold text-sm glow-primary"
        >
          Try again
        </button>
      </div>
    );
  }

  const hasRemoteError = myPlaylistsQuery.isError || followedError || likedPodcastsQuery.isError;

  return (
    <div className="bg-background pb-24">
      <VoxylHeader title={t('navLibrary')} subtitle={t('playlistsSubtitle')} right={null} />

      {hasRemoteError && (
        <div className="mx-4 mb-4 flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3">
          <p className="text-sm text-muted-foreground">{t('explorePlaylistsError')}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="flex-shrink-0 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground"
          >
            {t('retry')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 px-4 sm:grid-cols-2 xl:grid-cols-4">
        {LIBRARY_CARDS.map((card) => (
          <LibraryCard
            key={card.key}
            label={t(card.labelKey)}
            count={counts[card.key]}
            icon={card.icon}
            loading={states[card.key].loading}
            error={states[card.key].error}
            onClick={() => navigate(card.path)}
          />
        ))}
      </div>
    </div>
  );
}
