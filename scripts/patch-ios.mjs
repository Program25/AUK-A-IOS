// Ajusta o projeto iOS gerado pelo `cap add ios`.
// Idempotente: pode rodar quantas vezes quiser.
//   1) Info.plist: textos das permissões (Bluetooth, Localização) e modos de
//      segundo plano (location + bluetooth-peripheral) do "Enviar posição ao laptop"
//   2) versão do app (a do package.json) e número do build
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const plistFile = "ios/App/App/Info.plist";
const pbxFile = "ios/App/App.xcodeproj/project.pbxproj";
if (!existsSync(plistFile) || !existsSync(pbxFile)) {
  console.error("Projeto iOS não encontrado — rode `npx cap add ios` antes.");
  process.exit(1);
}

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const build = process.env.GITHUB_RUN_NUMBER || process.env.AUKA_BUILD || "1";

// ----------------------------------------------------------------- Info.plist
let xml = readFileSync(plistFile, "utf8");
let changed = false;

function addKey(key, valueXml) {
  if (xml.includes(`<key>${key}</key>`)) return;
  const entry = `\t<key>${key}</key>\n${valueXml}\n`;
  const next = xml.replace(/<\/dict>\s*<\/plist>\s*$/, entry + "</dict>\n</plist>\n");
  if (next === xml) throw new Error("Info.plist com formato inesperado.");
  xml = next;
  changed = true;
}

addKey("NSBluetoothAlwaysUsageDescription",
  "\t<string>O AUK-A usa o Bluetooth para configurar o foguete e a estação em solo e para enviar a posição do iPhone ao laptop.</string>");
addKey("NSLocationWhenInUseUsageDescription",
  "\t<string>O AUK-A usa o GPS do iPhone para enviar a posição dele ao laptop e ajudar a encontrar o foguete.</string>");
// Chave usada em requestTemporaryFullAccuracyAuthorization (AukPhonePlugin.swift: purposeKey)
addKey("NSLocationTemporaryUsageDescriptionDictionary",
  "\t<dict>\n\t\t<key>AukaPrecise</key>\n\t\t<string>Para achar o foguete é preciso a localização exata, não a aproximada.</string>\n\t</dict>");
// location: mantém o GPS (e o app) vivo com a tela bloqueada.
// bluetooth-peripheral: mantém o servidor GATT/notificações com o app em segundo plano.
addKey("UIBackgroundModes",
  "\t<array>\n\t\t<string>location</string>\n\t\t<string>bluetooth-peripheral</string>\n\t</array>");
// Textos do sistema (botões dos pedidos de permissão) em português.
addKey("CFBundleLocalizations", "\t<array>\n\t\t<string>pt-BR</string>\n\t</array>");
if (/<key>CFBundleDevelopmentRegion<\/key>\s*<string>en<\/string>/.test(xml)) {
  xml = xml.replace(/(<key>CFBundleDevelopmentRegion<\/key>\s*<string>)en(<\/string>)/, "$1pt-BR$2");
  changed = true;
}

if (changed) {
  writeFileSync(plistFile, xml);
  console.log("Info.plist ajustado.");
} else {
  console.log("Info.plist já estava ajustado.");
}

// ------------------------------------------------------------------- versão
let pbx = readFileSync(pbxFile, "utf8");
const pbx2 = pbx
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
if (pbx2 !== pbx) {
  writeFileSync(pbxFile, pbx2);
  console.log(`Versão do app: ${version} (build ${build}).`);
}
