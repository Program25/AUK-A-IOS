// groundFields.js — descreve os campos da ESTAÇÃO EM SOLO.
//
// Espelha struct GroundConfig (ground_config.h, projeto ground-station) e
// o array FIELDS[] em ble_ground_config.cpp. UUIDs num range separado
// (7b5c02xx/7b5c03xx) do usado pelo foguete (7b5c00xx/7b5c01xx) — pro
// app enxergar os dois como dispositivos BLE diferentes.
//
// NOTA: os valores aqui (endereço, canal, taxa no ar, modo de
// transmissão) precisam bater com os mesmos campos do foguete pros dois
// rádios se comunicarem — mas o MODELO do chip (E220/E22) pode ser
// diferente dos dois lados, cada um configurado no seu formato.

const GROUND_SERVICE_UUID = "7b5c0200-6c1e-4b6a-9a2e-d31f8c6a0b00";
const GROUND_STATUS_UUID  = "7b5c0201-6c1e-4b6a-9a2e-d31f8c6a0b00";
const GROUND_CMD_UUID     = "7b5c0202-6c1e-4b6a-9a2e-d31f8c6a0b00";

function groundFieldUuid(n) {
  return `7b5c03${n}-6c1e-4b6a-9a2e-d31f8c6a0b00`;
}

const GROUND_GROUPS = ["LoRa", "Sistema"];

const GROUND_FIELDS = [
  {
    uuid: groundFieldUuid("01"), key: "loraModuleModel", group: "LoRa",
    label: "Modelo do transceptor", widget: "dropdown",
    choices: ["E220-900T30D", "E22-900T30D"],
    help: "Escolha o módulo fisicamente instalado nesta estação — pode ser diferente do modelo usado no foguete.",
  },
  {
    uuid: groundFieldUuid("02"), key: "loraAddress", group: "LoRa",
    label: "Endereço do rádio", widget: "number",
    min: 0, max: 65535, step: 1, unit: "",
    help: "Precisa bater com o endereço configurado no foguete.",
  },
  {
    uuid: groundFieldUuid("03"), key: "loraNetId", group: "LoRa",
    label: "NETID (só no E22)", widget: "number",
    min: 0, max: 255, step: 1, unit: "",
    visibleIf: { key: "loraModuleModel", equals: 1 },
    help: "Filtro de rede do E22. O E220 não tem esse registrador.",
  },
  {
    uuid: groundFieldUuid("04"), key: "loraChannel", group: "LoRa",
    label: "Canal", widget: "slider",
    min: 0, max: 83, step: 1, unit: "",
    format: (v) => `${v}  (${(850.125 + Number(v)).toFixed(3)} MHz)`,
    help: "Precisa bater com o canal configurado no foguete.",
  },
  {
    uuid: groundFieldUuid("05"), key: "loraAirRateIdx", group: "LoRa",
    label: "Taxa no ar", widget: "dropdown",
    choices: ["2.4 kbps (a)", "2.4 kbps (b)", "2.4 kbps", "4.8 kbps",
              "9.6 kbps", "19.2 kbps", "~34.8 kbps", "62.5 kbps"],
    help: "Precisa bater com a taxa no ar configurada no foguete.",
  },
  {
    uuid: groundFieldUuid("06"), key: "loraTxPowerIdx", group: "LoRa",
    label: "Potência de transmissão", widget: "dropdown",
    choices: ["30 dBm (máx.)", "27 dBm", "24 dBm", "21 dBm"],
    help: "Potência de TX desta estação — não precisa bater com o foguete (ela só recebe na prática).",
  },
  {
    uuid: groundFieldUuid("07"), key: "loraTransmissionMode", group: "LoRa",
    label: "Modo de transmissão", widget: "dropdown",
    choices: ["Transparente (broadcast)", "Ponto a ponto (fixed)"],
    help: "Precisa ser o MESMO modo configurado no foguete, senão a comunicação para de funcionar.",
  },
  {
    uuid: groundFieldUuid("08"), key: "loraDestAddress", group: "LoRa",
    label: "Endereço destino (modo ponto a ponto)", widget: "number",
    min: 0, max: 65535, step: 1, unit: "",
    visibleIf: { key: "loraTransmissionMode", equals: 1 },
    help: "Só usado se um dia esta estação também transmitir no modo fixo.",
  },
  {
    uuid: groundFieldUuid("09"), key: "loraUartBaudIdx", group: "LoRa",
    label: "Baudrate da UART (ESP32 ↔ rádio)", widget: "dropdown",
    choices: ["1200", "2400", "4800", "9600", "19200", "38400", "57600", "115200"],
    help: "Link serial local desta estação — independente do que o foguete usa.",
  },
  {
    uuid: groundFieldUuid("0a"), key: "bleIdleTimeoutS", group: "Sistema",
    label: "Timeout de inatividade do Bluetooth", widget: "slider",
    min: 0, max: 3600, step: 30, unit: " s",
    help: "0 = nunca desliga sozinho por inatividade.",
  },
];
