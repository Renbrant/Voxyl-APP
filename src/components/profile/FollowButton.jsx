import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { UserPlus, UserCheck, Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// status: null = not following, 'pending' = request sent, 'accepted' = following
export default function FollowButton({ currentUserId, currentUserEmail, currentUserName, targetUserId, targetUserEmail, followStatus, onStatusChange, theyFollowMe = false }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentUserId) return;
    setLoading(true);

    if (followStatus === 'accepted' || followStatus === 'pending') {
      // Unfollow / cancel request via secure server function
      await base44.functions.invoke('cancelFollowRequest', { targetUserId }).catch(() => {});
      onStatusChange?.(null);
    } else {
      // Send follow request via secure server function
      await base44.functions.invoke('requestFollow', { targetUserId }).catch(() => {});
      onStatusChange?.('pending');
    }

    setLoading(false);
  };

  const label = followStatus === 'accepted' ? 'Seguindo' : followStatus === 'pending' ? 'Solicitado' : theyFollowMe ? 'Seguir de volta' : 'Seguir';
  const Icon = followStatus === 'accepted' ? UserCheck : followStatus === 'pending' ? Clock : UserPlus;

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={cn(
        'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all',
        followStatus === 'accepted'
          ? 'bg-secondary text-foreground border border-border'
          : followStatus === 'pending'
          ? 'bg-secondary text-muted-foreground border border-border'
          : 'gradient-primary text-white'
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
      {label}
    </button>
  );
}