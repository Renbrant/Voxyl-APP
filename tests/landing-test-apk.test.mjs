import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const landing = readFileSync(new URL('../src/pages/Landing.jsx', import.meta.url), 'utf8');

test('landing page links the test APK and labels it as a test version', () => {
  assert.match(landing, /releases\/download\/android-test\/Voxyl-test\.apk/);
  assert.match(landing, /href=\{TEST_APK_DOWNLOAD_URL\}/);
  assert.match(landing, /versão de teste v\$\{APP_VERSION\}/);
  assert.match(landing, /test version v\$\{APP_VERSION\}/);
});

test('landing page reads the test version label from package.json', () => {
  assert.match(landing, /import \{ version as APP_VERSION \} from '..\/..\/package.json'/);
});
