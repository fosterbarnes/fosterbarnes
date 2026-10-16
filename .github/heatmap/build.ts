// Collects the user's public commits and renders heatmap.svg. `fp` fingerprints the commit set, so
// callers can tell whether anything changed without comparing images.

import { createHash } from 'node:crypto';
import { collect, dayKey, hourKey, tally } from './collect.ts';
import { renderHeatmap } from './render.ts';

export async function build(token: string, login: string, timeZone: string): Promise<{ fp: string; svg: string }> {
  const commits = await collect(token, login);
  const dates = commits.map((c) => c.date);
  const days = tally(dates, (d) => dayKey(d, timeZone));
  const hours = tally(dates, (d) => hourKey(d, timeZone));
  const fp = createHash('sha256').update(commits.map((c) => c.oid).sort().join('\n')).digest('hex');
  return { fp, svg: renderHeatmap(days, hours, hourKey(new Date(), timeZone)) };
}
