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
susednú kartu – a v detaile dňa na susedný deň, lebo detail je podobrazovka karty a gesto ju
neopúšťa – rozhodne len, čo je na rade, a zmenu urobí `setState` ako pri kliku na
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

Rovnakou cestou ide aj farba pozadia. `renderHeader` zapíše tarifné okno, v ktorom sme
práve teraz, ako `data-tier` na `<html>` a tým to preň končí; zvyšok je CSS, ktoré si podľa
toho prepne `--tint-rgb` a z neho poskladá `--bg-page`. Atribút sedí na `<html>`, nie na
`<body>`, lebo `var()` vo vnútri custom property sa dosadzuje tam, kde je property zapísaná
– `--bg-page` z `:root` by zmenu na `<body>` už nevidelo. Pozadie drží tarifu (`hero.tier`),
nie „smart" farbu stavovej bodky (`hero.accent`, tá počíta aj so slnkom), takže hovorí to
isté, čo segment pod bežcom na dennom prstenci: či je elektrina v tej hodine lacná. Pri
náhľade iného času ide pozadie s bežcom, kým bodka ostáva o stave teraz – preto sa model
ráta dvakrát, ale len keď náhľad naozaj beží. Že sa farba nerozíde s modelom, strážia e2e
testy: štyri pevné časy pokryjú všetky tri farby a ťuknutie na prstenec overí, že sa farba
mení aj s bežcom a po zrušení náhľadu sa vráti.

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
  rozmery, lebo vtedy musí prehliadač dopočítať layout. Pri ťahaní jazdca po dennom prstenci
  tak jeden zbytočný zápis zdražel každý ďalší pohyb prsta. `memo.js` si preto pamätá, čo sám
  naposledy zapísal, a denný prstenec aj chipy spotrebičov sa prekresľujú len
  pri zmene vlastných vstupov. Namerané: 1,675 → 0,675 ms na pohyb na mobilnej šírke,
  2,817 → 0,892 ms na desktope.
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

- **Prehľad dní** – rebríček: bublina so súčtom za týždeň a pod ňou sedem riadkov
  s pásikmi. Zmestí sa celý na jednu obrazovku.
- **Detail dňa** – otvorí ho klik na riadok rebríčka: priebeh výroby toho dňa, čísla o ňom,
  jeho jediný riadok z heatmapy a správa o tom dni.
- **Detail týždňa** – otvorí ho klik na bublinu „Spolu za 7 dní“: denná výroba, heatmapa
  hodina × deň a správa „Najsilnejší deň“.

Správa je jeden prvok pre obe obrazovky: v detaile dňa v ňom stojí `dayDetailMessage`,
v detaile týždňa `weekMessage`. Text v detaile dňa deň naschvál nepomenúva – hovorí to
hlavička nad ním, a inak by sa „zajtra“ ukázalo aj pri štvrtku.

V **prehľade dní** je tá istá správa (`weekMessage`) navyše, a len vtedy, keď na ňu ostalo
miesto: prehľad má byť jedna obrazovka bez scrollovania, takže správa je bonus, nie obsah.
Rozhoduje pole `tall` v stave – viditeľná výška okna oproti `WEEK_MSG_MIN_H` (860 px).
Namerané v Chromiu pri predvolenom písme: samotný prehľad sa zmestí od 710 px, so správou
potrebuje 835 px a pri najdlhšej možnej správe na 320 px širokom displeji 854 px.

Výšku dáva `visualViewport`, nie `innerHeight` ani `@media (min-height: …)`: v mobilnom
prehliadači ukrojí adresný riadok 60 – 90 px, ktoré tie dve o sebe nevedia, a správa by sa
ukázala do priestoru, ktorý vidieť nie je. Slučka z toho nevznikne – vstupom je okno, nie
obsah, takže ukázanie správy výšku okna nezmení.

Obe obrazovky majú hlavičku so šípkou späť. Rozhoduje o tom jediné pole v stave
(`weekDetail`: `'day' | 'week' | null`), prepínajú sa len triedy `.hidden` – žiadny presun
prvkov v DOM. Poradie na detaile robí jedno pravidlo `order` v CSS, lebo heatmapa je
v HTML prvá, ale na oboch detailoch má ísť posledná.

Heatmapa je v detaile dňa tá istá funkcia (`weekHeatModel`) s prepínačom „jeden deň“:
mierka farieb ostáva z celého týždňa, inak by aj najslabší deň vyzeral sám o sebe ako plný.

