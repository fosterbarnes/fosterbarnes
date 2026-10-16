// Renders commit counts as one self-contained dark panel in the house theme: the year grid, then the
// current month, week, and day. The SVG draws its own background, so it reads the same on GitHub's
// light and dark README pages.

const _COLORS = {
  panel: '#1B1B1B', // AppBackground
  border: '#3F3F3F', // BorderSubtle
  levels: ['#2A2A2A', '#4D3C64', '#765E98', '#9373C0', '#AC98C7'], // ControlAlt -> Focus
  focus: '#AC98C7', // Focus: marks today
  count: '#F7E9B5', // Highlight
  heading: '#FFFFFF', // PrimaryText: section labels
  text: '#D0D0D0', // SecondaryText
  muted: '#888888',
};

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

// Level 1-4 thresholds from quartiles of non-zero days.
function levelOf(counts: number[]): (n: number) => number {
  const sorted = counts.filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)] ?? 0;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  return (n) => (n <= 0 ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4);
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

const dayRect = (x: number, y: number, size: number, fill: string, tip: string) =>
  `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size > _CELL ? 3 : 2}" fill="${fill}"><title>${tip}</title></rect>`;

const panel = (width: number, height: number) =>
  `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="4" fill="${_COLORS.panel}" stroke="${_COLORS.border}"/>`;

const title = (total: number, suffix: string, x = _PAD, y = _PAD + 12) =>
  `<text x="${x}" y="${y}" font-size="14" fill="${_COLORS.text}"><tspan font-family="${_MONO}" font-weight="600" fill="${_COLORS.count}">${total.toLocaleString('en-US')}</tspan> ${suffix}</text>`;

const svgOpen = (width: number, height: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${_FONT}" font-size="11">`;

// Outline for a slot that hasn't happened yet.
const futureRect = (x: number, y: number, size: number) =>
  `<rect x="${x + 0.5}" y="${y + 0.5}" width="${size - 1}" height="${size - 1}" rx="3" fill="none" stroke="${_COLORS.levels[0]}"/>`;

// Ring just outside the current slot's cell; visible on every level color. Small year cells get a
// tighter, thinner ring so it stays inside their 3px gap.
function todayRing(x: number, y: number, size: number) {
  const [pad, width] = size > _CELL ? [2, 1.5] : [1.5, 1];
  return `<rect x="${x - pad}" y="${y - pad}" width="${size + 2 * pad}" height="${size + 2 * pad}" rx="${(size > _CELL ? 3 : 2) + pad}" fill="none" stroke="${_COLORS.focus}" stroke-width="${width}"/>`;
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

// One row of 24 hour cells for `date`; hours after `now` ("YYYY-MM-DD HH") show as outlines.
function hourRow(hours: Map<string, number>, level: (n: number) => number, date: string, now: string, y: number) {
  const rects: string[] = [];
  let total = 0;
  for (let h = 0; h < 24; h++) {
    const key = `${date} ${String(h).padStart(2, '0')}`;
    const x = _HOURS_X + h * _D_STEP;
    if (key > now) {
      rects.push(futureRect(x, y, _D_CELL));
      continue;
    }
    const n = hours.get(key) ?? 0;
    total += n;
    rects.push(dayRect(x, y, _D_CELL, _COLORS.levels[level(n)], `${plural(n)} on ${date}, ${hourLabel(h)}m`));
    if (key === now) rects.push(todayRing(x, y, _D_CELL));
  }
  return { rects, total };
}

// Hour labels every 6 hours above the hour columns.
const hourHeader = (y: number) =>
  [0, 6, 12, 18].map((h) => `<text x="${_HOURS_X + h * _D_STEP}" y="${y}">${hourLabel(h)}m</text>`).join('');

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
    rects.push(dayRect(x, yPos, cell, _COLORS.levels[level(n)], `${plural(n)} on ${date}`));
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

// Today by hour under a divider, its columns aligned with the week's.
function dayBlock(hours: Map<string, number>, level: (n: number) => number, now: string, top: number): string {
  const cellsY = top + 32;
  const { rects, total } = hourRow(hours, level, now.slice(0, 10), now, cellsY);
  return `<line x1="${_PAD}" y1="${top}" x2="${_WIDTH - _PAD}" y2="${top}" stroke="${_COLORS.border}"/>
${label('Today', _PAD, cellsY - 8)}
${title(total, `commits on ${shortDate(now.slice(0, 10))}`, _PAD, cellsY + 13)}
<g fill="${_COLORS.muted}">${hourHeader(cellsY - 8)}</g>
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
  return { body, height: divider + 32 + _D_CELL + _PAD };
}

// One panel: the year grid on top, then month/week/day below a divider.
export function renderHeatmap(days: Map<string, number>, hours: Map<string, number>, now: string): string {
  const year = yearSection(days, now.slice(0, 10));
  const detail = detailSection(days, hours, now);
  const height = year.height + detail.height;
  return `${svgOpen(_WIDTH, height)}
${panel(_WIDTH, height)}
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
  const legendX = (i: number) => right - 30 - _CELL - (4 - i) * _STEP;
  const legend = _COLORS.levels
    .map((fill, i) => `<rect x="${legendX(i)}" y="${legendY}" width="${_CELL}" height="${_CELL}" rx="2" fill="${fill}"/>`)
    .join('');
  const rects = cells
    .map((c) => dayRect(c.x, c.y, _CELL, _COLORS.levels[level(c.n)], `${plural(c.n)} on ${c.date}`)
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
