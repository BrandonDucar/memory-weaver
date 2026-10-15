import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('README exposes security, support and contribution routes', () => {
  for (const file of ['SECURITY.md', 'SUPPORT.md', 'CONTRIBUTING.md']) {
    assert(read('README.md').includes(`](${file})`));
    assert(read(file).length > 300);
  }
});

test('security policy distinguishes alpha support, privacy and receipt types', () => {
  const policy = read('SECURITY.md');
  for (const boundary of ['security/advisories/new', 'Supported Versions', 'backport',
    'FNV-1a', 'Ed25519', 'not an', 'OS-keychain', 'read-only', 'No response-time']) {
    assert(policy.includes(boundary), `Missing boundary: ${boundary}`);
  }
  assert(!policy.includes('military-grade'));
});

test('support does not send sensitive reports to ordinary issues', () => {
  const support = read('SUPPORT.md');
  assert(support.includes('Issues are public'));
  assert(support.includes('private reporting'));
  assert(support.includes('not necessarily an implemented'));
  assert(read('CONTRIBUTING.md').includes('negative tests'));
});

test('source repair does not imply patched historical binaries or skipped audit gates', () => {
  assert(read('README.md').includes('historical snapshot'));
  assert(read('desktop/README.md').includes('not a patched build'));
  assert(read('SECURITY.md').includes('not automatically rebuilt'));
  const workflow = read('.github/workflows/ci.yml');
  for (const gate of ['npm ci --ignore-scripts', 'npm ci --prefix desktop --ignore-scripts',
    'npm audit --audit-level=high', 'npm audit --prefix desktop --audit-level=high']) {
    assert(workflow.includes(gate), `Missing verification gate: ${gate}`);
  }
  assert(!workflow.includes('continue-on-error'));
});
