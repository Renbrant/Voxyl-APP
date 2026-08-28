import { Link } from 'react-router-dom';
import { Mic, Heart, Play } from 'lucide-react';
import { htmlToPlainText } from '@/lib/text';

export default function LikedPodcastCard({ podcastLike, onUnlike }) {
  const description = htmlToPlainText(podcastLike.podcast_description);
  return (
    <Link
      to={`/podcast/${encodeURIComponent(podcastLike.feed_url)}`}
      className="flex gap-3 p-3 rounded-2xl bg-card border border-border items-center cursor-pointer hover:border-primary/40 transition-all active:scale-95 no-underline"
    >
      {podcastLike.podcast_image ? (
        <img
          src={podcastLike.podcast_image}
          alt={podcastLike.podcast_title}
          className="w-14 h-14 rounded-xl object-cover flex-shrink-0 bg-secondary"
        />
      ) : (
        <div className="w-14 h-14 rounded-xl flex-shrink-0 bg-secondary flex items-center justify-center">
          <Mic size={20} className="text-muted-foreground" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-foreground truncate">{podcastLike.podcast_title}</p>
        {podcastLike.podcast_author && (
          <p className="text-xs text-primary truncate mt-0.5">{podcastLike.podcast_author}</p>
        )}
        {description && (
          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{description}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
          <Play size={14} fill="currentColor" />
        </div>
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onUnlike(); }}
          className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors"
        >
          <Heart size={15} fill="currentColor" />
        </button>
      </div>
    </Link>
  );
}