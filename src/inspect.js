import {validateScenario, chunkBytes, LIMITS, ScenarioError} from './schema.js';
import {SseParser} from './parser.js';

export const REPORT_SCOPE = [
  'Offline inspection feeds the exact fixture byte chunks. Socket writes do not guarantee client read or TCP packet boundaries.',
  'Each response starts with its declared expected request cursor (null means empty); inspection does not observe or certify a real client.',
  'SSE fields follow UTF-8 replacement decoding, CR/LF framing and blank-line dispatch. EOF never implies a provider completion sentinel.',
  'Only explicit request-cursor assertions are checked during serving. Application completeness, duplicate IDs and provider protocols are not inferred.',
  'Reports include fixture content and the Last-Event-ID request header. Do not put credentials or private content in shared fixtures.',
];

function bytePreview(bytes) {
  const preview = bytes.subarray(0, 256);
  let escaped = '';
  for (const byte of preview) {
    if (byte === 10) escaped += '\\n';
    else if (byte === 13) escaped += '\\r';
    else if (byte === 9) escaped += '\\t';
    else if (byte === 92) escaped += '\\\\';
    else if (byte >= 32 && byte <= 126) escaped += String.fromCharCode(byte);
    else escaped += `\\x${byte.toString(16).padStart(2, '0')}`;
  }
  return {hex: preview.toString('hex').replace(/(..)/gu, '$1 ').trim(), escaped, previewTruncated: bytes.length > preview.length};
}

export function inspectScenario(value) {
  const scenario = validateScenario(value);
  let totalBytes = 0, totalChunks = 0, scheduledDelayMs = 0, observations = 0, outputCharacters = 0;
  const connections = scenario.connections.map((connection, index) => {
    const initialCursor = connection.expectedLastEventId ?? '';
    const parser = new SseParser({initialLastEventId: initialCursor});
    let offset = 0;
    const chunks = connection.chunks.map((chunk, chunkIndex) => {
      const bytes = chunkBytes(chunk);
      const startByte = offset;
      offset += bytes.length;
      parser.feed(bytes, chunkIndex);
      scheduledDelayMs += chunk.delayMs;
      return {index: chunkIndex, startByte, endByte: offset, byteLength: bytes.length, delayMs: chunk.delayMs, ...bytePreview(bytes)};
    });
    const parsed = parser.finish();
    outputCharacters += parser.outputCharacters;
    if (outputCharacters > LIMITS.reportCharacters) throw new ScenarioError('Scenario report character budget exceeded');
    observations += parsed.fields.length + parsed.events.length + parsed.cursorTransitions.length + parsed.retryObservations.length;
    if (observations > LIMITS.observations) throw new ScenarioError('Scenario report observation limit exceeded');
    totalBytes += offset;
    totalChunks += chunks.length;
    return {index, status: connection.status, end: connection.end, expectedLastEventId: connection.expectedLastEventId,
      initialCursor, chunks, ...parsed, request: null};
  });
  return {format: 'sse-fault-lab/report/v1', mode: 'inspect',
    scenario: {name: scenario.name, connectionCount: connections.length, totalBytes, totalChunks, scheduledDelayMs},
    summary: {events: connections.reduce((n, c) => n + c.events.length, 0),
      cursorChanges: connections.reduce((n, c) => n + c.cursorTransitions.length, 0),
      retryObservations: connections.reduce((n, c) => n + c.retryObservations.length, 0),
      incompleteResponses: connections.filter(c => c.notes.some(note => note.code === 'incomplete-eof')).length,
      requests: 0, assertionsPassed: 0, assertionsFailed: 0},
    outcome: 'inspected', connections, notes: [], scope: [...REPORT_SCOPE]};
}
