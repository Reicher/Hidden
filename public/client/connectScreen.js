const ROOM_INFO_DEFAULTS = Object.freeze({
  maxPlayers: 10,
  totalCharacters: 20
});

function roomInfoText({
  roomCode = null,
  maxPlayers = ROOM_INFO_DEFAULTS.maxPlayers,
  totalCharacters = ROOM_INFO_DEFAULTS.totalCharacters
} = {}) {
  const scopeText = roomCode ? `Privat rum: ${roomCode}` : "Offentligt rum";
  return `${scopeText} · Max ${maxPlayers} spelare av ${totalCharacters} karaktärer`;
}

function formatNewsTimestamp(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const asDate = new Date(raw);
  if (!Number.isFinite(asDate.getTime())) return raw;
  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(asDate);
}

export function createConnectScreen({
  elements,
  activeRoomCodeFromPath,
  fetchJson = async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`http_${response.status}`);
    return response.json();
  }
}) {
  const {
    connectErrorEl,
    createPrivateRoomBtnEl,
    newsCardEl,
    newsNotesEl,
    newsPublishedAtEl,
    newsVersionEl,
    roomInfoEl
  } = elements;

  function setConnectError(text) {
    if (!connectErrorEl) return;
    connectErrorEl.textContent = text || "";
  }

  function setPrivateRoomButtonVisible(visible) {
    if (!createPrivateRoomBtnEl) return;
    createPrivateRoomBtnEl.classList.toggle("hidden", !visible);
  }

  async function setRoomInfo() {
    if (!roomInfoEl) return;
    const code = activeRoomCodeFromPath();
    roomInfoEl.textContent = roomInfoText({ roomCode: code });
    try {
      const payload = await fetchJson(`/api/room-info?t=${Date.now()}`);
      const maxPlayers = Math.max(1, Number(payload?.maxPlayers || 0));
      const totalCharacters = Math.max(1, Number(payload?.totalCharacters || 0));
      if (!Number.isFinite(maxPlayers) || !Number.isFinite(totalCharacters)) return;
      roomInfoEl.textContent = roomInfoText({
        roomCode: code,
        maxPlayers,
        totalCharacters
      });
    } catch {
      // Keep fallback text when endpoint is unavailable.
    }
  }

  async function setNewsCard() {
    if (!newsCardEl || !newsVersionEl || !newsPublishedAtEl || !newsNotesEl) return;
    try {
      const payload = await fetchJson(`/news.json?t=${Date.now()}`);
      const version = typeof payload?.version === "string" ? payload.version.trim() : "";
      const publishedAt = formatNewsTimestamp(payload?.publishedAt);
      const notes = typeof payload?.notes === "string" ? payload.notes.trim() : "";

      newsVersionEl.textContent = version ? `Nyheter version ${version}` : "Nyheter version -";
      if (publishedAt) {
        newsPublishedAtEl.textContent = publishedAt;
        newsPublishedAtEl.classList.remove("hidden");
      } else {
        newsPublishedAtEl.textContent = "";
        newsPublishedAtEl.classList.add("hidden");
      }
      newsNotesEl.textContent = notes || "Inga release notes hittades.";
    } catch {
      newsVersionEl.textContent = "Nyheter version -";
      newsPublishedAtEl.textContent = "";
      newsPublishedAtEl.classList.add("hidden");
      newsNotesEl.textContent = "Inga nyheter tillgängliga just nu.";
    }
  }

  return {
    setConnectError,
    setNewsCard,
    setPrivateRoomButtonVisible,
    setRoomInfo
  };
}
