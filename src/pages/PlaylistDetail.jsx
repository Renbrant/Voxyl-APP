import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { voxylApi } from '@/api/voxylApiClient';
import { useQuery } from '@tanstack/react-query';
import { formatDuration } from '@/lib/rssUtils';
import { getPlaylistCoverImage } from '@/lib/playlistCoverHelper';
import { getInitialPlaylistEpisodes, mergePlaylistEpisodeLists, refreshAndSyncPlaylistEpisodes } from '@/lib/playlistCacheManager';
import { usePlayer } from '@/lib/PlayerContext';
import { ArrowLeft, Share2, Play, Clock, Loader2, ListMusic, SkipForward, Pencil, Heart, UserPlus, UserCheck } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { Link } from 'react-router-dom';
import PageTransition from '@/components/common/PageTransition';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import PullToRefreshIndicator from '@/components/common/PullToRefreshIndicator';
import VisibilityBadge from '@/components/playlist/VisibilityBadge';
import EditPlaylistModal from '@/components/playlist/EditPlaylistModal';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import EpisodeDetailModal from '@/components/player/EpisodeDetailModal';
import EpisodeActionButton from '@/components/player/EpisodeActionButton';
import SwipeableEpisodeRow from '@/components/player/SwipeableEpisodeRow';
import {
  INITIAL_PLAYLIST_SYNC_STATE,
  createPlaylistRequestGuard,
  getPlaylistEpisodeDisplayState,
  getPlaylistRouteResetState,
} from '@/lib/playlistEpisodeLoadGuards';

import ReportBlockMenu from '@/components/moderation/ReportBlockMenu';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import BottomNav from '@/components/common/BottomNav';

const GRADIENT_COLORS = [
  'from-purple-600 to-cyan-400',
  'from-pink-600 to-purple-600',
  'from-blue-600 to-cyan-400',
  'from-orange-500 to-pink-600',
];

