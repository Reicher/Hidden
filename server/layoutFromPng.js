import fs from "node:fs";
import { basename } from "node:path";
import { PNG } from "pngjs";

const EMPTY_RGB = [255, 255, 255];
const SHELF_COLORS = Object.freeze([
  [0, 0, 0]
]);
const COOLER_COLORS = Object.freeze([
  [0, 102, 255],
  [0, 0, 255],
  [0, 128, 255]
]);
const FREEZER_COLORS = Object.freeze([
  [0, 200, 120],
  [0, 255, 0],
  [0, 180, 0]
]);
const COLOR_TOLERANCE = 12;
const SEGMENT_LEN = 6;

const DIRS = Object.freeze([
  { dx: 0, dy: -1, yaw: 0 }, // +Z
  { dx: 1, dy: 0, yaw: Math.PI / 2 }, // +X
  { dx: 0, dy: 1, yaw: Math.PI }, // -Z
  { dx: -1, dy: 0, yaw: -Math.PI / 2 } // -X
]);

function keyFor(x, y) {
  return `${x},${y}`;
}

function toWorldX(px, width) {
  return px - (width / 2 - 0.5);
}

function toWorldZ(py, height) {
  return height / 2 - 0.5 - py;
}

function rgbAt(data, width, x, y) {
  const offset = (y * width + x) * 4;
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
}

function isInside(x, y, width, height) {
  return x >= 0 && x < width && y >= 0 && y < height;
}

function channelClose(a, b) {
  return Math.abs(a - b) <= COLOR_TOLERANCE;
}

function matchesColor(rgb, paletteColor) {
  return channelClose(rgb[0], paletteColor[0]) && channelClose(rgb[1], paletteColor[1]) && channelClose(rgb[2], paletteColor[2]);
}

function matchesAny(rgb, palette) {
  for (const c of palette) {
    if (matchesColor(rgb, c)) return true;
  }
  return false;
}

function classifyPixel(pixel) {
  const [r, g, b, a] = pixel;
  if (a < 128) return "empty";
  const rgb = [r, g, b];
  if (matchesAny(rgb, SHELF_COLORS)) return "shelf";
  if (matchesAny(rgb, COOLER_COLORS)) return "cooler";
  if (matchesAny(rgb, FREEZER_COLORS)) return "freezer";
  if (matchesColor(rgb, EMPTY_RGB)) return "empty";
  return "unknown";
}

function findOpenYaw({ x, y, occupied, width, height }) {
  for (const dir of DIRS) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (!isInside(nx, ny, width, height)) continue;
    if (occupied[ny][nx]) continue;
    return dir.yaw;
  }
  return null;
}

