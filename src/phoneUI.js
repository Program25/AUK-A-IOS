"use strict";

// phoneUI.js — aba "📱 Celular": interruptor "Enviar posição ao laptop".
// Só aparece no app do celular (window.AukPhone é criado por native/phone.js).
(function () {
  const api = window.AukPhone;
  const tab = document.getElementById("tabPhone");
  if (!api || !tab) return;
  tab.style.display = "";

  const $ = (id) => document.getElementById(id);
  const sw = $("phSwitch");
  const dot = $("phDot");
  const statusEl = $("phStatus");
  const warnCard = $("phWarnCard");

  let st = {};            // último estado do serviço (cada evento substitui o anterior)
  let meta = {};          // suporte/bateria: só vêm do getState e não mudam a cada segundo
  let starting = false;   // entre ligar o interruptor e o serviço confirmar
  let localError = "";    // erro de quem ligou (permissão negada, Bluetooth...)
  let askedBattery = false;
  let wantBatteryPrompt = false;

  function fmt(n, d) { return Number.isFinite(n) ? n.toFixed(d) : "—"; }

  function statusText() {
    if (starting && !st.running) return ["connecting", "Iniciando…"];
    if (!st.running) return ["off", "Desligado"];
    if (st.subscribed > 0) return ["on", "Laptop recebendo a posição"];
    if (st.connected > 0) return ["connecting", "Laptop conectado — aguardando…"];
    if (st.advertising) return ["connecting", "Anunciando… aguardando o laptop"];
    return ["connecting", "Iniciando…"];
  }

  function warn(kind, text, btnLabel, onClick) {
    const box = document.createElement("div");
    box.className = "ph-warn " + kind;
    const p = document.createElement("p");
    p.textContent = text;
    box.appendChild(p);
    if (btnLabel) {
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = btnLabel;
      b.addEventListener("click", onClick);
      box.appendChild(b);
    }
    warnCard.appendChild(box);
  }

  function render() {
    const running = !!st.running;
    sw.checked = running || starting;
    sw.disabled = meta.supported === false;

    const [cls, text] = statusText();
    dot.className = "dot" + (cls === "on" ? " connected" : cls === "connecting" ? " connecting" : "");
    statusEl.textContent = text;

    // ---- dados
    if (running && st.hasFix) {
      $("phGps").textContent = "fixo ✓";
      $("phPos").textContent = `${fmt(st.lat, 6)}, ${fmt(st.lng, 6)}`;
      $("phAcc").textContent = `±${fmt(st.acc, 1)} m`;
      $("phAlt").textContent = Number.isFinite(st.alt) ? `${fmt(st.alt, 0)} m` : "—";
    } else {
      $("phGps").textContent = running ? "sem sinal" : "—";
      $("phPos").textContent = "—";
      $("phAcc").textContent = "—";
      $("phAlt").textContent = "—";
    }
    $("phSent").textContent = String(st.sent || 0);

    // ---- avisos
    warnCard.innerHTML = "";
    if (meta.supported === false) {
      warn("bad", meta.unsupportedReason || "Este aparelho não suporta este recurso.");
    }
    const err = st.error || localError;
    if (err) warn("bad", err);
    if (running && st.gpsEnabled === false) {
      warn("bad", "A localização (GPS) do celular está desligada. O laptop só recebe “sem sinal”.",
        "Abrir ajustes de localização", () => api.openLocationSettings().catch(() => {}));
    } else if (running && st.gpsEnabled !== false && !st.hasFix) {
      warn("warn", "Sem sinal de GPS (o laptop recebe “NOFIX”). Vá para um lugar aberto, com visão do céu; dentro de prédios o GPS costuma não achar sinal.");
    }
    if (running && api.platform === "ios" && !(st.subscribed > 0)) {
      warn("warn", "Deixe o AUK-A aberto, com a tela ligada, até o laptop conectar. Com o app em segundo plano o iPhone não aparece na busca do laptop.");
    }
    if (running && st.mtuLow) {
      warn("warn", "O laptop conectou com pacote Bluetooth pequeno demais (MTU baixo) e a posição não cabe. Tente desconectar e conectar de novo no laptop.");
    }
    if (running && meta.batteryExempt === false) {
      warn("warn", "Para continuar com a tela apagada, permita que o AUK-A ignore a otimização de bateria.",
        "Permitir em segundo plano", () => api.requestBatteryExemption().catch(() => {}));
    }
    warnCard.style.display = warnCard.childElementCount ? "flex" : "none";
  }

  const META_KEYS = ["supported", "unsupportedReason", "batteryExempt", "btOn"];

  function apply(next) {
    for (const k of META_KEYS) if (k in next) meta[k] = next[k];
    st = {};
    for (const k of Object.keys(next)) if (!META_KEYS.includes(k)) st[k] = next[k];
    if (st.running) { starting = false; localError = ""; }
    if (st.error) starting = false;
    render();
    maybeAskBattery();
  }

  // Depois que o envio realmente começou, pede a isenção de bateria (uma vez).
  async function maybeAskBattery() {
    if (!wantBatteryPrompt || askedBattery || !st.running || meta.batteryExempt !== false) return;
    askedBattery = true;
    wantBatteryPrompt = false;
    const ok = await confirmModal(
      "Continuar com a tela apagada?",
      "O Android pode pausar o envio para economizar bateria. Toque em Confirmar para permitir que o AUK-A rode em segundo plano."
    );
    if (ok) { try { await api.requestBatteryExemption(); } catch (_) {} }
  }

  // Estados que o serviço manda a cada segundo (o batteryExempt só vem do getState).
  api.onState((s) => apply(s));

  async function refresh() {
    try { apply(await api.getState()); } catch (_) { /* fora do app nativo */ }
  }

  async function turnOn() {
    starting = true;
    wantBatteryPrompt = true;
    localError = "";
    st = Object.assign({}, st, { error: "" });
    render();
    try {
      await api.start();
      await refresh();   // traz suporte/bateria; o "running" chega pelo evento
      // se o serviço não confirmar em 8 s, algo falhou: sai de "Iniciando…"
      setTimeout(async () => {
        if (starting) { starting = false; await refresh(); render(); }
      }, 8000);
    } catch (e) {
      starting = false;
      wantBatteryPrompt = false;
      localError = (e && e.message) || String(e);
      sw.checked = false;
      render();
    }
  }

  async function turnOff() {
    starting = false;
    try { await api.stop(); } catch (_) {}
    await refresh();
  }

  sw.addEventListener("change", () => (sw.checked ? turnOn() : turnOff()));

  // Ao voltar para o app (ex.: depois dos ajustes de bateria/GPS), atualiza.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

  refresh().then(render);
})();
