import { useState, useEffect, useRef } from 'react';
import { t } from '@/lib/i18n';
import { useQuery } from '@tanstack/react-query';
import PlaylistCard from '@/components/playlist/PlaylistCard';
import InviteFriendModal from '@/components/profile/InviteFriendModal';
import DeleteAccountModal from '@/components/profile/DeleteAccountModal';
import ShareAppModal from '@/components/profile/ShareAppModal';
import { UserCircle2, Users, ListMusic, Share2, Bell, EyeOff, Eye, Pencil, Settings, Camera, RefreshCw, Loader2, LogIn } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { redirectToLogin } from '@/lib/authRedirect';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import FollowRequestsModal from '@/components/profile/FollowRequestsModal';
import UsernameSetupModal from '@/components/profile/UsernameSetupModal';
import { useNavigate } from 'react-router-dom';

export default function Profile() {
  const [isAuthed, setIsAuthed] = useState(null); // null = loading
  const [user, setUser] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showFollowRequests, setShowFollowRequests] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [hidingProfile, setHidingProfile] = useState(false);
  const [showAvatarSheet, setShowAvatarSheet] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef(null);
  const [eggProgress, setEggProgress] = useState(0); // 0–1
  const [eggUnlocked, setEggUnlocked] = useState(false);
  const [showEggToast, setShowEggToast] = useState(false);
  const eggTimerRef = useRef(null);
  const eggIntervalRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    base44.auth.isAuthenticated().then(authed => {
      setIsAuthed(authed);
      if (authed) {
        base44.auth.me().then((u) => {
          setUser(u);
          if (!u.username) setShowUsernameModal(true);
          base44.entities.Follow.filter({ following_id: u.id, status: 'pending' })
            .then((reqs) => setPendingCount(reqs.length))
            .catch(() => {});
        }).catch(() => {});
      }
    }).catch(() => setIsAuthed(false));
    // Check if already unlocked
    if (localStorage.getItem('voxyl_egg_unlocked') === 'true') setEggUnlocked(true);
  }, []);

  const startEggPress = () => {
    if (eggUnlocked) return;
    setEggProgress(0);
    const start = Date.now();
    eggIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      setEggProgress(Math.min(elapsed / 5000, 1));
    }, 50);
    eggTimerRef.current = setTimeout(() => {
      clearInterval(eggIntervalRef.current);
      setEggProgress(1);
      setEggUnlocked(true);
      localStorage.setItem('voxyl_egg_unlocked', 'true');
      setShowEggToast(true);
      setTimeout(() => setShowEggToast(false), 4000);
    }, 5000);
  };

  const cancelEggPress = () => {
    clearTimeout(eggTimerRef.current);
    clearInterval(eggIntervalRef.current);
    setEggProgress(0);
  };

  const syncPictureToPlaylists = async (pictureUrl) => {
    const myPlaylists = await base44.entities.Playlist.filter({ creator_id: user.id }).catch(() => []);
    await Promise.all(myPlaylists.map(p => base44.entities.Playlist.update(p.id, { creator_picture: pictureUrl })));
  };

  const handleUseLoginPhoto = async () => {
    const loginPhoto = user.picture || user.avatar_url || user.photo_url;
    if (!loginPhoto) return;
    await base44.auth.updateMe({ profile_picture: loginPhoto });
    setUser(prev => ({ ...prev, profile_picture: loginPhoto }));
    setShowAvatarSheet(false);
    syncPictureToPlaylists(loginPhoto);
  };

  const handleUploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    setShowAvatarSheet(false);
    const res = await base44.integrations.Core.UploadFile({ file }).catch(() => null);
    if (res?.file_url) {
      await base44.auth.updateMe({ profile_picture: res.file_url });
      setUser(prev => ({ ...prev, profile_picture: res.file_url }));
      syncPictureToPlaylists(res.file_url);
    }
    setUploadingPhoto(false);
  };

  const handleToggleHidden = async () => {
    if (!user) return;
    setHidingProfile(true);
    const newVal = !user.profile_hidden;
    await base44.auth.updateMe({ profile_hidden: newVal });
    setUser((prev) => ({ ...prev, profile_hidden: newVal }));
    // Sync creator_hidden on all owned playlists
    const myPlaylists = await base44.entities.Playlist.filter({ creator_id: user.id }).catch(() => []);
    await Promise.all(myPlaylists.map((p) => base44.entities.Playlist.update(p.id, { creator_hidden: newVal })));
    setHidingProfile(false);
  };

  const { data: playlists = [] } = useQuery({
    queryKey: ['profile-playlists', user?.id],
    enabled: !!user,
    queryFn: () => base44.entities.Playlist.filter({ creator_id: user.id }, '-created_date', 20)
  });

  const publicPlaylists = playlists.filter((p) => p.visibility === 'public' || !p.visibility);
  const followersPlaylists = playlists.filter((p) => p.visibility === 'friends_only');

  if (isAuthed === false) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-5">
        <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center glow-primary">
          <LogIn size={28} className="text-white" />
        </div>
        <div>
          <h2 className="text-xl font-grotesk font-bold text-foreground mb-1">{t('profileLoginTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('profileLoginHint')}</p>
        </div>
        <button
          onClick={() => redirectToLogin(window.location.href)}
          className="px-6 py-3 rounded-2xl gradient-primary text-white font-semibold text-sm glow-primary"
        >
          {t('loginWithGoogle')}
        </button>
      </div>
    );
  }

  if (!user) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>);


  return (
    <div className="bg-background pb-24">
      <div
        className="flex items-center justify-between px-4 pb-4 select-none"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3rem)' }}
      >
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">{t('profileSubtitle')}</p>
          <h1
            className="text-2xl font-grotesk font-bold text-foreground relative inline-block cursor-pointer"
            onMouseDown={startEggPress}
            onMouseUp={cancelEggPress}
            onMouseLeave={cancelEggPress}
            onTouchStart={startEggPress}
            onTouchEnd={cancelEggPress}
            onTouchCancel={cancelEggPress}
          >
            {t('profileTitle')}
            {/* Progress ring */}
            {eggProgress > 0 && !eggUnlocked && (
              <span
                className="absolute inset-0 rounded-lg bg-primary/20 transition-all"
                style={{ width: `${eggProgress * 100}%`, opacity: eggProgress }}
              />
            )}
          </h1>
        </div>
        <button
          onClick={() => navigate('/settings')}
          className="p-2 rounded-full hover:bg-secondary transition-colors"
        >
          <Settings size={20} className="text-primary" />
        </button>
      </div>
      

      <div className="px-4">
        {/* Avatar & Info */}
        <div className="flex flex-col items-center py-6 mb-4">
          <div className="relative w-20 h-20 mb-3 flex-shrink-0">
            {user.profile_picture || user.picture || user.avatar_url || user.photo_url ?
            <img
              src={user.profile_picture || user.picture || user.avatar_url || user.photo_url}
              alt={user.full_name}
              className="w-20 h-20 rounded-full object-cover glow-primary"
              referrerPolicy="no-referrer" /> :
            <div className="w-20 h-20 rounded-full gradient-primary flex items-center justify-center glow-primary">
              {uploadingPhoto
                ? <Loader2 size={28} className="text-white animate-spin" />
                : <UserCircle2 size={40} className="text-white" />}
            </div>}
            <button
              onClick={() => setShowAvatarSheet(true)}
              className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center border-2 border-background"
            >
              <Camera size={13} className="text-white" />
            </button>
          </div>
          <h2 className="text-xl font-grotesk font-bold">{user.full_name || t('detailUser')}</h2>

          {/* Public username */}
          <button
            onClick={() => setShowUsernameModal(true)}
            className="flex items-center gap-1.5 mt-1 px-3 py-1 rounded-full bg-secondary border border-border text-sm text-muted-foreground hover:border-primary/40 transition-colors">
            
            
            <span>{user.username ? `@${user.username.replace(/^@+/, '')}` : t('profileSetUsername')}</span>
            <Pencil size={11} className="opacity-60" />
          </button>

          {/* Profile hidden toggle */}
          <button
            onClick={handleToggleHidden}
            disabled={hidingProfile}
            className={`flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
            user.profile_hidden ?
            'bg-primary/10 border-primary/30 text-primary' :
            'bg-secondary border-border text-muted-foreground'}`
            }>
            
            {user.profile_hidden ? <EyeOff size={12} /> : <Eye size={12} />}
            {user.profile_hidden ? t('profileHidden') : t('profileVisible')}
          </button>

          {/* Follow requests badge */}
          {pendingCount > 0 &&
          <button
            onClick={() => setShowFollowRequests(true)}
            className="flex items-center gap-2 mt-3 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 text-primary text-sm font-medium">
            
              <Bell size={14} />
              {pendingCount} {pendingCount > 1 ? t('profileFollowRequestsPlural') : t('profileFollowRequests')}
            </button>
          }

          <div className="flex gap-6 mt-4">
            <div className="text-center">
              <p className="text-xl font-bold text-foreground">{playlists.length}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><ListMusic size={10} /> {t('profileStats_playlists')}</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-foreground">{publicPlaylists.length}</p>
              <p className="text-xs text-muted-foreground">{t('profileStats_public')}</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-foreground">{followersPlaylists.length}</p>
              <p className="text-xs text-muted-foreground">{t('profileStats_followers')}</p>
            </div>
          </div>
        </div>

        {/* Invite */}
        <div className="p-4 rounded-2xl bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center">
              <Users size={18} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">{t('profileInvite')}</p>
              <p className="text-xs text-muted-foreground">{t('profileInviteHint')}</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowShare(true)}
                size="sm"
                variant="ghost"
                className="rounded-full text-xs px-2">
                
                <Share2 size={14} />
              </Button>
              <Button
                onClick={() => setShowInvite(true)}
                size="sm"
                className="rounded-full gradient-primary border-0 text-xs">
                
                {t('profileInviteBtn')}
              </Button>
            </div>
          </div>
        </div>

        {/* Playlists */}
        <div className="space-y-6">
          <div>
            <h3 className="font-semibold mb-3 text-foreground">{t('profilePublicPlaylists')}</h3>
            {publicPlaylists.length === 0 ?
            <div className="text-center py-8 text-muted-foreground">
                <p className="text-3xl mb-2">🎧</p>
                <p className="text-sm">{t('profileNoPublic')}</p>
              </div> :

            <div className="space-y-2">
                {publicPlaylists.map((pl, i) =>
              <motion.div key={pl.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                    <PlaylistCard playlist={pl} compact currentUser={user} onEdited={() => {}} />
                  </motion.div>
              )}
              </div>
            }
          </div>

          <div>
            <h3 className="font-semibold mb-3 text-foreground">{t('profileFollowerPlaylists')}</h3>
            {followersPlaylists.length === 0 ?
            <div className="text-center py-8 text-muted-foreground">
                <p className="text-3xl mb-2">👥</p>
                <p className="text-sm">{t('profileNoFollower')}</p>
              </div> :

            <div className="space-y-2">
                {followersPlaylists.map((pl, i) =>
              <motion.div key={pl.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                    <PlaylistCard playlist={pl} compact currentUser={user} onEdited={() => {}} />
                  </motion.div>
              )}
              </div>
            }
          </div>
        </div>
      </div>



      <AnimatePresence>
        {showUsernameModal && user &&
        <UsernameSetupModal
          currentUser={user}
          currentUsername={user.username}
          onClose={() => setShowUsernameModal(false)}
          onSaved={(uname) => setUser((prev) => ({ ...prev, username: uname }))} />

        }
      </AnimatePresence>
      <AnimatePresence>
        {showFollowRequests && user &&
        <FollowRequestsModal
          currentUser={user}
          onClose={() => setShowFollowRequests(false)}
          onCountChange={setPendingCount} />

        }
      </AnimatePresence>
      {showInvite && <InviteFriendModal onClose={() => setShowInvite(false)} />}
      <AnimatePresence>
        {showDelete && user &&
        <DeleteAccountModal user={user} onClose={() => setShowDelete(false)} />
        }
      </AnimatePresence>
      <AnimatePresence>
        {showShare &&
        <ShareAppModal onClose={() => setShowShare(false)} />
        }
      </AnimatePresence>

      {/* Avatar photo sheet */}
      <AnimatePresence>
        {showAvatarSheet && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50"
              onClick={() => setShowAvatarSheet(false)}
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-3xl p-5 border-t border-border"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}
            >
              <p className="text-base font-grotesk font-bold mb-4">{t('profilePhoto')}</p>
              <div className="space-y-2">
                {(user.picture || user.avatar_url || user.photo_url) && (
                  <button
                    onClick={handleUseLoginPhoto}
                    className="w-full flex items-center gap-3 p-4 rounded-2xl bg-secondary border border-border text-sm font-medium"
                  >
                    <RefreshCw size={18} className="text-primary" />
                    {t('profileUseLoginPhoto')}
                  </button>
                )}
                <label className="w-full flex items-center gap-3 p-4 rounded-2xl bg-secondary border border-border text-sm font-medium cursor-pointer">
                  <Camera size={18} className="text-primary" />
                  {t('profileUploadPhoto')}
                  <input type="file" accept="image/*" className="hidden" onChange={handleUploadPhoto} />
                </label>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Easter egg toast */}
      <AnimatePresence>
        {showEggToast && (
          <motion.div
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            className="fixed bottom-28 left-4 right-4 z-50 bg-card border border-primary/40 rounded-2xl p-4 shadow-xl"
          >
            <p className="text-2xl mb-1">🎉</p>
            <p className="font-grotesk font-bold text-foreground">{t('profileEasterEgg')}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{t('profileEasterEggMsg')}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>);

}