function buildShelfSegments(shelfCells, width, height) {
  const sortedCells = [...shelfCells]
    .map((k) => k.split(",").map(Number))
    .sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));

  const segments = [];
  const cellToSegments = new Map();

  function addCandidate(cells, yaw) {
    const segmentId = segments.length;
    segments.push({ cells, yaw });
    for (const cell of cells) {
      const key = keyFor(cell[0], cell[1]);
      if (!cellToSegments.has(key)) cellToSegments.set(key, []);
      cellToSegments.get(key).push(segmentId);
    }
  }

  for (const [x, y] of sortedCells) {
    let horizontalOk = true;
    const horizontalCells = [];
    for (let i = 0; i < SEGMENT_LEN; i += 1) {
      const nx = x + i;
      if (!isInside(nx, y, width, height) || !shelfCells.has(keyFor(nx, y))) {
        horizontalOk = false;
        break;
      }
      horizontalCells.push([nx, y]);
    }
    if (horizontalOk) addCandidate(horizontalCells, Math.PI / 2);

    let verticalOk = true;
    const verticalCells = [];
    for (let i = 0; i < SEGMENT_LEN; i += 1) {
      const ny = y + i;
      if (!isInside(x, ny, width, height) || !shelfCells.has(keyFor(x, ny))) {
        verticalOk = false;
        break;
      }
      verticalCells.push([x, ny]);
    }
    if (verticalOk) addCandidate(verticalCells, 0);
  }

  if (segments.length === 0 && shelfCells.size > 0) {
    throw new Error("Hyllpixlar finns, men inga giltiga 1x6-segment hittades.");
  }

  const used = new Array(segments.length).fill(false);
  const covered = new Set();
  const solution = [];

  function pickNextCell() {
    let bestKey = null;
    let bestCandidates = null;
    let bestCount = Infinity;

    for (const key of shelfCells) {
      if (covered.has(key)) continue;
      const candidates = (cellToSegments.get(key) || []).filter((id) => {
        if (used[id]) return false;
        const seg = segments[id];
        for (const cell of seg.cells) {
          if (covered.has(keyFor(cell[0], cell[1]))) return false;
        }
        return true;
      });
      if (candidates.length < bestCount) {
        bestCount = candidates.length;
        bestKey = key;
        bestCandidates = candidates;
        if (bestCount <= 1) break;
      }
    }

    return { key: bestKey, candidates: bestCandidates || [] };
  }

  function search() {
    if (covered.size === shelfCells.size) return true;
    const choice = pickNextCell();
    if (!choice.key || choice.candidates.length === 0) return false;

    for (const segmentId of choice.candidates) {
      const segment = segments[segmentId];
      let conflict = false;
      for (const cell of segment.cells) {
        if (covered.has(keyFor(cell[0], cell[1]))) {
          conflict = true;
          break;
        }
      }
      if (conflict) continue;

      used[segmentId] = true;
      for (const cell of segment.cells) covered.add(keyFor(cell[0], cell[1]));
      solution.push(segmentId);

      if (search()) return true;

      solution.pop();
      for (const cell of segment.cells) covered.delete(keyFor(cell[0], cell[1]));
      used[segmentId] = false;
    }

    return false;
  }

  const ok = search();
  if (!ok) {
    const leftovers = sortedCells
      .filter(([x, y]) => !covered.has(keyFor(x, y)))
      .slice(0, 12)
      .map(([x, y]) => `(${x},${y})`);
    throw new Error(
      `Hyllpixlar kan inte delas upp i exakta 1x6-segment. Exempel på ogiltiga pixlar: ${leftovers.join(", ")}`
    );
  }

  return solution.map((segmentId) => segments[segmentId]);
}

function buildShelvesFromPixels({ shelfCells, width, height, shelfWidth, shelfDepth, shelfHeight, layoutName }) {
  try {
    const segments = buildShelfSegments(shelfCells, width, height);
    const shelves = segments.map((segment) => {
      const xs = segment.cells.map((c) => c[0]);
      const ys = segment.cells.map((c) => c[1]);
      const centerX = (Math.min(...xs) + Math.max(...xs)) * 0.5;
      const centerY = (Math.min(...ys) + Math.max(...ys)) * 0.5;
      return Object.freeze({
        x: toWorldX(centerX, width),
        z: toWorldZ(centerY, height),
        width: shelfWidth,
        depth: shelfDepth,
        height: shelfHeight,
        yaw: segment.yaw
      });
    });
    return {
      shelves: Object.freeze(shelves),
      warnings: []
    };
  } catch (error) {
    const segmentErrorMessage = String(error?.message || "okänt segmentfel");
    const remaining = new Set(shelfCells);
    const shelves = [];

    while (remaining.size > 0) {
      const start = remaining.values().next().value;
      remaining.delete(start);
      const queue = [start];
      const component = [];

      while (queue.length > 0) {
        const key = queue.pop();
        const [x, y] = key.split(",").map(Number);
        component.push([x, y]);

        const neighbors = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1]
        ];
        for (const [nx, ny] of neighbors) {
          const neighborKey = keyFor(nx, ny);
          if (!remaining.has(neighborKey)) continue;
          remaining.delete(neighborKey);
          queue.push(neighborKey);
        }
      }

      const xs = component.map((c) => c[0]);
      const ys = component.map((c) => c[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const spanX = maxX - minX + 1;
      const spanY = maxY - minY + 1;
      const centerX = (minX + maxX) * 0.5;
      const centerY = (minY + maxY) * 0.5;
      const isFilledRect = component.length === spanX * spanY;

      if (isFilledRect) {
        const horizontal = spanX >= spanY;
        shelves.push(
          Object.freeze({
            x: toWorldX(centerX, width),
            z: toWorldZ(centerY, height),
            width: horizontal ? spanY : spanX,
            depth: horizontal ? spanX : spanY,
            height: shelfHeight,
            yaw: horizontal ? Math.PI / 2 : 0
          })
        );
        continue;
      }

      for (const [x, y] of component) {
        shelves.push(
          Object.freeze({
            x: toWorldX(x, width),
            z: toWorldZ(y, height),
            width: 1,
            depth: 1,
            height: shelfHeight,
            yaw: 0
          })
        );
      }
    }

    return {
      shelves: Object.freeze(shelves),
      warnings: [
        Object.freeze({
          code: "shelf_fallback_used",
          severity: "warning",
          message:
            `[layout] ${layoutName}: hyllor kunde inte delas upp i exakta 1x6-segment. ` +
            "Fallback användes (sammanhängande regioner/1x1), layouten är spelbar men inte godkänd.",
          details: segmentErrorMessage
        })
      ]
    };
  }
}

