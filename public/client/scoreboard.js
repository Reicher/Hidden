/**
 * Produce a stable string signature for a player list so callers can
 * skip re-rendering when nothing has changed.
 *
 * @param {object[]} players
 * @returns {string}
 */
export function scoreboardSignature(players) {
  if (!Array.isArray(players) || players.length <= 0) return "";
  return players
    .map((p) =>
      [
        p?.name || "",
        p?.ready ? 1 : 0,
        p?.wins ?? 0,
        p?.knockdowns ?? 0,
        p?.streak ?? 0,
        p?.downed ?? 0,
        p?.innocents ?? 0,
        p?.status || "",
      ].join(":"),
    )
    .join("|");
}

/**
 * Render the scoreboard table body.
 *
 * @param {HTMLElement} scoreBodyEl - the <tbody> to populate
 * @param {object[]} players        - scoreboard entries from the server
 * @param {(name: string) => string} colorForName - maps a player name to a CSS colour
 * @returns {object[]} the player array (pass-through for callers that need it)
 */
export function renderScoreboard(scoreBodyEl, players, colorForName) {
  if (!scoreBodyEl) return players ?? [];
  scoreBodyEl.textContent = "";
  if (!Array.isArray(players)) return [];

  const compactStatusLabel = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "-";
    const lower = raw.toLowerCase();
    if (lower.includes("lobby")) return "Lobbyn";
    if (lower.includes("åsk") || lower.includes("spect")) return "Åsk";
    if (
      lower.includes("spel") ||
      lower.includes("alive") ||
      lower.includes("won") ||
      lower.includes("downed")
    )
      return "Spel";
    if (raw.length <= 8) return raw;
    return `${raw.slice(0, 7)}…`;
  };

  for (const p of players) {
    const tr = document.createElement("tr");

    // Name cell
    const nameCell = document.createElement("td");
    nameCell.className = "name-cell";
    const nameCellInner = document.createElement("span");
    nameCellInner.className = "name-cell-inner";
    const readyLamp = document.createElement("span");
    readyLamp.className = `ready-lamp name-ready-lamp ${p.ready ? "on" : "off"}`;
    readyLamp.setAttribute("aria-hidden", "true");
    nameCellInner.appendChild(readyLamp);
    const nameLabel = document.createElement("span");
    nameLabel.className = "name-label";
    nameLabel.textContent = p.name || "-";
    nameLabel.style.color = colorForName(p.name);
    nameCellInner.appendChild(nameLabel);
    nameCell.appendChild(nameCellInner);
    tr.appendChild(nameCell);

    for (const [key, fallback] of [
      ["wins", 0],
      ["knockdowns", 0],
      ["streak", 0],
      ["downed", 0],
      ["innocents", 0],
    ]) {
      const td = document.createElement("td");
      td.textContent = String(p[key] ?? fallback);
      tr.appendChild(td);
    }

    // Status cell
    const statusCell = document.createElement("td");
    statusCell.className = "status-cell";
    const statusText = document.createElement("span");
    statusText.className = "status-label";
    statusText.textContent = compactStatusLabel(p.status);
    statusCell.appendChild(statusText);
    tr.appendChild(statusCell);

    scoreBodyEl.appendChild(tr);
  }
  return players;
}
