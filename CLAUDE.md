# Pokyny pre prácu v tomto repozitári

## Čo to je

Statická webová appka (GitHub Pages) pre domácnosť s fotovoltikou + Cloudflare Worker,
ktorý jej dodáva dáta. Podrobnosti v `README.md` a `docs/ARCHITECTURE.md`.

## Nemenné pravidlá

- **Žiadny build krok, framework ani bundler.** Stránka sa servíruje tak, ako leží v repozitári.
- **Žiadne runtime závislosti.** Jediná externá knižnica je QR kód z CDN, načítaný s `defer`
  a nepovinný. Vývojové závislosti (lint, testy) sú v poriadku.
- **Typy cez JSDoc a `tsc --checkJs`**, nie cez `.ts` súbory.
- **Doménová logika patrí do `shared/`** a nesmie sa dotýkať DOM, siete ani `Date.now()`.
  Čas a dáta do nej vstupujú ako parametre, aby sa dala testovať.
- **Jedno miesto pravdy.** Konštanta, ktorá je v `shared/config.js`, sa nikde inde nepíše
  natvrdo. To isté platí pre výpočet: ak ho potrebuje appka aj Worker, žije v `shared/`.
- **Jeden stav a jedno prekreslenie.** Stav appky je objekt vo `web/state.js`, mení sa
  výhradne cez `setState` a prekresľuje výhradne cez `render` vo `web/render/index.js`.
  Render funkcie sú čisté: čítajú stav, zapisujú do DOM, nič nevolajú späť.
- **Slovenčina** v komentároch, textoch pre používateľa aj v správach commitov.
- **KISS.** Keď sú dve riešenia rovnako dobré, vyhráva jednoduchšie.

## Pozor na kaskádu v CSS

Utilita `.hidden` stojí zámerne na konci `style.css` a nepoužíva `!important`. Má rovnakú
špecificitu ako komponentové triedy, takže rozhoduje poradie. **Nikdy nepíš pravidlo s
`display` cez selektor s ID** (napríklad `#panel-spotrebice`) – prebilo by `.hidden` a
skrytý prvok by ostal viditeľný. Používaj triedy.

## Ako overovať

```bash
npm run check     # lint, formát, typy, jednotkové testy s pokrytím
npm run test:e2e  # Playwright: štyri karty, interakcie, prístupnosť
cd worker && npx wrangler deploy --dry-run --outdir dist
```

Pokrytie `shared/` musí ostať aspoň 90 % riadkov, inak `npm test` zlyhá. Očakávané texty
v e2e testoch sa počítajú tou istou funkciou ako v appke, takže test odhalí rozdiel medzi
modelom a tým, čo je naozaj v DOM.

Predpoveď je zamknutá súborom `test/golden/forecast.json`. Zmenu výpočtu potvrď cez
`UPDATE_GOLDEN=1 npm test` a popíš ju v pull requeste – inak ide o neúmyselnú regresiu.

## Proces

Vetvy `claude/<téma>`, jeden pull request na tému, commit správy v štýle `feat: …`,
`fix: …`. Pred zlúčením musí byť CI zelené.
