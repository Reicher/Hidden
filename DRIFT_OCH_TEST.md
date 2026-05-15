# Drift och Test

Den här filen samlar teknisk info som tidigare låg i README: miljövariabler, testkommandon, layout, debug och drift.

## Snabbstart

```bash
npm install
npm start
```

Öppna: `http://127.0.0.1:3000`  
Privata rum: `http://127.0.0.1:3000/<rumskod>`

## Projektstruktur

```text
server.js                 # Entrypoint (HTTP + WS runtime)
server/
  config.js               # Gameplay/layout-konfig + env
  gameRuntime.js          # Routing till rum + debug API + persisted settings
  roomRuntime.js          # Spelloop, sessions, combat, countdown, chat
  layoutFromPng.js        # PNG -> fixtures (shelves/coolers/freezers)
  debugStats.js           # Persistenta debug-metrics i logs/
  systemMetrics.js        # CPU/RAM-metrics
public/
  index.html              # Spel-UI
  app.js                  # Klientflöde (connect/lobby/spel)
  vendor/three.module.js  # Syncad från node_modules/three (lokal source of truth)
  client/
    scene.js              # Three.js renderer/scene/camera
    room.js               # Rumsgeometri + texturer
    avatars.js            # Avatarer + animationer
    network.js            # WebSocket-wrapper
  debug.html + debug.js   # Fristående debugvy
tests/
  *.js                    # Node + WebSocket + Playwright tester
```

Three.js hanteras lokalt: `node_modules/three/build/three.module.js` är källan och synkas till `public/vendor/three.js` via `npm run sync:three-local` (körs automatiskt vid `npm install`).

## itch.io-driftsättning

Spelet kan laddas upp på itch.io som ett statiskt HTML-spel. Klienten pekar mot Raspberry Pi-servern via `public/config.json`.

Bygg zip:
```bash
npm run zip:itch
```

