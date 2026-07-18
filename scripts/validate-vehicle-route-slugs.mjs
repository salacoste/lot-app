import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { generateSlug } from '../utils/slugify.shared.mjs';

const fixtureUrl = new URL('./fixtures/vehicle-route-slugs.json', import.meta.url);
const cases = JSON.parse(await readFile(fixtureUrl, 'utf8'));

for (const golden of cases) {
  assert.equal(generateSlug(golden.input), golden.slug, golden.case);
}

console.log(`Validated ${cases.length} vehicle route slug fixtures against app generateSlug.`);
