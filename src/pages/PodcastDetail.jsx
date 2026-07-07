import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { usePlayer } from '@/lib/PlayerContext';
import { formatDuration } from '@/lib/rssUtils';
import { getFeedFromCache, saveFeedToCache, getRSSCacheFromCloud } from '@/lib/feedCache';
import { t } from '@/lib/i18n';
import { ArrowLeft, Play, Loader2, ListMusic, Heart, Info, X } from 'lucide-react';
import PageTransition from '@/components/common/PageTransition';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import EpisodeDetailModal from '@/components/player/EpisodeDetailModal';
import EpisodeActionButton from '@/components/player/EpisodeActionButton';
import SwipeableEpisodeRow from '@/components/player/SwipeableEpisodeRow';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function PodcastDetail() {
  const { feedUrl: encodedFeedUrl } = useParams();
  const feedUrl = decodeURIComponent(encodedFeedUrl);
  const navigate = useNavigate();
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [podcastMeta, setPodcastMeta] = useState(null);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [liked, setLiked] = useState(false);
  const [user, setUser] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [feedSource, setFeedSource] = useState('none');
  const { play, currentEpisode, isPlaying, togglePlay, seek, currentTime, duration, finishedUrls, setFinishedUrls, markFinished, getCachedProgress } = usePlayer();

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      base44.entities.PodcastLike.filter({ user_id: u.id, feed_url: feedUrl })
        .then(r => setLiked(r.length > 0))
        .catch(() => {});
    }).catch(() => {});
  }, [feedUrl]);

  useEffect(() => {
    if (!feedUrl) return;

    // Reset state when feedUrl changes to avoid showing stale data
    setPodcastMeta(null);
    setEpisodes([]);
    setFeedSource('none');

    let cancelled = false;

    const applyData = (data) => {
      if (cancelled) return;
      setPodcastMeta({
        title: data.title || '',
        image: data.image || '',
        description: data.description || '',
        author: data.author || '',
      });
      setEpisodes((data.items || []).map(ep => ({
        ...ep,
        audioUrl: ep.audioUrl?.replace(/&amp;/g, '&'),
        image: ep.image?.replace(/&amp;/g, '&') || data.image,
      })));
    };

    // Load from cache instantly if available
    const cached = getFeedFromCache(feedUrl);
    if (cached) {
      applyData(cached);
      setFeedSource('local');
    } else {
      setLoading(true);
    }

    // Fetch in background with cloud cache fallback
    (async () => {
      try {
        let fresh;
        let source = 'rss';
        
        const cloudCached = await getRSSCacheFromCloud(feedUrl).catch(() => null);
        if (cloudCached) {
          fresh = cloudCached;
        } else {
          const res = await base44.functions.invoke('fetchRSSFeed', { url: feedUrl, count: 100 });
          fresh = res.data || res;
        }
        
        if (cancelled) return;

        saveFeedToCache(feedUrl, fresh).catch(() => {});
          
        if (!cached) {
          applyData(fresh);
          if (!cancelled) setFeedSource(source);
        } else {
          const oldUrls = new Set(cached.items?.map(e => e.audioUrl).filter(Boolean) || []);
          const newItems = fresh.items?.filter(e => e.audioUrl && !oldUrls.has(e.audioUrl)) || [];
          if (newItems.length > 0) {
            const merged = {
              ...cached,
              items: [...newItems, ...cached.items],
            };
            applyData(merged);
          }
          if (!cancelled) setFeedSource(source);
        }
      } catch (error) {
        console.error('Erro ao carregar feed:', error);
      }
    })().finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [feedUrl]);

  const handlePlayEpisode = (ep) => {
    if (currentEpisode?.audioUrl === ep.audioUrl) { togglePlay(); return; }
    play(ep, episodes, { type: 'podcast', id: feedUrl });
  };

  const handleLike = async () => {
    if (!user) return;
    if (liked) {
      const records = await base44.entities.PodcastLike.filter({ user_id: user.id, feed_url: feedUrl });
      if (records[0]) await base44.entities.PodcastLike.delete(records[0].id);
      setLiked(false);
    } else {
      await base44.entities.PodcastLike.create({
        user_id: user.id,
        user_email: user.email,
        feed_url: feedUrl,
        podcast_title: podcastMeta?.title || '',
        podcast_author: podcastMeta?.author || '',
        podcast_image: podcastMeta?.image || '',
        podcast_description: podcastMeta?.description || '',
      });
      setLiked(true);
    }
  };

  const gradient = 'from-purple-600 to-cyan-400';

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 pt-12 pb-3 bg-background">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center" style={{ WebkitTapHighlightColor: 'transparent' }}>
            <ArrowLeft size={18} className="text-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowInfo(true)} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
              <Info size={16} />
            </button>
            <button
              onClick={handleLike}
              className={cn("w-9 h-9 rounded-full bg-secondary flex items-center justify-center", liked ? "text-red-400" : "text-muted-foreground")}
            >
              <Heart size={16} fill={liked ? "currentColor" : "none"} />
            </button>
          </div>
        </div>

        {/* Cover + info row */}
        <div className="flex gap-4 px-4 pb-4 bg-background">
          <div className={cn("w-24 h-24 rounded-2xl flex-shrink-0 bg-gradient-to-br overflow-hidden relative", gradient)}>
            {podcastMeta?.image && (
              <img src={podcastMeta.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            {podcastMeta ? (
              <>
                <h1 className="text-xl font-grotesk font-bold text-foreground leading-tight line-clamp-2">{podcastMeta.title}</h1>
                {podcastMeta.author && <p className="text-sm text-muted-foreground mt-0.5">{podcastMeta.author}</p>}
              </>
            ) : (
              <div className="h-16 animate-pulse rounded-xl bg-secondary" />
            )}
          </div>
        </div>

        {/* Episodes */}
        <div className="px-4 mt-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <ListMusic size={16} className="text-primary" /> {t('detailEpisodes')}
              {episodes.length > 0 && <span className="text-muted-foreground text-sm font-normal">({episodes.length})</span>}
              {feedSource === 'local' && episodes.length > 0 && <span className="text-xs px-2 py-1 rounded-full bg-accent/10 text-accent font-medium">{t('detailCached')}</span>}
              {!loading && feedSource === 'rss' && episodes.length > 0 && <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">{t('detailUpdated')}</span>}
            </h2>
            {episodes.length > 0 && (
              <button
                onClick={() => {
                  const next = episodes.find(ep => !finishedUrls.has(ep.audioUrl)) || episodes[0];
                  play(next, episodes);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full gradient-primary text-white text-xs font-medium"
              >
                <Play size={12} fill="white" /> {t('detailPlayAll')}
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col items-center py-12 gap-3 text-muted-foreground">
              <Loader2 size={24} className="animate-spin text-primary" />
              <p className="text-sm">{t('detailLoadingFeeds')}</p>
            </div>
          ) : (
            <div className="space-y-2 pb-32">
              {episodes.map((ep, i) => {
                const isActive = currentEpisode?.audioUrl === ep.audioUrl;
                const isCurrentlyPlaying = isActive && isPlaying;
                const isFinished = finishedUrls.has(ep.audioUrl) && !isActive;
                const progress = isActive && duration ? (currentTime / duration) * 100 : 0;
                const savedProgress = !isActive ? getCachedProgress(ep.audioUrl) : null;
                const savedProgressPct = savedProgress && savedProgress.duration_seconds > 0 && !savedProgress.finished
                  ? (savedProgress.position_seconds / savedProgress.duration_seconds) * 100
                  : 0;
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.4) }}>
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
                          isActive ? "border-primary/60 bg-primary/10" : "border-border bg-card hover:border-primary/30"
                        )}
                      >
                        <div className="flex gap-3">
                          <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-secondary">
                            {ep.image
                              ? <img src={ep.image} alt="" className="w-full h-full object-cover" />
                              : <div className={cn("w-full h-full bg-gradient-to-br", gradient)} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p
                              className={cn(
                                "text-sm font-medium line-clamp-2",
                                isActive ? "text-primary" : "text-foreground"
                              )}
                              onClick={e => { e.stopPropagation(); setSelectedEpisode(ep); }}
                            >
                              {ep.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-2 mt-1">
                              {ep.duration && <span className="text-xs text-muted-foreground">{ep.duration}</span>}
                              {ep.pubDate && (
                                <span className="text-xs text-muted-foreground">
                                  • {format(new Date(ep.pubDate), "d MMM yyyy", { locale: ptBR })}
                                </span>
                              )}
                            </div>
                          </div>
                          <EpisodeActionButton
                            ep={ep}
                            isActive={isActive}
                            isCurrentlyPlaying={isCurrentlyPlaying}
                            isFinished={isFinished}
                            onShortPress={() => handlePlayEpisode(ep)}
                            onMarkFinished={() => markFinished(ep.audioUrl)}
                            onMarkUnfinished={() => setFinishedUrls(prev => { const s = new Set(prev); s.delete(ep.audioUrl); return s; })}
                          />
                        </div>

                        {!isActive && savedProgressPct > 1 && (
                          <div className="mt-2 px-0.5">
                            <div className="h-1 bg-border rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-primary/50" style={{ width: `${savedProgressPct}%` }} />
                            </div>
                          </div>
                        )}

                        {isActive && (
                           <div className="mt-2.5 px-0.5">
                             <div
                               className="relative h-2 bg-border rounded-full overflow-hidden cursor-pointer"
                               onClick={e => {
                                 e.stopPropagation();
                                 const rect = e.currentTarget.getBoundingClientRect();
                                 seek(((e.clientX - rect.left) / rect.width) * duration);
                               }}
                             >
                               <div className="absolute top-0 left-0 h-full rounded-full gradient-primary transition-all duration-300" style={{ width: `${progress}%` }} />
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
                              isActive ? "border-primary/60 bg-primary/10" : "border-border bg-card hover:border-primary/30"
                            )}
                          >
                            <div className="flex gap-3">
                              <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-secondary">
                                {ep.image
                                  ? <img src={ep.image} alt="" className="w-full h-full object-cover" />
                                  : <div className={cn("w-full h-full bg-gradient-to-br", gradient)} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p
                                  className={cn(
                                    "text-sm font-medium line-clamp-2",
                                    isActive ? "text-primary" : "text-foreground"
                                  )}
                                  onClick={e => { e.stopPropagation(); setSelectedEpisode(ep); }}
                                >
                                  {ep.title}
                                </p>
                                <div className="flex flex-wrap items-center gap-x-2 mt-1">
                                  {ep.duration && <span className="text-xs text-muted-foreground">{ep.duration}</span>}
                                  {ep.pubDate && (
                                    <span className="text-xs text-muted-foreground">
                                      • {format(new Date(ep.pubDate), "d MMM yyyy", { locale: ptBR })}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <EpisodeActionButton
                                ep={ep}
                                isActive={isActive}
                                isCurrentlyPlaying={isCurrentlyPlaying}
                                isFinished={isFinished}
                                onShortPress={() => handlePlayEpisode(ep)}
                                onMarkFinished={() => markFinished(ep.audioUrl)}
                                onMarkUnfinished={() => setFinishedUrls(prev => { const s = new Set(prev); s.delete(ep.audioUrl); return s; })}
                              />
                            </div>

                            {!isActive && savedProgressPct > 1 && (
                              <div className="mt-2 px-0.5">
                                <div className="h-1 bg-border rounded-full overflow-hidden">
                                  <div className="h-full rounded-full bg-primary/50" style={{ width: `${savedProgressPct}%` }} />
                                </div>
                              </div>
                            )}

                            {isActive && (
                               <div className="mt-2.5 px-0.5">
                                 <div
                                   className="relative h-2 bg-border rounded-full overflow-hidden cursor-pointer"
                                   onClick={e => {
                                     e.stopPropagation();
                                     const rect = e.currentTarget.getBoundingClientRect();
                                     seek(((e.clientX - rect.left) / rect.width) * duration);
                                   }}
                                 >
                                   <div className="absolute top-0 left-0 h-full rounded-full gradient-primary transition-all duration-300" style={{ width: `${progress}%` }} />
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
          {showInfo && podcastMeta && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 z-40"
                onClick={() => setShowInfo(false)}
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-3xl border-t border-border p-6"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)', maxHeight: '80vh', overflowY: 'auto' }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {podcastMeta.image && (
                      <img src={podcastMeta.image} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <h3 className="font-grotesk font-bold text-foreground leading-tight line-clamp-2">{podcastMeta.title}</h3>
                      {podcastMeta.author && <p className="text-sm text-primary mt-0.5">{podcastMeta.author}</p>}
                    </div>
                  </div>
                  <button onClick={() => setShowInfo(false)} className="p-2 rounded-full hover:bg-secondary transition-colors flex-shrink-0 ml-2">
                    <X size={18} className="text-muted-foreground" />
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ListMusic size={14} className="text-primary flex-shrink-0" />
                    <span>{episodes.length} episódios disponíveis</span>
                  </div>
                  {podcastMeta.description && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Sobre o podcast</p>
                      <p className="text-sm text-foreground/80 leading-relaxed">
                        {podcastMeta.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()}
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

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
  );
}