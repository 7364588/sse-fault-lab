import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {inspectScenario} from '../src/index.js';
import {renderReport} from '../src/report.js';

const scenario = JSON.parse(readFileSync(new URL('../examples/cursor-reset.json', import.meta.url), 'utf8'));
const report = inspectScenario(scenario);
report.demo = true;
mkdirSync(new URL('../docs/', import.meta.url), {recursive: true});
writeFileSync(new URL('../docs/demo.html', import.meta.url), renderReport(report));
writeFileSync(new URL('../docs/demo.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log('Generated synthetic docs/demo.html and docs/demo.json.');
