// Prekresľuj len to, čo sa naozaj zmenilo.
//
// Zápis do DOM označí prvok za "špinavý" aj vtedy, keď doň zapíšeš to isté, čo tam už je.
// Účet za to nepríde hneď - príde, keď si niekto najbližšie vypýta rozmery (napríklad
// interactions.js pri ďalšom kroku ťahania bežca), lebo vtedy musí prehliadač layout
// dopočítať. Pri ťahaní tak jeden zbytočný zápis zdražel každý ďalší pohyb prsta.
//
// Tieto pomôcky si preto pamätajú, čo samy naposledy videli, a nič z DOM nečítajú.

/** Zhodujú sa všetky kľúče? Porovnáva sa identita, nie obsah. @param {unknown[]} a @param {unknown[]} b */
export function sameKeys(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** @type {Map<string, unknown[]>} */
const lastKeys = new Map();

/**
 * Zmenil sa niektorý z kľúčov od posledného volania s týmto názvom? Prvé volanie je vždy `true`.
 * @param {string} name @param {unknown[]} keys
 */
export function changedKeys(name, keys) {
    const prev = lastKeys.get(name);
    if (prev && sameKeys(prev, keys)) return false;
    lastKeys.set(name, keys);
    return true;
}

/** To isté pre jedinú hodnotu. @param {string} name @param {unknown} value */
export function changed(name, value) {
    return changedKeys(name, [value]);
}

/** Zapíše HTML len vtedy, keď sa líši od naposledy zapísaného. @param {HTMLElement} el @param {string} html @param {string} name */
export function writeHtml(el, html, name) {
    if (changed(name, html)) el.innerHTML = html;
}
