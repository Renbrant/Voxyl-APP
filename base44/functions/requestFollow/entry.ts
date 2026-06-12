import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { targetUserId } = await req.json();
    if (!targetUserId) return Response.json({ error: 'targetUserId required' }, { status: 400 });
    if (targetUserId === me.id) return Response.json({ error: 'Cannot follow yourself' }, { status: 400 });

    // Prevent duplicate active follow records
    const existing = await base44.asServiceRole.entities.Follow.filter({
      follower_id: me.id,
      following_id: targetUserId,
    });
    if (existing.length > 0) {
      return Response.json({ follow: existing[0] });
    }

    const follow = await base44.asServiceRole.entities.Follow.create({
      follower_id: me.id,
      follower_email: me.email,
      follower_name: me.full_name || me.email.split('@')[0],
      follower_username: me.username || '',
      following_id: targetUserId,
      status: 'pending', // always pending — never trust client
    });

    return Response.json({ follow });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});