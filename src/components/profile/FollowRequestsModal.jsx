import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { asArray } from '@/lib/arrayUtils';
import { X, UserCheck, UserX, UserCircle2, Loader2, Ban, ChevronDown, ChevronUp, ListMusic } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import Portal from '@/components/common/Portal';

function RequesterPlaylists({ userId }) {
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.Playlist.filter({ creator_id: userId }, '-created_date', 6)
      .then(data => {
        setPlaylists(asArray(data).filter(p => !p.visibility || p.visibility === 'public'));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId]);

  if (loading) return <div className="h-10 flex items-center justify-center"><Loader2 size={14} className="animate-spin text-muted-foreground" /></div>;
  if (playlists.length === 0) return <p className="text-xs text-muted-foreground px-1 py-2">Nenhuma playlist pública</p>;

  return (
    <div className="mt-2 space-y-1.5">
      {playlists.map(pl => (
        <Link
          key={pl.id}
          to={`/playlist/${pl.id}`}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-background border border-border hover:border-primary/30 transition-colors"
        >
          <ListMusic size={13} className="text-muted-foreground flex-shrink-0" />
          <span className="text-xs truncate">{pl.name}</span>
        </Link>
      ))}
    </div>
  );
}

function FollowRequestItem({ req, onAccept, onReject, onBlock, actionLoading }) {
  const [expanded, setExpanded] = useState(false);
  const [profilePicture, setProfilePicture] = useState(null);
  const displayName = req.follower_username ? `@${req.follower_username}` : (req.follower_name || 'Usuário');

  useEffect(() => {
    base44.functions.invoke('getPublicUserProfile', { userId: req.follower_id })
      .then(res => setProfilePicture(res.data?.profile_picture))
      .catch(() => {});
  }, [req.follower_id]);

  return (
    <motion.div
      key={req.id}
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16, height: 0, marginBottom: 0 }}
      className="rounded-2xl bg-secondary border border-border overflow-hidden"
    >
      <div className="flex items-center gap-3 p-3">
        <Link to={`/user/${req.follower_id}`} className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
          {profilePicture ? (
            <img src={profilePicture} alt={displayName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <UserCircle2 size={20} className="text-white" />
          )}
        </Link>
        <div className="flex-1 min-w-0">
          <Link to={`/user/${req.follower_id}`} className="font-semibold text-sm truncate block hover:text-primary transition-colors">
            {displayName}
          </Link>
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5"
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {expanded ? 'Ocultar playlists' : 'Ver playlists'}
          </button>
        </div>
        {actionLoading === req.id ? (
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        ) : (
          <div className="flex gap-1.5">
            <button
              onClick={() => onAccept(req)}
              className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center"
              title="Aceitar"
            >
              <UserCheck size={16} className="text-white" />
            </button>
            <button
              onClick={() => onReject(req)}
              className="w-9 h-9 rounded-full bg-secondary border border-border flex items-center justify-center"
              title="Recusar"
            >
              <UserX size={16} className="text-muted-foreground" />
            </button>
            <button
              onClick={() => onBlock(req)}
              className="w-9 h-9 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center"
              title="Bloquear"
            >
              <Ban size={15} className="text-destructive" />
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">
              <RequesterPlaylists userId={req.follower_id} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function FollowRequestsModal({ currentUser, onClose, onCountChange }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => {
    base44.entities.Follow.filter({ following_id: currentUser.id, status: 'pending' })
      .then(data => { setRequests(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [currentUser.id]);

  const handleAccept = async (follow) => {
    setActionLoading(follow.id);
    await base44.entities.Follow.update(follow.id, { status: 'accepted' });
    const updated = requests.filter(r => r.id !== follow.id);
    setRequests(updated);
    onCountChange?.(updated.length);
    setActionLoading(null);
  };

  const handleReject = async (follow) => {
    setActionLoading(follow.id);
    await base44.entities.Follow.delete(follow.id);
    const updated = requests.filter(r => r.id !== follow.id);
    setRequests(updated);
    onCountChange?.(updated.length);
    setActionLoading(null);
  };

  const handleBlock = async (follow) => {
    setActionLoading(follow.id);
    // Delete the follow request
    await base44.entities.Follow.delete(follow.id);
    // Create block record
    await base44.entities.Block.create({
      blocker_id: currentUser.id,
      blocker_email: currentUser.email,
      blocked_id: follow.follower_id,
      blocked_email: follow.follower_email || '',
      blocked_name: follow.follower_username || follow.follower_name || '',
    });
    const updated = requests.filter(r => r.id !== follow.id);
    setRequests(updated);
    onCountChange?.(updated.length);
    setActionLoading(null);
  };

  return (
    <Portal>
    <div className="fixed inset-0 z-[9998] flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25 }}
        className="w-full max-w-md bg-card border-t border-border rounded-t-3xl flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <div>
            <h2 className="text-base font-grotesk font-bold">Pedidos para seguir</h2>
            {requests.length > 0 && (
              <p className="text-xs text-muted-foreground">{requests.length} pedido{requests.length > 1 ? 's' : ''} pendente{requests.length > 1 ? 's' : ''}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full bg-secondary text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-24">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : requests.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-sm">Nenhum pedido pendente</p>
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {requests.map(req => (
                  <FollowRequestItem
                    key={req.id}
                    req={req}
                    onAccept={handleAccept}
                    onReject={handleReject}
                    onBlock={handleBlock}
                    actionLoading={actionLoading}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.div>
    </div>
    </Portal>
  );
}
