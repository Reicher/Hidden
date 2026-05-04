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
        textSpan.textContent = seg?.text || "";
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
  maxGameLines = 5
}) {
  const limit = Math.max(1, Number(maxGameLines || 5));

  function appendChat(entry) {
    appendChatLine(lobbyMessagesEl, entry, colorForName);
    if (!shouldMirrorToGameChat(entry)) return;
    appendChatLine(gameMessagesEl, entry, colorForName);
    if (!gameMessagesEl) return;
    while (gameMessagesEl.children.length > limit) {
      gameMessagesEl.removeChild(gameMessagesEl.firstElementChild);
    }
  }

  function replaceChat(history) {
    if (lobbyMessagesEl) lobbyMessagesEl.textContent = "";
    if (gameMessagesEl) gameMessagesEl.textContent = "";
    if (!Array.isArray(history)) return;
    for (const entry of history) appendChat(entry);
  }

  return {
    appendChat,
    replaceChat
  };
}
