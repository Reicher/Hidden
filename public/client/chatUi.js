import { t } from "./i18n.js";

function appendChatLine(container, entry, colorForName) {
  if (!container) return;
  if (!entry || typeof entry.text !== "string") return;
  const line = document.createElement("p");
  line.className = "chat-line";

  if (entry.system) {
    line.classList.add("chat-system");
    if (Array.isArray(entry.segments) && entry.segments.length > 0) {
      for (const seg of entry.segments) {
        if (seg?.type === "player") {
          const playerSpan = document.createElement("span");
          playerSpan.className = "chat-name";
          playerSpan.style.color = colorForName(seg.name);
          playerSpan.textContent = seg.name || "";
          line.appendChild(playerSpan);
          continue;
        }
        const textSpan = document.createElement("span");
        textSpan.textContent = seg?.key
          ? t(seg.key, seg.vars)
          : seg?.text || "";
        line.appendChild(textSpan);
      }
    } else {
      line.textContent = entry.text;
    }
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
    return;
  }

  const nameSpan = document.createElement("span");
  nameSpan.className = "chat-name";
  nameSpan.textContent = `${entry.name || "okänd"}: `;
  nameSpan.style.color = colorForName(entry.name);

  const textSpan = document.createElement("span");
  textSpan.textContent = entry.text;

  line.appendChild(nameSpan);
  line.appendChild(textSpan);
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

export function createChatUi({
  lobbyMessagesEl,
  gameMessagesEl,
  colorForName,
  shouldMirrorToGameChat,
  maxGameLines = 5,
}) {
  let gameLineLimit = Math.max(1, Number(maxGameLines || 5));
  const historyEntries = [];

  function trimGameChatLines() {
    if (!gameMessagesEl || gameLineLimit == null) return;
    while (gameMessagesEl.children.length > gameLineLimit) {
      gameMessagesEl.removeChild(gameMessagesEl.firstElementChild);
    }
  }

  function renderGameChatFromHistory() {
    if (gameMessagesEl) gameMessagesEl.textContent = "";
    for (const entry of historyEntries) {
      if (!shouldMirrorToGameChat(entry)) continue;
      appendChatLine(gameMessagesEl, entry, colorForName);
    }
    trimGameChatLines();
  }

  function appendChat(entry) {
    historyEntries.push(entry);
    appendChatLine(lobbyMessagesEl, entry, colorForName);
    if (!shouldMirrorToGameChat(entry)) return;
    appendChatLine(gameMessagesEl, entry, colorForName);
    trimGameChatLines();
  }

  function replaceChat(history) {
    historyEntries.length = 0;
    if (lobbyMessagesEl) lobbyMessagesEl.textContent = "";
    if (!Array.isArray(history)) {
      renderGameChatFromHistory();
      return;
    }
    for (const entry of history) {
      historyEntries.push(entry);
      appendChatLine(lobbyMessagesEl, entry, colorForName);
    }
    renderGameChatFromHistory();
  }

  function refreshGameChat() {
    renderGameChatFromHistory();
  }

  function setGameLineLimit(limit) {
    if (limit == null) {
      gameLineLimit = null;
      renderGameChatFromHistory();
      return;
    }
    const normalized = Number(limit);
    gameLineLimit = Number.isFinite(normalized)
      ? Math.max(1, Math.floor(normalized))
      : 1;
    renderGameChatFromHistory();
  }

  return {
    appendChat,
    replaceChat,
    refreshGameChat,
    setGameLineLimit,
  };
}
