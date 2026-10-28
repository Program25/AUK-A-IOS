import Foundation
import UIKit
import CoreBluetooth
import CoreLocation
import Capacitor

/// AUK-A Mobile (iPhone) — papel de PERIFÉRICO BLE ("AUKA-PHONE/1").
///
/// Anuncia o serviço 7b5c0400-..., expõe a característica LOCATION (READ+NOTIFY)
/// e manda a posição do GPS do iPhone, 1x por segundo, a cada laptop inscrito.
/// É o equivalente iOS do AukPhoneService.java do Android; a interface (JS) é a mesma:
///
///   AukPhone.start()                    pede permissões e começa a enviar
///   AukPhone.stop()
///   AukPhone.getState()                 estado atual (+ suporte, ...)
///   AukPhone.openLocationSettings()     abre os Ajustes do app
///   AukPhone.requestBatteryExemption()  não existe no iOS (não faz nada)
///   evento "state"                      emitido a cada segundo enquanto roda
///
/// Diferenças inevitáveis em relação ao Android (regras do iOS):
///  - Segundo plano: é o modo de fundo "location" que mantém o app vivo. Mas, com o
///    app em segundo plano, o iOS NÃO inclui o nome nem o UUID do serviço no anúncio
///    normal — um laptop não consegue mais ENCONTRAR o iPhone. Por isso: conecte
///    com o app aberto; depois disso pode bloquear a tela.
///  - Não dá para pedir "só GPS" (o iOS decide a fonte). Para não mandar uma posição
///    de Wi-Fi/antena como se fosse GPS, posições com precisão pior que
///    `maxAccuracyM` viram NOFIX.
///  - O iOS não avisa quando um laptop conecta sem se inscrever; "conectado" = inscrito.
///  - O iOS não deixa o app desconectar um laptop. Ao desligar, o laptop pode ficar
///    "conectado" sem receber nada (a tela do laptop mostra "sem atualização há N s").
@objc(AukPhonePlugin)
public class AukPhonePlugin: CAPPlugin, CAPBridgedPlugin, CBPeripheralManagerDelegate, CLLocationManagerDelegate {

