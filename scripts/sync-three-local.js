import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.resolve(projectRoot, "node_modules/three/build/three.module.js");
const targetPath = path.resolve(projectRoot, "public/vendor/three.module.js");

function main() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing Three.js source file: ${sourcePath}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  console.log(`Synced ${targetPath} from local source ${sourcePath}`);
}

main();
