import {mkdirSync, readdirSync, copyFileSync, chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'src');
const destination = resolve(root, 'dist');
mkdirSync(destination, {recursive: true});
for (const entry of readdirSync(source, {withFileTypes: true})) {
  if (!entry.isFile() || !/\.(?:js|html)$/u.test(entry.name)) continue;
  const path = resolve(source, entry.name);
  if (entry.name.endsWith('.js')) {
    const checked = spawnSync(process.execPath, ['--check', path], {stdio: 'inherit'});
    if (checked.status !== 0) process.exit(checked.status ?? 1);
  }
  copyFileSync(path, resolve(destination, entry.name));
}
chmodSync(resolve(destination, 'cli.js'), 0o755);
console.log('Built dist from checked JavaScript and report assets.');
