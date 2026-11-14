import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

// ESLint's no-undef is not enforced in this project, so a removed import only fails at
// runtime, when the line executes (0.6.4: Feed used getCache after its import was dropped).
// Each helper below must be imported or declared in every file that calls it.
const root = new URL('..', import.meta.url).pathname;

const HELPERS = [
  'getCache',
  'setCache',
  'invalidateCache',
  'useQueryClient',
  'useQuery',
  'useMutation',
  'refreshBlockQueries',
  'useHiddenUsers',
  'useOutboundBlocks',
  'filterVisibleCreators',
  'isCreatorHidden',
  'blockQueryKeys',
  'fetchHiddenUserIds',
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.(?:js|jsx)$/.test(name)) files.push(path);
  }
  return files;
}

function isDeclared(source, name) {
  const declaration = new RegExp(
    `(?:import[^;]*\\b${name}\\b[^;]*from|(?:const|let|var|function)\\s+(?:\\{[^}]*)?\\b${name}\\b|export\\s+(?:async\\s+)?function\\s+${name}\\b)`,
  );
  return declaration.test(source);
}

describe('helpers used in src/ are imported or declared', () => {
  it('has no call to a known helper without an import or declaration', () => {
    const problems = [];
    for (const file of walk(join(root, 'src'))) {
      const source = readFileSync(file, 'utf8');
      for (const name of HELPERS) {
        const used = new RegExp(`(?<![.\\w])${name}\\s*\\(`).test(source.replace(/\/\/.*$/gm, ''));
        if (used && !isDeclared(source, name)) {
          problems.push(`${relative(root, file).split('\\').join('/')} uses ${name} without importing it`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });
});
