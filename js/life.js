/* =========================================================
   PXAX · Nova — life.js
   Клиентская часть «живого компаньона»:
     • жизнь синхронизируется с сервером (action:'life') — что случилось,
       пока приложения не было, и «Nova написала первой»
     • ритуал возвращения: приветствие, бонус за возврат, стрик
     • онбординг первого запуска (имя + знакомство)
     • голос: качественный русский женский TTS, иначе голос выключен
   Зависит от моста window.pxaxApp (см. index.html) и window.pxaxApi.
   ========================================================= */
(function () {
  'use strict';

  var KEYS = {
    voice: 'pxax_ai_voice_v1',
    onboarded: 'pxax_ai_onboarded_v1',
    returnDay: 'pxax_ai_return_day_v1',
    voiceName: 'pxax_ai_voice_name_v1'
  };

  var app = null;
  var state = {
    awayForMs: 0,
    returnBonusGiven: false,
    streak: 0,
    proactiveShown: false
  };

  function storage() {
    return (app && app.storage) || window.localStorage;
  }
  function getKey(k) { try { return storage().getItem(k); } catch (e) { return null; } }
  function setKey(k, v) { try { storage().setItem(k, v); } catch (e) {} }

  /* =========================================================
     ГОЛОС
     Системные голоса WebView (Microsoft Irina и подобные) звучат
     роботизированно, а в Telegram WebView их часто нет вовсе. Поэтому
     основной путь — серверная озвучка (Google TTS, ru) через воркер:
     звучит живо. Локальный speechSynthesis — только аварийный резерв,
     и лишь если он даёт действительно хороший русский женский голос.
     ========================================================= */
  var SERVER_TTS = true;          // серверная озвучка как основная
  var voice = { enabled: true, mode: 'server', localVoice: null, reason: '' };
  var audioEl = null;
  var ttsCache = {};              // текст → object URL, чтобы не дёргать сервер повторно

  var GOOD_RU = [
    { re: /google\s+русский/i, score: 100 },
    { re: /svetlana|светлана/i, score: 95 },
    { re: /dariya|дария|daria/i, score: 95 },
    { re: /milena|милена/i, score: 90 },
    { re: /katya|катя/i, score: 88 },
    { re: /yandex|алиса|alice/i, score: 80 }
  ];
  var BAD_RU = /irina|ирина|pavel|павел|microsoft|male|мужск/i;

  function pickLocalVoice() {
    voice.localVoice = null;
    if (!('speechSynthesis' in window)) return;
    var voices = [];
    try { voices = speechSynthesis.getVoices() || []; } catch (e) { return; }
    var ru = voices.filter(function (v) { return /^ru/i.test(v.lang || ''); });
    var ranked = ru.map(function (v) {
      var s = 0;
      GOOD_RU.forEach(function (g) { if (g.re.test(v.name || '')) s = Math.max(s, g.score); });
      if (BAD_RU.test(v.name || '')) s -= 200; // «Microsoft Irina» — как раз то, что не нравится
      return { v: v, s: s };
    }).sort(function (a, b) { return b.s - a.s; });
    if (ranked[0] && ranked[0].s >= 80) voice.localVoice = ranked[0].v;
  }

  function ensureAudio() {
    if (audioEl) return audioEl;
    audioEl = new Audio();
    audioEl.preload = 'auto';
    audioEl.setAttribute('playsinline', '');
    return audioEl;
  }

  function refreshVoiceButton() {
    var btn = document.getElementById('voice-toggle');
    if (!btn) return;
    var wantOn = getKey(KEYS.voice) !== '0';
    var on = wantOn && voice.enabled;
    btn.classList.toggle('off', !on);
    btn.innerHTML = '<svg class="ic ic-voice" aria-hidden="true"><use href="#' + (on ? 'i-sound' : 'i-mute') + '"/></svg>';
    btn.setAttribute('aria-pressed', String(on));
    btn.title = voice.enabled
      ? 'Голос компаньона: живой русский (сервер) — вкл/выкл'
      : 'Озвучка недоступна';
  }

  function stopSpeak() {
    try { if (audioEl) { audioEl.pause(); audioEl.currentTime = 0; } } catch (e) {}
    try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {}
  }

  function speakLocal(text) {
    if (!voice.localVoice) return false;
    try {
      var u = new SpeechSynthesisUtterance(String(text).slice(0, 400));
      u.voice = voice.localVoice;
      u.lang = voice.localVoice.lang || 'ru-RU';
      u.rate = 1; u.pitch = 1.05;
      speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  function speak(text) {
    if (getKey(KEYS.voice) === '0') return false;
    var clean = String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\{[^{}]*"(?:action|link)"[^{}]*\}/g, ' ')
      .replace(/[*_#`>]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!clean || clean.indexOf('⏳') !== -1) return false;
    stopSpeak();

    if (SERVER_TTS && app && app.apiUrl) {
      // кэш: одинаковые фразы не озвучиваем дважды
      if (ttsCache[clean]) {
        try { var a0 = ensureAudio(); a0.src = ttsCache[clean]; a0.play().catch(function () {}); return true; } catch (e) {}
      }
      try {
        var x = new XMLHttpRequest();
        x.open('POST', app.apiUrl, true);
        x.setRequestHeader('Content-Type', 'application/json');
        x.responseType = 'blob';
        x.timeout = 20000;
        x.onload = function () {
          if (x.status >= 200 && x.status < 300 && x.response && x.response.size > 200) {
            var url = URL.createObjectURL(x.response);
            ttsCache[clean] = url;
            var keys = Object.keys(ttsCache);
            if (keys.length > 40) { try { URL.revokeObjectURL(ttsCache[keys[0]]); } catch (e) {} delete ttsCache[keys[0]]; }
            try { var a = ensureAudio(); a.src = url; a.play().catch(function () {}); } catch (e) {}
          } else {
            speakLocal(clean); // сервер не смог — пробуем хороший локальный, если он есть
          }
        };
        x.onerror = function () { speakLocal(clean); };
        x.ontimeout = function () { speakLocal(clean); };
        x.send(JSON.stringify({ action: 'tts', text: clean }));
        return true;
      } catch (e) { return speakLocal(clean); }
    }
    return speakLocal(clean);
  }

  /* =========================================================
     ОНБОРДИНГ
     Показываем один раз: имя компаньона + короткое знакомство.
     ========================================================= */
  var ONBOARD_CSS = '' +
    '#pxax-onboard{position:fixed;inset:0;z-index:1400;display:flex;align-items:center;justify-content:center;padding:18px;' +
    'background:radial-gradient(ellipse 90% 60% at 50% 0%,rgba(120,80,255,.28),transparent 60%),rgba(4,4,12,.92);backdrop-filter:blur(12px)}' +
    '#pxax-onboard[hidden]{display:none}' +
    '.pxax-ob-card{width:min(100%,380px);padding:22px 20px 18px;border:1px solid rgba(155,123,255,.34);border-radius:22px;' +
    'background:linear-gradient(160deg,rgba(27,22,47,.98),rgba(9,12,25,.98));box-shadow:0 24px 80px rgba(0,0,0,.6);text-align:center}' +
    '.pxax-ob-avatar{width:74px;height:74px;border-radius:50%;margin:0 auto 12px;display:block;border:1px solid rgba(155,123,255,.55);box-shadow:0 0 26px rgba(155,123,255,.3)}' +
    '.pxax-ob-card h2{font-size:19px;color:#f2ecff;margin:0 0 8px;font-weight:700}' +
    '.pxax-ob-card p{font-size:12.5px;line-height:1.55;color:#b9b2d4;margin:0 0 14px}' +
    '.pxax-ob-row{display:flex;gap:8px;margin-top:4px}' +
    '#pxax-ob-name{flex:1;min-width:0;padding:12px 13px;border-radius:13px;border:1px solid rgba(155,123,255,.4);background:rgba(12,12,26,.9);' +
    'color:#e9e3ff;font:600 15px system-ui,sans-serif;outline:none;text-align:center}' +
    '#pxax-ob-name:focus{border-color:rgba(155,123,255,.85)}' +
    '.pxax-ob-btn{width:100%;margin-top:10px;padding:14px;border:none;border-radius:14px;font:650 15px system-ui,sans-serif;color:#fff;cursor:pointer;' +
    'background:linear-gradient(135deg,#9b7bff,#6b8cff);box-shadow:0 6px 24px rgba(155,123,255,.28)}' +
    '.pxax-ob-btn:active{transform:scale(.98)}' +
    '.pxax-ob-btn:disabled{opacity:.45}' +
    '.pxax-ob-step[hidden]{display:none}' +
    '.pxax-ob-tips{text-align:left;font-size:12px;line-height:1.6;color:#c3bcdd;margin:0 0 6px;padding-left:2px}' +
    '.pxax-ob-tips b{color:#ffd27a;font-weight:700}';

  function injectCss() {
    if (document.getElementById('pxax-onboard-css')) return;
    var s = document.createElement('style');
    s.id = 'pxax-onboard-css';
    s.textContent = ONBOARD_CSS;
    document.head.appendChild(s);
  }

  function showOnboarding() {
    injectCss();
    var wrap = document.createElement('div');
    wrap.id = 'pxax-onboard';
    var avatar = (app && app.avatar) || './assets/avatar-nova.jpg';
    wrap.innerHTML = '' +
      '<section class="pxax-ob-card" role="dialog" aria-modal="true" aria-labelledby="pxax-ob-title">' +
      '  <img class="pxax-ob-avatar" src="' + avatar + '" alt="">' +
      '  <div class="pxax-ob-step" id="pxax-ob-s1">' +
      '    <h2 id="pxax-ob-title">Привет. Я твой новый компаньон</h2>' +
      '    <p>Я живу в этой комнате по-настоящему: у меня есть настроение, потребности и память. Дай мне имя — и я запомню его навсегда.</p>' +
      '    <div class="pxax-ob-row"><input id="pxax-ob-name" maxlength="24" placeholder="Например, Nova" autocomplete="off"></div>' +
      '    <button class="pxax-ob-btn" id="pxax-ob-next" disabled>Дать имя</button>' +
      '  </div>' +
      '  <div class="pxax-ob-step" id="pxax-ob-s2" hidden>' +
      '    <h2 id="pxax-ob-title2">Знакомимся</h2>' +
      '    <p class="pxax-ob-tips">' +
      '      <b>Ухаживай:</b> голод, жажда и усталость растут в реальном времени — даже когда ты не в приложении.<br>' +
      '      <b>Заглядывай:</b> за хорошее возвращение я награждаю кристаллами ◈.<br>' +
      '      <b>Разговаривай:</b> я помню детали и иногда напишу первой.' +
      '    </p>' +
      '    <button class="pxax-ob-btn" id="pxax-ob-start">Начать жить вместе</button>' +
      '  </div>' +
      '</section>';
    document.body.appendChild(wrap);

    var nameInput = wrap.querySelector('#pxax-ob-name');
    var nextBtn = wrap.querySelector('#pxax-ob-next');
    nameInput.addEventListener('input', function () {
      nextBtn.disabled = !nameInput.value.trim();
    });
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && nameInput.value.trim()) nextBtn.click();
    });

    nextBtn.addEventListener('click', function () {
      var name = nameInput.value.trim().slice(0, 24);
      if (!name) return;
      if (app && app.setCharName) app.setCharName(name);
      wrap.querySelector('#pxax-ob-s1').hidden = true;
      wrap.querySelector('#pxax-ob-s2').hidden = false;
      setTimeout(function () { try { wrap.querySelector('#pxax-ob-start').focus(); } catch (e) {} }, 80);
    });

    wrap.querySelector('#pxax-ob-start').addEventListener('click', function () {
      setKey(KEYS.onboarded, '1');
      wrap.remove();
      if (app && app.onboardingDone) app.onboardingDone();
    });
    setTimeout(function () { try { nameInput.focus(); } catch (e) {} }, 250);
  }

  function shouldOnboard() {
    if (getKey(KEYS.onboarded) === '1') return false;
    var progress = app && app.progress;
    if (progress && progress.named) { setKey(KEYS.onboarded, '1'); return false; }
    if (app && app.historyLength && app.historyLength() > 0) { setKey(KEYS.onboarded, '1'); return false; }
    return true;
  }

  /* =========================================================
     РИТУАЛ ВОЗВРАЩЕНИЯ
     Спрашиваем сервер, что произошло за время отсутствия.
     ========================================================= */
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function returnBonusFor(awayMs) {
    var h = awayMs / 3600000;
    if (h >= 24) return 30;
    if (h >= 12) return 20;
    if (h >= 6) return 12;
    if (h >= 2) return 6;
    return 0;
  }

  function applyServerState(remote) {
    if (!remote || typeof remote !== 'object' || !app || !app.needs) return;
    var n = app.needs;
    if (remote.needs && typeof remote.needs === 'object') {
      var ru = Number(remote.needs.updatedAt);
      if (Number.isFinite(ru) && ru > (Number(n.updatedAt) || 0)) {
        ['hunger', 'thirst', 'fatigue', 'toilet'].forEach(function (k) {
          var v = Number(remote.needs[k]);
          if (Number.isFinite(v)) n[k] = Math.max(0, Math.min(100, v));
        });
        n.updatedAt = ru;
        if (Number.isFinite(Number(remote.needs.sleepUntil))) n.sleepUntil = Number(remote.needs.sleepUntil);
        if (Number.isFinite(Number(remote.needs.toiletUntil))) n.toiletUntil = Number(remote.needs.toiletUntil);
      }
    }
    if (Number.isFinite(Number(remote.credits)) && Number(remote.credits) > (Number(n.credits) || 0)) {
      n.credits = Math.min(1000000, Number(remote.credits));
    }
    if (app.saveNeeds) app.saveNeeds();
    if (app.renderNeeds) app.renderNeeds();
  }

  function showProactive(text) {
    if (!app || !app.addMsg) return;
    state.proactiveShown = true;
    var open = function () {
      if (app.isChatOpen && !app.isChatOpen() && app.openChat) app.openChat();
      app.addMsg('bot', text, true);
    };
    if (app.isChatOpen && app.isChatOpen()) { open(); return; }
    // аккуратный тост-приглашение, чтобы не врываться в комнату
    if (app.toast) app.toast('💜 ' + (app.charName ? app.charName() : 'Nova') + ' написала тебе первой — открой чат', 5200);
    if (app.onProactive) app.onProactive(text);
  }

  function maybeReturnBonus(awayMs) {
    if (state.returnBonusGiven) return;
    state.returnBonusGiven = true;
    if (getKey(KEYS.returnDay) === todayKey()) return;
    var bonus = returnBonusFor(awayMs);
    setKey(KEYS.returnDay, todayKey());
    if (!bonus || !app || !app.needs) return;
    app.needs.credits += bonus;
    if (app.saveNeeds) app.saveNeeds();
    if (app.renderNeeds) app.renderNeeds();
    if (app.addXp) app.addXp(6);
    if (app.haptic) app.haptic('success');
    if (app.toast) app.toast('С возвращением! +' + bonus + ' ◈ 💜', 3600);
    if (app.logDayEvent) app.logDayEvent('return', '+' + bonus + ' ◈ за возвращение');
  }

  function syncLife() {
    if (!app || !window.pxaxApi) return;
    // без подтверждённого Telegram-пользователя сервер ответит 401 — тихо пропускаем
    if (!app.hasTelegram || !app.hasTelegram()) return;
    window.pxaxApi.postJson(app.apiUrl, { action: 'life', ts: Date.now() }, 15000, function (res) {
      if (!res || !res.ok || !res.raw || !res.raw.ok) return;
      var data = res.raw;
      state.awayForMs = Number(data.awayForMs) || 0;
      state.streak = Number(data.streak) || 0;
      applyServerState(data.state);
      maybeReturnBonus(state.awayForMs);
      if (data.proactive && data.proactive.text && !state.proactiveShown) {
        showProactive(String(data.proactive.text));
      }
    });
  }

  function init(opts) {
    app = opts || {};
    injectCss();
    pickLocalVoice();
    refreshVoiceButton();
    if ('speechSynthesis' in window) {
      try {
        speechSynthesis.onvoiceschanged = function () { pickLocalVoice(); refreshVoiceButton(); };
      } catch (e) {}
    }
    // кнопка голоса: перехватываем и учитываем доступность голоса
    var btn = document.getElementById('voice-toggle');
    if (btn) {
      btn.addEventListener('click', function () {
        if (getKey(KEYS.voice) === '0') stopSpeak();
        setTimeout(refreshVoiceButton, 0);
      });
    }
    if (shouldOnboard()) {
      setTimeout(showOnboarding, 600);
    }
    // «что случилось, пока меня не было» + инициатива Nova
    setTimeout(syncLife, 2500);
    // повторяем при возврате во вкладку (не чаще раза в 10 минут)
    var lastLifeAt = Date.now();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLifeAt < 10 * 60000) return;
      lastLifeAt = Date.now();
      syncLife();
    });
  }

  window.pxaxLife = {
    init: init,
    speak: speak,
    stopSpeak: stopSpeak,
    refreshVoiceButton: refreshVoiceButton,
    voiceInfo: function () {
      return {
        enabled: voice.enabled,
        mode: SERVER_TTS ? 'server' : 'local',
        localVoice: voice.localVoice && voice.localVoice.name,
        reason: voice.reason
      };
    },
    state: function () { return state; },
    syncLife: syncLife,
    returnBonusFor: returnBonusFor
  };
})();
