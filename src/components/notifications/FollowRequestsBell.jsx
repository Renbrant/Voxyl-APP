import { useState, useEffect } from 'react';
import { voxylApi } from '@/api/voxylApiClient';
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import FollowRequestsModal from '@/components/profile/FollowRequestsModal';
import Portal from '@/components/common/Portal';

export default function FollowRequestsBell() {
  const [user, setUser] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    voxylApi.auth.me().then(u => {
      setUser(u);
      loadCount(u.id);
    }).catch(() => {});
  }, []);

  // Poll every 30s for new requests
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => loadCount(user.id), 30000);
    return () => clearInterval(interval);
  }, [user]);

  const loadCount = (userId) => {
    voxylApi.entities.Follow.filter({ following_id: userId, status: 'pending' })
      .then(reqs => {
        if (reqs.length > pendingCount) setPulse(true);
        setPendingCount(reqs.length);
        setTimeout(() => setPulse(false), 1000);
      })
      .catch(() => {});
  };

  if (!user || pendingCount === 0) return null;

  return (
    <Portal>
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        onClick={() => setShowModal(true)}
        className="fixed z-[9999] w-12 h-12 rounded-full glass border border-primary/40 shadow-lg shadow-primary/20 flex items-center justify-center"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)', right: '1rem' }}
      >
        <motion.div
          animate={pulse ? { rotate: [0, -15, 15, -10, 10, 0] } : {}}
          transition={{ duration: 0.5 }}
        >
          <Bell size={20} className="text-primary" fill="hsl(var(--primary) / 0.2)" />
        </motion.div>
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 shadow-md">
          {pendingCount > 9 ? '9+' : pendingCount}
        </span>
      </motion.button>

      <AnimatePresence>
        {showModal && (
          <FollowRequestsModal
            currentUser={user}
            onClose={() => { setShowModal(false); loadCount(user.id); }}
            onCountChange={setPendingCount}
          />
        )}
      </AnimatePresence>
    </Portal>
  );
}