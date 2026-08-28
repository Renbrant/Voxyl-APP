import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Download, ListMusic, LogIn, Mic, Plus, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { t } from '@/lib/i18n';
import { voxylApi } from '@/api/voxylApiClient';
import { useAuth } from '@/lib/AuthContext';
import VoxylHeader from '@/components/common/VoxylHeader';
import PlaylistCard from '@/components/playlist/PlaylistCard';
import CreatePlaylistModal from '@/components/playlist/CreatePlaylistModal';
import LikedPodcastCard from '@/components/explore/LikedPodcastCard';
import PullToRefreshIndicator from '@/components/common/PullToRefreshIndicator';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import DownloadedEpisodeCard from '@/components/downloads/DownloadedEpisodeCard';
import { getDownloads } from '@/lib/downloads';
import { getCache, setCache, invalidateCache, TTL_5MIN } from '@/lib/appCache';
import { getCachedContent, setCachedContent } from '@/lib/savedContentCache';
import {
  handlePodcastLikeMutationSuccess,
  loadLikedPlaylistsForRecords,
  loadPlaylistLikeRecords,
  loadPodcastLikeRecords,
  playlistLikeIds,
  refreshPlaylistLikeQuery,
  refreshPodcastLikeQuery,
  savedContentQueryKeys,
  togglePlaylistLikeOptimistically,
} from '@/lib/savedContentQueries';

const VIEW_CONFIG = {
  mine: { titleKey: 'playlistsMine', icon: ListMusic },
  followed: { titleKey: 'playlistsLiked', icon: ListMusic },
  podcasts: { titleKey: 'playlistsTabPodcasts', icon: Mic },
  downloads: { titleKey: 'playlistsTabDownloads', icon: Download },
};