Tie isté tri farby nesie aj výroba po dňoch – pásik a číslo v rebríčku, stĺpec a číslo nad
ním v Dennej výrobe, číslo v stĺpci Výroba v tabuľke. Pásmo počíta jediná funkcia
`weekDayTiers` v `shared/chart-model.js`: podiel z najsilnejšieho **dňa** v týždni s tými
istými hranicami (1/3, 2/3) ako bunky heatmapy, takže obe grafiky na jednej obrazovke
merajú rovnako. Deň bez výroby pásmo nemá (`null`) a ostáva nefarbený – inak by týždeň bez
jedinej kWh vyšiel celý červený.

Sýtosť sa z heatmapy nepreberá. Tam je jediným nosičom veľkosti, pri dňoch je ňou dĺžka
pásika a výška stĺpca – slabý deň by bol krátky _aj_ vyblednutý a prakticky by zmizol.
Vybraný deň sa preto v grafe neodlišuje inou farbou, ale plnou sýtosťou (`.bar.sel`).
Legenda farieb je jedna, pod heatmapou.

Od 768 px je detail vypnutý: tam je na celú kartu miesto naraz a klik na deň ho, ako
doteraz, len vyberie vo všetkých grafoch. Rozhoduje o tom podmienka `!state.wide`
v `renderSedemdni`, a `wide` je `(min-width: 768px)` – nie desktopových 1024 px. Pravidlá
poradia blokov žijú v `@media (max-width: 1023px)`, ale to je iná hranica a iná vec:
riadia `order`, nie to, či detail vôbec existuje.

### Prečo rebríček namiesto bublín a tabuľky

Prehľad mal na telefóne tri bubliny a päťstĺpcovú tabuľku, dokopy asi štyridsať čísel. Väčšina
z nich (využitie v %, špička v kW a jej hodina) je pritom to isté, čo je o ťuknutie ďalej
v detaile dňa – a tabuľka sa aj po zoškrtaní stĺpcov na telefóne posúvala do strán, takže
prvý vodorovný ťah posunul ju a kartu prelistoval až ten druhý.

Rebríček odpovedá na to, na čo sa človek na prehľade pýta: koľko toho bude a ktorý deň je
najlepší. Dĺžka pásika je výroba dňa voči najsilnejšiemu dňu v týždni (`weekListModel`
v `shared/chart-model.js`), takže sa dni porovnajú očami, bez čítania čísel. Škáluje sa
zámerne voči týždňu, nie voči stropu jasnej oblohy: otázka je „ktorý z týchto siedmich“,
nie „koľko ubrali mraky“ – to druhé hovorí využitie v detaile dňa. Znamená to, že aj
v škaredom týždni má najsilnejší deň plný pásik; číslo vedľa neho to opravuje.

Výroba je v rebríčku v celých kWh: pri predpovedi na týždeň je desatina falošná presnosť
a v riadku zaberá miesto, ktoré patrí pásiku. Rebríček sa navyše vojde do každej šírky
(pásik je pružný stĺpec mriežky), takže na mobile nezostal ani jeden vodorovne posuvný pás
a ťah do strán prelistuje kartu hneď.

Bubliny a tabuľka žijú ďalej, len od 768 px vyššie – tam je na ne miesto a majiteľ, ktorý
ladí systém, má v tabuľke všetky stĺpce pohromade. Vidno vždy práve jednu podobu prehľadu;
rozhoduje o tom `renderView` v `web/render/sedemdni.js`.

Z tabuľky ešte predtým zmizol stĺpec „Oblačnosť“ – ten istý údaj hovoril aj stĺpec „Obloha“.

## Rozloženie na desktope

Od 1024 px sa stránka správa ako obrazovka, nie ako dokument: `body` nescrolluje a karta
vyplní výšku okna. Grafy sa tak natiahnu na veľkom monitore a stlačia na nízkom notebooku.

Od 768 px mala stránka mriežku dvoch rovnakých stĺpcov: vľavo Terazky, vpravo Dnes-Zajtra
(tá preto na desktope nemala vlastnú položku v navigácii). Keď karta Dnes-Zajtra zanikla,
mriežka zanikla s ňou a Terazky idú cez celú šírku stránky. Stránka je tu položkou zvislého
flexu a vystredenie cez `margin: 0 auto` jej vypína naťahovanie na šírku rodiča, takže
potrebuje `width: 100%`: karta Terazky vlastnú šírku nemá (ciferník sa počíta z percent,
odporúčanie je `container-type: inline-size`, teda so size containmentom v osi x), takže bez
toho by sa stránka scvrkla na svoje okraje. Stráži to e2e test „Spotrebiče majú celú šírku
stránky“.

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
| Appka             | Playwright: tri karty, interakcie, chyby v konzole, prístupnosť cez axe   |
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
