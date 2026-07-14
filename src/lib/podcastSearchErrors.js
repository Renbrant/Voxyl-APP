import { t } from './i18n.js';

export function getPodcastSearchErrorMessage(error) {
  const code = error?.data?.code;
  const status = error?.status;

  if (code === 'provider-configuration' || status === 503) {
    return t('podcastSearchNotConfigured');
  }

  if (code === 'provider-timeout' || status === 504) {
    return t('podcastSearchTimeout');
  }

  if (code === 'provider-rate-limit' || status === 429) {
    return t('podcastSearchRateLimit');
  }

  if (code === 'provider-authentication' || code === 'provider-unavailable' || code === 'provider-response' || status === 502) {
    return t('podcastSearchUnavailable');
  }

  if (code === 'invalid-request' || status === 400) {
    return t('podcastSearchInvalidRequest');
  }

  return t('podcastSearchFailed');
}
