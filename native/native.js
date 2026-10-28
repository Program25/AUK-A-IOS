// native.js — ponte entre o app (que foi escrito para Web Bluetooth) e o iPhone.
//
// O WebView do iOS (WKWebView) não tem Web Bluetooth. Aqui a gente coloca um
// `navigator.bluetooth` compatível, feito em cima do plugin BLE do Capacitor,
// só com o que o app.js usa. Assim o app.js quase não muda.
//
// Também expõe window.AukNative.saveFile() para salvar/compartilhar arquivos
// (o <a download> com blob: não funciona no WebView).

import { Capacitor } from "@capacitor/core";
import { BleClient } from "@capacitor-community/bluetooth-le";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import "./phone.js";   // recurso "Enviar posição ao laptop" (periférico BLE)

if (Capacitor.isNativePlatform()) {
  // Deixa o CSS saber em que sistema está (ver "data-platform" no style.css).
  document.documentElement.dataset.platform = Capacitor.getPlatform();
  installNative();
}

function installNative() {
  const lc = (s) => String(s).toLowerCase();

  // ------------------------------------------------------------ init ----
  let initPromise = null;
  function ensureInit() {
    if (!initPromise) {
      initPromise = (async () => {
        await BleClient.initialize({ androidNeverForLocation: true });
        if (!(await BleClient.isEnabled())) {
          try {
            await BleClient.requestEnable();
          } catch (_) {
            throw new Error("Bluetooth desligado. Ligue o Bluetooth do celular e tente de novo.");
          }
        }
      })().catch((e) => {
        initPromise = null; // deixa tentar de novo na próxima vez
        throw e;
      });
    }
    return initPromise;
  }

  function friendly(e) {
    const msg = (e && e.message) || String(e);
    if (/cancel/i.test(msg)) return new Error("Busca cancelada.");
    if (/permission|unauthori/i.test(msg)) {
      return new Error(
        Capacitor.getPlatform() === "ios"
          ? "Sem permissão de Bluetooth. Em Ajustes > AUK-A, ative o Bluetooth."
          : "Sem permissão de Bluetooth. Em Configurações > Apps > AUK-A > Permissões, permita \"Dispositivos por perto\"."
      );
    }
    if (/unsupported/i.test(msg)) {
      return new Error("Este aparelho não suporta Bluetooth LE.");
    }
    return e instanceof Error ? e : new Error(msg);
  }

  // ---------------------------------------------------- característica --
  class NativeCharacteristic extends EventTarget {
    constructor(deviceId, serviceUuid, uuid) {
      super();
      this._deviceId = deviceId;
      this._service = serviceUuid;
      this.uuid = uuid;
      this.value = null;
    }

    async readValue() {
      const v = await BleClient.read(this._deviceId, this._service, this.uuid);
      this.value = v;
      return v; // DataView
    }

    async writeValue(data) {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      await BleClient.write(this._deviceId, this._service, this.uuid, dv);
    }

    async startNotifications() {
      await BleClient.startNotifications(this._deviceId, this._service, this.uuid, (dv) => {
        this.value = dv;
        this.dispatchEvent(new Event("characteristicvaluechanged"));
      });
      return this;
    }
  }

  // ------------------------------------------------------- dispositivo --
  class NativeDevice extends EventTarget {
    constructor(bleDevice) {
      super();
      this.id = bleDevice.deviceId;
      this.name = bleDevice.name || null;
      this._services = null;
      this._connected = false;
      const self = this;
      this.gatt = {
        get connected() {
          return self._connected;
        },
        async connect() {
          // Alguns Androids falham no connect() se o aparelho já esteve
          // conectado antes; um disconnect() prévio resolve.
          try { await BleClient.disconnect(self.id); } catch (_) { /* ok */ }
          await BleClient.connect(self.id, () => self._handleDisconnect(), { timeout: 15000 });
          self._connected = true;
          self._services = await BleClient.getServices(self.id);
          return self.gatt;
        },
        async disconnect() {
          try { await BleClient.disconnect(self.id); } catch (_) { /* ok */ }
          self._handleDisconnect();
        },
        async getPrimaryService(uuid) {
          const svc = (self._services || []).find((s) => lc(s.uuid) === lc(uuid));
          if (!svc) throw new Error("Serviço BLE não encontrado neste dispositivo.");
          return {
            async getCharacteristic(charUuid) {
              const ch = svc.characteristics.find((c) => lc(c.uuid) === lc(charUuid));
              if (!ch) throw new Error("Característica BLE não encontrada: " + charUuid);
              return new NativeCharacteristic(self.id, svc.uuid, ch.uuid);
            },
          };
        },
      };
    }

    _handleDisconnect() {
      if (!this._connected) return; // evita disparo duplo
      this._connected = false;
      this.dispatchEvent(new Event("gattserverdisconnected"));
    }
  }

  // ------------------------------------------------- navigator.bluetooth --
  const nativeBluetooth = {
    async requestDevice(options = {}) {
      try {
        await ensureInit();
        const services = [];
        for (const f of options.filters || []) for (const s of f.services || []) services.push(lc(s));
        const optionalServices = (options.optionalServices || []).map(lc);
        const dev = await BleClient.requestDevice({ services, optionalServices });
        return new NativeDevice(dev);
      } catch (e) {
        throw friendly(e);
      }
    },
  };
  Object.defineProperty(navigator, "bluetooth", { value: nativeBluetooth, configurable: true });

  // ----------------------------------------------------- salvar arquivo --
  function toBase64(bytes) {
    let bin = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return btoa(bin);
  }

  window.AukNative = {
    // Grava o arquivo no cache do app e abre a folha "Compartilhar" do iOS
    // (Salvar em Arquivos, AirDrop, enviar por WhatsApp/e-mail, etc.).
    async saveFile(filename, bytes) {
      const written = await Filesystem.writeFile({
        path: filename,
        data: toBase64(bytes),
        directory: Directory.Cache,
      });
      try {
        await Share.share({
          title: filename,
          dialogTitle: "Salvar ou enviar os dados",
          files: [written.uri],
        });
      } catch (e) {
        if (!/cancel/i.test((e && e.message) || "")) throw e;
      }
    },
  };
}
