import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist/sidepanel", { recursive: true });
copyFileSync("manifest.json", "dist/manifest.json");
copyFileSync("src/sidepanel/sidepanel.html", "dist/sidepanel/sidepanel.html");
copyFileSync("src/sidepanel/sidepanel.css", "dist/sidepanel/sidepanel.css");
