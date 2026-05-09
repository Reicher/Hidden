/**
 * Pure UI updaters for lobby overlays.
 * All functions are side-effect-free with respect to app state – they only
 * read what they receive as arguments and write to DOM elements.
 */

/**
 * @param {{
 *   lobbyMatchStatusEl: Element|null,
 *   lobbyMatchStatusTitleEl: Element|null,
 *   lobbyStatusRowEl: Element|null,
 *   lobbyStatusTextEl: Element|null,
 *   lobbyPlayersMetaEl: Element|null,
 *   appMode: string,
 *   roomName: string,
 *   lobbyScoreboard: Array,
 *   lobbyMaxPlayers: number,
 *   currentMatch: {inProgress: boolean, elapsedMs: number},
 *   lobbyMinPlayersToStart: number,
 *   lobbyCountdownMsRemaining: number,
 *   sessionState: string,
 * }} opts
 */
export function updateLobbyMatchStatus({
  lobbyMatchStatusEl,
  lobbyMatchStatusTitleEl,
  lobbyStatusRowEl,
  lobbyStatusTextEl,
  lobbyPlayersMetaEl,
  appMode,
  roomName,
  lobbyScoreboard,
  lobbyMaxPlayers,
  currentMatch,
  lobbyMinPlayersToStart,
  lobbyCountdownMsRemaining,
  sessionState,
}) {
  if (
    !lobbyMatchStatusEl ||
    !lobbyMatchStatusTitleEl ||
    !lobbyStatusRowEl ||
    !lobbyStatusTextEl ||
    !lobbyPlayersMetaEl
  )
    return;

  const show = appMode === "lobby";
  lobbyMatchStatusEl.classList.toggle("hidden", !show);
  lobbyStatusRowEl.classList.toggle("hidden", !show);
  if (!show) return;

  lobbyMatchStatusTitleEl.textContent = roomName;

  const players = Array.isArray(lobbyScoreboard) ? lobbyScoreboard : [];
  const playerCount = players.length;
  const maxPlayers = Math.max(playerCount, Number(lobbyMaxPlayers || 0));
  lobbyPlayersMetaEl.textContent = `${playerCount}/${maxPlayers} spelare`;

  if (currentMatch.inProgress) {
    const elapsedMinutes = Math.floor(
      Math.max(0, Number(currentMatch.elapsedMs || 0)) / 60000,
    );
    lobbyStatusTextEl.textContent = `Match pågår (${elapsedMinutes} min)`;
    return;
  }

  const minPlayers = Math.max(1, Number(lobbyMinPlayersToStart || 2));
  const readyCount = players.reduce(
    (acc, player) => acc + (player?.ready ? 1 : 0),
    0,
  );
  const readyEligibleCount = players.reduce((acc, player) => {
    const status = String(player?.status || "").toLowerCase();
    const canReady =
      status === "i lobby" || status === "lobbyn" || status === "lobby";
    return acc + (canReady ? 1 : 0);
  }, 0);
  const readyText = `Redo ${readyCount}/${readyEligibleCount}`;
  const countdownRunning =
    lobbyCountdownMsRemaining > 0 || sessionState === "countdown";

  if (countdownRunning) {
    lobbyStatusTextEl.textContent = "Startar match";
    return;
  }
  if (playerCount < minPlayers) {
    lobbyStatusTextEl.textContent = "Väntar på spelare";
    return;
  }
  if (readyEligibleCount === 0) {
    lobbyStatusTextEl.textContent = "Väntar på spelare";
    return;
  }
  if (readyCount < readyEligibleCount) {
    lobbyStatusTextEl.textContent = `Väntar på redo (${readyText})`;
    return;
  }
  lobbyStatusTextEl.textContent = "Startar match";
}

/**
 * @param {{
 *   playBtnEl: HTMLButtonElement|null,
 *   authenticated: boolean,
 *   sessionState: string,
 *   currentMatch: {inProgress: boolean, pendingReset: boolean},
 *   sessionReady: boolean,
 *   lobbyCountdownMsRemaining: number,
 * }} opts
 */
export function updateReadyButton({
  playBtnEl,
  authenticated,
  sessionState,
  currentMatch,
  sessionReady,
  lobbyCountdownMsRemaining,
}) {
  if (!playBtnEl) return;
  let buttonReadyState = "inactive";
  if (!authenticated) {
    playBtnEl.disabled = true;
    playBtnEl.textContent = "Redo";
  } else if (sessionState === "alive") {
    playBtnEl.disabled = true;
    playBtnEl.textContent = "Du spelar";
  } else if (sessionState === "spectating") {
    playBtnEl.disabled = true;
    playBtnEl.textContent = "Åskådar";
  } else if (currentMatch.pendingReset) {
    playBtnEl.disabled = true;
    playBtnEl.textContent = "Avslutar match...";
  } else if (currentMatch.inProgress) {
    playBtnEl.disabled = false;
    playBtnEl.textContent = "Åskåda";
  } else if (sessionState === "countdown" && sessionReady) {
    playBtnEl.disabled = true;
    playBtnEl.textContent = "Match startar...";
  } else if (sessionReady) {
    playBtnEl.disabled = false;
    playBtnEl.textContent = "Inte redo";
    buttonReadyState = "ready";
  } else if (lobbyCountdownMsRemaining > 0) {
    // Player is in lobby watching an active countdown – join button is shown in overlay,
    // but keep lobby button usable as backup (labelled clearly).
    playBtnEl.disabled = false;
    playBtnEl.textContent = "Gå med";
    buttonReadyState = "not-ready";
  } else {
    playBtnEl.disabled = false;
    playBtnEl.textContent = "Redo";
    buttonReadyState = "not-ready";
  }
  playBtnEl.dataset.readyState = buttonReadyState;
  playBtnEl.setAttribute(
    "aria-pressed",
    buttonReadyState === "ready" ? "true" : "false",
  );
}
