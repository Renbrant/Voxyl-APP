import { useState } from 'react';
import { voxylApi } from '@/api/voxylApiClient';
import { UserPlus, UserCheck, Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

// status: null = not following, 'pending' = request sent, 'accepted' = following
export default function FollowButton({ currentUserId, currentUserEmail, currentUserName, targetUserId, targetUserEmail, followStatus, onStatusChange, theyFollowMe = false }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentUserId) return;
    const previousStatus = followStatus;
    setLoading(true);

    try {
      if (followStatus === 'accepted' || followStatus === 'pending') {
        await voxylApi.functions.invoke('cancelFollowRequest', { targetUserId });
        onStatusChange?.(null);
      } else {
        const result = await voxylApi.functions.invoke('requestFollow', { targetUserId });
        onStatusChange?.(result?.data?.status || 'pending');
      }
    } catch (error) {
      console.error('[FollowButton] Error:', error);
      onStatusChange?.(previousStatus);
      toast({
        title: 'Não foi possível atualizar',
        description: 'Tente novamente em alguns instantes.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
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
