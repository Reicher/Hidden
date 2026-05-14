import { t } from "./i18n.js";

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
  lobbyPlayersMetaEl.textContent = t("lobby.players", {
    count: playerCount,
    max: maxPlayers,
  });

  if (currentMatch.inProgress) {
    const elapsedMinutes = Math.floor(
      Math.max(0, Number(currentMatch.elapsedMs || 0)) / 60000,
    );
    lobbyStatusTextEl.textContent = t("lobby.status.inProgress", {
      min: elapsedMinutes,
    });
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
  const readyText = t("lobby.ready.label", {
    count: readyCount,
    total: readyEligibleCount,
  });
  const countdownRunning =
    lobbyCountdownMsRemaining > 0 || sessionState === "countdown";

  if (countdownRunning) {
    lobbyStatusTextEl.textContent = t("lobby.status.starting");
    return;
  }
  if (playerCount < minPlayers) {
    lobbyStatusTextEl.textContent = t("lobby.status.waiting");
    return;
  }
  if (readyEligibleCount === 0) {
    lobbyStatusTextEl.textContent = t("lobby.status.waiting");
    return;
  }
  if (readyCount < readyEligibleCount) {
    lobbyStatusTextEl.textContent = t("lobby.status.waitingReady", {
      text: readyText,
    });
    return;
  }
  lobbyStatusTextEl.textContent = t("lobby.status.starting");
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
    playBtnEl.textContent = t("ready.ready");
  } else if (sessionState === "alive") {
    playBtnEl.disabled = true;
    playBtnEl.textContent = t("ready.playing");
  } else if (sessionState === "spectating") {
    playBtnEl.disabled = true;
    playBtnEl.textContent = t("ready.spectating");
  } else if (currentMatch.pendingReset) {
    playBtnEl.disabled = true;
    playBtnEl.textContent = t("ready.ending");
  } else if (currentMatch.inProgress) {
    playBtnEl.disabled = false;
    playBtnEl.textContent = t("ready.spectate");
  } else if (sessionState === "countdown" && sessionReady) {
    playBtnEl.disabled = true;
    playBtnEl.textContent = t("ready.starting");
  } else if (sessionReady) {
    playBtnEl.disabled = false;
    playBtnEl.textContent = t("ready.notReady");
    buttonReadyState = "ready";
  } else if (lobbyCountdownMsRemaining > 0) {
    playBtnEl.disabled = false;
    playBtnEl.textContent = t("ready.join");
    buttonReadyState = "not-ready";
  } else {
    playBtnEl.disabled = false;
    playBtnEl.textContent = t("ready.ready");
    buttonReadyState = "not-ready";
  }
  playBtnEl.dataset.readyState = buttonReadyState;
  playBtnEl.setAttribute(
    "aria-pressed",
    buttonReadyState === "ready" ? "true" : "false",
  );
}
