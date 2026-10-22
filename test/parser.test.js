import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SseParser} from '../src/parser.js';
import {LIMITS} from '../src/schema.js';

function parse(text, chunks, initialLastEventId = '') {
  const bytes = Buffer.from(text);
  const parser = new SseParser({initialLastEventId});
  if (chunks) chunks.forEach((chunk, index) => parser.feed(chunk, index));
  else parser.feed(bytes);
  return parser.finish();
}
const events = report => report.events.map(({type, data, lastEventId}) => ({type, data, lastEventId}));

test('data fields, explicit empty data, named events and one optional space', () => {
  const result = parse('data\n\nevent: update\ndata: one\ndata:  two\n\n');
  assert.deepEqual(events(result), [
    {type: 'message', data: '', lastEventId: ''},
    {type: 'update', data: 'one\n two', lastEventId: ''},
  ]);
});
test('every byte split preserves UTF-8, BOM and CR/LF framing', () => {
  const source = '\ufeffid: a\r\ndata: 🌍 café 汉字\r\n\r\ndata: next\r\r';
  const bytes = Buffer.from(source);
  const baseline = events(parse(source));
  for (let split = 0; split <= bytes.length; split++) {
    assert.deepEqual(events(parse(source, [bytes.subarray(0, split), bytes.subarray(split)])), baseline, `split ${split}`);
  }
  assert.deepEqual(events(parse(source, [...bytes].map(byte => Buffer.from([byte])))), baseline);
});
test('only the initial BOM is removed; later BOM belongs to field data', () => {
  assert.deepEqual(events(parse('\ufeffdata: x\n\ndata: \ufeffy\n\n')), [
    {type: 'message', data: 'x', lastEventId: ''}, {type: 'message', data: '\ufeffy', lastEventId: ''},
  ]);
  assert.equal(parse('\n\ufeffdata: ignored\n\n').events.length, 0);
});
test('id-only blocks commit; omitted id inherits; empty id resets', () => {
  const result = parse('id: a\n\ndata: first\n\nid:\n\ndata: second\n\n');
  assert.deepEqual(result.cursorTransitions.map(({from, to}) => ({from, to})), [{from: '', to: 'a'}, {from: 'a', to: ''}]);
  assert.deepEqual(result.events.map(e => e.lastEventId), ['a', '']);
  assert.equal(result.finalCursor, '');
  assert.equal(parse('data: next\n\n', undefined, 'prior').events[0].lastEventId, 'prior');
});
test('NUL id ignored, unknown fields and names are case sensitive', () => {
  const result = parse('id: a\n\nid: b\0c\ndata: value\nData: ignored\nunknown: ignored\n\n');
  assert.equal(result.finalCursor, 'a');
  assert.equal(result.events[0].data, 'value');
  assert.ok(result.fields.some(f => f.kind === 'ignored-id'));
});
test('retry ASCII digits preserve large integers and ignore signed or Unicode digits', () => {
  const result = parse('retry: 00012\nretry: 999999999999999999999999999\nretry: +12\nretry: １２\nretry:\n');
  assert.deepEqual(result.retryObservations.map(r => r.milliseconds), ['12', '999999999999999999999999999', null, null, null]);
});
test('EOF never dispatches data or commits incomplete id blocks', () => {
  for (const suffix of ['data: unfinished', 'data: unfinished\n', 'id: next\n', 'id: next']) {
    const result = parse('id: prior\ndata: complete\n\n' + suffix);
    assert.equal(result.events.length, 1);
    assert.equal(result.finalCursor, 'prior');
    assert.equal(result.notes[0].code, 'incomplete-eof');
  }
  assert.equal(parse('data: done\r\r').events.length, 1);
});
test('invalid UTF-8 uses replacement decoding and cannot swallow newlines', () => {
  const bytes = Buffer.from([100, 97, 116, 97, 58, 32, 0xf0, 0x9f, 10, 10]);
  const result = parse('', [bytes.subarray(0, 7), bytes.subarray(7)]);
  assert.equal(result.events[0].data, '\ufffd');
});
test('byte coordinates identify consumed delimiters across CRLF feeds', () => {
  const parser = new SseParser();
  parser.feed(Buffer.from('data: x\r'), 0);
  parser.feed(Buffer.from('\n\r'), 1);
  parser.feed(Buffer.from('\n'), 2);
  const result = parser.finish();
  assert.equal(result.events[0].atByte, 10);
  assert.equal(result.events[0].chunkIndex, 1);
  assert.equal(result.totalBytes, 11);
});
test('limits bound long lines, observations and event accumulation', () => {
  assert.throws(() => parse('x'.repeat(LIMITS.lineBytes + 1)), /line exceeds/u);
  assert.throws(() => parse(':\n'.repeat(LIMITS.observations + 1)), /observation limit/u);
  assert.throws(() => parse(('data: ' + 'x'.repeat(60000) + '\n').repeat(5)), /event data limit/u);
});
test('empty input and comments produce no events; finished parser cannot be fed', () => {
  assert.equal(parse('').events.length, 0);
  assert.equal(parse(': heartbeat\n\n').events.length, 0);
  const parser = new SseParser();
  assert.deepEqual(parser.finish(), parser.finish());
  assert.throws(() => parser.feed(Buffer.from('')), /finished/u);
});
test('inherited long IDs cannot amplify a small fixture into an enormous report', () => {
  const source = 'id: ' + 'x'.repeat(60000) + '\n\n' + 'data\n\n'.repeat(100);
  assert.throws(() => parse(source), /report character budget/u);
});
