// Keep one operation key while retrying the same form, including a lost response.
export function createPlaylistSubmission(create) {
  let pending = false;
  let fingerprint;
  let requestId;
  return async (payload) => {
    if (pending) return null;
    pending = true;
    try {
      const nextFingerprint = JSON.stringify(payload);
      if (fingerprint !== nextFingerprint) {
        requestId = crypto.randomUUID();
        fingerprint = nextFingerprint;
      }
      const playlist = await create({ ...payload, creation_request_id: requestId });
      if (!playlist?.id) throw new Error('Playlist creation was not confirmed');
      return playlist;
    } finally {
      pending = false;
    }
  };
}

export function getPlaylistCreationErrorKey(error) {
  const code = error?.code || error?.data?.code;
  if (code === 'playlist-limit') return 'playlistCreateLimit';
  if (code === 'feed-limit') return 'playlistCreateFeedLimit';
  if (code === 'identity-conflict' || error?.status === 401 || error?.status === 403) return 'playlistCreateAuthError';
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'playlistCreateTimeout';
  if (error?.status === 400 || error?.status === 413) return 'playlistCreateInvalid';
  return 'playlistCreateFailed';
}
