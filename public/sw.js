const CACHE_NAME = 'voxyl-v2-auth-bridge';
const CURRENT_EPISODE_KEY = 'voxyl_current_episode';
const QUEUE_KEY = 'voxyl_queue';
const AUTOPLAY_KEY = 'voxyl_autoplay';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const { type, payload } = event.data;

  if (type === 'UPDATE_EPISODE') {
    self.currentEpisode = payload;
    self.queue = payload.queue || [];
    self.autoplay = payload.autoplay !== false;
    updateMediaSession(payload);
  }

  if (type === 'UPDATE_QUEUE') {
    self.queue = payload.queue || [];
    self.autoplay = payload.autoplay !== false;
  }

  if (type === 'SET_AUTOPLAY') {
    self.autoplay = payload.autoplay;
  }
});

function updateMediaSession(episode) {
  if (!episode) return;

  if ('mediaSession' in self) {
    self.mediaSession.metadata = new MediaMetadata({
      title: episode.title,
      artist: episode.feedTitle || 'Voxyl',
      album: 'Voxyl',
      artwork: episode.image
        ? [
            { src: episode.image, sizes: '96x96', type: 'image/jpeg' },
            { src: episode.image, sizes: '128x128', type: 'image/jpeg' },
            { src: episode.image, sizes: '256x256', type: 'image/jpeg' },
            { src: episode.image, sizes: '512x512', type: 'image/jpeg' },
          ]
        : [],
    });

    self.mediaSession.setActionHandler('play', () => {
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'PLAY' }));
      });
    });

    self.mediaSession.setActionHandler('pause', () => {
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'PAUSE' }));
      });
    });

    self.mediaSession.setActionHandler('nexttrack', () => {
      playNextEpisode();
    });

    self.mediaSession.setActionHandler('previoustrack', () => {
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'PLAY_PREV' }));
      });
    });
  }
}

function playNextEpisode() {
  if (!self.currentEpisode || !self.queue || self.queue.length === 0 || !self.autoplay) return;

  const idx = self.queue.findIndex(e => e.audioUrl === self.currentEpisode.audioUrl);

  for (let i = idx + 1; i < self.queue.length; i++) {
    const nextEp = self.queue[i];
    const finishedUrls = self.finishedUrls || new Set();
    
    if (!finishedUrls.has(nextEp.audioUrl)) {
      self.currentEpisode = nextEp;
      updateMediaSession(nextEp);
      
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ 
          type: 'PLAY_NEXT_EPISODE',
          payload: nextEp 
        }));
      });
      return;
    }
  }
}

self.addEventListener('message', event => {
  if (event.data.type === 'UPDATE_FINISHED_URLS') {
    self.finishedUrls = new Set(event.data.payload);
  }
});
