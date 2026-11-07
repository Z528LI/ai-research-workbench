import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { listCapabilities, manifest, runCapability } from '../lib/capabilities.mjs';

test('all 88 capability IDs reconcile with the public index and execute their own examples', async () => {
  const index = await readFile(new URL('../../docs/module-capabilities.md', import.meta.url), 'utf8');
  const documented = [...index.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]).sort();
  const available = listCapabilities();
  assert.equal(available.length, 88);
  assert.deepEqual(available.map(row => row.id).sort(), documented);

  for (const { id, inputs } of available) {
    assert.ok(inputs?.length > 6, id);
    const example = manifest(id).example;
    const before = structuredClone(example);
    const result = await runCapability(id, example);
    assert.ok(Object.keys(result).length, id);
    assert.ok(JSON.stringify(result)?.length > 2, id);
    assert.deepEqual(example, before, `${id} mutated its input`);
  }
});

test('module dispatcher requires a registered ID and a structured input', async () => {
  await assert.rejects(runCapability('unknown-module', {}), /Unknown module/);
  await assert.rejects(runCapability('market-regime-unified-router', []), /JSON input object/);
  await assert.rejects(runCapability('market-regime-unified-router', {}));
});
