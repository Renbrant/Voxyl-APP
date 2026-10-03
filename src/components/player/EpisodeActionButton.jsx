import { useState, useRef, useCallback } from 'react';
import { Play, Pause, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePlayer } from '@/lib/PlayerContext';
import { t } from '@/lib/i18n';

export default function EpisodeActionButton({ ep, isActive, isCurrentlyPlaying, isFinished, isOutroSkipped = false, onShortPress, onMarkFinished, onMarkUnfinished, progressPct = 0 }) {
  const { isLoading } = usePlayer();
  const isBuffering = isActive && isLoading;
  const [pressing, setPressing] = useState(false);
  const timerRef = useRef(null);
  const didLongPress = useRef(false);
  const hasPartialProgress = !isFinished && !isActive && progressPct > 1;

  const startPress = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    didLongPress.current = false;
    setPressing(true);
    timerRef.current = setTimeout(() => {
      didLongPress.current = true;
      setPressing(false);
      if (isFinished) {
        onMarkUnfinished();
      } else {
        onMarkFinished();
      }
    }, 3000);
  }, [isFinished, onMarkFinished, onMarkUnfinished]);

  const cancelPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPressing(false);
  }, []);

  const handleClick = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (didLongPress.current) return;
    onShortPress();
  }, [onShortPress]);

  return (
    <div
      className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 relative overflow-hidden cursor-pointer select-none",
        isActive ? "gradient-primary" : hasPartialProgress ? "bg-secondary" : "bg-secondary"
      )}
      onClick={handleClick}
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchCancel={cancelPress}
    >
      {/* Progress background for partial playback */}
      {hasPartialProgress && (
        <div
          className="absolute inset-0 rounded-full bg-primary/60"
          style={{ clipPath: `inset(${100 - progressPct}% 0 0 0)` }}
        />
      )}

      {/* Fill animation on long press */}
      {pressing && (
        <div
          className="absolute inset-0 rounded-full bg-white/20 origin-bottom"
          style={{ animation: 'grow-up 3s linear forwards' }}
        />
      )}
      {isFinished ? (
        <div className="relative flex items-center justify-center">
          <CheckCircle2 size={16} className="text-green-400 relative z-10" />
          {isOutroSkipped && (
            <span
              className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-card shadow-sm z-20"
              title={t('playerHeardOutroSkipped')}
            />
          )}
        </div>
      ) : isBuffering
        ? <Loader2 size={14} className="text-white relative z-10 animate-spin" />
        : isCurrentlyPlaying
        ? <Pause size={12} fill="white" className="text-white relative z-10" />
        : <Play size={12} fill={isActive ? "white" : hasPartialProgress ? "hsl(var(--primary))" : "currentColor"} className={cn("relative z-10 ml-0.5", isActive ? "text-white" : hasPartialProgress ? "text-white" : "text-muted-foreground")} />
      }

      <style>{`
        @keyframes grow-up {
          from { clip-path: inset(100% 0 0 0); }
          to   { clip-path: inset(0% 0 0 0); }
        }
      `}</style>
    </div>
  );
}