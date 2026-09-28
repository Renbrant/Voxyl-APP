// Manages downloaded episodes in localStorage
const KEY = 'voxyl_downloads';
const keyFor = (userId) => userId ? `${KEY}_v2_${encodeURIComponent(userId)}` : null;

export function getDownloads(userId) {
  try {
    const key = keyFor(userId);
    return key ? JSON.parse(localStorage.getItem(key) || '[]') : [];
  } catch {
    return [];
  }
}

export function saveDownload(episode, userId) {
  const key = keyFor(userId);
  if (!key) return;
  const downloads = getDownloads(userId);
  if (downloads.some(d => d.audioUrl === episode.audioUrl)) return;
  downloads.unshift(episode);
  localStorage.setItem(key, JSON.stringify(downloads));
}

export function removeDownload(audioUrl, userId) {
  const key = keyFor(userId);
  if (!key) return;
  const downloads = getDownloads(userId).filter(d => d.audioUrl !== audioUrl);
  localStorage.setItem(key, JSON.stringify(downloads));
}

export function isDownloaded(audioUrl, userId) {
  return getDownloads(userId).some(d => d.audioUrl === audioUrl);
}
