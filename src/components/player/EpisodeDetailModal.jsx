import { Calendar, Clock, ArrowLeft, List, Download, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { saveDownload, isDownloaded } from '@/lib/downloads';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function EpisodeDetailModal({ episode, isActive, isPlaying, onPlay, onClose, gradient }) {
  const navigate = useNavigate();
  const [downloaded, setDownloaded] = useState(() => isDownloaded(episode?.audioUrl));

  const handleDownload = () => {
    if (downloaded) return;
    saveDownload(episode);
    setDownloaded(true);
  };
  const formattedDate = episode.pubDate
    ? format(new Date(episode.pubDate), "d 'de' MMMM 'de' yyyy", { locale: ptBR })
    : null;

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 250 }}
      className="fixed inset-0 z-50 bg-background flex flex-col"
    >
      {/* Hero header */}
      <div className={cn("relative h-52 bg-gradient-to-br flex-shrink-0", gradient)}>
        {episode.image && (
          <img src={episode.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-black/50" />
        <button
          onClick={onClose}
          className="absolute top-12 left-4 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center z-10"
        >
          <ArrowLeft size={18} className="text-white" />
        </button>
        <div className="absolute bottom-4 left-4 right-4 z-10">
          <p className="text-xs text-white/60 mb-1">{episode.feedTitle}</p>
          <h1 className="text-xl font-grotesk font-bold text-white leading-tight line-clamp-3">{episode.title}</h1>
        </div>
      </div>

      {/* Meta info */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-border flex-shrink-0">
        {formattedDate && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar size={12} /> {formattedDate}
          </span>
        )}
        {episode.duration && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock size={12} /> {episode.duration}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-5 pt-4 flex-shrink-0 flex gap-2">
        {episode.feedUrl && (
          <button
            onClick={() => { onClose(); navigate(`/podcast/${encodeURIComponent(episode.feedUrl)}`); }}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl gradient-primary text-white font-semibold"
          >
            <List size={16} />
            Ver episódios
          </button>
        )}
        <button
          onClick={handleDownload}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold transition-all ${
            downloaded ? 'bg-green-600/20 text-green-400 border border-green-600/30' : 'bg-secondary text-foreground border border-border'
          }`}
        >
          {downloaded ? <Check size={16} /> : <Download size={16} />}
          {downloaded ? 'Salvo' : 'Baixar'}
        </button>
      </div>

      {/* Description */}
      {episode.description && (
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-8">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Sobre este episódio</h3>
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{episode.description}</p>
        </div>
      )}
    </motion.div>
  );
}