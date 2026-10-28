// Compila PhonePayload.swift + o teste e roda. Precisa do Swift (vem com o Xcode no Mac / no runner macOS do GitHub).
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
rmSync("tests/.out", { recursive: true, force: true });
mkdirSync("tests/.out", { recursive: true });
execSync(
  "swiftc -o tests/.out/check plugins/auk-phone/ios/Sources/AukPhonePlugin/PhonePayload.swift tests/swift/main.swift",
  { stdio: "inherit" }
);
execSync("tests/.out/check", { stdio: "inherit" });
