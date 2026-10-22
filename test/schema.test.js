import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateScenario, parseScenario, LIMITS} from '../src/schema.js';
import {inspectScenario} from '../src/inspect.js';

const fixture = () => ({format: 'sse-fault-lab/v1', name: 'synthetic', connections: [{expectedLastEventId: null, status: 200, chunks: [{text: 'data: hello\n\n'}], end: 'eof'}]});
test('normalization is deterministic, does not mutate and fills only optional delay', () => {
  const input = fixture(), original = structuredClone(input);
  const validated = validateScenario(input);
  assert.deepEqual(input, original);
  assert.equal(validated.connections[0].chunks[0].delayMs, 0);
  assert.deepEqual(inspectScenario(input), inspectScenario(input));
  assert.equal(inspectScenario(input).connections[0].request, null);
});
test('unknown fields and wrong scalar types fail at every level', () => {
  for (const mutate of [s => {s.command = 'never execute';}, s => {s.connections[0].url = 'https://example.invalid';}, s => {s.connections[0].chunks[0].file = 'outside';}, s => {s.connections[0].status = '200';}, s => {s.connections[0].chunks[0].delayMs = null;}, s => {delete s.connections[0].expectedLastEventId;}, s => {s.name = '\ud800';}]) {
    const input = fixture(); mutate(input); assert.throws(() => validateScenario(input));
  }
});
test('canonical base64 and exactly one encoding field are enforced', () => {
  for (const chunk of [{base64: 'Zg'}, {base64: 'Zh=='}, {base64: 'Zg==\n'}, {base64: '%'}, {text: 'x', base64: 'eA=='}, {}]) {
    const s = fixture(); s.connections[0].chunks = [chunk]; assert.throws(() => validateScenario(s));
  }
  const s = fixture(); s.connections[0].chunks = [{base64: 'Zg=='}];
  assert.equal(validateScenario(s).connections[0].chunks[0].base64, 'Zg==');
});
test('204 is bodyless, cursor assertions distinguish absent and empty', () => {
  const s = fixture(); s.connections[0].status = 204;
  assert.throws(() => validateScenario(s), /204/u);
  s.connections[0].chunks = [];
  s.connections[0].expectedLastEventId = '';
  assert.equal(validateScenario(s).connections[0].expectedLastEventId, '');
  s.connections[0].end = 'disconnect'; assert.throws(() => validateScenario(s));
});
test('resource limits reject bytes, chunk counts, time and cursor controls', () => {
  for (const mutate of [s => {s.connections[0].chunks = [{text: 'x'.repeat(LIMITS.totalBytes + 1)}];}, s => {s.connections[0].chunks = Array.from({length: LIMITS.chunks + 1}, () => ({text: ''}));}, s => {s.connections[0].chunks[0].delayMs = Infinity;}, s => {s.connections[0].chunks = Array.from({length: 7}, () => ({text: '', delayMs: 10000}));}, s => {s.connections[0].expectedLastEventId = 'a\nb';}]) {
    const s = fixture(); mutate(s); assert.throws(() => validateScenario(s));
  }
  assert.throws(() => parseScenario(' '.repeat(LIMITS.scenarioBytes + 1)), /2 MiB/u);
  assert.throws(() => parseScenario('{ broken'), /valid JSON/u);
});
test('inspect provides byte previews with explicit truncation and no remote activity', () => {
  const s = fixture(); s.connections[0].chunks = [{text: 'data: ' + 'x'.repeat(300) + '\n\n'}];
  const r = inspectScenario(s);
  assert.equal(r.connections[0].chunks[0].previewTruncated, true);
  assert.equal(r.connections[0].events[0].data.length, 300);
  assert.equal(r.summary.requests, 0);
});
test('the report character budget applies across all connections together', () => {
  const s = fixture();
  const c = s.connections[0];
  c.chunks[0].text = 'id: ' + 'x'.repeat(30000) + '\n\n' + 'data\n\n'.repeat(80);
  s.connections = [structuredClone(c), structuredClone(c)];
  assert.throws(() => inspectScenario(s), /Scenario report character budget/u);
});
