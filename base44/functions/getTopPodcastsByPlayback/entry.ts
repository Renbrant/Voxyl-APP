import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// PRIVACY RULE: This is a public discovery/ranking endpoint.
// Private and friends_only playlists must NEVER contribute feed URLs,
// metadata, or play counts to any public ranking, search, or analytics response.
// Only playlists with visibility === 'public' may be processed here.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch all playlists via service role, then immediately filter to public only.
    // We use service role solely to paginate efficiently; the visibility filter
    // below is the privacy boundary — do not remove it.
    const allPlaylists = await base44.asServiceRole.entities.Playlist.list('', 1000);

    // ── PRIVACY FILTER: drop everything that is not explicitly public ─────────
    const publicPlaylists = allPlaylists.filter(p => p.visibility === 'public');
    // ─────────────────────────────────────────────────────────────────────────

    // Build podcast map only from public playlists.
    // Safe fields only: feedUrl, title, image, description — never creator_email.
    const podcastMap = {};

    publicPlaylists.forEach(playlist => {
      if (!playlist.rss_feeds) return;
      playlist.rss_feeds.forEach(feed => {
        if (!feed.url) return;
        if (!podcastMap[feed.url]) {
          podcastMap[feed.url] = {
            feedUrl: feed.url,
            title: feed.title || '',
            image: feed.image || '',
            description: feed.description || '',
            playCount: 0,
          };
        }
        if (!podcastMap[feed.url].title && feed.title) podcastMap[feed.url].title = feed.title;
        if (!podcastMap[feed.url].image && feed.image) podcastMap[feed.url].image = feed.image;
      });
    });

    // Build the set of feed URLs that appear in at least one public playlist.
    // Plays for feeds that only appear in private/friends_only playlists are excluded.
    const publicFeedUrls = new Set(Object.keys(podcastMap));

    // Only count plays from the last 7 days, and only for publicly visible feeds.
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const allPlays = await base44.asServiceRole.entities.PodcastPlay.list('-played_at', 10000);

    allPlays.forEach(play => {
      if (!play.feed_url) return;
      if (play.played_at && play.played_at < oneWeekAgo) return;

      // ── PRIVACY FILTER: skip plays for feeds not in any public playlist ──────
      if (!publicFeedUrls.has(play.feed_url)) return;
      // ─────────────────────────────────────────────────────────────────────────

      if (!podcastMap[play.feed_url]) return; // already guarded above, but be explicit
      podcastMap[play.feed_url].playCount++;
      if (!podcastMap[play.feed_url].title && play.podcast_title) podcastMap[play.feed_url].title = play.podcast_title;
      if (!podcastMap[play.feed_url].image && play.podcast_image) podcastMap[play.feed_url].image = play.podcast_image;
    });

    const sorted = Object.values(podcastMap)
      .filter(p => p.title)
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 50);

    // Explicit safe-field projection — never include creator_email or any user PII
    const safeResponse = sorted.map(p => ({
      feedUrl: p.feedUrl,
      title: p.title,
      image: p.image,
      description: p.description,
      playCount: p.playCount,
    }));

    return Response.json(safeResponse);
  } catch {
    return Response.json({ error: 'Failed to load top podcasts' }, { status: 500 });
  }
});