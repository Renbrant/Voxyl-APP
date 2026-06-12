import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// PRIVACY RULE: This is a public ranking/discovery endpoint.
// creator_email must never appear in public playlist, ranking, search, or discovery responses.
// Only safe public fields are returned (no email addresses, no private user data).

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Only count plays from the last 7 days
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentPlays = await base44.asServiceRole.entities.PodcastPlay.list('-played_at', 10000);

    // Count plays per feed_url in the last week
    const feedPlayCount = {};
    recentPlays.forEach(play => {
      if (!play.feed_url) return;
      if (play.played_at && play.played_at < oneWeekAgo) return;
      feedPlayCount[play.feed_url] = (feedPlayCount[play.feed_url] || 0) + 1;
    });

    // Fetch all playlists, immediately filter to public only
    const allPlaylists = await base44.asServiceRole.entities.Playlist.list('', 1000);

    // ── PRIVACY FILTER: only public playlists appear in rankings ─────────────
    const scored = allPlaylists
      .filter(p => p.visibility === 'public' || !p.visibility)
      .map(p => {
        const weeklyPlays = (p.rss_feeds || []).reduce((sum, feed) => {
          return sum + (feedPlayCount[feed.url] || 0);
        }, 0);

        // Explicit safe-field projection — creator_email is intentionally excluded
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          visibility: p.visibility,
          creator_id: p.creator_id,
          creator_name: p.creator_name,
          creator_username: p.creator_username,
          creator_hidden: p.creator_hidden,
          creator_picture: p.creator_picture,
          cover_image: p.cover_image,
          rss_feeds: p.rss_feeds,
          likes_count: p.likes_count,
          plays_count: p.plays_count,
          max_duration: p.max_duration,
          time_filter_hours: p.time_filter_hours,
          episodes_sort_order: p.episodes_sort_order,
          weeklyPlays,
        };
      })
      .sort((a, b) => b.weeklyPlays - a.weeklyPlays);

    return Response.json({ playlists: scored });
  } catch {
    return Response.json({ error: 'Failed to load top playlists' }, { status: 500 });
  }
});