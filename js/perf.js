/* =========================================================
   PXAX · Nova — производительность: пауза фоновых анимаций,
   reduced-motion, экономия батареи
   ========================================================= */
(function () {
  'use strict';

  var reduced = false;
  try {
    reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}

  var hidden = document.hidden;
  document.addEventListener('visibilitychange', function () {
    hidden = document.hidden;
  });

  window.pxaxPerf = {
    reducedMotion: function () { return reduced; },
    isHidden: function () { return hidden; },
    // декоративные циклы должны вызывать это каждый кадр; true = продолжаем
    shouldAnimate: function () { return !hidden && !reduced; }
  };

  if (reduced) {
    try { document.body.classList.add('reduced-motion'); } catch (e) {}
  }
})();
