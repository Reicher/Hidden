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

    for (const [key, fallback] of [["wins", 0], ["knockdowns", 0], ["streak", 0], ["downed", 0], ["innocents", 0]]) {
      const td = document.createElement("td");
      td.textContent = String(p[key] ?? fallback);
      tr.appendChild(td);
    }

    // Status cell
    const statusCell = document.createElement("td");
    statusCell.className = "status-cell";
    const statusText = document.createElement("span");
    statusText.className = "status-label";
    statusText.textContent = p.status || "-";
    statusCell.appendChild(statusText);
    tr.appendChild(statusCell);

    scoreBodyEl.appendChild(tr);
  }
  return players;
}
