# Hidden

Ett webbläsarbaserat multiplayer-spel med **en kontinuerligt pågående match**.

## Snabbstart

```bash
npm install
npm start
```

Öppna: `http://127.0.0.1:3000`

Privata rum: öppna `http://127.0.0.1:3000/<rumskod>` för ett separat rum som tas bort automatiskt när sista spelaren lämnar.

## Tester

- Kör alla tester: `npm run test:all`
- Browser-smoke (fångar klientfel i console): `npm run test:browser`
- Om browser-test saknar Chromium lokalt: `npx playwright install chromium`

## Spelregler

- Max **10 aktiva spelare** samtidigt.
- Världen innehåller alltid exakt **20 karaktärer**.
- Varje karaktär är antingen AI-styrd eller spelarkontrollerad.
- Vid anslutning startar en nedräkning: **"Startar spel om 3...2...1..."**.
- När nedräkningen är klar tar spelaren över en ledig AI-karaktär sömlöst (samma position/riktning).
- Om rummet är fullt visas tydligt fel i startvyn, med möjlighet att skapa nytt privat rum direkt.
- Attack: vänsterklick, träffar mål framför spelaren inom fast zon, cooldown **1 sekund**.
- När en karaktär dödas faller den ner bort från angriparen, ligger nere i 5 sekunder och reser sig sedan igen på samma plats.
- När en spelare dör förloras kontrollen och samma 3-sekunders startnedräkning körs igen.

## Kontroller

- `W A S D` = rörelse
- Mus = kamera (förstaperson)
- Vänster musknapp = attack
- Klicka i spelvyn för att låsa musen till spelet (förstapersonsstyrning). Tryck Esc för att släppa musen.

## Teknik

- Server: `Node.js` + `ws` (WebSocket, server-authoritative state)
- Klient: `Three.js` (rendering + enkel FPS-kontroll)

## Kartlayout Från PNG

- Kartan använder `public/assets/layout-50.png` som layoutkälla.
- Bilden måste vara exakt `50x50` pixlar (`1 pixel = 1 meter` i spelbar yta).
- Färglegend:
  - `transparent` (alpha `0`) = tom yta
  - `vit` (`255,255,255`) fungerar också som tom yta
  - `svart` (`0,0,0`) = hylla (rita **exakt 6 sammanhängande pixlar** i rak linje per hylla)
  - `blå` (`0,102,255`, även `0,0,255` och `0,128,255`) = kyl (1x1 meter footprint)
  - `grön` (`0,200,120`, även `0,255,0` och `0,180,0`) = frys (1x1 meter footprint, toppluckor)
- Hyllregler:
  - Hyllor delas alltid upp i fasta segment `1x6x2` meter.
  - En 12-pixels rak rad blir alltså två separata hyllsegment.
  - Tätt packade former (t.ex. `2x6`) tillåts och blir flera hyllsegment.
  - Om hyllpixlar inte kan delas upp exakt i 6-längdssegment (t.ex. `1x3`) stoppar servern vid uppstart med tydligt fel.
- Om bilden innehåller okända färger stoppar servern vid uppstart med fel som visar exempel-pixlar.
- Generera en startlayout igen med: `npm run generate:layout`.

## Debug-vy

- I lobbyn finns en knapp `Debug` som öppnar live-serverstatistik i klienten.
- Vyn visar bland annat:
  - hur många som är inne nu / spelar nu
  - unika namn och senaste inloggningar
  - per-rum statistik
  - CPU-last, CPU-temp (när tillgängligt) och RAM (host + Node-process)
  - senaste serverevents
  - graf över aktivitet över tid
- Servern exponerar datan via `GET /api/debug/stats`.
- Endpointen är avstängd tills `DEBUG_VIEW_TOKEN` är satt (annars returneras `503`).
- Persistenta loggar skrivs till:
  - `logs/debug-events.log` (läsbar eventlogg)
  - `logs/debug-samples.jsonl` (tidsserie för grafer)
  - `logs/debug-state.json` (persistenta totals, namn och per-rum-statistik mellan serverstarter)

## Miljövariabler

- `PORT` (default: `3000`)
- `ALLOWED_ORIGINS` (kommaseparerad lista; default är localhost/127.0.0.1 på aktuell `PORT`, både `http` och `https`)
- `ALLOW_MISSING_ORIGIN` (default: `false`)
- `DEBUG_VIEW_TOKEN` (default: tom; om satt kräver debug-vyn token)
- `SPAM_DROP_WINDOW_MS` (default: `1000`)
- `SPAM_MAX_DROPS_PER_WINDOW` (default: `40`)
- `HEARTBEAT_INTERVAL_MS` (default: `5000`)
- `IDLE_SESSION_TIMEOUT_MS` (default: `1800000`, dvs 30 min)

Exempel (produktion):

```bash
PORT=3000 \
ALLOWED_ORIGINS=https://hidden.example.com \
ALLOW_MISSING_ORIGIN=false \
SPAM_DROP_WINDOW_MS=1000 \
SPAM_MAX_DROPS_PER_WINDOW=40 \
npm start
```
