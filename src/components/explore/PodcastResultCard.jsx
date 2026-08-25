import { Plus, Mic, Heart } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export default function PodcastResultCard({ podcast, index, onAdd, onLike, liked }) {
  const descriptionText = podcast.description?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="rounded-2xl bg-card border border-border hover:border-primary/30 transition-all overflow-hidden"
    >
      <div className="flex gap-3 p-3">
        {/* Cover */}
        {podcast.image ? (
          <img
            src={podcast.image}
            alt={podcast.title}
            className="w-14 h-14 rounded-xl object-cover flex-shrink-0 bg-secondary"
            onError={e => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="w-14 h-14 rounded-xl flex-shrink-0 bg-secondary flex items-center justify-center">
            <Mic size={20} className="text-muted-foreground" />
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <Link
            to={`/podcast/${encodeURIComponent(podcast.feedUrl)}`}
            className="font-semibold text-sm text-foreground leading-tight hover:text-primary transition-colors line-clamp-2 block"
            style={{
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            {podcast.title}
          </Link>
          {podcast.author && <p className="text-xs text-primary truncate mt-0.5">{podcast.author}</p>}
          {podcast.episodeCount > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">{podcast.episodeCount} episódios</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-center gap-1.5 flex-shrink-0 self-center">
          <button
            onClick={() => onLike?.(podcast)}
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center transition-all",
              liked ? "bg-red-500/20 text-red-400" : "bg-secondary text-muted-foreground hover:text-red-400"
            )}
          >
            <Heart size={15} fill={liked ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => onAdd(podcast)}
            className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center glow-primary hover:opacity-90 transition-opacity"
          >
            <Plus size={15} className="text-white" />
          </button>
        </div>
      </div>

      {descriptionText && (
        <p
          className="px-3 pb-3 text-xs text-muted-foreground leading-relaxed line-clamp-2"
          style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
          }}
        >
          {descriptionText}
        </p>
      )}
    </motion.div>
  );
}