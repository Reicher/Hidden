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

let loading = false;
let pollTimer = null;

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  if (!token) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

function setError(text) {
  if (!errorEl) return;
  errorEl.textContent = text || "";
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

function renderText(data) {
  if (roomsEl) {
    const rooms = Array.isArray(data?.liveRooms) ? data.liveRooms : data?.rooms || [];
    roomsEl.textContent =
      rooms.length > 0
        ? rooms
            .map((room) => {
              const c = room.current || {};
              const label = room.isPrivate ? `privat:${room.roomCode || room.roomId}` : "publik";
              const names = Array.isArray(room.authenticatedNames) ? room.authenticatedNames : [];
              return `${label}\nnu: ansl=${c.connected || 0} inlogg=${c.authenticated || 0} spelar=${c.active || 0}\nnamn: ${
                names.length > 0 ? names.join(", ") : "-"
              }`;
            })
            .join("\n\n")
        : "Inga rum.";
  }
  if (playersEl) {
    const players = Array.isArray(data?.players) ? data.players.slice(0, 80) : [];
    playersEl.textContent =
      players.length > 0
        ? players
            .map((p) => `${p.name} | logins=${p.logins} | senast=${fmtAt(p.lastSeenAt)} | rum=${(p.rooms || []).join(", ")}`)
            .join("\n")
        : "Inga namn loggade ännu.";
  }
  if (eventsEl) {
    const events = Array.isArray(data?.recentEvents) ? data.recentEvents.slice(-80).reverse() : [];
    eventsEl.textContent =
      events.length > 0
        ? events
            .map((event) => {
              const snap = event.snapshot || {};
              const label = event.isPrivate ? `privat:${event.roomCode || event.roomId}` : "publik";
              return `${fmtAt(event.at)} | ${event.type} | ${label} | ${event.name || "-"} | ansl=${snap.connected || 0} inlogg=${snap.authenticated || 0} spelar=${snap.active || 0}`;
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

function render(data) {
  renderSummary(data);
  drawChart(data?.samples || []);
  renderText(data);
}

async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const typed = tokenEl?.value?.trim() || "";
    const saved = getToken().trim();
    const token = typed || saved;
    if (token) setToken(token);
    const url = new URL("/api/debug/stats", location.origin);
    if (token) url.searchParams.set("token", token);
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
});
tokenEl?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  refresh();
});
window.addEventListener("resize", () => {
  refresh();
});

if (tokenEl) tokenEl.value = getToken();
startPolling();
