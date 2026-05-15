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
const chatEl = document.getElementById("chat");
const metaEl = document.getElementById("meta");

const tabStatsBtnEl = document.getElementById("tabStatsBtn");
const tabSettingsBtnEl = document.getElementById("tabSettingsBtn");
const statsTabEl = document.getElementById("statsTab");
const settingsTabEl = document.getElementById("settingsTab");
const layoutSelectEl = document.getElementById("layoutSelect");
const totalCharactersInputEl = document.getElementById("totalCharactersInput");
const maxPlayersInputEl = document.getElementById("maxPlayersInput");
const minPlayersToStartInputEl = document.getElementById(
  "minPlayersToStartInput",
);
const npcDownedRespawnSecondsInputEl = document.getElementById(
  "npcDownedRespawnSecondsInput",
);
const playerAttackCooldownSecondsInputEl = document.getElementById(
  "playerAttackCooldownSecondsInput",
);
const attackHalfAngleDegreesInputEl = document.getElementById(
  "attackHalfAngleDegreesInput",
);
const moveSpeedMetersPerSecondInputEl = document.getElementById(
  "moveSpeedMetersPerSecondInput",
);
const playerSprintMultiplierInputEl = document.getElementById(
  "playerSprintMultiplierInput",
);
const npcInspectDownedChanceInputEl = document.getElementById(
  "npcInspectDownedChanceInput",
);
const npcInspectDownedChanceValueEl = document.getElementById(
  "npcInspectDownedChanceValue",
);
const npcInspectDownedRadiusInputEl = document.getElementById(
  "npcInspectDownedRadiusInput",
);
const npcInspectDownedRadiusValueEl = document.getElementById(
  "npcInspectDownedRadiusValue",
);
const npcSocialSeparationInputEl = document.getElementById(
  "npcSocialSeparationInput",
);
const npcSocialSeparationValueEl = document.getElementById(
  "npcSocialSeparationValue",
);
const npcStopChanceInputEl = document.getElementById("npcStopChanceInput");
const npcStopChanceValueEl = document.getElementById("npcStopChanceValue");
const npcMoveDecisionIntervalMinMsInputEl = document.getElementById(
  "npcMoveDecisionIntervalMinMsInput",
);
const npcMoveDecisionIntervalMaxMsInputEl = document.getElementById(
  "npcMoveDecisionIntervalMaxMsInput",
);
const npcStopDurationMinMsInputEl = document.getElementById(
  "npcStopDurationMinMsInput",
);
const npcStopDurationMaxMsInputEl = document.getElementById(
  "npcStopDurationMaxMsInput",
);
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
const DEFAULT_GAMEPLAY_SETTINGS = Object.freeze({
  totalCharacters: 20,
  maxPlayers: 10,
  minPlayersToStart: 2,
  npcDownedRespawnSeconds: 8,
  playerAttackCooldownSeconds: 2,
  attackHalfAngleDegrees: 18,
  moveSpeedMetersPerSecond: 2.9,
  playerSprintMultiplier: 1.45,
});
const DEFAULT_AI_BEHAVIOR_SETTINGS = Object.freeze({
  npcInspectDownedChancePercent: 75,
  npcInspectDownedNearbyRadiusMeters: 8.5,
  npcSocialSeparationPercent: 45,
  npcStopChancePercent: 25,
  npcMoveDecisionIntervalMinMs: 600,
  npcMoveDecisionIntervalMaxMs: 1800,
  npcStopDurationMinMs: 600,
  npcStopDurationMaxMs: 1800,
});

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  if (!token) sessionStorage.removeItem(TOKEN_KEY);
  else sessionStorage.setItem(TOKEN_KEY, token);
}

function resolveToken() {
  const typed = tokenEl?.value?.trim() || "";
  const saved = getToken().trim();
  const token = typed || saved;
  if (token) setToken(token);
  return token;
}

function buildDebugUrl(path) {
  return new URL(path, location.origin);
}

function debugHeaders(token, extra) {
  return Object.assign(
    { Accept: "application/json" },
    token ? { "x-debug-token": token } : {},
    extra || {},
  );
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

function readOptionalPatchedIntField(inputEl, fieldName, currentValue) {
  const raw = inputEl?.value?.trim() || "";
  const hasCurrent = Number.isFinite(Number(currentValue));
  if (!raw) {
    if (hasCurrent) return { changed: false, value: Number(currentValue) };
    throw new Error(`${fieldName} saknas.`);
  }
  if (hasCurrent && String(Number(currentValue)) === raw) {
    return { changed: false, value: Number(currentValue) };
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldName} måste vara ett heltal >= 1.`);
  }
  return { changed: true, value: parsed };
}

function readOptionalPatchedNumberField(
  inputEl,
  fieldName,
  currentValue,
  { min, max, step = null } = {},
) {
  const raw = inputEl?.value?.trim() || "";
  const hasCurrent = Number.isFinite(Number(currentValue));
  if (!raw) {
    if (hasCurrent) return { changed: false, value: Number(currentValue) };
    throw new Error(`${fieldName} saknas.`);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} måste vara ett giltigt tal.`);
  }
  if (Number.isFinite(min) && parsed < min) {
    throw new Error(`${fieldName} måste vara minst ${min}.`);
  }
  if (Number.isFinite(max) && parsed > max) {
    throw new Error(`${fieldName} får vara max ${max}.`);
  }
  const normalized =
    Number.isFinite(step) && step > 0
      ? Number((Math.round(parsed / step) * step).toFixed(4))
      : parsed;
  if (hasCurrent && Math.abs(Number(currentValue) - normalized) < 0.0001) {
    return { changed: false, value: Number(currentValue) };
  }
  return { changed: true, value: normalized };
}

