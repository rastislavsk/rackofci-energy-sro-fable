# Račkofci Energy · Kedy zapínať spotrebiče

Mobilná webová appka pre domácnosť s fotovoltikou v Dvoranoch nad Nitrou. Na jednej
obrazovke odpovedá na otázku „môžem teraz zapnúť práčku?“ a k tomu ukazuje živý výkon
panelov, predpoveď výroby na dnes a zajtra a prehľad na sedem dní.

Appka je statická stránka bez build kroku. Beží na GitHub Pages, dáta jej dodáva
Cloudflare Worker.

## Čo appka ukazuje

- **Spotrebiče** – aktuálny výkon na ciferníku, jednoveté odporúčanie („Najlepší čas dňa
  — zapni všetko“), stav piatich spotrebičov a pás dňa s farebnými tarifnými pásmami.
  Potiahnutím bežca alebo klikom na pás si pozrieš, ako to bude vyzerať v inom čase.
- **Predpoveď** – hodinová krivka výroby na dnes alebo zajtra, oblačnosť a skutočná
  nameraná výroba nad ňou.
- **7 dní** – mapa výroby hodina × deň, denné súčty proti stropu jasnej oblohy, priebeh
  vybraného dňa a tabuľka.
- **Zdieľať** – QR kód a odkaz na appku.

## Ako to funguje

```
Huawei FusionSolar kiosk ─┐
                          ├─→ Cloudflare Worker (cron 5 min) ─→ KV ─→ GET / ─→ appka
Open-Meteo (žiarenie) ────┘
```

Worker každých päť minút stiahne živý výkon z verejného kiosk odkazu a raz za hodinu
prepočíta predpoveď z Open-Meteo. Obe uloží do Cloudflare KV a servíruje ich na jednom
endpointe s CORS hlavičkami a minútovou cache. Appka teda robí jeden request.

Predpoveď sa nesťahuje hotová: Worker si z meteorologického žiarenia sám dopočíta polohu
slnka, premietne žiarenie na roviny panelov (juh a východ), pripočíta teplotný odber a
limit striedača. Tá istá funkcia počíta aj strop pri úplne jasnej oblohe, z ktorého
vychádza údaj „využitie“.

Ak by Worker vypadol, appka spadne na záložné zdroje pôvodnej appky (`LEGACY_SOURCES`
v `shared/config.js`) — tie čítajú ten istý kiosk. Záloha je ponechaná zámerne: pôvodná
appka beží ďalej, takže poistka nič nestojí. Keď nie je dostupný ani jeden zdroj, appka
ukáže „dáta nedostupné“ a nespadne.

## Štruktúra

| Priečinok                           | Čo obsahuje                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/`                           | Doménová logika bez vstupov a výstupov: konštanty, fyzika slnka, parser kiosku, tarify, texty, modely grafov. Beží v prehliadači, v Node aj vo Workeri. |
| `web/`                              | Stav appky, načítanie dát, vykresľovanie po kartách, poslucháče udalostí, skladanie SVG.                                                                |
| `worker/`                           | Cloudflare Worker: cron, KV, jeden endpoint.                                                                                                            |
| `test/`                             | Jednotkové testy, kontrakt dát a end-to-end testy v prehliadači.                                                                                        |
| `index.html`, `style.css`, `app.js` | Samotná stránka. Žiadny bundler, žiadny framework.                                                                                                      |

Doménová logika je oddelená zámerne: to isté číslo sa nikdy nepočíta na dvoch miestach a
každá funkcia v `shared/` sa dá otestovať bez prehliadača.

## Vývoj

```bash
npm install
npm run serve     # http://127.0.0.1:8080
npm run check     # lint + formát + typy + testy
npm run test:e2e  # testy v prehliadači (Playwright)
```

Typy sa kontrolujú cez JSDoc a `tsc --checkJs`, takže v repozitári nie je ani jeden
TypeScript súbor a stránka sa nikam nekompiluje.

Testovacie dáta v `test/fixtures/` sú syntetické a deterministické, vygeneruje ich
`npm run fixtures`. Výstup predpovede je zamknutý súborom `test/golden/forecast.json`;
keď zmeníš výpočet zámerne, spusti `UPDATE_GOLDEN=1 npm test` a zmenu popíš v pull requeste.

## Nasadenie

Oboje je nasadené a beží.

- **Stránka**: GitHub Pages, _Deploy from a branch_, vetva `main`, priečinok `/ (root)`.
  Adresa: <https://rastislavsk.github.io/rackofci-energy-sro-fable/>
- **Worker** `rackofci-energy-sro-fable`: nasadzuje sa sám pri pushnutí do `main` cez
  Git integráciu Cloudflare. Postup, nastavenia buildu a potrebné tajomstvá sú
  v [`worker/README.md`](worker/README.md).

Zdravie systému sa dá skontrolovať jedným pohľadom na
`https://rackofci-energy-sro-fable.rastislav-racek.workers.dev/status` — `"ok": true`
znamená, že cron beží a obe časti dát sú čerstvé.
