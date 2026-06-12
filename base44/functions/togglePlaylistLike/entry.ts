// v3 - recounts from PlaylistLike records for accuracy
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { playlist_id } = await req.json();
    if (!playlist_id) return Response.json({ error: 'playlist_id required' }, { status: 400 });

    // Check if already liked
    const existing = await base44.asServiceRole.entities.PlaylistLike.filter({ playlist_id, user_id: user.id });
    const liked = existing.length > 0;

    if (liked) {
      await base44.asServiceRole.entities.PlaylistLike.delete(existing[0].id);
    } else {
      await base44.asServiceRole.entities.PlaylistLike.create({ playlist_id, user_id: user.id, user_email: user.email });
    }

    // Recount from source of truth instead of increment/decrement
    const allLikes = await base44.asServiceRole.entities.PlaylistLike.filter({ playlist_id });
    const newCount = allLikes.length;

    await base44.asServiceRole.entities.Playlist.update(playlist_id, { likes_count: newCount });

    return Response.json({ liked: !liked, likes_count: newCount });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});