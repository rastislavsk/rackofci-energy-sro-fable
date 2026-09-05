// Fyzika predpovede výroby FV: poloha slnka (zjednodušený NOAA), žiarenie na naklonenú
// rovinu (izotropný model), bezoblačný strop (Meinel) a skladanie výstupu predpovede.
// Čisté funkcie bez I/O - beží v Node, prehliadači aj Cloudflare Workeri.

import { CLEAR_SKY, FORECAST_DAYS_SHOWN, PLANT, POWER_HIGH_KW, SITE, STRONGER_WINDOW_MARGIN_KW } from './config.js';

/** @typedef {{ hour: number, kw: number, cloud: number | null }} HourPoint */
/** @typedef {HourPoint & { clearKw: number }} DayHourPoint */
/**
 * @typedef {{ date: string, hourly: DayHourPoint[], kwhTotal: number, clearKwhTotal: number,
 *   peakKw: number, peakHour: number | null, cloudAvgPct: number | null }} ForecastDay
 */
/**
 * @typedef {{ strongerWindowAhead: boolean, windowDaypart: string | null, peakKw: number | null,
 *   hoursAhead: number | null, tomorrowSunny: boolean, tomorrowPeakKw: number,
 *   hourlyToday: HourPoint[], hourlyTomorrow: HourPoint[], days: ForecastDay[], updatedAt: string }} Forecast
 */

const toRad = (/** @type {number} */ deg) => (deg * Math.PI) / 180;
const toDeg = (/** @type {number} */ rad) => (rad * 180) / Math.PI;
const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.max(lo, Math.min(hi, v));
const round = (/** @type {number} */ v, /** @type {number} */ digits) => Number(v.toFixed(digits));

/**
 * Poloha slnka (elevácia a azimut v stupňoch) pre daný UTC čas a miesto.
 * Počíta sa priamo v UTC - dĺžka ide do rovnice času, civilné pásmo netreba.
 * @param {Date} dateUtc @param {number} latDeg @param {number} lonDeg
 */
export function solarPosition(dateUtc, latDeg = SITE.lat, lonDeg = SITE.lon) {
    const startOfYear = Date.UTC(dateUtc.getUTCFullYear(), 0, 1);
    const dayOfYear = Math.floor((dateUtc.getTime() - startOfYear) / 86400000) + 1;
    const hourUtc = dateUtc.getUTCHours() + dateUtc.getUTCMinutes() / 60;
    const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hourUtc - 12) / 24);

    const eqTimeMin =
        229.18 *
        (0.000075 +
            0.001868 * Math.cos(gamma) -
            0.032077 * Math.sin(gamma) -
            0.014615 * Math.cos(2 * gamma) -
            0.040849 * Math.sin(2 * gamma));
    const declRad =
        0.006918 -
        0.399912 * Math.cos(gamma) +
        0.070257 * Math.sin(gamma) -
        0.006758 * Math.cos(2 * gamma) +
        0.000907 * Math.sin(2 * gamma) -
        0.002697 * Math.cos(3 * gamma) +
        0.00148 * Math.sin(3 * gamma);

    const trueSolarTimeMin = hourUtc * 60 + eqTimeMin + 4 * lonDeg;
    const hourAngleDeg = trueSolarTimeMin / 4 - 180;
    const latRad = toRad(latDeg);
    const hourAngleRad = toRad(hourAngleDeg);

    const sinElevation = Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
    const elevationRad = Math.asin(clamp(sinElevation, -1, 1));
    const elevationDeg = toDeg(elevationRad);

    let azimuthDeg = 180;
    if (elevationDeg > 0) {
        const cosAzimuth = (Math.sin(declRad) - Math.sin(elevationRad) * Math.sin(latRad)) / (Math.cos(elevationRad) * Math.cos(latRad));
        const azRad = Math.acos(clamp(cosAzimuth, -1, 1));
        azimuthDeg = hourAngleDeg > 0 ? 360 - toDeg(azRad) : toDeg(azRad);
    }
    return { elevationDeg, azimuthDeg };
}

/** @typedef {{ ghi: number, dni: number, dhi: number }} Irradiance */
/** @typedef {{ elevationDeg: number, azimuthDeg: number }} SunPosition */
/** @typedef {{ tiltDeg: number, azimuthDeg: number }} PanelPlane */

/**
 * Žiarenie na naklonenej rovine panelu (W/m²), izotropný model oblohy.
 * @param {Irradiance} irr @param {SunPosition} sun @param {PanelPlane} panel
 */
export function poaIrradiance(irr, sun, panel) {
    if (sun.elevationDeg <= 0) return 0;
    const elevationRad = toRad(sun.elevationDeg);
    const tiltRad = toRad(panel.tiltDeg);
    const azDiffRad = toRad(sun.azimuthDeg - panel.azimuthDeg);
    const cosAoi = Math.sin(elevationRad) * Math.cos(tiltRad) + Math.cos(elevationRad) * Math.sin(tiltRad) * Math.cos(azDiffRad);
    const beam = Math.max(0, irr.dni * cosAoi);
    const diffuseIso = (irr.dhi * (1 + Math.cos(tiltRad))) / 2;
    const ground = (irr.ghi * PLANT.albedo * (1 - Math.cos(tiltRad))) / 2;
    return Math.max(0, beam + diffuseIso + ground);
}

