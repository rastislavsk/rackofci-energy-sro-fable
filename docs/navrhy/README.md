# Návrhy: umiestnenie náhľadu času (karta Spotrebiče)

Zmrazené snímky klikacích návrhov k jednej téme — kam presunúť bublinu s náhľadom času,
ktorá dnes visí nad pásom dňa ako dve bubliny (`#preview-banner` v `index.html`,
`.preview-banner` v `style.css`).

**Sú to samostatné súbory, nie časť appky.** Nič z nich neimportuje `shared/` ani `web/`;
majú vlastnú kópiu farieb a rozmerov, aby sa dali otvoriť samostatne a aby ich zmena nikdy
nepohla appkou. Keď sa niektorý návrh nakóduje, tieto súbory ostávajú tak, ako sú —
dokumentujú, ako sa rozhodovalo, nie ako appka vyzerá dnes.

Otvoriť sa dajú priamo dvojklikom, alebo cez `npm run serve` na
`http://localhost:8080/docs/navrhy/`.

## Čo je čo

| Súbor                          | Téma                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `nahlad-casu-umiestnenie.html` | Kam s bublinou: dnešný stav vs. tri umiestnenia (vnútri kruhu, na prstenci, vedľa kruhu) |
| `nahlad-casu-variant-b.html`   | Rozpracovanie zvoleného variantu B: prívesok, zárez, obežnica                            |

## Prečo je to v repozitári

Návrhy vznikli ako artifacty na claude.ai. Tie sa dajú prepísať a nie sú viazané na commit,
takže tu je ich kópia — verzionovaná spolu s kódom, ktorého sa týkajú.

## Dôležité čísla (namerané v mierke telefónu 375 × 518 px)

Dnešné dve bubliny stoja pás dňa **40 px** výšky: 24 px je nafúknutie koridoru, kým je banner
vidno (pravidlá `:has()` v `style.css`), zvyšok je trvalá rezerva v `margin-bottom` karty
`.verdict`. Pás dňa tak dostane 45 px namiesto 85 px. Všetky tri umiestnenia tých 40 px vracajú
v plnej výške — líšia sa len vzhľadom, nie úsporou miesta.
