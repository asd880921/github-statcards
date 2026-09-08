// 只用既有的 data/ 重畫 cards/，不打 GitHub API、不追加 history 快照。
// 換 icon 或調整版面時用，避免為了看新樣子而在歷史資料裡多插一筆。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHistory, aggregate } from './history.mjs';
import { renderHistorySvg, SUPPORTED_LOCALES } from './render-history-svg.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `+08:00` / `-05:30` / `Z` → 分鐘位移。與 update-statcards.mjs 同義。 */
function parseTimezone(value) {
  if (!value || value === 'Z') return 0;
  const matched = /^([+-])(\d{2}):?(\d{2})$/.exec(value);
  if (!matched) throw new Error(`無法解析 history.timezone: ${value}`);
  const [, sign, hours, minutes] = matched;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));

for (const badge of config.badges) {
  const { id, repo, color = '2ea44f', history } = badge;
  if (!history) continue;

  const {
    period = 'day',
    limit = 14,
    timezone = '+00:00',
    title = repo.split('/')[1],
    accent = color,
    icon,
    locales = ['en'],
  } = history;

  const unknown = locales.filter((locale) => !SUPPORTED_LOCALES.includes(locale));
  if (unknown.length > 0) throw new Error(`未知的 history.locales: ${unknown.join(', ')}`);

  const snapshot = JSON.parse(await readFile(join(ROOT, 'data', `${id}.json`), 'utf8'));
  const rows = await readHistory(id);
  const offsetMinutes = parseTimezone(timezone);
  const aggregated = aggregate(rows, { period, limit, offsetMinutes });
  const iconMarkup = icon ? await readFile(join(ROOT, icon), 'utf8') : '';

  await mkdir(join(ROOT, 'cards'), { recursive: true });

  for (const [index, locale] of locales.entries()) {
    const svg = renderHistorySvg(aggregated, {
      title,
      period,
      updatedAt: snapshot.updatedAt,
      offsetMinutes,
      accent,
      grandTotal: snapshot.total,
      icon: iconMarkup,
      locale,
    });
    const suffix = index === 0 ? '' : `.${locale}`;
    const out = join(ROOT, 'cards', `${id}-history${suffix}.svg`);
    await writeFile(out, svg, 'utf8');
    console.log(`寫入 ${out}`);
  }
}
