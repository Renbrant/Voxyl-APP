import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { voxylApi } from '@/api/voxylApiClient';
import PlaylistCard from '@/components/playlist/PlaylistCard';
import FollowButton from '@/components/profile/FollowButton';
import { ArrowLeft, UserCircle2, Ban } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import PageTransition from '@/components/common/PageTransition';

export default function UserProfile() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followStatus, setFollowStatus] = useState(null); // null | 'pending' | 'accepted'
  const [theyFollowMe, setTheyFollowMe] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [isBlocked, setIsBlocked] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);

  useEffect(() => {
    voxylApi.auth.me().then(setCurrentUser).catch(() => {});
    // Fetch public profile data (including picture) via service role
    voxylApi.functions.invoke('getPublicUserProfile', { userId })
      .then(res => {
        const data = res.data;
        setProfileUser(prev => ({ ...prev, ...data }));
      })
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    voxylApi.entities.Follow.filter({ following_id: userId, status: 'accepted' })
      .then(follows => setFollowersCount(follows.length))
      .catch(() => {});

    voxylApi.entities.Follow.filter({ follower_id: userId })
      .then(follows => {
        if (follows.length > 0 && follows[0].follower_username) {
          setProfileUser(prev => prev?.username ? prev : {
            ...prev,
            username: follows[0].follower_username || null,
            full_name: follows[0].follower_name || null,
          });
        }
      })
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    // Fetch playlists — auth is resolved server-side, no need to wait for currentUser
    voxylApi.functions.invoke('getUserPlaylists', { userId })
      .then(res => {
        const data = res.data;
        setPlaylists(data.playlists || []);
        setFollowStatus(data.isFollowing ? 'accepted' : null);
        setLoading(false);
        const first = (data.playlists || [])[0];
        if (first) {
          setProfileUser(prev => ({
            ...prev,
            username: first.creator_username || prev?.username || null,
            full_name: first.creator_name || prev?.full_name || null,
          }));
        }
      })
      .catch(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    if (!currentUser) return;

    // Check follow status for pending
    voxylApi.entities.Follow.filter({ follower_id: currentUser.id, following_id: userId })
      .then(follows => {
        if (follows.length > 0 && follows[0].status === 'pending') {
          setFollowStatus('pending');
        }
      })
      .catch(() => {});

    // Check if they follow me
    voxylApi.entities.Follow.filter({ follower_id: userId, following_id: currentUser.id, status: 'accepted' })
      .then(follows => setTheyFollowMe(follows.length > 0))
      .catch(() => {});

    // Check block status
    voxylApi.entities.Block.filter({ blocker_id: currentUser.id, blocked_id: userId })
      .then(blocks => setIsBlocked(blocks.length > 0))
      .catch(() => {});
  }, [currentUser, userId]);

  const handleBlock = async () => {
    if (!currentUser) return;
    setBlockLoading(true);
    if (isBlocked) {
      const blocks = await voxylApi.entities.Block.filter({ blocker_id: currentUser.id, blocked_id: userId });
      if (blocks.length > 0) await voxylApi.entities.Block.delete(blocks[0].id);
      setIsBlocked(false);
    } else {
      await voxylApi.entities.Block.create({
        blocker_id: currentUser.id,
        blocker_email: currentUser.email,
        blocked_id: userId,
        blocked_email: playlists[0]?.creator_email || '',
        blocked_name: playlists[0]?.creator_name || '',
      });
      setIsBlocked(true);
      // Remove any existing follow in both directions
      const myFollows = await voxylApi.entities.Follow.filter({ follower_id: currentUser.id, following_id: userId });
      const theirFollows = await voxylApi.entities.Follow.filter({ follower_id: userId, following_id: currentUser.id });
      await Promise.all([
        ...myFollows.map(f => voxylApi.entities.Follow.delete(f.id)),
        ...theirFollows.map(f => voxylApi.entities.Follow.delete(f.id)),
      ]);
      setFollowStatus(null);
    }
    setBlockLoading(false);
    setShowBlockConfirm(false);
  };

  const displayName = profileUser?.username
    ? `@${profileUser.username}`
    : profileUser?.full_name || 'Usuário';
  const isOwnProfile = currentUser?.id === userId;

  return (
    <PageTransition>
    <div className="min-h-screen bg-background">
      <div className="px-4 pt-12 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center" style={{ WebkitTapHighlightColor: 'transparent' }}>
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-xl font-grotesk font-bold">Perfil</h1>
        </div>
        {currentUser && !isOwnProfile && (
          <button
            onClick={() => setShowBlockConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-muted-foreground bg-secondary border border-border"
          >
            <Ban size={13} />
            {isBlocked ? 'Bloqueado' : 'Bloquear'}
          </button>
        )}
      </div>

      <div className="flex flex-col items-center py-4 px-4 mb-4">
        <div className="w-16 h-16 rounded-full mb-2 overflow-hidden flex-shrink-0">
          {profileUser?.profile_picture ? (
            <img src={profileUser.profile_picture} alt={displayName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-full h-full gradient-primary flex items-center justify-center">
              <UserCircle2 size={32} className="text-white" />
            </div>
          )}
        </div>
        <h2 className="text-lg font-grotesk font-bold">{displayName}</h2>
        <p className="text-sm text-muted-foreground mb-3">{followersCount} seguidores · {playlists.length} playlists</p>

        {currentUser && !isOwnProfile && !isBlocked && (
          <FollowButton
            currentUserId={currentUser.id}
            currentUserEmail={currentUser.email}
            currentUserName={currentUser.full_name}
            targetUserId={userId}
            targetUserEmail={playlists[0]?.creator_email || ''}
            followStatus={followStatus}
            theyFollowMe={theyFollowMe}
            onStatusChange={(status) => {
              const wasAccepted = followStatus === 'accepted';
              setFollowStatus(status);
              if (wasAccepted && !status) setFollowersCount(prev => Math.max(0, prev - 1));
            }}
          />
        )}

        {isBlocked && (
          <p className="text-xs text-muted-foreground mt-1">Você bloqueou este usuário</p>
        )}
      </div>

      {!isBlocked && (
        <div className="px-4 pb-4">
          <h3 className="font-semibold mb-3">Playlists</h3>
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-secondary animate-pulse" />)}
            </div>
          ) : playlists.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>Nenhuma playlist pública</p>
            </div>
          ) : (
            <div className="space-y-2">
              {playlists.map((pl, i) => (
                <motion.div key={pl.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
                  <PlaylistCard playlist={pl} compact currentUser={currentUser} />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Block confirm modal */}
      <AnimatePresence>
        {showBlockConfirm && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="w-full max-w-md bg-card border-t border-border rounded-t-3xl p-5"
            >
              <h3 className="font-grotesk font-bold text-base mb-2">
                {isBlocked ? 'Desbloquear usuário?' : 'Bloquear usuário?'}
              </h3>
              <p className="text-sm text-muted-foreground mb-5">
                {isBlocked
                  ? `${displayName} poderá te seguir novamente e ver seus conteúdos.`
                  : `Você não verá mais o conteúdo de ${displayName} e ele não verá o seu. O seguimento entre vocês será removido.`}
              </p>
              <button
                onClick={handleBlock}
                disabled={blockLoading}
                className="w-full py-3 rounded-2xl bg-destructive text-white font-semibold text-sm mb-2 disabled:opacity-50"
              >
                {blockLoading ? 'Aguarde...' : isBlocked ? 'Desbloquear' : 'Bloquear'}
              </button>
              <button onClick={() => setShowBlockConfirm(false)} className="w-full py-3 rounded-2xl bg-secondary text-sm font-medium">
                Cancelar
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </PageTransition>
  );
}
