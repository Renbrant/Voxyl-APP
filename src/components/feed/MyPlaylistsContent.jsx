import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Pause,
  Play,
} from 'lucide-react';

import { voxylApi } from '@/api/voxylApiClient';
import PlaylistCard from '@/components/playlist/PlaylistCard';
import { usePlayer } from '@/lib/PlayerContext';
import { getCache, setCache, TTL_5MIN } from '@/lib/appCache';
import { asArray } from '@/lib/arrayUtils';
import { t } from '@/lib/i18n';
import {
  getContinueListeningItems,
  getListeningHistoryEpisodes,
  getPlaybackProgressPercent,
  getRecentlyPlayedPlaylists,
} from '@/lib/personalFeedMatching';
import { cn } from '@/lib/utils';

const GRADIENT_COLORS = [
  'from-purple-600 to-cyan-400',
  'from-pink-600 to-purple-600',
  'from-blue-600 to-cyan-400',
  'from-orange-500 to-pink-600',
];

export default function MyPlaylistsContent({
  user,
  likedIds,
  handleLike,
  blockedIds,
  setBlockedIds,
}) {
  const [showHistory, setShowHistory] = useState(false);

  const {
    play,
    currentEpisode,
    isPlaying,
    togglePlay,
  } = usePlayer();

  const {
    data: allPlaylists = [],
    isLoading: isLoadingPlaylists,
  } = useQuery({
    queryKey: ['all-playlists-feed'],
    enabled: !!user,
    queryFn: async () => {
      const cached = getCache('all-playlists-feed');

      if (cached) {
        return cached;
      }

      const data = await voxylApi.entities.Playlist.list(
        '-updated_date',
        200,
      );

      setCache(
        'all-playlists-feed',
        data,
        TTL_5MIN,
      );

      return data;
    },
    initialData: () =>
      getCache('all-playlists-feed') || undefined,
  });

  const {
    data: userPodcastPlays = [],
    isError: isPlaysError,
    isLoading: isLoadingPlays,
  } = useQuery({
    queryKey: ['user-podcast-plays', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const cacheKey =
        'user-podcast-plays-' + user.id;

      const cached = getCache(cacheKey);

      if (cached) {
        return cached;
      }

      try {
        const data =
          await voxylApi.entities.PodcastPlay.filter(
            { user_id: user.id },
            '-played_at',
            'all',
          );

        setCache(
          cacheKey,
          data,
          TTL_5MIN,
        );

        return data;
      } catch (error) {
        console.error(
          '[Feed] Failed to load user podcast plays',
          error,
        );

        throw error;
      }
    },
    initialData: () =>
      getCache(
        'user-podcast-plays-' + user?.id,
      ) || undefined,
  });

  const {
    data: episodeProgress = [],
    isError: isProgressError,
    isLoading: isLoadingProgress,
    refetch: refetchProgress,
  } = useQuery({
    queryKey: ['user-episode-progress', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const cacheKey =
        'user-episode-progress-' + user.id;

      const cached = getCache(cacheKey);

      if (cached) {
        return cached;
      }

      try {
        const data = asArray(
          await voxylApi.entities.EpisodeProgress.filter(
            {},
            '-last_played_at',
            500,
          ),
        );

        setCache(
          cacheKey,
          data,
          TTL_5MIN,
        );

        return data;
      } catch (error) {
        console.error(
          '[Feed] Failed to load user episode progress',
          error,
        );

        throw error;
      }
    },
    initialData: () =>
      getCache(
        'user-episode-progress-' + user?.id,
      ) || undefined,
  });

  const sortedMyPlaylists = useMemo(() => {
    return getRecentlyPlayedPlaylists(
      userPodcastPlays,
      allPlaylists,
    ).filter(
      playlist =>
        !blockedIds.includes(playlist.creator_id),
    );
  }, [
    allPlaylists,
    blockedIds,
    userPodcastPlays,
  ]);

  const lastPlayedPodcasts = useMemo(() => {
    const seen = new Set();

    return userPodcastPlays
      .filter(play => {
        if (
          !play?.feed_url ||
          seen.has(play.feed_url)
        ) {
          return false;
        }

        seen.add(play.feed_url);
        return true;
      })
      .slice(0, 8);
  }, [userPodcastPlays]);

  const continueListening = useMemo(
    () =>
      getContinueListeningItems(
        episodeProgress,
        userPodcastPlays,
      ).slice(0, 6),
    [
      episodeProgress,
      userPodcastPlays,
    ],
  );

  const listeningHistory = useMemo(
    () =>
      getListeningHistoryEpisodes(
        userPodcastPlays,
      ),
    [userPodcastPlays],
  );

  const handleResume = item => {
    if (
      currentEpisode?.audioUrl ===
      item.episode.audioUrl
    ) {
      togglePlay();
      return;
    }

    void play(
      item.episode,
      [item.episode],
      {
        type: 'podcast',
        id: item.play.feed_url,
      },
    );
  };

  const isLoading =
    isLoadingPlaylists ||
    isLoadingPlays;

  if (
    isLoading &&
    !sortedMyPlaylists.length &&
    !lastPlayedPodcasts.length
  ) {
    return (
      <div className="flex flex-col items-center py-12 gap-3 text-muted-foreground">
        <Loader2
          size={24}
          className="animate-spin text-primary"
        />
        <p className="text-sm">
          {t('loading')}
        </p>
      </div>
    );
  }

  if (isPlaysError) {
    return (
      <div className="flex flex-col items-center py-16 gap-3 text-center text-muted-foreground">
        <AlertCircle
          size={28}
          className="text-destructive"
        />

        <div>
          <p className="font-medium text-foreground">
            {t('feedListeningHistoryError')}
          </p>

          <p className="text-sm mt-1">
            {t('feedListeningHistoryErrorHint')}
          </p>
        </div>
      </div>
    );
  }

  if (
    !isLoading &&
    !sortedMyPlaylists.length &&
    !lastPlayedPodcasts.length
  ) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-4xl mb-3">
          🎧
        </p>

        <p className="font-medium">
          {t('feedNoListeningHistory')}
        </p>

        <p className="text-sm mt-1">
          {t('feedNoListeningHistoryHint')}
        </p>
      </div>
    );
  }

  return (
    <div>
      <section className="mb-8">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-base font-semibold text-foreground">
            {t('feedContinueListening')}
          </h2>
        </div>

        {isLoadingProgress && (
          <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2
              size={18}
              className="animate-spin text-primary"
            />
            <span>
              {t('feedContinueListeningLoading')}
            </span>
          </div>
        )}

        {!isLoadingProgress && isProgressError && (
          <div className="rounded-2xl border border-border bg-card p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle
                size={18}
                className="text-destructive"
              />

              <span>
                {t('feedContinueListeningError')}
              </span>
            </div>

            <button
              type="button"
              onClick={() => refetchProgress()}
              className="px-3 py-1.5 rounded-full gradient-primary text-white text-xs font-medium"
            >
              {t('retry')}
            </button>
          </div>
        )}

        {!isLoadingProgress &&
          !isProgressError &&
          !continueListening.length && (
            <div className="rounded-2xl border border-border bg-card px-4 py-5 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {t('feedContinueListeningEmpty')}
              </p>

              <p className="mt-1">
                {t('feedContinueListeningEmptyHint')}
              </p>
            </div>
          )}

        {!isLoadingProgress &&
          !isProgressError &&
          continueListening.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {continueListening.map(item => {
                const isActive =
                  currentEpisode?.audioUrl ===
                  item.episode.audioUrl;

                const activePlaying =
                  isActive && isPlaying;

                const progressPercent =
                  getPlaybackProgressPercent(
                    item.progress,
                  );

                return (
                  <button
                    type="button"
                    key={item.episode.audioUrl}
                    onClick={() =>
                      handleResume(item)
                    }
                    className="text-left rounded-2xl border border-border bg-card p-3 hover:border-primary/40 transition-all active:scale-[0.99]"
                  >
                    <div className="flex gap-3">
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-secondary flex-shrink-0">
                        {item.episode.image ? (
                          <img
                            src={item.episode.image}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-purple-600 to-cyan-400" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground line-clamp-2">
                          {item.episode.title}
                        </p>

                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {item.episode.feedTitle}
                        </p>
                      </div>

                      <div className="w-9 h-9 rounded-full gradient-primary text-white flex items-center justify-center flex-shrink-0">
                        {activePlaying ? (
                          <Pause
                            size={15}
                            fill="currentColor"
                          />
                        ) : (
                          <Play
                            size={15}
                            fill="currentColor"
                            className="ml-0.5"
                          />
                        )}
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="h-1.5 rounded-full bg-border overflow-hidden">
                        <div
                          className="h-full rounded-full gradient-primary"
                          style={{
                            width:
                              progressPercent + '%',
                          }}
                        />
                      </div>

                      <div className="flex justify-between gap-3 mt-1.5 text-xs text-muted-foreground">
                        <span>
                          {Math.round(progressPercent)}%
                        </span>

                        <span>
                          {activePlaying
                            ? t('feedPause')
                            : t('feedResume')}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
      </section>

      {sortedMyPlaylists.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold mb-3 text-foreground">
            {t('feedRecentlyPlayedPlaylists')}
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {sortedMyPlaylists.map(
              (playlist, index) => (
                <motion.div
                  key={playlist.id}
                  initial={{
                    opacity: 0,
                    y: 16,
                  }}
                  animate={{
                    opacity: 1,
                    y: 0,
                  }}
                  transition={{
                    delay: index * 0.04,
                  }}
                >
                  <PlaylistCard
                    playlist={playlist}
                    liked={likedIds.includes(
                      playlist.id,
                    )}
                    onLike={handleLike}
                    currentUser={user}
                    onBlocked={id =>
                      setBlockedIds(previous => [
                        ...new Set([
                          ...previous,
                          id,
                        ]),
                      ])
                    }
                  />
                </motion.div>
              ),
            )}
          </div>
        </section>
      )}

      {lastPlayedPodcasts.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold mb-3 text-foreground">
            {t('feedLastPlayedPodcasts')}
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {lastPlayedPodcasts.map(
              (playRecord, index) => {
                const gradient =
                  GRADIENT_COLORS[
                    playRecord.feed_url
                      ?.charCodeAt(0) %
                    GRADIENT_COLORS.length
                  ];

                return (
                  <Link
                    to={
                      '/podcast/' +
                      encodeURIComponent(
                        playRecord.feed_url,
                      )
                    }
                    key={playRecord.feed_url}
                  >
                    <motion.div
                      initial={{
                        opacity: 0,
                        y: 16,
                      }}
                      animate={{
                        opacity: 1,
                        y: 0,
                      }}
                      transition={{
                        delay: index * 0.04,
                      }}
                      className="flex flex-col gap-2 p-2 rounded-2xl border border-border bg-card hover:border-primary/30 transition-all active:scale-95 h-full"
                    >
                      <div className="w-full aspect-square rounded-lg overflow-hidden bg-secondary flex-shrink-0">
                        {playRecord.podcast_image ? (
                          <img
                            src={
                              playRecord.podcast_image
                            }
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div
                            className={cn(
                              'w-full h-full bg-gradient-to-br',
                              gradient,
                            )}
                          />
                        )}
                      </div>

                      <div className="min-w-0 px-1 pb-1">
                        <p className="text-xs font-medium line-clamp-2 text-foreground">
                          {
                            playRecord.podcast_title
                          }
                        </p>
                      </div>
                    </motion.div>
                  </Link>
                );
              },
            )}
          </div>
        </section>
      )}

      {listeningHistory.length > 0 && (
        <section className="mb-8">
          <button
            type="button"
            onClick={() =>
              setShowHistory(value => !value)
            }
            className="w-full rounded-2xl border border-border bg-card px-4 py-3 flex items-center justify-between gap-3 text-left hover:border-primary/30 transition-colors"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <History
                size={17}
                className="text-primary"
              />

              {showHistory
                ? t('feedHideListeningHistory')
                : t('feedViewListeningHistory')}
            </span>

            {showHistory ? (
              <ChevronUp
                size={17}
                className="text-muted-foreground"
              />
            ) : (
              <ChevronDown
                size={17}
                className="text-muted-foreground"
              />
            )}
          </button>

          {showHistory && (
            <div className="mt-3 rounded-2xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">
                  {t('feedListeningHistoryTitle')}
                </h2>
              </div>

              <div className="divide-y divide-border">
                {listeningHistory.map(item => (
                  <Link
                    key={item.episode.audioUrl}
                    to={
                      '/podcast/' +
                      encodeURIComponent(
                        item.play.feed_url,
                      )
                    }
                    className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors"
                  >
                    <div className="w-11 h-11 rounded-lg overflow-hidden bg-secondary flex-shrink-0">
                      {item.episode.image ? (
                        <img
                          src={item.episode.image}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-purple-600 to-cyan-400" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground line-clamp-1">
                        {item.episode.title}
                      </p>

                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {item.episode.feedTitle}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
