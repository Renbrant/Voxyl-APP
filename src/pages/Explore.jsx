import { useState, useRef, useEffect } from 'react';
import { t } from '@/lib/i18n';
import { voxylApi } from '@/api/voxylApiClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import VoxylHeader from '@/components/common/VoxylHeader';
import PlaylistCard from '@/components/playlist/PlaylistCard';
import PodcastSearchBar from '@/components/explore/PodcastSearchBar';
import PodcastResultCard from '@/components/explore/PodcastResultCard';
import AddToPlaylistModal from '@/components/explore/AddToPlaylistModal';
import UserSearchCard from '@/components/explore/UserSearchCard';
import SelectBottomSheet from '@/components/common/SelectBottomSheet';
import PullToRefreshIndicator from '@/components/common/PullToRefreshIndicator';
import { Compass, Radio, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useDebounce } from '@/hooks/useDebounce';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

export default function Explore() {
  const location = useLocation();
  const navigate = useNavigate();

  // Read initial state from URL query params (restored when navigating back)
  const params = new URLSearchParams(location.search);
  const [tab, setTab] = useState(params.get('tab') || 'playlists');
  const [user, setUser] = useState(null);
  const [search, setSearch] = useState(params.get('q') || '');
  const [podcastResults, setPodcastResults] = useState([]);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [selectedPodcast, setSelectedPodcast] = useState(null);
  const [voxylSearch, setVoxylSearch] = useState(params.get('vq') || '');
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState('connections');
  const [likes, setLikes] = useState([]);
  const [blockedIds, setBlockedIds] = useState([]);
  const [followStatuses, setFollowStatuses] = useState({});
  const [theyFollowMeIds, setTheyFollowMeIds] = useState(new Set());
  const [podcastSortBy, setPodcastSortBy] = useState(params.get('sort') || 'relevance');
  const [podcastLanguage, setPodcastLanguage] = useState(params.get('lang') || '');
  const [podcastCategory, setPodcastCategory] = useState(params.get('cat') || '');
  const [likedFeedUrls, setLikedFeedUrls] = useState(new Set());

  // Sync state to URL so it survives navigation
  useEffect(() => {
    const p = new URLSearchParams();
    if (tab !== 'playlists') p.set('tab', tab);
    if (search) p.set('q', search);
    if (voxylSearch) p.set('vq', voxylSearch);
    if (podcastSortBy !== 'relevance') p.set('sort', podcastSortBy);
    if (podcastLanguage) p.set('lang', podcastLanguage);
    if (podcastCategory) p.set('cat', podcastCategory);
    const qs = p.toString();
    const newUrl = qs ? `/explore?${qs}` : '/explore';
    // Replace state to keep back button pointing to previous page (not previous search state)
    window.history.replaceState(null, '', newUrl);
  }, [tab, search, voxylSearch, podcastSortBy, podcastLanguage, podcastCategory]);

  const debouncedQuery = useDebounce(search, 600);
  const debouncedUserSearch = useDebounce(userSearch, 400);
  const containerRef = useRef(null);
  const queryClient = useQueryClient();

  const { pullProgress, refreshing } = usePullToRefresh(() => {
    queryClient.invalidateQueries({ queryKey: ['explore-playlists'] });
    queryClient.invalidateQueries({ queryKey: ['my-likes'] });
  }, containerRef);

  useEffect(() => {
    voxylApi.auth.me().then(u => {
      setUser(u);
      voxylApi.entities.PodcastLike.filter({ user_id: u.id })
        .then(likes => setLikedFeedUrls(new Set(likes.map(l => l.feed_url))))
        .catch(() => {});
      Promise.all([
        voxylApi.entities.Block.filter({ blocker_id: u.id }),
        voxylApi.entities.Block.filter({ blocked_id: u.id }),
      ]).then(([myBlocks, theirBlocks]) => {
        const ids = [
          ...myBlocks.map(b => b.blocked_id),
          ...theirBlocks.map(b => b.blocker_id),
        ];
        setBlockedIds([...new Set(ids)]);
      }).catch(() => {});
      voxylApi.entities.Follow.filter({ follower_id: u.id })
        .then(follows => {
          const map = {};
          follows.forEach(f => { map[f.following_id] = f.status; });
          setFollowStatuses(map);
        })
        .catch(() => {});
      voxylApi.entities.Follow.filter({ following_id: u.id, status: 'accepted' })
        .then(follows => {
          setTheyFollowMeIds(new Set(follows.map(f => f.follower_id)));
        })
        .catch(() => {});
    }).catch(() => {});
  }, []);

  useQuery({
    queryKey: ['my-likes', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const l = await voxylApi.entities.PlaylistLike.filter({ user_id: user.id });
      setLikes(l.map(x => x.playlist_id));
      return l;
    },
  });

  const handleLike = async (playlist) => {
    if (!user) return;
    const liked = likes.includes(playlist.id);
    setLikes(prev => liked ? prev.filter(id => id !== playlist.id) : [...prev, playlist.id]);
    try {
      await voxylApi.functions.invoke('togglePlaylistLike', { playlist_id: playlist.id });
    } catch {
      // Revert optimistic update on failure
      setLikes(prev => liked ? [...prev, playlist.id] : prev.filter(id => id !== playlist.id));
    }
  };

  // Fetch Voxyl playlists ordered by last week's plays across all users
  const { data: playlists = [], isLoading: playlistsLoading } = useQuery({
    queryKey: ['explore-playlists'],
    queryFn: async () => {
      const res = await voxylApi.functions.invoke('getTopPlaylistsByPlayback', {});
      return res.data?.playlists || [];
    },
  });

  // Followers: users who follow me (accepted)
  const { data: followersList = [] } = useQuery({
    queryKey: ['explore-followers', user?.id],
    enabled: !!user && tab === 'users',
    queryFn: () => voxylApi.entities.Follow.filter({ following_id: user.id, status: 'accepted' }),
  });

  // Following: users I follow (accepted) - enrich with user profiles to get username
  const { data: followingList = [] } = useQuery({
    queryKey: ['explore-following', user?.id],
    enabled: !!user && tab === 'users',
    queryFn: async () => {
      const follows = await voxylApi.entities.Follow.filter({ follower_id: user.id, status: 'accepted' });
      // Fetch usernames from searchUsers for enrichment
      const profiles = await voxylApi.functions.invoke('searchUsers', { query: '' }).then(r => r.data?.users || []).catch(() => []);
      const profileMap = {};
      profiles.forEach(p => { profileMap[p.id] = p; });
      return follows.map(f => ({ ...f, _profile: profileMap[f.following_id] || null }));
    },
  });

  // Pending: requests I sent that are still pending - enrich with user profiles
  const { data: pendingList = [] } = useQuery({
    queryKey: ['explore-pending', user?.id],
    enabled: !!user && tab === 'users',
    queryFn: async () => {
      const follows = await voxylApi.entities.Follow.filter({ follower_id: user.id, status: 'pending' });
      const profiles = await voxylApi.functions.invoke('searchUsers', { query: '' }).then(r => r.data?.users || []).catch(() => []);
      const profileMap = {};
      profiles.forEach(p => { profileMap[p.id] = p; });
      return follows.map(f => ({ ...f, _profile: profileMap[f.following_id] || null }));
    },
  });

  // Search by exact username (only when query typed)
  const { data: searchedUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['explore-users', debouncedUserSearch],
    enabled: tab === 'users' && debouncedUserSearch.trim().length > 0,
    queryFn: () => voxylApi.functions.invoke('searchUsers', { query: debouncedUserSearch }).then(r => r.data?.users || []),
  });

  const handleLikePodcast = async (podcast) => {
    if (!user) return;
    if (likedFeedUrls.has(podcast.feedUrl)) {
      const records = await voxylApi.entities.PodcastLike.filter({ user_id: user.id, feed_url: podcast.feedUrl });
      if (records[0]) await voxylApi.entities.PodcastLike.delete(records[0].id);
      setLikedFeedUrls(prev => { const s = new Set(prev); s.delete(podcast.feedUrl); return s; });
    } else {
      await voxylApi.entities.PodcastLike.create({
        user_id: user.id,
        user_email: user.email,
        feed_url: podcast.feedUrl,
        podcast_title: podcast.title,
        podcast_author: podcast.author || '',
        podcast_image: podcast.image || '',
        podcast_description: podcast.description || '',
      });
      setLikedFeedUrls(prev => new Set([...prev, podcast.feedUrl]));
    }
  };

  // Podcast Index search
  useEffect(() => {
    if (tab !== 'podcasts') return;
    if (!debouncedQuery.trim()) { setPodcastResults([]); return; }
    setPodcastLoading(true);
    const maxDuration = user?.max_duration || 0;
    voxylApi.functions.invoke('searchPodcasts', { 
      query: debouncedQuery, 
      maxDuration,
      language: podcastLanguage,
      sortBy: podcastSortBy,
      category: podcastCategory,
    })
      .then(res => {
        setPodcastResults(res.data?.results || []);
        setPodcastLoading(false);
      })
      .catch(() => setPodcastLoading(false));
  }, [debouncedQuery, tab, user, podcastLanguage, podcastSortBy, podcastCategory]);

  const filteredPlaylists = playlists
    .filter(p => {
      if (blockedIds.includes(p.creator_id)) return false;
      if (p.visibility === 'private') return false;
      if (p.visibility === 'friends_only' && !(user && followStatuses[p.creator_id] === 'accepted')) return false;
      return !voxylSearch ||
        p.name?.toLowerCase().includes(voxylSearch.toLowerCase()) ||
        p.description?.toLowerCase().includes(voxylSearch.toLowerCase()) ||
        p.creator_name?.toLowerCase().includes(voxylSearch.toLowerCase());
    })
    .sort((a, b) => (b.plays_count || 0) - (a.plays_count || 0));

  // Build user list based on active filter
  const filteredUsers = (() => {
    const q = debouncedUserSearch.trim().toLowerCase();

    if (q) {
      // Exact username match only
      return searchedUsers.filter(u => u.username && u.username.toLowerCase() === q);
    }

    if (userFilter === 'connections') {
      const followers = followersList.map(f => ({
        id: f.follower_id,
        username: f.follower_username,
        full_name: f.follower_name,
        type: 'follower',
      }));
      const following = followingList.map(f => ({
        id: f.following_id,
        username: f._profile?.username || f.following_username || null,
        full_name: f._profile?.full_name || f.following_name || '',
        type: 'following',
      }));
      return [...followers, ...following];
    }
    if (userFilter === 'pending') {
      return pendingList.map(f => ({
        id: f.following_id,
        username: f._profile?.username || f.following_username || null,
        full_name: f._profile?.full_name || f.following_name || '',
        type: 'pending',
      }));
    }

    return [];
  })();

  const TABS = [
    { key: 'playlists', label: t('explorePlaylists'), icon: Compass },
    { key: 'podcasts', label: t('explorePodcasts'), icon: Radio },
    { key: 'users', label: t('exploreUsers'), icon: Users },
  ];

  const sortOptions = [
    { value: 'relevance', label: t('exploreSortRelevance') },
    { value: 'popularity', label: t('exploreSortPopular') },
    { value: 'episodes', label: t('exploreSortEpisodes') },
    { value: 'recent', label: t('exploreSortRecent') },
    { value: 'frequency', label: t('exploreSortFrequent') },
  ];

  const languageOptions = [
    { value: '', label: t('exploreAllLanguages') },
    { value: 'pt', label: '🇧🇷 Português' },
    { value: 'en', label: '🇺🇸 English' },
    { value: 'es', label: '🇪🇸 Español' },
    { value: 'fr', label: '🇫🇷 Français' },
    { value: 'de', label: '🇩🇪 Deutsch' },
    { value: 'it', label: '🇮🇹 Italiano' },
    { value: 'ja', label: '🇯🇵 日本語' },
  ];

  const categoryOptions = [
    { value: '', label: t('exploreAllCategories') },
    { value: 'technology', label: t('exploreCatTech') },
    { value: 'business', label: t('exploreCatBusiness') },
    { value: 'education', label: t('exploreCatEducation') },
    { value: 'entertainment', label: t('exploreCatEntertainment') },
    { value: 'sports', label: t('exploreCatSports') },
    { value: 'health', label: t('exploreCatHealth') },
    { value: 'news', label: t('exploreCatNews') },
    { value: 'science', label: t('exploreCatScience') },
    { value: 'history', label: t('exploreCatHistory') },
    { value: 'true crime', label: t('exploreCatCrime') },
    { value: 'comedy', label: t('exploreCatComedy') },
    { value: 'politics', label: t('exploreCatPolitics') },
  ];

  return (
    <div ref={containerRef} className="bg-background pb-24 relative">
      <PullToRefreshIndicator pullProgress={pullProgress} refreshing={refreshing} />
      <VoxylHeader title={t('exploreTitle')} subtitle={t('exploreSubtitle')} />

      {/* Tabs */}
      <div className="flex gap-2 px-4 justify-center">
        {TABS.map(({ key, label, icon: TabIcon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all flex-shrink-0",
              tab === key
                ? "gradient-primary text-white glow-primary"
                : "bg-secondary text-muted-foreground"
            )}
          >
            <TabIcon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Search bar and filters */}
      <div className="px-4 mb-4 mt-3">
        {tab === 'playlists' && <PodcastSearchBar value={voxylSearch} onChange={setVoxylSearch} loading={false} placeholder={t('exploreSearchPlaylists')} />}
        {tab === 'podcasts' && (
          <div className="space-y-3">
            <PodcastSearchBar value={search} onChange={setSearch} loading={podcastLoading} placeholder={t('exploreSearchPodcasts')} />
            <div className="flex gap-2 flex-wrap">
              <SelectBottomSheet
                value={podcastSortBy}
                onChange={setPodcastSortBy}
                options={sortOptions}
                placeholder="Ordenar"
              />
              <SelectBottomSheet
                value={podcastLanguage}
                onChange={setPodcastLanguage}
                options={languageOptions}
                placeholder="Idioma"
                activeColor="primary"
              />
              <SelectBottomSheet
                value={podcastCategory}
                onChange={setPodcastCategory}
                options={categoryOptions}
                placeholder="Categoria"
                activeColor="accent"
              />
            </div>
          </div>
        )}
        {tab === 'users' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              {[
                { key: 'connections', label: t('exploreConnections') },
                { key: 'pending', label: t('explorePending') },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setUserFilter(key)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium transition-all flex-shrink-0',
                    userFilter === key ? 'gradient-primary text-white' : 'bg-secondary text-muted-foreground'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-4">
        {/* Playlists tab */}
        {tab === 'playlists' && (
          playlistsLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-secondary animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredPlaylists.map((pl, i) => (
                <motion.div key={pl.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <PlaylistCard playlist={pl} compact liked={likes.includes(pl.id)} onLike={handleLike} currentUser={user} onBlocked={id => setBlockedIds(prev => [...prev, id])} />
                </motion.div>
              ))}
              {filteredPlaylists.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">
                  <p className="text-4xl mb-3">🔍</p>
                  <p>{t('noResults')}</p>
                </div>
              )}
            </div>
          )
        )}

        {/* Users tab */}
        {tab === 'users' && (
          usersLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-2xl bg-secondary animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredUsers.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <p className="text-4xl mb-3">👤</p>
                  <p className="text-sm">
                    {userFilter === 'connections' ? t('exploreNoConnections') : t('exploreNoPending')}
                  </p>
                </div>
              ) : userFilter === 'connections' ? (
                <>
                  {followersList.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground mb-2">👥 {t('exploreFollowers')} ({followersList.length})</h3>
                      <div className="space-y-2">
                        {followersList.map((f, i) => (
                          <UserSearchCard
                            key={f.follower_id}
                            user={{
                              id: f.follower_id,
                              username: f.follower_username,
                              full_name: f.follower_name,
                            }}
                            index={i}
                            currentUser={user}
                            followStatus={followStatuses[f.follower_id] || null}
                            theyFollowMe={theyFollowMeIds.has(f.follower_id)}
                            onStatusChange={(status) =>
                              setFollowStatuses(prev => ({ ...prev, [f.follower_id]: status }))
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {followingList.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground mb-2">➡️ {t('exploreFollowing')} ({followingList.length})</h3>
                      <div className="space-y-2">
                        {followingList.map((f, i) => (
                          <UserSearchCard
                            key={f.following_id}
                            user={{
                               id: f.following_id,
                               username: f._profile?.username || f.following_username || null,
                               full_name: f._profile?.full_name || f.following_name || '',
                             }}
                            index={i}
                            currentUser={user}
                            followStatus={followStatuses[f.following_id] || null}
                            theyFollowMe={theyFollowMeIds.has(f.following_id)}
                            onStatusChange={(status) =>
                              setFollowStatuses(prev => ({ ...prev, [f.following_id]: status }))
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  {pendingList.map((f, i) => (
                    <UserSearchCard
                      key={f.following_id}
                      user={{
                         id: f.following_id,
                         username: f._profile?.username || f.following_username || null,
                         full_name: f._profile?.full_name || f.following_name || '',
                       }}
                      index={i}
                      currentUser={user}
                      followStatus={followStatuses[f.following_id] || null}
                      theyFollowMe={theyFollowMeIds.has(f.following_id)}
                      onStatusChange={(status) =>
                        setFollowStatuses(prev => ({ ...prev, [f.following_id]: status }))
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {/* Podcasts tab */}
        {tab === 'podcasts' && (
          <div className="space-y-2">
            {!search.trim() && !podcastLoading && podcastResults.length === 0 && (
              <div className="py-6 text-muted-foreground">
                <div className="text-center mb-6">
                  <p className="text-5xl mb-3">🎙️</p>
                  <p className="font-semibold text-foreground text-base">{t('exploreDiscover')}</p>
                  <p className="text-xs mt-1 text-muted-foreground">{t('exploreSearchHint')}</p>
                </div>
                <p className="text-xs text-muted-foreground mb-2 px-1">{t('exploreSuggestions')}</p>
                <div className="flex flex-wrap gap-2">
                  {(t('exploreSuggestions') === 'Popular suggestions'
                    ? ['technology', 'news', 'health', 'business', 'history', 'sports', 'science', 'comedy', 'politics', 'education', 'entertainment', 'christianity']
                    : ['tecnologia', 'notícias', 'saúde', 'negócios', 'história', 'esportes', 'ciência', 'comédia', 'política', 'educação', 'entretenimento', 'cristianismo']
                  ).map(s => (
                    <button
                      key={s}
                      onClick={() => setSearch(s)}
                      className="px-3 py-1.5 rounded-full text-xs bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-all capitalize"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {podcastLoading && (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-secondary animate-pulse" />)}
              </div>
            )}
            {!podcastLoading && podcastResults.map((podcast, i) => (
              <PodcastResultCard
                key={podcast.id}
                podcast={podcast}
                index={i}
                onAdd={setSelectedPodcast}
                onLike={handleLikePodcast}
                liked={likedFeedUrls.has(podcast.feedUrl)}
              />
            ))}
            {!podcastLoading && search.trim() && podcastResults.length === 0 && (
              <div className="text-center py-16 text-muted-foreground">
                <p className="text-4xl mb-3">🔍</p>
                <p>{t('exploreNoFound')} "{search}"</p>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedPodcast && (
        <AddToPlaylistModal
          podcast={selectedPodcast}
          onClose={() => setSelectedPodcast(null)}
        />
      )}
    </div>
  );
}