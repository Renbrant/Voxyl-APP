// Shared username rules for the client. The Worker owns the authoritative
// validation and uniqueness decision; these helpers only mirror its
// normalization so the field shows what will actually be stored, and give
// instant feedback before a request is made.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const USERNAME_PATTERN = /^[a-z0-9_]+$/;

export function normalizeUsername(value) {
  return String(value ?? '').trim().replace(/^@+/, '').toLowerCase();
}

export function getUsernameValidationKey(normalized) {
  if (!normalized) return 'usernameRequired';
  if (normalized.length < USERNAME_MIN_LENGTH) return 'usernameTooShort';
  if (normalized.length > USERNAME_MAX_LENGTH) return 'usernameTooLong';
  if (!USERNAME_PATTERN.test(normalized)) return 'usernameInvalidChars';
  return '';
}

export function getUsernameErrorKey(error) {
  if (error?.status === 409 || error?.code === 'username-taken') return 'usernameTaken';
  if (error?.code === 'invalid-username') return 'usernameInvalidChars';
  if (error?.status === 401) return 'usernameAuthError';
  return 'usernameSaveError';
}
