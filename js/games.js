/* =========================================================
   PXAX · Nova — мини-игры на canvas
   1) Neon Reflex — лови сигнал в момент вспышки (реакция)
   2) Data Run — раннер: уворачивайся от файрволов, собирай кристаллы
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- Общий каркас ---------------- */
  function createStage(container) {
    container.textContent = '';
    var canvas = document.createElement('canvas');
    canvas.className = 'mini-game-canvas';
    canvas.width = 340;
    canvas.height = 220;
    container.appendChild(canvas);
    return { canvas: canvas, ctx: canvas.getContext('2d') };
  }

  function neonText(ctx, text, x, y, size, color, glow) {
    ctx.font = '700 ' + size + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = glow || color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* =========================================================
     ИГРА 1: NEON REFLEX (реакция)
     5 раундов. Жди, пока экран вспыхнет цианом → тапай как можно быстрее.
     Ранний тап — раунд провален. Чем быстрее, тем больше ◈.
     ========================================================= */
  function playReflex(container, callbacks) {
    var stage = createStage(container);
    var canvas = stage.canvas, ctx = stage.ctx;
    var W = canvas.width, H = canvas.height;
    var round = 0, totalRounds = 5, score = 0, results = [];
    var state = 'intro'; // intro | wait | go | result | done
    var goAt = 0, waitTimer = null, raf = 0, roundStart = 0;
    var reduced = window.pxaxPerf && window.pxaxPerf.reducedMotion();

    function drawIntro() {
      ctx.fillStyle = '#060714';
      ctx.fillRect(0, 0, W, H);
      neonText(ctx, 'NEON REFLEX', W / 2, H / 2 - 26, 20, '#9b7bff');
      neonText(ctx, 'Тапни, когда экран вспыхнет цианом', W / 2, H / 2 + 4, 11, '#b8b2cf', '#000');
      neonText(ctx, 'Ранний тап — промах. 5 раундов.', W / 2, H / 2 + 24, 10, '#6a6580', '#000');
      neonText(ctx, '· тапни, чтобы начать ·', W / 2, H - 26, 11, '#5ce1e6');
    }

    function drawWait() {
      ctx.fillStyle = '#0a0a1c';
      ctx.fillRect(0, 0, W, H);
      neonText(ctx, 'ЖДИ…', W / 2, H / 2, 22, '#ff748c');
      neonText(ctx, 'раунд ' + round + ' / ' + totalRounds, W / 2, H - 24, 10, '#6a6580', '#000');
    }

    function drawGo() {
      ctx.fillStyle = '#0e2a33';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#5ce1e6';
      ctx.lineWidth = 3;
      ctx.strokeRect(4, 4, W - 8, H - 8);
      neonText(ctx, 'ТАП!', W / 2, H / 2, 34, '#9df2f5');
    }

    function drawResult(ms) {
      ctx.fillStyle = '#060714';
      ctx.fillRect(0, 0, W, H);
      var label = ms === null ? 'ПРОМАХ' : (ms < 220 ? 'ИДЕАЛЬНО!' : ms < 350 ? 'ХОРОШО' : ms < 550 ? 'НОРМ' : 'МЕДЛЕННО');
      var color = ms === null ? '#ff748c' : ms < 350 ? '#7bf0b2' : '#ffd27a';
      neonText(ctx, label, W / 2, H / 2 - 18, 20, color);
      neonText(ctx, ms === null ? 'слишком рано' : ms + ' мс', W / 2, H / 2 + 12, 16, '#e5e0f4');
      neonText(ctx, '· тапни для следующего ·', W / 2, H - 26, 10, '#5ce1e6');
    }

    function drawDone() {
      ctx.fillStyle = '#060714';
      ctx.fillRect(0, 0, W, H);
      var reward = rewardFromResults();
      neonText(ctx, 'СИГНАЛ ОЧИЩЕН', W / 2, H / 2 - 34, 18, '#7bf0b2');
      neonText(ctx, 'лучшая: ' + bestLabel() + ' · точных ' + score + '/' + totalRounds, W / 2, H / 2, 11, '#b8b2cf', '#000');
      neonText(ctx, '+' + reward + ' ◈', W / 2, H / 2 + 30, 22, '#ffd27a');
      neonText(ctx, '· тапни, чтобы закончить ·', W / 2, H - 22, 10, '#5ce1e6');
    }

    function bestLabel() {
      var good = results.filter(function (r) { return r != null; });
      if (!good.length) return '—';
      return Math.min.apply(null, good) + ' мс';
    }

    function rewardFromResults() {
      var sum = 0;
      results.forEach(function (r) {
        if (r == null) return;
        if (r < 220) sum += 4;
        else if (r < 350) sum += 3;
        else if (r < 550) sum += 2;
        else sum += 1;
      });
      return sum;
    }

    function nextRound() {
      if (round >= totalRounds) { state = 'done'; drawDone(); return; }
      state = 'wait';
      drawWait();
      var delay = 900 + Math.random() * 2200;
      waitTimer = setTimeout(function () {
        state = 'go';
        goAt = performance.now();
        drawGo();
      }, reduced ? Math.max(400, delay * 0.5) : delay);
    }

    function onTap() {
      if (state === 'intro') { round = 1; nextRound(); return; }
      if (state === 'wait') {
        clearTimeout(waitTimer);
        results.push(null);
        state = 'result';
        drawResult(null);
        round++;
        return;
      }
      if (state === 'go') {
        var ms = Math.round(performance.now() - goAt);
        results.push(ms);
        if (ms < 550) score++;
        state = 'result';
        drawResult(ms);
        round++;
        return;
      }
      if (state === 'result') { nextRound(); return; }
      if (state === 'done') {
        cleanup();
        callbacks.onFinish({ score: score, total: totalRounds, reward: rewardFromResults() });
      }
    }

    function cleanup() {
      cancelAnimationFrame(raf);
      clearTimeout(waitTimer);
      canvas.removeEventListener('pointerdown', onTap);
    }

    canvas.addEventListener('pointerdown', onTap);
    drawIntro();
    return { stop: cleanup };
  }

  /* =========================================================
     ИГРА 2: DATA RUN (раннер)
     Тап/свайп — прыжок (или вниз — пригнуться). Собирай ◈, уворачивайся от стен.
     25 секунд, скорость растёт. Столкновение — конец.
     ========================================================= */
  function playRunner(container, callbacks) {
    var stage = createStage(container);
    var canvas = stage.canvas, ctx = stage.ctx;
    var W = canvas.width, H = canvas.height;
    var ground = H - 34;
    var player = { x: 56, y: ground, w: 22, h: 26, vy: 0, duck: false, jumps: 0 };
    var obstacles = []; // {x,w,h,top}  top=true → летит сверху (нужно пригнуться)
    var coins = [];
    var speed = 3.2, distance = 0, collected = 0;
    var running = false, over = false, started = false;
    var spawnT = 0, coinT = 0, elapsed = 0, lastTs = 0, raf = 0;
    var DURATION = 25000;
    var reduced = window.pxaxPerf && window.pxaxPerf.reducedMotion();
    if (reduced) speed = 2.6;

    function reset() {
      player.y = ground; player.vy = 0; player.duck = false; player.jumps = 0;
      obstacles = []; coins = [];
      speed = reduced ? 2.6 : 3.2; distance = 0; collected = 0;
      spawnT = 0; coinT = 0; elapsed = 0; over = false;
    }

    function jump() {
      if (player.jumps < 2) {
        player.vy = -7.6;
        player.jumps++;
        player.duck = false;
      }
    }
    function duck(on) {
      if (player.y >= ground) player.duck = !!on;
    }

    function spawn() {
      var top = Math.random() < 0.35;
      if (top) obstacles.push({ x: W + 20, w: 18 + Math.random() * 14, h: 16, top: true, y: ground - 34 });
      else obstacles.push({ x: W + 20, w: 14 + Math.random() * 18, h: 18 + Math.random() * 16, top: false, y: 0 });
    }
    function spawnCoin() {
      coins.push({ x: W + 16, y: ground - 30 - Math.random() * 44, r: 5 });
    }

    function step(dt) {
      var ds = dt / 16.7;
      elapsed += dt;
      speed += 0.0009 * dt * (reduced ? 0.6 : 1);
      distance += speed * ds;

      // физика
      player.vy += 0.5 * ds;
      player.y += player.vy * ds;
      if (player.y >= ground) { player.y = ground; player.vy = 0; player.jumps = 0; }

      // спавн
      spawnT -= dt;
      if (spawnT <= 0) { spawn(); spawnT = 620 + Math.random() * 760 - speed * 40; }
      coinT -= dt;
      if (coinT <= 0) { spawnCoin(); coinT = 380 + Math.random() * 600; }

      // движение
      for (var i = obstacles.length - 1; i >= 0; i--) {
        obstacles[i].x -= speed * ds;
        if (obstacles[i].x < -40) obstacles.splice(i, 1);
      }
      for (var j = coins.length - 1; j >= 0; j--) {
        coins[j].x -= speed * ds;
        if (coins[j].x < -20) coins.splice(j, 1);
      }

      // столкновения
      var ph = player.duck ? player.h * 0.55 : player.h;
      var py = player.duck ? player.y + player.h - ph : player.y;
      for (var k = 0; k < obstacles.length; k++) {
        var o = obstacles[k];
        var oy = o.top ? o.y : ground + player.h - o.h + (player.h - o.h) * 0 + (0); // top: висячие, bottom: на земле
        var box = o.top
          ? { x: o.x, y: o.y, w: o.w, h: o.h }
          : { x: o.x, y: ground + player.h - o.h, w: o.w, h: o.h };
        if (player.x < box.x + box.w && player.x + player.w > box.x &&
            py < box.y + box.h && py + ph > box.y) {
          over = true;
          running = false;
        }
      }
      // монеты
      for (var c = coins.length - 1; c >= 0; c--) {
        var cn = coins[c];
        var cx = cn.x, cy = cn.y;
        if (Math.abs(cx - (player.x + player.w / 2)) < player.w / 2 + cn.r &&
            Math.abs(cy - (py + ph / 2)) < ph / 2 + cn.r) {
          coins.splice(c, 1);
          collected++;
        }
      }

      if (elapsed >= DURATION) { running = false; }
    }

    function draw() {
      // фон
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0b0820');
      g.addColorStop(1, '#140f2c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // город
      ctx.fillStyle = '#1a1440';
      for (var i = 0; i < 6; i++) {
        var bx = ((i * 90 - (distance * 0.3) % 90) + W) % (W + 90) - 45;
        ctx.fillRect(bx, ground - 60 - (i % 3) * 16, 34, 60 + (i % 3) * 16);
      }
      // земля
      ctx.fillStyle = '#0a0716';
      ctx.fillRect(0, ground + player.h, W, H - ground - player.h);
      ctx.strokeStyle = '#5ce1e6';
      ctx.globalAlpha = .55;
      ctx.beginPath();
      ctx.moveTo(0, ground + player.h + 0.5);
      ctx.lineTo(W, ground + player.h + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // монеты
      coins.forEach(function (c) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd27a';
        ctx.shadowColor = '#ffd27a';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // препятствия
      obstacles.forEach(function (o) {
        var y = o.top ? o.y : ground + player.h - o.h;
        ctx.fillStyle = o.top ? '#ff748c' : '#9b7bff';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.fillRect(o.x, y, o.w, o.h);
        ctx.shadowBlur = 0;
      });

      // игрок (Nova — неоновый силуэт)
      var ph = player.duck ? player.h * 0.55 : player.h;
      var py = player.duck ? player.y + player.h - ph : player.y;
      ctx.fillStyle = '#7bf0b2';
      ctx.shadowColor = '#7bf0b2';
      ctx.shadowBlur = 12;
      roundRect(ctx, player.x, py, player.w, ph, 6);
      ctx.fill();
      ctx.shadowBlur = 0;

      // HUD
      neonText(ctx, '◈ ' + collected, 34, 18, 13, '#ffd27a');
      neonText(ctx, Math.max(0, (DURATION - elapsed) / 1000).toFixed(0) + 'с', W - 30, 18, 12, '#b8b2cf', '#000');

      if (!started) {
        neonText(ctx, 'DATA RUN', W / 2, H / 2 - 30, 20, '#5ce1e6');
        neonText(ctx, 'тап — прыжок (двойной тоже), удерживай — пригнуться', W / 2, H / 2 + 0, 10, '#b8b2cf', '#000');
        neonText(ctx, 'собирай ◈, уворачивайся от стен. 25 секунд.', W / 2, H / 2 + 18, 10, '#6a6580', '#000');
        neonText(ctx, '· тапни, чтобы стартовать ·', W / 2, H - 24, 11, '#7bf0b2');
      }
      if (over) {
        neonText(ctx, 'СБОЙ СИГНАЛА', W / 2, H / 2 - 20, 18, '#ff748c');
        neonText(ctx, '◈ ' + collected + ' · ' + (distance / 10 | 0) + ' м', W / 2, H / 2 + 8, 13, '#e5e0f4');
        neonText(ctx, '· тапни — результат ·', W / 2, H - 24, 10, '#5ce1e6');
      }
      if (!over && !running && started) {
        neonText(ctx, 'ФИНИШ!', W / 2, H / 2 - 20, 20, '#7bf0b2');
        neonText(ctx, '◈ ' + collected + ' · ' + (distance / 10 | 0) + ' м', W / 2, H / 2 + 10, 13, '#e5e0f4');
        neonText(ctx, '· тапни — результат ·', W / 2, H - 24, 10, '#5ce1e6');
      }
    }

    function loop(ts) {
      if (!lastTs) lastTs = ts;
      var dt = Math.min(50, ts - lastTs);
      lastTs = ts;
      if (running) step(dt);
      draw();
      if (!(window.pxaxPerf && window.pxaxPerf.isHidden())) {
        raf = requestAnimationFrame(loop);
      } else {
        raf = requestAnimationFrame(loop); // продолжаем цикл, но step не идёт, т.к. running зависит от видимости? нет — просто рисуем реже
      }
    }

    function reward() {
      // ◈ за монеты + бонус за дистанцию
      var r = collected + Math.floor(distance / 220);
      return Math.min(30, r);
    }

    function onDown(e) {
      e.preventDefault();
      if (!started) { started = true; running = true; reset(); return; }
      if (over || (!running && started)) {
        // результат
        cleanup();
        callbacks.onFinish({ score: collected, total: 1, reward: reward(), distance: distance | 0 });
        return;
      }
      jump();
    }
    function onUp() { duck(false); }
    function onKey(e) {
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); onDown(e); }
      if (e.code === 'ArrowDown') duck(true);
    }

    function cleanup() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    }

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    raf = requestAnimationFrame(loop);
    return { stop: cleanup };
  }

  window.pxaxGames = {
    reflex: playReflex,
    runner: playRunner
  };
})();
