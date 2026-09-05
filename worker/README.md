# Worker `rackofci-energy-sro-fable`

Jediný zdroj dát pre appku. Cron každých päť minút stiahne kiosk Huawei FusionSolar a raz
za hodinu prepočíta predpoveď z Open-Meteo. Obe uloží do KV. `GET /` ich vráti spolu.

Prečo Worker a nie GitHub Actions: naplánované behy v Actions sú pri päťminútovom intervale
nespoľahlivé a každý beh by musel commitnúť dáta do repozitára. Cron v Cloudflare beží
načas a KV nezanáša históriu.

## Endpoint

`GET /` vráti:

```json
{ "pv": { "realTimePowerKw": 6.41, "...": "..." }, "forecast": { "days": [] }, "servedAt": "2026-09-05T11:00:00.000Z" }
```

Chýbajúca časť je `null`, nie chyba. Pole `status` hovorí, ako dopadol posledný beh cronu,
takže pri chýbajúcich dátach netreba hádať medzi výpadkom zdroja a zlým nastavením:

```json
{ "status": { "pv": { "ok": false, "at": "…", "error": "KIOSK_URL secret nie je nastavený" }, "forecast": { "ok": true, "at": "…" } } }
```

Hlavičky: CORS pre všetkých, `cache-control: max-age=60` a `x-data-stale`, keď je predpoveď
staršia než tri hodiny. Iné cesty vracajú 404, iné metódy 405.

### `GET /status`

Krátke zhrnutie na kontrolu jedným pohľadom, bez celej predpovede. Odpoveď je odsadená
a bez cache, takže sa dá otvoriť priamo v prehliadači:

```json
{
  "ok": false,
  "pv": {
    "ok": false,
    "updatedAt": null,
    "ageMinutes": null,
    "lastRun": { "ok": false, "at": "…", "error": "KIOSK_URL secret nie je nastavený" }
  },
  "forecast": { "ok": true, "updatedAt": "…", "ageMinutes": 5, "lastRun": { "ok": true, "at": "…" } },
  "servedAt": "…"
}
```

`ok` je `true`, len keď sú obe časti dát čerstvé: živý výkon do 20 minút, predpoveď do
troch hodín. `lastRun` hovorí, ako dopadol posledný beh cronu, aj keď v KV ešte leží
staršia použiteľná hodnota. Cesta vždy vracia 200, aj keď `ok` je `false` — je to hlásenie
o stave, nie brána, ktorá by mala padať.

Podrobnejšie hlásenia sú v logoch Workera (dashboard → Observability), ktoré sú zapnuté
vo `wrangler.toml`.

## Nasadenie (jednorazovo)

1. **KV namespace** — už existuje (`rackofci-energy-pv-data`) a jeho `id` je vyplnené vo
   `wrangler.toml`. Nové by sa vytvorilo takto:

   ```bash
   cd worker
   npx wrangler kv namespace create PV_DATA
   ```

   Vrátené `id` patrí do `wrangler.toml` pod binding `PV_DATA`.

2. **Tajomstvo s kiosk odkazom** (verejný odkaz na kiosk elektrárne, v kóde nie je).
   V dashboarde: Workers & Pages → `rackofci-energy-sro-fable` → Settings → Variables and Secrets →
   Add, názov `KIOSK_URL`, typ **Secret**. Alebo z príkazového riadku:

   ```bash
   npx wrangler secret put KIOSK_URL
   ```

3. **Git integrácia**: Cloudflare dashboard → Workers & Pages → `rackofci-energy-sro-fable` →
   Settings → Build → Connect to Git, root directory `worker/`. Po každom pushnutí do
   `main` sa Worker nasadí sám.

   Pozor, dva príkazy v tom istom nastavení sa správajú rozdielne:

   | Príkaz                              | Odkiaľ beží                           | Ako ho nastaviť                                              |
   | ----------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
   | **Deploy command** (vetva `main`)   | z Root directory, teda už z `worker/` | `npx wrangler deploy` — **bez** `--config`                   |
   | **Version command** (pull requesty) | z koreňa repozitára                   | `npx wrangler versions upload --config worker/wrangler.toml` |

   Pridať `--config worker/wrangler.toml` aj do Deploy command je častá chyba: cesta sa
   zdvojí na `worker/worker/wrangler.toml` a nasadenie zlyhá na
   `ENOENT: no such file or directory`. Prepínač patrí len do Version command.

4. **Cron** `*/5 * * * *` je v `wrangler.toml`, netreba ho klikať.

## Overenie a údržba

```bash
npm --prefix worker test                 # logika cronu a endpointu proti fixtures
cd worker && npx wrangler deploy --dry-run --outdir dist   # zbalí sa aj shared/
npx wrangler dev --test-scheduled        # potom: curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

Zdravý Worker vráti `pv.updatedAt` mladšie než pätnásť minút a `forecast.updatedAt`
mladšie než dve hodiny. Keď jeden zdroj vypadne, cron nechá v KV predchádzajúcu hodnotu
a appka podľa `updatedAt` ukáže, že dáta sú zastarané.
