import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { followId, action } = await req.json();
    if (!followId) return Response.json({ error: 'followId required' }, { status: 400 });
    if (action !== 'accepted' && action !== 'declined') {
      return Response.json({ error: 'action must be accepted or declined' }, { status: 400 });
    }

    const follows = await base44.asServiceRole.entities.Follow.filter({ id: followId });
    const follow = follows[0];
    if (!follow) return Response.json({ error: 'Follow request not found' }, { status: 404 });

    // Only the followed user (the target) can respond
    if (follow.following_id !== me.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (action === 'accepted') {
      await base44.asServiceRole.entities.Follow.update(followId, { status: 'accepted' });
      return Response.json({ status: 'accepted' });
    } else {
      // Declined — delete the request
      await base44.asServiceRole.entities.Follow.delete(followId);
      return Response.json({ status: 'declined' });
    }
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});