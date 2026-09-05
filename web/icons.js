// Inline SVG ikony (spotrebiče, počasie). Iba reťazce, žiadna logika.

/** @type {Record<string, string>} */
export const DEVICE_ICONS = {
    Práčka: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="6"/><path d="M8 4h8M9 4v2M15 4v2"/></svg>',
    Sušička: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v2a3 3 0 003 3M18 3v2a3 3 0 01-3 3M9 8v9a3 3 0 006 0V8"/></svg>',
    Umývačka:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16v11a1 1 0 01-1 1H5a1 1 0 01-1-1V8z"/><path d="M4 8l2-4h12l2 4"/></svg>',
    Auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13l2-5a2 2 0 012-1h10a2 2 0 012 1l2 5v5a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H6v1a1 1 0 01-1 1H4a1 1 0 01-1-1v-5z"/><circle cx="7.5" cy="16.5" r="1.2"/><circle cx="16.5" cy="16.5" r="1.2"/></svg>',
    Bojler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/></svg>',
};

export const ICON_SUN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
export const ICON_CLOUD =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H6a4 4 0 1 1 .5-7.97A5.5 5.5 0 0 1 17 10a4 4 0 0 1 .5 9Z"/></svg>';
export const ICON_PARTLY =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="15" cy="8" r="3"/><path d="M15 2v1.3M19.6 4.4l-.9.9M21 8h-1.3M9.4 4.4l.9.9"/><path d="M16.5 19H7a4 4 0 1 1 .5-7.97 5.5 5.5 0 0 1 9.7 2.02A4 4 0 0 1 16.5 19Z"/></svg>';
