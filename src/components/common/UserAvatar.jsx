import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export function getUserInitials(name, username) {
  const source = name?.trim() || username?.trim() || '';
  const parts = source
    .replace(/^@+/, '')
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return '?';

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function UserAvatar({
  src,
  name,
  username,
  alt,
  className,
  imageClassName,
  fallbackClassName,
  textClassName,
  fallbackContent,
}) {
  const avatarUrl = typeof src === 'string' ? src.trim() : '';
  const displayName = username
    ? `@${username}`
    : name?.trim() || 'Usuário';

  return (
    <Avatar className={cn('gradient-primary', className)}>
      {avatarUrl ? (
        <AvatarImage
          src={avatarUrl}
          alt={alt || displayName}
          referrerPolicy="no-referrer"
          className={cn('object-cover', imageClassName)}
        />
      ) : null}

      <AvatarFallback
        className={cn(
          'gradient-primary text-white',
          fallbackClassName,
        )}
      >
        {fallbackContent ?? (
          <span
            className={cn('text-sm font-bold', textClassName)}
            aria-label={`${displayName} avatar`}
          >
            {getUserInitials(name, username)}
          </span>
        )}
      </AvatarFallback>
    </Avatar>
  );
}