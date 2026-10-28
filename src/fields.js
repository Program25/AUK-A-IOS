// fields.js — descreve CADA campo configurável.
//
// Espelha struct FlightConfig em flight_config.h e o array FIELDS[] em
// ble_config.cpp (mesmo esquema de UUID: "7b5c01" + índice hex + resto fixo).
//
// widget: "slider" | "dropdown" | "toggle" | "number" | "bitmask"
// visibleIf: { key, equals } — campo só aparece quando FIELDS[key] atual
// vale "equals" (comparado como número). Usado pro NetID, que só existe
// no E22. app.js reconstrói a tela inteira a cada escrita, então trocar
// o modelo do transceptor já atualiza a visibilidade na hora.
//
// NOTA IMPORTANTE sobre velocidade de transmissão: não existe um campo
// "período de telemetria" aqui de propósito. O tempo entre pacotes LoRa
// é calculado pelo firmware a partir de uma fórmula interna
// (LoRaStandbyTime, em main.cpp) que depende do tamanho do pacote e da
// taxa no ar (loraAirRateIdx). Mudar "Taxa no ar" abaixo já recalcula
// esse intervalo sozinho — não há um número de "velocidade" solto pra
// configurar por fora dessa fórmula.
//
// NOTA IMPORTANTE sobre a taxa no ar: a codificação de bits abaixo (0 a 7)
// segue a tabela documentada pela EBYTE para os módulos desta família —
// só que essa tabela NÃO tem 8 velocidades distintas: os índices 0, 1 e 2
// são todos "2.4 kbps" (variantes internas do chip), e o índice 6 é
// listado como "34.8 kbps" em vez de 38.4. Isso é estranho mas é o que o
// datasheet realmente diz — confirme contra o PDF do SEU módulo antes de
// confiar nisso em voo.
//
// NOTA IMPORTANTE sobre "Sensores habilitados": desabilitar Barômetro
// desliga a ejeção automática inteira (apogeu e main são detectados por
// altitude barométrica). Desabilitar IMU desliga a detecção de
// decolagem (o TimeLock nunca destrava, então a ejeção fica travada
// fechada). Nenhum dos dois é pensado pra voo real — são pra testar em
// bancada com um sensor com defeito ou fora de uso.
//
// NOTA IMPORTANTE sobre o "Modelo do transceptor": E22 e E220 T30D usam
// a MESMA tabela de potência (30/27/24/21 dBm) e o mesmo REG0/REG1, mas
// o E22 tem um registrador NETID extra que o E220 não tem — isso desloca
// a posição de todos os bytes gravados depois dele. Por isso o firmware
// precisa saber qual modelo está fisicamente conectado ANTES de montar o
// pacote de gravação, e por isso essa escolha é o primeiro campo da tela.
//
// NOTA IMPORTANTE sobre "Modo de transmissão": no modo Transparente, tudo
// que sai pela UART vai pro ar igual, pra qualquer rádio ouvindo no mesmo
// endereço/canal — é o modo usado até agora. No modo Ponto a ponto
// (fixed), CADA pacote sai prefixado com o endereço/canal de destino, e o
// "Endereço destino" abaixo só aparece (e só importa) nesse modo. Os DOIS
// rádios (foguete e ground station) precisam estar no MESMO modo, senão a
// comunicação para de funcionar por completo.

const SERVICE_UUID = "7b5c0001-6c1e-4b6a-9a2e-d31f8c6a0b00";
const STATUS_UUID  = "7b5c0002-6c1e-4b6a-9a2e-d31f8c6a0b00";
const CMD_UUID     = "7b5c0003-6c1e-4b6a-9a2e-d31f8c6a0b00";
const FILE_CMD_UUID  = "7b5c0004-6c1e-4b6a-9a2e-d31f8c6a0b00";
const FILE_DATA_UUID = "7b5c0005-6c1e-4b6a-9a2e-d31f8c6a0b00";

function fieldUuid(n) {
  return `7b5c01${n}-6c1e-4b6a-9a2e-d31f8c6a0b00`;
}

const GROUPS = ["LoRa", "Recuperação", "Sensores", "Sistema"];

