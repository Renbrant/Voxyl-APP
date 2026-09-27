import { voxylApi } from '@/api/voxylApiClient';

export async function redirectToLogin(fromUrl = window.location.href) {
  return await voxylApi.auth.redirectToLogin(fromUrl);
}
