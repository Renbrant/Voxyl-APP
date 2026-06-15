import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { getCache, setCache, TTL_5MIN } from '@/lib/appCache';
import { motion } from 'framer-motion';
import PlaylistCard from '@/components/playlist/PlaylistCard';
import { Loader2 } from 'lucide-react';

const GRADIENT_COLORS = [
  'from-purple-600 to-cyan-400',
  'from-pink-600 to-purple-600',
  'from-blue-600 to-cyan-400',
  'from-orange-500 to-pink-600',
];

export default function MyPlaylistsContent({ user, likedIds, handleLike, blockedIds, setBlockedIds }) {
  // All public playlists (to find ones the user listened to)
  const { data: allPlaylists = [], isLoading: isLoadingPlaylists } = useQuery({
    queryKey: ['all-playlists-feed'],
    enabled: !!user,
    queryFn: async () => {
      const cached = getCache('all-playlists-feed');
      if (cached) return cached;
      const data = await base44.entities.Playlist.list('-updated_date', 200);
      setCache('all-playlists-feed', data, TTL_5MIN);
      return data;
    },
    initialData: () => getCache('all-playlists-feed') || undefined,
  });

  const { data: userPodcastPlays = [], isLoading: isLoadingPlays } = useQuery({
    queryKey: ['user-podcast-plays', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const cached = getCache(`user-podcast-plays-${user.id}`);
      if (cached) return cached;
      const data = await base44.entities.PodcastPlay.filter({ user_id: user.id }, '-played_at', 100);
      setCache(`user-podcast-plays-${user.id}`, data, TTL_5MIN);
      return data;
    },
    initialData: () => getCache(`user-podcast-plays-${user?.id}`) || undefined,
  });

  // Playlists recently listened to by this user (any creator), sorted by last play
  const sortedMyPlaylists = useMemo(() => {
    if (!allPlaylists.length || !userPodcastPlays.length) return [];

    const playlistLastPlayedMap = new Map();
    userPodcastPlays.forEach(play => {
      const matchingPlaylist = allPlaylists.find(pl =>
        pl.rss_feeds?.some(feed => feed.url === play.feed_url)
      );
      if (matchingPlaylist) {
        const current = playlistLastPlayedMap.get(matchingPlaylist.id);
        if (!current || new Date(play.played_at) > new Date(current)) {
          playlistLastPlayedMap.set(matchingPlaylist.id, play.played_at);
        }
      }
    });

    // Only return playlists the user actually played
    return allPlaylists
      .filter(pl => playlistLastPlayedMap.has(pl.id))
      .sort((a, b) => new Date(playlistLastPlayedMap.get(b.id)) - new Date(playlistLastPlayedMap.get(a.id)));
  }, [allPlaylists, userPodcastPlays]);

  const lastPlayedPodcasts = useMemo(() => {
    const seen = new Set();
    return userPodcastPlays.filter(play => {
      if (seen.has(play.feed_url)) return false;
      seen.add(play.feed_url);
      return true;
    }).slice(0, 8);
  }, [userPodcastPlays]);

  const isLoading = isLoadingPlaylists || isLoadingPlays;

  if (isLoading && !sortedMyPlaylists.length) {
    return (
      <div className="flex flex-col items-center py-12 gap-3 text-muted-foreground">
        <Loader2 size={24} className="animate-spin text-primary" />
        <p className="text-sm">{t('loading')}</p>
      </div>
    );
  }

  if (!isLoading && !sortedMyPlaylists.length && !lastPlayedPodcasts.length) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-4xl mb-3">🎧</p>
        <p className="font-medium">{t('feedNoPlaylists')}</p>
        <p className="text-sm mt-1">{t('feedCreateFirst')}</p>
      </div>
    );
  }

  return (
    <div>
      {sortedMyPlaylists.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-semibold mb-3 text-foreground">Ouvidas recentemente</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {sortedMyPlaylists.map((pl, i) => (
              <motion.div key={pl.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <PlaylistCard
                  playlist={pl}
                  liked={likedIds.includes(pl.id)}
                  onLike={handleLike}
                  currentUser={user}
                  onBlocked={id => setBlockedIds(prev => [...prev, id])}
                />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {lastPlayedPodcasts.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-semibold mb-3 text-foreground">
            {t('feedLastPlayedPodcasts')}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {lastPlayedPodcasts.map((play, i) => {
              const gradient = GRADIENT_COLORS[play.feed_url?.charCodeAt(0) % GRADIENT_COLORS.length];
              return (
                <Link to={`/podcast/${encodeURIComponent(play.feed_url)}`} key={play.feed_url}>
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex flex-col gap-2 p-2 rounded-2xl border border-border bg-card hover:border-primary/30 transition-all active:scale-95 h-full"
                  >
                    <div className="w-full aspect-square rounded-lg overflow-hidden bg-secondary flex-shrink-0">
                      {play.podcast_image
                        ? <img src={play.podcast_image} alt="" className="w-full h-full object-cover" />
                        : <div className={cn("w-full h-full bg-gradient-to-br", gradient)} />
                      }
                    </div>
                    <div className="min-w-0 px-1 pb-1">
                      <p className="text-xs font-medium line-clamp-2 text-foreground">{play.podcast_title}</p>
                    </div>
                  </motion.div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}