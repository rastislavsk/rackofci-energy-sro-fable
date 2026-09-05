// Všetky texty odporúčaní pre používateľa na jednom mieste. Čisté funkcie bez DOM.

import { hourLabel, weekDayLabel } from './format.js';
import { productionLevel } from './tariff.js';

/** @typedef {import('./config.js').Tier} Tier */
/** @typedef {{ headline: string, body: string }} Message */

// Mriežka textov: sieť (red = drahá, amber = lacná, green = ideálne okno) × výroba (niz/str/vys).
// "override" nahradí základný text, keď z predpovede vyplýva citeľne silnejšie slnko ešte dnes.
export const SLOT_MESSAGES = {
    red: {
        niz: {
            h: 'Nezapínaj veľké spotrebiče',
            p: 'Slnko dnes už výraznejšie nepridá a elektrina je drahá. Práčku, sušičku ani nabíjanie auta teraz nespúšťaj.',
            override: {
                h: 'Počkaj na slnko',
                p: (/** @type {string} */ d) =>
                    `Elektrina je teraz drahá a slnko ešte nepridáva. Silnejšie slnko príde ${d} — veľké spotrebiče si nechaj na vtedy.`,
            },
        },
        str: {
            h: 'Len menšie spotrebiče',
            p: 'Panely čiastočne pomáhajú, sieť je stále drahá. Rýchlovarná kanvica či nabíjačky sú v poriadku, veľké spotrebiče radšej nie.',
            override: {
                h: 'Počkaj, bude to lepšie',
                p: (/** @type {string} */ d) =>
                    `Panely zatiaľ len pomáhajú, sieť je drahá. Silnejšie slnko a lacnejšia elektrina prídu ${d} — veľké spotrebiče si nechaj na vtedy.`,
            },
        },
        vys: {
            h: 'Môžeš zapnúť aj väčší spotrebič',
            p: 'Aj v drahej hodine dávajú panely slušný výkon. Jeden väčší spotrebič si môžeš dovoliť.',
        },
    },
    amber: {
        niz: {
            h: 'Malé spotrebiče áno. Veľké nezapínaj, ak nemusíš.',
            p: 'Sieť je ale lacná, takže ak potrebuješ, kľudne zapni aj veľké spotrebiče.',
            override: {
                h: 'Radšej počkaj na slnko',
                p: (/** @type {string} */ d) =>
                    `Sieť je síce lacná, ale zadarmo elektrina zo slnka príde ${d}. Ak to nie je súrne, počkaj.`,
            },
        },
        str: {
            h: 'Dobrý čas na bežnú prevádzku',
            p: 'Slušná výroba aj lacná sieť — toto je dnes už asi najlepšie, čo bude. Práčka, umývačka aj iné bežné spotrebiče môžu ísť.',
            override: {
                h: 'Počkaj, ak to nie je súrne',
                p: (/** @type {string} */ d) => `Teraz je to dobré, ale zadarmo elektrina zo slnka príde ${d}. Ak môžeš počkať, oplatí sa.`,
            },
        },
        vys: {
            h: 'Výborný čas na spotrebiče',
            p: 'Vysoká výroba a lacná sieť. Využi to na veľké spotrebiče vrátane nabíjania auta.',
        },
    },
    green: {
        niz: {
            h: 'Zváž, či nepočkať',
            p: (/** @type {{ tomorrowSunny: boolean }} */ ctx) =>
                ctx.tomorrowSunny
                    ? 'Panely momentálne nedávajú veľa. Zajtra bude slnečno, tak to pokojne nechaj na zajtra.'
                    : 'Panely momentálne nedávajú veľa. Zajtra podľa predpovede slnečno nebude, tak kľudne zapni, čo potrebuješ.',
        },
        str: {
            h: 'Dobrý čas, využi ho',
            p: 'Slnko okay, cena elektriny ok. Zapni práčku, umývačku, čo potrebuješ.',
        },
        vys: {
            h: 'Najlepší čas dňa — zapni všetko',
            p: 'Plný výkon a nulová cena. Ideálny moment na práčku, sušičku aj nabíjanie auta.',
        },
    },
};

/**
 * Odporúčanie pre kombináciu tarify a výkonu, s ohľadom na predpoveď.
 * @param {Tier | null} tier @param {number} powerKw
 * @param {{ strongerWindowAhead?: boolean, windowDaypart?: string | null, tomorrowSunny?: boolean } | null} forecast
 * @returns {Message | null}
 */