export default function Playlists({ view = 'mine' }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, isLoadingAuth, accountSyncError, navigateToLogin, checkUserAuth } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [downloads, setDownloads] = useState([]);
  const containerRef = useRef(null);
  const canLoadUserData = Boolean(user && !user.account_sync_pending && !accountSyncError);
  const config = VIEW_CONFIG[view] || VIEW_CONFIG.mine;

  const { pullProgress, refreshing } = usePullToRefresh(() => {
    invalidateCache(`my-playlists-${user?.id}`);
    queryClient.invalidateQueries({ queryKey: ['my-playlists', user?.id] });
    if (canLoadUserData) {
      refreshPlaylistLikeQuery(queryClient, user.id);
      refreshPodcastLikeQuery(queryClient, user.id);
    }
    setDownloads(getDownloads());
  }, containerRef);

  useEffect(() => {
    setDownloads(getDownloads());
  }, [view]);

  const { data: myPlaylists = [], refetch: refetchMine } = useQuery({
    queryKey: ['my-playlists', user?.id],
    enabled: canLoadUserData && (view === 'mine' || view === 'followed'),
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

  const {
    data: likedPlaylistRecords = [],
    isLoading: likedPlaylistsLoading,
    isFetching: likedPlaylistsFetching,
    isError: likedPlaylistsError,
  } = useQuery({
    queryKey: savedContentQueryKeys.playlistLikes(user?.id),
    enabled: canLoadUserData && (view === 'mine' || view === 'followed'),
    queryFn: async () => {
      try {
        return await loadPlaylistLikeRecords(user.id);
      } catch (error) {
        console.error('[Library] Failed to load playlist likes', { userId: user.id, error });
        throw error;
      }
    },
    initialData: () => {
      if (!canLoadUserData) return undefined;
      return getCachedContent(user.id, 'LIKED_PLAYLISTS') || getCache(`liked-playlists-${user.id}`) || undefined;
    },
  });

  const likedPlaylistIds = playlistLikeIds(likedPlaylistRecords);
  const {
    data: likedPlaylists = [],
    isLoading: likedPlaylistDataLoading,
    isFetching: likedPlaylistDataFetching,
    isError: likedPlaylistDataError,
    refetch: refetchLikedPlaylistData,
  } = useQuery({
    queryKey: savedContentQueryKeys.likedPlaylists(user?.id, likedPlaylistIds),
    enabled: canLoadUserData && view === 'followed' && likedPlaylistIds.length > 0,
    queryFn: async () => {
      try {
        return await loadLikedPlaylistsForRecords(likedPlaylistRecords, myPlaylists);
      } catch (error) {
        console.error('[Library] Failed to load followed playlist metadata', { userId: user.id, likedPlaylistIds, error });
        throw error;
      }
    },
  });

  const { data: userPlays = [] } = useQuery({
    queryKey: ['user-plays-sort', user?.id],
    enabled: canLoadUserData && (view === 'mine' || view === 'followed' || view === 'podcasts'),
    queryFn: () => voxylApi.entities.PodcastPlay.filter({ user_id: user.id }, '-played_at', 500),
  });

  const feedLastPlayed = {};
  userPlays.forEach((play) => {
    if (!feedLastPlayed[play.feed_url] || play.played_at > feedLastPlayed[play.feed_url]) {
      feedLastPlayed[play.feed_url] = play.played_at;
    }
  });

  const {
    data: likedPodcasts = [],
    refetch: refetchPodcasts,
    isLoading: likedPodcastsLoading,
    isFetching: likedPodcastsFetching,
    isError: likedPodcastsError,
  } = useQuery({
    queryKey: savedContentQueryKeys.podcastLikes(user?.id),
    enabled: canLoadUserData && view === 'podcasts',
    queryFn: async () => {
      try {
        return await loadPodcastLikeRecords(user.id);
      } catch (error) {
        console.error('[Library] Failed to load liked podcasts', { userId: user.id, error });
        throw error;
      }
    },
    initialData: () => {
      if (!canLoadUserData) return undefined;
      return getCachedContent(user.id, 'LIKED_PODCASTS') || getCache(`liked-podcasts-${user.id}`) || undefined;
    },
  });

  const handleUnlikePodcast = async (podcastLike) => {
    try {
      await voxylApi.entities.PodcastLike.delete(podcastLike.id);
      handlePodcastLikeMutationSuccess(queryClient, user?.id);
      refetchPodcasts();
    } catch (error) {
      console.error('[Library] Failed to remove liked podcast', { podcastLikeId: podcastLike.id, error });
    }
  };

  const handleLikePlaylist = async (playlist) => {
    if (!user) return;
    try {
      await togglePlaylistLikeOptimistically({
        queryClient,
        userId: user.id,
        playlistId: playlist.id,
        toggle: () => voxylApi.functions.invoke('togglePlaylistLike', { playlist_id: playlist.id }),
      });
    } catch (error) {
      console.error('[Library] Failed to toggle playlist like', { playlistId: playlist.id, error });
    }
  };

  const sortPlaylistsByRecentListening = (playlists) => [...playlists].sort((a, b) => {
    const aLast = Math.max(...(a.rss_feeds || []).map((feed) => (
      feedLastPlayed[feed.url] ? new Date(feedLastPlayed[feed.url]).getTime() : 0
    )), 0);
    const bLast = Math.max(...(b.rss_feeds || []).map((feed) => (
      feedLastPlayed[feed.url] ? new Date(feedLastPlayed[feed.url]).getTime() : 0
    )), 0);
    return bLast - aLast;
  });

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

  return (
    <div ref={containerRef} className="bg-background pb-24 relative">
      <PullToRefreshIndicator pullProgress={pullProgress} refreshing={refreshing} />
      <VoxylHeader
        title={t(config.titleKey)}
        subtitle={t('navLibrary')}
        right={view === 'mine' ? (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center glow-primary"
            style={{ WebkitTapHighlightColor: 'transparent' }}
            aria-label="Create playlist"
          >
            <Plus size={18} className="text-white" />
          </button>
        ) : null}
      />

      <div className="px-4 mb-4">
        <button
          type="button"
          onClick={() => navigate('/library')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
        >
          <ChevronLeft size={16} />
          {t('navLibrary')}
        </button>
      </div>

      <div className="px-4 space-y-2">
        {view === 'mine' && (
          myPlaylists.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-4xl mb-3">🎵</p>
              <p className="font-medium text-foreground">{t('playlistsEmpty')}</p>
              <p className="text-sm mt-1">{t('playlistsEmptyHint')}</p>
            </div>
          ) : (
            sortPlaylistsByRecentListening(myPlaylists).map((playlist, index) => (
              <motion.div key={playlist.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
                <PlaylistCard
                  playlist={playlist}
                  compact
                  liked={!likedPlaylistsError && !likedPlaylistsLoading && likedPlaylistIds.includes(playlist.id)}
                  currentUser={user}
                  onEdited={refetchMine}
                />
              </motion.div>
            ))
          )
        )}

        {view === 'followed' && (
          likedPlaylistsLoading || likedPlaylistsFetching || likedPlaylistDataLoading || likedPlaylistDataFetching ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, index) => <div key={index} className="h-20 rounded-2xl bg-secondary animate-pulse" />)}
            </div>
          ) : likedPlaylistsError ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-sm mb-4">{t('explorePlaylistsError')}</p>
              <button
                type="button"
                onClick={() => refreshPlaylistLikeQuery(queryClient, user?.id)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium gradient-primary text-white"
              >
                <RefreshCw size={14} />
                {t('retry')}
              </button>
            </div>
          ) : likedPlaylistDataError ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-sm mb-4">{t('explorePlaylistsError')}</p>
              <button
                type="button"
                onClick={() => refetchLikedPlaylistData()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium gradient-primary text-white"
              >
                <RefreshCw size={14} />
                {t('retry')}
              </button>
            </div>
          ) : likedPlaylists.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-4xl mb-3">🎵</p>
              <p className="font-medium text-foreground">{t('playlistsEmpty')}</p>
              <p className="text-sm mt-1">{t('playlistsEmptyHint')}</p>
            </div>
          ) : (
            sortPlaylistsByRecentListening(likedPlaylists).map((playlist, index) => (
              <motion.div key={playlist.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
                <PlaylistCard
                  playlist={playlist}
                  compact
                  liked
                  onLike={handleLikePlaylist}
                  currentUser={user}
                />
              </motion.div>
            ))
          )
        )}

        {view === 'downloads' && (
          downloads.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-4xl mb-3">📥</p>
              <p className="font-medium text-foreground">{t('playlistsNoDownloads')}</p>
              <p className="text-sm mt-1">{t('playlistsNoDownloadsHint')}</p>
            </div>
          ) : (
            downloads.map((episode, index) => (
              <motion.div key={episode.audioUrl} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
                <DownloadedEpisodeCard
                  episode={episode}
                  onRemoved={() => setDownloads(getDownloads())}
                />
              </motion.div>
            ))
          )
        )}

        {view === 'podcasts' && (
          likedPodcastsLoading || likedPodcastsFetching ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, index) => <div key={index} className="h-20 rounded-2xl bg-secondary animate-pulse" />)}
            </div>
          ) : likedPodcastsError ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-sm mb-4">{t('podcastSearchFailed')}</p>
              <button
                type="button"
                onClick={() => refreshPodcastLikeQuery(queryClient, user?.id)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium gradient-primary text-white"
              >
                <RefreshCw size={14} />
                {t('retry')}
              </button>
            </div>
          ) : likedPodcasts.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-4xl mb-3">🎙️</p>
              <p className="font-medium text-foreground">{t('playlistsNoPodcasts')}</p>
              <p className="text-sm mt-1">{t('playlistsNoPodcastsHint')}</p>
            </div>
          ) : (
            [...likedPodcasts]
              .sort((a, b) => {
                const aLast = feedLastPlayed[a.feed_url] ? new Date(feedLastPlayed[a.feed_url]).getTime() : 0;
                const bLast = feedLastPlayed[b.feed_url] ? new Date(feedLastPlayed[b.feed_url]).getTime() : 0;
                return bLast - aLast;
              })
              .map((like, index) => (
                <motion.div key={like.feed_url} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
                  <LikedPodcastCard
                    podcastLike={like}
                    onUnlike={() => handleUnlikePodcast(like)}
                  />
                </motion.div>
              ))
          )
        )}
      </div>

      {showCreate && user && (
        <CreatePlaylistModal
          user={user}
          playlistCount={myPlaylists.length}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            invalidateCache(`my-playlists-${user?.id}`);
            refetchMine();
          }}
        />
      )}
    </div>
  );
}
