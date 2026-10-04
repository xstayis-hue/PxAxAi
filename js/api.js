/* =========================================================
   PXAX · Nova — сетевой слой: JSON + SSE + отмена
   ========================================================= */
(function () {
  'use strict';

  function now() { return Date.now(); }

  function xhrJson(url, body, ms, cb) {
    var x = new XMLHttpRequest();
    var done = false;
    var t = setTimeout(function () {
      if (done) return;
      done = true;
      try { x.abort(); } catch (e) {}
      cb({ ok: false, error: 'timeout', text: 'Таймаут ' + Math.round(ms / 1000) + 'с — сервер не ответил.' });
    }, ms);
    x.open('POST', url, true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = ms;
    x.onload = function () {
      if (done) return;
      done = true;
      clearTimeout(t);
      var text = x.responseText || '';
      var data = null;
      try { data = JSON.parse(text); } catch (e) {}
      if (x.status >= 200 && x.status < 300 && data && data.reply) {
        cb({ ok: true, text: String(data.reply), model: data.model || '', raw: data });
      } else {
        cb({
          ok: false,
          error: 'http',
          status: x.status,
          text: (data && data.reply) ? String(data.reply) : ('HTTP ' + x.status)
        });
      }
    };
    x.onerror = function () {
      if (done) return;
      done = true;
      clearTimeout(t);
      cb({ ok: false, error: 'network', text: 'Нет связи с сервером.' });
    };
    try { x.send(JSON.stringify(body)); }
    catch (e) {
      if (!done) { done = true; clearTimeout(t); cb({ ok: false, error: 'send', text: 'send: ' + e.message }); }
    }
  }

  /* SSE через fetch + ReadableStream. Колбэки:
     onToken(text) — кусочки ответа
     onDone(fullText, meta)
     onError(message) — транспортная/серверная ошибка, можно фолбечить на JSON
     opts.headers — дополнительные заголовки (например, X-Telegram-Init-Data)
  */
  function streamSSE(url, body, handlers, opts) {
    opts = opts || {};
    var controller = new AbortController();
    var finished = false;
    var acc = '';
    var started = now();

    function finish(kind, payload) {
      if (finished) return;
      finished = true;
      try { controller.abort(); } catch (e) {}
      if (kind === 'done' && handlers.onDone) handlers.onDone(acc, payload || {});
      if (kind === 'error' && handlers.onError) handlers.onError(payload || 'stream error');
    }

    var headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
    if (opts.headers) {
      for (var k in opts.headers) {
        if (Object.prototype.hasOwnProperty.call(opts.headers, k)) headers[k] = opts.headers[k];
      }
    }

    fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: controller.signal
    }).then(function (res) {
      var contentType = (res.headers.get('content-type') || '');
      if (!res.ok || !res.body || contentType.indexOf('text/event-stream') === -1) {
        // сервер не умеет SSE — откатываемся на JSON
        finish('error', 'not-sse:' + res.status + ':' + contentType);
        return;
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buf = '';

      function pump() {
        reader.read().then(function (chunk) {
          if (chunk.done) {
            finish('done');
            return;
          }
          buf += decoder.decode(chunk.value, { stream: true });
          var parts = buf.split('\n\n');
          buf = parts.pop() || '';
          parts.forEach(function (block) {
            var lines = block.split('\n');
            var evt = 'message';
            var dataLines = [];
            lines.forEach(function (line) {
              if (line.indexOf('event:') === 0) evt = line.slice(6).trim();
              else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
            });
            var data = dataLines.join('\n');
            if (!data) return;
            if (evt === 'done') {
              var meta = {};
              try { meta = JSON.parse(data); } catch (e) {}
              finish('done', meta);
              return;
            }
            if (evt === 'error') {
              finish('error', data);
              return;
            }
            // обычный токен
            var token = data;
            try {
              var parsed = JSON.parse(data);
              token = (parsed && (parsed.response || parsed.text || parsed.token)) || token;
            } catch (e) {}
            acc += token;
            if (handlers.onToken) handlers.onToken(token, acc);
          });
          pump();
        }).catch(function (err) {
          if (finished) return;
          finish('error', (err && err.message) || 'stream read error');
        });
      }
      pump();
    }).catch(function (err) {
      if (finished) return;
      if (err && err.name === 'AbortError') return;
      finish('error', (err && err.message) || 'fetch error');
    });

    return {
      abort: function () {
        if (finished) return;
        finished = true;
        try { controller.abort(); } catch (e) {}
        if (handlers.onAbort) handlers.onAbort(acc, { elapsed: now() - started });
      }
    };
  }

  window.pxaxApi = {
    postJson: xhrJson,
    postStream: streamSSE,
    supportsStream: (typeof fetch === 'function') && (typeof ReadableStream !== 'undefined')
  };
})();
