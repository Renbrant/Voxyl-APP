import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const workerSource = fs.readFileSync(
  new URL('../workers/api/src/index.ts', import.meta.url),
  'utf8',
);

const summaryStart = workerSource.indexOf('async function peopleSummaryResponse');
const summaryEnd = workerSource.indexOf('async function followsResponse', summaryStart);
const summarySource =
  summaryStart >= 0 && summaryEnd > summaryStart
    ? workerSource.slice(summaryStart, summaryEnd)
    : '';

describe('Issue #74 People summary contract', () => {
  it('exposes the authenticated People summary GET route', () => {
    assert.match(
      workerSource,
      /function isPeopleSummaryRoute\(pathname: string\): boolean/,
    );
    assert.match(
      workerSource,
      /pathname === "\/api\/people\/summary" \|\| pathname === "\/people\/summary"/,
    );
    assert.match(
      workerSource,
      /request\.method === "GET" && isPeopleSummaryRoute\(pathname\)/,
    );
    assert.match(
      workerSource,
      /peopleSummaryResponse\(request, env\)/,
    );
  });

  it('uses uncapped authoritative counts for Following and Followers', () => {
    assert.ok(summarySource.length > 0);

    assert.match(
      summarySource,
      /FROM follows\s+WHERE follower_id = \?\s+AND status = 'accepted'/,
    );
    assert.match(
      summarySource,
      /FROM follows\s+WHERE following_id = \?\s+AND status = 'accepted'/,
    );
    assert.match(summarySource, /COUNT\(\*\)/);
    assert.doesNotMatch(summarySource, /\bLIMIT\b/);
    assert.match(summarySource, /WITH hidden_users AS/);
    assert.equal(
      (summarySource.match(/NOT IN \(SELECT user_id FROM hidden_users\)/g) || []).length,
      4,
    );
  });

  it('defines Requests as incoming pending requests and excludes blocked users', () => {
    assert.match(summarySource, /f\.following_id = \?/);
    assert.match(summarySource, /f\.status = 'pending'/);
    assert.match(summarySource, /f\.follower_id NOT IN/);

    assert.doesNotMatch(
      summarySource,
      /f\.follower_id = \?\s+AND f\.status = 'pending'/,
    );
  });

  it('defines Suggestions as visible users without an outgoing relationship', () => {
    assert.match(summarySource, /candidate\.username IS NOT NULL/);
    assert.match(summarySource, /TRIM\(candidate\.username\) <> ''/);
    assert.match(summarySource, /COALESCE\(candidate\.profile_hidden, 0\) = 0/);
    assert.match(summarySource, /candidate\.id NOT IN/);
    assert.match(summarySource, /existing\.follower_id = \?/);
    assert.match(summarySource, /existing\.following_id = candidate\.id/);
    assert.match(summarySource, /incoming_request\.follower_id = candidate\.id/);
    assert.match(summarySource, /incoming_request\.following_id = \?/);
    assert.match(summarySource, /incoming_request\.status = 'pending'/);
    assert.match(
      summarySource,
      /suggestions_strategy: "visible-follow-candidates"/,
    );
  });
});
