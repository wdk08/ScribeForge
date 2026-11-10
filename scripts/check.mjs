import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for (const directory of ['js', 'scripts']) {
  for (const file of readdirSync(directory, { recursive: true }).filter(name => /\.(?:js|mjs)$/.test(name))) {
    execFileSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' });
  }
}
console.log('All JavaScript modules passed syntax checks.');
