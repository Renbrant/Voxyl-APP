import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import worker from '../workers/api/src/index.ts';

const workerSource = fs.readFileSync(
  new URL('../workers/api/src/index.ts', import.meta.url),
  'utf8',
);

const exploreSource = fs.readFileSync(
  new URL('../src/pages/Explore.jsx', import.meta.url),
  'utf8',
);

describe('Issue #63 social/profile regressions', () => {
  it('renders searched users independently from connections and pending filters', () => {
    assert.match(
      exploreSource,
      /debouncedUserSearch\.trim\(\) \? \([\s\S]*filteredUsers\.map\(\(searchedUser/,
    );
  });

  it('derives both sides of follow display data from users rows', () => {
    assert.match(
      workerSource,
      /LEFT JOIN users fu ON fu\.id = f\.follower_id/,
    );
    assert.match(
      workerSource,
      /LEFT JOIN users tu ON tu\.id = f\.following_id/,
    );
    assert.match(
      workerSource,
      /tu\.name AS following_name/,
    );
    assert.match(
      workerSource,
      /tu\.username AS following_username/,
    );
  });

  it('does not query nonexistent following_name/following_username columns from follows', () => {
    assert.doesNotMatch(
      workerSource,
      /f\.following_name/,
    );
    assert.doesNotMatch(
      workerSource,
      /f\.following_username/,
    );
  });

  it('uses the working Voxyl R2 public hostname for uploaded profile photos', () => {
    assert.match(
      workerSource,
      /https:\/\/voxyl-media\.renbrant\.com\/\$\{objectKey\}/,
    );
    assert.doesNotMatch(
      workerSource,
      /https:\/\/media\.renbrant\.com\/\$\{objectKey\}/,
    );
  });

  it('exposes authenticated follow item PATCH and DELETE routes', async () => {
    const baseEnv = {
      CLERK_AUTHORIZED_PARTIES: 'https://v.renbrant.com',
    };

    const patchResponse = await worker.fetch(
      new Request('https://api.voxyl.test/api/entities/follow/follow-1', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'accepted' }),
      }),
      baseEnv,
    );

    assert.equal(patchResponse.status, 401);

    const deleteResponse = await worker.fetch(
      new Request('https://api.voxyl.test/api/entities/follow/follow-1', {
        method: 'DELETE',
      }),
      baseEnv,
    );

    assert.equal(deleteResponse.status, 401);
  });
});
