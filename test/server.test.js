import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createScenarioServer} from '../src/server.js';

const connection = (expectedLastEventId = null, text = 'data: x\n\n', end = 'eof') => ({expectedLastEventId, status: 200, chunks: [{text}], end});
const scenario = connections => ({format: 'sse-fault-lab/v1', name: 'HTTP regression fixture', connections});
async function run(connections, action, options = {}) {
  const handle = await createScenarioServer(scenario(connections), {timeoutMs: 2000, ...options});
  try { return await action(handle); } finally { await handle.close(); }
}
test('real HTTP sequence checks cursor then ends with 204 and shuts down', async () => {
  await run([connection(null, 'id: checkpoint\ndata: first\n\n'), {expectedLastEventId: 'checkpoint', status: 204, chunks: [], end: 'eof'}], async handle => {
    assert.equal(handle.url.startsWith('http://127.0.0.1:'), true);
    assert.match(await (await fetch(handle.url)).text(), /checkpoint/u);
    const last = await fetch(handle.url, {headers: {'Last-Event-ID': 'checkpoint'}});
    assert.equal(last.status, 204);
    const report = await handle.done;
    assert.equal(report.outcome, 'complete');
    assert.equal(report.summary.assertionsPassed, 2);
    assert.equal(report.connections[1].request.lastEventId, 'checkpoint');
    await assert.rejects(fetch(handle.url));
  });
});
test('absent and explicitly empty cursor headers are different assertions', async () => {
  await run([connection('')], async handle => {
    assert.equal((await fetch(handle.url)).status, 409);
    const report = await handle.done;
    assert.equal(report.outcome, 'assertion-failed');
    assert.equal(report.summary.assertionsFailed, 1);
  });
  await run([connection('')], async handle => {
    const response = await fetch(handle.url, {headers: {'Last-Event-ID': ''}});
    await response.text();
    assert.equal((await handle.done).summary.assertionsPassed, 1);
  });
});
test('root, wrong route, method and foreign origin do not advance sequence', async () => {
  await run([connection()], async handle => {
    assert.equal((await fetch(handle.origin)).status, 200);
    assert.equal((await fetch(handle.origin + '/unknown')).status, 404);
    assert.equal((await fetch(handle.url, {method: 'POST', body: 'not retained'})).status, 405);
    assert.equal((await fetch(handle.url, {headers: {Origin: 'https://example.invalid'}})).status, 403);
    assert.equal(handle.snapshot().summary.requests, 0);
    const final = await fetch(handle.url, {headers: {Authorization: 'Bearer synthetic-secret', Cookie: 'private=synthetic-secret'}});
    assert.equal(final.headers.get('access-control-allow-origin'), null);
    await final.text();
    assert.equal(JSON.stringify(await handle.done).includes('synthetic-secret'), false);
  });
});
test('disconnect produces an incomplete HTTP response instead of a clean EOF', async () => {
  await run([connection(null, 'data: delivered\n\ndata: pending', 'disconnect')], async handle => {
    const observed = await new Promise((resolve, reject) => {
      const req = request(handle.url, res => {
        let bytes = '';
        res.on('data', chunk => { bytes += chunk.toString(); });
        res.on('aborted', () => resolve({aborted: true, bytes}));
        res.on('end', () => resolve({aborted: false, bytes}));
        res.on('error', () => {});
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(observed.aborted, true);
    assert.match(observed.bytes, /delivered/u);
    assert.equal((await handle.done).outcome, 'complete');
  });
});
test('bounded timeout cancels pending delays and releases the listener', async () => {
  const delayed = connection(); delayed.chunks[0].delayMs = 5000;
  await run([delayed], async handle => {
    const response = fetch(handle.url).then(res => res.text()).catch(() => null);
    const report = await handle.done;
    assert.equal(report.outcome, 'timeout');
    await response;
    await assert.rejects(fetch(handle.url));
  }, {timeoutMs: 75});
});
test('overlapping requests fail rather than consuming a different fixture step', async () => {
  const delayed = connection(); delayed.chunks[0].delayMs = 200;
  await run([delayed, connection()], async handle => {
    const first = await fetch(handle.url);
    const text = first.text().catch(() => null);
    assert.equal((await fetch(handle.url)).status, 409);
    assert.equal((await handle.done).outcome, 'assertion-failed');
    await text;
  });
});
test('explicit close is idempotent and preserves a bounded snapshot', async () => {
  await run([connection()], async handle => {
    const snapshot = handle.snapshot();
    snapshot.scenario.name = 'changed';
    assert.notEqual(handle.snapshot().scenario.name, 'changed');
    assert.equal((await handle.close()).outcome, 'closed');
    assert.deepEqual(await handle.close(), await handle.done);
  });
});
test('options cannot enable a public listener or an unlimited lifetime', async () => {
  for (const options of [{host: '0.0.0.0'}, {timeoutMs: Infinity}, {port: -1}, {timeoutMs: 0}, {port: null}, {timeoutMs: null}]) {
    await assert.rejects(createScenarioServer(scenario([connection()]), options));
  }
});
