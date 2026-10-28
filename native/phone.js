// phone.js — ponte JS do recurso "Enviar posição ao laptop".
// O código nativo (periférico BLE + GPS) está em plugins/auk-phone/ (Swift) e é
// registrado como o plugin "AukPhone" pelo `cap sync`.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { BleClient } from "@capacitor-community/bluetooth-le";

if (Capacitor.isNativePlatform()) {
  const AukPhone = registerPlugin("AukPhone");

  const platform = Capacitor.getPlatform();   // "ios" | "android"

  window.AukPhone = {
    platform,
    getState: () => AukPhone.getState(),

    // Inicia o envio. O plugin nativo pede as permissões que faltarem
    // (localização precisa e Bluetooth) e confere se o Bluetooth está ligado.
    // No Android, antes disso, oferece ligar o Bluetooth (o iOS não permite isso).
    async start() {
      if (platform === "android") {
        await BleClient.initialize({ androidNeverForLocation: true });
        if (!(await BleClient.isEnabled())) {
          try {
            await BleClient.requestEnable();
          } catch (_) {
            throw new Error("Bluetooth desligado. Ligue o Bluetooth do celular e tente de novo.");
          }
        }
      }
      return AukPhone.start();
    },

    stop: () => AukPhone.stop(),
    openLocationSettings: () => AukPhone.openLocationSettings(),
    requestBatteryExemption: () => AukPhone.requestBatteryExemption(),
    onState: (cb) => AukPhone.addListener("state", cb),
  };
}