function setSliderValueLabel(valueEl, text) {
  if (!valueEl) return;
  valueEl.textContent = text;
}

function renderAiSliderLabels() {
  const stopChance = Number(npcStopChanceInputEl?.value || 0);
  const chance = Number(npcInspectDownedChanceInputEl?.value || 0);
  const radius = Number(npcInspectDownedRadiusInputEl?.value || 0);
  const spread = Number(npcSocialSeparationInputEl?.value || 0);
  setSliderValueLabel(npcStopChanceValueEl, `${Math.round(stopChance)}%`);
  setSliderValueLabel(npcInspectDownedChanceValueEl, `${Math.round(chance)}%`);
  setSliderValueLabel(npcInspectDownedRadiusValueEl, `${radius.toFixed(1)} m`);
  setSliderValueLabel(npcSocialSeparationValueEl, `${Math.round(spread)}%`);
}

function resolvedGameplaySettings(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = { ...DEFAULT_GAMEPLAY_SETTINGS };
  const isFiniteInRange = (value, min, max) =>
    Number.isFinite(value) && value >= min && value <= max;
  const setIntIfFinite = (key, value) => {
    const n = Number(value);
    if (Number.isFinite(n) && Number.isInteger(n)) out[key] = n;
  };
  const setNumberIfFinite = (key, value, min, max) => {
    const n = Number(value);
    if (isFiniteInRange(n, min, max)) out[key] = n;
  };
  setIntIfFinite("totalCharacters", src.totalCharacters);
  setIntIfFinite("maxPlayers", src.maxPlayers);
  setIntIfFinite("minPlayersToStart", src.minPlayersToStart);
  setIntIfFinite("npcDownedRespawnSeconds", src.npcDownedRespawnSeconds);
  setIntIfFinite(
    "playerAttackCooldownSeconds",
    src.playerAttackCooldownSeconds,
  );
  setNumberIfFinite(
    "attackHalfAngleDegrees",
    src.attackHalfAngleDegrees,
    2,
    60,
  );
  setNumberIfFinite(
    "moveSpeedMetersPerSecond",
    src.moveSpeedMetersPerSecond,
    0.5,
    8,
  );
  setNumberIfFinite("playerSprintMultiplier", src.playerSprintMultiplier, 1, 3);
  return out;
}

