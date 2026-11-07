import { open } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { listCapabilities, manifest, runCapability } from './lib/capabilities.mjs';

async function readInput(path) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 3_000_000) throw new Error('Use a JSON file of at most 3 MB.');
    try {
      return JSON.parse(await file.readFile('utf8'));
    } catch {
      throw new Error('The module input is not valid JSON.');
    }
  } finally {
    await file.close();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { demo: { type: 'boolean' }, input: { type: 'string' } },
  });
  const [action, id] = positionals;
  let output;
  if (action === 'list' && positionals.length === 1 && !values.input && !values.demo) {
    output = listCapabilities();
  } else if (action === 'manifest' && positionals.length === 2 && !values.input && !values.demo) {
    output = manifest(id);
  } else if (action === 'run' && positionals.length === 2 && Boolean(values.demo) !== Boolean(values.input)) {
    const input = values.demo ? manifest(id).example : await readInput(values.input);
    output = { module: id, mode: values.demo ? 'synthetic' : 'operator-input', result: await runCapability(id, input) };
  } else {
    throw new Error('Use list, manifest MODULE, or run MODULE --demo | --input PATH.');
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(`Module command failed. ${error.message}`);
  process.exitCode = 1;
});
