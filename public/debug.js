const TOKEN_KEY = "hidden_debug_token";

const tokenEl = document.getElementById("token");
const loadBtnEl = document.getElementById("loadBtn");
const clearBtnEl = document.getElementById("clearBtn");
const errorEl = document.getElementById("error");
const summaryEl = document.getElementById("summary");
const chartEl = document.getElementById("chart");
const roomsEl = document.getElementById("rooms");
const playersEl = document.getElementById("players");
const eventsEl = document.getElementById("events");
const metaEl = document.getElementById("meta");

const tabStatsBtnEl = document.getElementById("tabStatsBtn");
const tabSettingsBtnEl = document.getElementById("tabSettingsBtn");
const statsTabEl = document.getElementById("statsTab");
const settingsTabEl = document.getElementById("settingsTab");
const layoutSelectEl = document.getElementById("layoutSelect");
const totalCharactersInputEl = document.getElementById("totalCharactersInput");
const maxPlayersInputEl = document.getElementById("maxPlayersInput");
const minPlayersToStartInputEl = document.getElementById("minPlayersToStartInput");
const npcDownedRespawnSecondsInputEl = document.getElementById("npcDownedRespawnSecondsInput");
const saveSettingsBtnEl = document.getElementById("saveSettingsBtn");
const settingsInfoEl = document.getElementById("settingsInfo");
const settingsStatusEl = document.getElementById("settingsStatus");

let loading = false;
let pollTimer = null;
let settingsLoading = false;
let settingsSaving = false;
let activeTab = "stats";
let cachedSettings = null;
const LIST_LIMIT = 20;

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  if (!token) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

function resolveToken() {
  const typed = tokenEl?.value?.trim() || "";
  const saved = getToken().trim();
  const token = typed || saved;
  if (token) setToken(token);
  return token;
}

function buildDebugUrl(path, token) {
  const url = new URL(path, location.origin);
  if (token) url.searchParams.set("token", token);
  return url;
}

function setError(text) {
  if (!errorEl) return;
  errorEl.textContent = text || "";
}

function setSettingsStatus(text, isError = false) {
  if (!settingsStatusEl) return;
  settingsStatusEl.textContent = text || "";
  settingsStatusEl.classList.toggle("error", Boolean(text) && isError);
}

function parseIntField(inputEl, fieldName) {
  const raw = inputEl?.value?.trim() || "";
  if (!raw) throw new Error(`${fieldName} saknas.`);
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1) throw new Error(`${fieldName} måste vara ett heltal >= 1.`);
  return num;
}

function fmtN(value) {
  return Number(value || 0).toLocaleString("sv-SE");
}

function fmtBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let out = value;
  while (out >= 1024 && unitIndex < units.length - 1) {
    out /= 1024;
    unitIndex += 1;
  }
  const precision = out >= 100 ? 0 : out >= 10 ? 1 : 2;
  return `${out.toFixed(precision)} ${units[unitIndex]}`;
}

function fmtAt(at) {
  if (!at || !Number.isFinite(at)) return "-";
  const d = new Date(at);
  return `${d.toLocaleDateString("sv-SE")} ${d.toLocaleTimeString("sv-SE")}`;
}

