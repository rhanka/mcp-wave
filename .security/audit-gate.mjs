// Exception-aware npm-audit gate (same contract as sentropic's
// .security/audit-gate.mjs). It FAILS on any HIGH/CRITICAL advisory whose GHSA
// id is not in .security/audit-allowlist.json, FAILS when an allowlist entry is
// malformed, and FAILS unconditionally once an entry passes its review_due (so
// time-boxed exceptions cannot linger). Human record + justification for each
// allowlisted GHSA lives in .security/vulnerability-register.yaml.
//
// Usage:
//   node .security/audit-gate.mjs              # full tree (dev tooling included)
//   node .security/audit-gate.mjs --omit=dev   # runtime surface shipped in the image
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
// AUDIT_GATE_TODAY overridable only for tests; production uses the real UTC date.
const today = process.env.AUDIT_GATE_TODAY || new Date().toISOString().slice(0, 10);
const scope = args.length ? args.join(' ') : 'full tree';

const allowlist = JSON.parse(
  readFileSync(new URL('./audit-allowlist.json', import.meta.url), 'utf8'),
);
const entries = allowlist.allow || [];

const malformed = entries.filter(
  (e) =>
    !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(e.ghsa || '') ||
    !e.package ||
    !e.reason ||
    !/^\d{4}-\d{2}-\d{2}$/.test(e.review_due || ''),
);
if (malformed.length) {
  console.error('audit-gate: FAIL — malformed allowlist entries (need ghsa, package, reason, review_due YYYY-MM-DD):');
  for (const e of malformed) console.error(`  ${JSON.stringify(e)}`);
  process.exit(1);
}
const allowed = new Map(entries.map((e) => [e.ghsa, e]));

// Hard-expire: a past-due exception fails the build so it must be revisited.
const expired = entries.filter((e) => today > e.review_due);
if (expired.length) {
  console.error('audit-gate: FAIL — allowlist entries past review_due, revisit:');
  for (const e of expired) console.error(`  ${e.ghsa} ${e.package} (review_due ${e.review_due})`);
  process.exit(1);
}

// npm audit exits non-zero when vulnerabilities exist; capture stdout either way.
let raw = '';
try {
  raw = execFileSync('npm', ['audit', '--json', ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (e) {
  raw = e.stdout ? e.stdout.toString() : '';
}
if (!raw) {
  console.error('audit-gate: FAIL — no audit output');
  process.exit(1);
}
const report = JSON.parse(raw);
if (report.error) {
  console.error(`audit-gate: FAIL — npm audit error: ${JSON.stringify(report.error)}`);
  process.exit(1);
}
const vulns = report.vulnerabilities || {};

// Collect every GHSA id reachable for a package through the `via` graph.
const ghsaOf = (name, seen = new Set()) => {
  if (seen.has(name)) return [];
  seen.add(name);
  const v = vulns[name];
  if (!v) return [];
  const ids = [];
  for (const via of v.via || []) {
    if (typeof via === 'string') ids.push(...ghsaOf(via, seen));
    else if (via && via.url) {
      const m = via.url.match(/GHSA-[a-z0-9-]+/i);
      if (m) ids.push(m[0]);
    }
  }
  return ids;
};

const offenders = [];
let reported = 0;
for (const [name, v] of Object.entries(vulns)) {
  if (!['high', 'critical'].includes(v.severity)) {
    reported += 1;
    console.warn(`audit-gate: report-only ${v.severity} ${name}`);
    continue;
  }
  const ids = [...new Set(ghsaOf(name))];
  const unallowed = ids.filter((g) => !allowed.has(g));
  // Fail if we cannot map it to any GHSA, or any of its GHSAs is not allowlisted.
  if (ids.length === 0 || unallowed.length) {
    offenders.push(
      `${name} (${v.severity}) ghsa=[${ids.join(',') || 'unresolved'}]` +
        (unallowed.length ? ` unallowlisted=[${unallowed.join(',')}]` : ''),
    );
  }
}

if (offenders.length) {
  console.error(`audit-gate: FAIL [${scope}] — unallowlisted HIGH/CRITICAL advisories:`);
  for (const o of offenders) console.error('  ' + o);
  process.exit(1);
}
console.log(
  `audit-gate: OK [${scope}] — no unallowlisted HIGH/CRITICAL` +
    (allowed.size ? ` (allowlisted: ${[...allowed.keys()].join(', ')})` : '') +
    (reported ? `; ${reported} lower-severity finding(s) reported` : ''),
);
