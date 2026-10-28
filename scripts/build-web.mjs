// Monta a pasta www/ (o que o app Android carrega):
//  - copia src/ inteiro
//  - empacota native/native.js (ponte BLE/arquivos) em www/native.js
import { rmSync, mkdirSync, cpSync } from "node:fs";
import { build } from "esbuild";

rmSync("www", { recursive: true, force: true });
mkdirSync("www", { recursive: true });
cpSync("src", "www", { recursive: true });

await build({
  entryPoints: ["native/native.js"],
  outfile: "www/native.js",
  bundle: true,
  format: "iife",
  minify: true,
  target: "chrome100",
  logLevel: "info",
});
console.log("www/ pronto.");
