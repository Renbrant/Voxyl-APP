import { Play, Pause, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePlayer } from '@/lib/PlayerContext';
import { removeDownload } from '@/lib/downloads';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function DownloadedEpisodeCard({ episode, onRemoved }) {
  const { play, currentEpisode, isPlaying, togglePlay } = usePlayer();
  const isActive = currentEpisode?.audioUrl === episode.audioUrl;
  const isCurrentlyPlaying = isActive && isPlaying;

  const handlePlay = () => {
    if (isActive) { togglePlay(); return; }
    play(episode, [episode], { type: 'download', id: null });
  };

  const handleRemove = (e) => {
    e.stopPropagation();
    removeDownload(episode.audioUrl);
    onRemoved();
  };

  return (
    <div className={cn(
      "flex gap-3 p-3 rounded-2xl border transition-all",
      isActive ? "border-primary/60 bg-primary/10" : "border-border bg-card"
    )}>
      <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-secondary">
        {episode.image
          ? <img src={episode.image} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-gradient-to-br from-primary to-accent" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-medium line-clamp-2", isActive ? "text-primary" : "text-foreground")}>
          {episode.title}
        </p>
        <div className="flex items-center gap-2 mt-1">
          {episode.feedTitle && <span className="text-xs text-primary/80 truncate">{episode.feedTitle}</span>}
          {episode.pubDate && (
            <span className="text-xs text-muted-foreground">
              • {format(new Date(episode.pubDate), "d MMM yyyy", { locale: ptBR })}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={handlePlay}
          className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center"
        >
          {isCurrentlyPlaying
            ? <Pause size={12} fill="white" className="text-white" />
            : <Play size={12} fill="white" className="text-white ml-0.5" />
          }
        </button>
        <button
          onClick={handleRemove}
          className="w-8 h-8 rounded-full bg-destructive/10 text-destructive flex items-center justify-center"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
