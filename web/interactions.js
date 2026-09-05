// Všetky poslucháče udalostí. Každý končí volaním setState alebo lokálnou zmenou tooltipu;
// nikto tu nekreslí do DOM okrem tooltipov, ktoré nie sú súčasťou stavu.

import { chartTooltipModel, STRIP } from '../shared/chart-model.js';
import { REFRESH, TOOLTIP_HOLD_MS } from '../shared/config.js';
import { loadData } from './data.js';
import { forecastModel } from './render/predpoved.js';
import { weekCurveModel } from './render/sedemdni.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */
/** @typedef {import('./state.js').Panel} Panel */

/** @param {Store} store @param {Dom} dom */
function initNavigation(store, dom) {
    document.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        const panelBtn = target.closest('[data-panel]');
        if (panelBtn instanceof HTMLElement && panelBtn.dataset.panel)
            store.setState({ panel: /** @type {Panel} */ (panelBtn.dataset.panel) });
        const dayBtn = target.closest('[data-day]');
        if (dayBtn instanceof HTMLElement) store.setState({ forecastDay: dayBtn.dataset.day === 'tomorrow' ? 'tomorrow' : 'today' });
        const weekBtn = target.closest('[data-day-index]');
        if (weekBtn instanceof Element && dom.panels['7dni'].contains(weekBtn))
            store.setState({ weekSelDay: Number(weekBtn.getAttribute('data-day-index')) });
    });
    dom.previewReset.addEventListener('click', () => store.setState({ previewMinutes: null, isDragging: false }));
}

/** @param {Dom} dom @param {number} clientX */
function minutesFromClientX(dom, clientX) {
    const rect = dom.daystrip.getBoundingClientRect();
    const relX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return Math.round((relX / (rect.width || 1)) * STRIP.w) % STRIP.w;
}

/** Ťahanie bežca a klik na pás dňa = náhľad iného času. @param {Store} store @param {Dom} dom */
function initTimePreview(store, dom) {
    const handle = dom.stripMarkerHandle;
    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        store.setState({ previewMinutes: minutesFromClientX(dom, e.clientX), isDragging: true });
    });
    handle.addEventListener('pointermove', (e) => {
        if (store.get().isDragging) store.setState({ previewMinutes: minutesFromClientX(dom, e.clientX) });
    });
    const end = () => {
        if (store.get().isDragging) store.setState({ isDragging: false });
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    dom.daystripWrap.addEventListener('click', (e) => {
        if (/** @type {HTMLElement} */ (e.target).closest('.strip-marker-handle')) return;
        store.setState({ previewMinutes: minutesFromClientX(dom, e.clientX), isDragging: false });
    });
}

/** @type {Array<{ wrap: HTMLElement, hide: () => void }>} */
const tapTooltips = [];
/** Ťuknutie mimo grafu zavrie jeho tooltip okamžite. */
function initTapTooltipClosing() {
    const closeOthers = (/** @type {Event} */ e) =>
        tapTooltips.forEach(({ wrap, hide }) => !wrap.contains(/** @type {Node} */ (e.target)) && hide());
    document.addEventListener('touchstart', closeOthers, { passive: true });
    document.addEventListener('click', closeOthers);
}

