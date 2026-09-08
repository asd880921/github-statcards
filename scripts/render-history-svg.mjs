// 把聚合後的下載歷史畫成統計卡片：左欄是總下載量，右側上半是各期累積折線、下半是各期新增柱狀。
// 限制：GitHub 以 <img> 呈現，SVG 內不能有腳本、不能外連字型或圖檔（icon 必須內嵌），
// 深淺色只能靠 prefers-color-scheme 由讀者端決定。
// 語言不能靠 <switch systemLanguage> 切：那判斷的是讀者瀏覽器語言而非 README 語言，
// 會讓英文 README 配上中文卡片，所以改成每個語系各產生一個檔案。
const WIDTH = 760;
const HEIGHT = 300;

const PAD_X = 28;
const CARD_RIGHT = WIDTH - PAD_X;

const PANEL_X = PAD_X;
const PANEL_RIGHT = 232;
const DIVIDER_X = 262;
const ICON_SIZE = 34;

const PLOT_LEFT = 306;
const PLOT_RIGHT = CARD_RIGHT;
const PLOT_TOP = 78;
// 折線與柱狀改成上下兩塊共用 x 軸：兩者量綱不同，疊在同一條基準線上會被讀成同一把尺。
const PLOT_BOTTOM = 196;
const BAR_BASELINE = 240;
// 柱高只編碼相對高低，絕對數量靠柱頂數字讀；壓低柱身把空間讓給那排數字。
const BAR_ZONE = 26;
const BAR_VALUE_SIZE = 9.5;
const BAR_VALUE_GAP = 4;
const AXIS_LABEL_Y = 260;
const FOOTER_Y = 282;
const TOTAL_LABEL_Y = 152;

/**
 * 各語系的字串與排版參數。
 * 中文不是換字就好：字級要拉高（10px 的漢字會糊）、微標題不能沿用「全大寫 + 加字距」的處理，
 * 字型堆疊也要把拉丁字型排前面，讓數字仍走 Segoe UI／SF，漢字才落到中文字型。
 */
const LOCALES = {
  en: {
    font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Arial, sans-serif",
    type: { totalLabel: 10, totalLabelTracking: 1, totalLabelWeight: 700, totalLabelStroke: 0, statLabel: 11.5, caption: 11, footer: 10 },
    period: {
      day: { unit: 'days', one: 'day', per: 'day' },
      week: { unit: 'weeks', one: 'week', per: 'week' },
      month: { unit: 'months', one: 'month', per: 'month' },
      year: { unit: 'years', one: 'year', per: 'year' },
    },
    totalLabel: 'TOTAL DOWNLOADS',
    cumulative: 'Cumulative',
    latest: (p) => `Latest ${p.one}`,
    range: (n, p) => `Last ${n} ${p.unit}`,
    average: (p) => `Average / ${p.one}`,
    newPer: (p) => `New / ${p.per}`,
    updated: (stamp) => `updated ${stamp}`,
    docTitle: (title) => `${title} downloads`,
    summary: ({ title, total, latest, sum, count, p }) =>
      `${title}: ${total} total downloads, +${latest} in the latest ${p.one}, +${sum} over the last ${count} ${p.unit}.`,
  },
  'zh-TW': {
    font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, 'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', 'Heiti TC', sans-serif",
    // 主數字底下那行是「標籤」而非清單的第一列。英文靠全大寫和底下的句首大寫拉開登記，
    // 中文沒有大小寫，同樣灰、同樣四個漢字疊在一起就會被讀成同一組；
    // 微軟正黑體只有 Regular／Bold 兩個字重，700 已是上限，真正把兩組分開的是左側那個 accent 圖示。
    // 字距跟著字數走：四個字時要 1.4px 才撐得開，六個字用同樣值就散掉了。
    type: { totalLabel: 13, totalLabelTracking: 0.6, totalLabelWeight: 700, totalLabelStroke: 0.2, statLabel: 12, caption: 11.5, footer: 11 },
    period: {
      day: { unit: '天', one: '天', per: '每日' },
      week: { unit: '週', one: '週', per: '每週' },
      month: { unit: '個月', one: '個月', per: '每月' },
      year: { unit: '年', one: '年', per: '每年' },
    },
    totalLabel: '累積下載次數',
    cumulative: '累積',
    latest: (p) => `最近一${p.one}`,
    range: (n, p) => `近 ${n} ${p.unit}`,
    average: (p) => `平均${p.per}`,
    newPer: (p) => `${p.per}新增`,
    updated: (stamp) => `更新於 ${stamp}`,
    docTitle: (title) => `${title} 下載量`,
    summary: ({ title, total, latest, sum, count, p }) =>
      `${title}：累積下載次數 ${total}，最近一${p.one} +${latest}，近 ${count} ${p.unit}共 +${sum}。`,
  },
};

