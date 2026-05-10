/**
 * Create a room-scoped logger.
 *
 * @param {string} roomTag         - display label for this room (e.g. "publik" or "privat:abc")
 * @param {() => string} getStateSummary - returns a one-line state string for log context
 * @returns {{ logInfo, logWarn, logEvent }}
 */
export function createRoomLogger(roomTag, getStateSummary) {
  function nowTime() {
    return new Date().toLocaleTimeString("sv-SE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function prefix(warn = false) {
    return `${warn ? "⚠ " : ""}${nowTime()}  [${roomTag}]`;
  }

  function logInfo(topic, message) {
    console.log(`${prefix()}  ${message}`);
  }

  function logWarn(topic, message) {
    console.warn(`${prefix(true)}  ${message}`);
  }

  function logEvent(event, details = {}) {
    if (event === "runtime_started") {
      const width = details.worldWidthMeters ?? details.worldSizeMeters ?? "?";
      const height =
        details.worldHeightMeters ?? details.worldSizeMeters ?? "?";
      logInfo(
        "runtime",
        `Rum startat – karta ${width}×${height} m, max ${details.maxPlayers} spelare, ${details.totalCharacters} karaktärer.`,
      );
      return;
    }
    if (event === "session_connected") {
      const ip = details.ip || "okänd IP";
      logInfo("anslutning", `Ny anslutning från ${ip}.`);
      return;
    }
    if (event === "session_disconnected") {
      const name = details.name || "Okänd";
      const reason = details.reason ? ` (${details.reason})` : "";
      logInfo("anslutning", `${name} kopplades bort${reason}.`);
      return;
    }
    if (event === "session_login") {
      logInfo("spelare", `${details.name} loggade in.`);
      return;
    }
    if (event === "countdown_start") {
      logInfo(
        "spel",
        `Nedräkning startad – ${details.seconds ?? "?"} sekunder kvar.`,
      );
      return;
    }
    if (event === "session_possess") {
      logInfo(
        "spel",
        `${details.name || "Okänd"} tog kontroll över karaktär #${details.characterId}.`,
      );
      return;
    }
    if (event === "attack") {
      const hits = details.victims ?? 0;
      if (hits === 0) {
        logInfo(
          "strid",
          `Karaktär #${details.attackerCharacterId} slog – missade.`,
        );
      } else {
        logInfo(
          "strid",
          `Karaktär #${details.attackerCharacterId} slog och träffade ${hits} karaktär${hits !== 1 ? "er" : ""}.`,
        );
      }
      return;
    }
    if (event === "player_eliminated") {
      logInfo("strid", `${details.name || "Okänd"} är utslagen.`);
      return;
    }
    if (event === "character_respawn") {
      logInfo("world", `Karaktär #${details.characterId} återuppstod.`);
      return;
    }
    if (event === "chat") {
      logInfo("chat", `${details.name || "Okänd"}: "${details.text || ""}"`);
      return;
    }
    if (event === "heartbeat_timeout") {
      logWarn(
        "anslutning",
        `Spelare tappade uppkopplingen (heartbeat timeout).`,
      );
      return;
    }
    if (event === "message_drop") {
      logWarn(
        "ratelimit",
        `Meddelande ignorerat – för hög sändningsfrekvens (${details.droppedTotal ?? 0} totalt).`,
      );
      return;
    }
    logInfo("game", `${event}.`);
  }

  return { logInfo, logWarn, logEvent };
}

/**
 * Create an invariant checker that logs violations at a throttled rate.
 *
 * @param {{
 *   characters: object[],
 *   sessions: Map,
 *   getActivePlayerCount: () => number,
 *   logWarn: (topic: string, message: string) => void,
 *   totalCharacters: number,
 *   maxPlayers: number,
 *   cooldownMs: number,
 * }} deps
 * @returns {{ checkInvariants: (now: number) => void }}
 */
export function createInvariantChecker({
  characters,
  sessions,
  getActivePlayerCount,
  logWarn,
  totalCharacters,
  maxPlayers,
  cooldownMs,
}) {
  const lastLogAt = new Map();

  function warnInvariant(key, now, details) {
    const last = lastLogAt.get(key) ?? 0;
    if (now - last < cooldownMs) return;
    lastLogAt.set(key, now);
    logWarn(`invariant:${key}`, details);
  }

  function checkInvariants(now) {
    if (characters.length !== totalCharacters) {
      warnInvariant(
        "character_count",
        now,
        `Fel antal karaktärer – förväntade ${totalCharacters}, hittade ${characters.length}.`,
      );
    }

    const alivePlayers = getActivePlayerCount();
    if (alivePlayers > maxPlayers) {
      warnInvariant(
        "max_players",
        now,
        `För många aktiva spelare – max är ${maxPlayers}, men ${alivePlayers} är aktiva.`,
      );
    }

    const ownerToChars = new Map();
    for (const c of characters) {
      if (!c.ownerSessionId) continue;
      const owned = ownerToChars.get(c.ownerSessionId) || [];
      owned.push(c.id);
      ownerToChars.set(c.ownerSessionId, owned);
      if (c.controllerType !== "PLAYER") {
        warnInvariant(
          "owner_controller_mismatch",
          now,
          `Karaktär #${c.id} har en ägare men är inte spelarstyrd (typ: ${c.controllerType}).`,
        );
      }
    }

    for (const [sessionId, ownedCharIds] of ownerToChars.entries()) {
      if (ownedCharIds.length > 1) {
        warnInvariant(
          "multi_char_owner",
          now,
          `En spelare äger flera karaktärer samtidigt: #${ownedCharIds.join(", #")}.`,
        );
      }

      const session = sessions.get(sessionId);
      const ownsCharacterWhileActive =
        session &&
        (session.state === "alive" || session.state === "countdown") &&
        session.characterId != null;
      if (!ownsCharacterWhileActive) {
        warnInvariant(
          "owner_without_alive_session",
          now,
          `Karaktär har en ägare men ingen aktiv spelsession kopplad.`,
        );
        continue;
      }

      if (!ownedCharIds.includes(session.characterId)) {
        warnInvariant(
          "session_character_mismatch",
          now,
          `En spelsession pekar på karaktär #${session.characterId} men äger [#${ownedCharIds.join(", #")}].`,
        );
      }
    }
  }

  return { checkInvariants };
}
