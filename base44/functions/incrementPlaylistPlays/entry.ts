import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { playlist_id } = await req.json();

    if (!playlist_id) return Response.json({ error: 'Missing playlist_id' }, { status: 400 });

    // Fetch the current count from the DB to avoid race conditions
    const playlists = await base44.asServiceRole.entities.Playlist.filter({ id: playlist_id });
    if (!playlists.length) return Response.json({ error: 'Playlist not found' }, { status: 404 });

    const current = playlists[0].plays_count || 0;
    await base44.asServiceRole.entities.Playlist.update(playlist_id, { plays_count: current + 1 });

    return Response.json({ ok: true, plays_count: current + 1 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});