Skapar `hidden-itch.zip` med `serverHost: "hidden-game.duckdns.org"` inbakat i `config.json`. Ladda upp den på [robin-reicher.itch.io/hidden](https://robin-reicher.itch.io/hidden).

Se till att servern startas med rätt `ALLOWED_ORIGINS` på Pi:n:
```
ALLOWED_ORIGINS=https://hidden-game.duckdns.org,https://robin-reicher.itch.io,https://html-classic.itch.zone
```

## Gameplay-inställningar (default)

- `totalCharacters = 20`
- `maxPlayers = 10`
- `minPlayersToStart = 2`
- `playerAttackCooldownSeconds = 2`
- `npcDownedRespawnSeconds = 8`
- Matchstart:
  - Alla redo => 10s nedräkning.
  - Minst `2/3` redo => 30s supermajority-timeout, därefter start.
- Vid död:
  - Spelarkontrollerad karaktär blir nere till rundan är slut.
  - AI-karaktär reser sig igen efter respawn-tid.

## Layoutsystem

- Layout laddas från `server/layouts/layout-50.png` eller `layout-30.png`.
- `WORLD_LAYOUT_ID` kan sättas till `layout-50` eller `layout-30`.
- PNG-regler:
  - transparent/vit = tom yta
  - svart = hyllor (raka 1-cell-tjocka segment, valfri längd)
  - blå nyanser = kyl
  - grön nyanser = frys

Regenerera layout-PNG:

```bash
npm run generate:layout
```

## Debug och drift

- Fristående debugvy: `http://127.0.0.1:3000/debug`
- API:
  - `GET /api/debug/stats`
  - `GET /api/debug/settings`
  - `POST /api/debug/settings`
- `DEBUG_VIEW_TOKEN` krävs för debug-endpoints.
- Persistenta filer i `logs/`:
  - `debug-events.log`
  - `debug-samples.jsonl`
  - `debug-state.json`
  - `server-settings.json` (aktiv layout + gameplay settings)

## Miljövariabler

- `HOST` (default `127.0.0.1`)
- `PORT` (default `3000`)
- `WORLD_LAYOUT_ID` (`layout-50` default)
- `TOTAL_CHARACTERS`
- `MAX_PLAYERS`
- `MIN_PLAYERS_TO_START`
- `NPC_DOWNED_RESPAWN_SECONDS`
- `PLAYER_ATTACK_COOLDOWN_SECONDS`
- `ALLOWED_ORIGINS` (CSV)
- `ALLOW_MISSING_ORIGIN` (`false` default)
- `DEBUG_VIEW_TOKEN`
- `HEARTBEAT_INTERVAL_MS`
- `IDLE_SESSION_TIMEOUT_MS`
- `MAX_MESSAGE_BYTES`
- `INPUT_UPDATE_MIN_MS`
- `ATTACK_MESSAGE_MIN_MS`
- `MESSAGE_WINDOW_MS`
- `MAX_MESSAGES_PER_WINDOW`
- `SPAM_DROP_WINDOW_MS`
- `SPAM_MAX_DROPS_PER_WINDOW`
- `INVARIANT_LOG_COOLDOWN_MS`

## Tester

Kör allt:

```bash
npm run test:all
```

Delmängder:

- `npm run test:smoke`
- `npm run test:supermajority-ready`
- `npm run test:private-rooms`
- `npm run test:browser`
- `npm run test:perf`
- `npm run test:perf:quick`
- `npm run test:combat`
- `npm run test:debug-stats`
- `npm run test:heartbeat`
- `npm run test:rate-limit`
- `npm run test:hardening`

Perf-test:

- `test:perf` kör browser-klient + bottar, mäter FPS/RTT/WebSocket-throughput på klienten samt tick/CPU på servern och skriver rapport till `logs/perf-baseline.json`.
- `test:perf:quick` är en snabb lokal katastrof-check med kortare mätfönster och mer toleranta trösklar.

Om browser-test saknar Chromium:

```bash
npx playwright install chromium
```

## Spelflöde och UI

### Spectatorläge

När en spelare besegras (karaktären faller ned) övergår sessionen automatiskt till `state = "spectating"`. Spelaren följer en slumpmässigt vald levande spelare och kan bläddra med piltangenterna (eller swipe-kontroller på mobil). HUD:en visar vem man följer och hur många åskådare det finns i rummet. Spectatorläget aktiveras enbart under en pågående match – inte i lobby.

### Chattregler

- Meddelanden normaliseras och trunkeras till **220 tecken** på servern.
- Upprepade identiska meddelanden i snabb följd blockeras (deduplicering).
- Chatthistorik per rum är begränsad till de senaste meddelandena (`CHAT_HISTORY_LIMIT`).
- Under aktiv match visas in-game-chatten som ett kompakt overlay med max **5 rader** (`GAME_CHAT_MAX_LINES`). Panelen kan öppnas för att se hela historiken.
- Hastighetsbegränsning via `MESSAGE_WINDOW_MS` / `MAX_MESSAGES_PER_WINDOW` och spam-skydd via `SPAM_DROP_WINDOW_MS` / `SPAM_MAX_DROPS_PER_WINDOW` (se miljövariabler ovan).

### Fullscreen

Connectskärmen har en **"Starta i helskärm"-kryssruta** som triggar `requestFullscreen()` vid matchstart. Inställningspanelen (kugghjulet) erbjuder även en **"Helskärmsläge"-toggle** under spelgång. Stödet detekteras automatiskt; på webbläsare utan fullscreen-API döljs kontrollerna.

### Nyhetsruta

På connectskärmen hämtas `/news.json` och visas i ett kort (version, datum, fritext). För produktion: uppdatera `public/news.json` med önskad text – fälten är `version`, `title`, `publishedAt` (ISO-datum eller fri sträng) och `notes`. Kortet döljs tyst om filen saknas eller returnerar fel.
