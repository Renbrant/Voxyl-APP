import { useState, useEffect, useRef } from 'react';
import { t } from '@/lib/i18n';
import { base44 } from '@/api/base44Client';
import { redirectToLogin } from '@/lib/authRedirect';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ListMusic, Mic, Download, LogIn } from 'lucide-react';
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
import { getCachedContent, setCachedContent, clearAllContentCache } from '@/lib/savedContentCache';

const TABS = () => [
{ key: 'playlists', label: t('playlistsTabPlaylists'), icon: ListMusic },
{ key: 'podcasts', label: t('playlistsTabPodcasts'), icon: Mic },
{ key: 'downloads', label: t('playlistsTabDownloads'), icon: Download }];


export default function Playlists() {
  const [user, setUser] = useState(null);
  const [isAuthed, setIsAuthed] = useState(null); // null = loading
  const [tab, setTab] = useState('playlists');
  const [showCreate, setShowCreate] = useState(false);
  const [downloads, setDownloads] = useState([]);
  const containerRef = useRef(null);
  const queryClient = useQueryClient();

  const { pullProgress, refreshing } = usePullToRefresh(() => {
    if (user?.id) clearAllContentCache(user.id);
    invalidateCache(`my-playlists-${user?.id}`);
    invalidateCache(`liked-playlists-${user?.id}`);
    invalidateCache(`liked-podcasts-${user?.id}`);
    queryClient.invalidateQueries({ queryKey: ['my-playlists'] });
    queryClient.invalidateQueries({ queryKey: ['liked-playlists'] });
    queryClient.invalidateQueries({ queryKey: ['liked-podcasts'] });
  }, containerRef);

  useEffect(() => {
    base44.auth.isAuthenticated().then(authed => {
      setIsAuthed(authed);
      if (authed) {
        base44.auth.me().then(setUser).catch(() => {});
      }
    }).catch(() => setIsAuthed(false));
    setDownloads(getDownloads());
  }, []);

  // My playlists
  const { data: myPlaylists = [], refetch: refetchMine } = useQuery({
    queryKey: ['my-playlists', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const cacheKey = `my-playlists-${user.id}`;
      const cached = getCache(cacheKey);
      if (cached) return cached;
      const data = await base44.entities.Playlist.filter({ creator_id: user.id }, '-created_date', 50);
      setCache(cacheKey, data, TTL_5MIN);
      setCachedContent(user.id, 'MY_PLAYLISTS', data);
      return data;
    },
    initialData: () => {
      if (!user) return undefined;
      const cached = getCachedContent(user.id, 'MY_PLAYLISTS');
      return cached || getCache(`my-playlists-${user.id}`) || undefined;
    }
  });

  // Liked playlist IDs
  const { data: likedPlaylistRecords = [] } = useQuery({
    queryKey: ['liked-playlists', user?.id],
    enabled: !!user && tab === 'playlists',
    queryFn: async () => {
      const cacheKey = `liked-playlists-${user.id}`;
      const cached = getCache(cacheKey);
      if (cached) return cached;
      const data = await base44.entities.PlaylistLike.filter({ user_id: user.id });
      setCache(cacheKey, data, TTL_5MIN);
      setCachedContent(user.id, 'LIKED_PLAYLISTS', data);
      return data;
    },
    initialData: () => {
      if (!user) return undefined;
      const cached = getCachedContent(user.id, 'LIKED_PLAYLISTS');
      return cached || getCache(`liked-playlists-${user.id}`) || undefined;
    }
  });

  const likedPlaylistIds = likedPlaylistRecords.map((r) => r.playlist_id);
  const myPlaylistIds = new Set(myPlaylists.map((p) => p.id));

  // Liked playlists data (excluding ones I own, since they already appear above)
  const { data: likedPlaylists = [] } = useQuery({
    queryKey: ['liked-playlists-data', likedPlaylistIds.join(',')],
    enabled: likedPlaylistIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        likedPlaylistIds.
        filter((id) => !myPlaylistIds.has(id)).
        map((id) => base44.entities.Playlist.filter({ id }).then((r) => r[0]).catch(() => null))
      );
      return results.filter(Boolean);
    }
  });

  // User's recent plays (for sorting)
  const { data: userPlays = [] } = useQuery({
    queryKey: ['user-plays-sort', user?.id],
    enabled: !!user,
    queryFn: () => base44.entities.PodcastPlay.filter({ user_id: user.id }, '-played_at', 500),
  });

  // Map: feed_url -> last played_at
  const feedLastPlayed = {};
  userPlays.forEach(play => {
    if (!feedLastPlayed[play.feed_url] || play.played_at > feedLastPlayed[play.feed_url]) {
      feedLastPlayed[play.feed_url] = play.played_at;
    }
  });

  // Liked podcasts
  const { data: likedPodcasts = [], refetch: refetchPodcasts } = useQuery({
    queryKey: ['liked-podcasts', user?.id],
    enabled: !!user && tab === 'podcasts',
    queryFn: async () => {
      const cacheKey = `liked-podcasts-${user.id}`;
      const cached = getCache(cacheKey);
      if (cached) return cached;
      const data = await base44.entities.PodcastLike.filter({ user_id: user.id }, '-created_date', 100);
      setCache(cacheKey, data, TTL_5MIN);
      setCachedContent(user.id, 'LIKED_PODCASTS', data);
      return data;
    },
    initialData: () => {
      if (!user) return undefined;
      const cached = getCachedContent(user.id, 'LIKED_PODCASTS');
      return cached || getCache(`liked-podcasts-${user.id}`) || undefined;
    }
  });

  const handleUnlikePodcast = async (podcastLike) => {
    await base44.entities.PodcastLike.delete(podcastLike.id);
    refetchPodcasts();
  };

  const handleLikePlaylist = async (playlist) => {
    if (!user) return;
    await base44.functions.invoke('togglePlaylistLike', { playlist_id: playlist.id });
    queryClient.invalidateQueries({ queryKey: ['liked-playlists', user?.id] });
  };

  if (isAuthed === false) {
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
          onClick={() => redirectToLogin(window.location.href)}
          className="px-6 py-3 rounded-2xl gradient-primary text-white font-semibold text-sm glow-primary"
        >
          {t('loginWithGoogle')}
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
                liked={likedPlaylistIds.includes(pl.id)}
                currentUser={user}
                onEdited={refetchMine} />
              
                  </motion.div>
            )}
              </>
          }

            {/* Liked playlists from others */}
            {likedPlaylists.length > 0 &&
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

            {myPlaylists.length === 0 && likedPlaylists.length === 0 &&
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