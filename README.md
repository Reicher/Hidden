# Hidden

Hidden är ett snabbt multiplayer-spel i webbläsaren där en match utspelar sig i ett stängt butiksliknande rum med hyllor, kylar och frysar som hinder.

Målet är enkelt: överlev rundan och bli sista karaktären som står upp.

## Så går spelet till

1. Gå in i ett rum och markera dig som redo.
2. Matchen startar när alla är redo, eller efter supermajority-timeout.
3. Spelare och AI-karaktärer slåss i samma arena.
4. Utslagna spelarkaraktärer ligger nere tills rundan är slut.
5. Sista kvarvarande vinnare tar rundan, sedan tillbaka till lobby.

Det här gör Hidden till en snabb loop av: lobby -> intensiv runda -> tillbaka till lobby -> ny runda.

## Kör igång

```bash
npm install
npm start
```

Öppna spelet på `http://127.0.0.1:3000`  
Privata rum: `http://127.0.0.1:3000/<rumskod>`

Teknisk info (miljövariabler, tester, debug, layout och drift) finns i `DRIFT_OCH_TEST.md`.
