import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { userId } = body;

    if (!userId) return Response.json({ error: 'userId required' }, { status: 400 });

    // Determine caller identity server-side — never trust client-supplied IDs
    let callerId = null;
    try {
      const me = await base44.auth.me();
      callerId = me?.id ?? null;
    } catch (_) {
      callerId = null;
    }

    const isOwner = callerId !== null && callerId === userId;

    // Check accepted follow relationship (caller → target)
    let isFollowing = false;
    if (callerId && !isOwner) {
      const follows = await base44.asServiceRole.entities.Follow.list('-created_date', 500);
      const match = follows.find(f => f.follower_id === callerId && f.following_id === userId);
      isFollowing = match?.status === 'accepted';
    }

    // Fetch all playlists for target user via service role
    const allPlaylists = await base44.asServiceRole.entities.Playlist.filter(
      { creator_id: userId },
      '-created_date',
      200
    );

    // Apply visibility rules
    const visible = allPlaylists.filter(p => {
      const vis = p.visibility || 'public';
      if (isOwner) return true;
      if (vis === 'public') return true;
      if (vis === 'friends_only') return isFollowing;
      return false; // private — owner only
    });

    // Strip sensitive fields from non-owner responses
    const sanitized = visible.map(p => {
      if (isOwner) return p;
      const { creator_email, ...safe } = p;
      return safe;
    });

    return Response.json({ playlists: sanitized, isFollowing });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});