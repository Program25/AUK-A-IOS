import Foundation

/// Monta os textos do protocolo "AUKA-PHONE/1" — idêntico ao PhonePayload.java do Android.
/// Só usa Foundation (sem CoreBluetooth/CoreLocation), então pode ser testado no PC.
///
/// LOCATION: "<lat>,<lng>,<precisao_m>,<altitude_m>,<unix_ms>"
///           ex.: "-26.304512,-48.846201,4.5,12.0,1767225600000"
///           altitude vazia se indisponível: "...,4.5,,1767..."
///           sem GPS: "NOFIX,<unix_ms>"
/// INFO:     "AUKA-PHONE/1;<modelo>;<bateria%>"
///
/// O locale é fixado em en_US_POSIX: em pt-BR o formato padrão usaria vírgula
/// decimal e quebraria o CSV.
public enum PhonePayload {
    private static let posix = Locale(identifier: "en_US_POSIX")

    public static func location(lat: Double, lng: Double, accuracyM: Double,
                                altitudeM: Double?, unixMs: Int64) -> String {
        let alt = altitudeM.map { String(format: "%.1f", locale: posix, $0) } ?? ""
        let head = String(format: "%.6f,%.6f,%.1f,", locale: posix, lat, lng, accuracyM)
        return head + alt + "," + String(unixMs)
    }

    public static func noFix(unixMs: Int64) -> String {
        return "NOFIX," + String(unixMs)
    }

    public static func info(model: String?, batteryPercent: Int) -> String {
        var m = ""
        for ch in (model ?? "") {
            if ch == ";" {
                m.append(" ")
            } else if ch == "," {
                m.append(".")
            } else if ch.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) {
                m.append(" ")
            } else {
                m.append(ch)
            }
        }
        m = m.trimmingCharacters(in: .whitespaces)
        if m.isEmpty { m = "iPhone" }
        if m.count > 24 { m = String(m.prefix(24)) }
        let bat = (0...100).contains(batteryPercent) ? String(batteryPercent) : "?"
        return "AUKA-PHONE/1;" + m + ";" + bat
    }
}
