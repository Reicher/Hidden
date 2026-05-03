import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const COLORS = Object.freeze({
  empty: [0, 0, 0, 0],
  shelf: [0, 0, 0, 255],
  cooler: [0, 102, 255, 255],
  freezer: [0, 200, 120, 255]
});

const LAYOUT_PRESETS = Object.freeze({
  "layout-50": Object.freeze({
    size: 50,
    shelves: Object.freeze([
      ["h", 8, 10],
      ["h", 8, 14],
      ["h", 18, 26],
      ["v", 31, 30],
      ["v", 35, 30]
    ]),
    coolers: Object.freeze([
      [4, 4],
      [45, 4],
      [4, 45],
      [45, 45],
      [24, 8]
    ]),
    freezers: Object.freeze([
      [24, 24],
      [40, 20],
      [10, 40],
      [28, 34],
      [42, 42]
    ])
  }),
  "layout-30": Object.freeze({
    size: 30,
    shelves: Object.freeze([
      ["h", 4, 6],
      ["h", 4, 10],
      ["h", 11, 16],
      ["v", 19, 18],
      ["v", 23, 18]
    ]),
    coolers: Object.freeze([
      [3, 3],
      [26, 3],
      [3, 26],
      [26, 26],
      [14, 6]
    ]),
    freezers: Object.freeze([
      [14, 14],
      [22, 12],
      [7, 24],
      [17, 22],
      [24, 24]
    ])
  })
});

const HERE = dirname(fileURLToPath(import.meta.url));

function setPixel(png, size, x, y, rgba) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const idx = (y * size + x) * 4;
  png.data[idx] = rgba[0];
  png.data[idx + 1] = rgba[1];
  png.data[idx + 2] = rgba[2];
  png.data[idx + 3] = rgba[3];
}

function drawShelfHorizontal(png, size, x0, y) {
  for (let dx = 0; dx < 6; dx += 1) setPixel(png, size, x0 + dx, y, COLORS.shelf);
}

function drawShelfVertical(png, size, x, y0) {
  for (let dy = 0; dy < 6; dy += 1) setPixel(png, size, x, y0 + dy, COLORS.shelf);
}

function main() {
  const layoutId = String(process.argv[2] || "layout-50").trim().toLowerCase();
  const preset = LAYOUT_PRESETS[layoutId];
  if (!preset) {
    const available = Object.keys(LAYOUT_PRESETS).join(", ");
    throw new Error(`Unknown layout id "${layoutId}". Available: ${available}`);
  }

  const { size } = preset;
  const outputPath = resolve(HERE, `../public/assets/${layoutId}.png`);
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) setPixel(png, size, x, y, COLORS.empty);
  }

  for (const [kind, x, y] of preset.shelves) {
    if (kind === "h") drawShelfHorizontal(png, size, x, y);
    else drawShelfVertical(png, size, x, y);
  }

  for (const [x, y] of preset.coolers) setPixel(png, size, x, y, COLORS.cooler);
  for (const [x, y] of preset.freezers) setPixel(png, size, x, y, COLORS.freezer);

  fs.mkdirSync(dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, PNG.sync.write(png));
  console.log(`Wrote ${outputPath}`);
  console.log("Legend: shelf=black, cooler=blue, freezer=green, empty=transparent");
}

main();
