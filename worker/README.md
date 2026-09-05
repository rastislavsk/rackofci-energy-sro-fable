# Worker `rackofci-energy`

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

Chýbajúca časť je `null`, nie chyba. Hlavičky: CORS pre všetkých, `cache-control: max-age=60`
a `x-data-stale`, keď je predpoveď staršia než tri hodiny. Iné cesty vracajú 404, iné metódy 405.

## Nasadenie (jednorazovo)

1. **KV namespace**

   ```bash
   cd worker
   npx wrangler kv namespace create PV_DATA
   ```

   Vrátené `id` zapíš do `wrangler.toml` namiesto `REPLACE_WITH_KV_NAMESPACE_ID`.

2. **Tajomstvo s kiosk odkazom** (verejný odkaz na kiosk elektrárne, v kóde nie je)

   ```bash
   npx wrangler secret put KIOSK_URL
   ```

3. **Git integrácia**: Cloudflare dashboard → Workers & Pages → `rackofci-energy` →
   Settings → Build → Connect to Git, root directory `worker/`. Po každom pushnutí do
   `main` sa Worker nasadí sám.

   Ak build na pull requestoch zlyhá na chýbajúcom `wrangler.toml`, nastav
   **Version command** na `npx wrangler versions upload --config worker/wrangler.toml`.
   Root directory sa na tento príkaz neaplikuje.

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
