import { useState, useEffect } from 'react';
import { voxylApi } from '@/api/voxylApiClient';
import { X, UserX, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function BlockedUsersModal({ user, onClose, onCountChange }) {
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unblocking, setUnblocking] = useState(null);

  useEffect(() => {
    voxylApi.entities.Block.filter({ blocker_id: user.id })
      .then(blocks => {
        setBlockedUsers(blocks);
        onCountChange?.(blocks.length);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user.id, onCountChange]);

  const handleUnblock = async (blockId, blockedId) => {
    setUnblocking(blockId);
    await voxylApi.entities.Block.delete(blockId);
    const updated = blockedUsers.filter(b => b.id !== blockId);
    setBlockedUsers(updated);
    onCountChange?.(updated.length);
    setUnblocking(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25 }}
        className="w-full max-w-md bg-card border-t border-border rounded-t-3xl flex flex-col max-h-[85vh] pb-28"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <div>
            <h2 className="text-base font-grotesk font-bold">Usuários Bloqueados</h2>
            {blockedUsers.length > 0 && (
              <p className="text-xs text-muted-foreground">{blockedUsers.length} usuário{blockedUsers.length !== 1 ? 's' : ''}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full bg-secondary text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : blockedUsers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-4xl mb-3">✓</p>
              <p className="text-sm">Você não bloqueou ninguém</p>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {blockedUsers.map((block, idx) => (
                  <motion.div
                    key={block.id}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 16, height: 0 }}
                    className="rounded-2xl bg-secondary border border-border p-4 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                        <UserX size={18} className="text-destructive" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-foreground truncate">{block.blocked_name || 'Usuário'}</p>
                        <p className="text-xs text-muted-foreground truncate">{block.blocked_email}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnblock(block.id, block.blocked_id)}
                      disabled={unblocking === block.id}
                      className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      {unblocking === block.id ? <Loader2 size={12} className="animate-spin" /> : 'Desbloquear'}
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}