/** Spoločná obsluha kurzora aj prsta nad grafom. @param {HTMLElement} wrap @param {HTMLElement} tooltip @param {(clientX: number, clientY: number) => void} handle */
function bindPointer(wrap, tooltip, handle) {
    const hide = () => tooltip.classList.remove('visible');
    tapTooltips.push({ wrap, hide });
    wrap.addEventListener('mousemove', (e) => handle(e.clientX, e.clientY));
    wrap.addEventListener('mouseleave', hide);
    wrap.addEventListener('touchstart', (e) => handle(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    wrap.addEventListener('touchmove', (e) => handle(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    wrap.addEventListener('touchend', () => setTimeout(hide, TOOLTIP_HOLD_MS));
}

/** @param {HTMLElement} tooltip @param {string} time @param {string} text @param {number} left @param {number} top */
function showTooltip(tooltip, time, text, left, top) {
    const t = tooltip.querySelector('.tt-time');
    const k = tooltip.querySelector('.tt-kw');
    if (t) t.textContent = time;
    if (k) k.textContent = text;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.classList.add('visible');
}

/** Tooltip nad krivkou (interpolácia podľa X). @param {Store} store @param {HTMLElement} wrap @param {Element} svg @param {HTMLElement} tooltip @param {(s: import('./state.js').AppState) => ReturnType<typeof forecastModel>} modelFor */
function initCurveTooltip(store, wrap, svg, tooltip, modelFor) {
    bindPointer(wrap, tooltip, (clientX) => {
        const model = modelFor(store.get());
        if (!model) return;
        const rect = svg.getBoundingClientRect();
        const relX = (clientX - rect.left) / (rect.width || 1);
        const tip = chartTooltipModel(model, relX);
        const extra =
            (tip.clearKw !== null ? ` · strop ${tip.clearKw.toFixed(2)} kW` : '') +
            (tip.cloud !== null ? ` · ${tip.cloud}% oblačnosť` : '');
        showTooltip(tooltip, tip.time, `${tip.kw.toFixed(2)} kW${extra}`, clientX - rect.left, tip.yFrac * rect.height);
    });
}

/** Tooltip nad bunkami a stĺpcami (obsah je v data-tip atribútoch). @param {HTMLElement} wrap @param {HTMLElement} tooltip */
function initRectTooltip(wrap, tooltip) {
    bindPointer(wrap, tooltip, (clientX, clientY) => {
        const hit = document.elementFromPoint(clientX, clientY);
        const target = hit && hit.closest('[data-tip]');
        if (!(target instanceof Element)) return tooltip.classList.remove('visible');
        const wrapRect = wrap.getBoundingClientRect();
        const cell = target.getBoundingClientRect();
        showTooltip(
            tooltip,
            target.getAttribute('data-tip-title') || '',
            target.getAttribute('data-tip') || '',
            cell.left - wrapRect.left + cell.width / 2,
            cell.top - wrapRect.top,
        );
    });
}

/** Klik na spotrebič prepne tooltip s príkonom; zmizne sám alebo klikom inde. @param {Dom} dom */
function initDeviceChips(dom) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
    document.addEventListener('click', (e) => {
        const chip = /** @type {HTMLElement} */ (e.target).closest('.go-chip');
        const wasOpen = chip && chip.classList.contains('tooltip-open');
        clearTimeout(timer);
        dom.verdictGoRow.querySelectorAll('.go-chip.tooltip-open').forEach((c) => c.classList.remove('tooltip-open'));
        if (chip && !wasOpen) {
            chip.classList.add('tooltip-open');
            timer = setTimeout(() => chip.classList.remove('tooltip-open'), TOOLTIP_HOLD_MS);
        }
    });
}

/** Po pinch-zoome (najmä okolo grafov, kde majú .chart-wrap touch-action:none) sa stránka
 * niekedy vráti na zoom 1x, ale vizuálne ostane vodorovne posunutá mimo okraja displeja -
 * známa nezhoda visual/layout viewportu v mobilných prehliadačoch. Po ustálení gesta preto
 * posun skontrolujeme a opravíme. */
function initViewportZoomRealign() {
    const vv = window.visualViewport;
    if (!vv) return;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let settleTimer;
    const checkAlignment = () => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
            if (vv.scale <= 1.001 && window.scrollX !== 0) window.scrollTo(0, window.scrollY);
        }, 150);
    };
    vv.addEventListener('resize', checkAlignment);
    vv.addEventListener('scroll', checkAlignment);
}

/** Hodiny, obnova dát, návrat z pozadia a zmeny šírky okna. @param {Store} store @param {{ wide: MediaQueryList, desktop: MediaQueryList }} mq */
function initTicks(store, mq) {
    const refresh = async () => {
        const result = await loadData();
        store.setState({
            pv: result.pv,
            forecast: result.forecast,
            source: result.source,
            dataError: !result.pv && !result.forecast,
            now: new Date(),
        });
    };
    setInterval(() => !document.hidden && store.setState({ now: new Date() }), REFRESH.clockMs);
    setInterval(() => !document.hidden && refresh(), REFRESH.dataMs);
    document.addEventListener('visibilitychange', () => !document.hidden && refresh());
    mq.wide.addEventListener('change', (e) => store.setState({ wide: e.matches }));
    mq.desktop.addEventListener('change', (e) => store.setState({ desktop: e.matches }));
    return refresh;
}

/** @param {Store} store @param {Dom} dom @param {{ wide: MediaQueryList, desktop: MediaQueryList }} mq */
export function initInteractions(store, dom, mq) {
    initViewportZoomRealign();
    initNavigation(store, dom);
    initTimePreview(store, dom);
    initTapTooltipClosing();
    initCurveTooltip(store, dom.forecastChartWrap, dom.forecastChart, dom.forecastTooltip, forecastModel);
    initCurveTooltip(store, dom.weekCurveWrap, dom.weekCurve, dom.weekCurveTooltip, weekCurveModel);
    initRectTooltip(dom.weekHeatWrap, dom.weekHeatTooltip);
    initRectTooltip(dom.weekBarsWrap, dom.weekBarsTooltip);
    initDeviceChips(dom);
    return initTicks(store, mq);
}
