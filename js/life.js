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
     ГОЛОС — ВЫКЛЮЧЕН
     Озвучка и распознавание речи убраны из приложения целиком: браузер
     спрашивает доступ к микрофону у ДОМЕНА (xstayis-hue.github.io), и в этом
     диалоге светится github-аккаунт. Пока приложение живёт на github.io,
     остаются только текст и изображения. Серверные эндпоинты TTS/STT не
     вызываются вообще.
     ========================================================= */
  function refreshVoiceButton() { /* переключателя голоса больше нет */ }

  function stopSpeak() { /* нечего останавливать: озвучка выключена */ }

  function speakLocal(text) { return false; }

  function speak(text) { return false; }

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
    // намеренно НЕ трогаем speechSynthesis и не ищем кнопку голоса: озвучка выключена
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
    // speak/stopSpeak/refreshVoiceButton остаются только как заглушки: вызовы из UI убраны,
    // но старые ссылки в кэшированном index.html не должны падать
    speak: speak,
    stopSpeak: stopSpeak,
    refreshVoiceButton: refreshVoiceButton,
    voiceInfo: function () { return { enabled: false, mode: 'off', localVoice: null, reason: 'disabled' }; },
    state: function () { return state; },
    syncLife: syncLife,
    returnBonusFor: returnBonusFor
  };
})();
