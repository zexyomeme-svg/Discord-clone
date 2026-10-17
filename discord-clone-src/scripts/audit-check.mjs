#!/usr/bin/env node
/**
 * Dependency audit gate.
 *
 * `npm audit --omit=dev` reports 0 for this project because every outstanding
 * advisory lives in the *build* toolchain, which is never shipped to the
 * browser. That made the README's old verification command structurally
 * incapable of noticing a new problem.
 *
 * This script audits the FULL tree and fails when:
 *   1. any production dependency has a high/critical advisory, or
 *   2. a dev dependency has a high/critical advisory that is not on the
 *      explicit, justified allowlist below.
 *
 * Adding an allowlist entry requires a reason and should be rare.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Accepted advisories. Each entry must state why the risk is not reachable. */
const ALLOWLIST = {
  'GHSA-vfj7-8cjw-p6xm': {
    pkg: 'braces',
    reason:
      'No patched release exists upstream (first_patched_version: null as of 2026-10). ' +
      'Reached only via micromatch <- vite-plugin-singlefile, a build-time plugin. ' +
      'braces is never bundled into dist/ and only ever sees glob patterns from our own ' +
      'Vite config, so the stack-exhaustion DoS is not reachable from untrusted input.',
  },
};

const SEVERITIES = new Set(['high', 'critical']);

// Packages listed under "dependencies" can end up in the shipped bundle.
// Anything else (devDependencies and their trees) is build-time only.
const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const PRODUCTION_DEPS = new Set(Object.keys(pkg.dependencies || {}));

function isProduction(pkgName) {
  return PRODUCTION_DEPS.has(pkgName);
}

function runAudit() {
  try {
    return JSON.parse(
      execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    );
  } catch (err) {
    // `npm audit` exits non-zero when it finds vulnerabilities; the report is
    // still on stdout.
    if (err?.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch {
        /* fall through to the hard failure below */
      }
    }
    console.error('Could not run `npm audit --json`.');
    console.error(err?.stderr || err?.message || String(err));
    process.exit(2);
  }
}

const report = runAudit();
const vulnerabilities = report?.vulnerabilities || {};

const failures = [];
const accepted = [];

for (const [name, vuln] of Object.entries(vulnerabilities)) {
  if (!SEVERITIES.has(vuln.severity)) continue;

  // `via` entries are either advisory objects (this package is affected
  // directly) or strings naming the dependency that pulled the problem in.
  const directAdvisories = (vuln.via || []).filter((v) => v && typeof v === 'object');

  if (directAdvisories.length === 0) {
    // Purely transitive: reported through its parent, but still gate on it.
    if (isProduction(name)) {
      failures.push({ name, severity: vuln.severity, ghsa: 'transitive', title: 'transitive high/critical advisory' });
    }
    continue;
  }

  for (const adv of directAdvisories) {
    const ghsa = adv.url ? String(adv.url).split('/').filter(Boolean).pop() : String(adv.source || 'unknown');
    const allowed = ALLOWLIST[ghsa] && !isProduction(name);

    if (allowed) {
      accepted.push({ name, severity: vuln.severity, ghsa, reason: ALLOWLIST[ghsa].reason });
      continue;
    }

    failures.push({
      name,
      severity: vuln.severity,
      ghsa,
      title: adv.title || name,
      production: isProduction(name),
      fixAvailable: vuln.fixAvailable,
    });
  }
}

if (accepted.length) {
  console.log(`\nAccepted, documented, build-time only: ${accepted.length}`);
  for (const a of accepted) {
    console.log(`  - ${a.name} [${a.severity}] ${a.ghsa}`);
    console.log(`      ${a.reason}`);
  }
}

if (failures.length) {
  console.log(`\nFAIL: ${failures.length} unaccepted high/critical finding(s):\n`);
  for (const f of failures) {
    const where = f.production ? 'PRODUCTION dependency' : 'dev dependency';
    console.log(`  - ${f.name} [${f.severity}] ${f.ghsa} (${where}) — ${f.title}`);
    if (f.fixAvailable) console.log(`      fix available: ${JSON.stringify(f.fixAvailable)}`);
  }
  console.log('\nResolve it, or add a justified entry to ALLOWLIST in scripts/audit-check.mjs.\n');
  process.exit(1);
}

console.log('\nOK: no unaccepted high/critical advisories.\n');