/**
 * AC výkon celej elektrárne (kW) pre dané žiarenie, teplotu a polohu slnka:
 * obe skupiny stringov, teplotný odber, účinnosť a limit striedača.
 * @param {Irradiance} irr @param {number} tempC @param {SunPosition} sun
 */
export function plantAcKw(irr, tempC, sun) {
    if (sun.elevationDeg <= 0) return 0;
    let dcWatts = 0;
    for (const s of PLANT.strings) {
        const poa = poaIrradiance(irr, sun, s);
        const cellTemp = tempC + ((PLANT.noctC - 20) / 800) * poa;
        const tempFactor = 1 + (PLANT.tempCoefPctPerC / 100) * (cellTemp - 25);
        dcWatts += s.panels * PLANT.panelWp * (poa / 1000) * Math.max(0, tempFactor);
    }
    const acKw = (dcWatts / 1000) * PLANT.systemEfficiency;
    return clamp(acKw, 0, PLANT.acLimitKw);
}

/** Predpovedaný AC výkon (kW) z Open-Meteo hodnôt pre daný UTC čas. */
export function forecastAcKw(
    /** @type {number} */ ghi,
    /** @type {number} */ dni,
    /** @type {number} */ dhi,
    /** @type {number} */ tempC,
    /** @type {Date} */ dateUtc,
) {
    return plantAcKw({ ghi, dni, dhi }, tempC, solarPosition(dateUtc));
}

/** Žiarenie bezoblačnej oblohy (Meinelov útlm, výšková korekcia) pre danú eleváciu. @param {number} elevationDeg */
export function clearSkyIrradiance(elevationDeg) {
    if (elevationDeg <= 0.5) return { ghi: 0, dni: 0, dhi: 0 };
    const zenithDeg = 90 - elevationDeg;
    const cosZ = Math.cos(toRad(zenithDeg));
    const airMass = 1 / (cosZ + 0.50572 * Math.pow(96.07995 - zenithDeg, -1.6364));
    const hkm = Math.max(0, SITE.elevationM) / 1000;
    const dni = 1353 * ((1 - 0.14 * hkm) * Math.pow(CLEAR_SKY.tau, Math.pow(airMass, 0.678)) + 0.14 * hkm);
    const dhi = CLEAR_SKY.dhiFraction * dni * cosZ;
    return { ghi: dni * cosZ + dhi, dni, dhi };
}

/**
 * Horný strop výroby (kW): koľko by elektráreň dala v tejto hodine pri úplne jasnej oblohe.
 * Teplota je tá istá ako v predpovedi danej hodiny, takže pomer výroba/strop vyjadruje
 * čistú stratu oblačnosťou a nikdy neprekročí 100 % (pri 25 °C by chladný deň dal viac).
 * @param {Date} dateUtc @param {number} [ambientC]
 */
export function clearSkyAcKw(dateUtc, ambientC = 25) {
    const sun = solarPosition(dateUtc);
    return plantAcKw(clearSkyIrradiance(sun.elevationDeg), ambientC, sun);
}

/** Miestna hodina (0-23) pre UTC čas. @param {Date} dateUtc */
export function localHour(dateUtc) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: SITE.timezone, hour: '2-digit', hour12: false }).formatToParts(dateUtc);
    const hour = parts.find((p) => p.type === 'hour');
    return Number(hour ? hour.value : 0) % 24;
}

/** Miestny dátum "YYYY-MM-DD" pre UTC čas. @param {Date} dateUtc */
export function localDateKey(dateUtc) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: SITE.timezone }).format(dateUtc);
}

/** Časť dňa pre text "silnejšie slnko príde ...". @param {Date} dateUtc */
export function daypartFor(dateUtc) {
    const h = localHour(dateUtc);
    if (h >= 12 && h < 17) return 'poobede';
    if (h >= 17 && h < 20) return 'podvečer';
    return 'neskôr';
}

/** @typedef {{ dateUtc: Date, acKw: number, localDate: string, cloudPct: number | null, tempC: number }} HourEntry */

/** Hodinové pole pre graf, zoradené podľa miestnej hodiny. @param {HourEntry[]} entries @returns {HourPoint[]} */
export function hourlySeries(entries) {
    return entries
        .map((h) => ({
            hour: localHour(h.dateUtc),
            kw: round(h.acKw, 2),
            cloud: Number.isFinite(h.cloudPct) ? Math.round(/** @type {number} */ (h.cloudPct)) : null,
        }))
        .sort((a, b) => a.hour - b.hour);
}

