// Renders commit counts as one self-contained dark panel in the house theme: the year grid, then the
// current month, week, and day. The SVG draws its own background, so it reads the same on GitHub's
// light and dark README pages.

const _COLORS = {
  panel: '#1B1B1B', // AppBackground
  border: '#3F3F3F', // BorderSubtle
  none: '#2A2A2A', // ControlAlt: zero commits
  low: '#372E45', // Level 1; `_LEVELS` fills in the steps up to `high`.
  high: '#B697E1',
  focus: '#AC98C7', // Focus: marks today
  count: '#F7E9B5', // Highlight
  heading: '#FFFFFF', // PrimaryText: section labels
  text: '#D0D0D0', // SecondaryText
  muted: '#888888',
};

// sRGB <-> OKLCH, matrices from https://bottosson.github.io/posts/oklab/. OKLCH steps look evenly
// spaced in lightness, unlike plain RGB mixing.
type Oklch = [number, number, number];
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const linearRgb = (hex: string) => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));

function toOklch(hex: string): Oklch {
  const [r, g, b] = linearRgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, bb), (Math.atan2(bb, a) * 180) / Math.PI];
}

function fromOklch([L, C, H]: Oklch): string {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const byte = (c: number) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255).toString(16).padStart(2, '0');
  return `#${rgb.map(byte).join('').toUpperCase()}`;
}

// `steps` colors from `low` to `high` inclusive, hue taking the short way around the circle.
function ramp(low: string, high: string, steps: number): string[] {
  const [l0, c0, h0] = toOklch(low);
  const [l1, c1, h1] = toOklch(high);
  const dh = ((h1 - h0 + 540) % 360) - 180;
  return Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1);
    return fromOklch([l0 + (l1 - l0) * t, c0 + (c1 - c0) * t, h0 + dh * t]);
  });
}