export default function PlaylistDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [cacheLookupStatus, setCacheLookupStatus] = useState('idle');
  const [syncState, setSyncState] = useState(INITIAL_PLAYLIST_SYNC_STATE);
  const [backgroundSyncSource, setBackgroundSyncSource] = useState('none');
  const [playedUrls, setPlayedUrls] = useState(new Set());
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [editingPlaylist, setEditingPlaylist] = useState(false);
  const [liked, setLiked] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followingLoader, setFollowingLoader] = useState(false);
  const { requireAuth } = useRequireAuth();
  const { play, currentEpisode, isPlaying, togglePlay, seek, currentTime, duration, autoplay, setAutoplay, finishedUrls, setFinishedUrls, markFinished, getCachedProgress } = usePlayer();
  const currentPlaylistIdRef = useRef(id);
  const cacheRequestGuardRef = useRef(null);
  const syncRequestGuardRef = useRef(null);
  const loadEpisodesRef = useRef(null);
  if (!cacheRequestGuardRef.current) {
    cacheRequestGuardRef.current = createPlaylistRequestGuard(() => currentPlaylistIdRef.current);
  }
  if (!syncRequestGuardRef.current) {
    syncRequestGuardRef.current = createPlaylistRequestGuard(() => currentPlaylistIdRef.current);
  }

  useEffect(() => {
    if (!user || !id) return;
    voxylApi.entities.PlaylistLike.filter({ playlist_id: id, user_id: user.id })
      .then(records => setLiked(records.length > 0))
      .catch(() => {});
  }, [user, id]);

  const handleLike = requireAuth(async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!playlist) return;
    setLiked(v => !v);
    try {
      await voxylApi.functions.invoke('togglePlaylistLike', { playlist_id: id });
    } catch {
      setLiked(v => !v); // revert on failure
    }
  });

  useEffect(() => {
    voxylApi.auth.me().then(u => {
      setUser(u);
      // Check if this is the pending playlist the user signed up for
      const pending = localStorage.getItem('voxyl_pending_playlist');
      const pendingCreatorId = localStorage.getItem('voxyl_pending_creator_id');
      if (pending === id) {
      localStorage.removeItem('voxyl_pending_playlist');
      localStorage.removeItem('voxyl_pending_creator_id');
      // Auto-like the playlist as the first action post-signup
      voxylApi.entities.PlaylistLike.filter({ playlist_id: id, user_id: u.id })
        .then(existing => {
          if (existing.length === 0) {
            voxylApi.functions.invoke('togglePlaylistLike', { playlist_id: id }).catch(() => {});
          }
        });
        // Auto-follow the creator if they came from a share link
        if (pendingCreatorId && pendingCreatorId !== u.id) {
          voxylApi.functions.invoke('requestFollow', { targetUserId: pendingCreatorId }).catch(() => {});
        }
      }
    }).catch(() => {});
  }, [id]);

  const {
    data: playlist,
    refetch: refetchPlaylist,
    isLoading: isPlaylistLoading,
    isError: isPlaylistError,
  } = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => voxylApi.entities.Playlist.get(id),
    enabled: Boolean(id),
    retry: false,
  });

  const isOwner = user && playlist && user.id === playlist.creator_id;

  const handleFollowCreator = requireAuth(async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!playlist || isOwner) return;
    setFollowingLoader(true);
    const prevFollowing = following;
    setFollowing(v => !v);
    try {
      if (prevFollowing) {
        await voxylApi.functions.invoke('cancelFollowRequest', { targetUserId: playlist.creator_id });
      } else {
        await voxylApi.functions.invoke('requestFollow', { targetUserId: playlist.creator_id });
      }
    } catch {
      setFollowing(prevFollowing); // revert on failure
    }
    setFollowingLoader(false);
  });

  useEffect(() => {
    if (!user || !playlist || isOwner) return;
    voxylApi.entities.Follow.filter({ follower_id: user.id, following_id: playlist.creator_id })
      .then(records => setFollowing(records.length > 0))
      .catch(() => {});
  }, [user, playlist, isOwner]);

  // Reset playlist-owned UI immediately when the route changes.
  useEffect(() => {
    if (!id) return;
    currentPlaylistIdRef.current = id;
    const cacheToken = cacheRequestGuardRef.current.reset(id);
    syncRequestGuardRef.current.reset(id);
    const resetState = getPlaylistRouteResetState();
    setEpisodes(resetState.episodes);
    setBackgroundSyncSource(resetState.backgroundSyncSource);
    setSelectedEpisode(resetState.selectedEpisode);
    setCacheLookupStatus(resetState.cacheLookupStatus);
    setSyncState(resetState.syncState);

    getInitialPlaylistEpisodes(id).then(result => {
      if (!cacheRequestGuardRef.current.isCurrent(cacheToken)) return;
      setEpisodes(result.episodes);
      setBackgroundSyncSource(result.source);
      setCacheLookupStatus('done');
    }).catch(() => {
      if (!cacheRequestGuardRef.current.isCurrent(cacheToken)) return;
      setCacheLookupStatus('done');
    });
  }, [id]);

  // Refresh and sync in background
  useEffect(() => {
    if (!id) return;
    if (!playlist) {
      loadEpisodesRef.current = null;
      return;
    }
    if (!playlist?.rss_feeds?.length) {
      loadEpisodesRef.current = () => Promise.resolve();
      setSyncState(INITIAL_PLAYLIST_SYNC_STATE);
      return;
    }

    loadEpisodesRef.current = async () => {
      const syncToken = syncRequestGuardRef.current.start(id);

      setSyncState({
        status: 'syncing',
        source: 'rss',
        completedFeeds: 0,
        failedFeeds: 0,
        totalFeeds: playlist.rss_feeds.length,
      });

      const isCurrentRequest = (playlistId = id) => (
        syncRequestGuardRef.current.isCurrent({ ...syncToken, playlistId })
      );

      const result = await refreshAndSyncPlaylistEpisodes(id, playlist, {
        onProgress: (progress) => {
          if (!isCurrentRequest(progress.playlistId)) return;
          if (progress.episodes.length > 0) {
            setEpisodes(prev => mergePlaylistEpisodeLists([progress.episodes, prev], playlist));
          }
          setBackgroundSyncSource(progress.source);
          setSyncState({
            status: 'syncing',
            source: progress.source,
            completedFeeds: progress.completedFeeds,
            failedFeeds: progress.failedFeeds,
            totalFeeds: progress.totalFeeds,
          });
        },
      });

      if (!isCurrentRequest(result.playlistId || id)) return;
      setEpisodes(prev => result.episodes.length > 0 ? result.episodes : prev);
      setBackgroundSyncSource(result.source);
      setSyncState({
        status: result.episodes.length === 0
          ? 'empty'
          : result.failedFeeds > 0
            ? (result.source === 'rss' ? 'partial' : 'failed-cache')
            : 'success',
        source: result.source,
        completedFeeds: result.completedFeeds || playlist.rss_feeds.length,
        failedFeeds: result.failedFeeds || 0,
        totalFeeds: result.totalFeeds || playlist.rss_feeds.length,
      });
    };

    // Start background sync immediately
    loadEpisodesRef.current();
  }, [playlist, id]);

  const handleShare = async () => {
    const url = `${window.location.origin}/share/${id}`;
    if (navigator.share) {
      await navigator.share({ title: playlist?.name, text: playlist?.description, url });
    } else {
      navigator.clipboard.writeText(url);
    }
  };

  const handlePlayEpisode = (ep) => {
    if (currentEpisode?.audioUrl === ep.audioUrl) { togglePlay(); return; }
    play(ep, episodes, { type: 'playlist', id });
    setPlayedUrls(prev => new Set([...prev, ep.audioUrl]));
  };

  const handleRefresh = useCallback(() => loadEpisodesRef.current?.(), []);
  const { pullProgress, refreshing } = usePullToRefresh(handleRefresh, null);
  const [coverImage, setCoverImage] = useState(null);
  const gradient = GRADIENT_COLORS[id?.charCodeAt(0) % GRADIENT_COLORS.length];
  const {
    isSyncing: isSyncingEpisodes,
    shouldShowEpisodeLoading,
    shouldShowEmptyState,
  } = getPlaylistEpisodeDisplayState({
    episodeCount: episodes.length,
    cacheLookupStatus,
    syncStatus: syncState.status,
    hasPlaylist: Boolean(playlist),
  });
  const feedProgressLabel = syncState.totalFeeds > 0
    ? `${syncState.completedFeeds}/${syncState.totalFeeds}`
    : '';
  const episodeStatusText = (() => {
    if (cacheLookupStatus === 'loading' && episodes.length === 0) return t('detailLoadingCachedEpisodes');
    if (isSyncingEpisodes) {
      const base = refreshing ? t('detailRefreshingEpisodes') : t('detailUpdatingEpisodes');
      const failure = syncState.failedFeeds > 0 ? ` • ${t('detailSomeFeedsFailed')}` : '';
      return feedProgressLabel ? `${base} ${feedProgressLabel}${failure}` : base;
    }
    if (syncState.status === 'success') return t('detailAllEpisodesUpdated');
    if (syncState.status === 'partial') return `${t('detailEpisodesUpdatedWithFailures')} ${syncState.failedFeeds}/${syncState.totalFeeds}`;
    if (syncState.status === 'failed-cache') return t('detailUpdateFailedCachedAvailable');
    if (syncState.status === 'empty') return t('detailNoEpisodesAfterSync');
    if (episodes.length > 0 && backgroundSyncSource === 'local') return t('detailCachedEpisodesReady');
    return '';
  })();

  useEffect(() => {
    if (!playlist) {
      setCoverImage(null);
      return;
    }
    getPlaylistCoverImage(playlist).then(img => setCoverImage(img));
  }, [playlist]);

  return (
    <>
    <PageTransition>
    <div className="min-h-screen bg-background relative">
      <PullToRefreshIndicator pullProgress={pullProgress} refreshing={refreshing} />
      {/* Top bar with back + actions */}
      <div className="flex items-center justify-between px-4 pt-12 pb-3 bg-background">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center" style={{ WebkitTapHighlightColor: 'transparent' }}>
          <ArrowLeft size={18} className="text-foreground" />
        </button>
        <div className="flex items-center gap-2">
          {/* Autoplay toggle switch */}
          <button
            onClick={() => setAutoplay(v => !v)}
            title={autoplay ? t('detailAutoplayOn') : t('detailAutoplayOff')}
            className="flex items-center gap-1.5 bg-secondary rounded-full px-1 py-1 transition-all"
          >
            <div className={cn(
              "w-7 h-4 rounded-full relative transition-colors duration-300",
              autoplay ? "bg-primary" : "bg-border"
            )}>
              <div className={cn(
                "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all duration-300",
                autoplay ? "left-3.5" : "left-0.5"
              )} />
            </div>
            <SkipForward size={11} className={autoplay ? "text-primary" : "text-muted-foreground"} />
          </button>
          {isOwner && (
            <button onClick={() => setEditingPlaylist(true)} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
              <Pencil size={15} className="text-foreground" />
            </button>
          )}
          <button onClick={handleShare} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
            <Share2 size={16} className="text-foreground" />
          </button>
          {!isOwner && (
            <button onClick={handleLike} className={cn("w-9 h-9 rounded-full bg-secondary flex items-center justify-center", liked ? "text-red-400" : "text-muted-foreground")}>
              <Heart size={16} fill={liked ? "currentColor" : "none"} />
            </button>
          )}
          {!isOwner && (
            <button onClick={handleFollowCreator} disabled={followingLoader} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground disabled:opacity-50">
              {followingLoader ? <Loader2 size={16} className="animate-spin" /> : (following ? <UserCheck size={16} /> : <UserPlus size={16} />)}
            </button>
          )}
          {!isOwner && playlist && (
            <ReportBlockMenu
              currentUser={user}
              targetUser={{ id: playlist.creator_id, name: playlist.creator_name }}
              contentType="playlist"
              contentId={playlist.id}
              contentTitle={playlist.name}
            />
          )}
        </div>
      </div>

      {/* Cover + info row */}
      <div className="flex gap-4 px-4 pb-4 bg-background">
        <div className={cn("w-24 h-24 rounded-2xl flex-shrink-0 bg-gradient-to-br overflow-hidden relative", gradient)}>
          {coverImage && (
            <img src={coverImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {playlist ? (
            <>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h1 className="text-xl font-grotesk font-bold text-foreground leading-tight">{playlist.name}</h1>
                <VisibilityBadge visibility={playlist.visibility || 'public'} withLabel />
              </div>
              <p className="text-sm text-muted-foreground">{t('detailBy')} {playlist.creator_username ? `@${playlist.creator_username}` : t('detailUser')} • {playlist.rss_feeds?.length || 0} {t('detailFeeds')}</p>
              {playlist.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{playlist.description}</p>}
            </>
          ) : isPlaylistError ? (
            <div>
              <h1 className="text-xl font-grotesk font-bold text-foreground leading-tight">Playlist indisponivel</h1>
              <p className="text-sm text-muted-foreground mt-1">Esta playlist nao existe ou nao pode ser acessada.</p>
            </div>
          ) : isPlaylistLoading ? (
            <div className="h-16 animate-pulse rounded-xl bg-secondary" />
          ) : (
            <div>
              <h1 className="text-xl font-grotesk font-bold text-foreground leading-tight">Playlist indisponivel</h1>
              <p className="text-sm text-muted-foreground mt-1">Esta playlist nao existe ou nao pode ser acessada.</p>
            </div>
          )}
        </div>
      </div>

      {(playlist?.max_duration > 0 || playlist?.time_filter_hours > 0) && (
        <div className="mx-4 mt-3 px-3 py-2 bg-primary/10 border border-primary/30 rounded-xl flex items-center gap-3 flex-wrap">
          {playlist?.max_duration > 0 && (
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-primary" />
              <span className="text-xs text-primary">{t('detailFilterLabel')} {playlist.max_duration} {t('detailFilterMin')}</span>
            </div>
          )}
          {playlist?.time_filter_hours > 0 && (
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-primary" />
              <span className="text-xs text-primary">{t('detailLastHours')} {playlist.time_filter_hours >= 24 ? `${Math.round(playlist.time_filter_hours / 24)} ${t('detailDays')}` : `${playlist.time_filter_hours}${t('detailHours')}`}</span>
            </div>
          )}
        </div>
      )}

      <div className="px-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <ListMusic size={16} className="text-primary" /> {t('detailEpisodes')}
            {episodes.length > 0 && <span className="text-muted-foreground text-sm font-normal">({episodes.length})</span>}
            {episodeStatusText && (
              <span className={cn(
                "flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium",
                isSyncingEpisodes
                  ? "bg-muted text-muted-foreground"
                  : syncState.status === 'partial' || syncState.status === 'failed-cache'
                    ? "bg-amber-500/10 text-amber-500"
                    : "bg-primary/10 text-primary"
              )}>
                {isSyncingEpisodes && <Loader2 size={11} className="animate-spin" />}
                {episodeStatusText}
              </span>
            )}
          </h2>
          {episodes.length > 0 && (
            <button
              onClick={() => {
                const nextUnplayed = episodes.find(ep => !finishedUrls.has(ep.audioUrl)) || episodes[0];
                play(nextUnplayed, episodes, { type: 'playlist', id });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full gradient-primary text-white text-xs font-medium"
            >
              <Play size={12} fill="white" /> {t('detailPlayAll')}
            </button>
          )}
        </div>

        {shouldShowEpisodeLoading ? (
          <div className="flex flex-col items-center py-12 gap-3 text-muted-foreground">
            <Loader2 size={24} className="animate-spin text-primary" />
            <p className="text-sm">{episodeStatusText || t('detailLoadingFeeds')}</p>
          </div>
        ) : shouldShowEmptyState ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-sm">{syncState.status === 'empty' ? t('detailNoEpisodesAfterSync') : t('detailNoEpisodes')}</p>
            <p className="text-xs mt-1">{t('detailNoEpisodesHint')}</p>
          </div>
        ) : (
          <div className="space-y-2 pb-24">
            {episodes.map((ep, i) => {
              const isActive = currentEpisode?.audioUrl === ep.audioUrl;
              const isCurrentlyPlaying = isActive && isPlaying;
              const hasBeenPlayed = playedUrls.has(ep.audioUrl) && !isActive;
              const isFinished = finishedUrls.has(ep.audioUrl) && !isActive;
              const progress = isActive && duration ? (currentTime / duration) * 100 : 0;
              const savedProgress = !isActive ? getCachedProgress(ep.audioUrl) : null;
              const savedProgressPct = savedProgress && savedProgress.duration_seconds > 0 && !savedProgress.finished
                ? (savedProgress.position_seconds / savedProgress.duration_seconds) * 100
                : 0;
              return (
                <motion.div
                  key={ep.audioUrl || ep.link || `${ep.feedUrl || 'episode'}-${ep.title || i}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                >
                {!isActive ? (
                  <SwipeableEpisodeRow
                    isFinished={isFinished}
                    onMarkFinished={() => markFinished(ep.audioUrl)}
                    onMarkUnfinished={() => setFinishedUrls(prev => { const s = new Set(prev); s.delete(ep.audioUrl); return s; })}
                  >
                    <button
                  onClick={() => handlePlayEpisode(ep)}
                  className={cn(
                    "w-full text-left flex flex-col gap-0 p-3 rounded-2xl border transition-all",
                    isActive
                      ? "border-primary/60 bg-primary/10"
                      : hasBeenPlayed
                      ? "border-border bg-muted/40"
                      : "border-border bg-card hover:border-primary/30"
                  )}
                >
                  <div className="flex gap-3">
                    <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-secondary">
                      {ep.image
                        ? <img src={ep.image} alt="" className={cn("w-full h-full object-cover", hasBeenPlayed && "opacity-50")} />
                        : <div className={cn("w-full h-full bg-gradient-to-br", gradient, hasBeenPlayed && "opacity-50")} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "text-sm font-medium line-clamp-2 underline-offset-2 hover:underline cursor-pointer",
                          isActive ? "text-primary" : hasBeenPlayed ? "text-muted-foreground" : "text-foreground"
                        )}
                        onClick={e => { e.stopPropagation(); setSelectedEpisode(ep); }}
                      >
                        {ep.title}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 mt-1">
                        {ep.feedUrl ? (
                          <Link
                            to={`/podcast/${encodeURIComponent(ep.feedUrl)}`}
                            onClick={e => e.stopPropagation()}
                            className="text-xs text-primary/80 hover:text-primary transition-colors underline-offset-2 hover:underline"
                          >
                            {ep.feedTitle}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">{ep.feedTitle}</span>
                        )}
                        {ep.duration && <span className="text-xs text-muted-foreground">• {ep.duration}</span>}
                        {ep.pubDate && !isNaN(new Date(ep.pubDate).getTime()) && (
                          <span className="text-xs text-muted-foreground">
                            • {format(new Date(ep.pubDate), "d MMM yyyy", { locale: ptBR })}
                          </span>
                        )}
                        {hasBeenPlayed && <span className="text-xs text-muted-foreground/60 italic">• ouvido</span>}
                      </div>
                    </div>
                    <EpisodeActionButton
                      ep={ep}
                      isActive={isActive}
                      isCurrentlyPlaying={isCurrentlyPlaying}
                      isFinished={isFinished}
                      progressPct={savedProgressPct}
                      onShortPress={() => handlePlayEpisode(ep)}
                      onMarkFinished={() => markFinished(ep.audioUrl)}
                      onMarkUnfinished={() => setFinishedUrls(prev => { const s = new Set(prev); s.delete(ep.audioUrl); return s; })}
                    />
                  </div>

                  {/* Saved progress bar — for non-active episodes with partial progress */}
                  {!isActive && savedProgressPct > 1 && (
                    <div className="mt-2 px-0.5">
                      <div className="h-1 bg-border rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/50"
                          style={{ width: `${savedProgressPct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Progress bar — only for the active episode */}
                  {isActive && (
                    <div className="mt-2.5 px-0.5">
                      <div
                        className="relative h-2 bg-border rounded-full overflow-hidden cursor-pointer"
                        onClick={e => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          seek(((e.clientX - rect.left) / rect.width) * duration);
                        }}
                        onTouchEnd={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          const touch = e.changedTouches[0];
                          const rect = e.currentTarget.getBoundingClientRect();
                          seek(((touch.clientX - rect.left) / rect.width) * duration);
                        }}
                      >
                        <div
                          className="absolute top-0 left-0 h-full rounded-full gradient-primary transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary shadow-lg shadow-primary/50 transition-all"
                          style={{ left: `${progress}%`, transform: 'translate(-50%, -50%)' }}
                        />
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-xs text-primary/80">{formatDuration(Math.floor(currentTime))}</span>
                        <span className="text-xs text-muted-foreground">{formatDuration(Math.floor(duration))}</span>
                      </div>
                    </div>
                  )}
                </button>
                  </SwipeableEpisodeRow>
                ) : (
                    <button
                      onClick={() => handlePlayEpisode(ep)}
                      className={cn(
                        "w-full text-left flex flex-col gap-0 p-3 rounded-2xl border transition-all",
                        isActive
                          ? "border-primary/60 bg-primary/10"
                          : hasBeenPlayed
                          ? "border-border bg-muted/40"
                          : "border-border bg-card hover:border-primary/30"
                      )}
                    >
                      <div className="flex gap-3">
                        <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-secondary">
                          {ep.image
                            ? <img src={ep.image} alt="" className={cn("w-full h-full object-cover", hasBeenPlayed && "opacity-50")} />
                            : <div className={cn("w-full h-full bg-gradient-to-br", gradient, hasBeenPlayed && "opacity-50")} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={cn(
                              "text-sm font-medium line-clamp-2 underline-offset-2 hover:underline cursor-pointer",
                              isActive ? "text-primary" : hasBeenPlayed ? "text-muted-foreground" : "text-foreground"
                            )}
                            onClick={e => { e.stopPropagation(); setSelectedEpisode(ep); }}
                          >
                            {ep.title}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 mt-1">
                            {ep.feedUrl ? (
                              <Link
                                to={`/podcast/${encodeURIComponent(ep.feedUrl)}`}
                                onClick={e => e.stopPropagation()}
                                className="text-xs text-primary/80 hover:text-primary transition-colors underline-offset-2 hover:underline"
                              >
                                {ep.feedTitle}
                              </Link>
                            ) : (
                              <span className="text-xs text-muted-foreground">{ep.feedTitle}</span>
                            )}
                            {ep.duration && <span className="text-xs text-muted-foreground">• {ep.duration}</span>}
                            {ep.pubDate && !isNaN(new Date(ep.pubDate).getTime()) && (
                              <span className="text-xs text-muted-foreground">
                                • {format(new Date(ep.pubDate), "d MMM yyyy", { locale: ptBR })}
                              </span>
                            )}
                            {hasBeenPlayed && <span className="text-xs text-muted-foreground/60 italic">• {t('detailHeard')}</span>}
                          </div>
                        </div>
                        <EpisodeActionButton
                          ep={ep}
                          isActive={isActive}
                          isCurrentlyPlaying={isCurrentlyPlaying}
                          isFinished={isFinished}
                          progressPct={savedProgressPct}
                          onShortPress={() => handlePlayEpisode(ep)}
                          onMarkFinished={() => markFinished(ep.audioUrl)}
                          onMarkUnfinished={() => setFinishedUrls(prev => { const s = new Set(prev); s.delete(ep.audioUrl); return s; })}
                        />
                      </div>

                      {/* Saved progress bar — for non-active episodes with partial progress */}
                      {!isActive && savedProgressPct > 1 && (
                        <div className="mt-2 px-0.5">
                          <div className="h-1 bg-border rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary/50"
                              style={{ width: `${savedProgressPct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Progress bar — only for the active episode */}
                      {isActive && (
                        <div className="mt-2.5 px-0.5">
                          <div
                            className="relative h-2 bg-border rounded-full overflow-hidden cursor-pointer"
                            onClick={e => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              seek(((e.clientX - rect.left) / rect.width) * duration);
                            }}
                            onTouchEnd={e => {
                              e.preventDefault();
                              e.stopPropagation();
                              const touch = e.changedTouches[0];
                              const rect = e.currentTarget.getBoundingClientRect();
                              seek(((touch.clientX - rect.left) / rect.width) * duration);
                            }}
                          >
                            <div
                              className="absolute top-0 left-0 h-full rounded-full gradient-primary transition-all duration-300"
                              style={{ width: `${progress}%` }}
                            />
                            <div
                              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary shadow-lg shadow-primary/50 transition-all"
                              style={{ left: `${progress}%`, transform: 'translate(-50%, -50%)' }}
                            />
                          </div>
                          <div className="flex justify-between mt-1">
                            <span className="text-xs text-primary/80">{formatDuration(Math.floor(currentTime))}</span>
                            <span className="text-xs text-muted-foreground">{formatDuration(Math.floor(duration))}</span>
                          </div>
                        </div>
                      )}
                    </button>
                )}
                </motion.div>
                );
                })}
                </div>
                )}
                </div>
      <AnimatePresence>
        {selectedEpisode && (
          <EpisodeDetailModal
            episode={selectedEpisode}
            isActive={currentEpisode?.audioUrl === selectedEpisode.audioUrl}
            isPlaying={isPlaying}
            onPlay={handlePlayEpisode}
            onClose={() => setSelectedEpisode(null)}
            gradient={gradient}
          />
        )}
      </AnimatePresence>
    </div>
    </PageTransition>
    {editingPlaylist && playlist && (
      <EditPlaylistModal
        playlist={playlist}
        onClose={() => setEditingPlaylist(false)}
        onSaved={() => refetchPlaylist()}
      />
    )}
    <BottomNav />
    </>
  );
}
