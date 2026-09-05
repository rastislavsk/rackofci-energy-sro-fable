# Architektúra

## Prehľad

```
        Huawei FusionSolar kiosk        Open-Meteo (žiarenie, teplota, oblačnosť)
                    │                              │
                    └───────────┬──────────────────┘
                                ▼
                 Cloudflare Worker  ── cron */5 min
                 shared/kiosk.js · shared/solar.js
                                │
                                ▼
                       KV: "pv" + "forecast"
                                │
                          GET / (CORS, cache 60 s)
                                ▼
        Appka: web/data.js → setState → render → DOM
```

Kľúčové rozhodnutie: **výpočet je jeden a beží v Cloudflare Workeri.** Appka nič
nepočíta z meteorologických dát, iba kreslí. Tá istá funkcia (`shared/solar.js`) sa dá
zavolať v Node z testov, takže predpoveď je overiteľná bez prehliadača aj bez siete.

## Vrstvy

**`shared/` – doména bez vstupov a výstupov.** Nesmie sa dotknúť DOM, siete ani
aktuálneho času. Všetko, čo potrebuje, dostane parametrom.

| Modul            | Zodpovednosť                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `config.js`      | Všetky konštanty: lokalita, zostava panelov, hranice výkonu, tarifné okná, spotrebiče, adresy.          |
| `solar.js`       | Poloha slnka, žiarenie na rovinu panelu, výkon elektrárne, bezoblačný strop, zloženie celej predpovede. |
| `kiosk.js`       | Parser odpovede kiosku na formát `pv`.                                                                  |
| `tariff.js`      | Sezóna, tarifné okná, pásma výkonu, stav spotrebičov.                                                   |
| `messages.js`    | Všetky texty odporúčaní pre používateľa.                                                                |
| `chart-model.js` | Geometria grafov ako čisté dáta: body, mriežky, tooltipy, súhrny.                                       |
| `hero-model.js`  | Model hlavnej karty pre daný čas – rovnaký pre „teraz“ aj pre náhľad.                                   |
| `schema.js`      | Kontrakt dát medzi Workerom a appkou.                                                                   |

**`web/` – prehliadač.** `state.js` drží jediný stavový objekt; `setState` zlúči zmenu a
zavolá prekreslenie práve raz, rovnaká hodnota nespustí nič. `render/index.js` je jediné
miesto, ktoré kreslí, a kreslí len viditeľné karty. `interactions.js` obsahuje všetky
poslucháče a každý končí volaním `setState`. `svg.js` skladá SVG z modelu a nič nepočíta.

**`worker/`** je tenký: stiahni, zavolaj `shared/`, ulož do KV, vráť JSON.

## Prečo takto

- **Jednosmerný tok.** V pôvodnej appke volalo prekreslenie hlavnej karty šesť rôznych
  miest a stav bol v dvanástich globálnych premenných. Tu vedie z každej akcie práve jedna
  cesta: udalosť → `setState` → `render`. Preto sa nedá stať, že jedna karta ukazuje iný
  čas než druhá.
- **Modely oddelené od kreslenia.** Grafy najprv vzniknú ako čísla (`chart-model.js`) a až
  potom ako SVG. Vďaka tomu je otestovateľné aj to, čo by sa inak dalo overiť len okom.
- **Texty na jednom mieste.** Odporúčania sú mriežka tarifa × výroba v `messages.js`, nie
  reťazec podmienok roztrúsený po kóde.
- **Kontrakt dát.** `schema.js` overuje, čo prišlo zo siete. Neplatné dáta sa správajú ako
  chýbajúce, takže appka nikdy neukáže rozbitý graf.

## Vedomé odchýlky od pôvodnej appky

- **Bezoblačný strop pri teplote danej hodiny.** Pôvodná appka počítala strop pri 25 °C,
  kým predpoveď pri skutočnej teplote. V chladný jasný deň preto „využitie“ vychádzalo nad
  100 %. Tu majú obe rovnakú teplotu, takže pomer vyjadruje čistú stratu oblačnosťou.
- **Dáta sa nekomitujú do repozitára.** Pôvodná appka ukladala JSON do gitu každých päť
  minút cez GitHub Actions. Teraz sú v KV.
- **Tarifné okná sú dáta, nie HTML.** Pôvodne boli v `data-` atribútoch skrytého zoznamu,
  teraz v `config.js`, odkiaľ ich číta appka aj testy.

## Testovanie

| Vrstva            | Čím                                                                       |
| ----------------- | ------------------------------------------------------------------------- |
| Doména            | `node --test`, pokrytie `shared/` aspoň 90 % riadkov                      |
| Výstup predpovede | golden súbor `test/golden/forecast.json`                                  |
| Kontrakt dát      | `schema.js` proti výstupu parsera a predpovede                            |
| Worker            | cron a endpoint proti KV v pamäti a podvrhnutému `fetch`                  |
| Appka             | Playwright: štyri karty, interakcie, chyby v konzole, prístupnosť cez axe |

E2E testy nepoužívajú vlastné očakávané reťazce – volajú tú istú funkciu ako appka a
porovnávajú ju s DOM. Test tak nezlyhá pri zmene textu, ale zlyhá, keď sa appka rozíde
s modelom.

## Čo zatiaľ chýba

- Worker ešte nie je nasadený; appka dovtedy číta záložné zdroje pôvodnej appky
  (`LEGACY_SOURCES` v `config.js`). Po nasadení a overení sa dá záloha odstrániť.
- Fixtures sú syntetické, lebo vývojové prostredie nemá prístup na internet. Po nasadení
  ich má zmysel nahradiť skutočnou odpoveďou oboch zdrojov.
