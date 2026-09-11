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
| `format.js`      | Formátovanie času a čísel pre slovenské UI.                                                             |
| `http.js`        | Retry pre sieťové volania Workera; jeden prechodný výpadok nezhodí celý beh.                            |

**`web/` – prehliadač.** `state.js` drží jediný stavový objekt; `setState` zlúči zmenu a
zavolá prekreslenie práve raz, rovnaká hodnota nespustí nič. `render/index.js` je jediné
miesto, ktoré kreslí, a kreslí len viditeľné karty. `interactions.js` obsahuje všetky
poslucháče a každý končí volaním `setState` – jedinou výnimkou sú tooltipy, ktoré nie sú
súčasťou stavu a zapisujú sa priamo. `dom.js` drží všetky odkazy do DOM, takže render
funkcie nikdy nevolajú `querySelector` samy. `svg.js` skladá SVG z modelu a nič nepočíta.
`memo.js` drží tri pomôcky, vďaka ktorým render zapisuje do DOM len to, čo sa naozaj
zmenilo (viď „Nezapisuj, čo sa nezmenilo“ nižšie). `swipe.js` prekladá ťahanie prstom na
susednú kartu – rozhodne len, čo je na rade, a zmenu urobí `setState` ako pri kliku na
navigáciu. Čo si ťahanie nechá pre seba, nie je zoznam výnimiek, ale pravidlo: keď sa
najbližší vnútorný pás pod prstom ešte má kam posunúť tým smerom, patrí gesto jemu.
Menovaný je jediný prvok – úchytka bežca na páse dňa, ktorá sa ťahá a neposúva.
`history.js` prekladá tlačidlo Späť na krok späť v appke: každý krok navigácie (karta,
detail dňa) pridá `pushState` položku do histórie prehliadača a `popstate` ju vráti tou
istou cestou ako klik – jediným `setState`. Adresa sa pritom nemení; položka histórie je
len značka s krokom navigácie, takže odkaz na appku ostáva jeden.

Prechod medzi kartami je iba CSS: `panelChange` v `state.js` dopočíta k novej karte aj smer
(`panelDir`), `renderPanels` ho vyloží na `#page[data-dir]` a zvyšok je animácia `panel-in-*`
v `style.css`. Spúšťa sa sama tým, že karta prejde z `display: none` do zobrazenia, takže ju
nič nereštartuje a JS o nej nevie. Posun je malý (24 px) a `.page` má `overflow-x: clip`,
aby posunutá karta nešla poscrollovať do strany; stráži to e2e test, ktorý meria pretečenie
počas celého prechodu, nie až po ňom.

Medzi vstupmi stavu je aj `chartSizes` – skutočné rozmery plátien grafov v pixeloch.
Napĺňa ich `ResizeObserver` v `interactions.js` a render z nich cez `fillDims` postaví
plátno presne na kartu. Rozmer teda prichádza tou istou cestou ako každý iný vstup
(udalosť → `setState` → `render`), takže render funkcie nemusia nič merať a ostávajú
čisté.

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
- **Nezapisuj, čo sa nezmenilo.** Zápis do DOM označí prvok za špinavý aj vtedy, keď doň
  zapíšeš to isté, čo tam už je. Účet nepríde hneď – príde, keď si appka najbližšie vypýta
  rozmery, lebo vtedy musí prehliadač dopočítať layout. Pri ťahaní bežca po páse dňa tak
  jeden zbytočný zápis zdražel každý ďalší pohyb prsta. `memo.js` si preto pamätá, čo sám
  naposledy zapísal, a pás dňa, chipy spotrebičov, klony pageru aj celá karta Dnes-Zajtra sa
  prekresľujú len pri zmene vlastných vstupov. Namerané: 1,675 → 0,675 ms na pohyb na
  mobilnej šírke, 2,817 → 0,892 ms na desktope.
- **Plátno grafu sa rovná karte.** Grafy sa nekreslia na pevné plátno, ktoré potom CSS
  natiahne, ale rovno na skutočný rozmer karty (`fillDims`). Naťahovanie skresľovalo
  popisky a pri nízkej karte kreslilo do zápornej plochy; opačná voľba (zachovať pomer
  strán) zase nechávala v karte prázdne miesto.

## Vedomé odchýlky od pôvodnej appky

- **Bezoblačný strop pri teplote danej hodiny.** Pôvodná appka počítala strop pri 25 °C,
  kým predpoveď pri skutočnej teplote. V chladný jasný deň preto „využitie“ vychádzalo nad
  100 %. Tu majú obe rovnakú teplotu, takže pomer vyjadruje čistú stratu oblačnosťou.
- **Dáta sa nekomitujú do repozitára.** Pôvodná appka ukladala JSON do gitu každých päť
  minút cez GitHub Actions. Teraz sú v KV.
- **Tarifné okná sú dáta, nie HTML.** Pôvodne boli v `data-` atribútoch skrytého zoznamu,
  teraz v `config.js`, odkiaľ ich číta appka aj testy.

## Karta 7 dní na mobile

Na telefóne mala karta štyri grafy a tabuľku pod sebou – pätnásť obrazoviek scrollovania,
kým sa človek dostal k tomu, čo ho zaujímalo. Je preto rozdelená na dve obrazovky:

- **Prehľad dní** – tri kartičky (Dnes, Zajtra, 7 dní spolu), tabuľka a správa
  „Najsilnejší deň“. Zmestí sa takmer celá na jednu obrazovku.
- **Detail dňa** – otvorí ho klik na riadok v tabuľke: denná výroba, priebeh výroby
  a mapa výroby so zvýrazneným dňom, plus hlavička so šípkou späť.

