import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/sidepanel", { recursive: true });
cpSync("manifest.json", "dist/manifest.json");
cpSync("src/sidepanel/sidepanel.html", "dist/sidepanel/sidepanel.html");
cpSync("src/sidepanel/sidepanel.css", "dist/sidepanel/sidepanel.css");
