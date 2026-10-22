import {readSync, openSync, closeSync, fstatSync, mkdtempSync, writeFileSync, linkSync, unlinkSync, rmdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {LIMITS, ScenarioError, parseScenario} from './schema.js';

export function readScenario(path) {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > LIMITS.scenarioBytes) throw new ScenarioError('Scenario must be a regular JSON file of at most 2 MiB');
    const buffer = Buffer.alloc(LIMITS.scenarioBytes + 1);
    let length = 0, count;
    do {
      count = readSync(fd, buffer, length, buffer.length - length, null);
      length += count;
    } while (count && length < buffer.length);
    if (length > LIMITS.scenarioBytes) throw new ScenarioError('Scenario input exceeds 2 MiB');
    const bytes = buffer.subarray(0, length);
    let text;
    try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
    catch { throw new ScenarioError('Scenario JSON must use UTF-8'); }
    return parseScenario(text);
  } finally { closeSync(fd); }
}

/** Publish a fully written file atomically without replacing any existing path. */
export function writeNew(path, content) {
  const destination = resolve(path);
  const temporary = mkdtempSync(join(dirname(destination), '.sse-fault-lab-'));
  const pending = join(temporary, 'report');
  try {
    writeFileSync(pending, content, {encoding: 'utf8', flag: 'wx'});
    linkSync(pending, destination);
  } finally {
    try { unlinkSync(pending); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    rmdirSync(temporary);
  }
}
