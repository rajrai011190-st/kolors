// Builds the Capacitor web bundle (www/) from the single source of truth:
// the root index.html plus the images/ folder. Keeps the website (served by
// GitHub Pages from the repo root) and the app in sync — run `npm run sync`
// after editing index.html, then rebuild in Xcode / Android Studio.
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
process.chdir(root);

rmSync("www", { recursive: true, force: true });
mkdirSync("www", { recursive: true });

cpSync("index.html", "www/index.html");
if (existsSync("images")) cpSync("images", "www/images", { recursive: true });

console.log("✓ Built www/ from index.html + images/");