function renderSummary(data) {
  if (!summaryEl) return;
  const system = data?.systemMetrics || {};
  const host = system.host || {};
  const proc = system.process || {};
  const cpuLoadHost = host.cpuLoadPercent == null ? "-" : `${host.cpuLoadPercent}%`;
  const cpuTempHost = host.cpuTempCelsius == null ? "-" : `${host.cpuTempCelsius}\u00b0C`;
  const rows = [
    ["Anslutna nu", fmtN(data?.current?.connected)],
    ["Inloggade nu", fmtN(data?.current?.authenticated)],
    ["Spelar nu", fmtN(data?.current?.active)],
    ["Peak anslutna", fmtN(data?.peaks?.connected)],
    ["Totala besök", fmtN(data?.totals?.totalConnections)],
    ["Totala logins", fmtN(data?.totals?.totalLogins)],
    ["Unika namn", fmtN(data?.totals?.uniqueNames)],
    ["Aktiva rum nu", fmtN(data?.current?.roomCountWithSessions)],
    ["Server start", fmtAt(data?.startedAt)],
    ["Host CPU-last", cpuLoadHost],
    ["Host CPU-temp", cpuTempHost],
    ["Host loadavg (1m)", String(host.loadAverage1m ?? "-")],
    ["Host RAM", `${fmtBytes(host.usedMemoryBytes)} / ${fmtBytes(host.totalMemoryBytes)} (${host.memoryUsagePercent ?? "-"}%)`],
    ["Node CPU", `${proc.cpuPercentHostShare ?? "-"}% av host (${proc.cpuPercentSingleCore ?? "-"}% av 1 kärna)`],
    ["Node RSS", fmtBytes(proc.rssBytes)],
    ["Node heap", `${fmtBytes(proc.heapUsedBytes)} / ${fmtBytes(proc.heapTotalBytes)}`]
  ];
  summaryEl.textContent = "";
  for (const [k, v] of rows) {
    const card = document.createElement("div");
    card.className = "card";
    const key = document.createElement("div");
    key.className = "k";
    key.textContent = k;
    const value = document.createElement("div");
    value.className = "v";
    value.textContent = v;
    card.appendChild(key);
    card.appendChild(value);
    summaryEl.appendChild(card);
  }
}