    // MARK: - Capacitor
    public let identifier = "AukPhonePlugin"
    public let jsName = "AukPhone"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openLocationSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestBatteryExemption", returnType: CAPPluginReturnPromise)
    ]

    // MARK: - Protocolo AUKA-PHONE/1
    private static let phoneName = "AUKA-PHONE"
    private static let serviceUUID  = CBUUID(string: "7b5c0400-6c1e-4b6a-9a2e-d31f8c6a0b00")
    private static let locationUUID = CBUUID(string: "7b5c0401-6c1e-4b6a-9a2e-d31f8c6a0b00")
    private static let infoUUID     = CBUUID(string: "7b5c0402-6c1e-4b6a-9a2e-d31f8c6a0b00")
    private static let tickInterval: TimeInterval = 1.0
    /// Fix mais velho que isso => NOFIX.
    private static let fixMaxAge: TimeInterval = 5.0
    /// Precisão pior que isso => NOFIX (o iOS pode entregar posição de Wi-Fi/antena
    /// dentro de prédios; num foguete isso enganaria). Ao ar livre o GPS dá < 10 m.
    private static let maxAccuracyM: Double = 20.0
    private static let purposeKey = "AukaPrecise"   // chave em NSLocationTemporaryUsageDescriptionDictionary

    // MARK: - Estado (tudo acessado só na thread principal)
    private var pm: CBPeripheralManager?
    private var lm: CLLocationManager?
    private var locChar: CBMutableCharacteristic?
    private var infoChar: CBMutableCharacteristic?

    private var pendingStart: CAPPluginCall?
    private var askedFullAccuracy = false
    private var running = false
    private var serviceAdded = false
    private var advertising = false
    private var gpsEnabled = true
    private var mtuLow = false
    private var sent: Int64 = 0
    private var errorMsg: String?

    private var subscribers: [UUID: CBCentral] = [:]
    private var lastLoc: CLLocation?
    private var timer: Timer?

    // MARK: - Métodos chamados pelo JS
    // O Capacitor chama estes métodos numa fila de fundo; tudo vai para a principal.

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.doStart(call) }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.errorMsg = nil
            self.stopAll()
            call.resolve()
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var o = self.stateDict()
            let unsupported = self.pm?.state == .unsupported
            o["supported"] = !unsupported
            if unsupported { o["unsupportedReason"] = "Este aparelho não suporta Bluetooth LE periférico." }
            o["btOn"] = self.pm.map { $0.state == .poweredOn } ?? true
            o["batteryExempt"] = true   // no iOS não existe otimização de bateria a isentar
            call.resolve(o)
        }
    }

    @objc func openLocationSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("Não consegui abrir os Ajustes.")
                return
            }
            UIApplication.shared.open(url, options: [:]) { ok in
                if ok { call.resolve() } else { call.reject("Não consegui abrir os Ajustes.") }
            }
        }
    }

    @objc func requestBatteryExemption(_ call: CAPPluginCall) {
        call.resolve()   // sem equivalente no iOS
    }

    // MARK: - Partida (pede permissões em ordem: localização -> Bluetooth)

    private func doStart(_ call: CAPPluginCall) {
        if running {
            call.resolve(["started": true])
            return
        }
        if pendingStart != nil {
            call.reject("O envio já está iniciando.", "ALREADY_STARTING")
            return
        }
        errorMsg = nil
        pendingStart = call
        askedFullAccuracy = false
        if lm == nil {
            let m = CLLocationManager()
            m.delegate = self
            lm = m
        }
        advanceStart()
    }

    /// Reentrante: olha o estado atual das permissões e avança o que der.
    /// É chamada de novo a cada resposta do usuário (localização, precisão, Bluetooth).
    private func advanceStart() {
        guard pendingStart != nil, let lm = lm else { return }

        // 1) Localização
        switch lm.authorizationStatus {
        case .notDetermined:
            lm.requestWhenInUseAuthorization()
            return
        case .denied, .restricted:
            gpsEnabled = false
            failStart("Localização negada ou desligada. Em Ajustes > AUK-A > Localização, escolha “Ao Usar o App” e ative “Localização Precisa”.",
                      code: "NO_LOCATION")
            return
        default:
            break
        }
        gpsEnabled = true

        // 1b) Precisão: "Aproximada" não serve para achar um foguete.
        if lm.accuracyAuthorization == .reducedAccuracy {
            if !askedFullAccuracy {
                askedFullAccuracy = true
                lm.requestTemporaryFullAccuracyAuthorization(withPurposeKey: Self.purposeKey) { [weak self] _ in
                    DispatchQueue.main.async { self?.advanceStart() }
                }
            } else {
                failStart("A localização está em modo aproximado. Em Ajustes > AUK-A > Localização, ative “Localização Precisa”.",
                          code: "NO_PRECISE_LOCATION")
            }
            return
        }

        // 2) Bluetooth (criar o gerenciador dispara o pedido de permissão)
        if pm == nil {
            pm = CBPeripheralManager(delegate: self,
                                     queue: .main,
                                     options: [CBPeripheralManagerOptionShowPowerAlertKey: true])
            return   // continua em peripheralManagerDidUpdateState
        }
        guard let pm = pm else { return }
        switch pm.state {
        case .poweredOn:
            break
        case .unknown, .resetting:
            return   // aguardando o sistema / o usuário responder
        case .poweredOff:
            failStart("Bluetooth desligado. Ligue o Bluetooth do iPhone e tente de novo.", code: "BT_OFF")
            return
        case .unauthorized:
            failStart("Sem permissão de Bluetooth. Em Ajustes > AUK-A, ative Bluetooth.", code: "NO_BLUETOOTH")
            return
        case .unsupported:
            failStart("Este aparelho não suporta Bluetooth LE periférico.", code: "UNSUPPORTED")
            return
        @unknown default:
            return
        }

        launch()
    }

    private func failStart(_ message: String, code: String) {
        let call = pendingStart
        pendingStart = nil
        pm = nil
        call?.reject(message, code)
    }

    private func launch() {
        guard let call = pendingStart, let lm = lm, let pm = pm else { return }

        // allowsBackgroundLocationUpdates derruba o app se faltar o modo de fundo no Info.plist.
        let modes = (Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String]) ?? []
        guard modes.contains("location") else {
            failStart("Este build não tem o modo de fundo “location” no Info.plist.", code: "NO_BACKGROUND_MODE")
            return
        }
        pendingStart = nil

        sent = 0
        mtuLow = false
        subscribers.removeAll()
        lastLoc = nil
        advertising = false
        running = true

        // GPS
        lm.desiredAccuracy = kCLLocationAccuracyBest
        lm.distanceFilter = kCLDistanceFilterNone
        lm.activityType = .otherNavigation
        lm.pausesLocationUpdatesAutomatically = false
        lm.allowsBackgroundLocationUpdates = true
        lm.showsBackgroundLocationIndicator = true
        lm.startUpdatingLocation()

        // Bluetooth: o anúncio começa em didAdd(service)
        UIDevice.current.isBatteryMonitoringEnabled = true
        buildService(on: pm)

        // Com o app aberto, não deixa a tela auto-bloquear enquanto o laptop procura.
        UIApplication.shared.isIdleTimerDisabled = true

        let t = Timer(timeInterval: Self.tickInterval, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(t, forMode: .common)
        timer = t

        call.resolve(["started": true])
        publish()
    }

    // MARK: - Parada

    private func failRunning(_ message: String) {
        errorMsg = message
        stopAll()
    }

    private func stopAll() {
        let wasActive = running || pendingStart != nil
        running = false
        timer?.invalidate()
        timer = nil

        if let call = pendingStart {
            pendingStart = nil
            call.reject("Cancelado.", "CANCELLED")
        }

        if let lm = lm {
            lm.stopUpdatingLocation()
            lm.allowsBackgroundLocationUpdates = false
        }
        if let pm = pm {
            pm.stopAdvertising()
            pm.removeAllServices()
        }
        pm = nil   // devolve o Bluetooth; um novo start() cria outro gerenciador
        locChar = nil
        infoChar = nil
        serviceAdded = false
        advertising = false
        subscribers.removeAll()
        lastLoc = nil
        mtuLow = false
        UIApplication.shared.isIdleTimerDisabled = false

        if wasActive || errorMsg != nil { publish() }   // estado final: running=false (+ erro, se houve)
    }

    // MARK: - Serviço GATT e anúncio

    private func buildService(on pm: CBPeripheralManager) {
        // O CCCD (0x2902) é criado pelo próprio CoreBluetooth para toda característica com NOTIFY.
        let loc = CBMutableCharacteristic(type: Self.locationUUID,
                                          properties: [.read, .notify],
                                          value: nil,                 // valor dinâmico: responde em didReceiveRead
                                          permissions: [.readable])
        let info = CBMutableCharacteristic(type: Self.infoUUID,
                                           properties: [.read],
                                           value: nil,
                                           permissions: [.readable])
        let svc = CBMutableService(type: Self.serviceUUID, primary: true)
        svc.characteristics = [loc, info]
        locChar = loc
        infoChar = info
        serviceAdded = false
        pm.add(svc)
    }

    /// Anúncio conectável com o UUID do serviço (o laptop filtra por ele) e o nome.
    /// O iOS não deixa escolher modo/potência/intervalo.
    private func startAdvertisingIfNeeded() {
        guard running, serviceAdded, let pm = pm, pm.state == .poweredOn, !pm.isAdvertising else { return }
        pm.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [Self.serviceUUID],
            CBAdvertisementDataLocalNameKey: Self.phoneName
        ])
    }

    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if pendingStart != nil {
            advanceStart()
            return
        }
        guard running else { return }
        switch peripheral.state {
        case .poweredOff:    failRunning("Bluetooth desligado.")
        case .unauthorized:  failRunning("Sem permissão de Bluetooth.")
        case .unsupported:   failRunning("Este aparelho não suporta Bluetooth LE periférico.")
        default: break
        }
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if let error = error {
            failRunning("O iOS recusou registrar o serviço Bluetooth (\(error.localizedDescription)).")
            return
        }
        serviceAdded = true
        startAdvertisingIfNeeded()
    }

    public func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error = error {
            failRunning("Não consegui anunciar por Bluetooth: \(error.localizedDescription).")
            return
        }
        advertising = true
        publish()
    }

    // MARK: - GATT: leitura e inscrição

    public func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
        let u = request.characteristic.uuid
        let value: Data?
        if u == Self.locationUUID { value = buildPayload() }
        else if u == Self.infoUUID { value = buildInfo() }
        else { value = nil }

        guard let v = value else {
            peripheral.respond(to: request, withResult: .requestNotSupported)
            return
        }
        if request.offset > v.count {
            peripheral.respond(to: request, withResult: .invalidOffset)
            return
        }
        request.value = v.subdata(in: request.offset..<v.count)
        peripheral.respond(to: request, withResult: .success)
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
                                  didSubscribeTo characteristic: CBCharacteristic) {
        guard characteristic.uuid == Self.locationUUID else { return }
        subscribers[central.identifier] = central
        notifyOne(central)   // já manda o valor atual, sem esperar o próximo segundo
        publish()
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
                                  didUnsubscribeFrom characteristic: CBCharacteristic) {
        guard characteristic.uuid == Self.locationUUID else { return }
        subscribers.removeValue(forKey: central.identifier)
        startAdvertisingIfNeeded()   // aceita reconexão
        publish()
    }

    public func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        // A fila de notificações esvaziou. Não reenvia o que ficou para trás:
        // o próximo tick manda a posição mais nova.
    }

    // MARK: - GPS

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let l = locations.last { lastLoc = l }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let st = manager.authorizationStatus
        gpsEnabled = !(st == .denied || st == .restricted)
        if pendingStart != nil {
            advanceStart()
        } else if running {
            publish()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // .locationUnknown é passageiro (ainda sem sinal); só .denied importa.
        if let e = error as? CLError, e.code == .denied {
            gpsEnabled = false
            if running { publish() }
        }
    }

    /// Último fix, só se for recente, válido e preciso; senão nil (=> NOFIX).
    private func freshLocation() -> CLLocation? {
        guard let l = lastLoc else { return nil }
        if l.horizontalAccuracy < 0 || l.horizontalAccuracy > Self.maxAccuracyM { return nil }
        if -l.timestamp.timeIntervalSinceNow > Self.fixMaxAge { return nil }
        if !CLLocationCoordinate2DIsValid(l.coordinate) { return nil }
        if l.coordinate.latitude == 0 && l.coordinate.longitude == 0 { return nil }   // nunca mandar 0,0
        return l
    }

    // MARK: - Envio 1 Hz

    private func tick() {
        guard running else { return }
        startAdvertisingIfNeeded()   // se o iOS parou de anunciar, volta

        let v = buildPayload()
        var low = false
        for central in subscribers.values {
            if central.maximumUpdateValueLength < v.count { low = true; continue }
            if send(v, to: central) { sent += 1 }
        }
        mtuLow = low
        publish()
    }

    private func notifyOne(_ central: CBCentral) {
        guard running else { return }
        let v = buildPayload()
        if central.maximumUpdateValueLength < v.count { mtuLow = true; return }
        if send(v, to: central) { sent += 1 }
    }

    /// false = a fila de notificações do iOS está cheia; o próximo tick manda uma posição mais nova.
    private func send(_ value: Data, to central: CBCentral) -> Bool {
        guard let pm = pm, let ch = locChar else { return false }
        return pm.updateValue(value, for: ch, onSubscribedCentrals: [central])
    }

    private func nowMs() -> Int64 {
        return Int64((Date().timeIntervalSince1970 * 1000.0).rounded())
    }

    private func buildPayload() -> Data {
        let s: String
        if let l = freshLocation() {
            let alt: Double? = l.verticalAccuracy >= 0 ? l.altitude : nil   // altitude acima do nível do mar
            s = PhonePayload.location(lat: l.coordinate.latitude, lng: l.coordinate.longitude,
                                      accuracyM: l.horizontalAccuracy, altitudeM: alt, unixMs: nowMs())
        } else {
            s = PhonePayload.noFix(unixMs: nowMs())
        }
        return Data(s.utf8)
    }

    private func buildInfo() -> Data {
        let level = UIDevice.current.batteryLevel   // -1 se desconhecido
        let pct = level >= 0 ? Int((level * 100).rounded()) : -1
        return Data(PhonePayload.info(model: Self.machineModel(), batteryPercent: pct).utf8)
    }

    /// Ex.: "iPhone15,2". (UIDevice.model só diz "iPhone".)
    private static func machineModel() -> String {
        var sys = utsname()
        uname(&sys)
        let mirror = Mirror(reflecting: sys.machine)
        return mirror.children.reduce(into: "") { acc, el in
            guard let v = el.value as? Int8, v != 0 else { return }
            acc.append(Character(UnicodeScalar(UInt8(bitPattern: v))))
        }
    }

    // MARK: - Estado para a interface

    private func stateDict() -> [String: Any] {
        var o: [String: Any] = [
            "running": running,
            "advertising": advertising,
            "gpsEnabled": gpsEnabled,
            "mtuLow": mtuLow,
            // O iOS só avisa de quem se inscreveu; "conectado" = inscrito.
            "connected": subscribers.count,
            "subscribed": subscribers.count,
            "sent": sent
        ]
        if let l = freshLocation() {
            o["hasFix"] = true
            o["lat"] = l.coordinate.latitude
            o["lng"] = l.coordinate.longitude
            o["acc"] = l.horizontalAccuracy
            if l.verticalAccuracy >= 0 { o["alt"] = l.altitude }
        } else {
            o["hasFix"] = false
        }
        if let e = errorMsg { o["error"] = e }
        return o
    }

    private func publish() {
        notifyListeners("state", data: stateDict())
    }
}
