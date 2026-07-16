import { useState, useEffect, useRef } from 'react';
import { t } from '@/lib/i18n';
import { voxylApi } from '@/api/voxylApiClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ListMusic, Mic, Download, LogIn, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
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

const TABS = () => [
{ key: 'playlists', label: t('playlistsTabPlaylists'), icon: ListMusic },
{ key: 'podcasts', label: t('playlistsTabPodcasts'), icon: Mic },
{ key: 'downloads', label: t('playlistsTabDownloads'), icon: Download }];


export default function Playlists() {
  const { user, isAuthenticated, isLoadingAuth, accountSyncError, navigateToLogin, checkUserAuth } = useAuth();
  const [tab, setTab] = useState('playlists');
  const [showCreate, setShowCreate] = useState(false);
  const [downloads, setDownloads] = useState([]);
  const containerRef = useRef(null);
  const queryClient = useQueryClient();
  const canLoadUserData = Boolean(user && !user.account_sync_pending && !accountSyncError);

  const { pullProgress, refreshing } = usePullToRefresh(() => {
    invalidateCache(`my-playlists-${user?.id}`);
    queryClient.invalidateQueries({ queryKey: ['my-playlists'] });
    if (canLoadUserData) {
      refreshPlaylistLikeQuery(queryClient, user.id);
      refreshPodcastLikeQuery(queryClient, user.id);
    }
  }, containerRef);

  useEffect(() => {
    setDownloads(getDownloads());
  }, []);

  // My playlists
  const { data: myPlaylists = [], refetch: refetchMine } = useQuery({
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
      const cached = getCachedContent(user.id, 'MY_PLAYLISTS');
      return cached || getCache(`my-playlists-${user.id}`) || undefined;
    }
  });

  // Liked playlist IDs
  const {
    data: likedPlaylistRecords = [],
    isLoading: likedPlaylistsLoading,
    isFetching: likedPlaylistsFetching,
    isError: likedPlaylistsError,
  } = useQuery({
    queryKey: savedContentQueryKeys.playlistLikes(user?.id),
    enabled: canLoadUserData && tab === 'playlists',
    queryFn: async () => {
      try {
        return await loadPlaylistLikeRecords(user.id);
      } catch (error) {
        console.error('[Playlists] Failed to load saved playlist likes', { userId: user.id, error });
        throw error;
      }
    },
    initialData: () => {
      if (!canLoadUserData) return undefined;
      const cached = getCachedContent(user.id, 'LIKED_PLAYLISTS');
      return cached || getCache(`liked-playlists-${user.id}`) || undefined;
    }
  });

  const likedPlaylistIds = playlistLikeIds(likedPlaylistRecords);

  // Liked playlists data (excluding ones I own, since they already appear above)
  const {
    data: likedPlaylists = [],
    isLoading: likedPlaylistDataLoading,
    isFetching: likedPlaylistDataFetching,
    isError: likedPlaylistDataError,
    refetch: refetchLikedPlaylistData,
  } = useQuery({
    queryKey: savedContentQueryKeys.likedPlaylists(user?.id, likedPlaylistIds),
    enabled: canLoadUserData && tab === 'playlists' && likedPlaylistIds.length > 0,
    queryFn: async () => {
      try {
        return await loadLikedPlaylistsForRecords(likedPlaylistRecords, myPlaylists);
      } catch (error) {
        console.error('[Playlists] Failed to load liked playlist metadata', { userId: user.id, likedPlaylistIds, error });
        throw error;
      }
    }
  });

  // User's recent plays (for sorting)
  const { data: userPlays = [] } = useQuery({
    queryKey: ['user-plays-sort', user?.id],
    enabled: canLoadUserData,
    queryFn: () => voxylApi.entities.PodcastPlay.filter({ user_id: user.id }, '-played_at', 500),
  });

  // Map: feed_url -> last played_at
  const feedLastPlayed = {};
  userPlays.forEach(play => {
    if (!feedLastPlayed[play.feed_url] || play.played_at > feedLastPlayed[play.feed_url]) {
      feedLastPlayed[play.feed_url] = play.played_at;
    }
  });

  // Liked podcasts
  const {
    data: likedPodcasts = [],
    refetch: refetchPodcasts,
    isLoading: likedPodcastsLoading,
    isFetching: likedPodcastsFetching,
    isError: likedPodcastsError,
  } = useQuery({
    queryKey: savedContentQueryKeys.podcastLikes(user?.id),
    enabled: canLoadUserData && tab === 'podcasts',
    queryFn: async () => {
      try {
        return await loadPodcastLikeRecords(user.id);
      } catch (error) {
        console.error('[Playlists] Failed to load saved podcasts', { userId: user.id, error });
        throw error;
      }
    },
    initialData: () => {
      if (!canLoadUserData) return undefined;
      const cached = getCachedContent(user.id, 'LIKED_PODCASTS');
      return cached || getCache(`liked-podcasts-${user.id}`) || undefined;
    }
  });

  const handleUnlikePodcast = async (podcastLike) => {
    try {
      await voxylApi.entities.PodcastLike.delete(podcastLike.id);
      handlePodcastLikeMutationSuccess(queryClient, user?.id);
      refetchPodcasts();
    } catch (error) {
      console.error('[Playlists] Failed to remove saved podcast', { podcastLikeId: podcastLike.id, error });
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
      console.error('[Playlists] Failed to toggle playlist like', { playlistId: playlist.id, error });
    }
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
        title={t('playlistsTitle')}
        subtitle={t('playlistsSubtitle')}
        right={
        tab === 'playlists' &&
        <button
          onClick={() => setShowCreate(true)}
          className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center glow-primary"
          style={{ WebkitTapHighlightColor: 'transparent' }}>
          
              <Plus size={18} className="text-white" />
            </button>

        } />
      

      {/* Tabs */}
      <div className="flex gap-2 px-4 mb-4">
        {TABS().map(({ key, label, icon: Icon }) =>
        <button
          key={key}
          onClick={() => setTab(key)}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all flex-shrink-0',
            tab === key ? 'gradient-primary text-white glow-primary' : 'bg-secondary text-muted-foreground'
          )}>
          
            <Icon size={14} />
            {label}
          </button>
        )}
      </div>

      <div className="px-4 space-y-2">
        {/* Playlists tab: mine first, then liked */}
        {tab === 'playlists' &&
        <>
            {/* My playlists */}
            {myPlaylists.length > 0 &&
          <>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium pb-1">{t('playlistsMine')}</p>
                {[...myPlaylists].sort((a, b) => {
                  const aLast = Math.max(...(a.rss_feeds || []).map(f => feedLastPlayed[f.url] ? new Date(feedLastPlayed[f.url]).getTime() : 0), 0);
                  const bLast = Math.max(...(b.rss_feeds || []).map(f => feedLastPlayed[f.url] ? new Date(feedLastPlayed[f.url]).getTime() : 0), 0);
                  return bLast - aLast;
                }).map((pl, i) =>
            <motion.div key={pl.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <PlaylistCard
                playlist={pl}
                compact
                liked={!likedPlaylistsError && !likedPlaylistsLoading && likedPlaylistIds.includes(pl.id)}
                currentUser={user}
                onEdited={refetchMine} />
              
                  </motion.div>
            )}
              </>
          }

            {/* Liked playlists from others */}
            {(likedPlaylistsLoading || likedPlaylistsFetching) &&
          <div className="pt-3 space-y-2">
                <div className="h-4 w-28 rounded bg-secondary animate-pulse" />
                <div className="h-20 rounded-2xl bg-secondary animate-pulse" />
              </div>
          }

            {likedPlaylistsError &&
          <div className="text-center py-8 text-muted-foreground">
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
          }

            {!likedPlaylistsError && !likedPlaylistsLoading && !likedPlaylistsFetching && likedPlaylistIds.length > 0 && (likedPlaylistDataLoading || likedPlaylistDataFetching) &&
          <div className="pt-3 space-y-2">
                <div className="h-4 w-32 rounded bg-secondary animate-pulse" />
                <div className="h-20 rounded-2xl bg-secondary animate-pulse" />
              </div>
          }

            {likedPlaylistDataError &&
          <div className="text-center py-8 text-muted-foreground">
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
          }

            {!likedPlaylistsError && !likedPlaylistDataError && likedPlaylists.length > 0 &&
          <>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium pt-3 pb-1">{t('playlistsLiked')}</p>
                {[...likedPlaylists].sort((a, b) => {
                  const aLast = Math.max(...(a.rss_feeds || []).map(f => feedLastPlayed[f.url] ? new Date(feedLastPlayed[f.url]).getTime() : 0), 0);
                  const bLast = Math.max(...(b.rss_feeds || []).map(f => feedLastPlayed[f.url] ? new Date(feedLastPlayed[f.url]).getTime() : 0), 0);
                  return bLast - aLast;
                }).map((pl, i) =>
            <motion.div key={pl.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                    <PlaylistCard
                playlist={pl}
                compact
                liked
                onLike={handleLikePlaylist}
                currentUser={user} />
              
                  </motion.div>
            )}
              </>
          }

            {myPlaylists.length === 0 && !likedPlaylistDataError && likedPlaylists.length === 0 &&
              !likedPlaylistsError && !likedPlaylistsLoading && !likedPlaylistsFetching &&
              !likedPlaylistDataLoading && !likedPlaylistDataFetching &&
          <div className="text-center py-16 text-muted-foreground">
                <p className="text-4xl mb-3">🎵</p>
                <p className="font-medium text-foreground">{t('playlistsEmpty')}</p>
                <p className="text-sm mt-1">{t('playlistsEmptyHint')}</p>
              </div>
          }
          </>
        }

        {/* Downloads tab */}
        {tab === 'downloads' && (
        downloads.length === 0 ?
        <div className="text-center py-16 text-muted-foreground">
              <p className="text-4xl mb-3">📥</p>
              <p className="font-medium text-foreground">{t('playlistsNoDownloads')}</p>
              <p className="text-sm mt-1">{t('playlistsNoDownloadsHint')}</p>
            </div> :

        <div className="space-y-2">
              {downloads.map((ep, i) =>
          <motion.div key={ep.audioUrl} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <DownloadedEpisodeCard
              episode={ep}
              onRemoved={() => setDownloads(getDownloads())} />
            
                </motion.div>
          )}
            </div>)

        }

        {/* Podcasts tab */}
        {tab === 'podcasts' && (
        likedPodcastsLoading || likedPodcastsFetching ?
        <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-secondary animate-pulse" />)}
            </div> :
        likedPodcastsError ?
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
            </div> :
        likedPodcasts.length === 0 ?
        <div className="text-center py-16 text-muted-foreground">
              <p className="text-4xl mb-3">🎙️</p>
              <p className="font-medium text-foreground">{t('playlistsNoPodcasts')}</p>
              <p className="text-sm mt-1">{t('playlistsNoPodcastsHint')}</p>
            </div> :

        [...likedPodcasts].sort((a, b) => {
          const aLast = feedLastPlayed[a.feed_url] ? new Date(feedLastPlayed[a.feed_url]).getTime() : 0;
          const bLast = feedLastPlayed[b.feed_url] ? new Date(feedLastPlayed[b.feed_url]).getTime() : 0;
          return bLast - aLast;
        }).map((like, i) =>
        <motion.div key={like.feed_url} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <LikedPodcastCard
            podcastLike={like}
            onUnlike={() => handleUnlikePodcast(like)} />
          
              </motion.div>
        ))

        }
      </div>

      {showCreate && user &&
      <CreatePlaylistModal
        user={user}
        playlistCount={myPlaylists.length}
        onClose={() => setShowCreate(false)}
        onCreated={() => {setShowCreate(false);invalidateCache(`my-playlists-${user?.id}`);refetchMine();}} />

      }
    </div>);

}
