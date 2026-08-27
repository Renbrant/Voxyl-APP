import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { voxylApi } from '@/api/voxylApiClient';
import PlaylistCard from '@/components/playlist/PlaylistCard';
import FollowButton from '@/components/profile/FollowButton';
import { ArrowLeft, Ban } from 'lucide-react';
import UserAvatar from '@/components/common/UserAvatar';
import { motion, AnimatePresence } from 'framer-motion';
import PageTransition from '@/components/common/PageTransition';
import { t } from '@/lib/i18n';

export default function UserProfile() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentUser, setCurrentUser] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followStatus, setFollowStatus] = useState(null); // null | 'pending' | 'accepted'
  const [theyFollowMe, setTheyFollowMe] = useState(false);
  const [relationshipReady, setRelationshipReady] = useState(false);
  const [relationshipError, setRelationshipError] = useState('');
  const [relationshipRetryNonce, setRelationshipRetryNonce] = useState(0);
  const [followersCount, setFollowersCount] = useState(0);
  const [authResolved, setAuthResolved] = useState(false);
  const [blockStatusReady, setBlockStatusReady] = useState(false);
  const [blockStatusError, setBlockStatusError] = useState('');
  const [isBlocked, setIsBlocked] = useState(false);
  const [hasOutboundBlock, setHasOutboundBlock] = useState(false);
  const [blockRecordId, setBlockRecordId] = useState(null);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [blockError, setBlockError] = useState('');

  useEffect(() => {
    voxylApi.auth.me().then(user => {
      setCurrentUser(user);
      setAuthResolved(true);
    }).catch(error => {
      if (error?.status && error.status !== 401) {
        console.error('[UserProfile] Failed to load current user', { error });
      }
      setAuthResolved(true);
    });
    // Fetch public profile data (including picture) via service role
    voxylApi.functions.invoke('getPublicUserProfile', { userId })
      .then(res => {
        const data = res.data;
        setProfileUser(prev => ({ ...prev, ...data }));
      })
      .catch(error => console.error('[UserProfile] Failed to load public profile', { userId, error }));
  }, [userId]);

  useEffect(() => {
    voxylApi.entities.Follow.filter({ following_id: userId, status: 'accepted' })
      .then(follows => setFollowersCount(follows.length))
      .catch(error => console.error('[UserProfile] Failed to load followers count', { userId, error }));

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
      .catch(error => console.error('[UserProfile] Failed to load follower profile hint', { userId, error }));
  }, [userId]);

  useEffect(() => {
    // Fetch playlists — auth is resolved server-side, no need to wait for currentUser
    voxylApi.functions.invoke('getUserPlaylists', { userId })
      .then(res => {
        const data = res.data;
        setPlaylists(data.playlists || []);

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
      .catch(error => {
        console.error('[UserProfile] Failed to load user playlists', { userId, error });
        setLoading(false);
      });
  }, [userId]);

  useEffect(() => {
    if (!currentUser) return undefined;

    if (currentUser.id === userId) {
      setFollowStatus(null);
      setTheyFollowMe(false);
      setRelationshipReady(true);
      setRelationshipError('');
      return undefined;
    }

    let active = true;
    setFollowStatus(null);
    setTheyFollowMe(false);
    setRelationshipReady(false);
    setRelationshipError('');

    Promise.all([
      voxylApi.entities.Follow.filter({ follower_id: currentUser.id, following_id: userId }),
      voxylApi.entities.Follow.filter({ follower_id: userId, following_id: currentUser.id, status: 'accepted' }),
    ])
      .then(([outgoingFollows, incomingFollows]) => {
        if (!active) return;

        const outgoing = Array.isArray(outgoingFollows)
          ? outgoingFollows[0]
          : null;
        const outgoingStatus =
          outgoing?.status === 'accepted' || outgoing?.status === 'pending'
            ? outgoing.status
            : null;

        setFollowStatus(outgoingStatus);
        setTheyFollowMe(
          Array.isArray(incomingFollows) && incomingFollows.length > 0,
        );
        setRelationshipReady(true);
      })
      .catch(error => {
        if (!active) return;
        console.error('[UserProfile] Failed to load relationship context', {
          currentUserId: currentUser.id,
          userId,
          error,
        });
        setFollowStatus(null);
        setTheyFollowMe(false);
        setRelationshipError(t('peopleRelationshipError'));
        setRelationshipReady(true);
      });

    return () => {
      active = false;
    };
  }, [currentUser, userId, relationshipRetryNonce]);

  useEffect(() => {
    if (!currentUser) return undefined;

    if (currentUser.id === userId) {
      setBlockStatusReady(true);
      setIsBlocked(false);
      setHasOutboundBlock(false);
      setBlockRecordId(null);
      return undefined;
    }

    let active = true;
    setBlockStatusReady(false);
    setBlockStatusError('');

    voxylApi.blocks.status(userId)
      .then(status => {
        if (!active) return;
        setIsBlocked(Boolean(status.hidden));
        setHasOutboundBlock(Boolean(status.can_unblock));
        setBlockRecordId(status.outbound_block_id || null);
        setBlockStatusReady(true);
      })
      .catch(error => {
        if (!active) return;
        console.error('[UserProfile] Failed to load block status', {
          currentUserId: currentUser.id,
          userId,
          error,
        });
        setBlockStatusError(t('blockLoadHiddenError'));
        setBlockStatusReady(false);
      });

    return () => {
      active = false;
    };
  }, [currentUser, userId]);
  const handleBlock = async () => {
    if (!currentUser) return;
    setBlockLoading(true);
    setBlockError('');
    try {
      if (hasOutboundBlock) {
        if (blockRecordId) {
          await voxylApi.blocks.delete(blockRecordId);
        }
        setBlockRecordId(null);
        setIsBlocked(false);
        setHasOutboundBlock(false);
        setBlockStatusReady(true);
      } else {
        const block = await voxylApi.blocks.create(userId);
        setBlockRecordId(block?.id || null);
        setIsBlocked(true);
        setHasOutboundBlock(true);
        setBlockStatusReady(true);
        setFollowStatus(null);
      }
      setTheyFollowMe(false);
      setRelationshipReady(false);
      setRelationshipError('');
      setRelationshipRetryNonce((value) => value + 1);
      setShowBlockConfirm(false);
    } catch (error) {
      console.error('[UserProfile] Failed to update block status', { userId, isBlocked, error });
      setBlockError(t('blockActionError'));
    } finally {
      setBlockLoading(false);
    }
  };

  const displayName = profileUser?.username
    ? `@${profileUser.username}`
    : profileUser?.full_name || 'Usuário';
  const isOwnProfile = currentUser?.id === userId;
  const inboundBlocked = currentUser && !isOwnProfile && isBlocked && !hasOutboundBlock;
  const canShowProfileContent = authResolved && (!currentUser || isOwnProfile || (blockStatusReady && !isBlocked));
  const canShowBlockButton = currentUser && !isOwnProfile && !inboundBlocked && (!isBlocked || hasOutboundBlock);

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
        {canShowBlockButton && (
          <button
            onClick={() => setShowBlockConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-muted-foreground bg-secondary border border-border"
          >
            <Ban size={13} />
            {hasOutboundBlock ? 'Bloqueado' : 'Bloquear'}
          </button>
        )}
      </div>

      <div className="flex flex-col items-center py-4 px-4 mb-4">
        <UserAvatar
          src={profileUser?.profile_picture}
          name={profileUser?.full_name}
          username={profileUser?.username}
          alt={displayName}
          className="w-16 h-16 mb-2 flex-shrink-0"
        />
        <h2 className="text-lg font-grotesk font-bold">{displayName}</h2>
        <p className="text-sm text-muted-foreground mb-3">{followersCount} seguidores · {playlists.length} playlists</p>

        {currentUser && !isOwnProfile && blockStatusError && (
          <div className="mt-2 rounded-2xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
            <span>{blockStatusError}</span>
            <button type="button" onClick={() => {
              setBlockStatusError('');
              setBlockStatusReady(false);
              voxylApi.blocks.status(userId)
                .then(status => {
                  setIsBlocked(Boolean(status.hidden));
                  setHasOutboundBlock(Boolean(status.can_unblock));
                  setBlockRecordId(status.outbound_block_id || null);
                  setBlockStatusReady(true);
                })
                .catch(error => {
                  console.error('[UserProfile] Failed to retry block status', { currentUserId: currentUser.id, userId, error });
                  setBlockStatusError(t('blockLoadHiddenError'));
                });
            }} className="text-primary font-semibold">{t('blockRetry')}</button>
          </div>
        )}

        {currentUser && !isOwnProfile && !isBlocked && blockStatusReady && (
          <div className="flex w-full max-w-sm flex-col items-center gap-3">
            <div
              className="flex min-h-7 flex-wrap items-center justify-center gap-2"
              aria-label={t('peopleRelationshipContext')}
            >
              {!relationshipReady ? (
                <span className="text-xs text-muted-foreground">
                  {t('peopleRelationshipLoading')}
                </span>
              ) : relationshipError ? (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    {relationshipError}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRelationshipRetryNonce((value) => value + 1)}
                    className="min-h-9 text-xs font-semibold text-primary"
                  >
                    {t('peopleRelationshipRetry')}
                  </button>
                </div>
              ) : (
                <>
                  {followStatus === 'accepted' && (
                    <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                      {t('peopleFollowing')}
                    </span>
                  )}

                  {followStatus === 'pending' && (
                    <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      {t('peopleRequested')}
                    </span>
                  )}

                  {theyFollowMe && (
                    <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                      {t('peopleFollowsYou')}
                    </span>
                  )}

                  {!followStatus && !theyFollowMe && (
                    <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                      {t('peopleRelationshipNone')}
                    </span>
                  )}
                </>
              )}
            </div>

            {relationshipReady && !relationshipError && (
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
                  setRelationshipReady(true);
                  setRelationshipError('');

                  if (wasAccepted && !status) {
                    setFollowersCount(prev => Math.max(0, prev - 1));
                  }

                  const invalidations = [
                    queryClient.invalidateQueries({
                      queryKey: ['people-outgoing-follows', currentUser.id],
                    }),
                    queryClient.invalidateQueries({
                      queryKey: ['people-summary', currentUser.id],
                    }),
                    queryClient.invalidateQueries({
                      queryKey: ['people-suggestions-preview', currentUser.id],
                    }),
                  ];

                  void Promise.allSettled(invalidations);
                }}
              />
            )}
          </div>
        )}
        {hasOutboundBlock && (
          <p className="text-xs text-muted-foreground mt-1">{t('blockYouBlockedUser')}</p>
        )}

        {inboundBlocked && (
          <p className="text-xs text-muted-foreground mt-1">{t('blockProfileUnavailable')}</p>
        )}
      </div>

      {canShowProfileContent && (
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
                {hasOutboundBlock ? 'Desbloquear usuário?' : 'Bloquear usuário?'}
              </h3>
              <p className="text-sm text-muted-foreground mb-5">
                {hasOutboundBlock
                  ? `${displayName} poderá te seguir novamente e ver seus conteúdos.`
                  : `Você não verá mais o conteúdo de ${displayName} e ele não verá o seu. O seguimento entre vocês será removido.`}
              </p>
              {blockError && (
                <p className="text-xs text-destructive mb-3">{blockError}</p>
              )}
              <button
                onClick={handleBlock}
                disabled={blockLoading}
                className="w-full py-3 rounded-2xl bg-destructive text-white font-semibold text-sm mb-2 disabled:opacity-50"
              >
                {blockLoading ? 'Aguarde...' : hasOutboundBlock ? 'Desbloquear' : 'Bloquear'}
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
