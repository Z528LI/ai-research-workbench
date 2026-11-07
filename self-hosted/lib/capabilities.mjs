import { workflowCapabilities } from './capabilities/workflows.mjs';
import { marketCapabilities } from './capabilities/market.mjs';
import { companyCapabilities } from './capabilities/company.mjs';

const entries = [workflowCapabilities, marketCapabilities, companyCapabilities].flatMap(Object.entries);
const capabilities = new Map(entries);
if (entries.length !== 88 || capabilities.size !== 88) {
  throw new Error('The public capability registry must contain 88 unique modules.');
}

function getCapability(id) {
  const capability = capabilities.get(id);
  if (!capability) throw new Error('Unknown module. Run the list command for valid IDs.');
  return capability;
}

export function listCapabilities() {
  return [...capabilities].map(([id, capability]) => ({ id, inputs: capability.inputs }));
}

export function manifest(id) {
  const { inputs, example } = getCapability(id);
  return { id, inputs, example: structuredClone(example) };
}

export async function runCapability(id, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Provide a JSON input object.');
  const result = await getCapability(id).run(input);
  if (!result || typeof result !== 'object') throw new Error('Module returned no structured result.');
  return result;
}
