import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// deleteAccount — server-side account deactivation and full data cleanup.
// The Base44 platform does not expose an auth-user deletion API, so this function:
//   1. Anonymizes all user-owned playlists (identity removed, content preserved)
//   2. Deletes all user-specific records: likes, plays, progress, follows (both
//      directions), blocks (both directions), referrals, reports, podcast likes.
// The auth account remains (so the email cannot be re-used to recover data),
// but all personal data is removed and the user is effectively deactivated.

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const uid = user.id;
  const errors = [];

  const run = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      errors.push(`${label}: ${err?.message || String(err)}`);
    }
  };

  // ── 1. Anonymize user-owned playlists ─────────────────────────────────────
  await run('anonymize_playlists', async () => {
    const playlists = await base44.entities.Playlist.filter({ creator_id: uid });
    await Promise.all(playlists.map(p =>
      base44.asServiceRole.entities.Playlist.update(p.id, {
        creator_name: 'Deleted user',
        creator_username: '',
        creator_id: 'deleted',
        creator_picture: '',
        creator_hidden: true,
      })
    ));
  });

  // ── 2. Delete playlist likes by this user ─────────────────────────────────
  await run('playlist_likes', async () => {
    const likes = await base44.entities.PlaylistLike.filter({ user_id: uid });
    await Promise.all(likes.map(l => base44.asServiceRole.entities.PlaylistLike.delete(l.id)));
  });

  // ── 3. Delete podcast likes by this user ──────────────────────────────────
  await run('podcast_likes', async () => {
    const podLikes = await base44.entities.PodcastLike.filter({ user_id: uid });
    await Promise.all(podLikes.map(l => base44.asServiceRole.entities.PodcastLike.delete(l.id)));
  });

  // ── 4. Delete playback history (PodcastPlay) ──────────────────────────────
  await run('podcast_plays', async () => {
    const plays = await base44.entities.PodcastPlay.filter({ user_id: uid });
    await Promise.all(plays.map(p => base44.asServiceRole.entities.PodcastPlay.delete(p.id)));
  });

  // ── 5. Delete episode listening progress ──────────────────────────────────
  await run('episode_progress', async () => {
    const progress = await base44.entities.EpisodeProgress.filter({ user_id: uid });
    await Promise.all(progress.map(p => base44.asServiceRole.entities.EpisodeProgress.delete(p.id)));
  });

  // ── 6. Delete outgoing follows (follower_id = uid) ────────────────────────
  await run('outgoing_follows', async () => {
    const outgoing = await base44.asServiceRole.entities.Follow.filter({ follower_id: uid });
    await Promise.all(outgoing.map(f => base44.asServiceRole.entities.Follow.delete(f.id)));
  });

  // ── 7. Delete incoming follows (following_id = uid) ───────────────────────
  await run('incoming_follows', async () => {
    const incoming = await base44.asServiceRole.entities.Follow.filter({ following_id: uid });
    await Promise.all(incoming.map(f => base44.asServiceRole.entities.Follow.delete(f.id)));
  });

  // ── 8. Delete blocks created by this user ────────────────────────────────
  await run('blocks_by_user', async () => {
    const myBlocks = await base44.asServiceRole.entities.Block.filter({ blocker_id: uid });
    await Promise.all(myBlocks.map(b => base44.asServiceRole.entities.Block.delete(b.id)));
  });

  // ── 9. Delete blocks targeting this user ─────────────────────────────────
  await run('blocks_targeting_user', async () => {
    const targetBlocks = await base44.asServiceRole.entities.Block.filter({ blocked_id: uid });
    await Promise.all(targetBlocks.map(b => base44.asServiceRole.entities.Block.delete(b.id)));
  });

  // ── 10. Delete referrals sent by this user ────────────────────────────────
  await run('referrals', async () => {
    const referrals = await base44.asServiceRole.entities.Referral.filter({ inviter_id: uid });
    await Promise.all(referrals.map(r => base44.asServiceRole.entities.Referral.delete(r.id)));
  });

  // ── 11. Delete reports filed by this user ────────────────────────────────
  await run('reports', async () => {
    const reports = await base44.asServiceRole.entities.Report.filter({ reporter_id: uid });
    await Promise.all(reports.map(r => base44.asServiceRole.entities.Report.delete(r.id)));
  });

  // ── 12. Anonymize user profile ────────────────────────────────────────────
  await run('anonymize_profile', async () => {
    await base44.auth.updateMe({
      username: null,
      profile_picture: null,
      profile_hidden: true,
    });
  });

  if (errors.length > 0) {
    return Response.json({
      success: false,
      message: 'Account deactivation completed with errors',
      errors,
    }, { status: 207 });
  }

  return Response.json({ success: true, message: 'Account deactivated and data removed' });
});