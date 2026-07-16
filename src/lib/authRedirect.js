import { voxylApi } from '@/api/voxylApiClient';

const log = (...args) => console.log('[AUTH]', ...args);

export async function redirectToLogin(fromUrl = window.location.href) {
  log('redirectToLogin called:', fromUrl);
  return await voxylApi.auth.redirectToLogin(fromUrl);
}