export const SUPPORTED_LOCALES = Object.keys(LOCALES);

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);
}

/** 只有一個 accent 設定值，深色底需要更亮的版本才不會糊在深色卡片上。 */
function lighten(hex, ratio) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return `#${channels.map((c) => Math.round(c + (255 - c) * ratio).toString(16).padStart(2, '0')).join('')}`;
}

/** 千分位，總下載量是卡片主角，位數多時要讀得出來。 */
function formatTotal(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const FULLWIDTH = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uff60\uffe0-\uffe6\u3000-\u303f]/;

/**
 * 沒有排版引擎可量字寬，圖例靠右對齊、圖示接在標籤後面都只能估。
 * 係數是用瀏覽器的 getComputedTextLength 校準出來的：
 *   'TOTAL DOWNLOADS' 700/10px/字距 1px → 113.0（14 個大寫 + 1 個空格）
 *   '總下載量'        700/12px/字距 1.4px → 53.6
 * 全大寫拉丁字比小寫寬得多，共用同一個係數會少估約 15%，圖示就會壓到最後一個字母上。
 */
function approxTextWidth(text, size, tracking = 0) {
  let units = 0;
  let count = 0;
  for (const char of text) {
    count += 1;
    if (FULLWIDTH.test(char)) units += 1;
    else if (char === ' ') units += 0.28;
    else if (char >= 'A' && char <= 'Z') units += 0.68;
    else units += 0.56;
  }
  return units * size + tracking * count;
}

function niceStep(rough) {
  const exponent = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * exponent;
}

/** 累積量軸不從 0 起算，否則各期變化都被壓平在頂端；格線抓 4 段就夠，太密會蓋過折線。 */
function axisScale(min, max) {
  const step = niceStep(Math.max(max - min, 1) / 4);
  const from = Math.floor(min / step) * step;
  const to = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = from; value <= to + step / 2; value += step) ticks.push(Math.round(value));
  return { from, to: ticks[ticks.length - 1], ticks };
}

