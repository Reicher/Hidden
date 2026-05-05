/**
 * Create a room-scoped logger.
 *
 * @param {string} roomTag         - display label for this room (e.g. "publik" or "privat:abc")
 * @param {() => string} getStateSummary - returns a one-line state string for log context
 * @returns {{ logInfo, logWarn, logEvent }}
 */
export function createRoomLogger(roomTag, getStateSummary) {
  function nowTime() {
    return new Date().toISOString().slice(11, 19);
  }

  function logInfo(topic, message) {
    console.log(`[${nowTime()}] [${topic}] [${roomTag}] ${message}`);
  }

  function logWarn(topic, message) {
    console.warn(`[${nowTime()}] [${topic}] [${roomTag}] ${message}`);
  }

  function logEvent(event, details = {}) {
    const sid = details.sessionId || "-";
    if (event === "runtime_started") {
      const width = details.worldWidthMeters ?? details.worldSizeMeters ?? "-";
      const height = details.worldHeightMeters ?? details.worldSizeMeters ?? "-";
      logInfo(
        "runtime",
        `start world=${width}x${height}m maxPlayers=${details.maxPlayers} chars=${details.totalCharacters}`
      );
      return;
    }
    if (event === "session_connected") {
      const ua = details.userAgent ? String(details.userAgent).slice(0, 68) : "-";
      logInfo("anslutning", `ny session sid=${sid} ip=${details.ip || "-"} origin=${details.origin || "-"} ua="${ua}" ${getStateSummary()}`);
      return;
    }
    if (event === "session_disconnected") {
      const code = details.code == null ? "-" : String(details.code);
      const name = details.name || "-";
      logInfo(
        "anslutning",
        `frankoppling sid=${sid} namn=${name} reason=${details.reason || "-"} code=${code} ${getStateSummary()}`
      );
      return;
    }
    if (event === "session_login") {
      logInfo("spelare", `${details.name} loggade in sid=${sid} ${getStateSummary()}`);
      return;
    }
    if (event === "countdown_start") {
      logInfo("spel", `nedrakning start sid=${sid} sek=${details.seconds ?? "-"}`);
      return;
    }
    if (event === "session_possess") {
      logInfo(
        "spel",
        `${details.name || "-"} tog karaktar ${details.characterId} sid=${sid} pos=(${details.x},${details.z}) yaw=${details.yaw}`
      );
      return;
    }
    if (event === "attack") {
      const victimList =
        Array.isArray(details.victimCharacterIds) && details.victimCharacterIds.length > 0
          ? details.victimCharacterIds.join(",")
          : "-";
      logInfo(
        "strid",
        `attack sid=${sid} char=${details.attackerCharacterId} traffar=${details.victims ?? 0} victimIds=${victimList}`
      );
      return;
    }
    if (event === "player_eliminated") {
      logInfo("strid", `${details.name || "-"} dog (char=${details.characterId}, sid=${sid})`);
      return;
    }
    if (event === "character_respawn") {
      logInfo("world", `respawn char=${details.characterId} pos=(${details.x},${details.z}) yaw=${details.yaw}`);
      return;
    }
    if (event === "chat") {
      logInfo("chat", `${details.name || "-"}: ${details.text || ""}`);
      return;
    }
    if (event === "heartbeat_timeout") {
      logWarn("anslutning", `heartbeat timeout sid=${sid}`);
      return;
    }
    if (event === "message_drop") {
      logWarn(
        "ratelimit",
        `drop sid=${sid} reason=${details.reason || "-"} total=${details.droppedTotal ?? 0} window=${details.droppedInWindow ?? 0}`
      );
      return;
    }
    logInfo("game", `${event} ${getStateSummary()}`);
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
  cooldownMs
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
        `Expected ${totalCharacters} characters, got ${characters.length}.`
      );
    }

    const alivePlayers = getActivePlayerCount();
    if (alivePlayers > maxPlayers) {
      warnInvariant(
        "max_players",
        now,
        `Expected at most ${maxPlayers} alive players, got ${alivePlayers}.`
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
          `Character ${c.id} has owner ${c.ownerSessionId} but controllerType=${c.controllerType}.`
        );
      }
    }

    for (const [sessionId, ownedCharIds] of ownerToChars.entries()) {
      if (ownedCharIds.length > 1) {
        warnInvariant(
          "multi_char_owner",
          now,
          `Session ${sessionId} owns multiple characters: ${ownedCharIds.join(", ")}.`
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
          `Character owner ${sessionId} missing valid active session.`
        );
        continue;
      }

      if (!ownedCharIds.includes(session.characterId)) {
        warnInvariant(
          "session_character_mismatch",
          now,
          `Session ${sessionId} points to character ${session.characterId} but owns [${ownedCharIds.join(", ")}].`
        );
      }
    }
  }

  return { checkInvariants };
}
