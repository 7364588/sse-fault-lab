/** Bounded, data-only scenario validation. No paths, code hooks or network URLs. */
export const LIMITS = Object.freeze({
  scenarioBytes: 2 * 1024 * 1024, totalBytes: 1024 * 1024,
  connections: 32, chunks: 2048, delayMs: 10000, totalDelayMs: 60000,
  lineBytes: 65536, eventCharacters: 262144, observations: 8192,
  events: 4096, cursorBytes: 256, timeoutMs: 120000, reportCharacters: 4 * 1024 * 1024,
});

export class ScenarioError extends Error {
  constructor(message) { super(message); this.name = 'ScenarioError'; }
}

function fail(where, message) { throw new ScenarioError(`${where}: ${message}`); }
function object(value, where, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(where, 'expected an object');
  if (Object.keys(value).some(key => !keys.includes(key))) fail(where, 'unknown field');
}
function integer(value, min, max, where) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(where, `expected integer ${min}..${max}`);
}
function unicode(value, where) {
  if (typeof value !== 'string' || !value.isWellFormed()) fail(where, 'expected well-formed Unicode text');
}
export function chunkBytes(chunk) {
  return Object.hasOwn(chunk, 'text') ? Buffer.from(chunk.text, 'utf8') : Buffer.from(chunk.base64, 'base64');
}

/** Validate and return a new normalized scenario; never mutates the input. */
export function validateScenario(value) {
  object(value, 'scenario', ['format', 'name', 'connections']);
  if (value.format !== 'sse-fault-lab/v1') fail('scenario.format', 'expected sse-fault-lab/v1');
  unicode(value.name, 'scenario.name');
  if (!value.name.trim() || value.name.length > 120 || /[\x00-\x1f\x7f]/u.test(value.name)) fail('scenario.name', 'expected 1..120 printable characters');
  if (!Array.isArray(value.connections) || !value.connections.length || value.connections.length > LIMITS.connections) fail('scenario.connections', 'expected 1..32 connections');
  let bytes = 0, chunks = 0, delay = 0;
  const connections = value.connections.map((connection, index) => {
    const where = `connections[${index}]`;
    object(connection, where, ['expectedLastEventId', 'status', 'chunks', 'end']);
    if (!Object.hasOwn(connection, 'expectedLastEventId')) fail(where, 'expectedLastEventId is required');
    if (connection.expectedLastEventId !== null) {
      unicode(connection.expectedLastEventId, `${where}.expectedLastEventId`);
      if (Buffer.byteLength(connection.expectedLastEventId) > LIMITS.cursorBytes || /[\x00-\x1f\x7f]/u.test(connection.expectedLastEventId)) fail(where, 'cursor must fit 256 UTF-8 bytes and contain no control characters');
    }
    if (![200, 204].includes(connection.status)) fail(where, 'status must be 200 or 204');
    if (!['eof', 'disconnect'].includes(connection.end)) fail(where, 'end must be eof or disconnect');
    if (!Array.isArray(connection.chunks) || connection.chunks.length > LIMITS.chunks) fail(where, 'chunks must be an array with at most 2048 entries');
    if (connection.status === 204 && (connection.chunks.length || connection.end !== 'eof')) fail(where, '204 requires no chunks and end=eof');
    const normalizedChunks = connection.chunks.map((chunk, ci) => {
      const location = `${where}.chunks[${ci}]`;
      object(chunk, location, ['text', 'base64', 'delayMs']);
      if (Object.hasOwn(chunk, 'text') === Object.hasOwn(chunk, 'base64')) fail(location, 'provide exactly one of text or base64');
      if (Object.hasOwn(chunk, 'text')) {
        unicode(chunk.text, location);
        if (chunk.text.length > LIMITS.totalBytes) fail(location, 'text chunk exceeds byte limit');
      }
      else if (typeof chunk.base64 !== 'string' || chunk.base64.length > LIMITS.scenarioBytes ||
               !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(chunk.base64) ||
               Buffer.from(chunk.base64, 'base64').toString('base64') !== chunk.base64) fail(location, 'base64 must be canonical padded base64');
      const delayMs = Object.hasOwn(chunk, 'delayMs') ? chunk.delayMs : 0;
      integer(delayMs, 0, LIMITS.delayMs, location);
      chunks++;
      bytes += chunkBytes(chunk).length;
      delay += delayMs;
      if (chunks > LIMITS.chunks || bytes > LIMITS.totalBytes || delay > LIMITS.totalDelayMs) fail('scenario', 'total chunk, byte or delay limit exceeded');
      return Object.hasOwn(chunk, 'text') ? {text: chunk.text, delayMs} : {base64: chunk.base64, delayMs};
    });
    return {expectedLastEventId: connection.expectedLastEventId, status: connection.status, chunks: normalizedChunks, end: connection.end};
  });
  return {format: value.format, name: value.name, connections};
}

export function parseScenario(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > LIMITS.scenarioBytes) throw new ScenarioError('Scenario JSON exceeds the 2 MiB input limit');
  let value;
  try { value = JSON.parse(text); } catch { throw new ScenarioError('Scenario input must be valid JSON'); }
  return validateScenario(value);
}
