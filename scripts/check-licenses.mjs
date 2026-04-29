#!/usr/bin/env node
// SPDX-License-Identifier: BUSL-1.1
/**
 * License allowlist gate — blocks GPL/AGPL/LGPL and any unknown license.
 * Run: node scripts/check-licenses.mjs
 * Used by CI (.github/workflows/ci.yml, "Check licenses" step).
 */
import { execSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'Python-2.0',
]);

/** Compound SPDX expressions like "(MIT OR CC0-1.0)" — pass if any alternative is allowed. */
function isAllowed(spdx) {
  const clean = spdx.replace(/^\(|\)$/g, '');
  return clean.split(/ OR /i).some((part) => ALLOWED.has(part.trim()));
}

const raw = execSync('pnpm licenses list --json', { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });

const jsonStart = raw.indexOf('{');
if (jsonStart === -1) {
  console.error('check-licenses: no JSON output from pnpm licenses list');
  process.exit(1);
}

/** @type {Record<string, Array<{name: string; versions: string[]}>>} */
const byLicense = JSON.parse(raw.slice(jsonStart));

const violations = [];

for (const [license, packages] of Object.entries(byLicense)) {
  if (!isAllowed(license)) {
    for (const pkg of packages) {
      violations.push({ name: pkg.name, versions: pkg.versions, license });
    }
  }
}

if (violations.length > 0) {
  console.error('check-licenses: FAILED — disallowed license(s) detected:\n');
  for (const v of violations) {
    console.error(`  ${v.name}@${v.versions.join(',')}  →  ${v.license}`);
  }
  console.error('\nAllowed SPDX identifiers:', [...ALLOWED].sort().join(', '));
  console.error('\nTo resolve: remove the dependency, replace it, or add an explicit allowlist exception with a justification comment in this script.');
  process.exit(1);
}

const totalLicenses = Object.keys(byLicense).length;
const totalPkgs = Object.values(byLicense).reduce((n, arr) => n + arr.length, 0);
console.log(`check-licenses: OK — ${totalPkgs} packages across ${totalLicenses} license type(s), all allowed.`);
