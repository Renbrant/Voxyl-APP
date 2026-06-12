import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { followId, targetUserId } = await req.json();

    // Support lookup by followId or by targetUserId
    let follow;
    if (followId) {
      const follows = await base44.asServiceRole.entities.Follow.filter({ id: followId });
      follow = follows[0];
    } else if (targetUserId) {
      const follows = await base44.asServiceRole.entities.Follow.filter({
        follower_id: me.id,
        following_id: targetUserId,
      });
      follow = follows[0];
    } else {
      return Response.json({ error: 'followId or targetUserId required' }, { status: 400 });
    }

    if (!follow) return Response.json({ error: 'Follow record not found' }, { status: 404 });

    // Only the follower can cancel their own request
    if (follow.follower_id !== me.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    await base44.asServiceRole.entities.Follow.delete(follow.id);
    return Response.json({ status: 'cancelled' });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});