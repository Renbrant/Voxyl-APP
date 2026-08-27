import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

const peopleSource = source("../src/pages/People.jsx");
const requestCardSource = source("../src/components/people/PeopleRequestCard.jsx");
const i18nSource = source("../src/lib/i18n.js");
const layoutSource = source("../src/components/Layout.jsx");

describe("Issue #75 request workflow", () => {
  it("uses a dedicated People request card and preserves the exact Follow id", () => {
    assert.match(peopleSource, /components\/people\/PeopleRequestCard/);
    assert.equal((peopleSource.match(/<PeopleRequestCard/g) || []).length, 1);
    assert.match(peopleSource, /follow_id: follow\.id/);
    assert.match(peopleSource, /key=\{sectionUser\.follow_id\}/);
  });

  it("uses the existing authorized Follow item mutations for Accept and Decline", () => {
    assert.match(
      peopleSource,
      /Follow\.update\([\s\S]*requestUser\.follow_id,[\s\S]*status: 'accepted'/,
    );
    assert.match(peopleSource, /Follow\.delete\(requestUser\.follow_id\)/);
  });

  it("updates the request card and shared People summary cache immediately after success", () => {
    assert.match(peopleSource, /setQueryData\(pendingKey/);
    assert.match(peopleSource, /setQueryData\(summaryKey/);
    assert.match(peopleSource, /requests: Math\.max\(0, currentRequests - 1\)/);
    assert.match(peopleSource, /followers: action === 'accept'/);
    assert.match(peopleSource, /const summaryKey = \['people-summary', user\.id\]/);
    assert.match(
      layoutSource,
      /queryKey: \['people-summary', apiUser\?\.id\]/,
    );
  });

  it("reconciles successful mutations with server-authoritative queries", () => {
    assert.match(peopleSource, /invalidateQueries\(\{ queryKey: pendingKey \}\)/);
    assert.match(peopleSource, /invalidateQueries\(\{ queryKey: summaryKey \}\)/);
    assert.match(peopleSource, /people-incoming-accepted/);
    assert.match(peopleSource, /Promise\.allSettled\(refreshes\)/);
  });

  it("presents explicit touch-friendly Accept and Decline controls", () => {
    assert.match(requestCardSource, /UserAvatar/);
    assert.match(requestCardSource, /\/user\//);
    assert.match(requestCardSource, /peopleRequestContext/);
    assert.match(requestCardSource, /peopleAccept/);
    assert.match(requestCardSource, /peopleDecline/);
    assert.match(requestCardSource, /min-h-11/);
    assert.match(requestCardSource, /gradient-primary/);
    assert.doesNotMatch(requestCardSource, /FollowButton/);
  });

  it("serializes request actions while server reconciliation is in flight", () => {
    assert.match(peopleSource, /\|\| requestActionId\) return/);
    assert.match(peopleSource, /disabled=\{Boolean\(requestActionId\)\}/);
    assert.match(requestCardSource, /disabled = false/);
    assert.equal((requestCardSource.match(/disabled=\{disabled\}/g) || []).length, 2);
  });
  it("localizes the request context, actions, and failure message", () => {
    for (const key of [
      "peopleRequestContext",
      "peopleAccept",
      "peopleDecline",
      "peopleRequestActionError",
    ]) {
      assert.match(i18nSource, new RegExp(key + ":"));
    }

    assert.match(i18nSource, /Wants to follow you/);
    assert.match(i18nSource, /Accept/);
    assert.match(i18nSource, /Decline/);
  });
});
