/* =========================================================
   PXAX · Nova — команды на естественном языке → действия в 3D
   ========================================================= */
(function () {
  'use strict';

  var ACTIONS = {
    sleep: {
      patterns: [
        /(л(е|ё)г|ложись|ляг|поспи|спать|усни|отдохни|отдыхай|кровать|вздремни)/i,
        /(go to sleep|sleep|take a nap|lie down|rest)/i
      ],
      roomAction: 'bed', // в комнате bed = лечь отдохнуть; тамагочи-сон запускает сам needs-цикл
      needsCheck: null
    },
    desk: {
      patterns: [
        /(ноут|комп|рабоч(ий|ее)\s*мест|поработай|за\s*работу|сядь\s*за|ноутбук|код(и|ить)|печатай)/i,
        /(laptop|desk|work|type|code)/i
      ],
      roomAction: 'desk',
      needsCheck: null
    },
    door: {
      patterns: [
        /(выйти|выйди|дверь|двери|погулять|улиц|прогулк|уйди)/i,
        /(door|go out|leave|walk)/i
      ],
      roomAction: 'door',
      needsCheck: null
    },
    toilet: {
      patterns: [
        /(туалет|нужде|уборн|ванн|wc|toilet|bathroom)/i
      ],
      roomAction: 'toilet',
      needsCheck: 'toilet'
    },
    eat: {
      patterns: [
        /(поесть|покорми|голодн|еда|еды|закажи|поешь|покушать)/i,
        /(food|eat|hungry|feed)/i
      ],
      roomAction: null, // открываем модал ухода
      openCare: true,
      needsCheck: 'hunger'
    },
    drink: {
      patterns: [
        /(попить|пить|воды|жажд|напиток|бабл|чай)/i,
        /(drink|thirst|water|tea)/i
      ],
      roomAction: null,
      openCare: true,
      needsCheck: 'thirst'
    },
    status: {
      patterns: [
        /(чем занята|что делаешь|что ты делаешь|где ты|что сейчас|статус|как дела|как ты|как себя чувствуешь|самочувствие)/i,
        /(what are you doing|how are you|status|what.?s up)/i
      ],
      roomAction: null,
      isStatus: true
    },
    wake: {
      patterns: [
        /(проснись|просыпайся|вставай|wake up|разбуди)/i
      ],
      roomAction: null,
      isWake: true
    }
  };

  function match(text) {
    if (!text) return null;
    var t = String(text).trim();
    if (!t) return null;
    for (var key in ACTIONS) {
      if (!Object.prototype.hasOwnProperty.call(ACTIONS, key)) continue;
      var def = ACTIONS[key];
      for (var i = 0; i < def.patterns.length; i++) {
        if (def.patterns[i].test(t)) return { action: key, def: def };
      }
    }
    return null;
  }

  window.pxaxAgentActions = {
    match: match,
    list: Object.keys(ACTIONS)
  };
})();
