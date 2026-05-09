export const SPECTATOR_CYCLE_NEXT = 1;
export const SPECTATOR_CYCLE_PREV = -1;

/**
 * Create the spectator management system for a room.
 *
 * @param {{
 *   sessions: Map,
 *   characters: object[],
 *   isCharacterDowned: (character: object, now: number) => boolean,
 *   getSortedActiveSessions: () => object[],
 *   releaseOwnedCharacter: (sessionId: string) => void,
 *   getActiveMatchStartedAt: () => number,
 * }} deps
 */
export function createSpectatorSystem({
  sessions,
  characters,
  isCharacterDowned,
  getSortedActiveSessions,
  releaseOwnedCharacter,
  getActiveMatchStartedAt
}) {
  /** Returns all alive, non-downed players sorted by scoreboard order. */
  function aliveSpectatorCandidates(now) {
    return getSortedActiveSessions()
      .filter((session) => session.state === "alive" && session.characterId != null)
      .filter((session) => {
        const character = characters[session.characterId];
        return Boolean(character) && !isCharacterDowned(character, now);
      })
      .map((session) => ({
        sessionId: session.id,
        name: session.name,
        characterId: session.characterId
      }));
  }

  function clearSpectatorTarget(session) {
    if (!session) return;
    session.spectatingCharacterId = null;
    session.spectatingSessionId = null;
  }

  function setSpectatorTarget(session, candidate) {
    if (!session || !candidate) return false;
    session.spectatingCharacterId = candidate.characterId;
    session.spectatingSessionId = candidate.sessionId;
    return true;
  }

  function setSessionSpectating(session, now, { randomTarget = true } = {}) {
    if (!session || !session.authenticated) return false;
    if (getActiveMatchStartedAt() <= 0) return false;
    if (session.characterId != null) {
      const ownedCharacter = characters[session.characterId];
      if (ownedCharacter?.ownerSessionId === session.id) releaseOwnedCharacter(session.id);
    }
    session.state = "spectating";
    session.ready = false;
    session.readyAt = 0;
    session.characterId = null;
    session.input.attackRequested = false;
    session.eliminatedByName = null;
    if (!randomTarget) return true;
    const candidates = aliveSpectatorCandidates(now);
    if (candidates.length === 0) {
      clearSpectatorTarget(session);
      return true;
    }
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    return setSpectatorTarget(session, picked);
  }

  function cycleSpectatorTarget(session, direction, now) {
    if (!session || session.state !== "spectating") return false;
    const candidates = aliveSpectatorCandidates(now);
    if (candidates.length === 0) {
      clearSpectatorTarget(session);
      return false;
    }
    const dir = direction === SPECTATOR_CYCLE_PREV ? SPECTATOR_CYCLE_PREV : SPECTATOR_CYCLE_NEXT;
    const currentIndex = candidates.findIndex(
      (candidate) => candidate.characterId === session.spectatingCharacterId
    );
    if (currentIndex < 0) {
      const fallbackIndex = dir === SPECTATOR_CYCLE_PREV ? candidates.length - 1 : 0;
      return setSpectatorTarget(session, candidates[fallbackIndex]);
    }
    const nextIndex = (currentIndex + dir + candidates.length) % candidates.length;
    return setSpectatorTarget(session, candidates[nextIndex]);
  }

  function maintainSpectatorTarget(session, now) {
    if (!session || session.state !== "spectating") return;
    const isOwnDownedTarget = (targetedSession, targetedCharacter) =>
      targetedSession?.id === session.id &&
      Boolean(targetedCharacter) &&
      isCharacterDowned(targetedCharacter, now);
    const candidates = aliveSpectatorCandidates(now);
    if (candidates.length === 0) {
      const targetedSession = session.spectatingSessionId
        ? sessions.get(session.spectatingSessionId)
        : null;
      const targetedCharacter =
        session.spectatingCharacterId != null ? characters[session.spectatingCharacterId] : null;
      if (
        targetedSession &&
        targetedCharacter &&
        (targetedSession.state === "downed" ||
          targetedSession.state === "won" ||
          isOwnDownedTarget(targetedSession, targetedCharacter))
      ) {
        return;
      }
      clearSpectatorTarget(session);
      return;
    }
    if (session.spectatingCharacterId == null) {
      setSpectatorTarget(session, candidates[0]);
      return;
    }
    if (candidates.some((candidate) => candidate.characterId === session.spectatingCharacterId)) return;

    const targetedSession = session.spectatingSessionId
      ? sessions.get(session.spectatingSessionId)
      : null;
    const targetedCharacter = characters[session.spectatingCharacterId];
    const targetedStillVisible =
      targetedSession &&
      targetedCharacter &&
      (targetedSession.state === "downed" ||
        targetedSession.state === "won" ||
        isOwnDownedTarget(targetedSession, targetedCharacter));
    if (targetedStillVisible) return;

    setSpectatorTarget(session, candidates[0]);
  }

  return {
    aliveSpectatorCandidates,
    clearSpectatorTarget,
    setSpectatorTarget,
    setSessionSpectating,
    cycleSpectatorTarget,
    maintainSpectatorTarget
  };
}
