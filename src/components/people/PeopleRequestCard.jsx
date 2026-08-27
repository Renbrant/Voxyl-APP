import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import UserAvatar from '@/components/common/UserAvatar';
import { t } from '@/lib/i18n';

export default function PeopleRequestCard({
  request,
  index,
  loading = false,
  disabled = false,
  error = '',
  onAccept,
  onDecline,
}) {
  const displayName =
    request.full_name ||
    (request.username ? '@' + request.username : t('peopleUnnamedUser'));

  const usernameLabel = request.username
    ? '@' + request.username
    : t('peopleUsernameUnavailable');

  const showUsernameLine = Boolean(request.username && request.full_name);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, height: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04 }}
      aria-busy={loading}
      className="rounded-2xl border border-border bg-card p-3 transition-colors hover:border-primary/30"
    >
      <Link
        to={'/user/' + request.id}
        className="flex min-w-0 items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <UserAvatar
          src={request.profile_picture}
          name={request.full_name}
          username={request.username}
          alt={displayName}
          className="h-11 w-11 flex-shrink-0"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </p>

          {(showUsernameLine || !request.username) && (
            <p className="truncate text-xs text-muted-foreground">
              {usernameLabel}
            </p>
          )}

          <p className="mt-1 text-xs font-medium text-foreground">
            {t('peopleRequestContext')}
          </p>
        </div>
      </Link>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-label={t('peopleAccept')}
          onClick={onAccept}
          disabled={disabled}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl gradient-primary px-3 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
        >
          {loading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            t('peopleAccept')
          )}
        </button>

        <button
          type="button"
          aria-label={t('peopleDecline')}
          onClick={onDecline}
          disabled={disabled}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-secondary px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        >
          {t('peopleDecline')}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </motion.div>
  );
}
