import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { voxylApi } from '@/api/voxylApiClient';
import { parseDurationToSeconds } from '@/lib/rssUtils';
import { Share2, Headphones, Star, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { redirectToLogin } from '@/lib/authRedirect';
import { useAuth } from '@/lib/AuthContext';

const GRADIENT_COLORS = [
  'from-purple-600 to-cyan-400',
  'from-pink-600 to-purple-600',
  'from-blue-600 to-cyan-400',
  'from-orange-500 to-pink-600',
];

export default function PlaylistPreview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [loadingEps, setLoadingEps] = useState(false);
  const { isAuthenticated, isLoadingAuth } = useAuth();

  useEffect(() => {
    // If already logged in, go straight to the full detail page (with all features)
    if (isAuthenticated) navigate(`/playlist/${id}`, { replace: true });
  }, [id, isAuthenticated, navigate]);
  // Note: guests (/share/:id) see a preview — /playlist/:id is now open to guests too

  useEffect(() => {
    voxylApi.entities.Playlist.filter({ id })
      .then(data => {
        const pl = data[0] || null;
        setPlaylist(pl);
        // Inject dynamic OpenGraph meta tags so WhatsApp/social previews show playlist info
        if (pl) {
          const setMeta = (prop, content, attr = 'property') => {
            let el = document.querySelector(`meta[${attr}="${prop}"]`);
            if (!el) { el = document.createElement('meta'); el.setAttribute(attr, prop); document.head.appendChild(el); }
            el.setAttribute('content', content);
          };
          const ogImage = pl.cover_image ||
            `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(pl.name)}&size=1200&backgroundColor=7c3aed,3b82f6`;
          const title = `${pl.name} — playlist por ${pl.creator_name} | Voxyl`;
          const desc = pl.description || `${pl.rss_feeds?.length || 0} feeds de podcast curados por ${pl.creator_name}`;
          const url = `${window.location.origin}/share/${id}`;

          document.title = title;
          setMeta('og:title', title);
          setMeta('og:description', desc);
          setMeta('og:image', ogImage);
          setMeta('og:url', url);
          setMeta('og:type', 'music.playlist');
          setMeta('twitter:title', title, 'name');
          setMeta('twitter:description', desc, 'name');
          setMeta('twitter:image', ogImage, 'name');
          setMeta('twitter:card', 'summary_large_image', 'name');
        }
      });
  }, [id]);

  useEffect(() => {
    if (!playlist?.rss_feeds?.length) return;
    setLoadingEps(true);
    Promise.allSettled(
      playlist.rss_feeds.slice(0, 2).map(f =>
        voxylApi.functions.invoke('fetchRSSFeed', { url: f.url, count: 10 }).then(r => r.data)
      )
    )
      .then(results => {
        const eps = results
          .filter(r => r.status === 'fulfilled' && r.value?.items)
          .flatMap(r => r.value.items.map(ep => ({
            ...ep,
            audioUrl: ep.audioUrl?.replace(/&amp;/g, '&'),
            image: ep.image?.replace(/&amp;/g, '&'),
          })))
          .filter(ep => {
            if (!playlist.max_duration || playlist.max_duration === 0) return true;
            const secs = parseDurationToSeconds(ep.duration);
            return !secs || secs <= playlist.max_duration * 60;
          })
          .slice(0, 5);
        setEpisodes(eps);
      })
      .finally(() => setLoadingEps(false));
  }, [playlist]);

  const handleCTA = () => {
    // Save the pending playlist ID + creator info to localStorage so after signup we auto-follow it
    localStorage.setItem('voxyl_pending_playlist', id);
    localStorage.setItem('voxyl_pending_creator_id', playlist?.creator_id);
    redirectToLogin(`${window.location.origin}/playlist/${id}`).catch(() => {});
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: playlist?.name, text: playlist?.description, url });
    } else {
      navigator.clipboard.writeText(url);
    }
  };

  // Still checking auth
  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const gradient = GRADIENT_COLORS[id?.charCodeAt(0) % GRADIENT_COLORS.length];

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto flex flex-col">
      {/* Hero */}
      <div className={cn("relative h-64 bg-gradient-to-br flex-shrink-0", gradient)}>
        <div className="absolute inset-0 bg-black/50" />

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 px-4 pt-12 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full gradient-primary flex items-center justify-center">
              <span className="text-white font-grotesk font-bold text-xs">V</span>
            </div>
            <span className="text-white font-grotesk font-semibold text-sm">Voxyl</span>
          </div>
          <button onClick={handleShare} className="w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <Share2 size={16} className="text-white" />
          </button>
        </div>

        {/* Playlist info */}
        <div className="absolute bottom-4 left-4 right-4 z-10">
          {playlist ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <p className="text-xs text-white/60 mb-1 font-medium uppercase tracking-wider">Playlist compartilhada</p>
              <h1 className="text-2xl font-grotesk font-bold text-white leading-tight">{playlist.name}</h1>
              <p className="text-sm text-white/70 mt-0.5">por {playlist.creator_name} • {playlist.rss_feeds?.length || 0} feeds</p>
            </motion.div>
          ) : (
            <div className="space-y-2">
              <div className="h-3 w-24 bg-white/20 rounded animate-pulse" />
              <div className="h-6 w-48 bg-white/20 rounded animate-pulse" />
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      {playlist && (
        <div className="flex divide-x divide-border border-b border-border">
          <div className="flex-1 flex flex-col items-center py-3">
            <p className="text-lg font-bold text-foreground">{playlist.likes_count || 0}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Star size={10} /> curtidas</p>
          </div>
          <div className="flex-1 flex flex-col items-center py-3">
            <p className="text-lg font-bold text-foreground">{playlist.plays_count || 0}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Headphones size={10} /> plays</p>
          </div>
          <div className="flex-1 flex flex-col items-center py-3">
            <p className="text-lg font-bold text-foreground">{playlist.rss_feeds?.length || 0}</p>
            <p className="text-xs text-muted-foreground">feeds RSS</p>
          </div>
        </div>
      )}

      {/* Description */}
      {playlist?.description && (
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm text-muted-foreground">{playlist.description}</p>
        </div>
      )}

      {/* Episode preview */}
      <div className="flex-1 px-4 pt-4 pb-40">
        <h2 className="font-semibold text-sm text-foreground mb-3 flex items-center gap-2">
          Prévia dos episódios
        </h2>

        {loadingEps ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-2xl bg-card border border-border animate-pulse">
                <div className="w-12 h-12 rounded-xl bg-secondary flex-shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3 bg-secondary rounded w-3/4" />
                  <div className="h-2 bg-secondary rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {episodes.map((ep, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex gap-3 p-3 rounded-2xl border border-border bg-card"
              >
                <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-secondary">
                  {ep.image
                    ? <img src={ep.image} alt="" className="w-full h-full object-cover" />
                    : <div className={cn("w-full h-full bg-gradient-to-br", gradient)} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground line-clamp-2">{ep.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{ep.feedTitle}</p>
                </div>
                {/* Blurred lock on the play button to hint it's gated */}
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-1">
                  <Lock size={12} className="text-muted-foreground" />
                </div>
              </motion.div>
            ))}

            {episodes.length > 0 && (
              <div className="relative mt-1">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background z-10 pointer-events-none rounded-b-2xl" />
                <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
                  <Lock size={12} />
                  <span>+{Math.max(0, (playlist?.plays_count || 0))} episódios disponíveis após cadastro</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CTA — fixed bottom */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md px-4 pb-8 pt-4 bg-gradient-to-t from-background via-background to-transparent z-50">
        <motion.button
          onClick={handleCTA}
          whileTap={{ scale: 0.97 }}
          className="w-full py-4 rounded-2xl gradient-primary glow-primary text-white font-grotesk font-bold text-lg flex items-center justify-center gap-3 shadow-2xl"
        >
          <Headphones size={22} />
          Ouvir grátis no Voxyl
        </motion.button>
        <p className="text-center text-xs text-muted-foreground mt-2">
          Cadastro gratuito • Sem cartão de crédito
        </p>
      </div>
    </div>
  );
}
