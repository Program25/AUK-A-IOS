"use strict";

// ============================================================================
// Recursos compartilhados pelas duas abas (foguete e estação em solo):
// codificação de texto, o modal de confirmação, e o seletor de dispositivo
// do Electron (a pilha BLE do Chromium só permite um requestDevice() por
// vez, e só uma aba fica visível/clicável de cada vez, então compartilhar
// esses elementos entre as duas sessões é seguro).
// ============================================================================
const enc = new TextEncoder();
const dec = new TextDecoder();

function slug(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
}

function confirmModal(title, body) {
  return new Promise((resolve) => {
    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalBody").textContent = body;
    document.getElementById("modalBackdrop").classList.add("show");
    const cleanup = (result) => {
      document.getElementById("modalBackdrop").classList.remove("show");
      document.getElementById("modalConfirm").onclick = null;
      document.getElementById("modalCancel").onclick = null;
      resolve(result);
    };
    document.getElementById("modalConfirm").onclick = () => cleanup(true);
    document.getElementById("modalCancel").onclick = () => cleanup(false);
  });
}

// (Só Electron/desktop) Electron não tem o seletor nativo de dispositivo Bluetooth do Chrome,
// (no Android o plugin BLE mostra o próprio seletor — ver native/native.js),
// então main.js intercepta e manda a lista pra cá quando há mais de um
// dispositivo compatível.
if (window.electronBLE) {
  window.electronBLE.onDeviceList((devices) => {
    const listEl = document.getElementById("deviceList");
    listEl.innerHTML = "";
    devices.forEach((d) => {
      const btn = document.createElement("button");
      btn.className = "btn device-item";
      btn.textContent = d.deviceName + " (" + d.deviceId.slice(0, 8) + "…)";
      btn.addEventListener("click", () => {
        window.electronBLE.selectDevice(d.deviceId);
        document.getElementById("devicePickerBackdrop").classList.remove("show");
      });
      listEl.appendChild(btn);
    });
    document.getElementById("devicePickerBackdrop").classList.add("show");
  });
}
document.getElementById("devicePickerCancel").addEventListener("click", () => {
  window.electronBLE?.cancelSelection();
  document.getElementById("devicePickerBackdrop").classList.remove("show");
});

