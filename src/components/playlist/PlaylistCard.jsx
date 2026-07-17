import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Play, Heart, Share2, MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPlaylistCoverImage } from '@/lib/playlistCoverHelper';
import ReportBlockMenu from '@/components/moderation/ReportBlockMenu';
import EditPlaylistModal from '@/components/playlist/EditPlaylistModal';
import VisibilityBadge from '@/components/playlist/VisibilityBadge';

const GRADIENT_COLORS = [
  'from-purple-600 to-cyan-400',
  'from-pink-600 to-purple-600',
  'from-blue-600 to-cyan-400',
  'from-orange-500 to-pink-600',
  'from-green-500 to-cyan-400',
];

export default function PlaylistCard({ playlist, onLike = null, liked = false, compact = false, currentUser = null, onBlocked = null, onEdited = null }) {
  const [editingPlaylist, setEditingPlaylist] = useState(false);
  const [coverImage, setCoverImage] = useState(null);
  const gradient = GRADIENT_COLORS[playlist.id?.charCodeAt(0) % GRADIENT_COLORS.length] || GRADIENT_COLORS[0];
  const isOwner = currentUser && currentUser.id === playlist.creator_id;

  useEffect(() => {
    getPlaylistCoverImage(playlist).then(img => setCoverImage(img));
  }, [playlist]);

  const handleShare = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}/share/${playlist.id}`;
    if (navigator.share) {
      await navigator.share({ title: playlist.name, text: playlist.description, url });
    } else {
      navigator.clipboard.writeText(url);
    }
  };

  return (
    <>
    <Link to={`/playlist/${playlist.id}`} className="block">
      <div className={cn(
        "group relative rounded-2xl overflow-hidden border border-border bg-card transition-all duration-200 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 active:scale-95",
        compact ? "flex gap-3 p-3 items-center" : ""
      )}>
        {compact ? (
          <>
            <div className={cn("w-14 h-14 rounded-xl flex-shrink-0 bg-gradient-to-br relative overflow-hidden", gradient)}>
              {coverImage && (
                <img src={coverImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate mb-0.5">{playlist.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {playlist.creator_username ? `@${playlist.creator_username}` : 'Usuário'}
              </p>
              <p className="text-xs text-muted-foreground">{playlist.rss_feeds?.length || 0} feeds</p>
            </div>
            <div className="flex items-center gap-2">
              <VisibilityBadge visibility={playlist.visibility || 'public'} />
              <button
                onClick={e => { e.preventDefault(); e.stopPropagation(); onLike?.(playlist); }}
                onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); onLike?.(playlist); }}
                className={cn("p-1.5 rounded-full", liked ? "text-red-400" : "text-muted-foreground")}
              >
                <Heart size={16} fill={liked ? "currentColor" : "none"} />
              </button>
              <button onClick={handleShare} className="p-1.5 rounded-full text-muted-foreground">
                <Share2 size={16} />
              </button>
              {isOwner ? (
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setEditingPlaylist(true); }}
                  onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); setEditingPlaylist(true); }}
                  className="p-1.5 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                >
                  <MoreVertical size={16} />
                </button>
              ) : (
                <ReportBlockMenu
                  currentUser={currentUser}
                  targetUser={{ id: playlist.creator_id, name: playlist.creator_name }}
                  contentType="playlist"
                  contentId={playlist.id}
                  contentTitle={playlist.name}
                  onBlocked={onBlocked}
                />
              )}
            </div>
          </>
        ) : (
          <>
            <div className={cn("aspect-square bg-gradient-to-br relative", gradient)}>
              {coverImage && (
                <img src={coverImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
              )}
              <div className="absolute inset-0 bg-black/10" />
              <div className="absolute top-2 right-2">
                <VisibilityBadge visibility={playlist.visibility || 'public'} />
              </div>
            </div>
            <div className="p-3">
              <p className="font-semibold text-sm line-clamp-1 mb-0.5">{playlist.name}</p>
              <p className="text-xs text-muted-foreground mb-1">
                {playlist.creator_username ? `@${playlist.creator_username}` : 'Usuário'}
              </p>
              {playlist.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{playlist.description}</p>
              )}
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{playlist.rss_feeds?.length || 0} feeds</span>
                  <span>{playlist.plays_count || 0} ▶</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-7 h-7 rounded-full gradient-primary flex items-center justify-center">
                    <Play size={13} fill="white" className="text-white ml-0.5" />
                  </div>
                  <button onClick={handleShare} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
                    <Share2 size={13} />
                  </button>
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); onLike?.(playlist); }}
                    onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); onLike?.(playlist); }}
                    className={cn("w-7 h-7 rounded-full bg-secondary flex items-center justify-center", liked ? "text-red-400" : "text-muted-foreground")}
                  >
                    <Heart size={13} fill={liked ? "currentColor" : "none"} />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Link>
    {editingPlaylist && (
      <EditPlaylistModal
        playlist={playlist}
        user={currentUser}
        onClose={() => setEditingPlaylist(false)}
        onSaved={() => { setEditingPlaylist(false); onEdited?.(); }}
      />
    )}
    </>
  );
}
