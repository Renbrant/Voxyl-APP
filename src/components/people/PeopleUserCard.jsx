import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import FollowButton from '@/components/profile/FollowButton';
import UserAvatar from '@/components/common/UserAvatar';
import { t } from '@/lib/i18n';

export default function PeopleUserCard({
  user,
  index,
  currentUser,
  followStatus,
  onStatusChange,
  theyFollowMe = false,
}) {
  const displayName =
    user.full_name ||
    (user.username ? '@' + user.username : t('peopleUnnamedUser'));

  const usernameLabel = user.username
    ? '@' + user.username
    : t('peopleUsernameUnavailable');

  const showUsernameLine = Boolean(user.username && user.full_name);
  const relationshipLabels = [];

  if (theyFollowMe) {
    relationshipLabels.push(t('peopleFollowsYou'));
  }

  if (followStatus === 'accepted') {
    relationshipLabels.push(t('peopleFollowing'));
  }

  if (followStatus === 'pending') {
    relationshipLabels.push(t('peopleRequested'));
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04 }}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-primary/30"
    >
      <Link
        to={'/user/' + user.id}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <UserAvatar
          src={user.profile_picture}
          name={user.full_name}
          username={user.username}
          alt={displayName}
          className="h-11 w-11 flex-shrink-0"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </p>

          {(showUsernameLine || !user.username) && (
            <p className="truncate text-xs text-muted-foreground">
              {usernameLabel}
            </p>
          )}

          {relationshipLabels.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {relationshipLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </Link>

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
    </motion.div>
  );
}