// ============================================================================
// createSession() — toda a lógica de uma aba (conexão BLE, leitura/escrita
// de campos, interface). Chamado uma vez pro foguete e uma vez pra estação
// em solo; cada chamada tem seu próprio estado (fechamento/closure) e seus
// próprios elementos de DOM (o mesmo id-base + cfg.suffix).
// ============================================================================
function createSession(cfg) {
  const $ = (id) => document.getElementById(id + cfg.suffix);

  let device = null;
  let server = null;
  let chStatus = null;
  let chCmd = null;
  let chFileCmd = null;
  let chFileData = null;
  let fileCmdWaiter = null;
  const chField = {};
  const liveValue = {};
  const dirtyKeys = new Set();
  let connected = false;

  const connDot = $("connDot");
  const connLabel = $("connLabel");
  const connectError = $("connectError");
  const statusCard = $("statusCard");
  const mainEl = $("main");
  const toastEl = $("toast");
  const btnConnect = $("btnConnect");
  const btnDisconnect = $("btnDisconnect");
  const btnCancelScan = $("btnCancelScan");
  const sdProgress = cfg.hasFileTransfer ? $("sdProgress") : null;

  function setDot(state) {
    connDot.className = "dot" + (state === "connected" ? " connected" : state === "connecting" ? " connecting" : "");
  }

  function toast(msg, ms = 2600) {
    toastEl.textContent = msg;
    if (ms) setTimeout(() => { if (toastEl.textContent === msg) toastEl.textContent = ""; }, ms);
  }

  // ---------------------------------------------------- placeholder data --
  function placeholderValue(f) {
    switch (f.widget) {
      case "slider":
      case "number": return f.min;
      case "dropdown": return 0;
      case "toggle": return "0";
      case "bitmask": return 0;
      default: return "";
    }
  }

  function currentFieldValue(key) {
    if (connected && liveValue[key] !== undefined) return Number(liveValue[key]);
    const dep = cfg.FIELDS.find((x) => x.key === key);
    return dep ? Number(placeholderValue(dep)) : undefined;
  }

  function fieldVisible(f) {
    if (!f.visibleIf) return true;
    return currentFieldValue(f.visibleIf.key) === f.visibleIf.equals;
  }

  // -------------------------------------------------------- BLE plumbing --
  async function connect() {
    if (!navigator.bluetooth) {
      connectError.style.display = "block";
      connectError.textContent = "Bluetooth não disponível neste app.";
      return;
    }
    connectError.style.display = "none";
    btnConnect.disabled = true;
    btnConnect.style.display = "none";
    btnCancelScan.style.display = "block";
    setDot("connecting");
    connLabel.textContent = "Buscando...";

    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [cfg.serviceUuid] }],
        optionalServices: [cfg.serviceUuid],
      });
      device.addEventListener("gattserverdisconnected", onDisconnected);

      connLabel.textContent = "Conectando...";
      server = await device.gatt.connect();
      const svc = await server.getPrimaryService(cfg.serviceUuid);

      chStatus = await svc.getCharacteristic(cfg.statusUuid);
      chCmd = await svc.getCharacteristic(cfg.cmdUuid);
      if (cfg.hasFileTransfer) {
        chFileCmd = await svc.getCharacteristic(cfg.fileCmdUuid);
        chFileData = await svc.getCharacteristic(cfg.fileDataUuid);
      }

      for (const f of cfg.FIELDS) {
        chField[f.key] = await svc.getCharacteristic(f.uuid);
      }

      await chStatus.startNotifications();
      chStatus.addEventListener("characteristicvaluechanged", (e) => {
        cfg.renderStatus($, dec.decode(e.target.value));
      });

      await chCmd.startNotifications().catch(() => {});
      chCmd.addEventListener("characteristicvaluechanged", (e) => {
        toast(dec.decode(e.target.value));
      });

      if (cfg.hasFileTransfer) {
        await chFileCmd.startNotifications();
        chFileCmd.addEventListener("characteristicvaluechanged", (e) => {
          const text = dec.decode(e.target.value);
          if (fileCmdWaiter) { const r = fileCmdWaiter; fileCmdWaiter = null; r(text); }
        });
      }

      await readAllFields();

      connected = true;
      buildUI();
      setActionsEnabled(true);

      setDot("connected");
      connLabel.textContent = device.name || "Conectado";
      btnDisconnect.style.display = "block";
      btnCancelScan.style.display = "none";
      statusCard.style.display = "block";
    } catch (err) {
      const msg = (err && err.message) || String(err);
      const cancelled = /cancel/i.test(msg);
      if (!cancelled) console.error(err);
      setDot("disconnected");
      connLabel.textContent = "Desconectado";
      connectError.style.display = "block";
      connectError.textContent = cancelled ? "Busca cancelada." : "Não conectou: " + msg;
    } finally {
      btnConnect.disabled = false;
      btnConnect.style.display = connected ? "none" : "block";
      btnCancelScan.style.display = "none";
    }
  }

  function disconnect() {
    if (device && device.gatt.connected) {
      device.gatt.disconnect();
    } else {
      onDisconnected();
    }
  }

  function onDisconnected() {
    connected = false;
    device = null; server = null; chStatus = null; chCmd = null;
    chFileCmd = null; chFileData = null; fileCmdWaiter = null;
    for (const k of Object.keys(chField)) delete chField[k];
    dirtyKeys.clear();

    setDot("disconnected");
    connLabel.textContent = "Desconectado";
    btnConnect.style.display = "block";
    btnDisconnect.style.display = "none";
    btnCancelScan.style.display = "none";
    statusCard.style.display = "none";
    if (sdProgress) sdProgress.style.display = "none";

    buildUI();
    setActionsEnabled(false);
    toast("Desconectado. O firmware ainda decide se o rádio continua ligado.", 5000);
  }

  async function readAllFields() {
    for (const f of cfg.FIELDS) {
      const v = await chField[f.key].readValue();
      liveValue[f.key] = dec.decode(v);
    }
    dirtyKeys.clear();
  }

  async function writeField(f, text) {
    await chField[f.key].writeValue(enc.encode(text));
    const v = await chField[f.key].readValue();
    const stored = dec.decode(v);
    liveValue[f.key] = stored;
    return stored;
  }

  async function sendCmd(cmd) {
    await chCmd.writeValue(enc.encode(cmd));
  }

  // ------------------------------------------------- transferência de SD --
  function waitFileCmd(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        fileCmdWaiter = null;
        reject(new Error("tempo esgotado esperando resposta do ESP32"));
      }, timeoutMs);
      fileCmdWaiter = (text) => { clearTimeout(timer); resolve(text); };
    });
  }

  function showSdProgress(text, isErr = false) {
    if (!sdProgress) return;
    sdProgress.textContent = text;
    sdProgress.className = "sd-progress" + (isErr ? " err" : "");
    sdProgress.style.display = text ? "block" : "none";
  }

  function setSdBusy(busy) {
    $("btnDownloadSD").disabled = busy || !connected;
    $("btnEraseSD").disabled = busy || !connected;
  }

  async function downloadSdFile() {
    if (!connected) return;
    setSdBusy(true);
    showSdProgress("Abrindo arquivo no cartão...");
    try {
      await chFileCmd.writeValue(enc.encode("DL_START"));
      const sizeReply = await waitFileCmd();
      const sizeMatch = sizeReply.match(/^SIZE:(\d+)$/);
      if (!sizeMatch) throw new Error(sizeReply);
      const total = Number(sizeMatch[1]);

      if (total === 0) {
        await chFileCmd.writeValue(enc.encode("DL_DONE"));
        showSdProgress("O arquivo está vazio - nada pra baixar.");
        toast("data.txt está vazio.");
        return;
      }

      const chunks = [];
      let received = 0;
      while (true) {
        await chFileCmd.writeValue(enc.encode("DL_CHUNK"));
        const reply = await waitFileCmd();
        const chunkMatch = reply.match(/^CHUNK:(\d+)$/);
        if (!chunkMatch) throw new Error(reply);
        const n = Number(chunkMatch[1]);
        if (n === 0) break;

        const val = await chFileData.readValue();
        chunks.push(new Uint8Array(val.buffer.slice(val.byteOffset, val.byteOffset + n)));
        received += n;
        showSdProgress(`Baixando... ${received} / ${total} bytes`);
      }

      await chFileCmd.writeValue(enc.encode("DL_DONE"));

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `atlas-log-${stamp}.txt`;

      if (window.AukNative) {
        // Android: o <a download> com blob: não funciona no WebView.
        // Grava no cache e abre a folha "Compartilhar" (Salvar em Arquivos, Drive, WhatsApp...).
        const all = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) { all.set(c, off); off += c.length; }
        await window.AukNative.saveFile(fileName, all);
        showSdProgress(`Concluído: ${received} bytes baixados.`);
        toast("Dados baixados — escolha onde salvar ou enviar.", 5000);
      } else {
        const blob = new Blob(chunks, { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);

        showSdProgress(`Concluído: ${received} bytes salvos.`);
        toast("Download concluído — arquivo salvo na pasta Downloads.");
      }
    } catch (e) {
      showSdProgress("Erro: " + e.message, true);
      toast("Erro no download: " + e.message, 5000);
    } finally {
      setSdBusy(false);
    }
  }

  async function eraseSdCard() {
    if (!connected) return;
    const ok = await confirmModal(
      "Apagar cartão SD?",
      "Isso apaga PERMANENTEMENTE o arquivo de log (data.txt) do cartão. Não pode ser desfeito — baixe os dados antes se ainda precisar deles."
    );
    if (!ok) return;

    setSdBusy(true);
    showSdProgress("Apagando cartão...");
    try {
      await chFileCmd.writeValue(enc.encode("ERASE"));
      const reply = await waitFileCmd();
      if (reply.startsWith("ERR")) throw new Error(reply);
      showSdProgress("Cartão apagado.");
      toast("Cartão SD apagado.");
    } catch (e) {
      showSdProgress("Erro: " + e.message, true);
      toast("Erro ao apagar: " + e.message, 5000);
    } finally {
      setSdBusy(false);
    }
  }

  // --------------------------------------------------------------- UI -----
  function buildUI() {
    mainEl.innerHTML = "";
    const navEl = $("groupNav");
    navEl.innerHTML = "";

    for (const group of cfg.GROUPS) {
      const items = cfg.FIELDS.filter((f) => f.group === group && fieldVisible(f));
      if (!items.length) continue;

      const groupId = "group-" + cfg.suffix + "-" + slug(group);
      const sec = document.createElement("div");
      sec.className = "group";
      sec.id = groupId;
      sec.innerHTML = `<h2>${group}</h2>`;

      const grid = document.createElement("div");
      grid.className = "group-grid";
      for (const f of items) grid.appendChild(renderCard(f));
      sec.appendChild(grid);
      mainEl.appendChild(sec);

      const link = document.createElement("a");
      link.href = "#" + groupId;
      link.textContent = group;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById(groupId).scrollIntoView({ behavior: "smooth", block: "start" });
      });
      navEl.appendChild(link);
    }
  }

  function markDirty(key) {
    dirtyKeys.add(key);
    const el = $("stUnsaved");
    if (el) el.style.display = "block";
  }

  function renderCard(f) {
    const card = document.createElement("div");
    card.className = "card" + (connected ? "" : " disabled");
    const dis = connected ? "" : "disabled";
    const raw = connected && liveValue[f.key] !== undefined ? liveValue[f.key] : placeholderValue(f);

    if (f.widget === "slider") {
      const val = Number(raw);
      card.innerHTML = `
        <div class="label-row"><label>${f.label}</label>
          <span class="value" id="val-${f.key}"></span></div>
        <input type="range" id="in-${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${val}" ${dis}>
        ${f.help ? `<div class="help">${f.help}</div>` : ""}`;
      const input = card.querySelector(`#in-${f.key}`);
      const valEl = card.querySelector(`#val-${f.key}`);
      const show = (v) => valEl.textContent = f.format ? f.format(v) : `${v}${f.unit || ""}`;
      show(val);
      input.addEventListener("input", () => show(input.value));
      input.addEventListener("change", async () => {
        if (!connected) return;
        try {
          const stored = await writeField(f, String(input.value));
          input.value = stored; show(stored); markDirty(f.key);
          buildUI();
        } catch (e) { toast("Erro: " + e.message); }
      });

    } else if (f.widget === "number") {
      card.innerHTML = `
        <div class="label-row"><label>${f.label}</label></div>
        <input type="number" id="in-${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${raw}" ${dis}>
        ${f.help ? `<div class="help">${f.help}</div>` : ""}`;
      const input = card.querySelector(`#in-${f.key}`);
      input.addEventListener("change", async () => {
        if (!connected) return;
        try {
          const stored = await writeField(f, String(input.value));
          input.value = stored; markDirty(f.key);
          buildUI();
        } catch (e) { toast("Erro: " + e.message); }
      });

    } else if (f.widget === "dropdown") {
      const idx = Number(raw);
      const opts = f.choices.map((c, i) =>
        `<option value="${i}" ${i === idx ? "selected" : ""}>${c}</option>`).join("");
      card.innerHTML = `
        <div class="label-row"><label>${f.label}</label></div>
        <select id="in-${f.key}" ${dis}>${opts}</select>
        ${f.help ? `<div class="help">${f.help}</div>` : ""}`;
      const sel = card.querySelector(`#in-${f.key}`);
      sel.addEventListener("change", async () => {
        if (!connected) return;
        try {
          const stored = await writeField(f, sel.value);
          sel.value = stored; markDirty(f.key);
          buildUI();
        } catch (e) { toast("Erro: " + e.message); }
      });

    } else if (f.widget === "toggle") {
      const on = raw === "1";
      card.innerHTML = `
        <div class="label-row"><label>${f.label}</label>
          <label class="switch">
            <input type="checkbox" id="in-${f.key}" ${on ? "checked" : ""} ${dis}>
            <span class="slider-track"></span>
          </label></div>
        ${f.help ? `<div class="help">${f.help}</div>` : ""}`;
      const cb = card.querySelector(`#in-${f.key}`);
      cb.addEventListener("change", async () => {
        if (!connected) return;
        try {
          const stored = await writeField(f, cb.checked ? "1" : "0");
          cb.checked = stored === "1"; markDirty(f.key);
          buildUI();
        } catch (e) { toast("Erro: " + e.message); }
      });

    } else if (f.widget === "bitmask") {
      const mask = Number(raw);
      card.innerHTML = `<div class="label-row"><label>${f.label}</label></div>`;
      for (const b of f.bits) {
        const row = document.createElement("div");
        row.className = "bit-row";
        const on = (mask & b.bit) !== 0;
        row.innerHTML = `
          <span>${b.label}</span>
          <label class="switch">
            <input type="checkbox" data-bit="${b.bit}" ${on ? "checked" : ""} ${dis}>
            <span class="slider-track"></span>
          </label>`;
        const cb = row.querySelector("input");
        cb.addEventListener("change", async () => {
          if (!connected) return;
          let newMask = Number(liveValue[f.key]);
          newMask = cb.checked ? (newMask | b.bit) : (newMask & ~b.bit);
          try {
            const stored = await writeField(f, String(newMask));
            cb.checked = (Number(stored) & b.bit) !== 0;
            markDirty(f.key);
          } catch (e) { toast("Erro: " + e.message); }
        });
        card.appendChild(row);
      }
    }

    return card;
  }

  // ------------------------------------------------------------ actions ---
  function setActionsEnabled(enabled) {
    $("btnReload").disabled = !enabled;
    $("btnDefaults").disabled = !enabled;
    $("btnSave").disabled = !enabled;
    if (cfg.hasArm) $("btnArm").disabled = !enabled;
    if (cfg.hasCloseBle) $("btnCloseBle").disabled = !enabled;
    if (cfg.hasFileTransfer) {
      $("btnDownloadSD").disabled = !enabled;
      $("btnEraseSD").disabled = !enabled;
    }
  }

  btnConnect.addEventListener("click", connect);
  btnDisconnect.addEventListener("click", disconnect);
  btnCancelScan.addEventListener("click", () => window.electronBLE?.cancelSelection());

  $("btnReload").addEventListener("click", async () => {
    try {
      await sendCmd("RELOAD");
      await readAllFields();
      buildUI();
      const el = $("stUnsaved"); if (el) el.style.display = "none";
      toast("Configuração recarregada da memória.");
    } catch (e) { toast("Erro: " + e.message); }
  });

  $("btnDefaults").addEventListener("click", async () => {
    const ok = await confirmModal(
      "Restaurar padrões?",
      "Isso substitui todos os campos pelos valores de fábrica. Nada é gravado até você apertar Salvar."
    );
    if (!ok) return;
    try {
      await sendCmd("DEFAULTS");
      await readAllFields();
      buildUI();
      markDirty("_defaults");
      toast("Padrões carregados (ainda não salvos).");
    } catch (e) { toast("Erro: " + e.message); }
  });

  $("btnSave").addEventListener("click", async () => {
    try {
      await sendCmd("SAVE");
      dirtyKeys.clear();
      const el = $("stUnsaved"); if (el) el.style.display = "none";
      toast("Configuração salva na memória.");
    } catch (e) { toast("Erro: " + e.message); }
  });

  if (cfg.hasArm) {
    $("btnArm").addEventListener("click", async () => {
      const ok = await confirmModal(
        "Confirmar armamento",
        "Isso salva a configuração, verifica se foi gravada corretamente e desliga o Bluetooth. " +
        "Ele só volta a ligar quando a placa for reiniciada. Confirme apenas se o foguete estiver pronto para ir para a rampa."
      );
      if (!ok) return;

      toast("Salvando e verificando...", 0);
      try {
        await sendCmd("SAVE");
        const before = { ...liveValue };
        await readAllFields();
        const mismatches = cfg.FIELDS.filter((f) => liveValue[f.key] !== before[f.key]);
        if (mismatches.length) {
          buildUI();
          toast("Abortado: " + mismatches.map((f) => f.label).join(", ") + " não confere. Confira e tente de novo.", 6000);
          return;
        }
        toast("Confirmado. Desligando o Bluetooth...", 0);
        await sendCmd("BLEOFF");
        setTimeout(() => toast("Pronto. O rádio só volta com um novo power-cycle da placa.", 6000), 400);
      } catch (e) {
        toast("Erro ao armar: " + e.message, 6000);
      }
    });
  }

  if (cfg.hasCloseBle) {
    $("btnCloseBle").addEventListener("click", async () => {
      const ok = await confirmModal(
        "Desligar Bluetooth?",
        "Desliga o rádio Bluetooth desta estação. Ele só volta a ligar com um power-cycle da placa. " +
        "Se houver alterações não salvas, salve antes."
      );
      if (!ok) return;
      try {
        await sendCmd("BLEOFF");
      } catch (e) {
        toast("Erro: " + e.message, 5000);
      }
    });
  }

  if (cfg.hasFileTransfer) {
    $("btnDownloadSD").addEventListener("click", downloadSdFile);
    $("btnEraseSD").addEventListener("click", eraseSdCard);
  }

  // Monta a interface já na primeira carga, com valores de exemplo
  // (desabilitados) — conectar é uma opção na barra lateral, não um
  // portão na frente de tudo.
  buildUI();
  setActionsEnabled(false);
}

