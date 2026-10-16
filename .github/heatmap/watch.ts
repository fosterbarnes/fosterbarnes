// Keeps heatmap/heatmap.svg current. Polls GitHub for the user's latest public push (ETag requests,
// free when nothing changed), waits for pushes to settle, then rebuilds and pushes the image.
// One run at a time; pushes during a run queue exactly one follow-up run.
//   node watch.ts           watch forever (what the scheduled task runs)
//   node watch.ts --once    one run now, then exit
//   --dry                   skip git (local testing)
// Env: HEATMAP_TZ (default America/New_York), HEATMAP_STATE (default %LOCALAPPDATA%\heatmap).

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from './build.ts';

const _POLL_MS = 30_000;
const _QUIET_MS = 20_000; // Wait this long after the last detected push before running.
const _RETRY_MS = 5 * 60_000;
const _FALLBACK_MS = 60 * 60_000; // Catches commits to others' repos and missed polls.
const _LOG_MAX = 1_000_000;
const _BOT = ['-c', 'user.name=heatmap-bot', '-c', 'user.email=heatmap-bot@localhost'];

const root = resolve(import.meta.dirname, '../..');
const svgPath = join(root, 'heatmap', 'heatmap.svg');
const stateDir = process.env.HEATMAP_STATE || join(process.env.LOCALAPPDATA ?? '.', 'heatmap');
const statePath = join(stateDir, 'state.json');
const logPath = join(stateDir, 'heatmap.log');
const timeZone = process.env.HEATMAP_TZ || 'America/New_York';
const once = process.argv.includes('--once');
const dry = process.argv.includes('--dry');

type State = { fp?: string; etag?: string; pushedAt?: string };

mkdirSync(stateDir, { recursive: true });
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const saveState = () => writeFileSync(statePath, JSON.stringify(state, null, 2));

function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  if (existsSync(logPath) && statSync(logPath).size > _LOG_MAX) renameSync(logPath, `${logPath}.old`);
  appendFileSync(logPath, `${line}\n`);
}

const gh = (...args: string[]) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();

// Resolved on first use, inside the callers' error handling: at boot the network may not be up yet.
let login = '';
const getLogin = () => (login ||= gh('api', 'user', '--jq', '.login'));

// Rebuilds the image; commits and pushes only when the user's commit set changed.
async function run(): Promise<void> {
  if (!dry) git('pull', '--rebase', '--autostash'); // Autostash: a half-finished run can't wedge pulls.
  const { fp, svg } = await build(gh('auth', 'token'), getLogin(), timeZone);
  if (fp === state.fp) {
    log('no new commits');
    return;
  }
  writeFileSync(svgPath, svg);
  let result = 'rendered (dry run, no git)';
  if (!dry) {
    git('add', 'heatmap/heatmap.svg');
    const changed = git('status', '--porcelain', '--', 'heatmap/heatmap.svg') !== '';
    if (changed) git(..._BOT, 'commit', '-m', 'Update heatmap');
    // Push even without a new commit: a bot commit left unpushed by a failed run goes out here.
    try {
      git('push');
    } catch {
      git('pull', '--rebase', '--autostash'); // Someone pushed meanwhile; replay the bot commit once.
      git('push');
    }
    result = changed ? `pushed ${git('rev-parse', '--short', 'HEAD')}` : 'image unchanged';
  }
  state.fp = fp;
  saveState();
  log(result);
}

if (once) {
  try {
    await run();
  } catch (e) {
    log(`ERROR ${(e as Error).message}`);
    process.exitCode = 1;
  }
} else {
  let pending = true; // Catch up on anything missed while stopped.
  let notBefore = 0;
  let running = false;

  const queue = (delay: number) => {
    pending = true;
    notBefore = Date.now() + delay;
  };

  // Free when nothing changed: GitHub answers 304 without counting against the rate limit.
  const poll = async () => {
    try {
      const res = await fetch(`https://api.github.com/users/${getLogin()}/repos?sort=pushed&per_page=1`, {
        headers: { authorization: `bearer ${gh('auth', 'token')}`, ...(state.etag ? { 'if-none-match': state.etag } : {}) },
      });
      if (res.status === 304) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const [repo] = (await res.json()) as { full_name: string; pushed_at: string }[];
      state.etag = res.headers.get('etag') ?? undefined;
      if (repo && repo.pushed_at !== state.pushedAt) {
        state.pushedAt = repo.pushed_at;
        log(`push detected: ${repo.full_name} at ${repo.pushed_at}`);
        queue(_QUIET_MS);
      }
      saveState();
    } catch (e) {
      log(`poll failed: ${(e as Error).message}`);
    }
  };

  const tick = async () => {
    if (!pending || running || Date.now() < notBefore) return;
    pending = false;
    running = true;
    try {
      await run();
    } catch (e) {
      log(`ERROR ${(e as Error).message}`);
      queue(_RETRY_MS);
    } finally {
      running = false;
    }
  };

  log(`watching${dry ? ' (dry run)' : ''}`);
  await poll();
  setInterval(poll, _POLL_MS);
  setInterval(() => queue(0), _FALLBACK_MS);
  setInterval(tick, 1000);
}