Rozhoduje o tom jediné pole v stave (`weekDetail`), prepínajú sa len triedy `.hidden` –
žiadny presun prvkov v DOM. Poradie na detaile robí jedno pravidlo `order` v CSS, lebo
mapa výroby je v HTML prvá, ale na detaile má ísť posledná.

Od 768 px je detail vypnutý: tam je na celú kartu miesto naraz a klik na deň ho, ako
doteraz, len vyberie vo všetkých grafoch. Rozhoduje o tom podmienka `!state.wide`
v `renderSedemdni`, a `wide` je `(min-width: 768px)` – nie desktopových 1024 px. Pravidlá
poradia blokov žijú v `@media (max-width: 1023px)`, ale to je iná hranica a iná vec:
riadia `order`, nie to, či detail vôbec existuje.

Z tabuľky zmizol stĺpec „Oblačnosť“ – ten istý údaj hovoril aj stĺpec „Obloha“ a tabuľka
sa kvôli nemu musela na telefóne posúvať do strán, takže šípku do detailu na konci riadku
nebolo vidno.

## Rozloženie na desktope

Od 1024 px sa stránka správa ako obrazovka, nie ako dokument: `body` nescrolluje a karta
vyplní výšku okna. Grafy sa tak natiahnu na veľkom monitore a stlačia na nízkom notebooku.

Meranie pred tou zmenou ukázalo, že problém bol užší, než sa zdalo: karty Terazky
a Zdieľať sa zmestili už predtým (na 1920 × 1080 im ostávalo 347 px prázdneho miesta,
lebo mali pevnú výšku), pretekala len karta 7 dní, a to o 97 až 409 px podľa výšky okna.

Na karte 7 dní dostala tabuľka vlastný stĺpec cez obe rady mriežky. Na sedem riadkov
potrebuje 315 px výšky a 385 px šírky – toľko jej celá výška mriežky dá aj na 768 px
vysokej obrazovke. Grafy sa stlačiť dajú, riadky tabuľky pod čitateľnosť nie, tak miesto
dostane to, čo ho naozaj potrebuje.

Čo v nízkom okne ustúpi: ciferník sa zmenší z 240 na 190 px (do 720 px výšky) a nad grafom
stĺpcov zmizne riadok so súčtami (do 900 px výšky) – hovorí to isté, čo kartička „7 dní
spolu“ nad ním. Plátno grafu nikdy neklesne pod 96 px; pod tým by bolo nižšie než jeho
vlastné okraje.

## Pozor na kaskádu v CSS

Utilita `.hidden` ako jediná v `style.css` používa `!important`. Predtým stála len na konci
súboru a spoliehala sa na poradie, lenže poradie rozhoduje iba pri rovnakej špecificite:
pätnásť pravidiel s `display` ju prebíjalo a dve z nich sa naozaj prejavili – legenda grafu
ohlasovala krivku, ktorá sa nekreslila. Podrobnosti a pravidlo sú v `CLAUDE.md`; stráži to
e2e test, ktorý prejde všetky prvky vo všetkých kartách.

## Testovanie

| Vrstva            | Čím                                                                       |
| ----------------- | ------------------------------------------------------------------------- |
| Doména            | `node --test`, pokrytie `shared/` aspoň 90 % riadkov                      |
| Výstup predpovede | golden súbor `test/golden/forecast.json`                                  |
| Kontrakt dát      | `schema.js` proti výstupu parsera a predpovede                            |
| Worker            | cron a endpoint proti KV v pamäti a podvrhnutému `fetch`                  |
| Appka             | Playwright: štyri karty, interakcie, chyby v konzole, prístupnosť cez axe |
| Kaskáda CSS       | `.hidden` sa skúša na každom prvku vo všetkých kartách                    |
| Rozloženie        | na 1366 × 768 nesmie žiadna karta pretekať a tabuľka ukáže všetkých 7 dní |

E2E testy nepoužívajú vlastné očakávané reťazce – volajú tú istú funkciu ako appka a
porovnávajú ju s DOM. Test tak nezlyhá pri zmene textu, ale zlyhá, keď sa appka rozíde
s modelom.

## Vzťah k pôvodnej appke

Pôvodná appka _Kedy zapínať spotrebiče_ beží ďalej a má vlastný Cloudflare Worker
`pv-proxy`, ktorý číta ten istý kiosk. Preto zostávajú v `config.js` aj `LEGACY_SOURCES`:
keď nový Worker vypadne, appka prečíta dáta odtiaľ. Kým starý systém beží, je to poistka
zadarmo. Ak sa raz pôvodná appka vypne, treba `LEGACY_SOURCES` odstrániť spolu s ňou —
inak by po nej ostala mŕtva závislosť.

## Známe obmedzenia

- Fixtures v `test/fixtures/` sú syntetické, vygenerované z bezoblačného modelu, nie
  stiahnuté zo živých zdrojov. Sú deterministické, čo je pre testy výhoda; nezachytia
  však zvláštnosti, ktoré skutočná odpoveď kiosku alebo Open-Meteo môže mať.
- `pv` a `forecast` sa obnovujú rôzne často (5 minút a hodina), takže `updatedAt` oboch
  častí sa bežne líši. `GET /status` preto posudzuje čerstvosť každej zvlášť.
- V grafe dennej výroby sa popisok hodnoty nad stĺpcom môže prekryť s čiarkovanou čiarou
  stropu jasnej oblohy, keď je deň blízko stropu (typicky 2 zo 7 dní). Nesúvisí to
  s veľkosťou plátna – je to tak na každej šírke.
