import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderReport} from '../src/report.js';

test('report data cannot close its JSON script or replace markup', () => {
  const report = {fixture: '</script><script>globalThis.injected=1</script>& $& $` $\' 🌍'};
  const html = renderReport(report);
  const payload = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(payload), report);
  assert.ok(!payload.includes('<'));
  assert.ok(!payload.includes('&'));
  assert.ok(!html.includes('<script>globalThis.injected=1</script>'));
  assert.equal(renderReport(report), html);
});

test('reports have no external scripts, styles or fetch dependencies', () => {
  const html = renderReport({});
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(!/<link[^>]+href=/i.test(html));
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(html.includes('textContent'));
});
