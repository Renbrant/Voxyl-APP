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

import SelectBottomSheet from '@/components/common/SelectBottomSheet';
import PullToRefreshIndicator from '@/components/common/PullToRefreshIndicator';
import { Compass, Radio, RefreshCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useDebounce } from '@/hooks/useDebounce';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { getPodcastSearchErrorMessage } from '@/lib/podcastSearchErrors';
import { resolveExploreTab } from '@/lib/discoverTabs';
import { getCache, setCache, TTL_5MIN } from '@/lib/appCache';
import {
  handlePodcastLikeMutationSuccess,
  loadPlaylistLikeRecords,
  loadPodcastLikeRecords,
  normalizePodcastFeedUrl,
  podcastFeedUrlSet,
  playlistLikeIds,
  refreshPlaylistLikeQuery,
  refreshPodcastLikeQuery,
  savedContentQueryKeys,
  togglePlaylistLikeOptimistically,
} from '@/lib/savedContentQueries';

export default function Explore() {
  const location = useLocation();
  const navigate = useNavigate();

  // Read initial state from URL query params (restored when navigating back)
  const params = new URLSearchParams(location.search);
  const [tab, setTab] = useState(resolveExploreTab(params.get('tab')));
  const [user, setUser] = useState(null);
  const [search, setSearch] = useState(params.get('q') || '');
  const [podcastResults, setPodcastResults] = useState([]);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastError, setPodcastError] = useState('');
  const [podcastSearchNonce, setPodcastSearchNonce] = useState(0);
  const [selectedPodcast, setSelectedPodcast] = useState(null);
  const [voxylSearch, setVoxylSearch] = useState(params.get('vq') || '');


  const [blockedIds, setBlockedIds] = useState([]);
  const [authResolved, setAuthResolved] = useState(false);
  const [hiddenUsersReady, setHiddenUsersReady] = useState(false);
  const [hiddenUsersLoading, setHiddenUsersLoading] = useState(false);
  const [hiddenUsersError, setHiddenUsersError] = useState('');
  const [followStatuses, setFollowStatuses] = useState({});

  const [podcastSortBy, setPodcastSortBy] = useState(params.get('sort') || 'relevance');
  const [podcastLanguage, setPodcastLanguage] = useState(params.get('lang') || '');
  const [podcastCategory, setPodcastCategory] = useState(params.get('cat') || '');

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
    const newUrl = qs ? '/discover?' + qs : '/discover';
    // Replace state to keep back button pointing to previous page (not previous search state)
    window.history.replaceState(null, '', newUrl);
    console.log('[Explore] Current tab:', tab);
  }, [tab, search, voxylSearch, podcastSortBy, podcastLanguage, podcastCategory]);

  const debouncedQuery = useDebounce(search, 600);

  const containerRef = useRef(null);
  const queryClient = useQueryClient();

  const loadHiddenUsers = async (u) => {
    if (!u?.id) return;
    const cacheKey = `hidden-users-${u.id}`;
    setHiddenUsersLoading(true);
    setHiddenUsersError('');
    try {
      const hiddenIds = await voxylApi.blocks.hiddenUserIds();
      const ids = [...new Set(Array.isArray(hiddenIds) ? hiddenIds : [])];
      setBlockedIds(ids);
      setCache(cacheKey, ids, TTL_5MIN);
      setHiddenUsersReady(true);
    } catch (error) {
      console.error('[Explore] Failed to load hidden users', { error });
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

  const { pullProgress, refreshing } = usePullToRefresh(() => {
    queryClient.invalidateQueries({ queryKey: ['explore-playlists'] });
    if (user?.id) {
      loadHiddenUsers(user);
      refreshPlaylistLikeQuery(queryClient, user.id);
      refreshPodcastLikeQuery(queryClient, user.id);
    }
  }, containerRef);

  useEffect(() => {
    voxylApi.auth.me().then(u => {
      setUser(u);
      setAuthResolved(true);
      loadHiddenUsers(u);
      voxylApi.entities.Follow.filter({ follower_id: u.id })
        .then(follows => {
          const map = {};
          follows.forEach(f => { map[f.following_id] = f.status; });
          setFollowStatuses(map);
        })
        .catch(error => console.error('[Explore] Failed to load outgoing follows', { userId: u.id, error }));

    }).catch(error => {
      if (error?.status && error.status !== 401) {
        console.error('[Explore] Failed to load current user', { error });
      }
      setAuthResolved(true);
    });
  }, []);

  const {
    data: likedPlaylistRecords = [],
    isLoading: playlistLikesLoading,
    isFetching: playlistLikesFetching,
    isError: playlistLikesError,
    refetch: refetchPlaylistLikes,
  } = useQuery({
    queryKey: savedContentQueryKeys.playlistLikes(user?.id),
    enabled: !!user,
    queryFn: async () => {
      try {
        return await loadPlaylistLikeRecords(user.id);
      } catch (error) {
        console.error('[Explore] Failed to load saved playlist likes', { userId: user.id, error });
        throw error;
      }
    },
  });
  const likedPlaylistIds = playlistLikeIds(likedPlaylistRecords);

  const {
    data: likedPodcastRecords = [],
    isLoading: podcastLikesLoading,
    isFetching: podcastLikesFetching,
    isError: podcastLikesError,
    refetch: refetchPodcastLikes,
  } = useQuery({
    queryKey: savedContentQueryKeys.podcastLikes(user?.id),
    enabled: !!user,
    queryFn: async () => {
      try {
        return await loadPodcastLikeRecords(user.id);
      } catch (error) {
        console.error('[Explore] Failed to load saved podcasts', { userId: user.id, error });
        throw error;
      }
    },
  });
  const likedFeedUrls = podcastFeedUrlSet(likedPodcastRecords);

  const handleLike = async (playlist) => {
    if (!user) return;
    if (playlistLikesLoading || playlistLikesError) {
      if (playlistLikesError) refetchPlaylistLikes();
      return;
    }
    try {
      await togglePlaylistLikeOptimistically({
        queryClient,
        userId: user.id,
        playlistId: playlist.id,
        toggle: () => voxylApi.functions.invoke('togglePlaylistLike', { playlist_id: playlist.id }),
      });
    } catch (error) {
      console.error('[Explore] Failed to toggle playlist like', { playlistId: playlist.id, error });
    }
  };

  // Fetch Voxyl playlists ordered by last week's plays across all users
  const {
    data: playlists = [],
    isLoading: playlistsLoading,
    isFetching: playlistsFetching,
    isError: playlistsError,
    error: playlistsQueryError,
    refetch: refetchPlaylists,
  } = useQuery({
    queryKey: ['explore-playlists'],
    queryFn: async () => {
      const res = await voxylApi.functions.invoke('getTopPlaylistsByPlayback', {});
      if (res.data?.ok === false) {
        throw new Error('Playlist discovery request failed');
      }
      return res.data?.playlists || [];
    },
  });

  const handleLikePodcast = async (podcast) => {
    if (!user) return;
    if (podcastLikesLoading || podcastLikesError) {
      if (podcastLikesError) refetchPodcastLikes();
      return;
    }
    const canonicalFeedUrl = normalizePodcastFeedUrl(podcast.feedUrl);
    const podcastLikeQueryKey = savedContentQueryKeys.podcastLikes(user.id);
    const cachedPodcastLikes = queryClient.getQueryData(podcastLikeQueryKey);
    const previousPodcastLikes = Array.isArray(cachedPodcastLikes) ? cachedPodcastLikes : [];
    const wasLiked = likedFeedUrls.has(canonicalFeedUrl);
    queryClient.setQueryData(
      podcastLikeQueryKey,
      wasLiked
        ? previousPodcastLikes.filter((record) => normalizePodcastFeedUrl(record.feed_url) !== canonicalFeedUrl)
        : [{
            id: `optimistic-${canonicalFeedUrl}`,
            feed_url: canonicalFeedUrl,
            podcast_title: podcast.title,
            podcast_author: podcast.author || '',
            podcast_image: podcast.image || '',
            podcast_description: podcast.description || '',
          }, ...previousPodcastLikes],
    );

    if (wasLiked) {
      try {
        const records = await voxylApi.entities.PodcastLike.filter({ user_id: user.id, feed_url: canonicalFeedUrl });
        if (records[0]) await voxylApi.entities.PodcastLike.delete(records[0].id);
      } catch (error) {
        console.error('[Explore] Failed to remove saved podcast', { feedUrl: canonicalFeedUrl, error });
        queryClient.setQueryData(podcastLikeQueryKey, previousPodcastLikes);
        return;
      }
    } else {
      try {
        await voxylApi.entities.PodcastLike.create({
          feed_url: canonicalFeedUrl,
          podcast_title: podcast.title,
          podcast_author: podcast.author || '',
          podcast_image: podcast.image || '',
          podcast_description: podcast.description || '',
        });
      } catch (error) {
        console.error('[Explore] Failed to save podcast', { feedUrl: canonicalFeedUrl, error });
        queryClient.setQueryData(podcastLikeQueryKey, previousPodcastLikes);
        return;
      }
    }
    handlePodcastLikeMutationSuccess(queryClient, user.id);
  };

  // Podcast Index search
  useEffect(() => {
    if (tab !== 'podcasts') return;
    if (!debouncedQuery.trim()) { setPodcastResults([]); setPodcastError(''); return; }
    let cancelled = false;
    setPodcastLoading(true);
    setPodcastError('');
    voxylApi.functions.invoke('searchPodcasts', { 
      query: debouncedQuery, 
      language: podcastLanguage,
      sortBy: podcastSortBy,
      category: podcastCategory,
    })
      .then(res => {
        if (cancelled) return;
        setPodcastResults(res.data?.results || []);
      })
      .catch(error => {
        if (cancelled) return;
        setPodcastResults([]);
        setPodcastError(getPodcastSearchErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setPodcastLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, tab, user, podcastLanguage, podcastSortBy, podcastCategory, podcastSearchNonce]);

  const canRenderSocialContent = !user || hiddenUsersReady;
  const filteredPlaylists = canRenderSocialContent ? playlists
    .filter(p => {
      if (blockedIds.includes(p.creator_id)) return false;
      if (p.visibility === 'private') return false;
      if (p.visibility === 'friends_only' && !(user && followStatuses[p.creator_id] === 'accepted')) return false;
      return !voxylSearch ||
        p.name?.toLowerCase().includes(voxylSearch.toLowerCase()) ||
        p.description?.toLowerCase().includes(voxylSearch.toLowerCase()) ||
        p.creator_name?.toLowerCase().includes(voxylSearch.toLowerCase());
    }) : [];
  const canRetryPlaylists = playlistsError && Boolean(playlistsQueryError) && !playlistsFetching;
  const showHiddenUsersGate = authResolved && user && !hiddenUsersReady && tab === 'playlists';

  const DISCOVER_TABS = [
    { key: 'playlists', label: t('explorePlaylists'), icon: Compass },
    { key: 'podcasts', label: t('explorePodcasts'), icon: Radio },

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
      <VoxylHeader title={t('navDiscover')} subtitle={t('discoverSearchSubtitle')} right={null} />

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-1.5 mx-4 p-1.5 rounded-2xl bg-secondary border border-border sm:max-w-md sm:mx-auto">
        {DISCOVER_TABS.map(({ key, label, icon: TabIcon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all min-w-0",
              tab === key
                ? "gradient-primary text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/60"
            )}
          >
            <TabIcon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Search bar and filters */}
      <div className="px-4 mb-5 mt-4 mx-auto w-full max-w-5xl">
          <div className="mb-3">
            <h2 className="text-base sm:text-lg font-semibold text-foreground">
              {tab === 'playlists' ? t('discoverPlaylistsHeading') : t('discoverPodcastsHeading')}
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              {tab === 'playlists' ? t('discoverPlaylistsHint') : t('discoverPodcastsHint')}
            </p>
          </div>
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
      </div>

      <div className="px-4">
        {showHiddenUsersGate && (
          <div className="mb-4 rounded-2xl border border-border bg-card p-3 text-sm text-muted-foreground flex items-center justify-between gap-3">
            <span>{hiddenUsersLoading ? t('loading') : hiddenUsersError || t('blockLoadHiddenError')}</span>
            {!hiddenUsersLoading && (
              <button type="button" onClick={() => loadHiddenUsers(user)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium gradient-primary text-white">
                <RefreshCcw size={12} />
                {t('blockRetry')}
              </button>
            )}
          </div>
        )}
        {/* Playlists tab */}
        {tab === 'playlists' && !showHiddenUsersGate && (
          playlistsLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-secondary animate-pulse" />)}
            </div>
          ) : playlistsError ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-4xl mb-3">⚠️</p>
              <p className="text-sm mb-4">{t('explorePlaylistsError')}</p>
              <button
                type="button"
                onClick={() => refetchPlaylists()}
                disabled={!canRetryPlaylists}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium gradient-primary text-white"
              >
                <RefreshCcw size={14} />
                {t('retry')}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {playlistLikesError && (
                <div className="mb-3 rounded-2xl border border-border bg-card p-3 text-sm text-muted-foreground flex items-center justify-between gap-3">
                  <span>{t('explorePlaylistsError')}</span>
                  <button type="button" onClick={() => refreshPlaylistLikeQuery(queryClient, user?.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium gradient-primary text-white">
                    <RefreshCcw size={12} />
                    {t('retry')}
                  </button>
                </div>
              )}
              {playlistLikesLoading && (
                <div className="mb-3 h-10 rounded-2xl bg-secondary animate-pulse" />
              )}
              {filteredPlaylists.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                  {filteredPlaylists.map((pl, i) => (
                <motion.div key={pl.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <PlaylistCard playlist={pl} discovery liked={!playlistLikesError && !playlistLikesLoading && likedPlaylistIds.includes(pl.id)} onLike={playlistLikesLoading || playlistLikesFetching || playlistLikesError ? undefined : handleLike} currentUser={user} onBlocked={id => setBlockedIds(prev => [...new Set([...prev, id])])} />
                </motion.div>
                  ))}
                </div>
              )}
              {filteredPlaylists.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">
                  <p className="text-4xl mb-3">{voxylSearch.trim() ? '🔍' : '🎧'}</p>
                  <p className="font-medium text-foreground">
                    {voxylSearch.trim() ? t('discoverNoPlaylistResults') : t('discoverNoPlaylistsAvailable')}
                  </p>
                  <p className="text-xs mt-1">
                    {voxylSearch.trim() ? t('discoverTryAnotherSearch') : t('discoverNoPlaylistsHint')}
                  </p>
                </div>
              )}
            </div>
          )
        )}

        {/* Podcasts tab */}
        {tab === 'podcasts' && (
          <div className="space-y-2">
            {podcastLikesError && (
              <div className="rounded-2xl border border-border bg-card p-3 text-sm text-muted-foreground flex items-center justify-between gap-3">
                <span>{t('podcastSearchFailed')}</span>
                <button type="button" onClick={() => refreshPodcastLikeQuery(queryClient, user?.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium gradient-primary text-white">
                  <RefreshCcw size={12} />
                  {t('retry')}
                </button>
              </div>
            )}
            {podcastLikesLoading && (
              <div className="h-10 rounded-2xl bg-secondary animate-pulse" />
            )}
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
            {!podcastLoading && podcastError && (
              <div className="text-center py-16 text-muted-foreground">
                <p className="text-4xl mb-3">⚠️</p>
                <p className="text-sm mb-4">{podcastError}</p>
                <button
                  type="button"
                  onClick={() => setPodcastSearchNonce(value => value + 1)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium gradient-primary text-white"
                >
                  <RefreshCcw size={14} />
                  {t('retry')}
                </button>
              </div>
            )}
            {!podcastLoading && !podcastError && podcastResults.length > 0 && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {podcastResults.map((podcast, i) => (
              <PodcastResultCard
                key={podcast.id}
                podcast={podcast}
                index={i}
                onAdd={setSelectedPodcast}
                onLike={podcastLikesLoading || podcastLikesFetching || podcastLikesError ? undefined : handleLikePodcast}
                liked={!podcastLikesError && !podcastLikesLoading && likedFeedUrls.has(normalizePodcastFeedUrl(podcast.feedUrl))}
              />
                ))}
              </div>
            )}
            {!podcastLoading && !podcastError && search.trim() && podcastResults.length === 0 && (
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
