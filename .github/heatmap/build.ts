// Collects the user's public commits and renders heatmap.svg. The image depends only on the commit
// set and the current hour, so callers can compare it to the committed file to see what changed.

import { collect, dayKey, hourKey, tally, zoneLabel } from './collect.ts';
import { renderHeatmap } from './render.ts';

export async function build(token: string, login: string, timeZone: string): Promise<string> {
  const dates = (await collect(token, login)).map((c) => c.date);
  const days = tally(dates, (d) => dayKey(d, timeZone));
  const hours = tally(dates, (d) => hourKey(d, timeZone));
  const now = new Date();
  return renderHeatmap(days, hours, hourKey(now, timeZone), zoneLabel(now, timeZone));
}
