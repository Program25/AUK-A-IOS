// Gera o .ipa SEM ASSINATURA: web -> projeto iOS -> ícones -> xcodebuild -> dist/
// (quem assina é o Sideloadly/AltStore com o seu Apple ID, na hora de instalar).
//
//   node scripts/build-ios.mjs                 compila e empacota (precisa de macOS + Xcode 26)
//   node scripts/build-ios.mjs --prepare-only  só monta o projeto (roda em qualquer sistema)
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync } from "node:fs";

const prepareOnly = process.argv.includes("--prepare-only");
const run = (cmd, opts = {}) => {
  console.log("\n> " + cmd);
  execSync(cmd, { stdio: "inherit", ...opts });
};

run("npm run build:web");
if (!existsSync("ios")) run("npx cap add ios");
run("node scripts/patch-ios.mjs");
run("npx capacitor-assets generate --ios");
run("npx cap sync ios");

if (prepareOnly) {
  console.log("\nProjeto iOS pronto em ios/ (sem compilar).");
  process.exit(0);
}
if (process.platform !== "darwin") {
  console.log("\nProjeto iOS montado, mas compilar o iOS exige macOS + Xcode.");
  console.log("Use o GitHub Actions (.github/workflows/build-ipa.yml) — veja o README-IOS.md.");
  process.exit(0);
}

const derived = "ios/build";
rmSync(derived, { recursive: true, force: true });
run("xcodebuild -list -project ios/App/App.xcodeproj");
run(
  [
    "xcodebuild",
    "-project ios/App/App.xcodeproj",
    "-scheme App",
    "-configuration Release",
    "-sdk iphoneos",
    '-destination "generic/platform=iOS"',
    `-derivedDataPath ${derived}`,
    "CODE_SIGNING_ALLOWED=NO",
    "CODE_SIGNING_REQUIRED=NO",
    'CODE_SIGN_IDENTITY=""',
  ].join(" ")
);

const app = `${derived}/Build/Products/Release-iphoneos/App.app`;
if (!existsSync(app)) {
  console.error("App.app não foi gerado em " + app);
  process.exit(1);
}

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/Payload", { recursive: true });
cpSync(app, "dist/Payload/App.app", { recursive: true, verbatimSymlinks: true });
const out = `AUK-A-v${version}.ipa`;
run(`zip -qry ${out} Payload`, { cwd: "dist" });
rmSync("dist/Payload", { recursive: true, force: true });
console.log("\nIPA pronto (sem assinatura): dist/" + out);