/**
 * Jeden deň pre kartu "7 dní": hodinová predpoveď + bezoblačný strop + súhrny.
 * @param {string} dayKey @param {HourEntry[]} entries @returns {ForecastDay}
 */
function buildDay(dayKey, entries) {
    const hourly = hourlySeries(entries).map((h) => {
        const entry = entries.find((e) => localHour(e.dateUtc) === h.hour);
        return { ...h, clearKw: entry ? round(clearSkyAcKw(entry.dateUtc, entry.tempC), 2) : 0 };
    });
    let peak = hourly[0] || { hour: null, kw: 0 };
    for (const h of hourly) if (h.kw > peak.kw) peak = h;
    const cloudVals = hourly.map((h) => h.cloud).filter((c) => c != null);
    return {
        date: dayKey,
        hourly,
        kwhTotal: round(
            hourly.reduce((s, h) => s + h.kw, 0),
            1,
        ),
        clearKwhTotal: round(
            hourly.reduce((s, h) => s + h.clearKw, 0),
            1,
        ),
        peakKw: round(peak.kw, 2),
        peakHour: peak.hour,
        cloudAvgPct: cloudVals.length ? Math.round(cloudVals.reduce((a, b) => a + b, 0) / cloudVals.length) : null,
    };
}

/**
 * Príde ešte dnes citeľne silnejšie slnko než teraz? (Pre texty "počkaj na slnko".)
 * @param {HourEntry[]} hourly @param {string} todayKey @param {number} nowHourUtc
 */
function strongerWindowAhead(hourly, todayKey, nowHourUtc) {
    const none = {
        strongerWindowAhead: false,
        windowDaypart: /** @type {string | null} */ (null),
        peakKw: /** @type {number | null} */ (null),
        hoursAhead: /** @type {number | null} */ (null),
    };
    const currentHour = hourly.find((h) => h.dateUtc.getTime() === nowHourUtc);
    const baselineKw = currentHour ? currentHour.acKw : 0;
    const futureToday = hourly.filter((h) => h.localDate === todayKey && h.dateUtc.getTime() > nowHourUtc);
    if (!futureToday.length) return none;
    let peak = futureToday[0];
    for (const h of futureToday) if (h.acKw > peak.acKw) peak = h;
    if (peak.acKw < POWER_HIGH_KW || peak.acKw < baselineKw + STRONGER_WINDOW_MARGIN_KW) return none;
    return {
        strongerWindowAhead: true,
        windowDaypart: daypartFor(peak.dateUtc),
        peakKw: round(peak.acKw, 2),
        hoursAhead: Math.round((peak.dateUtc.getTime() - nowHourUtc) / 3600000),
    };
}

/**
 * Zloží celý výstup predpovede z odpovede Open-Meteo. Toto je jediné miesto,
 * kde vzniká formát `forecast` - používa ho Worker aj testy.
 * @param {{ hourly: { time: string[], shortwave_radiation: number[], direct_normal_irradiance: number[],
 *   diffuse_radiation: number[], temperature_2m: number[], cloud_cover?: number[] } }} data
 * @param {Date} now
 * @returns {Forecast}
 */
export function buildForecast(data, now) {
    const {
        time,
        shortwave_radiation: ghiArr,
        direct_normal_irradiance: dniArr,
        diffuse_radiation: dhiArr,
        temperature_2m: tempArr,
        cloud_cover: cloudArr,
    } = data.hourly;

    const todayKey = localDateKey(now);
    const nowHourUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours());

    /** @type {HourEntry[]} */
    const hourly = time.map((t, i) => {
        const dateUtc = new Date(`${t}Z`);
        return {
            dateUtc,
            acKw: forecastAcKw(ghiArr[i], dniArr[i], dhiArr[i], tempArr[i], dateUtc),
            localDate: localDateKey(dateUtc),
            cloudPct: cloudArr ? cloudArr[i] : null,
            tempC: tempArr[i],
        };
    });

    const ahead = strongerWindowAhead(hourly, todayKey, nowHourUtc);

    const dayKeyOffset = (/** @type {number} */ days) => localDateKey(new Date(now.getTime() + days * 86400000));
    const tomorrowKey = dayKeyOffset(1);
    const tomorrowEntries = hourly.filter((h) => h.localDate === tomorrowKey);
    const tomorrowPeakKw = tomorrowEntries.reduce((max, h) => Math.max(max, h.acKw), 0);

    const days = [];
    for (let i = 0; i < FORECAST_DAYS_SHOWN; i++) {
        const key = dayKeyOffset(i);
        days.push(
            buildDay(
                key,
                hourly.filter((h) => h.localDate === key),
            ),
        );
    }

    return {
        ...ahead,
        tomorrowSunny: tomorrowPeakKw >= POWER_HIGH_KW,
        tomorrowPeakKw: round(tomorrowPeakKw, 2),
        hourlyToday: hourlySeries(hourly.filter((h) => h.localDate === todayKey)),
        hourlyTomorrow: hourlySeries(tomorrowEntries),
        days,
        updatedAt: now.toISOString(),
    };
}
