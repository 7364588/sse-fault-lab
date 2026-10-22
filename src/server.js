import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {validateScenario, chunkBytes, LIMITS, ScenarioError} from './schema.js';
import {inspectScenario} from './inspect.js';

const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SSE Fault Lab local client</title><style>body{font:16px system-ui;max-width:60rem;margin:4rem auto;padding:1rem;background:#111827;color:#e5e7eb}button{padding:.8rem;font:inherit}pre{white-space:pre-wrap;border:1px solid #4b5563;padding:1rem}</style><h1>Local native EventSource client</h1><p>This button consumes the one-client fixture sequence. Named events still reach the parser but only default message events are listed here. The server report records reconnect cursor assertions.</p><button id="start">Connect once</button> <button id="stop">Close client</button><pre id="log">Ready.</pre><script>let source;const log=document.querySelector('#log');function note(text){log.textContent+='\\n'+text}document.querySelector('#start').onclick=()=>{if(source)return;source=new EventSource('/events');document.querySelector('#start').disabled=true;source.onopen=()=>note('open');source.onmessage=e=>note(JSON.stringify({data:e.data,lastEventId:e.lastEventId}));source.onerror=()=>note('error; readyState='+source.readyState)};document.querySelector('#stop').onclick=()=>{if(source){source.close();note('closed by user')}};</script></html>`;

/**
 * Start a single logical-client sequence on 127.0.0.1. No remote targets or
 * authentication capture. done resolves after completion/failure/timeout.
 */
export async function createScenarioServer(value, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['port', 'timeoutMs'].includes(key))) throw new ScenarioError('Server options must contain only port and timeoutMs');
  const port = Object.hasOwn(options, 'port') ? options.port : 0;
  const timeoutMs = Object.hasOwn(options, 'timeoutMs') ? options.timeoutMs : 15000;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new ScenarioError('Port must be an integer from 0 to 65535');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > LIMITS.timeoutMs) throw new ScenarioError('Server timeout must be an integer from 50 to 120000 milliseconds');
  const scenario = validateScenario(value);
  const report = inspectScenario(scenario);
  report.mode = 'serve';
  report.outcome = 'running';
  let sequence = 0, requestCount = 0, active = false, finishing = false, timer, origin;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const abort = new AbortController();
  const snapshot = () => structuredClone(report);
  const server = createServer({maxHeaderSize: 4096}, (req, res) => {
    void handle(req, res).catch(() => {
      if (!finishing) {
        report.notes.push({code: 'transport-error', message: 'The local response transport failed.'});
        void finish('transport-error');
      }
    });
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = 16;
  server.on('clientError', (_error, socket) => socket.destroy());
  function response(res, status, body = '') {
    res.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(body);
  }
  async function finish(outcome) {
    if (finishing) return done;
    finishing = true;
    clearTimeout(timer);
    abort.abort();
    report.outcome = outcome;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    resolveDone(snapshot());
    return done;
  }
  async function handle(req, res) {
    requestCount++;
    if (requestCount > 128) {
      response(res, 429, 'Request limit reached.');
      setImmediate(() => void finish('request-limit'));
      return;
    }
    req.resume(); // Never collect request bodies.
    if (req.headers.host !== new URL(origin).host ||
        (req.headers.origin !== undefined && req.headers.origin !== origin)) {
      response(res, 403, 'Only same-origin loopback requests are accepted.');
      return;
    }
    if (req.method !== 'GET') { response(res, 405, 'Use GET.'); return; }
    if (req.url === '/') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
      res.end(PAGE);
      return;
    }
    if (req.url !== '/events') { response(res, 404, 'Only / and /events are available.'); return; }
    if (finishing) { response(res, 503, 'Scenario finished.'); return; }
    if (active || sequence >= scenario.connections.length) {
      response(res, 409, 'One logical client sequence is supported.');
      report.summary.assertionsFailed++;
      report.notes.push({code: 'unexpected-request', message: 'An overlapping or excess /events request was rejected.'});
      setImmediate(() => void finish('assertion-failed'));
      return;
    }
    const index = sequence++;
    const connection = scenario.connections[index];
    const headers = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === 'last-event-id') headers.push(req.rawHeaders[i + 1]);
    let lastEventId = null, malformed = false;
    if (headers.length === 1) {
      try {
        const bytes = Buffer.from(headers[0], 'latin1');
        if (bytes.length > LIMITS.cursorBytes) throw new Error('limit');
        lastEventId = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
        if (/[\x00-\x1f\x7f]/u.test(lastEventId)) throw new Error('control');
      } catch { malformed = true; lastEventId = null; }
    }
    const duplicate = headers.length > 1;
    const passed = !malformed && !duplicate && lastEventId === connection.expectedLastEventId;
    report.connections[index].request = {lastEventId, passed, malformed, duplicate};
    report.summary.requests++;
    report.summary[passed ? 'assertionsPassed' : 'assertionsFailed']++;
    if (!passed) {
      response(res, 409, 'Last-Event-ID assertion failed.');
      setImmediate(() => void finish('assertion-failed'));
      return;
    }
    active = true;
    let intentionalEnd = false;
    res.once('close', () => {
      if (!intentionalEnd && !finishing) {
        report.notes.push({code: 'client-disconnected', message: 'The client closed before the scripted response finished.'});
        void finish('client-disconnected');
      }
    });
    res.on('error', () => {}); // The write callback and close listener handle failures.
    res.writeHead(connection.status, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'});
    res.flushHeaders();
    for (const chunk of connection.chunks) {
      if (chunk.delayMs) await delay(chunk.delayMs, undefined, {signal: abort.signal});
      if (abort.signal.aborted || res.destroyed) return;
      const bytes = chunkBytes(chunk);
      if (bytes.length) await new Promise((resolve, reject) => res.write(bytes, error => error ? reject(error) : resolve()));
    }
    intentionalEnd = true;
    if (connection.end === 'disconnect') {
      // Yield after writes so the transport can flush; this deliberately does
      // not promise a TCP RST or any particular client read-chunk boundary.
      await new Promise(resolve => setImmediate(resolve));
      res.destroy();
    } else await new Promise(resolve => res.end(resolve));
    active = false;
    if (sequence === scenario.connections.length && !finishing) {
      setImmediate(() => void finish('complete'));
    }
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  server.on('error', () => { void finish('transport-error'); });
  timer = setTimeout(() => {
    report.notes.push({code: 'timeout', message: 'The bounded server lifetime ended before the scenario completed.'});
    void finish('timeout');
  }, timeoutMs);
  return {url: `${origin}/events`, origin, port: server.address().port, done, snapshot, close: () => finish('closed')};
}