// ============================================================================
// Instâncias: uma pro foguete, uma pra estação em solo. Os arquivos
// fields.js e groundFields.js (carregados antes deste) definem as
// constantes usadas abaixo.
// ============================================================================
createSession({
  suffix: "",
  serviceUuid: SERVICE_UUID,
  statusUuid: STATUS_UUID,
  cmdUuid: CMD_UUID,
  fileCmdUuid: FILE_CMD_UUID,
  fileDataUuid: FILE_DATA_UUID,
  FIELDS,
  GROUPS,
  hasFileTransfer: true,
  hasArm: true,
  hasCloseBle: false,
  renderStatus($, text) {
    // firmware: "<STATE> alt=<x>m faults=<a,b,c|none> [*unsaved*]"
    const m = text.match(/^(\S+)\s+alt=([-\d.]+)m\s+faults=(\S+)(.*)$/);
    if (!m) { $("stState").textContent = text; return; }
    const [, state, alt, faults, rest] = m;
    $("stState").textContent = state;
    $("stAlt").textContent = `${Number(alt).toFixed(1)} m`;
    const fEl = $("stFaults");
    if (faults === "none") {
      fEl.textContent = "sensores OK";
      fEl.className = "faults ok";
    } else {
      fEl.textContent = "falha: " + faults;
      fEl.className = "faults bad";
    }
    $("stUnsaved").style.display = rest.includes("unsaved") ? "block" : "none";
  },
});