// WCAG contrast ratio between two hex colors.
function contrast(x: string, y: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = linearRgb(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

// Level 0 is no commits; levels 1-8 run from `low` to `high`.
const _LEVELS = [_COLORS.none, ...ramp(_COLORS.low, _COLORS.high, 8)];
// Count text per level: white or panel-dark, whichever reads better on that cell.
const _LEVEL_TEXT = _LEVELS.map((fill) =>
  contrast(fill, _COLORS.heading) >= contrast(fill, _COLORS.panel) ? _COLORS.heading : _COLORS.panel);

const _CELL = 10;
const _STEP = 13; // Cell + 3px gap.
const _WEEKS = 53;
const _PAD = 16;
const _LEFT = _PAD + 30; // Weekday label column.
const _TOP = _PAD + 42; // Title + month label rows.
const _WIDTH = _LEFT + _WEEKS * _STEP - 3 + _PAD; // Both panels share the year grid's width.
const _FONT = `'Segoe UI',-apple-system,BlinkMacSystemFont,'Noto Sans',Helvetica,Arial,sans-serif`;
const _MONO = `Consolas,'SFMono-Regular',Menlo,monospace`;
const _MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// Dated titles keep a static snapshot true after the day it was rendered.
const shortDate = (iso: string) => `${_MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8))}`;
const dateRange = (from: string, to: string) =>
  from.slice(5, 7) === to.slice(5, 7) ? `${shortDate(from)}-${Number(to.slice(8))}` : `${shortDate(from)} - ${shortDate(to)}`;

// Non-zero counts map to levels 1..top on a log curve from 1 up to the 95th percentile of non-zero
// counts, so most of the range stays distinct and one huge outlier can't flatten the rest.
function levelOf(counts: number[]): (n: number) => number {
  const sorted = counts.filter((n) => n > 0).sort((a, b) => a - b);
  const cap = Math.max(2, sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0);
  const top = _LEVELS.length - 1;
  return (n) => (n <= 0 ? 0 : Math.min(top, 1 + Math.floor(((top - 1) * Math.log(n)) / Math.log(cap))));
}

// Every date from the yearly graph's first Sunday through `today`.
function yearDates(today: string): string[] {
  const end = new Date(`${today}T00:00:00Z`);
  const d = new Date(end);
  d.setUTCDate(end.getUTCDate() - end.getUTCDay() - (_WEEKS - 1) * 7);
  const dates: string[] = [];
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) dates.push(isoDay(d));
  return dates;
}

// Year and month use the year's daily thresholds, so a color means the same count in each.
const yearLevel = (days: Map<string, number>, today: string) =>
  levelOf(yearDates(today).map((date) => days.get(date) ?? 0));

const plural = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;

// Cells are `size` wide and `h` tall; only today's hour row is wider than tall.
const dayRect = (x: number, y: number, size: number, fill: string, tip: string, h = size) =>
  `<rect x="${x}" y="${y}" width="${size}" height="${h}" rx="${size > _CELL ? 3 : 2}" fill="${fill}"><title>${tip}</title></rect>`;

// Commit count centered in a detail cell: dark text on the light (high) levels, none for zero. The README
// shows the image through <img>, where <title> tooltips never appear, so counts must be drawn.
function countText(x: number, y: number, size: number, n: number, level: number, h = size) {
  if (n <= 0) return '';
  const font = size > _D_CELL ? 11 : n > 99 ? 7.5 : 9;
  const fill = _LEVEL_TEXT[level];
  return `<text x="${x + size / 2}" y="${y + h / 2 + font * 0.35}" text-anchor="middle" font-family="${_MONO}" font-size="${font}" font-weight="600" fill="${fill}">${n}</text>`;
}

const panel = (width: number, height: number) =>
  `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="4" fill="${_COLORS.panel}" stroke="${_COLORS.border}"/>`;

const title = (total: number, suffix: string, x = _PAD, y = _PAD + 12) =>
  `<text x="${x}" y="${y}" font-size="14" fill="${_COLORS.text}"><tspan font-family="${_MONO}" font-weight="600" fill="${_COLORS.count}">${total.toLocaleString('en-US')}</tspan> ${suffix}</text>`;

const svgOpen = (width: number, height: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${_FONT}" font-size="11">`;

// Outline for a slot that hasn't happened yet.
const futureRect = (x: number, y: number, size: number, h = size) =>
  `<rect x="${x + 0.5}" y="${y + 0.5}" width="${size - 1}" height="${h - 1}" rx="3" fill="none" stroke="${_COLORS.none}"/>`;

// Ring just outside the current slot's cell; visible on every level color. Small year cells get a
// tighter, thinner ring so it stays inside their 3px gap.
function todayRing(x: number, y: number, size: number, h = size) {
  const [pad, width] = size > _CELL ? [2, 1.5] : [1.5, 1];
  return `<rect x="${x - pad}" y="${y - pad}" width="${size + 2 * pad}" height="${h + 2 * pad}" rx="${(size > _CELL ? 3 : 2) + pad}" fill="none" stroke="${_COLORS.focus}" stroke-width="${width}"/>`;
}

// Hour views share thresholds from every hour in the year, so day and week shades agree.
const hourLevel = (hours: Map<string, number>) => levelOf([...hours.values()]);

const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;

// Detail panel grid: every block uses the same cell and step, so columns line up.
const _D_CELL = 16;
const _D_STEP = 20;
const _D_TOP = _PAD + 64; // Label, title, and header rows above the month and week grids.
const _D_TITLE_Y = _PAD + 34;

// Block name ("This month") above its dated count title.
const label = (text: string, x: number, y: number) =>
  `<text x="${x}" y="${y}" font-size="14" font-weight="600" fill="${_COLORS.heading}">${text}</text>`;
const _HOURS_X = _WIDTH - _PAD - (24 * _D_STEP - 4); // Week and day hour columns, right-aligned.
const _WEEK_X = _HOURS_X - 32; // Week title and day labels.
const _W_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Hour column layouts: the week's square cells, and today's row stretched across the full panel.
type HourCols = { x: number; step: number; width: number; height: number };
const _WEEK_COLS: HourCols = { x: _HOURS_X, step: _D_STEP, width: _D_CELL, height: _D_CELL };
const _DAY_STEP = (_WIDTH - 2 * _PAD + _D_STEP - _D_CELL) / 24;
const _DAY_COLS: HourCols = { x: _PAD, step: _DAY_STEP, width: _DAY_STEP - (_D_STEP - _D_CELL), height: 20 };

// One row of 24 hour cells for `date`; hours after `now` ("YYYY-MM-DD HH") show as outlines.
function hourRow(
  hours: Map<string, number>, level: (n: number) => number, date: string, now: string, y: number, cols = _WEEK_COLS,
) {
  const rects: string[] = [];
  let total = 0;
  for (let h = 0; h < 24; h++) {
    const key = `${date} ${String(h).padStart(2, '0')}`;
    const x = cols.x + h * cols.step;
    if (key > now) {
      rects.push(futureRect(x, y, cols.width, cols.height));
      continue;
    }
    const n = hours.get(key) ?? 0;
    total += n;
    const lvl = level(n);
    rects.push(dayRect(x, y, cols.width, _LEVELS[lvl], `${plural(n)} on ${date}, ${hourLabel(h)}m`, cols.height));
    rects.push(countText(x, y, cols.width, n, lvl, cols.height));
    if (key === now) rects.push(todayRing(x, y, cols.width, cols.height));
  }
  return { rects, total };
}

// Hour labels every 6 hours above the hour columns.
const hourHeader = (y: number) =>
  [0, 6, 12, 18].map((h) => `<text x="${_HOURS_X + h * _D_STEP}" y="${y}">${hourLabel(h)}m</text>`).join('');

// Every hour centered over today's columns ("12am 1am ... 11am 12pm 1pm ... 11pm"). The 6-hour
// marks use the text color and the current hour (`now` is "YYYY-MM-DD HH") the highlight color.
function fullHourHeader(y: number, now: string) {
  const current = Number(now.slice(11));
  const labels: string[] = [];
  for (let h = 0; h < 24; h++) {
    const fill = h === current ? _COLORS.count : h % 6 === 0 ? _COLORS.text : '';
    const x = _DAY_COLS.x + h * _DAY_COLS.step + _DAY_COLS.width / 2;
    labels.push(`<text x="${x}" y="${y}"${fill && ` fill="${fill}"`}>${hourLabel(h)}m</text>`);
  }
  return `<g font-size="10" text-anchor="middle">${labels.join('')}</g>`;
}

// Current month calendar (Sun-Sat columns) at the panel's left edge. Cells grow to fill the space
// left of the week: as wide as the column allows, as tall as the week's 7 rows.
function monthBlock(days: Map<string, number>, today: string): string {
  const level = yearLevel(days, today);
  const [y, m] = today.split('-').map(Number);
  const offset = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rows = Math.ceil((offset + length) / 7);
  const gap = _D_STEP - _D_CELL;
  const maxWidth = _WEEK_X - 24 - _PAD; // 24px clear of the week's day labels.
  const step = Math.floor(Math.min((maxWidth + gap) / 7, (7 * _D_STEP) / rows));
  const cell = step - gap;

  let total = 0;
  const rects: string[] = [];
  for (let day = 1; day <= length; day++) {
    const date = `${today.slice(0, 8)}${String(day).padStart(2, '0')}`;
    const x = _PAD + ((offset + day - 1) % 7) * step;
    const yPos = _D_TOP + Math.floor((offset + day - 1) / 7) * step;
    if (date > today) {
      rects.push(futureRect(x, yPos, cell));
      continue;
    }
    const n = days.get(date) ?? 0;
    total += n;
    const lvl = level(n);
    rects.push(dayRect(x, yPos, cell, _LEVELS[lvl], `${plural(n)} on ${date}`));
    rects.push(countText(x, yPos, cell, n, lvl));
    if (date === today) rects.push(todayRing(x, yPos, cell));
  }
  const header = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
    .map((d, i) => `<text x="${_PAD + i * step + cell / 2}" y="${_D_TOP - 8}" text-anchor="middle">${d}</text>`)
    .join('');
  return `${label('This month', _PAD, _PAD + 12)}
${title(total, `commits in ${_MONTHS[m - 1]} ${y}`, _PAD, _D_TITLE_Y)}
<g fill="${_COLORS.muted}">${header}</g>
${rects.join('\n')}`;
}

// Current week (Sun-Sat rows) by hour, right of the month. Today's row label is highlighted.
function weekBlock(hours: Map<string, number>, level: (n: number) => number, now: string): string {
  const today = now.slice(0, 10);
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());

  let total = 0;
  const rects: string[] = [];
  const labels: string[] = [];
  const dates: string[] = [];
  for (let row = 0; row < 7; row++, d.setUTCDate(d.getUTCDate() + 1)) {
    const y = _D_TOP + row * _D_STEP;
    dates.push(isoDay(d));
    const result = hourRow(hours, level, dates[row], now, y);
    total += result.total;
    rects.push(...result.rects);
    const fill = dates[row] === today ? ` fill="${_COLORS.count}"` : '';
    labels.push(`<text x="${_WEEK_X}" y="${y + 12}"${fill}>${_W_DAYS[row]}</text>`);
  }
  return `${label('This week', _WEEK_X, _PAD + 12)}
${title(total, `commits, ${dateRange(dates[0], dates[6])}`, _WEEK_X, _D_TITLE_Y)}
<g fill="${_COLORS.muted}">${hourHeader(_D_TOP - 8)}${labels.join('')}</g>
${rects.join('\n')}`;
}

const _DAY_CELLS_Y = _D_TITLE_Y + 32; // Today's hour row, below its label, title, and hour labels.

// Today by hour under a divider; its title sits above so the row can span the full panel width.
function dayBlock(hours: Map<string, number>, level: (n: number) => number, now: string, top: number): string {
  const cellsY = top + _DAY_CELLS_Y;
  const { rects, total } = hourRow(hours, level, now.slice(0, 10), now, cellsY, _DAY_COLS);
  return `<line x1="${_PAD}" y1="${top}" x2="${_WIDTH - _PAD}" y2="${top}" stroke="${_COLORS.border}"/>
${label('Today', _PAD, top + _PAD + 12)}
${title(total, `commits on ${shortDate(now.slice(0, 10))}`, _PAD, top + _D_TITLE_Y)}
<g fill="${_COLORS.muted}">${fullHourHeader(cellsY - 8, now)}</g>
${rects.join('\n')}`;
}

type Section = { body: string; height: number };

// Month and week side by side, today below. `now` is "YYYY-MM-DD HH" in the user's timezone.
function detailSection(days: Map<string, number>, hours: Map<string, number>, now: string): Section {
  const level = hourLevel(hours);
  const divider = _D_TOP + 7 * _D_STEP - 4 + _PAD;
  const body = `${monthBlock(days, now.slice(0, 10))}
${weekBlock(hours, level, now)}
${dayBlock(hours, level, now, divider)}`;
  return { body, height: divider + _DAY_CELLS_Y + _DAY_COLS.height + _PAD };
}

// One panel: the year grid on top, then month/week/day below a divider. `zone` names the time zone
// every date and hour is in; it sits top right on the year title row.
export function renderHeatmap(days: Map<string, number>, hours: Map<string, number>, now: string, zone: string): string {
  const year = yearSection(days, now.slice(0, 10));
  const detail = detailSection(days, hours, now);
  const height = year.height + detail.height;
  return `${svgOpen(_WIDTH, height)}
${panel(_WIDTH, height)}
<text x="${_WIDTH - _PAD}" y="${_PAD + 12}" text-anchor="end" fill="${_COLORS.muted}">${zone}</text>
${year.body}
<line x1="${_PAD}" y1="${year.height}" x2="${_WIDTH - _PAD}" y2="${year.height}" stroke="${_COLORS.border}"/>
<g transform="translate(0 ${year.height})">
${detail.body}
</g>
</svg>
`;
}

// GitHub-style year grid. `today` is YYYY-MM-DD in the user's timezone; the last column is its week.
function yearSection(days: Map<string, number>, today: string): Section {
  const cells = yearDates(today).map((date, i) => (
    { date, x: _LEFT + Math.floor(i / 7) * _STEP, y: _TOP + (i % 7) * _STEP, n: days.get(date) ?? 0 }
  ));
  const level = yearLevel(days, today);
  const total = cells.reduce((sum, c) => sum + c.n, 0);

  // Label a column when its Sunday starts a new month, skipping labels too close to the previous one.
  const months: string[] = [];
  let lastLabel = -3;
  for (let w = 0; w < _WEEKS; w++) {
    const month = cells[w * 7].date.slice(5, 7);
    if (w > 0 && month === cells[(w - 1) * 7].date.slice(5, 7)) continue;
    if (w - lastLabel < 3) continue;
    if (w === 0 && cells[0].date.slice(8) > '24') continue; // Month almost over at the left edge.
    lastLabel = w;
    months.push(`<text x="${_LEFT + w * _STEP}" y="${_TOP - 8}">${_MONTHS[Number(month) - 1]}</text>`);
  }

  const right = _WIDTH - _PAD;
  const legendY = _TOP + 7 * _STEP + 10;
  const height = legendY + _CELL + _PAD;
  const legendX = (i: number) => right - 30 - _CELL - (_LEVELS.length - 1 - i) * _STEP;
  const legend = _LEVELS
    .map((fill, i) => `<rect x="${legendX(i)}" y="${legendY}" width="${_CELL}" height="${_CELL}" rx="2" fill="${fill}"/>`)
    .join('');
  const rects = cells
    .map((c) => dayRect(c.x, c.y, _CELL, _LEVELS[level(c.n)], `${plural(c.n)} on ${c.date}`)
      + (c.date === today ? todayRing(c.x, c.y, _CELL) : ''))
    .join('\n');
  const weekday = (label: string, row: number) => `<text x="${_PAD}" y="${_TOP + row * _STEP + 9}">${label}</text>`;

  const body = `${title(total, `commits in the last ${cells.length} days`)}
<g fill="${_COLORS.muted}">${months.join('')}${weekday('Mon', 1)}${weekday('Wed', 3)}${weekday('Fri', 5)}
<text x="${legendX(0) - 6}" y="${legendY + 9}" text-anchor="end">Less</text>
<text x="${right}" y="${legendY + 9}" text-anchor="end">More</text></g>
${legend}
${rects}`;
  return { body, height };
}
