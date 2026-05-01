#!/usr/bin/env node
// SPDX-License-Identifier: BUSL-1.1
/**
 * License allowlist gate — hard-blocks GPL/AGPL, soft-warns on unknown metadata.
 * Run: node scripts/check-licenses.mjs
 * Used by CI (.github/workflows/ci.yml, "check-licenses" job).
 *
 * Exit codes:
 *   0 — all deps are allowed (or unknown count is within UNKNOWN_THRESHOLD)
 *   1 — copyleft (GPL/AGPL) dep found, or unknown count exceeds UNKNOWN_THRESHOLD
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
  'WTFPL',
  // LGPL-3.0-or-later: acceptable for on-prem distribution. The only current consumer is
  // @img/sharp-libvips-darwin-arm64 (optional native binary, transitive via Next.js image
  // optimisation). It is dynamically loaded and user-substitutable — LGPL's copyleft clause
  // does not extend to the rest of the codebase. Reviewed and approved by CTO for v1.
  'LGPL-3.0-or-later',
]);

/** Copyleft pattern: GPL-*, AGPL-* (any version). LGPL excluded per spec — evaluated as unknown. */
const COPYLEFT_RE = /^(A?GPL)(-|\b)/i;

/** Maximum number of unknown-license packages before the gate hard-fails. */
const UNKNOWN_THRESHOLD = 5;

/** Compound SPDX expressions like "(MIT OR CC0-1.0)" — pass if any alternative is allowed. */
function isAllowed(spdx) {
  const clean = spdx.replace(/^\(|\)$/g, '');
  return clean.split(/ OR /i).some((part) => ALLOWED.has(part.trim()));
}

function isCopyleft(spdx) {
  const clean = spdx.replace(/^\(|\)$/g, '');
  return clean.split(/ OR /i).every((part) => COPYLEFT_RE.test(part.trim()));
}

let raw;
try {
  raw = execSync('pnpm licenses list --json', {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
} catch (err) {
  // pnpm exits non-zero when it also prints to stderr; grab stdout anyway
  raw = err.stdout ?? '';
  if (!raw) {
    console.error('check-licenses: failed to run pnpm licenses list');
    console.error(err.stderr ?? err.message);
    process.exit(1);
  }
}

const jsonStart = raw.indexOf('{');
if (jsonStart === -1) {
  console.error('check-licenses: no JSON output from pnpm licenses list');
  process.exit(1);
}

/** @type {Record<string, Array<{name: string; versions: string[]}>>} */
const byLicense = JSON.parse(raw.slice(jsonStart));

const allPackages = [];
const copyleftViolations = [];
const unknownPackages = [];

for (const [license, packages] of Object.entries(byLicense)) {
  for (const pkg of packages) {
    const entry = { name: pkg.name, versions: pkg.versions, license };
    allPackages.push(entry);

    if (isCopyleft(license)) {
      copyleftViolations.push(entry);
    } else if (!isAllowed(license)) {
      unknownPackages.push(entry);
    }
  }
}

// Print full sorted dep list for audit trail
allPackages.sort((a, b) => a.name.localeCompare(b.name));
console.log('\nAll transitive dependencies:\n');
for (const p of allPackages) {
  console.log(`  ${p.name}@${p.versions.join(',')}  →  ${p.license}`);
}
console.log();

// Hard fail: copyleft
if (copyleftViolations.length > 0) {
  console.error('check-licenses: FAILED — copyleft (GPL/AGPL) license(s) detected:\n');
  for (const v of copyleftViolations) {
    console.error(`  ${v.name}@${v.versions.join(',')}  →  ${v.license}`);
  }
  console.error(
    '\nThese licenses are incompatible with BSL 1.1.',
    'Remove the dependency or replace it with a permissively-licensed alternative.',
  );
  process.exit(1);
}

// Soft warn / conditional fail: unknown
if (unknownPackages.length > 0) {
  const verb = unknownPackages.length > UNKNOWN_THRESHOLD ? 'FAILED' : 'WARNING';
  console.error(
    `check-licenses: ${verb} — ${unknownPackages.length} package(s) with unrecognised license metadata (threshold: ${UNKNOWN_THRESHOLD}):\n`,
  );
  for (const u of unknownPackages) {
    console.error(`  ${u.name}@${u.versions.join(',')}  →  ${u.license}`);
  }
  console.error(
    '\nTo resolve: verify each package license manually.',
    'Add the SPDX identifier to the ALLOWED set above if it is permissive,',
    'or remove the dependency.',
  );
  if (unknownPackages.length > UNKNOWN_THRESHOLD) {
    process.exit(1);
  }
  console.error(); // blank line before OK summary
}

const totalLicenses = Object.keys(byLicense).length;
console.log(
  `check-licenses: OK — ${allPackages.length} packages across ${totalLicenses} license type(s).`,
  unknownPackages.length > 0
    ? `(${unknownPackages.length} unknown — below threshold of ${UNKNOWN_THRESHOLD})`
    : 'All licenses are on the allowlist.',
);