createSession({
  suffix: "Gs",
  serviceUuid: GROUND_SERVICE_UUID,
  statusUuid: GROUND_STATUS_UUID,
  cmdUuid: GROUND_CMD_UUID,
  FIELDS: GROUND_FIELDS,
  GROUPS: GROUND_GROUPS,
  hasFileTransfer: false,
  hasArm: false,
  hasCloseBle: true,
  renderStatus($, text) {
    // firmware: "RX:<n> last=<s>s [*unsaved*]"
    const m = text.match(/^RX:(\d+)\s+last=([\d.]+)s(.*)$/);
    if (!m) { $("stState").textContent = text; return; }
    const [, count, lastS, rest] = m;
    $("stState").textContent = `${count} pacotes recebidos`;
    $("stAlt").textContent = `último há ${Number(lastS).toFixed(1)}s`;
    $("stUnsaved").style.display = rest.includes("unsaved") ? "block" : "none";
  },
});

// ============================================================================
// Abas: alterna entre o painel do foguete e o da estação em solo. As duas
// sessões continuam vivas (e suas conexões BLE independentes) mesmo com a
// aba escondida — trocar de aba só troca o que está visível na tela.
// ============================================================================
const tabRocket = document.getElementById("tabRocket");
const tabGround = document.getElementById("tabGround");
const tabPhone = document.getElementById("tabPhone");   // só existe/aparece no app Android
const panelRocket = document.getElementById("panelRocket");
const panelGround = document.getElementById("panelGround");
const panelPhone = document.getElementById("panelPhone");

function showTab(name) {
  const tabs = {
    rocket: [tabRocket, panelRocket],
    ground: [tabGround, panelGround],
    phone: [tabPhone, panelPhone],
  };
  for (const [key, [tab, panel]] of Object.entries(tabs)) {
    if (!tab || !panel) continue;
    const on = key === name;
    panel.style.display = on ? "flex" : "none";
    tab.classList.toggle("active", on);
  }
}
tabRocket.addEventListener("click", () => showTab("rocket"));
tabGround.addEventListener("click", () => showTab("ground"));
if (tabPhone) tabPhone.addEventListener("click", () => showTab("phone"));
showTab("rocket");
