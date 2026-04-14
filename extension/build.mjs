import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "fs";

const watch = process.argv.includes("--watch");

const sharedConfig = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  target: "chrome120",
};

const builds = [
  {
    entryPoints: ["src/background/index.ts"],
    outfile: "dist/background.js",
    ...sharedConfig,
  },
  {
    entryPoints: ["src/content/index.ts"],
    outfile: "dist/content.js",
    ...sharedConfig,
  },
  {
    entryPoints: ["src/popup/index.ts"],
    outfile: "dist/popup.js",
    ...sharedConfig,
  },
];

// Copy static files
mkdirSync("dist", { recursive: true });
cpSync("src/popup/popup.html", "dist/popup.html");
cpSync("src/popup/popup.css", "dist/popup.css");
cpSync("manifest.json", "dist/manifest.json");

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("Watching for changes...");
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  console.log("Build complete → dist/");
}