function drawChart(samples) {
  const ctx = chartEl?.getContext("2d");
  if (!ctx || !chartEl) return;
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const cssW = Math.max(320, Math.floor(chartEl.clientWidth || 960));
  const cssH = Math.max(180, Math.floor(chartEl.clientHeight || 240));
  chartEl.width = cssW * dpr;
  chartEl.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const points = Array.isArray(samples) ? samples.slice(-200) : [];
  if (points.length < 2) {
    ctx.fillStyle = "#9ba9bf";
    ctx.font = "12px JetBrains Mono";
    ctx.fillText("Ingen historik än.", 12, 22);
    return;
  }

  const values = [];
  for (const p of points) {
    values.push(Number(p.connected || 0));
    values.push(Number(p.authenticated || 0));
    values.push(Number(p.active || 0));
  }
  const maxY = Math.max(1, ...values);
  const padX = 36;
  const padY = 14;
  const innerW = cssW - padX - 10;
  const innerH = cssH - padY * 2 - 18;

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padY + (innerH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(padX + innerW, y);
    ctx.stroke();
  }

  function drawLine(field, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      const x = padX + (innerW * i) / (points.length - 1);
      const value = Number(points[i][field] || 0);
      const y = padY + innerH - (value / maxY) * innerH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawLine("connected", "#7ad8ff");
  drawLine("authenticated", "#8de16f");
  drawLine("active", "#ffcf6a");
}

function roomLabel(room) {
  if (!room) return "-";
  return room.isPrivate ? `privat:${room.roomCode || room.roomId}` : "publik";
}

function buildRoomRows(data) {
  const activeRooms = Array.isArray(data?.liveRooms) ? data.liveRooms : [];
  const historicalRooms = Array.isArray(data?.rooms) ? data.rooms : [];
  const byId = new Map();

  for (const room of historicalRooms) {
    const roomId = String(room?.roomId || "").trim();
    if (!roomId) continue;
    byId.set(roomId, {
      roomId,
      roomCode: room.roomCode || null,
      isPrivate: Boolean(room.isPrivate),
      lastEventAt: Number(room.lastEventAt || 0),
      uniqueNames: Array.isArray(room.uniqueNames) ? room.uniqueNames : [],
      hasLive: false,
      authenticatedNames: []
    });
  }

  for (const room of activeRooms) {
    const roomId = String(room?.roomId || "").trim();
    if (!roomId) continue;
    const existing = byId.get(roomId) || {
      roomId,
      roomCode: room.roomCode || null,
      isPrivate: Boolean(room.isPrivate),
      lastEventAt: 0,
      uniqueNames: [],
      hasLive: false,
      authenticatedNames: []
    };
    existing.roomCode = room.roomCode || existing.roomCode;
    existing.isPrivate = Boolean(room.isPrivate);
    existing.hasLive = true;
    existing.authenticatedNames = Array.isArray(room.authenticatedNames) ? room.authenticatedNames : [];
    byId.set(roomId, existing);
  }

  return [...byId.values()].sort((a, b) => {
    if (a.hasLive !== b.hasLive) return a.hasLive ? -1 : 1;
    if (b.lastEventAt !== a.lastEventAt) return b.lastEventAt - a.lastEventAt;
    return a.roomId.localeCompare(b.roomId, "sv");
  });
}

function renderText(data) {
  const roomRows = buildRoomRows(data);
  const roomLabelById = new Map(roomRows.map((room) => [room.roomId, roomLabel(room)]));

  if (roomsEl) {
    if (roomRows.length === 0) {
      roomsEl.textContent = "Inga rum.";
    } else {
      const visible = roomRows.slice(0, LIST_LIMIT);
      const activeRows = visible.filter((room) => room.hasLive);
      const historicalRows = visible.filter((room) => !room.hasLive);
      const lines = [];

      if (activeRows.length > 0) {
        lines.push(`Aktiva (${activeRows.length}):`);
        for (const room of activeRows) {
          const names = room.authenticatedNames.length > 0 ? room.authenticatedNames.join(", ") : "-";
          lines.push(`${roomLabel(room)} | namn: ${names}`);
        }
      }
      if (historicalRows.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push(`Tidigare (${historicalRows.length}):`);
        for (const room of historicalRows) {
          const names = room.uniqueNames.length > 0 ? room.uniqueNames.join(", ") : "-";
          lines.push(`${roomLabel(room)} | senast: ${fmtAt(room.lastEventAt)} | namn: ${names}`);
        }
      }
      roomsEl.textContent = lines.join("\n");
    }
  }
  if (playersEl) {
    const players = Array.isArray(data?.players) ? data.players.slice(0, LIST_LIMIT) : [];
    playersEl.textContent =
      players.length > 0
        ? players
            .map((p) => {
              const rooms = (p.rooms || []).map((roomId) => roomLabelById.get(roomId) || roomId).join(", ") || "-";
              return `${p.name} | senast: ${fmtAt(p.lastSeenAt)} | rum: ${rooms}`;
            })
            .join("\n")
        : "Inga namn loggade ännu.";
  }
  if (eventsEl) {
    const events = Array.isArray(data?.recentEvents) ? data.recentEvents.slice(-LIST_LIMIT).reverse() : [];
    eventsEl.textContent =
      events.length > 0
        ? events
            .map((event) => {
              const label = roomLabel(event);
              return `${fmtAt(event.at)} | ${event.type} | ${label} | ${event.name || "-"}`;
            })
            .join("\n")
        : "Inga events ännu.";
  }
  if (metaEl) {
    const host = data?.systemMetrics?.host || {};
    const proc = data?.systemMetrics?.process || {};
    metaEl.textContent = `Senast uppdaterad: ${fmtAt(data?.generatedAt)} | Host: ${host.hostname || "-"} (${host.platform || "-"} ${host.arch || "-"}) | PID: ${proc.pid || "-"} | Loggar: logs/debug-events.log + logs/debug-samples.jsonl`;
  }
}

function renderSettings(settings) {
  if (!layoutSelectEl) return;
  const available = Array.isArray(settings?.availableLayouts) ? settings.availableLayouts : [];
  const activeLayoutId = String(settings?.layout?.id || "");

  layoutSelectEl.textContent = "";
  for (const entry of available) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = `${entry.label} (${entry.worldSizeMeters}x${entry.worldSizeMeters} m)`;
    layoutSelectEl.appendChild(option);
  }
  if (activeLayoutId) layoutSelectEl.value = activeLayoutId;

  const gameplay = settings?.gameplaySettings || {};
  if (totalCharactersInputEl && Number.isFinite(Number(gameplay.totalCharacters))) {
    totalCharactersInputEl.value = String(gameplay.totalCharacters);
  }
  if (maxPlayersInputEl && Number.isFinite(Number(gameplay.maxPlayers))) {
    maxPlayersInputEl.value = String(gameplay.maxPlayers);
  }
  if (minPlayersToStartInputEl && Number.isFinite(Number(gameplay.minPlayersToStart))) {
    minPlayersToStartInputEl.value = String(gameplay.minPlayersToStart);
  }
  if (npcDownedRespawnSecondsInputEl && Number.isFinite(Number(gameplay.npcDownedRespawnSeconds))) {
    npcDownedRespawnSecondsInputEl.value = String(gameplay.npcDownedRespawnSeconds);
  }

  if (settingsInfoEl) {
    const activeLabel = settings?.layout?.label || activeLayoutId || "-";
    const activeSize = settings?.layout?.worldSizeMeters;
    const infoMax = Number.isFinite(Number(gameplay.maxPlayers)) ? gameplay.maxPlayers : "-";
    const infoChars = Number.isFinite(Number(gameplay.totalCharacters)) ? gameplay.totalCharacters : "-";
    const infoMinStart = Number.isFinite(Number(gameplay.minPlayersToStart)) ? gameplay.minPlayersToStart : "-";
    const infoNpcRespawn = Number.isFinite(Number(gameplay.npcDownedRespawnSeconds))
      ? gameplay.npcDownedRespawnSeconds
      : "-";
    settingsInfoEl.textContent = `Aktiv karta: ${activeLabel}${activeSize ? ` (${activeSize}x${activeSize} meter)` : ""}. Karaktärer: ${infoChars}, max spelare: ${infoMax}, min start: ${infoMinStart}, NPC återresning: ${infoNpcRespawn}s. Ändringar startar om aktiva rum.`;
  }
}

