import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const peopleSource = fs.readFileSync(
  new URL('../src/pages/People.jsx', import.meta.url),
  'utf8',
);
const apiSource = fs.readFileSync(
  new URL('../src/api/voxylApiClient.js', import.meta.url),
  'utf8',
);
const i18nSource = fs.readFileSync(
  new URL('../src/lib/i18n.js', import.meta.url),
  'utf8',
);

describe('Issue #74 People dashboard ownership', () => {
  it('owns People directly and defines exactly four social sections with no Overview tab', () => {
    assert.doesNotMatch(peopleSource, /from '@\/pages\/Explore'/);

    const start = peopleSource.indexOf('const PEOPLE_SECTIONS');
    const end = peopleSource.indexOf('const PEOPLE_SECTION_KEYS', start);

    assert.ok(start >= 0 && end > start);

    const sections = peopleSource.slice(start, end);
    const keys = [...sections.matchAll(/key: '(following|followers|requests|suggestions)'/g)]
      .map((match) => match[1]);

    assert.deepEqual(keys, ['following', 'followers', 'requests', 'suggestions']);
    assert.doesNotMatch(sections, /overview/i);
  });

  it('uses the authoritative People summary without inventing dashboard zeroes', () => {
    assert.match(peopleSource, /voxylApi\.people\.summary\(\)/);
    assert.match(peopleSource, /summaryQuery\.isLoading/);
    assert.match(peopleSource, /summaryQuery\.isError/);
    assert.match(peopleSource, /summaryCounts\[section\.key\]/);
    assert.match(apiSource, /apiFetch\("\/people\/summary"\)/);
  });

  it('defines Requests as incoming pending requests and makes their priority textual', () => {
    assert.match(
      peopleSource,
      /following_id: user\.id, status: 'pending'/,
    );
    assert.match(peopleSource, /peopleRequestsAttention/);
  });

  it('uses a clearly bounded recent Suggestions subset matching summary eligibility rules', () => {
    assert.match(
      peopleSource,
      /invoke\('searchUsers', \{ query: '' \}\)/,
    );
    assert.match(peopleSource, /!hiddenIds\.has\(candidate\.id\)/);
    assert.match(peopleSource, /!followStatuses\[candidate\.id\]/);
    assert.match(peopleSource, /!incomingPendingIds\.has\(candidate\.id\)/);
    assert.match(peopleSource, /peopleSuggestionsSubset/);
  });

  it('keeps user search inside People and independent from the selected section', () => {
    assert.match(peopleSource, /peopleSearchPlaceholder/);
    assert.match(peopleSource, /searchMode \? \(/);
    assert.match(peopleSource, /searchRows\.map\(\(searchedUser/);
  });

  it('defines localized loading, error, sign-in, and empty-state copy', () => {
    for (const key of [
      'peopleFollowing',
      'peopleFollowers',
      'peopleRequests',
      'peopleSuggestions',
      'peopleSummaryError',
      'peopleSectionError',
      'peopleSignInTitle',
      'peopleNoRequests',
    ]) {
      assert.match(i18nSource, new RegExp(`${key}:`));
    }
  });
});
