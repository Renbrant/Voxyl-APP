import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

const userProfileSource = source("../src/pages/UserProfile.jsx");
const followButtonSource = source("../src/components/profile/FollowButton.jsx");
const i18nSource = source("../src/lib/i18n.js");

describe("Issue #75 public profile relationship context", () => {
  it("resolves outbound and inbound relationship state together", () => {
    assert.match(userProfileSource, /Promise\.all\(\[/);
    assert.match(
      userProfileSource,
      /follower_id: currentUser\.id, following_id: userId/,
    );
    assert.match(
      userProfileSource,
      /follower_id: userId, following_id: currentUser\.id, status: 'accepted'/,
    );
    assert.match(userProfileSource, /outgoing\?\.status === 'accepted'/);
    assert.match(userProfileSource, /outgoing\?\.status === 'pending'/);
    assert.doesNotMatch(userProfileSource, /setFollowStatus\(data\.isFollowing/);
  });

  it("makes every required public-profile relationship state explicit", () => {
    assert.match(userProfileSource, /peopleRelationshipContext/);
    assert.match(userProfileSource, /peopleFollowing/);
    assert.match(userProfileSource, /peopleFollowsYou/);
    assert.match(userProfileSource, /peopleRequested/);
    assert.match(userProfileSource, /peopleRelationshipNone/);
    assert.match(userProfileSource, /followStatus === 'accepted'/);
    assert.match(userProfileSource, /followStatus === 'pending'/);
    assert.match(userProfileSource, /!followStatus && !theyFollowMe/);
  });

  it("fails closed while relationship authority is unresolved", () => {
    assert.match(userProfileSource, /relationshipReady/);
    assert.match(userProfileSource, /relationshipError/);
    assert.match(userProfileSource, /peopleRelationshipLoading/);
    assert.match(userProfileSource, /peopleRelationshipError/);
    assert.match(userProfileSource, /peopleRelationshipRetry/);
    assert.match(
      userProfileSource,
      /relationshipReady && !relationshipError/,
    );
    assert.match(
      userProfileSource,
      /setRelationshipRetryNonce\(\(value\) => value \+ 1\)/,
    );
  });

  it("invalidates People caches after public-profile follow actions", () => {
    assert.match(userProfileSource, /useQueryClient/);
    assert.match(userProfileSource, /people-outgoing-follows/);
    assert.match(userProfileSource, /people-summary/);
    assert.match(userProfileSource, /people-suggestions-preview/);
    assert.match(userProfileSource, /Promise\.allSettled\(invalidations\)/);
  });

  it("keeps relationship unresolved while block or unblock refreshes authority", () => {
    assert.match(
      userProfileSource,
      /setTheyFollowMe\(false\);\s+setRelationshipReady\(false\);\s+setRelationshipError\(''\);\s+setRelationshipRetryNonce\(\(value\) => value \+ 1\)/,
    );
  });
  it("keeps relationship actions touch-friendly and bilingual", () => {
    assert.match(followButtonSource, /min-h-11/);

    for (const key of [
      "peopleRelationshipContext",
      "peopleRelationshipNone",
      "peopleRelationshipLoading",
      "peopleRelationshipError",
      "peopleRelationshipRetry",
    ]) {
      assert.match(i18nSource, new RegExp(key + ":"));
    }

    assert.match(i18nSource, /No current relationship/);
    assert.match(i18nSource, /Nenhuma relação atual/);
  });

  it("localizes the complete public-profile shell instead of mixing hardcoded Portuguese with i18n", () => {
    for (const key of [
      "profileTitle",
      "profileUnnamedUser",
      "profileBlock",
      "profileBlocked",
      "profileUnblock",
      "profileStats_followers",
      "profileStats_playlists",
      "profilePublicPlaylists",
      "profileNoPublic",
      "profileBlockConfirmTitle",
      "profileUnblockConfirmTitle",
      "profileUnblockConfirmBody",
      "profileBlockConfirmBodyPrefix",
      "profileBlockConfirmBodySuffix",
      "cancel",
    ]) {
      assert.match(userProfileSource, new RegExp(key));
      assert.match(i18nSource, new RegExp(key + ":"));
    }

    for (const hardcodedPortuguese of [
      ">Perfil<",
      " seguidores · ",
      "Nenhuma playlist pública",
      "Desbloquear usuário?",
      "Bloquear usuário?",
      "Aguarde...",
      "Cancelar",
      "Usuário",
    ]) {
      assert.equal(
        userProfileSource.includes(hardcodedPortuguese),
        false,
        hardcodedPortuguese,
      );
    }
  });
});
