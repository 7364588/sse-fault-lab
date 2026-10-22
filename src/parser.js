import {LIMITS, ScenarioError} from './schema.js';

/**
 * A bounded SSE reference parser. Feed bytes, not independently decoded chunks.
 * Newline bytes cannot occur inside a UTF-8 multibyte sequence, so complete byte
 * lines can be decoded without losing sequences that crossed feed boundaries.
 */
export class SseParser {
  constructor({initialLastEventId = ''} = {}) {
    if (typeof initialLastEventId !== 'string' || !initialLastEventId.isWellFormed() || Buffer.byteLength(initialLastEventId) > LIMITS.cursorBytes) throw new TypeError('initialLastEventId must be well-formed text of at most 256 UTF-8 bytes');
    this.cursor = initialLastEventId;
    this.idBuffer = initialLastEventId;
    this.line = [];
    this.lineLength = 0;
    this.totalBytes = 0;
    this.pendingCR = false;
    this.firstLine = true;
    this.data = '';
    this.eventType = '';
    this.dirtyBlock = false;
    this.lineNumber = 0;
    this.closed = false;
    this.events = [];
    this.fields = [];
    this.cursorTransitions = [];
    this.retryObservations = [];
    this.notes = [];
    this.observations = 0;
    this.outputCharacters = 0;
  }

  _record(list, entry) {
    if (++this.observations > LIMITS.observations) throw new ScenarioError('SSE observation limit exceeded');
    this.outputCharacters += JSON.stringify(entry).length;
    if (this.outputCharacters > LIMITS.reportCharacters) throw new ScenarioError('SSE report character budget exceeded');
    list.push(entry);
  }

  feed(input, chunkIndex = 0) {
    if (this.closed) throw new ScenarioError('Cannot feed a finished SSE parser');
    if (!(input instanceof Uint8Array)) throw new TypeError('SSE input must be Uint8Array bytes');
    if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) throw new TypeError('chunkIndex must be a nonnegative integer');
    const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    if (this.totalBytes + bytes.length > LIMITS.totalBytes) throw new ScenarioError('SSE byte limit exceeded');
    let start = 0;
    const append = end => {
      if (end <= start) return;
      this.lineLength += end - start;
      if (this.lineLength > LIMITS.lineBytes) throw new ScenarioError('SSE line exceeds 64 KiB');
      this.line.push(Buffer.from(bytes.subarray(start, end)));
    };
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (this.pendingCR) {
        this.pendingCR = false;
        if (byte === 10) { start = i + 1; continue; }
      }
      if (byte !== 10 && byte !== 13) continue;
      append(i);
      const line = Buffer.concat(this.line, this.lineLength);
      this.line = [];
      this.lineLength = 0;
      this._processLine(line, this.totalBytes + i + 1, chunkIndex);
      this.pendingCR = byte === 13;
      start = i + 1;
    }
    append(bytes.length);
    this.totalBytes += bytes.length;
  }

  _processLine(bytes, atByte, chunkIndex) {
    let text = new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes);
    if (this.firstLine) {
      this.firstLine = false;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    this.lineNumber++;
    const location = {line: this.lineNumber, atByte, chunkIndex};
    if (text === '') {
      if (this.cursor !== this.idBuffer) {
        this._record(this.cursorTransitions, {...location, from: this.cursor, to: this.idBuffer});
        this.cursor = this.idBuffer;
      }
      if (this.data !== '') {
        if (this.events.length >= LIMITS.events) throw new ScenarioError('SSE event limit exceeded');
        this._record(this.events, {index: this.events.length, type: this.eventType || 'message', data: this.data.slice(0, -1), lastEventId: this.cursor, ...location});
      }
      this.data = '';
      this.eventType = '';
      this.dirtyBlock = false;
      return;
    }
    this.dirtyBlock = true;
    if (text.startsWith(':')) {
      this._record(this.fields, {...location, name: ':', value: text.slice(1), kind: 'comment'});
      return;
    }
    const colon = text.indexOf(':');
    const name = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    let kind = ['data', 'event', 'id', 'retry'].includes(name) ? name : 'ignored';
    if (name === 'id' && value.includes('\0')) kind = 'ignored-id';
    if (name === 'retry' && !/^[0-9]+$/u.test(value)) kind = 'ignored-retry';
    this._record(this.fields, {...location, name, value, kind});
    if (name === 'data') {
      if (this.data.length + value.length + 1 > LIMITS.eventCharacters) throw new ScenarioError('SSE event data limit exceeded');
      this.data += `${value}\n`;
    } else if (name === 'event') this.eventType = value;
    else if (name === 'id' && kind === 'id') this.idBuffer = value;
    else if (name === 'retry') {
      // Keep decimal digits as text: very large retry values must not silently
      // become Infinity or lose precision. This tool never schedules from retry.
      this._record(this.retryObservations, {...location, value, accepted: kind === 'retry', milliseconds: kind === 'retry' ? value.replace(/^0+(?=\d)/u, '') : null});
    }
  }

  finish() {
    if (!this.closed) {
      this.closed = true;
      if (this.lineLength || this.dirtyBlock || this.data || this.eventType || this.idBuffer !== this.cursor) {
        this.notes.push({code: 'incomplete-eof', message: 'EOF discarded an unterminated line or event block; no final event was invented.'});
      }
      this.line = [];
      this.lineLength = 0;
      this.data = '';
      this.eventType = '';
      this.idBuffer = this.cursor;
    }
    return {events: this.events, fields: this.fields, cursorTransitions: this.cursorTransitions,
      retryObservations: this.retryObservations, notes: this.notes, finalCursor: this.cursor, totalBytes: this.totalBytes};
  }
}