function mergeSettingsFromStats(data) {
  if (!data || typeof data !== "object") return;
  const layout = data.layout;
  const gameplaySettings = data.gameplaySettings;
  const hasLayout = layout && typeof layout === "object";
  const hasGameplay = gameplaySettings && typeof gameplaySettings === "object";
  if (!hasLayout && !hasGameplay) return;
  const source = cachedSettings || {};
  const availableLayouts = Array.isArray(source.availableLayouts) ? source.availableLayouts : [];
  cachedSettings = {
    layout: hasLayout ? layout : source.layout,
    gameplaySettings: hasGameplay ? gameplaySettings : source.gameplaySettings,
    availableLayouts
  };
  renderSettings(cachedSettings);
}

function render(data) {
  renderSummary(data);
  drawChart(data?.samples || []);
  renderText(data);
  mergeSettingsFromStats(data);
}

function setActiveTab(tab) {
  activeTab = tab;
  const showSettings = tab === "settings";
  statsTabEl?.classList.toggle("hidden", showSettings);
  settingsTabEl?.classList.toggle("hidden", !showSettings);
  tabStatsBtnEl?.classList.toggle("active", !showSettings);
  tabSettingsBtnEl?.classList.toggle("active", showSettings);
  if (showSettings) loadSettings();
}

async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const token = resolveToken();
    const url = buildDebugUrl("/api/debug/stats", token);
    const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    if (res.status === 503) {
      setError("Servern saknar DEBUG_VIEW_TOKEN. Sätt den i miljön och starta om.");
      return;
    }
    if (res.status === 401) {
      setError("Fel eller saknad token.");
      return;
    }
    if (!res.ok) {
      setError(`Kunde inte läsa debugdata (${res.status}).`);
      return;
    }
    const data = await res.json();
    setError("");
    render(data);
  } catch {
    setError("Nätverksfel.");
  } finally {
    loading = false;
  }
}

