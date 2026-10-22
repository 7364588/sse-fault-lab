import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createScenarioServer, inspectScenario} from '../dist/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = join(root, 'examples', 'cursor-reset.json');
const scenario = JSON.parse(readFileSync(fixture, 'utf8'));
const report = inspectScenario(scenario);
assert.equal(report.connections[0].events[0].data, 'ready 🌍');
assert.equal(report.connections[0].finalCursor, '');
const directory = mkdtempSync(join(tmpdir(), 'sse-fault-smoke-'));
try {
  const output = join(directory, 'report.json');
  const html = join(directory, 'report.html');
  const result = spawnSync(process.execPath, [join(root, 'dist', 'cli.js'), 'inspect', fixture, '--output', output, '--html', html], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).format, 'sse-fault-lab/report/v1');
  assert.match(readFileSync(html, 'utf8'), /<!doctype html>/iu);
  const server = await createScenarioServer(scenario, {timeoutMs: 2000});
  try {
    const first = await fetch(server.url);
    assert.match(await first.text(), /checkpoint-1/u);
    assert.equal((await fetch(server.url)).status, 204);
    const served = await server.done;
    assert.equal(served.outcome, 'complete');
    assert.equal(served.summary.assertionsPassed, 2);
  } finally { await server.close(); }
} finally { rmSync(directory, {recursive: true}); }
console.log('CLI, API, report and real loopback HTTP smoke passed.');
