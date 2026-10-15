import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const glob = require('fast-glob');

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-weaver-glob-'));
  context.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert(path.basename(root).startsWith('memory-weaver-glob-'));
    fs.rmSync(root, {recursive: true, force: true});
  });
  for (const file of ['src/one.js', 'src/two.ts', 'src/three/index.ts', 'src/ignored.txt', '.hidden.js', 'apps/alpha/page.tsx', 'apps/beta/page.tsx']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
    fs.writeFileSync(path.join(root, file), 'inert fixture\n');
  }
  return root;
}

test('default, sync and named APIs preserve multi-extension import discovery', async context => {
  const cwd = fixture(context);
  const patterns = ['src/*.{js,ts}', 'src/*/index.{js,ts}'];
  const expected = ['src/one.js', 'src/three/index.ts', 'src/two.ts'];
  assert.deepEqual(glob.sync(patterns, {cwd}).sort(), expected);
  assert.deepEqual(glob.globSync(patterns, {cwd}).sort(), expected);
  assert.deepEqual((await glob(patterns, {cwd})).sort(), expected);
  assert.deepEqual((await glob.glob(patterns, {cwd})).sort(), expected);
});

test('Next root-directory matching does not expand directories into files', context => {
  const cwd = fixture(context);
  assert.deepEqual(glob.globSync('apps/*', {cwd, onlyDirectories: true}).sort(), ['apps/alpha', 'apps/beta']);
  assert.deepEqual(glob.sync('src', {cwd}), []);
});

test('both real build-tool consumers resolve the adapter and Next discovers roots', context => {
  const cwd = fixture(context);
  for (const consumer of ['@next/eslint-plugin-next', 'vite-plugin-dynamic-import']) {
    const fromConsumer = createRequire(require.resolve(consumer));
    assert.equal(fromConsumer('fast-glob/package.json').version, '3.3.3-dreamnet.1');
    assert.equal(typeof fromConsumer('fast-glob').globSync, 'function');
  }
  const nextRoot = path.dirname(require.resolve('@next/eslint-plugin-next'));
  const {getRootDirs} = require(path.join(nextRoot, 'utils/get-root-dirs.js'));
  const discovered = getRootDirs({cwd, settings: {next: {rootDir: path.join(cwd, 'apps/*')}}});
  assert.deepEqual(discovered.map(dir => path.resolve(dir)).sort(),
    ['alpha', 'beta'].map(name => path.join(cwd, 'apps', name)).sort());
});

test('negation, explicit ignore and hidden-file selection remain functional', context => {
  const cwd = fixture(context);
  assert.deepEqual(glob.sync(['src/*.{js,ts}', '!src/two.ts'], {cwd}), ['src/one.js']);
  assert.deepEqual(glob.sync('src/*.{js,ts}', {cwd, ignore: ['src/two.ts']}), ['src/one.js']);
  assert.deepEqual(glob.sync('*.js', {cwd}), []);
  assert.deepEqual(glob.sync('*.js', {cwd, dot: true}), ['.hidden.js']);
  assert(glob.sync('src/one.js', {cwd, absolute: true}).every(file => path.isAbsolute(file)));
});

test('unsupported modes and pathological expressions fail closed', async () => {
  for (const options of [{objectMode: true}, {deep: 2}, {fs: {}}, {stats: true}]) {
    assert.throws(() => glob.sync('*.js', options), /Unsupported build glob option/);
    await assert.rejects(glob('*.js', options), /Unsupported build glob option/);
  }
  for (const pattern of ['{'.repeat(15000) + 'a' + '}'.repeat(15000), '('.repeat(1000), 'x'.repeat(4097)]) {
    assert.throws(() => glob.sync(pattern), /complexity limit/);
    await assert.rejects(glob(pattern), /complexity limit/);
  }
  assert.throws(() => glob.sync(['*.js'], {ignore: ['{'.repeat(1000)]}), /complexity limit/);
  assert.throws(() => glob.sync(Array(257).fill('*.js')), /at most 256/);
  assert.throws(() => glob.sync([42]), /must be strings/);
});

test('the resolved graph removes the vulnerable parser rather than suppressing its audit', () => {
  const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  for (const entry of Object.keys(lock.packages)) {
    assert(!/(?:^|\/)node_modules\/(?:braces|micromatch)$/.test(entry), `Unexpected old parser: ${entry}`);
  }
  assert.equal(require('fast-glob/package.json').version, '3.3.3-dreamnet.1');
  assert.equal(require('fast-glob/package.json').private, true);
  assert(require.resolve('tinyglobby'));
});
