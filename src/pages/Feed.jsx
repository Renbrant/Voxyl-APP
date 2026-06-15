import { useState, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import VoxylHeader from '@/components/common/VoxylHeader';
import PlaylistCard from '@/components/playlist/PlaylistCard';
import PullToRefreshIndicator from '@/components/common/PullToRefreshIndicator';
import MyPlaylistsContent from '@/components/feed/MyPlaylistsContent';
import { Flame, Sparkles, Play, User } from 'lucide-react';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { getCache, setCache, invalidateCache, TTL_5MIN } from '@/lib/appCache';
import { t } from '@/lib/i18n';
import { asArray } from '@/lib/arrayUtils';

export default function Feed() {
  const [user, setUser] = useState(null);
  const [likes, setLikes] = useState([]);
  const [blockedIds, setBlockedIds] = useState([]);
  const [followingIds, setFollowingIds] = useState(new Set());
  const [tab, setTab] = useState('trending');
  const [expandedPlaylists, setExpandedPlaylists] = useState(false);
  const [expandedPodcasts, setExpandedPodcasts] = useState(false);
  const { requireAuth } = useRequireAuth();
  const containerRef = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setTab('my-playlists'); // default to personal tab if logged in
      Promise.all([
        base44.entities.Block.filter({ blocker_id: u.id }),
        base44.entities.Block.filter({ blocked_id: u.id }),
      ]).then(([myBlocks, theirBlocks]) => {
        const ids = [
          ...asArray(myBlocks).map(b => b.blocked_id),
          ...asArray(theirBlocks).map(b => b.blocker_id),
        ];
        setBlockedIds([...new Set(ids)]);
      }).catch(() => {});
      base44.entities.Follow.filter({ follower_id: u.id, status: 'accepted' })
        .then(follows => setFollowingIds(new Set(asArray(follows).map(f => f.following_id))))
        .catch(() => {});
    }).catch(() => {}); // guest mode — user stays null
  }, []);

  const { pullProgress, refreshing } = usePullToRefresh(() => {
    invalidateCache('feed-playlists');
    invalidateCache('all-playlists-feed');
    invalidateCache(`my-likes-${user?.id}`);
    invalidateCache(`my-playlists-${user?.id}`);
    invalidateCache(`user-podcast-plays-${user?.id}`);
    queryClient.invalidateQueries({ queryKey: ['feed-playlists'] });
    queryClient.invalidateQueries({ queryKey: ['my-likes'] });
    queryClient.invalidateQueries({ queryKey: ['top-podcasts'] });
    queryClient.invalidateQueries({ queryKey: ['my-playlists'] });
    queryClient.invalidateQueries({ queryKey: ['all-playlists-feed'] });
    queryClient.invalidateQueries({ queryKey: ['user-podcast-plays'] });
  }, containerRef);

  const { data: playlists = [], isLoading } = useQuery({
    queryKey: ['feed-playlists'],
    queryFn: async () => {
      const cached = getCache('feed-playlists');
      if (Array.isArray(cached)) return cached;
      const data = asArray(await base44.entities.Playlist.list('-plays_count', 100));
      setCache('feed-playlists', data, TTL_5MIN);
      return data;
    },
    initialData: () => getCache('feed-playlists') || undefined,
  });

  const { data: likedIds = [] } = useQuery({
    queryKey: ['my-likes', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const cacheKey = `my-likes-${user.id}`;
      const cached = getCache(cacheKey);
      if (cached) { setLikes(cached); return cached; }
      const l = asArray(await base44.entities.PlaylistLike.filter({ user_id: user.id }));
      const ids = l.map(x => x.playlist_id);
      setLikes(ids);
      setCache(cacheKey, ids, TTL_5MIN);
      return ids;
    },
    initialData: () => {
      const cached = user ? getCache(`my-likes-${user.id}`) : null;
      if (cached) { setLikes(cached); return cached; }
      return undefined;
    },
  });

  const { data: topPodcasts = [] } = useQuery({
    queryKey: ['top-podcasts'],
    queryFn: async () => {
      try {
        const res = await base44.functions.invoke('getTopPodcastsByPlayback', {});
        if (Array.isArray(res.data)) return res.data;
        if (Array.isArray(res.data?.podcasts)) return res.data.podcasts;
        return Array.isArray(res.data) ? res.data : [];
      } catch (err) {
        return [];
      }
    },
  });

  const handleLike = requireAuth(async (playlist) => {
    const liked = likes.includes(playlist.id);
    setLikes(prev => liked ? prev.filter(id => id !== playlist.id) : [...prev, playlist.id]);
    try {
      await base44.functions.invoke('togglePlaylistLike', { playlist_id: playlist.id });
    } catch {
      // Revert optimistic update on failure
      setLikes(prev => liked ? [...prev, playlist.id] : prev.filter(id => id !== playlist.id));
    }
  });

  const visiblePlaylists = asArray(playlists).filter(p => {
    if (blockedIds.includes(p.creator_id)) return false;
    if (!p.visibility || p.visibility === 'public') return true;
    if (p.visibility === 'friends_only') return user && followingIds.has(p.creator_id);
    return false;
  });

  const sortedPlaylists = tab === 'trending'
    ? [...visiblePlaylists].sort((a, b) => (b.plays_count || 0) - (a.plays_count || 0))
    : [...visiblePlaylists].sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0));

  // Recent tab: newest playlists with > 5 plays
  const recentPlaylists = useMemo(() =>
    [...visiblePlaylists]
      .filter(p => (p.plays_count || 0) > 5)
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
      .slice(0, 10),
    [visiblePlaylists]
  );

  const heroPlaylist = sortedPlaylists[0];
  const trendingPlaylists = sortedPlaylists.slice(1);
  const displayedTrendingPlaylists = expandedPlaylists ? trendingPlaylists : trendingPlaylists.slice(0, 8);
  const safePodcasts = Array.isArray(topPodcasts) ? topPodcasts : [];
  const displayedPodcasts = expandedPodcasts ? safePodcasts : safePodcasts.slice(0, 8);

  const firstName = user?.full_name?.split(' ')[0] || user?.username || 'Eu';

  return (
    <div ref={containerRef} className="bg-background relative">
      <PullToRefreshIndicator pullProgress={pullProgress} refreshing={refreshing} />
      <VoxylHeader
        subtitle={t('feedSubtitle')}
        title={<span className="text-gradient font-grotesk">Voxyl</span>}
      />

      {/* Tabs */}
      <div className="flex gap-2 px-4 mb-4 overflow-x-auto no-scrollbar">
        {user && (
          <button
            onClick={() => setTab('my-playlists')}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0",
              tab === 'my-playlists'
                ? "gradient-primary text-white glow-primary"
                : "bg-secondary text-muted-foreground"
            )}
          >
            <User size={14} />
            {firstName}
          </button>
        )}
        {[
          { key: 'trending', label: t('feedTrending'), icon: Flame },
          { key: 'recent', label: t('feedRecent'), icon: Sparkles },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap flex-shrink-0",
              tab === key
                ? "gradient-primary text-white glow-primary"
                : "bg-secondary text-muted-foreground"
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Content Grid */}
      <div className="px-4 pb-24">

        {/* My Playlists Tab */}
        {tab === 'my-playlists' && user && (
          <MyPlaylistsContent
            user={user}
            likedIds={likedIds}
            handleLike={handleLike}
            blockedIds={blockedIds}
            setBlockedIds={setBlockedIds}
          />
        )}

        {/* Trending / Recent Tabs */}
        {tab !== 'my-playlists' && (
          <>
            {/* Recent: newest playlists with >5 plays */}
            {tab === 'recent' && recentPlaylists.length > 0 && (
              <div className="mb-8">
                <h2 className="text-base font-semibold mb-3 text-foreground">Adicionadas recentemente</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                  {recentPlaylists.map((pl, i) => (
                    <motion.div key={pl.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                      <PlaylistCard playlist={pl} liked={likes.includes(pl.id)} onLike={handleLike} currentUser={user} onBlocked={id => setBlockedIds(prev => [...prev, id])} />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Playlists em Alta */}
            {!isLoading && heroPlaylist && (
              <div className="mb-8">
                <h2 className="text-base font-semibold mb-3 text-foreground">{t('feedPlaylistsHot')}</h2>

                {/* Hero Playlist */}
                <Link to={`/playlist/${heroPlaylist.id}`}>
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-4 relative rounded-3xl overflow-hidden h-48 md:h-64 bg-gradient-to-br from-purple-800 via-primary/60 to-cyan-600">
                    {heroPlaylist.cover_image && (
                      <img src={heroPlaylist.cover_image} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    )}
                    <div className="absolute inset-0 bg-black/40" />
                    <div className="absolute bottom-0 left-0 right-0 p-4 flex items-end justify-between">
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="text-xs text-white/70 mb-0.5 font-medium">{t('feedMostPlayed')}</p>
                        <h2 className="text-xl font-grotesk font-bold text-white truncate">{heroPlaylist.name}</h2>
                        <p className="text-sm text-white/70 truncate">{t('detailBy')} {heroPlaylist.creator_username ? `@${heroPlaylist.creator_username}` : t('detailUser')} • {heroPlaylist.plays_count || 0} {t('feedPlays')}</p>
                      </div>
                      <div className="w-12 h-12 rounded-full gradient-primary flex items-center justify-center glow-primary flex-shrink-0">
                        <Play size={20} fill="white" className="text-white ml-0.5" />
                      </div>
                    </div>
                  </motion.div>
                </Link>

                {/* Grid de Playlists (8 cards) */}
                {trendingPlaylists.length > 0 && (
                  <div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 mb-3">
                      {displayedTrendingPlaylists.map((pl, i) => (
                        <motion.div key={pl.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                          <PlaylistCard playlist={pl} liked={likes.includes(pl.id)} onLike={handleLike} currentUser={user} onBlocked={id => setBlockedIds(prev => [...prev, id])} />
                        </motion.div>
                      ))}
                    </div>

                    {trendingPlaylists.length > 8 && (
                      <motion.button
                        onClick={() => setExpandedPlaylists(!expandedPlaylists)}
                        className="w-full py-3 rounded-2xl bg-secondary hover:bg-secondary/80 text-foreground font-medium transition-colors text-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                      >
                        {expandedPlaylists ? t('feedSeeLess') : t('feedSeeMore')}
                      </motion.button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Podcasts em Alta */}
            {safePodcasts.length > 0 && (
              <div>
                <h2 className="text-base font-semibold mb-3 text-foreground">{t('feedPodcastsHot')}</h2>

                {safePodcasts[0] && (
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-4 relative rounded-3xl overflow-hidden h-48 md:h-64 bg-gradient-to-br from-purple-800 via-primary/60 to-cyan-600">
                    {safePodcasts[0].image && (
                      <img src={safePodcasts[0].image} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    )}
                    <div className="absolute inset-0 bg-black/40" />
                    <div className="absolute bottom-0 left-0 right-0 p-4 flex items-end justify-between">
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="text-xs text-white/70 mb-0.5 font-medium">{t('feedMostPlayedPodcast')}</p>
                        <h2 className="text-xl font-grotesk font-bold text-white truncate">{safePodcasts[0].title}</h2>
                        <p className="text-sm text-white/70 truncate">{safePodcasts[0].playCount || 0} {t('feedRepros')}</p>
                      </div>
                      <div className="w-12 h-12 rounded-full gradient-primary flex items-center justify-center glow-primary flex-shrink-0">
                        <Play size={20} fill="white" className="text-white ml-0.5" />
                      </div>
                    </div>
                  </motion.div>
                )}

                <div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 mb-3">
                    {displayedPodcasts.slice(1, 9).map((podcast, i) => (
                      <motion.div key={podcast.feedUrl} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                        <div className="flex flex-col gap-2 p-2 rounded-2xl border border-border bg-card hover:border-primary/30 transition-all active:scale-95 h-full">
                          <div className="w-full aspect-square rounded-lg overflow-hidden bg-secondary flex-shrink-0">
                            {podcast.image && (
                              <img src={podcast.image} alt="" className="w-full h-full object-cover" />
                            )}
                          </div>
                          <div className="min-w-0 px-1 flex-1">
                            <p className="text-xs font-medium line-clamp-2 text-foreground">{podcast.title}</p>
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{podcast.author || 'Podcast'}</p>
                            <p className="text-xs text-muted-foreground mt-1">{podcast.playCount || 0} ▶</p>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  {safePodcasts.length > 9 && (
                    <motion.button
                      onClick={() => setExpandedPodcasts(!expandedPodcasts)}
                      className="w-full py-3 rounded-2xl bg-secondary hover:bg-secondary/80 text-foreground font-medium transition-colors text-sm"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      {expandedPodcasts ? t('feedSeeLess') : t('feedSeeMore')}
                    </motion.button>
                  )}
                </div>
              </div>
            )}

            {!isLoading && sortedPlaylists.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <p className="text-4xl mb-3">🎧</p>
                <p className="font-medium">{t('feedNoPlaylists')}</p>
                <p className="text-sm mt-1">{t('feedCreateFirst')}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}