function formatWallTime(timestamp, offsetMinutes) {
  const d = new Date(Date.parse(timestamp) + offsetMinutes * 60_000);
  const pad = (value) => String(value).padStart(2, '0');
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const zone = abs % 60 === 0 ? `${sign}${abs / 60}` : `${sign}${Math.floor(abs / 60)}:${pad(abs % 60)}`;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC${zone}`;
}

/**
 * 下載圖示，畫成路徑而非圖示字型——SVG 在 <img> 裡不能外連字型，
 * 用字型的話讀者端沒裝就會掉成豆腐字。座標系固定 16×16，縮放時筆畫跟著等比縮。
 */
const DL_ICON_BOX = 16;
function downloadIcon(x, centerY, size) {
  const scale = size / DL_ICON_BOX;
  const top = centerY - size / 2;
  return `<g transform="translate(${x.toFixed(1)} ${top.toFixed(1)}) scale(${scale.toFixed(4)})" class="dl-icon">`
    + '<path d="M8 2.1V10"/>'
    + '<path d="M4.5 6.7 8 10.2 11.5 6.7"/>'
    + '<path d="M3 13.7h10"/>'
    + '</g>';
}

/** 柱狀只圓上緣：貼基準線那側要是方角，否則看起來像浮在軸線上。 */
function barPath(left, width, height) {
  const r = Math.min(3, width / 2, height);
  const top = BAR_BASELINE - height;
  return `M ${left.toFixed(1)} ${BAR_BASELINE} V ${(top + r).toFixed(1)}`
    + ` Q ${left.toFixed(1)} ${top.toFixed(1)} ${(left + r).toFixed(1)} ${top.toFixed(1)}`
    + ` H ${(left + width - r).toFixed(1)}`
    + ` Q ${(left + width).toFixed(1)} ${top.toFixed(1)} ${(left + width).toFixed(1)} ${(top + r).toFixed(1)}`
    + ` V ${BAR_BASELINE} Z`;
}

/**
 * 內嵌外部 icon：外層 <svg> 換成有座標的巢狀 <svg> 才能套尺寸，
 * 並把所有 id 前綴，避免和卡片自己的漸層 id 相撞。
 */
function embedIcon(markup, x, yTop, size) {
  if (!markup) return '';
  const viewBox = /<svg[^>]*\sviewBox="([^"]+)"/.exec(markup)?.[1];
  const open = markup.indexOf('<svg');
  const close = markup.lastIndexOf('</svg>');
  if (!viewBox || open < 0 || close < 0) return '';
  const inner = markup
    .slice(markup.indexOf('>', open) + 1, close)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/id="([^"]+)"/g, 'id="icon-$1"')
    .replace(/url\(#([^)]+)\)/g, 'url(#icon-$1)')
    // <use href="#…"> 也要一起改。漏掉的話前綴過的 id 就沒人指得到，
    // 那一段圖形會靜靜消失——不報錯，只是畫不出來。
    .replace(/(\sxlink:href|\shref)="#([^"]+)"/g, '$1="#icon-$2"');
  return `<svg x="${x}" y="${yTop}" width="${size}" height="${size}" viewBox="${viewBox}" overflow="hidden">${inner}</svg>`;
}

export function renderHistorySvg(newestFirst, {
  title = 'downloads',
  period = 'day',
  updatedAt,
  offsetMinutes = 0,
  accent = '3B82F6',
  grandTotal,
  icon = '',
  locale = 'en',
} = {}) {
  const rows = [...newestFirst].reverse();
  if (rows.length === 0) return '';

  const L = LOCALES[locale] ?? LOCALES.en;
  const p = L.period[period] ?? L.period.day;

  const totals = rows.map((row) => row.total);
  const scale = axisScale(Math.min(...totals), Math.max(...totals));
  const maxDelta = Math.max(1, ...rows.map((row) => row.delta ?? 0));
  const known = rows.filter((row) => row.delta !== null);
  const periodSum = known.reduce((sum, row) => sum + row.delta, 0);
  const average = known.length > 0 ? Math.round(periodSum / known.length) : 0;
  const latest = rows[rows.length - 1].delta ?? 0;
  const total = grandTotal ?? totals[totals.length - 1];

  const x = (index) => (rows.length === 1
    ? (PLOT_LEFT + PLOT_RIGHT) / 2
    : PLOT_LEFT + (index * (PLOT_RIGHT - PLOT_LEFT)) / (rows.length - 1));
  const y = (value) => PLOT_BOTTOM - ((value - scale.from) / (scale.to - scale.from)) * (PLOT_BOTTOM - PLOT_TOP);

  const slot = rows.length > 1 ? (PLOT_RIGHT - PLOT_LEFT) / (rows.length - 1) : 60;
  const barWidth = Math.max(3, Math.min(16, slot * 0.42));

  const grid = scale.ticks.map((tick) => {
    const ty = y(tick);
    return `<line x1="${PLOT_LEFT}" y1="${ty.toFixed(1)}" x2="${PLOT_RIGHT}" y2="${ty.toFixed(1)}" class="grid"/>`
      + `<text x="${PLOT_LEFT - 10}" y="${(ty + 3.5).toFixed(1)}" text-anchor="end" class="axis">${formatTotal(tick)}</text>`;
  }).join('\n  ');

  // 柱距塞不下整排數字就只標最新一根，硬標會疊字。
  const widestValue = Math.max(...rows.map(
    (row) => (row.delta == null ? 0 : approxTextWidth(formatTotal(row.delta), BAR_VALUE_SIZE)),
  ));
  const labelEveryBar = slot >= widestValue + 8;

  // 最新一期同時是左欄 accent 那一列，柱子與數字都跟著加重。
  const bars = rows.map((row, index) => {
    if (row.delta == null) return '';
    const last = index === rows.length - 1;
    const height = row.delta === 0 ? 0 : Math.max(2, (row.delta / maxDelta) * BAR_ZONE);
    // 頭尾兩根的中心就在繪圖區邊界上，不夾住會凸出格線之外。
    const left = Math.min(Math.max(x(index) - barWidth / 2, PLOT_LEFT), PLOT_RIGHT - barWidth);
    const bar = height === 0 ? '' : `<path d="${barPath(left, barWidth, height)}" class="${last ? 'bar bar-latest' : 'bar'}"/>`;
    if (!labelEveryBar && !last) return bar;
    const cls = last ? 'bar-value bar-value-latest' : 'bar-value';
    return `${bar}<text x="${(left + barWidth / 2).toFixed(1)}" y="${(BAR_BASELINE - height - BAR_VALUE_GAP).toFixed(1)}" text-anchor="middle" class="${cls}">${formatTotal(row.delta)}</text>`;
  }).join('');

  const line = rows.map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(row.total).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(rows.length - 1).toFixed(1)} ${PLOT_BOTTOM} L ${x(0).toFixed(1)} ${PLOT_BOTTOM} Z`;

  // 每點都畫圓只是雜訊；只留最新一點，外圈用卡片底色把折線斷開，讓終點成為視線落點。
  const endX = x(rows.length - 1).toFixed(1);
  const endY = y(totals[totals.length - 1]).toFixed(1);
  const endMarker = `<circle cx="${endX}" cy="${endY}" r="7" class="halo"/>`
    + `<circle cx="${endX}" cy="${endY}" r="5.4" class="ring"/>`
    + `<circle cx="${endX}" cy="${endY}" r="3.4" class="dot"/>`;

  // 標籤太密會疊在一起，抽稀後一定保留最舊與最新兩期；
  // 最新一期靠右緣對齊，倒數第二個標籤要離它整整一個 stride 才不會撞上。
  const stride = Math.max(1, Math.ceil(rows.length / 7));
  const labels = rows.map((row, index) => {
    const last = index === rows.length - 1;
    const keep = index === 0 || last || (index % stride === 0 && rows.length - 1 - index >= stride);
    if (!keep) return '';
    // 首尾兩個標籤置中會凸出卡片內距，改成往繪圖區內側對齊。
    const anchor = index === 0 ? 'start' : last ? 'end' : 'middle';
    const cls = last ? 'axis axis-latest' : 'axis';
    return `<text x="${x(index).toFixed(1)}" y="${AXIS_LABEL_Y}" text-anchor="${anchor}" class="${cls}">${escapeXml(row.label)}</text>`;
  }).join('\n  ');

  const stats = [
    [L.latest(p), `+${formatTotal(latest)}`, 'accent'],
    [L.range(rows.length, p), `+${formatTotal(periodSum)}`, ''],
    [L.average(p), `+${formatTotal(average)}`, ''],
  ].map(([label, value, cls], index) => {
    const baseline = 188 + index * 26;
    // 第一列也要有分隔線：那條線是統計清單的上緣，沒有它，主數字的標籤會被讀成清單的第一列。
    const rule = `<line x1="${PANEL_X}" y1="${baseline - 17}" x2="${PANEL_RIGHT}" y2="${baseline - 17}" class="grid"/>`;
    return `${rule}<text x="${PANEL_X}" y="${baseline}" class="stat-label">${escapeXml(label)}</text>`
      + `<text x="${PANEL_RIGHT}" y="${baseline}" text-anchor="end" class="${['stat-value', cls].filter(Boolean).join(' ')}">${escapeXml(value)}</text>`;
  }).join('\n  ');

  // 折線與柱狀量綱不同，圖例是唯一說得清楚的管道；由右往左排，最後一項貼齊卡片右緣。
  const legendY = 46;
  let cursor = CARD_RIGHT;
  const legend = [
    ['bar', L.newPer(p)],
    ['line', L.cumulative],
  ].map(([kind, label]) => {
    const textEnd = cursor;
    const keyRight = Math.round(textEnd - approxTextWidth(label, L.type.caption) - 7);
    const key = kind === 'line'
      ? `<rect x="${(keyRight - 14).toFixed(1)}" y="${legendY - 5.1}" width="14" height="2.2" rx="1.1" class="key-line"/>`
      : `<rect x="${(keyRight - 8).toFixed(1)}" y="${legendY - 9}" width="8" height="9" rx="2" class="key-bar"/>`;
    cursor = keyRight - 32;
    return `${key}<text x="${textEnd}" y="${legendY}" text-anchor="end" class="caption">${escapeXml(label)}</text>`;
  }).reverse().join('\n  ');

  // 圖示放在標籤左側，標籤往右讓出圖示寬度加間距。
  const totalLabelIconSize = L.type.totalLabel * 1.15;
  const totalLabelX = PANEL_X + totalLabelIconSize + 7;

  const hasIcon = Boolean(icon);
  const accentDark = lighten(`#${accent}`, 0.3);
  const dotDark = lighten(`#${accent}`, 0.55);
  const summary = escapeXml(L.summary({
    title, total: formatTotal(total), latest, sum: periodSum, count: rows.length, p,
  }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" lang="${locale}" aria-label="${summary}">
  <title>${escapeXml(L.docTitle(title))}</title>
  <desc>${summary}</desc>
  <defs>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="var(--card-from)"/>
      <stop offset="1" stop-color="var(--card-to)"/>
    </linearGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/>
      <stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--grid)" stop-opacity="0"/>
      <stop offset=".2" stop-color="var(--grid)" stop-opacity="1"/>
      <stop offset=".8" stop-color="var(--grid)" stop-opacity="1"/>
      <stop offset="1" stop-color="var(--grid)" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <style>
    svg {
      --card-from:#ffffff; --card-to:#f2f5f9; --frame:#d0d7de; --fg:#1f2328; --muted:#656d76;
      --grid:#e4e8ee; --accent:#${accent}; --dot:#${accent}; --ring:#f2f5f9;
    }
    @media (prefers-color-scheme: dark) {
      svg {
        --card-from:#111827; --card-to:#0b1020; --frame:#263244; --fg:#e6edf3; --muted:#8b949e;
        --grid:#2b3546; --accent:${accentDark}; --dot:${dotDark}; --ring:#0b1020;
      }
    }
    @media (prefers-contrast: more) {
      svg { --grid:#9aa4b2; --muted:#3d444d; --frame:#57606a; }
    }
    text {
      font-family: ${L.font};
      text-rendering: geometricPrecision;
    }
    .name { font-size: 15px; font-weight: 600; letter-spacing: -.1px; fill: var(--fg); }
    .total { font-size: 52px; font-weight: 700; letter-spacing: -1.4px; fill: var(--fg); }
    .total-label { font-size: ${L.type.totalLabel}px; font-weight: ${L.type.totalLabelWeight}; letter-spacing: ${L.type.totalLabelTracking}px; fill: var(--muted);${L.type.totalLabelStroke ? ` stroke: var(--muted); stroke-width: ${L.type.totalLabelStroke};` : ''} }
    .dl-icon { fill: none; stroke: var(--accent); stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
    .stat-label { font-size: ${L.type.statLabel}px; fill: var(--muted); }
    .stat-value { font-size: 13px; font-weight: 600; fill: var(--fg); font-variant-numeric: tabular-nums; }
    .accent { fill: var(--accent); }
    .caption { font-size: ${L.type.caption}px; fill: var(--muted); }
    .axis { font-size: 10px; fill: var(--muted); font-variant-numeric: tabular-nums; }
    .axis-latest { fill: var(--fg); font-weight: 600; }
    .footer { font-size: ${L.type.footer}px; fill: var(--muted); font-variant-numeric: tabular-nums; }
    .grid { stroke: var(--grid); stroke-width: 1; }
    .bar { fill: var(--accent); opacity: .26; }
    .bar-latest { opacity: .85; }
    .bar-value { font-size: ${BAR_VALUE_SIZE}px; fill: var(--muted); font-variant-numeric: tabular-nums; }
    .bar-value-latest { fill: var(--fg); font-weight: 600; }
    .line { fill: none; stroke: var(--accent); stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; }
    .halo { fill: var(--accent); opacity: .16; }
    .ring { fill: var(--ring); }
    .dot { fill: var(--dot); }
    .key-line { fill: var(--accent); }
    .key-bar { fill: var(--accent); opacity: .4; }
  </style>
  <rect x=".5" y=".5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="18" fill="url(#card)" stroke="var(--frame)"/>

  ${embedIcon(icon, PANEL_X, 24, ICON_SIZE)}
  <text x="${hasIcon ? PANEL_X + ICON_SIZE + 12 : PANEL_X}" y="46" class="name">${escapeXml(title)}</text>

  <text x="${PANEL_X}" y="128" class="total">${formatTotal(total)}</text>
  ${downloadIcon(PANEL_X, TOTAL_LABEL_Y - L.type.totalLabel * 0.36, totalLabelIconSize)}
  <text x="${totalLabelX.toFixed(1)}" y="${TOTAL_LABEL_Y}" class="total-label">${escapeXml(L.totalLabel)}</text>

  ${stats}

  <line x1="${DIVIDER_X}" y1="26" x2="${DIVIDER_X}" y2="274" stroke="url(#rule)" stroke-width="1"/>

  <text x="${PLOT_LEFT}" y="${legendY}" class="caption">${escapeXml(L.range(rows.length, p))}</text>
  ${legend}

  ${grid}
  <path d="${area}" fill="url(#area)"/>
  <path d="${line}" class="line"/>
  ${endMarker}

  <line x1="${PLOT_LEFT}" y1="${BAR_BASELINE}" x2="${PLOT_RIGHT}" y2="${BAR_BASELINE}" class="grid"/>
  ${bars}

  ${labels}
  <text x="${CARD_RIGHT}" y="${FOOTER_Y}" text-anchor="end" class="footer">${escapeXml(L.updated(formatWallTime(updatedAt, offsetMinutes)))}</text>
</svg>
`;
}
