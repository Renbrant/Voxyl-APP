import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

const peopleSource = source("../src/pages/People.jsx");
const cardSource = source("../src/components/people/PeopleUserCard.jsx");
const followButtonSource = source("../src/components/profile/FollowButton.jsx");
const i18nSource = source("../src/lib/i18n.js");

describe("Issue #75 People relationship presentation", () => {
  it("moves People rows to a People-owned social card", () => {
    assert.match(peopleSource, /components\/people\/PeopleUserCard/);
    assert.doesNotMatch(peopleSource, /components\/explore\/UserSearchCard/);
    assert.equal((peopleSource.match(/<PeopleUserCard/g) || []).length, 2);
  });

  it("shows profile identity and opens the public profile", () => {
    assert.match(cardSource, /UserAvatar/);
    assert.match(cardSource, /user\.full_name/);
    assert.match(cardSource, /user\.username/);
    assert.match(cardSource, /\/user\//);
  });

  it("makes reciprocal and outgoing relationship context explicit", () => {
    assert.match(cardSource, /peopleFollowsYou/);
    assert.match(cardSource, /peopleFollowing/);
    assert.match(cardSource, /peopleRequested/);
    assert.match(cardSource, /relationshipLabels/);
  });

  it("localizes Follow, Follow back, Requested, and Following actions", () => {
    for (const key of ["peopleFollow", "peopleFollowBack", "peopleRequested", "peopleFollowing"]) {
      assert.match(followButtonSource, new RegExp(key));
    }
  });

  it("defines bilingual relationship terminology", () => {
    for (const key of ["peopleFollowsYou", "peopleFollow", "peopleFollowBack", "peopleRequested"]) {
      assert.match(i18nSource, new RegExp(key + ":"));
    }
    assert.match(i18nSource, /Follows you/);
    assert.match(i18nSource, /Follow back/);
    assert.match(i18nSource, /Requested/);
  });
});
