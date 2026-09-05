// Formátovanie času a čísel pre slovenské UI. Čisté funkcie bez DOM.

const WEEK_DAYS_SHORT = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'];

/** @param {number} n */
export function pad2(n) {
    return String(n).padStart(2, '0');
}

/** Minúty dňa -> "HH:MM", s ošetrením pretečenia cez polnoc. @param {number} minutes */
export function minutesToTimeStr(minutes) {
    const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** "HH:MM" -> minúty dňa. @param {string} str */
export function timeStrToMinutes(str) {
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
}

/** Desatinná hodina (13.5) -> "13:30". @param {number} hourFloat */
export function hourFloatToTimeStr(hourFloat) {
    const hh = Math.floor(hourFloat);
    const mm = Math.round((hourFloat - hh) * 60);
    return `${pad2(hh)}:${pad2(mm)}`;
}

/** Celá hodina -> "HH:00". @param {number} hour */
export function hourLabel(hour) {
    return `${pad2(hour)}:00`;
}

/** Číslo s jedným desatinným miestom a slovenskou čiarkou. @param {number} n */
export function fmt1(n) {
    return n.toFixed(1).replace('.', ',');
}

/** Číslo s dvomi desatinnými miestami a slovenskou čiarkou. @param {number} n */
export function fmt2(n) {
    return n.toFixed(2).replace('.', ',');
}

/** Popisok mriežky v kW: celé číslo bez desatín, inak max. dve desatiny bez koncovej nuly. @param {number} kw */
export function formatGridKw(kw) {
    if (Number.isInteger(kw)) return String(kw);
    return kw.toFixed(2).replace(/0$/, '').replace('.', ',');
}

/** Rozloží "YYYY-MM-DD" na deň, mesiac a deň v týždni (0 = nedeľa). @param {string} dateStr */
export function dateParts(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return { day: d, month: m, dow };
}

/** "Dnes", "Zajtra", inak skratka dňa v týždni. @param {string} dateStr @param {number} index */
export function weekDayShort(dateStr, index) {
    if (index === 0) return 'Dnes';
    if (index === 1) return 'Zajtra';
    return WEEK_DAYS_SHORT[dateParts(dateStr).dow];
}

/** "6.9." @param {string} dateStr */
export function weekDateLabel(dateStr) {
    const { day, month } = dateParts(dateStr);
    return `${day}.${month}.`;
}

/** "Dnes", "Zajtra", inak "St 8.9.". @param {string} dateStr @param {number} index */
export function weekDayLabel(dateStr, index) {
    if (index < 2) return weekDayShort(dateStr, index);
    return `${weekDayShort(dateStr, index)} ${weekDateLabel(dateStr)}`;
}

/** Ošetrenie textu pred vložením do HTML/SVG reťazca. @param {unknown} value */
export function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
