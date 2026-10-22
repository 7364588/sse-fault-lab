#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readScenario, writeNew} from './io.js';
import {ScenarioError} from './schema.js';
import {inspectScenario} from './inspect.js';
import {createScenarioServer} from './server.js';
import {renderReport} from './report.js';

const HELP = `SSE Fault Lab 0.1.0 — bounded local SSE fixtures

  sse-fault-lab validate SCENARIO [--json]
  sse-fault-lab inspect SCENARIO [--json] [--output REPORT.json] [--html REPORT.html]
  sse-fault-lab serve SCENARIO [--port 0] [--timeout-ms 15000] [--output REPORT.json] [--html REPORT.html] [--json]

serve binds 127.0.0.1 only. Open its printed origin for a native EventSource client,
or point one client at /events. Only that route advances the scenario. --output
and --html create new files; existing files are never replaced. --json prints a
ready record then a result record while serving. There are no outbound requests.

Exit: 0 validated/inspected/completed; 1 runtime assertion/timeout/interruption;
2 invalid input, usage, I/O, or resource limit. --help and --version are offline.
`;

let brokenOutput = false;
process.stdout.on('error', () => { brokenOutput = true; });
// A closed stderr pipe raises an asynchronous stream error, outside try/catch.
process.stderr.on('error', () => { process.exitCode = 2; });
const output = text => new Promise((resolve, reject) => {
  if (brokenOutput) { reject(new Error('stdout unavailable')); return; }
  process.stdout.write(text, error => error ? reject(error) : resolve());
});
function number(value, label) {
  if (!/^[0-9]+$/u.test(value)) throw new ScenarioError(`${label} must be a nonnegative integer`);
  return Number(value);
}
function display(report) {
  return `${report.scenario.name}\n${report.outcome}: ${report.scenario.connectionCount} responses, ${report.scenario.totalBytes} bytes, ${report.summary.events} events\n` +
    (report.mode === 'serve' ? `${report.summary.assertionsPassed} cursor assertions passed; ${report.summary.assertionsFailed} failed.\n` : 'Offline byte inspection; no client requests observed.\n');
}
async function save(report, values) {
  if (values.output) writeNew(values.output, JSON.stringify(report, null, 2) + '\n');
  if (values.html) writeNew(values.html, renderReport(report));
}

async function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, strict: true, options: {
    help: {type: 'boolean', short: 'h'}, version: {type: 'boolean'}, json: {type: 'boolean'},
    output: {type: 'string'}, html: {type: 'string'}, port: {type: 'string'}, 'timeout-ms': {type: 'string'},
  }});
  if (values.help) { await output(HELP); return 0; }
  if (values.version) { await output('0.1.0\n'); return 0; }
  if (positionals.length !== 2 || !['validate', 'inspect', 'serve'].includes(positionals[0])) throw new ScenarioError('Expected validate, inspect or serve and one scenario file; see --help');
  const [command, path] = positionals;
  if (command !== 'serve' && (values.port !== undefined || values['timeout-ms'] !== undefined)) throw new ScenarioError('port and timeout-ms apply only to serve');
  if (command === 'validate' && (values.output !== undefined || values.html !== undefined)) throw new ScenarioError('validate does not write reports; use inspect');
  const scenario = readScenario(path);
  if (command === 'validate') {
    await output(values.json ? JSON.stringify({valid: true, name: scenario.name, connections: scenario.connections.length}) + '\n' : `Valid scenario: ${scenario.name} (${scenario.connections.length} responses).\n`);
    return 0;
  }
  if (command === 'inspect') {
    const report = inspectScenario(scenario);
    await save(report, values);
    await output(values.json ? JSON.stringify(report) + '\n' : display(report));
    return 0;
  }
  const handle = await createScenarioServer(scenario, {
    port: values.port === undefined ? 0 : number(values.port, 'port'),
    timeoutMs: values['timeout-ms'] === undefined ? 15000 : number(values['timeout-ms'], 'timeout-ms'),
  });
  const stop = () => { void handle.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await output(values.json ? JSON.stringify({type: 'ready', url: handle.url, origin: handle.origin}) + '\n' : `Listening: ${handle.url}\nNative client: ${handle.origin}/\n`);
    const report = await handle.done;
    await save(report, values);
    await output(values.json ? JSON.stringify({type: 'result', report}) + '\n' : display(report));
    return report.outcome === 'request-limit' ? 2 : report.outcome === 'complete' && !report.summary.assertionsFailed ? 0 : 1;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await handle.close();
  }
}

try { process.exitCode = await main(); }
catch (error) {
  const message = error instanceof ScenarioError ? error.message :
    error.code === 'EEXIST' ? 'Output already exists; choose a new filename.' :
    error.code?.startsWith('ERR_PARSE_ARGS') ? 'Invalid command options; see --help.' :
    'The operation could not complete because of an I/O or runtime error.';
  try { process.stderr.write(`sse-fault-lab: ${message}\n`); } catch {}
  process.exitCode = 2;
}
if (brokenOutput) process.exitCode = 2;
