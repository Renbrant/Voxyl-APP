import { usePlayer } from '@/lib/PlayerContext';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, SkipBack, SkipForward, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDuration } from '@/lib/rssUtils';

export default function AudioPlayer() {
  const navigate = useNavigate();
  const { currentEpisode, isPlaying, isLoading, currentTime, duration, togglePlay, seek, playNext, playPrev, playerMinimized: minimized, setPlayerMinimized: setMinimized, episodeSource } = usePlayer();

  const handlePlayerClick = (e) => {
    // Don't navigate if clicking on buttons
    if (e.target.closest('button') || e.currentTarget.querySelector('button')?.contains(e.target)) return;
    
    if (episodeSource?.type === 'playlist' && episodeSource?.id) {
      navigate(`/playlist/${episodeSource.id}`);
    } else if (episodeSource?.type === 'podcast' && episodeSource?.id) {
      navigate(`/podcast/${encodeURIComponent(episodeSource.id)}`);
    }
  };

  if (!currentEpisode) return null;

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 w-full max-w-md z-40 px-3 animate-slide-up select-none"
      style={{ bottom: 'calc(var(--app-safe-area-bottom) + 4rem)' }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden cursor-pointer" onClick={handlePlayerClick}>
        {/* Progress bar always visible */}
        <div className="h-1 bg-border relative overflow-hidden">
          {isLoading ? (
            <div className="absolute inset-0 animate-[shimmer_1s_linear_infinite] bg-gradient-to-r from-transparent via-primary/80 to-transparent bg-[length:200%_100%]" />
          ) : (
            <div className="h-full rounded-full gradient-primary transition-all" style={{ width: `${progress}%` }} />
          )}
        </div>

        {minimized ? (
          /* Minimized bar */
          <div className="flex items-center gap-3 px-3 py-2" onClick={(e) => e.stopPropagation()}>
            <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 bg-secondary">
              {currentEpisode.image
                ? <img src={currentEpisode.image} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full gradient-primary" />}
            </div>
            <p className="flex-1 text-xs font-medium truncate text-foreground" onClick={handlePlayerClick}>{currentEpisode.title}</p>
            <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="w-7 h-7 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
              {isPlaying ? <Pause size={13} fill="white" className="text-white" /> : <Play size={13} fill="white" className="text-white ml-0.5" />}
            </button>
            <button onClick={(e) => { e.stopPropagation(); setMinimized(false); }} className="p-1 text-muted-foreground">
              <ChevronUp size={16} />
            </button>
          </div>
        ) : (
          /* Full player */
          <div className="p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-secondary">
                {currentEpisode.image
                  ? <img src={currentEpisode.image} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full gradient-primary" />}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-foreground">{currentEpisode.title}</p>
                <p className="text-xs text-muted-foreground truncate">{currentEpisode.feedTitle}</p>
                <div className="mt-1.5 py-1.5 cursor-pointer -my-1"
                  style={{ touchAction: 'none' }}
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    seek(((e.clientX - rect.left) / rect.width) * duration);
                  }}
                  onTouchEnd={e => {
                    e.preventDefault();
                    const touch = e.changedTouches[0];
                    const rect = e.currentTarget.getBoundingClientRect();
                    seek(((touch.clientX - rect.left) / rect.width) * duration);
                  }}>
                  <div className="relative h-1 bg-border rounded-full overflow-hidden">
                    {isLoading ? (
                      <div className="absolute inset-0 animate-[shimmer_1s_linear_infinite] bg-gradient-to-r from-transparent via-primary/80 to-transparent bg-[length:200%_100%]" />
                    ) : (
                      <div className="absolute top-0 left-0 h-full rounded-full gradient-primary transition-all" style={{ width: `${progress}%` }} />
                    )}
                  </div>
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-xs text-muted-foreground">{formatDuration(Math.floor(currentTime))}</span>
                  <span className="text-xs text-muted-foreground">{formatDuration(Math.floor(duration))}</span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1">
                <button onClick={() => setMinimized(true)} className="p-1 text-muted-foreground">
                  <ChevronDown size={16} />
                </button>
                <div className="flex items-center gap-1">
                  <button onClick={playPrev} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
                    <SkipBack size={16} />
                  </button>
                  <button onClick={togglePlay} className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center glow-primary transition-transform active:scale-95">
                    {isPlaying ? <Pause size={16} fill="white" className="text-white" /> : <Play size={16} fill="white" className="text-white ml-0.5" />}
                  </button>
                  <button onClick={playNext} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
                    <SkipForward size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
