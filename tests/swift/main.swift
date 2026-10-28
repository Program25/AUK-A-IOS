import Foundation

// Confere os textos do protocolo AUKA-PHONE/1 (PhonePayload.swift).
// Rodar (no Mac / no GitHub Actions):  node tests/run-payload-check.mjs
var failures = 0

func eq(_ name: String, _ got: String, _ want: String) {
    let ok = got == want
    print((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "\n   obtido:   \(got)\n   esperado: \(want)"))
    if !ok { failures += 1 }
}

// O protocolo exige ponto decimal, mesmo com o iPhone em português do Brasil.
eq("exemplo do protocolo",
   PhonePayload.location(lat: -26.304512, lng: -48.846201, accuracyM: 4.5, altitudeM: 12.0, unixMs: 1767225600000),
   "-26.304512,-48.846201,4.5,12.0,1767225600000")
eq("altitude indisponível",
   PhonePayload.location(lat: -26.304512, lng: -48.846201, accuracyM: 4.5, altitudeM: nil, unixMs: 1767225600000),
   "-26.304512,-48.846201,4.5,,1767225600000")
eq("arredondamento (6 casas / 1 casa)",
   PhonePayload.location(lat: -26.3045124, lng: 48.8462016, accuracyM: 4.54, altitudeM: 11.96, unixMs: 1),
   "-26.304512,48.846202,4.5,12.0,1")
eq("sem GPS", PhonePayload.noFix(unixMs: 1767225600000), "NOFIX,1767225600000")
eq("info", PhonePayload.info(model: "iPhone15,2", batteryPercent: 87), "AUKA-PHONE/1;iPhone15.2;87")
eq("info sem bateria", PhonePayload.info(model: nil, batteryPercent: -1), "AUKA-PHONE/1;iPhone;?")
eq("info limpa ;", PhonePayload.info(model: "A;B", batteryPercent: 5), "AUKA-PHONE/1;A B;5")

let len = PhonePayload.location(lat: -26.304512, lng: -48.846201, accuracyM: 4.5, altitudeM: 12.0, unixMs: 1767225600000).utf8.count
print("tamanho do pacote de posição: \(len) bytes (precisa de MTU >= \(len + 3))")
if failures > 0 { print("\(failures) falha(s)"); exit(1) }
print("tudo certo")
