import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync, spawn} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const fixture = fileURLToPath(new URL('../examples/cursor-reset.json', import.meta.url));
const run = args => spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', timeout: 5000});
test('CLI help, version, validation and JSON inspection are runnable', () => {
  assert.equal(run(['--help']).status, 0);
  assert.equal(run(['--version']).stdout.trim(), '0.1.0');
  assert.equal(JSON.parse(run(['validate', fixture, '--json']).stdout).valid, true);
  const result = run(['inspect', fixture, '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).connections[0].events[0].data, 'ready 🌍');
});
test('CLI usage errors and invalid UTF-8 fail with 2 and no source echo', () => {
  for (const args of [[], ['invalid', fixture], ['validate', fixture, '--port', '5'], ['serve', fixture, '--port', 'abc'], ['inspect', fixture, '--unknown']]) assert.equal(run(args).status, 2);
  const directory = mkdtempSync(join(tmpdir(), 'sse-cli-'));
  try {
    const path = join(directory, 'private-synthetic.json');
    writeFileSync(path, Buffer.from([0xff]));
    const result = run(['validate', path]);
    assert.equal(result.status, 2);
    assert.equal(result.stderr.includes(directory), false);
  } finally { rmSync(directory, {recursive: true}); }
});
test('CLI creates reports without clobbering existing output or scenario inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sse-cli-'));
  try {
    const target = join(directory, 'report.json');
    const html = join(directory, 'report.html');
    const result = run(['inspect', fixture, '--output', target, '--html', html]);
    assert.equal(result.status, 0, result.stderr);
    const before = readFileSync(target);
    assert.equal(run(['inspect', fixture, '--output', target]).status, 2);
    assert.deepEqual(readFileSync(target), before);
    assert.deepEqual(readdirSync(directory).sort(), ['report.html', 'report.json']);
    const scenarioBefore = readFileSync(fixture);
    assert.equal(run(['inspect', fixture, '--html', fixture]).status, 2);
    assert.deepEqual(readFileSync(fixture), scenarioBefore);
  } finally { rmSync(directory, {recursive: true}); }
});
test('CLI server timeout returns 1 with a final bounded report', () => {
  const result = run(['serve', fixture, '--timeout-ms', '75', '--json']);
  assert.equal(result.status, 1, result.stderr);
  const records = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(records[0].type, 'ready');
  assert.equal(records[1].report.outcome, 'timeout');
});
test('a closed diagnostic output pipe exits with the documented I/O code', async () => {
  const child = spawn(process.execPath, [cli, '--definitely-invalid-option'], {stdio: ['ignore', 'ignore', 'pipe']});
  child.stderr.destroy();
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 2);
});
