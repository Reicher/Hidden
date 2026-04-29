# Hidden

Ett webbläsarbaserat multiplayer-spel med **en kontinuerligt pågående match**.

## Snabbstart

```bash
npm install
npm start
```

Öppna: `http://127.0.0.1:3000`

## Spelregler

- Max **10 aktiva spelare** samtidigt.
- Världen innehåller alltid exakt **20 karaktärer**.
- Varje karaktär är antingen AI-styrd eller spelarkontrollerad.
- Vid anslutning startar en nedräkning: **"Startar spel om 3...2...1..."**.
- När nedräkningen är klar tar spelaren över en ledig AI-karaktär sömlöst (samma position/riktning).
- Om servern är full **eller om kö redan finns** visas: **"Spelet är fullt."** Sessionen ställs i kö direkt, tas bort ur kön vid disconnect, och får countdown först när plats reserverats.
- Attack: vänsterklick, träffar mål framför spelaren inom fast zon, cooldown **1 sekund**.
- När en karaktär tas bort respawnar den direkt som AI på slumpmässig position.
- När en spelare dör förloras kontrollen och samma 3-sekunders startnedräkning körs igen.

## Kontroller

- `W A S D` = rörelse
- Mus = kamera (förstaperson)
- Vänster musknapp = attack
- Klicka i spelvyn för att låsa musen till spelet (förstapersonsstyrning). Tryck Esc för att släppa musen.

## Teknik

- Server: `Node.js` + `ws` (WebSocket, server-authoritative state)
- Klient: `Three.js` (rendering + enkel FPS-kontroll)

## Miljövariabler

- `PORT` (default: `3000`)
- `ALLOWED_ORIGINS` (kommaseparerad lista; default är localhost/127.0.0.1 på aktuell `PORT`, både `http` och `https`)
- `ALLOW_MISSING_ORIGIN` (default: `false`)
- `SPAM_DROP_WINDOW_MS` (default: `1000`)
- `SPAM_MAX_DROPS_PER_WINDOW` (default: `40`)

Exempel (produktion):

```bash
PORT=3000 \
ALLOWED_ORIGINS=https://hidden.example.com \
ALLOW_MISSING_ORIGIN=false \
SPAM_DROP_WINDOW_MS=1000 \
SPAM_MAX_DROPS_PER_WINDOW=40 \
npm start
```