async function loadSettings() {
  if (settingsLoading) return;
  settingsLoading = true;
  try {
    const token = resolveToken();
    if (!token) {
      setSettingsStatus("Fyll i token för att läsa settings.", true);
      return;
    }
    const url = buildDebugUrl("/api/debug/settings", token);
    const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    if (res.status === 401) {
      setSettingsStatus("Fel token för settings.", true);
      return;
    }
    if (res.status === 503) {
      setSettingsStatus("Servern saknar DEBUG_VIEW_TOKEN.", true);
      return;
    }
    if (!res.ok) {
      setSettingsStatus(`Kunde inte läsa settings (${res.status}).`, true);
      return;
    }
    const data = await res.json();
    cachedSettings = data;
    renderSettings(data);
    setSettingsStatus("");
  } catch {
    setSettingsStatus("Nätverksfel vid läsning av settings.", true);
  } finally {
    settingsLoading = false;
  }
}

async function saveSettings() {
  if (settingsSaving) return;
  settingsSaving = true;
  try {
    const token = resolveToken();
    if (!token) {
      setSettingsStatus("Fyll i token innan du sparar settings.", true);
      return;
    }
    const layoutId = layoutSelectEl?.value?.trim() || "";
    if (!layoutId) {
      setSettingsStatus("Välj en karta först.", true);
      return;
    }
    const totalCharacters = parseIntField(totalCharactersInputEl, "Antal karaktärer");
    const maxPlayers = parseIntField(maxPlayersInputEl, "Max antal spelare");
    const minPlayersToStart = parseIntField(minPlayersToStartInputEl, "Min spelare för spelstart");
    const npcDownedRespawnSeconds = parseIntField(
      npcDownedRespawnSecondsInputEl,
      "NPC återresning (sek)"
    );
    if (maxPlayers >= totalCharacters) {
      setSettingsStatus("Max antal spelare måste vara mindre än antal karaktärer.", true);
      return;
    }
    if (minPlayersToStart < 2) {
      setSettingsStatus("Min spelare för spelstart måste vara minst 2.", true);
      return;
    }
    if (minPlayersToStart > maxPlayers) {
      setSettingsStatus("Min spelare för spelstart kan inte vara större än max antal spelare.", true);
      return;
    }
    if (npcDownedRespawnSeconds < 1) {
      setSettingsStatus("NPC återresning måste vara minst 1 sekund.", true);
      return;
    }
    const url = buildDebugUrl("/api/debug/settings", token);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        layoutId,
        totalCharacters,
        maxPlayers,
        minPlayersToStart,
        npcDownedRespawnSeconds
      })
    });
    if (res.status === 401) {
      setSettingsStatus("Fel token för settings.", true);
      return;
    }
    if (!res.ok) {
      let message = `Kunde inte spara settings (${res.status}).`;
      try {
        const body = await res.json();
        if (body?.message) message = body.message;
      } catch {
        // ignore parse errors
      }
      setSettingsStatus(message, true);
      return;
    }
    const data = await res.json();
    cachedSettings = data;
    renderSettings(data);
    setSettingsStatus("Settings sparade. Rum har startats om.");
    refresh();
  } catch (error) {
    const message = error?.message || "";
    if (message) {
      setSettingsStatus(message, true);
      return;
    }
    setSettingsStatus("Nätverksfel vid sparning av settings.", true);
  } finally {
    settingsSaving = false;
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  refresh();
  pollTimer = setInterval(refresh, 5000);
}

loadBtnEl?.addEventListener("click", refresh);
clearBtnEl?.addEventListener("click", () => {
  setToken("");
  if (tokenEl) tokenEl.value = "";
  setError("");
  setSettingsStatus("");
});
tokenEl?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  refresh();
});
tabStatsBtnEl?.addEventListener("click", () => setActiveTab("stats"));
tabSettingsBtnEl?.addEventListener("click", () => setActiveTab("settings"));
saveSettingsBtnEl?.addEventListener("click", saveSettings);
window.addEventListener("resize", () => {
  refresh();
});

if (tokenEl) tokenEl.value = getToken();
setActiveTab("stats");
startPolling();
