import { Link } from 'react-router-dom';
import { UserCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import FollowButton from '@/components/profile/FollowButton';

export default function UserSearchCard({ user, index, currentUser, followStatus, onStatusChange, theyFollowMe = false }) {
  const displayName = user.username ? `@${user.username}` : 'Usuário';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
    >
      <Link to={`/user/${user.id}`} className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-border hover:border-primary/30 transition-all">
        <div className="w-11 h-11 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
          <UserCircle2 size={22} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{displayName}</p>
          {!user.username && (
            <p className="text-xs text-muted-foreground truncate">Sem nome de usuário</p>
          )}
        </div>
        {currentUser && currentUser.id !== user.id && (
          <FollowButton
            currentUserId={currentUser.id}
            currentUserEmail={currentUser.email}
            currentUserName={currentUser.username || currentUser.full_name}
            targetUserId={user.id}
            targetUserEmail={user.email}
            followStatus={followStatus}
            theyFollowMe={theyFollowMe}
            onStatusChange={onStatusChange}
          />
        )}
      </Link>
    </motion.div>
  );
}