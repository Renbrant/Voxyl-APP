import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Clock3,
  Flame,
  Loader2,
  Sparkles,
} from 'lucide-react';

import { voxylApi } from '@/api/voxylApiClient';
import VoxylHeader from '@/components/common/VoxylHeader';
import PlaylistCard from '@/components/playlist/PlaylistCard';
import PullToRefreshIndicator from '@/components/common/PullToRefreshIndicator';
import MyPlaylistsContent from '@/components/feed/MyPlaylistsContent';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { getCache, setCache, invalidateCache, TTL_5MIN } from '@/lib/appCache';
import { asArray } from '@/lib/arrayUtils';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  loadPlaylistLikeRecords,
  playlistLikeIds,
  refreshPlaylistLikeQuery,
  savedContentQueryKeys,
  togglePlaylistLikeOptimistically,
} from '@/lib/savedContentQueries';

function HomeRankedContent({
  rankingDays,
  playlists,
  podcasts,
  isLoading,
  isError,
  onRetry,
  user,
  likedIds,
  likesLoading,
  likesFetching,
  likesError,
  onRetryLikes,
  handleLike,
  setBlockedIds,
}) {
  const windowLabel = rankingDays === 7
    ? t('feedLastWeekWindow')
    : t('feedTrendingWindow');

  if (isLoading) {
    return (
      <div className="py-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Loader2 size={18} className="animate-spin text-primary" />
          <span>{t('loading')}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(item => (
            <div
              key={item}
              className="aspect-square rounded-2xl bg-secondary animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center py-16 gap-3 text-center text-muted-foreground">
        <AlertCircle size={28} className="text-destructive" />
        <p className="font-medium text-foreground">
          {t('feedRankingsError')}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center px-4 py-2 rounded-full gradient-primary text-white text-sm font-medium"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  if (!playlists.length && !podcasts.length) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-4xl mb-3">🎧</p>
        <p className="font-medium text-foreground">
          {t('feedRankingsEmpty')}
        </p>
        <p className="text-sm mt-1">{windowLabel}</p>
      </div>
    );
  }

  const likesUnavailable = likesLoading || likesFetching || likesError;

  return (
    <div className="space-y-8">
      {user && likesError && (
        <div className="rounded-2xl border border-border bg-card p-3 text-sm text-muted-foreground flex items-center justify-between gap-3">
          <span>{t('explorePlaylistsError')}</span>
          <button
            type="button"
            onClick={onRetryLikes}
            className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium gradient-primary text-white"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {playlists.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="text-base font-semibold text-foreground">
              {t('feedTopPlaylists')}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {windowLabel}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {playlists.slice(0, 12).map(playlist => (
              <PlaylistCard
                key={playlist.id}
                playlist={{
                  ...playlist,
                  plays_count: playlist.window_plays_count,
                }}
                liked={
                  !likesError &&
                  !likesLoading &&
                  likedIds.includes(playlist.id)
                }
                onLike={likesUnavailable ? undefined : handleLike}
                currentUser={user}
                onBlocked={id =>
                  setBlockedIds(previous => [
                    ...new Set([...previous, id]),
                  ])
                }
              />
            ))}
          </div>
        </section>
      )}

      {podcasts.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="text-base font-semibold text-foreground">
              {t('feedTopPodcasts')}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {windowLabel}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {podcasts.slice(0, 12).map(podcast => (
              <Link
                to={'/podcast/' + encodeURIComponent(podcast.feedUrl)}
                key={podcast.feedUrl}
                className="flex flex-col gap-2 p-2 rounded-2xl border border-border bg-card hover:border-primary/30 transition-all active:scale-95"
              >
                <div className="w-full aspect-square rounded-xl overflow-hidden bg-secondary">
                  {podcast.image ? (
                    <img
                      src={podcast.image}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-purple-800 via-primary/60 to-cyan-600" />
                  )}
                </div>

                <div className="min-w-0 px-1 pb-1">
                  <p className="text-sm font-medium line-clamp-2 text-foreground">
                    {podcast.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {podcast.playCount || 0} {t('feedRepros')}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function Feed() {
  const [user, setUser] = useState(null);
  const [blockedIds, setBlockedIds] = useState([]);
  const [authResolved, setAuthResolved] = useState(false);
  const [hiddenUsersReady, setHiddenUsersReady] = useState(false);
  const [hiddenUsersLoading, setHiddenUsersLoading] = useState(false);
  const [hiddenUsersError, setHiddenUsersError] = useState('');
  const [tab, setTab] = useState('for-you');

  const { requireAuth, redirectToLogin } = useRequireAuth();
  const containerRef = useRef(null);
  const queryClient = useQueryClient();

  const loadHiddenUsers = async (currentUser) => {
    if (!currentUser?.id) return;

    const cacheKey = 'hidden-users-' + currentUser.id;

    setHiddenUsersLoading(true);
    setHiddenUsersError('');

    try {
      const ids = [
        ...new Set(
          asArray(await voxylApi.blocks.hiddenUserIds()),
        ),
      ];

      setBlockedIds(ids);
      setCache(cacheKey, ids, TTL_5MIN);
      setHiddenUsersReady(true);
    } catch (error) {
      console.error('[Feed] Failed to load hidden users', { error });

      const cached = getCache(cacheKey);

      if (Array.isArray(cached)) {
        setBlockedIds(cached);
        setHiddenUsersReady(true);
      } else {
        setHiddenUsersReady(false);
        setHiddenUsersError(t('blockLoadHiddenError'));
      }
    } finally {
      setHiddenUsersLoading(false);
    }
  };

  useEffect(() => {
    voxylApi.auth.me()
      .then(currentUser => {
        setUser(currentUser);
        setAuthResolved(true);
        loadHiddenUsers(currentUser);
      })
      .catch(error => {
        if (error?.status && error.status !== 401) {
          console.error('[Feed] Failed to load current user', { error });
        }

        setAuthResolved(true);
      });
  }, []);

  const { pullProgress, refreshing } = usePullToRefresh(() => {
    invalidateCache('all-playlists-feed');
    invalidateCache('my-playlists-' + user?.id);
    invalidateCache('user-podcast-plays-' + user?.id);
    invalidateCache('user-episode-progress-' + user?.id);

    queryClient.invalidateQueries({
      queryKey: ['home-rankings'],
    });

    queryClient.invalidateQueries({
      queryKey: ['my-playlists'],
    });

    queryClient.invalidateQueries({
      queryKey: ['all-playlists-feed'],
    });

    queryClient.invalidateQueries({
      queryKey: ['user-podcast-plays'],
    });

    queryClient.invalidateQueries({
      queryKey: ['user-episode-progress'],
    });

    if (user?.id) {
      loadHiddenUsers(user);
      refreshPlaylistLikeQuery(queryClient, user.id);
    }
  }, containerRef);

  const {
    data: likedRecords = [],
    isLoading: likesLoading,
    isFetching: likesFetching,
    isError: likesError,
    refetch: refetchLikes,
  } = useQuery({
    queryKey: savedContentQueryKeys.playlistLikes(user?.id),
    enabled: !!user,
    queryFn: async () => {
      try {
        return await loadPlaylistLikeRecords(user.id);
      } catch (error) {
        console.error(
          '[Feed] Failed to load saved playlist likes',
          {
            userId: user.id,
            error,
          },
        );

        throw error;
      }
    },
    initialData: () => {
      const cached = user
        ? getCache('liked-playlists-' + user.id)
        : null;

      if (Array.isArray(cached)) {
        return cached;
      }

      return undefined;
    },
  });

  const likedIds = playlistLikeIds(likedRecords);

  const rankingDays = tab === 'last-week' ? 7 : 90;

  const {
    data: homeRankings,
    isLoading: rankingsLoading,
    isError: rankingsError,
    refetch: refetchRankings,
  } = useQuery({
    queryKey: ['home-rankings', rankingDays],
    enabled: tab === 'trending' || tab === 'last-week',
    queryFn: () => voxylApi.home.rankings(rankingDays),
  });

  const handleLike = requireAuth(async playlist => {
    if (likesLoading || likesError) {
      if (likesError) {
        refetchLikes();
      }

      return;
    }

    try {
      await togglePlaylistLikeOptimistically({
        queryClient,
        userId: user.id,
        playlistId: playlist.id,
        toggle: () =>
          voxylApi.functions.invoke(
            'togglePlaylistLike',
            {
              playlist_id: playlist.id,
            },
          ),
      });
    } catch (error) {
      console.error(
        '[Feed] Failed to toggle playlist like',
        {
          playlistId: playlist.id,
          error,
        },
      );
    }
  });

  const canRenderSocialContent = !user || hiddenUsersReady;

  const rankedPlaylists = canRenderSocialContent
    ? asArray(homeRankings?.playlists).filter(
        playlist => !blockedIds.includes(playlist.creator_id),
      )
    : [];

  const rankedPodcasts = canRenderSocialContent
    ? asArray(homeRankings?.podcasts)
    : [];

  return (
    <div
      ref={containerRef}
      className="bg-background relative"
    >
      <PullToRefreshIndicator
        pullProgress={pullProgress}
        refreshing={refreshing}
      />

      <VoxylHeader
        subtitle={null}
        title={
          <span className="text-gradient font-grotesk">
            Voxyl
          </span>
        }
        right={null}
      />

      <div className="flex gap-2 px-4 mb-4 overflow-x-auto no-scrollbar">
        {[
          {
            key: 'for-you',
            label: t('feedForYou'),
            icon: Sparkles,
          },
          {
            key: 'trending',
            label: t('feedTrending'),
            icon: Flame,
          },
          {
            key: 'last-week',
            label: t('feedLastWeek'),
            icon: Clock3,
          },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0',
              tab === key
                ? 'gradient-primary text-white glow-primary'
                : 'bg-secondary text-muted-foreground',
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div className="px-4 pb-24">
        {authResolved && user && !hiddenUsersReady && (
          <div className="mb-4 rounded-2xl border border-border bg-card p-3 text-sm text-muted-foreground flex items-center justify-between gap-3">
            <span>
              {hiddenUsersLoading
                ? t('loading')
                : hiddenUsersError || t('blockLoadHiddenError')}
            </span>

            {!hiddenUsersLoading && (
              <button
                type="button"
                onClick={() => loadHiddenUsers(user)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium gradient-primary text-white"
              >
                {t('blockRetry')}
              </button>
            )}
          </div>
        )}

        {tab === 'for-you' && !authResolved && (
          <div className="flex flex-col items-center py-12 gap-3 text-muted-foreground">
            <Loader2
              size={24}
              className="animate-spin text-primary"
            />
            <p className="text-sm">{t('loading')}</p>
          </div>
        )}

        {tab === 'for-you' && authResolved && !user && (
          <div className="rounded-3xl border border-border bg-card px-5 py-10 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full gradient-primary flex items-center justify-center glow-primary">
              <Sparkles
                size={20}
                className="text-white"
              />
            </div>

            <h2 className="text-lg font-semibold text-foreground">
              {t('feedSignInForYouTitle')}
            </h2>

            <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
              {t('feedSignInForYouHint')}
            </p>

            <button
              type="button"
              onClick={redirectToLogin}
              className="mt-5 inline-flex items-center px-5 py-2.5 rounded-full gradient-primary text-white text-sm font-medium glow-primary"
            >
              {t('feedSignInForYouAction')}
            </button>
          </div>
        )}

        {tab === 'for-you' && user && hiddenUsersReady && (
          <MyPlaylistsContent
            user={user}
            likedIds={likedIds}
            handleLike={
              likesLoading || likesFetching || likesError
                ? undefined
                : handleLike
            }
            blockedIds={blockedIds}
            setBlockedIds={setBlockedIds}
          />
        )}

        {(tab === 'trending' || tab === 'last-week') &&
          canRenderSocialContent && (
            <HomeRankedContent
              rankingDays={rankingDays}
              playlists={rankedPlaylists}
              podcasts={rankedPodcasts}
              isLoading={rankingsLoading}
              isError={rankingsError}
              onRetry={() => refetchRankings()}
              user={user}
              likedIds={likedIds}
              likesLoading={likesLoading}
              likesFetching={likesFetching}
              likesError={likesError}
              onRetryLikes={() =>
                refreshPlaylistLikeQuery(
                  queryClient,
                  user?.id,
                )
              }
              handleLike={handleLike}
              setBlockedIds={setBlockedIds}
            />
          )}
      </div>
    </div>
  );
}
