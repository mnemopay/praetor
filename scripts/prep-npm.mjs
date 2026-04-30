import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const packagesDir = resolve("packages");
const pkgDirs = await readdir(packagesDir, { withFileTypes: true });

for (const dirent of pkgDirs) {
  if (!dirent.isDirectory()) continue;
  
  const pkgPath = join(packagesDir, dirent.name, "package.json");
  try {
    const content = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    
    // Set standard fields
    pkg.author = "Jerry <jerry@getbizsuite.com>";
    pkg.license = "MIT";
    pkg.repository = {
      type: "git",
      url: "https://github.com/JerryOmiagbo/praetor.git",
      directory: `packages/${dirent.name}`
    };
    pkg.publishConfig = { access: "public" };
    
    // Only standard packages get main/types/exports/files (Dashboard doesn't need this, it's a vite app)
    if (dirent.name !== "dashboard") {
      pkg.main = "dist/index.js";
      pkg.types = "dist/index.d.ts";
      pkg.files = ["dist", "README.md", "LICENSE"];
      pkg.exports = {
        ".": {
          "types": "./dist/index.d.ts",
          "import": "./dist/index.js"
        }
      };
      
      if (!pkg.scripts) pkg.scripts = {};
      pkg.scripts.build = "tsc -b";
      pkg.scripts.test = "vitest run";
      pkg.scripts.prepublishOnly = "npm run build";
    }

    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`Updated packages/${dirent.name}/package.json`);
  } catch (err) {
    console.error(`Failed on ${dirent.name}:`, err.message);
  }
}