const FIELDS = [
  {
    uuid: fieldUuid("0d"), key: "loraModuleModel", group: "LoRa",
    label: "Modelo do transceptor", widget: "dropdown",
    choices: ["E220-900T30D", "E22-900T30D"],
    help: "Escolha o módulo fisicamente instalado nesta placa. Isso muda o formato dos registradores gravados — o E22 tem um campo NETID a mais que aparece abaixo quando selecionado.",
  },
  {
    uuid: fieldUuid("01"), key: "loraAddress", group: "LoRa",
    label: "Endereço do rádio", widget: "number",
    min: 0, max: 65535, step: 1, unit: "",
    help: "Precisa bater com o endereço configurado na ground station.",
  },
  {
    uuid: fieldUuid("0e"), key: "loraNetId", group: "LoRa",
    label: "NETID (só no E22)", widget: "number",
    min: 0, max: 255, step: 1, unit: "",
    visibleIf: { key: "loraModuleModel", equals: 1 },
    help: "Filtro de rede do E22 — rádios com NETID diferente se ignoram mesmo no mesmo canal/endereço. O E220 não tem esse registrador.",
  },
  {
    uuid: fieldUuid("02"), key: "loraChannel", group: "LoRa",
    label: "Canal", widget: "slider",
    min: 0, max: 83, step: 1, unit: "",
    format: (v) => `${v}  (${(850.125 + Number(v)).toFixed(3)} MHz)`,
    help: "Frequência = 850.125 + canal, em MHz. Confira a faixa liberada pela ANATEL antes de mudar.",
  },
  {
    uuid: fieldUuid("03"), key: "loraAirRateIdx", group: "LoRa",
    label: "Taxa no ar", widget: "dropdown",
    choices: ["2.4 kbps (a)", "2.4 kbps (b)", "2.4 kbps", "4.8 kbps",
              "9.6 kbps", "19.2 kbps", "~34.8 kbps", "62.5 kbps"],
    help: "Os três primeiros valores são todos ~2.4 kbps (variantes do chip, ver datasheet). Taxas menores alcançam mais longe, porém mais devagar. O intervalo entre pacotes é recalculado automaticamente a partir daqui.",
  },
  {
    uuid: fieldUuid("04"), key: "loraTxPowerIdx", group: "LoRa",
    label: "Potência de transmissão", widget: "dropdown",
    choices: ["30 dBm (máx.)", "27 dBm", "24 dBm", "21 dBm"],
    help: "Potência mais alta = mais alcance, mais consumo de bateria. Mesma tabela para E22 e E220 T30D.",
  },
  {
    uuid: fieldUuid("0f"), key: "loraTransmissionMode", group: "LoRa",
    label: "Modo de transmissão", widget: "dropdown",
    choices: ["Transparente (broadcast)", "Ponto a ponto (fixed)"],
    help: "Os dois rádios (foguete e ground station) precisam estar no MESMO modo, senão a comunicação para de funcionar.",
  },
  {
    uuid: fieldUuid("10"), key: "loraDestAddress", group: "LoRa",
    label: "Endereço destino (modo ponto a ponto)", widget: "number",
    min: 0, max: 65535, step: 1, unit: "",
    visibleIf: { key: "loraTransmissionMode", equals: 1 },
    help: "Endereço do rádio de destino — só é usado (e só é enviado) quando o modo de transmissão é Ponto a ponto.",
  },
  {
    uuid: fieldUuid("0c"), key: "loraUartBaudIdx", group: "LoRa",
    label: "Baudrate da UART (ESP32 ↔ rádio)", widget: "dropdown",
    choices: ["1200", "2400", "4800", "9600", "19200", "38400", "57600", "115200"],
    help: "Velocidade do link serial local — não é a taxa no ar. O módulo sempre aceita comandos de configuração a 9600, então mudar isso é seguro: o firmware troca a UART sozinho depois de confirmar a gravação.",
  },
  {
    uuid: fieldUuid("05"), key: "apogeeDeltaM", group: "Recuperação",
    label: "Delta de apogeu", widget: "slider",
    min: 5, max: 200, step: 1, unit: " m",
    help: "Queda de altitude abaixo do pico que confirma o apogeu e aciona a ejeção do pyrowire.",
  },
  {
    uuid: fieldUuid("06"), key: "mainDeployAltM", group: "Recuperação",
    label: "Altitude do paraquedas principal", widget: "slider",
    min: 50, max: 2000, step: 10, unit: " m AGL",
    help: "Altura acima do solo em que o paraquedas principal é ejetado, na descida.",
  },
  {
    uuid: fieldUuid("07"), key: "ejectionDelayMs", group: "Recuperação",
    label: "Atraso de ejeção", widget: "slider",
    min: 500, max: 8000, step: 100, unit: " ms",
    help: "Espera antes de energizar o squib, pra não disparar antes do sistema de recuperação primário (COTS).",
  },
  {
    uuid: fieldUuid("08"), key: "timeLockMs", group: "Recuperação",
    label: "Bloqueio de tempo pós-decolagem", widget: "slider",
    min: 1000, max: 30000, step: 500, unit: " ms",
    help: "Tempo mínimo após detectar a decolagem antes que qualquer ejeção seja permitida.",
  },
  {
    uuid: fieldUuid("09"), key: "accelLimitG", group: "Recuperação",
    label: "Limiar de aceleração (decolagem)", widget: "slider",
    min: 2, max: 30, step: 0.5, unit: " m/s²",
    help: "Aceleração absoluta acima da qual o firmware considera que o foguete decolou.",
  },
  {
    uuid: fieldUuid("0a"), key: "bleIdleTimeoutS", group: "Sistema",
    label: "Timeout de inatividade do Bluetooth", widget: "slider",
    min: 0, max: 3600, step: 30, unit: " s",
    help: "0 = nunca desliga sozinho por inatividade. Sempre desliga ao detectar decolagem, e pode ser desligado na hora pelo botão abaixo.",
  },
  {
    uuid: fieldUuid("0b"), key: "sensorEnableMask", group: "Sensores",
    label: "Sensores habilitados", widget: "bitmask",
    bits: [
      { bit: 0x01, label: "Barômetro (altitude/ejeção)" },
      { bit: 0x02, label: "IMU (detecção de decolagem)" },
      { bit: 0x04, label: "GPS" },
      { bit: 0x08, label: "Transmissão LoRa (telemetria)" },
    ],
  },
];