export function getSlotMessage(tier, powerKw, forecast) {
    const level = productionLevel(powerKw);
    if (!level || !tier) return null;
    const entry = SLOT_MESSAGES[tier][level];

    if (tier === 'green') {
        const body = typeof entry.p === 'function' ? entry.p({ tomorrowSunny: !!(forecast && forecast.tomorrowSunny) }) : entry.p;
        return { headline: entry.h, body };
    }
    if ('override' in entry && forecast && forecast.strongerWindowAhead && forecast.windowDaypart) {
        return { headline: entry.override.h, body: entry.override.p(forecast.windowDaypart) };
    }
    return { headline: entry.h, body: /** @type {string} */ (entry.p) };
}

/**
 * Krátky odznak nad ciferníkom: tarifa · slnko.
 * @param {Tier} tier @param {number} powerKw @param {boolean} isNightSlot
 */
export function buildEyebrow(tier, powerKw, isNightSlot) {
    const tariffPhrase = tier === 'green' ? "IT'S GREENTIME 🙂" : tier === 'amber' ? 'Lacná elektrina' : 'Drahá elektrina';
    if (isNightSlot) return `${tariffPhrase} · noc`;
    const level = productionLevel(powerKw);
    const sunPhrase = level === 'vys' ? 'silné slnko' : level === 'str' ? 'mierne slnko' : level === 'niz' ? 'slnko je slabé' : null;
    return sunPhrase ? `${tariffPhrase} · ${sunPhrase}` : tariffPhrase;
}

/**
 * Správa pod grafom predpovede pre jeden deň.
 * @param {Array<{hour: number, kw: number}>} pts @param {boolean} isToday
 * @returns {{ title: string, body: string }}
 */
export function forecastDayMessage(pts, isToday) {
    const peak = pts.reduce((a, b) => (b.kw > a.kw ? b : a), pts[0] || { hour: 0, kw: 0 });

    if (peak.kw < 1.2) {
        return isToday
            ? { title: 'Dnes bude slabo', body: 'Výroba bude celý deň nízka. Veľké spotrebiče si radšej naplánuj na iný deň.' }
            : { title: 'Zajtra bude slabšie', body: 'Predpoveď počíta s nízkou výrobou. Ak to nie je súrne, počkaj na slnečnejší deň.' };
    }

    const strongHours = pts.filter((p) => p.kw >= peak.kw * 0.6).map((p) => p.hour);
    const rangeStart = Math.min(...strongHours);
    const rangeEnd = Math.max(...strongHours) + 1;
    const peakLabel = hourLabel(peak.hour);

    if (isToday) {
        return {
            title: `Najsilnejšie slnko okolo ${peakLabel}`,
            body: `Špička okolo ${peakLabel}. Veľké spotrebiče majú najviac zmysel medzi ${rangeStart}:00 a ${rangeEnd}:00.`,
        };
    }
    return {
        title: 'Zajtra bude slnečno',
        body: `Špička okolo ${peakLabel} (~${peak.kw.toFixed(1)} kW). Veľké spotrebiče má zmysel naplánovať medzi ${rangeStart}:00 a ${rangeEnd}:00.`,
    };
}

/**
 * Správa pod týždenným prehľadom: najsilnejší a najslabší deň.
 * @param {Array<{date: string, kwhTotal: number}>} days
 * @returns {{ title: string, body: string }}
 */
export function weekMessage(days) {
    let best = days[0];
    let worst = days[0];
    days.forEach((d) => {
        if (d.kwhTotal > best.kwhTotal) best = d;
        if (d.kwhTotal < worst.kwhTotal) worst = d;
    });
    const bestLabel = weekDayLabel(best.date, days.indexOf(best));
    let body = `${bestLabel} má vyjsť najlepšie (${best.kwhTotal.toFixed(1)} kWh).`;
    if (worst !== best) {
        body += ` Najslabšie bude ${weekDayLabel(worst.date, days.indexOf(worst)).toLowerCase()} (${worst.kwhTotal.toFixed(1)} kWh).`;
    }
    return { title: `Najsilnejší deň: ${bestLabel}`, body };
}

export const EMPTY_MESSAGES = {
    forecast: { title: 'Predpoveď sa pripravuje', body: 'Hodinové dáta zatiaľ nie sú k dispozícii, skús to o chvíľu.' },
    week: { title: 'Predpoveď sa pripravuje', body: 'Týždenné dáta zatiaľ nie sú k dispozícii, skús to o chvíľu.' },
    loading: { headline: 'Načítavam…', body: '' },
};
