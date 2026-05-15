import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.resolve(projectRoot, "node_modules/three/build/three.module.js");
const targetPath = path.resolve(projectRoot, "public/vendor/three.js");

function patchShaderLogNullGuards(text) {
  // Some WebGL implementations may return null from *InfoLog APIs.
  // three.module.js calls trim() directly, which can throw intermittently.
  return text
    .replace(
      "const errors = gl.getShaderInfoLog( shader ).trim();",
      "const errors = ( gl.getShaderInfoLog( shader ) || '' ).trim();"
    )
    .replace(
      "const programLog = gl.getProgramInfoLog( program ).trim();",
      "const programLog = ( gl.getProgramInfoLog( program ) || '' ).trim();"
    )
    .replace(
      "const vertexLog = gl.getShaderInfoLog( glVertexShader ).trim();",
      "const vertexLog = ( gl.getShaderInfoLog( glVertexShader ) || '' ).trim();"
    )
    .replace(
      "const fragmentLog = gl.getShaderInfoLog( glFragmentShader ).trim();",
      "const fragmentLog = ( gl.getShaderInfoLog( glFragmentShader ) || '' ).trim();"
    );
}

function main() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing Three.js source file: ${sourcePath}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const source = fs.readFileSync(sourcePath, "utf8");
  const patched = patchShaderLogNullGuards(source);
  fs.writeFileSync(targetPath, patched, "utf8");
  console.log(`Synced ${targetPath} from local source ${sourcePath}`);
}

main();