export function loadLayoutFromPng({
  filePath,
  shelfWidth = 1,
  shelfDepth = 6,
  shelfHeight = 2,
  coolerWidth = 1,
  coolerDepth = 1,
  coolerHeight = 2,
  freezerWidth = 1,
  freezerDepth = 1,
  freezerHeight = 1
}) {
  const buffer = fs.readFileSync(filePath);
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const layoutName = basename(filePath || "layout.png");

  if (width < SEGMENT_LEN && height < SEGMENT_LEN) {
    throw new Error(`[layout] ${layoutName} är för liten. Minst en sida måste vara >= ${SEGMENT_LEN}.`);
  }

  const occupied = Array.from({ length: height }, () => Array.from({ length: width }, () => false));
  const shelfCells = new Set();
  const coolerCells = [];
  const freezerCells = [];
  const unknownPixels = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = rgbAt(data, width, x, y);
      const type = classifyPixel(pixel);
      if (type === "shelf") {
        shelfCells.add(keyFor(x, y));
        occupied[y][x] = true;
        continue;
      }
      if (type === "cooler") {
        coolerCells.push([x, y]);
        occupied[y][x] = true;
        continue;
      }
      if (type === "freezer") {
        freezerCells.push([x, y]);
        occupied[y][x] = true;
        continue;
      }
      if (type === "unknown") {
        unknownPixels.push({ x, y, rgb: [pixel[0], pixel[1], pixel[2]] });
      }
    }
  }

  if (unknownPixels.length > 0) {
    const examples = unknownPixels
      .slice(0, 8)
      .map((p) => `(${p.x},${p.y}) rgb(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]})`)
      .join(", ");
    throw new Error(
      `[layout] Okända färger i ${layoutName} (${unknownPixels.length} px). Exempel: ${examples}`
    );
  }

  const shelfResult = buildShelvesFromPixels({
    shelfCells,
    width,
    height,
    shelfWidth,
    shelfDepth,
    shelfHeight,
    layoutName
  });
  const shelves = shelfResult.shelves;
  const warnings = [...shelfResult.warnings];

  const coolers = Object.freeze(
    coolerCells.map(([x, y]) => {
      const yaw = findOpenYaw({ x, y, occupied, width, height }) ?? 0;
      return Object.freeze({
        x: toWorldX(x, width),
        z: toWorldZ(y, height),
        width: coolerWidth,
        depth: coolerDepth,
        height: coolerHeight,
        yaw
      });
    })
  );

  const freezers = Object.freeze(
    freezerCells.map(([x, y]) =>
      Object.freeze({
        x: toWorldX(x, width),
        z: toWorldZ(y, height),
        width: freezerWidth,
        depth: freezerDepth,
        height: freezerHeight,
        yaw: 0
      })
    )
  );

  return Object.freeze({
    worldSizeMeters: Math.max(width, height),
    worldWidthMeters: width,
    worldHeightMeters: height,
    warnings: Object.freeze(warnings),
    shelves,
    coolers,
    freezers
  });
}
