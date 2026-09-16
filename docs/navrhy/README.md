# Návrhy

Zmrazené snímky klikacích návrhov k témam, o ktorých sa rozhodovalo.

**Sú to samostatné súbory, nie časť appky.** Nič z nich neimportuje `shared/` ani `web/`;
majú vlastnú kópiu farieb a rozmerov, aby sa dali otvoriť samostatne a aby ich zmena nikdy
nepohla appkou. Keď sa niektorý návrh nakóduje, tieto súbory ostávajú tak, ako sú —
dokumentujú, ako sa rozhodovalo, nie ako appka vyzerá dnes.

Otvoriť sa dajú priamo dvojklikom, alebo cez `npm run serve` na
`http://localhost:8080/docs/navrhy/`.

## Čo je čo

| Súbor                          | Téma                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `nahlad-casu-umiestnenie.html` | Karta Spotrebiče — kam s bublinou náhľadu času: dnešný stav vs. tri umiestnenia                           |
| `nahlad-casu-variant-b.html`   | Rozpracovanie zvoleného variantu B: prívesok, zárez, obežnica                                             |
| `7dni-mobil.html`              | Karta 7 dní na mobile — dnešný stav vs. tri návrhy menej detailného prehľadu (A, B, C)                    |
| `7dni-bez-hintu.html`          | Karta 7 dní na mobile — čo s miestom po pätke „Ťuknite na deň“ (A: bublina, B: pätka)                     |
| `7dni-farby-dni.html`          | Karta 7 dní — akou logikou zafarbiť výrobu po dňoch (A: z najlepšieho dňa, B: z jasnej oblohy, C: sýtosť) |

## Prečo je to v repozitári

Návrhy vznikli ako artifacty na claude.ai. Tie sa dajú prepísať a nie sú viazané na commit,
takže tu je ich kópia — verzionovaná spolu s kódom, ktorého sa týkajú.

## Náhľad času: dôležité čísla (namerané v mierke telefónu 375 × 518 px)

Dnešné dve bubliny stoja pás dňa **40 px** výšky: 24 px je nafúknutie koridoru, kým je banner
vidno (pravidlá `:has()` v `style.css`), zvyšok je trvalá rezerva v `margin-bottom` karty
`.verdict`. Pás dňa tak dostane 45 px namiesto 85 px. Všetky tri umiestnenia tých 40 px vracajú
v plnej výške — líšia sa len vzhľadom, nie úsporou miesta.
