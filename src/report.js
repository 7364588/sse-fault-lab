import { readFileSync } from 'node:fs';

/** Render a portable report. Fixture text is data, never markup. */
export function renderReport(report) {
  const payload = JSON.stringify(report).replaceAll('&', '\\u0026').replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
  return readFileSync(new URL('./report.html', import.meta.url), 'utf8').replace('__REPORT_DATA__', () => payload);
}