function resolvedAiBehaviorSettings(input) {
  const src = input && typeof input === "object" ? input : {};
  const moveScaleLegacy = Number(src.npcMoveDecisionFrequencyPercent);
  const stopScaleLegacy = Number(src.npcStopDurationPercent);
  const useMoveLegacy = Number.isFinite(moveScaleLegacy);
  const useStopLegacy = Number.isFinite(stopScaleLegacy);
  const moveScale = useMoveLegacy ? Math.max(0.4, moveScaleLegacy / 100) : 1;
  const stopScale = useStopLegacy ? Math.max(0.4, stopScaleLegacy / 100) : 1;

  const moveMinLegacy = Math.round(
    DEFAULT_AI_BEHAVIOR_SETTINGS.npcMoveDecisionIntervalMinMs / moveScale,
  );
  const moveMaxLegacy = Math.round(
    DEFAULT_AI_BEHAVIOR_SETTINGS.npcMoveDecisionIntervalMaxMs / moveScale,
  );
  const stopMinLegacy = Math.round(
    DEFAULT_AI_BEHAVIOR_SETTINGS.npcStopDurationMinMs * stopScale,
  );
  const stopMaxLegacy = Math.round(
    DEFAULT_AI_BEHAVIOR_SETTINGS.npcStopDurationMaxMs * stopScale,
  );

  const out = {
    ...DEFAULT_AI_BEHAVIOR_SETTINGS,
  };
  const setIfFinite = (key, value) => {
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = n;
  };
  setIfFinite(
    "npcInspectDownedChancePercent",
    src.npcInspectDownedChancePercent,
  );
  setIfFinite(
    "npcInspectDownedNearbyRadiusMeters",
    src.npcInspectDownedNearbyRadiusMeters,
  );
  setIfFinite("npcSocialSeparationPercent", src.npcSocialSeparationPercent);
  setIfFinite("npcStopChancePercent", src.npcStopChancePercent);
  setIfFinite("npcMoveDecisionIntervalMinMs", src.npcMoveDecisionIntervalMinMs);
  setIfFinite("npcMoveDecisionIntervalMaxMs", src.npcMoveDecisionIntervalMaxMs);
  setIfFinite("npcStopDurationMinMs", src.npcStopDurationMinMs);
  setIfFinite("npcStopDurationMaxMs", src.npcStopDurationMaxMs);

  if (
    !Number.isFinite(Number(src.npcMoveDecisionIntervalMinMs)) &&
    useMoveLegacy
  ) {
    out.npcMoveDecisionIntervalMinMs = moveMinLegacy;
  }
  if (
    !Number.isFinite(Number(src.npcMoveDecisionIntervalMaxMs)) &&
    useMoveLegacy
  ) {
    out.npcMoveDecisionIntervalMaxMs = moveMaxLegacy;
  }
  if (!Number.isFinite(Number(src.npcStopDurationMinMs)) && useStopLegacy) {
    out.npcStopDurationMinMs = stopMinLegacy;
  }
  if (!Number.isFinite(Number(src.npcStopDurationMaxMs)) && useStopLegacy) {
    out.npcStopDurationMaxMs = stopMaxLegacy;
  }
  if (out.npcMoveDecisionIntervalMinMs > out.npcMoveDecisionIntervalMaxMs) {
    out.npcMoveDecisionIntervalMaxMs = out.npcMoveDecisionIntervalMinMs;
  }
  if (out.npcStopDurationMinMs > out.npcStopDurationMaxMs) {
    out.npcStopDurationMaxMs = out.npcStopDurationMinMs;
  }
  return out;
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
  const cpuLoadHost =
    host.cpuLoadPercent == null ? "-" : `${host.cpuLoadPercent}%`;
  const cpuTempHost =
    host.cpuTempCelsius == null ? "-" : `${host.cpuTempCelsius}\u00b0C`;
  const rows = [
    ["Anslutna nu", fmtN(data?.current?.connected)],
    ["Spelar nu", fmtN(data?.current?.active)],
    ["Peak anslutna", fmtN(data?.peaks?.connected)],
    ["Totala besök", fmtN(data?.totals?.totalConnections)],
    ["Unika namn", fmtN(data?.totals?.uniqueNames)],
    ["Aktiva rum nu", fmtN(data?.current?.roomCountWithSessions)],
    ["Server start", fmtAt(data?.startedAt)],
    ["Host CPU-last", cpuLoadHost],
    ["Host CPU-temp", cpuTempHost],
    ["Host loadavg (1m)", String(host.loadAverage1m ?? "-")],
    [
      "Host RAM",
      `${fmtBytes(host.usedMemoryBytes)} / ${fmtBytes(host.totalMemoryBytes)} (${host.memoryUsagePercent ?? "-"}%)`,
    ],
    [
      "Node CPU",
      `${proc.cpuPercentHostShare ?? "-"}% av host (${proc.cpuPercentSingleCore ?? "-"}% av 1 kärna)`,
    ],
    ["Node RSS", fmtBytes(proc.rssBytes)],
    [
      "Node heap",
      `${fmtBytes(proc.heapUsedBytes)} / ${fmtBytes(proc.heapTotalBytes)}`,
    ],
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
  drawLine("active", "#ffcf6a");
}

function roomLabel(room) {
  if (!room) return "-";
  return room.isPrivate ? room.roomCode || room.roomId : "publik";
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
      names: [],
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
      names: [],
      players: [],
    };
    existing.roomCode = room.roomCode || existing.roomCode;
    existing.isPrivate = Boolean(room.isPrivate);
    existing.hasLive = true;
    existing.names = Array.isArray(room.names) ? room.names : [];
    existing.players = Array.isArray(room.players) ? room.players : [];
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
  const roomLabelById = new Map(
    roomRows.map((room) => [room.roomId, roomLabel(room)]),
  );

  if (roomsEl) {
    roomsEl.textContent = "";
    const visible = roomRows.slice(0, LIST_LIMIT);
    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Inga rum ännu.";
      roomsEl.appendChild(empty);
    } else {
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      for (const [label, width] of [
        ["Status", "72px"],
        ["Rum", "90px"],
        ["Spelare", ""],
      ]) {
        const th = document.createElement("th");
        th.textContent = label;
        if (width) th.style.width = width;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const room of visible) {
        const tr = document.createElement("tr");
        const tdStatus = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = room.hasLive ? "badge" : "badge old";
        badge.textContent = room.hasLive ? "● Aktiv" : "Tidigare";
        tdStatus.appendChild(badge);
        const tdRoom = document.createElement("td");
        tdRoom.textContent = roomLabel(room);
        const tdNames = document.createElement("td");
        tdNames.className = "wrapCell";
        const nameList = room.hasLive
          ? room.names.length > 0
            ? room.names
            : []
          : [...room.uniqueNames];
        if (nameList.length === 0) {
          tdNames.style.color = "var(--muted)";
          tdNames.textContent = room.hasLive ? "(ingen inne)" : "-";
        } else if (room.hasLive && room.players.length > 0) {
          for (const p of room.players) {
            if (!p.name) continue;
            const span = document.createElement("span");
            span.style.marginRight = "8px";
            span.style.whiteSpace = "nowrap";
            const source = p.origin
              ? p.origin.includes("itch.io") ? "🎮" : "🥧"
              : "❓";
            span.textContent = `${source} ${p.name}`;
            span.title = p.origin || "(okänt origin)";
            tdNames.appendChild(span);
          }
        } else {
          tdNames.textContent = nameList.join(", ");
          tdNames.title = nameList.join(", ");
        }
        if (!room.hasLive && room.lastEventAt) {
          tdNames.title = `Senast aktiv: ${fmtAt(room.lastEventAt)}`;
        }
        tr.appendChild(tdStatus);
        tr.appendChild(tdRoom);
        tr.appendChild(tdNames);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      roomsEl.appendChild(table);
    }
  }
  if (playersEl) {
    playersEl.textContent = "";
    const players = Array.isArray(data?.players)
      ? data.players.slice(0, LIST_LIMIT)
      : [];
    if (players.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Inga namn loggade ännu.";
      playersEl.appendChild(empty);
    } else {
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      for (const [label, width] of [
        ["Namn", "130px"],
        ["Senast sedd", "148px"],
        ["Rum", ""],
      ]) {
        const th = document.createElement("th");
        th.textContent = label;
        if (width) th.style.width = width;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const p of players) {
        const tr = document.createElement("tr");
        const tdName = document.createElement("td");
        tdName.textContent = p.name;
        tdName.style.fontWeight = "500";
        const tdSeen = document.createElement("td");
        tdSeen.textContent = fmtAt(p.lastSeenAt);
        tdSeen.style.color = "var(--muted)";
        const tdRooms = document.createElement("td");
        tdRooms.className = "wrapCell";
        const roomNames = (p.rooms || []).map(
          (roomId) => roomLabelById.get(roomId) || roomId,
        );
        tdRooms.textContent = roomNames.join(", ") || "-";
        tr.appendChild(tdName);
        tr.appendChild(tdSeen);
        tr.appendChild(tdRooms);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      playersEl.appendChild(table);
    }
  }
  if (eventsEl) {
    const events = Array.isArray(data?.recentEvents)
      ? data.recentEvents.slice(-LIST_LIMIT).reverse()
      : [];
    eventsEl.textContent =
      events.length > 0
        ? events
            .map((event) => {
              const label = roomLabel(event);
              const name = event.name || "Okänd";
              let sentence;
              switch (event.type) {
                case "session_connected":
                  sentence = `Ny anslutning till ${label} rum.`;
                  break;
                case "session_disconnected":
                  sentence = `${name} kopplades bort från ${label} rum.`;
                  break;
                case "session_login":
                  sentence = `${name} loggade in i ${label} rum.`;
                  break;
                case "countdown_start":
                  sentence = `Nedräkning startad i ${label} rum.`;
                  break;
                case "session_possess":
                  sentence = `${name} tog kontroll över en karaktär (${label}).`;
                  break;
                case "attack":
                  sentence = `En attack genomfördes i ${label} rum.`;
                  break;
                case "player_eliminated":
                  sentence = `${name} slogs ut i ${label} rum.`;
                  break;
                case "character_respawn":
                  sentence = `En karaktär återuppstod i ${label} rum.`;
                  break;
                case "chat":
                  sentence = `${name} skickade ett meddelande i ${label} rum.`;
                  break;
                case "heartbeat_timeout":
                  sentence = `${name} tappade uppkopplingen (${label} rum).`;
                  break;
                case "message_drop":
                  sentence = `Meddelande ignorerat pga. hög frekvens (${label} rum).`;
                  break;
                default:
                  sentence = `${event.type} i ${label} rum${event.name ? ` (${event.name})` : ""}.`;
              }
              return `${fmtAt(event.at)}  ${sentence}`;
            })
            .join("\n")
        : "Inga händelser ännu.";
  }
  if (chatEl) {
    chatEl.textContent = "";
    const chats = Array.isArray(data?.recentChat)
      ? data.recentChat.slice(-LIST_LIMIT).reverse()
      : [];
    if (chats.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Ingen chat ännu.";
      chatEl.appendChild(empty);
    } else {
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      for (const [label, width] of [
        ["Tid", "148px"],
        ["Namn", "120px"],
        ["Meddelande", ""],
      ]) {
        const th = document.createElement("th");
        th.textContent = label;
        if (width) th.style.width = width;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const msg of chats) {
        const tr = document.createElement("tr");
        const tdTime = document.createElement("td");
        tdTime.textContent = fmtAt(msg.at);
        tdTime.style.color = "var(--muted)";
        const tdName = document.createElement("td");
        tdName.textContent = msg.name;
        tdName.style.fontWeight = "500";
        const tdText = document.createElement("td");
        tdText.textContent = msg.text;
        tdText.style.whiteSpace = "pre-wrap";
        tr.appendChild(tdTime);
        tr.appendChild(tdName);
        tr.appendChild(tdText);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      chatEl.appendChild(table);
    }
  }
  if (metaEl) {
    const host = data?.systemMetrics?.host || {};
    const proc = data?.systemMetrics?.process || {};
    metaEl.textContent = `Senast uppdaterad: ${fmtAt(data?.generatedAt)} | Host: ${host.hostname || "-"} (${host.platform || "-"} ${host.arch || "-"}) | PID: ${proc.pid || "-"} | Loggar: logs/debug-events.log + logs/debug-samples.jsonl`;
  }
}

function renderSettings(settings) {
  if (!layoutSelectEl) return;
  const available = Array.isArray(settings?.availableLayouts)
    ? settings.availableLayouts
    : [];
  const activeLayoutId = String(settings?.layout?.id || "");
  const activeWarnings = Array.isArray(settings?.layout?.warnings)
    ? settings.layout.warnings
    : [];

  layoutSelectEl.textContent = "";
  for (const entry of available) {
    const option = document.createElement("option");
    option.value = entry.id;
    const width = Number(entry.worldWidthMeters ?? entry.worldSizeMeters);
    const height = Number(entry.worldHeightMeters ?? entry.worldSizeMeters);
    const sizeText =
      Number.isFinite(width) && Number.isFinite(height)
        ? `${width}x${height} m`
        : "-";
    const warningCount = Array.isArray(entry?.warnings)
      ? entry.warnings.length
      : 0;
    const warningTag = warningCount > 0 ? " [VARNING]" : "";
    option.textContent = `${entry.fileName || entry.label || entry.id} (${sizeText})${warningTag}`;
    layoutSelectEl.appendChild(option);
  }
  if (activeLayoutId) layoutSelectEl.value = activeLayoutId;

  const gameplay = resolvedGameplaySettings(settings?.gameplaySettings);
  const aiBehavior = resolvedAiBehaviorSettings(settings?.aiBehaviorSettings);
  if (
    totalCharactersInputEl &&
    Number.isFinite(Number(gameplay.totalCharacters))
  ) {
    totalCharactersInputEl.value = String(gameplay.totalCharacters);
  }
  if (maxPlayersInputEl && Number.isFinite(Number(gameplay.maxPlayers))) {
    maxPlayersInputEl.value = String(gameplay.maxPlayers);
  }
  if (
    minPlayersToStartInputEl &&
    Number.isFinite(Number(gameplay.minPlayersToStart))
  ) {
    minPlayersToStartInputEl.value = String(gameplay.minPlayersToStart);
  }
  if (
    npcDownedRespawnSecondsInputEl &&
    Number.isFinite(Number(gameplay.npcDownedRespawnSeconds))
  ) {
    npcDownedRespawnSecondsInputEl.value = String(
      gameplay.npcDownedRespawnSeconds,
    );
  }
  if (
    playerAttackCooldownSecondsInputEl &&
    Number.isFinite(Number(gameplay.playerAttackCooldownSeconds))
  ) {
    playerAttackCooldownSecondsInputEl.value = String(
      gameplay.playerAttackCooldownSeconds,
    );
  }
  if (
    attackHalfAngleDegreesInputEl &&
    Number.isFinite(Number(gameplay.attackHalfAngleDegrees))
  ) {
    attackHalfAngleDegreesInputEl.value = String(
      gameplay.attackHalfAngleDegrees,
    );
  }
  if (
    moveSpeedMetersPerSecondInputEl &&
    Number.isFinite(Number(gameplay.moveSpeedMetersPerSecond))
  ) {
    moveSpeedMetersPerSecondInputEl.value = String(
      gameplay.moveSpeedMetersPerSecond,
    );
  }
  if (
    playerSprintMultiplierInputEl &&
    Number.isFinite(Number(gameplay.playerSprintMultiplier))
  ) {
    playerSprintMultiplierInputEl.value = String(
      gameplay.playerSprintMultiplier,
    );
  }
  if (npcInspectDownedChanceInputEl)
    npcInspectDownedChanceInputEl.value = String(
      aiBehavior.npcInspectDownedChancePercent,
    );
  if (npcInspectDownedRadiusInputEl)
    npcInspectDownedRadiusInputEl.value = String(
      aiBehavior.npcInspectDownedNearbyRadiusMeters,
    );
  if (npcSocialSeparationInputEl)
    npcSocialSeparationInputEl.value = String(
      aiBehavior.npcSocialSeparationPercent,
    );
  if (npcStopChanceInputEl)
    npcStopChanceInputEl.value = String(aiBehavior.npcStopChancePercent);
  if (npcMoveDecisionIntervalMinMsInputEl)
    npcMoveDecisionIntervalMinMsInputEl.value = String(
      aiBehavior.npcMoveDecisionIntervalMinMs,
    );
  if (npcMoveDecisionIntervalMaxMsInputEl)
    npcMoveDecisionIntervalMaxMsInputEl.value = String(
      aiBehavior.npcMoveDecisionIntervalMaxMs,
    );
  if (npcStopDurationMinMsInputEl)
    npcStopDurationMinMsInputEl.value = String(aiBehavior.npcStopDurationMinMs);
  if (npcStopDurationMaxMsInputEl)
    npcStopDurationMaxMsInputEl.value = String(aiBehavior.npcStopDurationMaxMs);
  renderAiSliderLabels();

  if (settingsInfoEl) {
    const activeLabel =
      settings?.layout?.fileName ||
      settings?.layout?.label ||
      activeLayoutId ||
      "-";
    const activeWidth = Number(
      settings?.layout?.worldWidthMeters ?? settings?.layout?.worldSizeMeters,
    );
    const activeHeight = Number(
      settings?.layout?.worldHeightMeters ?? settings?.layout?.worldSizeMeters,
    );
    const activeSize =
      Number.isFinite(activeWidth) && Number.isFinite(activeHeight)
        ? `${activeWidth}x${activeHeight} meter`
        : null;
    const infoMax = Number.isFinite(Number(gameplay.maxPlayers))
      ? gameplay.maxPlayers
      : "-";
    const infoChars = Number.isFinite(Number(gameplay.totalCharacters))
      ? gameplay.totalCharacters
      : "-";
    const infoMinStart = Number.isFinite(Number(gameplay.minPlayersToStart))
      ? gameplay.minPlayersToStart
      : "-";
    const infoNpcRespawn = Number.isFinite(
      Number(gameplay.npcDownedRespawnSeconds),
    )
      ? gameplay.npcDownedRespawnSeconds
      : "-";
    const infoAttackCooldown = Number.isFinite(
      Number(gameplay.playerAttackCooldownSeconds),
    )
      ? gameplay.playerAttackCooldownSeconds
      : "-";
    const infoAttackHalfAngle = Number.isFinite(
      Number(gameplay.attackHalfAngleDegrees),
    )
      ? gameplay.attackHalfAngleDegrees
      : "-";
    const infoMoveSpeed = Number.isFinite(
      Number(gameplay.moveSpeedMetersPerSecond),
    )
      ? gameplay.moveSpeedMetersPerSecond
      : "-";
    const infoSprintMultiplier = Number.isFinite(
      Number(gameplay.playerSprintMultiplier),
    )
      ? gameplay.playerSprintMultiplier
      : "-";
    const infoInspectChance = Number.isFinite(
      Number(aiBehavior.npcInspectDownedChancePercent),
    )
      ? aiBehavior.npcInspectDownedChancePercent
      : "-";
    const infoInspectRadius = Number.isFinite(
      Number(aiBehavior.npcInspectDownedNearbyRadiusMeters),
    )
      ? aiBehavior.npcInspectDownedNearbyRadiusMeters
      : "-";
    const infoSpread = Number.isFinite(
      Number(aiBehavior.npcSocialSeparationPercent),
    )
      ? aiBehavior.npcSocialSeparationPercent
      : "-";
    const infoStopChance = Number.isFinite(
      Number(aiBehavior.npcStopChancePercent),
    )
      ? aiBehavior.npcStopChancePercent
      : "-";
    const infoMoveDecisionMin = Number.isFinite(
      Number(aiBehavior.npcMoveDecisionIntervalMinMs),
    )
      ? aiBehavior.npcMoveDecisionIntervalMinMs
      : "-";
    const infoMoveDecisionMax = Number.isFinite(
      Number(aiBehavior.npcMoveDecisionIntervalMaxMs),
    )
      ? aiBehavior.npcMoveDecisionIntervalMaxMs
      : "-";
    const infoStopDurationMin = Number.isFinite(
      Number(aiBehavior.npcStopDurationMinMs),
    )
      ? aiBehavior.npcStopDurationMinMs
      : "-";
    const infoStopDurationMax = Number.isFinite(
      Number(aiBehavior.npcStopDurationMaxMs),
    )
      ? aiBehavior.npcStopDurationMaxMs
      : "-";
    const warningText =
      activeWarnings.length > 0
        ? ` VARNING: ${activeWarnings.map((warning) => warning?.message || "Okänd varning").join(" | ")}`
        : "";
    settingsInfoEl.textContent = `Aktiv karta: ${activeLabel}${activeSize ? ` (${activeSize})` : ""}. Karaktärer: ${infoChars}, max spelare: ${infoMax}, min start: ${infoMinStart}, NPC återresning: ${infoNpcRespawn}s, slag-cooldown: ${infoAttackCooldown}s, träffkon: ${infoAttackHalfAngle} grader, gångfart: ${infoMoveSpeed} m/s, spelar-sprintfaktor: ${infoSprintMultiplier}x, AI tid mellan beslut: ${infoMoveDecisionMin}-${infoMoveDecisionMax} ms, AI stoppchans vid beslut: ${infoStopChance}%, AI stopptid: ${infoStopDurationMin}-${infoStopDurationMax} ms, AI kolla-chans: ${infoInspectChance}%, AI sök-radie: ${infoInspectRadius}m, AI spridning: ${infoSpread}%.${warningText} Ändringar startar om aktiva rum.`;
  }
}

function hasUnsavedSettingsFormChanges(referenceSettings) {
  const settings = referenceSettings || cachedSettings || {};
  const gameplay = resolvedGameplaySettings(settings?.gameplaySettings);
  const aiBehavior = resolvedAiBehaviorSettings(settings?.aiBehaviorSettings);
  const referenceLayoutId = String(settings?.layout?.id || "");
  const selectedLayoutId = String(layoutSelectEl?.value || "");
  if (
    referenceLayoutId &&
    selectedLayoutId &&
    referenceLayoutId !== selectedLayoutId
  )
    return true;

  const pairs = [
    [totalCharactersInputEl, gameplay.totalCharacters],
    [maxPlayersInputEl, gameplay.maxPlayers],
    [minPlayersToStartInputEl, gameplay.minPlayersToStart],
    [npcDownedRespawnSecondsInputEl, gameplay.npcDownedRespawnSeconds],
    [playerAttackCooldownSecondsInputEl, gameplay.playerAttackCooldownSeconds],
    [attackHalfAngleDegreesInputEl, gameplay.attackHalfAngleDegrees],
    [moveSpeedMetersPerSecondInputEl, gameplay.moveSpeedMetersPerSecond],
    [playerSprintMultiplierInputEl, gameplay.playerSprintMultiplier],
  ];
  for (const [inputEl, expectedValue] of pairs) {
    const currentRaw = inputEl?.value?.trim() || "";
    const expectedRaw = Number.isFinite(Number(expectedValue))
      ? String(Number(expectedValue))
      : "";
    if (currentRaw && expectedRaw && currentRaw !== expectedRaw) return true;
  }

  const aiPairs = [
    [npcInspectDownedChanceInputEl, aiBehavior.npcInspectDownedChancePercent],
    [
      npcInspectDownedRadiusInputEl,
      aiBehavior.npcInspectDownedNearbyRadiusMeters,
    ],
    [npcSocialSeparationInputEl, aiBehavior.npcSocialSeparationPercent],
    [npcStopChanceInputEl, aiBehavior.npcStopChancePercent],
    [
      npcMoveDecisionIntervalMinMsInputEl,
      aiBehavior.npcMoveDecisionIntervalMinMs,
    ],
    [
      npcMoveDecisionIntervalMaxMsInputEl,
      aiBehavior.npcMoveDecisionIntervalMaxMs,
    ],
    [npcStopDurationMinMsInputEl, aiBehavior.npcStopDurationMinMs],
    [npcStopDurationMaxMsInputEl, aiBehavior.npcStopDurationMaxMs],
  ];
  for (const [inputEl, expectedValue] of aiPairs) {
    const currentRaw = inputEl?.value?.trim() || "";
    const expectedRaw = Number.isFinite(Number(expectedValue))
      ? String(Number(expectedValue))
      : "";
    if (currentRaw && expectedRaw && currentRaw !== expectedRaw) return true;
  }
  return false;
}

function mergeSettingsFromStats(data) {
  if (!data || typeof data !== "object") return;
  const layout = data.layout;
  const gameplaySettings = data.gameplaySettings;
  const aiBehaviorSettings = data.aiBehaviorSettings;
  const hasLayout = layout && typeof layout === "object";
  const hasGameplay = gameplaySettings && typeof gameplaySettings === "object";
  const hasAiBehavior =
    aiBehaviorSettings && typeof aiBehaviorSettings === "object";
  if (!hasLayout && !hasGameplay && !hasAiBehavior) return;
  const source = cachedSettings || {};
  const hadUnsavedChanges =
    activeTab === "settings" && hasUnsavedSettingsFormChanges(source);
  const availableLayouts = Array.isArray(source.availableLayouts)
    ? source.availableLayouts
    : [];
  const nextSettings = {
    layout: hasLayout ? layout : source.layout,
    gameplaySettings: hasGameplay ? gameplaySettings : source.gameplaySettings,
    aiBehaviorSettings: hasAiBehavior
      ? aiBehaviorSettings
      : source.aiBehaviorSettings,
    availableLayouts,
  };
  cachedSettings = nextSettings;
  if (hadUnsavedChanges) return;
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
    const url = buildDebugUrl("/api/debug/stats");
    const res = await fetch(url, {
      cache: "no-store",
      headers: debugHeaders(token),
    });
    if (res.status === 503) {
      setError(
        "Servern saknar DEBUG_VIEW_TOKEN. Sätt den i miljön och starta om.",
      );
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
    const url = buildDebugUrl("/api/debug/settings");
    const res = await fetch(url, {
      cache: "no-store",
      headers: debugHeaders(token),
    });
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
    const currentGameplay = resolvedGameplaySettings(
      cachedSettings?.gameplaySettings,
    );
    const currentAiBehavior = resolvedAiBehaviorSettings(
      cachedSettings?.aiBehaviorSettings,
    );
    const totalCharactersPatch = readOptionalPatchedIntField(
      totalCharactersInputEl,
      "Antal karaktärer",
      currentGameplay.totalCharacters,
    );
    const maxPlayersPatch = readOptionalPatchedIntField(
      maxPlayersInputEl,
      "Max antal spelare",
      currentGameplay.maxPlayers,
    );
    const minPlayersToStartPatch = readOptionalPatchedIntField(
      minPlayersToStartInputEl,
      "Min spelare för spelstart",
      currentGameplay.minPlayersToStart,
    );
    const npcDownedRespawnSecondsPatch = readOptionalPatchedIntField(
      npcDownedRespawnSecondsInputEl,
      "NPC återresning (sek)",
      currentGameplay.npcDownedRespawnSeconds,
    );
    const playerAttackCooldownSecondsPatch = readOptionalPatchedIntField(
      playerAttackCooldownSecondsInputEl,
      "Spelarslag cooldown (sek)",
      currentGameplay.playerAttackCooldownSeconds,
    );
    const attackHalfAngleDegreesPatch = readOptionalPatchedNumberField(
      attackHalfAngleDegreesInputEl,
      "Träffkon halvbredd (grader)",
      currentGameplay.attackHalfAngleDegrees,
      { min: 2, max: 60, step: 0.5 },
    );
    const moveSpeedMetersPerSecondPatch = readOptionalPatchedNumberField(
      moveSpeedMetersPerSecondInputEl,
      "Gångfart spelare + NPC (m/s)",
      currentGameplay.moveSpeedMetersPerSecond,
      { min: 0.5, max: 8, step: 0.05 },
    );
    const playerSprintMultiplierPatch = readOptionalPatchedNumberField(
      playerSprintMultiplierInputEl,
      "Spelare sprintfaktor (x)",
      currentGameplay.playerSprintMultiplier,
      { min: 1, max: 3, step: 0.05 },
    );
    const npcInspectDownedChancePatch = readOptionalPatchedNumberField(
      npcInspectDownedChanceInputEl,
      "Kolla nedslagen NPC (chans)",
      currentAiBehavior.npcInspectDownedChancePercent,
      { min: 0, max: 100, step: 1 },
    );
    const npcInspectDownedRadiusPatch = readOptionalPatchedNumberField(
      npcInspectDownedRadiusInputEl,
      "Sök-radie till nedslagen NPC",
      currentAiBehavior.npcInspectDownedNearbyRadiusMeters,
      { min: 2, max: 20, step: 0.5 },
    );
    const npcSocialSeparationPatch = readOptionalPatchedNumberField(
      npcSocialSeparationInputEl,
      "Spridningstendens",
      currentAiBehavior.npcSocialSeparationPercent,
      { min: 0, max: 100, step: 1 },
    );
    const npcStopChancePatch = readOptionalPatchedNumberField(
      npcStopChanceInputEl,
      "Stopfrekvens",
      currentAiBehavior.npcStopChancePercent,
      { min: 0, max: 100, step: 1 },
    );
    const npcMoveDecisionIntervalMinMsPatch = readOptionalPatchedIntField(
      npcMoveDecisionIntervalMinMsInputEl,
      "Rörelsefrekvens min (ms)",
      currentAiBehavior.npcMoveDecisionIntervalMinMs,
    );
    const npcMoveDecisionIntervalMaxMsPatch = readOptionalPatchedIntField(
      npcMoveDecisionIntervalMaxMsInputEl,
      "Rörelsefrekvens max (ms)",
      currentAiBehavior.npcMoveDecisionIntervalMaxMs,
    );
    const npcStopDurationMinMsPatch = readOptionalPatchedIntField(
      npcStopDurationMinMsInputEl,
      "Stopplängd min (ms)",
      currentAiBehavior.npcStopDurationMinMs,
    );
    const npcStopDurationMaxMsPatch = readOptionalPatchedIntField(
      npcStopDurationMaxMsInputEl,
      "Stopplängd max (ms)",
      currentAiBehavior.npcStopDurationMaxMs,
    );

    const totalCharacters = totalCharactersPatch.value;
    const maxPlayers = maxPlayersPatch.value;
    const minPlayersToStart = minPlayersToStartPatch.value;
    const npcDownedRespawnSeconds = npcDownedRespawnSecondsPatch.value;
    const playerAttackCooldownSeconds = playerAttackCooldownSecondsPatch.value;
    const attackHalfAngleDegrees = attackHalfAngleDegreesPatch.value;
    const moveSpeedMetersPerSecond = moveSpeedMetersPerSecondPatch.value;
    const playerSprintMultiplier = playerSprintMultiplierPatch.value;
    const npcInspectDownedChancePercent = npcInspectDownedChancePatch.value;
    const npcInspectDownedNearbyRadiusMeters =
      npcInspectDownedRadiusPatch.value;
    const npcSocialSeparationPercent = npcSocialSeparationPatch.value;
    const npcStopChancePercent = npcStopChancePatch.value;
    const npcMoveDecisionIntervalMinMs =
      npcMoveDecisionIntervalMinMsPatch.value;
    const npcMoveDecisionIntervalMaxMs =
      npcMoveDecisionIntervalMaxMsPatch.value;
    const npcStopDurationMinMs = npcStopDurationMinMsPatch.value;
    const npcStopDurationMaxMs = npcStopDurationMaxMsPatch.value;

    const gameplayChanged =
      totalCharactersPatch.changed ||
      maxPlayersPatch.changed ||
      minPlayersToStartPatch.changed ||
      npcDownedRespawnSecondsPatch.changed ||
      playerAttackCooldownSecondsPatch.changed ||
      attackHalfAngleDegreesPatch.changed ||
      moveSpeedMetersPerSecondPatch.changed ||
      playerSprintMultiplierPatch.changed;
    const aiBehaviorChanged =
      npcInspectDownedChancePatch.changed ||
      npcInspectDownedRadiusPatch.changed ||
      npcSocialSeparationPatch.changed ||
      npcStopChancePatch.changed ||
      npcMoveDecisionIntervalMinMsPatch.changed ||
      npcMoveDecisionIntervalMaxMsPatch.changed ||
      npcStopDurationMinMsPatch.changed ||
      npcStopDurationMaxMsPatch.changed;

    if (maxPlayers >= totalCharacters) {
      setSettingsStatus(
        "Max antal spelare måste vara mindre än antal karaktärer.",
        true,
      );
      return;
    }
    if (minPlayersToStart < 2) {
      setSettingsStatus("Min spelare för spelstart måste vara minst 2.", true);
      return;
    }
    if (minPlayersToStart > maxPlayers) {
      setSettingsStatus(
        "Min spelare för spelstart kan inte vara större än max antal spelare.",
        true,
      );
      return;
    }
    if (npcMoveDecisionIntervalMinMs > npcMoveDecisionIntervalMaxMs) {
      setSettingsStatus(
        "Rörelsefrekvens min (ms) kan inte vara större än max.",
        true,
      );
      return;
    }
    if (npcStopDurationMinMs > npcStopDurationMaxMs) {
      setSettingsStatus(
        "Stopplängd min (ms) kan inte vara större än max.",
        true,
      );
      return;
    }

    const payload = {};
    payload.layoutId = layoutId;
    if (gameplayChanged) {
      payload.totalCharacters = totalCharacters;
      payload.maxPlayers = maxPlayers;
      payload.minPlayersToStart = minPlayersToStart;
      payload.npcDownedRespawnSeconds = npcDownedRespawnSeconds;
      payload.playerAttackCooldownSeconds = playerAttackCooldownSeconds;
      payload.attackHalfAngleDegrees = attackHalfAngleDegrees;
      payload.moveSpeedMetersPerSecond = moveSpeedMetersPerSecond;
      payload.playerSprintMultiplier = playerSprintMultiplier;
    }
    if (aiBehaviorChanged) {
      payload.npcInspectDownedChancePercent = npcInspectDownedChancePercent;
      payload.npcInspectDownedNearbyRadiusMeters =
        npcInspectDownedNearbyRadiusMeters;
      payload.npcSocialSeparationPercent = npcSocialSeparationPercent;
      payload.npcStopChancePercent = npcStopChancePercent;
      payload.npcMoveDecisionIntervalMinMs = npcMoveDecisionIntervalMinMs;
      payload.npcMoveDecisionIntervalMaxMs = npcMoveDecisionIntervalMaxMs;
      payload.npcStopDurationMinMs = npcStopDurationMinMs;
      payload.npcStopDurationMaxMs = npcStopDurationMaxMs;
    }

    const url = buildDebugUrl("/api/debug/settings");
    const res = await fetch(url, {
      method: "POST",
      headers: debugHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
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
    const activeName =
      data?.layout?.fileName || data?.layout?.label || data?.layout?.id || "-";
    setSettingsStatus(
      `Settings sparade. Aktiv karta: ${activeName}. Rum har startats om.`,
    );
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
npcInspectDownedChanceInputEl?.addEventListener("input", renderAiSliderLabels);
npcInspectDownedRadiusInputEl?.addEventListener("input", renderAiSliderLabels);
npcSocialSeparationInputEl?.addEventListener("input", renderAiSliderLabels);
npcStopChanceInputEl?.addEventListener("input", renderAiSliderLabels);
window.addEventListener("resize", () => {
  refresh();
});

if (tokenEl) tokenEl.value = getToken();
setActiveTab("stats");
startPolling();
