// Skladanie SVG reťazcov z modelov (shared/chart-model.js). Žiadne výpočty, iba zápis.
// Farby idú cez CSS triedy (style.css), nie cez atribúty.

import { RING, smoothPath } from '../shared/chart-model.js';
import { escapeHtml } from '../shared/format.js';

/** @typedef {NonNullable<ReturnType<typeof import('../shared/chart-model.js').forecastChartModel>>} ChartModel */

const n = (/** @type {number} */ v) => Number(v.toFixed(2));

/** Mriežka a popisky osí. @param {ChartModel} m */
function gridSvg(m) {
    const { dims } = m;
    let out = '';
    for (const g of m.gridX) {
        out += `<line class="grid" x1="${n(g.x)}" y1="${dims.padT}" x2="${n(g.x)}" y2="${dims.h - dims.padB}"/>`;
        out += `<text class="axis-label" x="${n(g.x)}" y="${dims.h - dims.xLabelGap}" text-anchor="${g.anchor}">${g.label}</text>`;
    }
    for (const g of m.gridY) {
        out += `<line class="grid" x1="${dims.padL}" y1="${n(g.y)}" x2="${dims.w - dims.padR}" y2="${n(g.y)}"/>`;
        out += `<text class="axis-label" x="${dims.padL - 9}" y="${n(g.y + 3.5)}" text-anchor="end">${g.label}</text>`;
    }
    return out;
}

/** Graf hodinovej výroby: mriežka, predpoveď, oblačnosť, skutočná výroba, značka "teraz". @param {ChartModel} m */
export function forecastChartSvg(m) {
    const { dims } = m;
    let out = gridSvg(m);
    out += `<path class="line-forecast" d="${smoothPath(m.line)}"/>`;
    if (m.cloud) out += `<path class="line-cloud" d="${smoothPath(m.cloud)}"/>`;
    if (m.real.length) out += `<path class="line-real" d="${smoothPath(m.real)}"/>`;
    if (m.nowX !== null) out += `<line class="now-line" x1="${n(m.nowX)}" y1="${dims.padT}" x2="${n(m.nowX)}" y2="${dims.h - dims.padB}"/>`;
    if (m.realLast) out += `<circle class="dot-real" cx="${n(m.realLast.x)}" cy="${n(m.realLast.y)}" r="4"/>`;
    return out;
}

/** Denný prstenec ciferníka: tarifné pásma dňa ako oblúky po obvode.
 * @param {ReturnType<typeof import('../shared/chart-model.js').dayRingModel>} m */
export function dayRingSvg(m) {
    const r = RING.rDay;
    return m
        .map(
            (a) =>
                `<path class="day-band ${a.cls}" d="M ${n(a.start.x)} ${n(a.start.y)} A ${r} ${r} 0 ${a.large} 1 ${n(a.end.x)} ${n(a.end.y)}"/>`,
        )
        .join('');
}

/** @param {{ title: string, text: string } | null} tip */
const tipAttrs = (tip) => (tip ? ` data-tip-title="${escapeHtml(tip.title)}" data-tip="${escapeHtml(tip.text)}"` : '');

/** Heatmapa hodina × deň. @param {ReturnType<typeof import('../shared/chart-model.js').weekHeatModel>} m */
export function weekHeatSvg(m) {
    let out = m.hourLabels.map((l) => `<text class="axis-label" x="${n(l.x)}" y="${l.y}" text-anchor="middle">${l.label}</text>`).join('');
    out += m.dayLabels
        .map(
            (l) =>
                `<text class="day-label${l.today ? ' today' : ''}${l.sel ? ' sel' : ''}" x="${l.x}" y="${n(l.y)}" text-anchor="end" data-day-index="${l.dayIndex}">${l.label}</text>`,
        )
        .join('');
    out += m.cells
        .map(
            (c) =>
                `<rect class="heat-cell${c.tier ? ` tier-${c.tier}` : ''}"${tipAttrs(c.tip)} data-day-index="${c.dayIndex}" x="${n(c.x)}" y="${n(c.y)}" width="${n(c.w)}" height="${n(c.h)}" rx="3" fill-opacity="${c.tier ? n(0.12 + c.frac * 0.8) : 0.05}"${c.tier ? '' : ' data-empty="1"'}/>`,
        )
        .join('');
    if (m.selRect)
        out += `<rect class="week-row-sel" x="${m.selRect.x}" y="${n(m.selRect.y)}" width="${n(m.selRect.w)}" height="${n(m.selRect.h)}" rx="4"/>`;
    return out;
}

/** Denná výroba so stropom jasnej oblohy. @param {ReturnType<typeof import('../shared/chart-model.js').weekBarsModel>} m */
export function weekBarsSvg(m) {
    let out = m.grid
        .map(
            (g) =>
                `<line class="grid" x1="${m.padL}" y1="${n(g.y)}" x2="${m.W - m.padR}" y2="${n(g.y)}"/><text class="axis-label" x="${m.padL - 6}" y="${n(g.y + 3)}" text-anchor="end">${g.label}</text>`,
        )
        .join('');
    for (const b of m.bars) {
        // Pásmo dňa je tá istá farba ako v heatmape (viď weekDayTiers) - stĺpec aj číslo
        // nad ním ju nesú spolu, aby sa dal silný deň nájsť očami bez čítania.
        const tier = b.tier ? ` tier-${b.tier}` : '';
        out += `<rect class="bar${tier}${b.sel ? ' sel' : ''}" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="3"/>`;
        if (b.clearY != null)
            out += `<line class="clear-cap" x1="${n(b.x - 2)}" y1="${n(b.clearY)}" x2="${n(b.x + b.w + 2)}" y2="${n(b.clearY)}"/>`;
        out += `<text class="bar-value${tier}${b.sel ? ' sel' : ''}" x="${n(b.cx)}" y="${n(b.y - 6)}" text-anchor="middle">${b.valueLabel}</text>`;
        out += `<text class="day-label${b.today ? ' today' : ''}${b.sel ? ' sel' : ''}" x="${n(b.cx)}" y="${m.labelY}" text-anchor="middle">${b.dayLabel}</text>`;
        out += `<text class="axis-label" x="${n(b.cx)}" y="${m.dateY}" text-anchor="middle">${b.dateLabel}</text>`;
        out += `<rect class="bar-hit"${tipAttrs(b.tip)} data-day-index="${b.dayIndex}" x="${n(b.hit.x)}" y="0" width="${n(b.hit.w)}" height="${m.H}"/>`;
    }
    return out;
}
