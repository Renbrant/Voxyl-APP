import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, it, mock } from 'node:test';
import { transformSync } from 'esbuild';
import { createPlaylistSubmission, getPlaylistCreationErrorKey } from '../src/lib/playlistCreation.js';
import { apiFetch, setAuthTokenGetter, voxylApi } from '../src/api/voxylApiClient.js';

const require = createRequire(import.meta.url);
afterEach(() => { mock.restoreAll(); mock.timers.reset(); setAuthTokenGetter(null); });

function modalHarness(file, props, api) {
  let cursor = 0;
  const states = [];
  const effects = [];
  const invalidations = [];
  const navigations = [];
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = { current: initial };
      return states[index];
    },
    useCallback: fn => fn,
    useEffect(fn) { if (!effects.length) effects.push(fn); },
  };
  const module = { exports: {} };
  const code = transformSync(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
  const modules = {
    react: hooks,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-router-dom': { useNavigate: () => destination => navigations.push(destination) },
    '@tanstack/react-query': { useQueryClient: () => ({}) },
    '@/api/voxylApiClient': { voxylApi: api },
    '@/lib/i18n': { t: key => key },
    '@/lib/playlistCreation': { createPlaylistSubmission, getPlaylistCreationErrorKey },
    '@/lib/savedContentQueries': { invalidateCreatedPlaylistQueries: (_, userId) => invalidations.push(userId) },
    '@/components/ui/button': { Button: 'button' },
    '@/lib/utils': { cn: (...args) => args.join(' ') },
    '@/lib/podcastSearchErrors': { getPodcastSearchErrorMessage: () => 'search failed' },
    'lucide-react': new Proxy({}, { get: (_, key) => key }),
    'framer-motion': { motion: new Proxy({}, { get: (_, key) => key }) },
  };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in modules, `Unhandled import ${name}`);
    return modules[name];
  }, module, module.exports);
  function render() { cursor = 0; return module.exports.default(props); }
  function flatten(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(flatten);
    return [node, ...flatten(node.props?.children)];
  }
  return { render, nodes: () => flatten(render()), effects, invalidations, navigations };
}

const text = node => {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node !== 'object' || !node) return String(node ?? '');
  return text(node.props?.children);
};

describe('actual playlist creation modal event handlers', () => {
  it('recovers from an API rejection, preserves the name and retries one operation before navigating', async () => {
    const payloads = [];
    let shouldFail = true;
    const created = [];
    const api = { entities: { Playlist: { create: async payload => {
      payloads.push(payload);
      if (shouldFail) throw Object.assign(new Error('Not found'), { status: 404 });
      return { id: 'saved', name: payload.name };
    } } } };
    const ui = modalHarness('../src/components/playlist/CreatePlaylistModal.jsx', {
      user: { id: 'owner', email: null }, onCreated: pl => created.push(pl), onClose() {},
    }, api);
    ui.nodes().find(n => n.type === 'input' && n.props.placeholder?.startsWith('Ex:')).props.onChange({ target: { value: 'Brazuka' } });
    let save = ui.nodes().find(n => n.type === 'button' && text(n).includes('Salvar e buscar podcasts'));
    const saving = save.props.onClick();
    assert.equal(ui.nodes().find(n => n.type === 'button' && text(n).includes('Salvando')).props.disabled, true);
    await saving;
    assert.equal(ui.nodes().find(n => n.props?.role === 'alert').props.children, 'playlistCreateFailed');
    assert.equal(ui.nodes().find(n => n.type === 'input' && n.props.value === 'Brazuka').props.value, 'Brazuka');
    assert.deepEqual(created, []);
    assert.deepEqual(ui.navigations, []);
    assert.deepEqual(ui.invalidations, []);
    shouldFail = false;
    save = ui.nodes().find(n => n.type === 'button' && text(n).includes('Salvar e buscar podcasts'));
    assert.equal(save.props.disabled, false);
    await save.props.onClick();
    assert.equal(payloads[0].creation_request_id, payloads[1].creation_request_id);
    assert.equal(created.length, 1);
    assert.deepEqual(ui.navigations, ['/discover']);
    assert.deepEqual(ui.invalidations, ['owner']);
  });

  it('shows an error and enables create-from-podcast again after rejection', async () => {
    const api = { auth: { me: async () => ({ id: 'owner' }) }, entities: { Playlist: {
      filter: async () => [], create: async () => { throw Object.assign(new Error('quota'), { data: { code: 'playlist-limit' } }); },
    } } };
    const ui = modalHarness('../src/components/explore/AddToPlaylistModal.jsx', { podcast: { title: 'Show', feedUrl: 'https://example.com/rss' }, onClose() {} }, api);
    ui.render();
    await ui.effects[0]();
    // The effect deliberately uses a promise chain rather than returning it.
    await new Promise(resolve => setImmediate(resolve));
    ui.nodes().find(n => n.type === 'button' && text(n).includes('Criar Nova Playlist')).props.onClick();
    ui.nodes().find(n => n.type === 'input').props.onChange({ target: { value: 'New' } });
    await ui.nodes().find(n => n.type === 'button' && text(n).includes('Criar e Adicionar')).props.onClick();
    assert.equal(ui.nodes().find(n => n.props?.role === 'alert').props.children, 'playlistCreateLimit');
    assert.equal(ui.nodes().find(n => n.type === 'button' && text(n).includes('Criar e Adicionar')).props.disabled, false);
    assert.deepEqual(ui.invalidations, []);
  });
});

describe('creation retry and timeout contracts', () => {
  it('blocks concurrent submissions and recovers after rejection using the same key', async () => {
    const payloads = [];
    let fail;
    const submit = createPlaylistSubmission(payload => {
      payloads.push(payload);
      return payloads.length === 1 ? new Promise((_, reject) => { fail = reject; }) : Promise.resolve({ id: 'saved' });
    });
    const first = submit({ name: 'One' });
    assert.equal(await submit({ name: 'One' }), null);
    fail(new Error('offline'));
    await assert.rejects(first, /offline/);
    await submit({ name: 'One' });
    assert.equal(payloads[0].creation_request_id, payloads[1].creation_request_id);
    await submit({ name: 'Two' });
    assert.notEqual(payloads[1].creation_request_id, payloads[2].creation_request_id);
  });

  it('rejects an unconfirmed success response and allows retry', async () => {
    const submit = createPlaylistSubmission(async () => ({ ok: true }));
    await assert.rejects(submit({ name: 'One' }), /not confirmed/);
    await assert.rejects(submit({ name: 'One' }), /not confirmed/);
  });

  it('times out even when token acquisition hangs', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    setAuthTokenGetter(() => new Promise(() => {}));
    const result = voxylApi.entities.Playlist.create({ name: 'Timeout' });
    const rejected = assert.rejects(result, error => error.name === 'TimeoutError');
    mock.timers.tick(20001);
    await rejected;
  });

  it('aborts pending fetch and preserves structured API error codes', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    setAuthTokenGetter(async () => 'token');
    let signal;
    mock.method(globalThis, 'fetch', async (_, options) => { signal = options.signal; return new Promise(() => {}); });
    const result = apiFetch('/test', { timeoutMs: 10 });
    const rejected = assert.rejects(result, error => error.name === 'TimeoutError');
    await Promise.resolve();
    mock.timers.tick(11);
    await rejected;
    assert.equal(signal.aborted, true);
    globalThis.fetch.mock.mockImplementation(async () => Response.json({ error: 'Limit', code: 'playlist-limit' }, { status: 409 }));
    await assert.rejects(apiFetch('/test'), error => error.status === 409 && error.code === 'playlist-limit');
  });
});
