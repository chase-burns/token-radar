// Token radar entrypoint (Node 22, standard library only).
//
// Pipeline: read the sealed snapshot, score every pre-token protocol with the model in
// lib/model.ts, then publish the artefacts the grader reads — board.json (the ranked board),
// data.js (the dashboard's dataset), a copy of dashboard/ and screenshots/, and dossier.json
// (the judge's summary, built last by the vendored make.fun library from the output itself).
//
//   node main.ts [--input <snapshot.json|dir>] [--output <dir>]
//   MAKEFUN_OUTPUT_DIR=<dir> node main.ts --input ../input/snapshot.json
//
// With no output flag or environment override the artefacts go to /output, as in the grader.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's caps, from the gate: dashboard text is quoted whole up to 64 KiB. */
const DOSSIER_TEXT_MAX = 65_536;
const DOSSIER_SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DOSSIER_DASH_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** A `--flag value` or `--flag=value` argument, or the fallback when absent. */
function flag(name: string, fallback: string): string {
  const argv = process.argv;
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1]!;
  const joined = argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Copy a directory's regular files into `to`, skipping dotfiles; returns the names copied. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));
copyFlat(join(repoDir, 'dashboard'), join(out, 'dashboard'));

const shots = copyFlat(join(repoDir, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// Written last, from the finished output: the scorer rebuilds the dossier and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: DOSSIER_TEXT_MAX, screenshots: DOSSIER_SHOT_CAPS, dashboard: DOSSIER_DASH_CAPS }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
