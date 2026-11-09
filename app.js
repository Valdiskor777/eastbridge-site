/**
 * app.js — язык и поведение бланков. ES5, без зависимостей.
 *
 * Язык: ?lang=zh|ru → localStorage → 中文. Китайская версия уже вписана в index.html
 * (scripts/prerender.js), поэтому первый кадр не пустой; applyLang подставляет словарь
 * в [data-i18n], [data-i18n-attr], [data-config] и обновляет document.title.
 *
 * initDeferredGroups — группы картинок, файлы которых кладёт собственник (.proof-shots,
 * [data-real-group]): группа скрыта в разметке и раскрывается, как только загрузилась
 * хотя бы одна фигура; фигуры без файла уходят из контейнера, опоздавшие возвращаются на
 * своё место. Фигура с подписью-заглушкой «[…]» не показывается (портрет без имени).
 * initContactLinks — href приглашения WeChat (и tel:/mailto:, если появятся) из config.
 * initCopy — копирование с запасным путём execCommand для file://.
 * initAnchorSpy — подсветка раздела в шапке. initStickyCta — липкий призыв на телефоне.
 * initPrint — перед печатью раскрывает вопросы (закрытый details на лист не попадает).
 * initSlip — ответный бланк: отметки формата на спецификации и поля бланка собираются
 * в сообщение для WeChat; выбор хранится в localStorage.
 * initReveal — ставит .will-in элементам ниже экрана и меняет его на .is-in при появлении
 * (оттиски, печать отчёта, выезд листа). Элементы, видимые при загрузке, не трогаются.
 * initProgress — полоса листов в шапке, отметки пройденных разделов, линия маршрута.
 * switchLang — смена языка переворотом бланка (View Transitions), положение чтения сохраняется.
 */
(function () {
  'use strict';

  var CONTENT = window.CONTENT;
  if (!CONTENT || !CONTENT.config || !CONTENT.zh || !CONTENT.ru) return;

  var config = CONTENT.config;
  var STORAGE_KEY = 'eb-lang';
  var SLIP_KEY = 'eb-slip';
  var current = 'zh';
  var langEpoch = 0; // растёт при каждой смене языка: отложенные правки текста сверяются с ним
  var MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: no-preference)').matches);

  function isLang(v) { return v === 'zh' || v === 'ru'; }

  function detectLang() {
    var fromQuery = null;
    try { fromQuery = new URLSearchParams(window.location.search).get('lang'); } catch (e) {}
    if (isLang(fromQuery)) return fromQuery;
    var stored = null;
    try { stored = window.localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (isLang(stored)) return stored;
    return 'zh';
  }

  function applyLang(lang) {
    var dict = CONTENT[lang];
    var root = document.documentElement;
    root.setAttribute('data-lang', lang);
    root.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'ru');

    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      if (typeof dict[key] === 'string') nodes[i].textContent = dict[key];
    }

    var attrNodes = document.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < attrNodes.length; j++) {
      var pairs = attrNodes[j].getAttribute('data-i18n-attr').split(',');
      for (var p = 0; p < pairs.length; p++) {
        var parts = pairs[p].split(':');
        if (parts.length === 2 && typeof dict[parts[1].trim()] === 'string') {
          attrNodes[j].setAttribute(parts[0].trim(), dict[parts[1].trim()]);
        }
      }
    }

    var cfgNodes = document.querySelectorAll('[data-config]');
    for (var c = 0; c < cfgNodes.length; c++) {
      var ck = cfgNodes[c].getAttribute('data-config');
      if (typeof config[ck] === 'string') cfgNodes[c].textContent = config[ck];
    }

    document.title = dict['meta.title'] + ' — ' + config.brandFull;
    try { window.localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    current = lang;
    langEpoch++;
    hidePlaceholders();
    syncDeferredGroups(); // подписи-заглушки пересчитаны — состав групп обязан за ними успевать
    renderSlip();         // подпись отметки и текст сообщения зависят от языка
  }

  /* ---------- Плейсхолдеры собственника: [data-ph] ----------
   * Элемент получает hidden, если его текст содержит заглушку вида «[…]». */
  var PLACEHOLDER = /\[[^\[\]]+\]/;
  function hidePlaceholders() {
    var nodes = document.querySelectorAll('[data-ph]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].hidden = PLACEHOLDER.test((nodes[i].textContent || '').trim());
    }
  }

  /* ---------- Отложенные группы изображений ----------
   * Раскрываемся по первой загруженной фигуре, а не по всем: GitHub Pages из Китая отдаёт
   * файлы неравномерно, и главное доказательство не должно ждать самый медленный кадр.
   * Дедлайн нужен только чтобы убрать из DOM фигуры, файл которых так и не пришёл. */
  var DEFERRED_SETTLE_MS = 12000;
  var syncs = [];

  function setupDeferredGroup(box) {
    var figures = box.querySelectorAll('figure.shot, figure.real');
    if (!figures.length) return;
    var container = figures[0].parentNode;
    var stagedSlot = box.getAttribute('data-real-group');
    var staged = stagedSlot ? document.querySelector('figure.photo[data-slot="' + stagedSlot + '"]') : null;
    var order = [];
    var loaded = [];
    var failed = [];

    function place(fig) {
      var next = null;
      for (var i = order.indexOf(fig) + 1; i < order.length; i++) {
        if (order[i].parentNode === container) { next = order[i]; break; }
      }
      container.insertBefore(fig, next);
    }

    // Подпись-заглушка: фигуру гасим hidden, но из документа не выносим — иначе applyLang
    // перестал бы обновлять её текст и решение стало бы необратимым при смене языка.
    function captionPending(fig) {
      var ph = fig.querySelector('[data-ph]');
      return !!ph && ph.hidden;
    }

    function sync() {
      var alive = 0;
      for (var i = 0; i < order.length; i++) {
        var fig = order[i];
        var inDom = fig.parentNode === container;
        if (failed.indexOf(fig) !== -1) { if (inDom) container.removeChild(fig); continue; }
        if (loaded.indexOf(fig) === -1) { fig.hidden = true; continue; } // ещё грузится
        if (!inDom) place(fig);
        fig.hidden = captionPending(fig);
        if (!fig.hidden) alive++;
      }
      box.hidden = alive === 0;
      if (staged) staged.hidden = alive > 0;
    }
    syncs.push(sync);

    function watch(fig) {
      var img = fig.querySelector('img');
      function ok() {
        var f = failed.indexOf(fig);
        if (f !== -1) failed.splice(f, 1);
        if (loaded.indexOf(fig) === -1) loaded.push(fig);
        sync();
      }
      function fail() { if (failed.indexOf(fig) === -1) failed.push(fig); sync(); }
      if (!img) { fail(); return; }
      if (img.complete) { if (img.naturalWidth > 0) ok(); else fail(); return; }
      img.addEventListener('load', ok);
      img.addEventListener('error', fail);
    }

    for (var i = 0; i < figures.length; i++) { order.push(figures[i]); figures[i].hidden = true; }
    for (var j = 0; j < order.length; j++) watch(order[j]);
    setTimeout(function () {
      for (var k = 0; k < order.length; k++) {
        if (loaded.indexOf(order[k]) === -1 && failed.indexOf(order[k]) === -1) failed.push(order[k]);
      }
      sync();
    }, DEFERRED_SETTLE_MS);
  }

  function initDeferredGroups() {
    var boxes = document.querySelectorAll('.proof-shots, [data-real-group]');
    for (var i = 0; i < boxes.length; i++) setupDeferredGroup(boxes[i]);
  }

  function syncDeferredGroups() {
    for (var i = 0; i < syncs.length; i++) syncs[i]();
  }

  /* ---------- Ссылки контактов: [data-contact-link] ---------- */
  function telHref(value) {
    var s = String(value).replace(/[^\d+]/g, '');
    var digits = s.replace(/\D/g, '');
    if (digits.length < 7) return '';
    return 'tel:' + (s.charAt(0) === '+' ? '+' : '') + digits;
  }

  function mailHref(value) {
    var v = String(value).trim();
    return /^[^\s@\[\]]+@[^\s@\[\]]+\.[^\s@\[\]]{2,}$/.test(v) ? 'mailto:' + v : '';
  }

  function inviteHref(value) {
    var v = String(value).trim();
    return /^https:\/\/[^\s\[\]]+$/.test(v) ? v : '';
  }

  function initContactLinks() {
    var nodes = document.querySelectorAll('[data-contact-link]');
    for (var i = 0; i < nodes.length; i++) {
      var kind = nodes[i].getAttribute('data-contact-link');
      var href = kind === 'tel' ? telHref(config.phone || '')
        : kind === 'mailto' ? mailHref(config.email || '')
        : inviteHref(config.wechat || '');
      if (href) nodes[i].setAttribute('href', href);
      else nodes[i].removeAttribute('href');
    }
  }

  /* ---------- Копирование: [data-copy] ----------
   * Сначала navigator.clipboard, затем execCommand (на file:// — первым, в синхронном такте
   * клика). Не вышло — значение выделяется для ручного копирования. */
  var COPY_REVERT_MS = 2000;

  function phrase(key, fallback) {
    var dict = CONTENT[current] || {};
    return typeof dict[key] === 'string' && dict[key] ? dict[key] : fallback;
  }

  function execCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function selectNode(el) {
    try {
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  }

  function bindCopy(btn) {
    var source = document.getElementById(btn.getAttribute('data-copy'));
    var label = btn.querySelector('[data-copy-label]');
    if (!source || !label) return;
    var idle = (label.textContent || '').trim() || 'Copy';
    var idleKey = label.getAttribute('data-i18n') || 'contacts.copy';
    var timer = null;

    function say(key, fallback, stamped) {
      label.textContent = phrase(key, fallback);
      btn.classList.toggle('is-copied', !!stamped);
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        btn.classList.remove('is-copied');
        label.textContent = phrase(idleKey, idle);
      }, COPY_REVERT_MS);
    }
    function done() {
      say('contacts.copied', idle, true);
      if (btn.hasAttribute('data-slip-copy')) nudgeWechat();
    }
    function manual() { selectNode(source); say('contacts.copyFail', idle, false); }
    function tryClipboard(text, onFail) {
      var task = null;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) task = navigator.clipboard.writeText(text);
      } catch (e) { task = null; }
      if (task && task.then) task.then(done, onFail);
      else onFail();
    }

    btn.addEventListener('click', function () {
      var text = (source.textContent || '').trim();
      if (!text) return;
      if (window.location.protocol === 'file:') {
        if (execCopy(text)) { done(); return; }
        tryClipboard(text, manual);
        return;
      }
      tryClipboard(text, function () { if (execCopy(text)) done(); else manual(); });
    });
  }

  function initCopy() {
    var btns = document.querySelectorAll('[data-copy]');
    for (var i = 0; i < btns.length; i++) bindCopy(btns[i]);
  }

  /* ---------- Подсветка раздела в шапке ---------- */
  function initAnchorSpy() {
    var links = document.querySelectorAll('.folder__nav a');
    if (!links.length || !('IntersectionObserver' in window)) return;
    var pairs = [];
    for (var i = 0; i < links.length; i++) {
      var section = document.getElementById((links[i].getAttribute('href') || '').slice(1));
      if (section) pairs.push({ link: links[i], section: section, visible: false });
    }
    var io = new IntersectionObserver(function (entries) {
      for (var e = 0; e < entries.length; e++) {
        for (var p = 0; p < pairs.length; p++) {
          if (pairs[p].section === entries[e].target) pairs[p].visible = entries[e].isIntersecting;
        }
      }
      var active = null;
      for (var a = 0; a < pairs.length; a++) { if (pairs[a].visible) { active = pairs[a]; break; } }
      if (!active) return;
      for (var b = 0; b < pairs.length; b++) {
        if (pairs[b] === active) pairs[b].link.setAttribute('aria-current', 'true');
        else pairs[b].link.removeAttribute('aria-current');
      }
    }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });
    for (var k = 0; k < pairs.length; k++) io.observe(pairs[k].section);
  }

  /* ---------- Липкий призыв: [data-sticky-cta] ----------
   * Показ решает CSS (только узкий экран), здесь — «когда»: не нужен, пока видны первый
   * экран (там штамп) или ответный бланк (цель уже на экране, кнопка закрыла бы QR). */
  function initStickyCta() {
    var cta = document.querySelector('[data-sticky-cta]');
    var hero = document.getElementById('hero');
    var contacts = document.getElementById('contacts');
    if (!cta || !hero || !contacts || !('IntersectionObserver' in window)) return;
    var seen = { hero: true, contacts: false };
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) seen[entries[i].target.id] = entries[i].isIntersecting;
      cta.classList.toggle('is-hidden', seen.hero || seen.contacts);
    }, { threshold: 0 });
    cta.classList.add('is-hidden');
    io.observe(hero);
    io.observe(contacts);
  }

  /* ---------- Ответный бланк: [data-slip], [data-pick] ----------
   * Состояние одно: поля, отмеченные форматы и способ встречи. Кнопка «в ответный бланк»
   * на спецификации и галочка в бланке — два входа в одно и то же значение. */
  var slip = { company: '', cat: '', formats: {}, meet: {} };
  var FORMATS = ['1', '2', '3', '4'];
  var MEETS = ['expo', 'video'];

  function loadSlip() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(SLIP_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return;
      if (typeof raw.company === 'string') slip.company = raw.company.slice(0, 80);
      if (typeof raw.cat === 'string') slip.cat = raw.cat.slice(0, 80);
      for (var i = 0; i < FORMATS.length; i++) slip.formats[FORMATS[i]] = !!(raw.formats && raw.formats[FORMATS[i]]);
      for (var j = 0; j < MEETS.length; j++) slip.meet[MEETS[j]] = !!(raw.meet && raw.meet[MEETS[j]]);
    } catch (e) {}
  }

  function saveSlip() {
    try { window.localStorage.setItem(SLIP_KEY, JSON.stringify(slip)); } catch (e) {}
  }

  function slipLine(key, value) {
    return value ? phrase(key, '{v}').replace('{v}', value) : '';
  }

  function slipMessage() {
    var sep = phrase('slip.sep', ', ');
    var formats = [];
    for (var i = 0; i < FORMATS.length; i++) {
      if (slip.formats[FORMATS[i]]) formats.push(phrase('fmt.f' + FORMATS[i] + 'n', ''));
    }
    var meets = [];
    if (slip.meet.expo) meets.push(phrase('slip.meetExpo', ''));
    if (slip.meet.video) meets.push(phrase('slip.meetVideo', ''));
    var lines = [
      phrase('slip.mHello', ''),
      slipLine('slip.mCompany', slip.company.replace(/\s+/g, ' ').trim()),
      slipLine('slip.mCat', slip.cat.replace(/\s+/g, ' ').trim()),
      slipLine('slip.mFormats', formats.join(sep)),
      slipLine('slip.mMeet', meets.join(sep))
    ];
    var out = [];
    for (var k = 0; k < lines.length; k++) { if (lines[k]) out.push(lines[k]); }
    return out.join('\n');
  }

  function renderSlip() {
    var box = document.querySelector('[data-slip]');
    if (!box) return;
    var fields = box.querySelectorAll('[data-slip-field]');
    for (var i = 0; i < fields.length; i++) {
      var name = fields[i].getAttribute('data-slip-field');
      if (fields[i].value !== slip[name]) fields[i].value = slip[name];
    }
    var checks = box.querySelectorAll('[data-slip-format]');
    for (var c = 0; c < checks.length; c++) checks[c].checked = !!slip.formats[checks[c].getAttribute('data-slip-format')];
    var meets = box.querySelectorAll('[data-slip-meet]');
    for (var m = 0; m < meets.length; m++) meets[m].checked = !!slip.meet[meets[m].getAttribute('data-slip-meet')];
    var picks = document.querySelectorAll('[data-pick]');
    for (var p = 0; p < picks.length; p++) {
      var on = !!slip.formats[picks[p].getAttribute('data-pick')];
      picks[p].setAttribute('aria-pressed', on ? 'true' : 'false');
      var label = picks[p].querySelector('.pick__label');
      if (label) label.textContent = phrase(on ? 'fmt.picked' : 'fmt.pick', label.textContent);
      var card = picks[p].closest ? picks[p].closest('.fmt') : null;
      if (card) card.classList.toggle('is-picked', on);
    }
    var text = document.getElementById('slip-text');
    if (text) text.textContent = slipMessage();
  }

  function nudgeWechat() {
    var stamp = document.querySelector('[data-wechat-stamp]');
    if (!stamp) return;
    stamp.classList.remove('is-next');
    void stamp.offsetWidth; // перезапуск анимации при повторном копировании
    stamp.classList.add('is-next');
  }

  function initSlip() {
    var box = document.querySelector('[data-slip]');
    if (!box) return;
    loadSlip();
    var gated = document.querySelectorAll('[data-needs-js]');
    for (var g = 0; g < gated.length; g++) gated[g].hidden = false;

    function changed() { saveSlip(); renderSlip(); }
    box.addEventListener('input', function (e) {
      var name = e.target.getAttribute && e.target.getAttribute('data-slip-field');
      if (!name) return;
      slip[name] = e.target.value;
      saveSlip();
      var text = document.getElementById('slip-text');
      if (text) text.textContent = slipMessage(); // без renderSlip: курсор в поле не должен прыгать
    });
    box.addEventListener('change', function (e) {
      var t = e.target;
      if (!t.getAttribute) return;
      var f = t.getAttribute('data-slip-format');
      var m = t.getAttribute('data-slip-meet');
      if (f) { slip.formats[f] = t.checked; changed(); }
      else if (m) { slip.meet[m] = t.checked; changed(); }
    });
    var picks = document.querySelectorAll('[data-pick]');
    function bindPick(btn) {
      btn.addEventListener('click', function () {
        var f = btn.getAttribute('data-pick');
        slip.formats[f] = !slip.formats[f];
        changed();
      });
    }
    for (var i = 0; i < picks.length; i++) bindPick(picks[i]);
    renderSlip();
  }

  /* ---------- Появление: .will-in → .is-in ----------
   * Исходное состояние получают только элементы ниже экрана на момент запуска: то, что
   * посетитель уже видит, не исчезает и не «доигрывает». Скрытые группы (ждут файл) считаются
   * невидимыми и играют, когда раскроются. Без IntersectionObserver ничего не прячем. */
  var REVEAL = '.seen, .shot, .fmt--flagship, .step, .checklist, .report__grid, .real--lead, .timeline li, main > .sheet:not(#hero)';

  function rollDay(cell, from, epoch) {
    var template = cell.textContent || '';
    var match = /\d+/.exec(template);
    if (!match) return;
    var to = parseInt(match[0], 10);
    var steps = 14;
    var i = 0;
    function tick() {
      if (epoch !== langEpoch) return; // язык сменили — текст уже новый, не затираем
      i++;
      var value = i >= steps ? to : Math.round(from + (to - from) * (i / steps));
      cell.textContent = template.replace(/\d+/, String(value));
      if (i < steps) setTimeout(tick, 40);
    }
    cell.textContent = template.replace(/\d+/, String(from));
    setTimeout(tick, 40);
  }

  function initReveal() {
    if (!MOTION || !('IntersectionObserver' in window)) return;
    var nodes = document.querySelectorAll(REVEAL);
    var days = document.querySelectorAll('.timeline li');
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var io = new IntersectionObserver(function (entries) {
      for (var e = 0; e < entries.length; e++) {
        if (!entries[e].isIntersecting) continue;
        var el = entries[e].target;
        io.unobserve(el);
        el.classList.remove('will-in');
        el.classList.add('is-in');
        // Нумератор графика: день «докручивается» от предыдущей вехи
        var first = el.firstElementChild;
        var cell = first && first.classList.contains('timeline__day') ? first : null;
        if (cell) {
          var index = Array.prototype.indexOf.call(days, el);
          var prev = index > 0 ? parseInt((/\d+/.exec(days[index - 1].querySelector('.timeline__day').textContent || '') || ['0'])[0], 10) : 0;
          rollDay(cell, prev, langEpoch);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    for (var i = 0; i < nodes.length; i++) {
      var rect = nodes[i].getBoundingClientRect();
      var hiddenNow = rect.width === 0 && rect.height === 0;
      if (!hiddenNow && rect.top < vh * 0.92) continue; // уже на экране или выше — оставляем как есть
      nodes[i].classList.add('will-in');
      io.observe(nodes[i]);
    }
  }

  /* ---------- Ход по комплекту: полоса листов, пройденные разделы, линия маршрута ---------- */
  function initProgress() {
    var sheets = document.querySelectorAll('main > .sheet');
    var bar = document.querySelector('.folder__sheets');
    var links = document.querySelectorAll('.folder__nav a');
    var steps = document.querySelector('.steps');
    var stepItems = steps ? steps.querySelectorAll('.step') : [];
    if (!sheets.length) return;
    var segs = [];
    if (bar) {
      for (var i = 0; i < sheets.length; i++) { segs.push(document.createElement('i')); bar.appendChild(segs[i]); }
    }
    var linkIndex = [];
    for (var l = 0; l < links.length; l++) {
      var target = document.getElementById((links[l].getAttribute('href') || '').slice(1));
      linkIndex.push(target ? Array.prototype.indexOf.call(sheets, target) : -1);
    }
    var shown = -1;
    var queued = false;

    function update() {
      queued = false;
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var now = 0;
      for (var i = 0; i < sheets.length; i++) {
        if (sheets[i].getBoundingClientRect().top <= vh * 0.5) now = i;
      }
      if (now !== shown) {
        shown = now;
        for (var s = 0; s < segs.length; s++) segs[s].className = s < now ? 'is-done' : s === now ? 'is-now' : '';
        for (var k = 0; k < links.length; k++) links[k].classList.toggle('is-passed', linkIndex[k] !== -1 && linkIndex[k] < now);
      }
      if (steps) {
        var rect = steps.getBoundingClientRect();
        if (rect.bottom > -200 && rect.top < vh + 200) {
          var mark = vh * 0.62;
          var p = rect.height > 0 ? (mark - rect.top) / rect.height : 0;
          p = p < 0 ? 0 : p > 1 ? 1 : p;
          steps.style.setProperty('--route', p.toFixed(3));
          for (var n = 0; n < stepItems.length; n++) {
            var r = stepItems[n].getBoundingClientRect();
            stepItems[n].classList.toggle('is-passed', r.top + r.height / 2 <= mark);
          }
        }
      }
    }
    function onScroll() {
      if (queued) return;
      queued = true;
      if (window.requestAnimationFrame) window.requestAnimationFrame(update);
      else setTimeout(update, 16);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  /* ---------- След нажатия на штамп ---------- */
  function initStampPress() {
    var stamps = document.querySelectorAll('.stamp');
    function bind(el) {
      el.addEventListener('click', function () {
        el.classList.remove('is-pressed');
        void el.offsetWidth;
        el.classList.add('is-pressed');
      });
    }
    for (var i = 0; i < stamps.length; i++) bind(stamps[i]);
  }

  /* ---------- Смена языка: бланк переворачивают ----------
   * Длина текстов у языков разная, поэтому после смены возвращаем на экран тот же лист
   * на том же расстоянии от шапки. Переворот — только там, где есть View Transitions. */
  function switchLang() {
    var next = current === 'zh' ? 'ru' : 'zh';
    var sheets = document.querySelectorAll('main > .sheet');
    var anchor = null;
    var anchorTop = 0;
    for (var i = 0; i < sheets.length; i++) {
      var r = sheets[i].getBoundingClientRect();
      if (r.bottom > 80) { anchor = sheets[i]; anchorTop = r.top; break; }
    }
    function swap() {
      applyLang(next);
      if (anchor && anchorTop < 0) window.scrollBy(0, anchor.getBoundingClientRect().top - anchorTop);
    }
    var root = document.documentElement;
    if (!MOTION || typeof document.startViewTransition !== 'function') { swap(); return; }
    var smooth = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto'; // сохранение места — мгновенно, без проезда
    root.classList.add('is-flipping');
    function settle() { root.classList.remove('is-flipping'); root.style.scrollBehavior = smooth; }
    try {
      var vt = document.startViewTransition(swap);
      if (vt && vt.finished && vt.finished.then) vt.finished.then(settle, settle);
      else settle();
    } catch (e) { settle(); if (current !== next) swap(); }
  }

  /* ---------- Печать: вопросы раскрыты на листе ---------- */
  function initPrint() {
    var opened = [];
    window.addEventListener('beforeprint', function () {
      var all = document.querySelectorAll('.qa details');
      for (var i = 0; i < all.length; i++) {
        if (!all[i].open) { all[i].open = true; opened.push(all[i]); }
      }
    });
    window.addEventListener('afterprint', function () {
      for (var i = 0; i < opened.length; i++) opened[i].open = false;
      opened = [];
    });
  }

  function init() {
    applyLang(detectLang());
    var toggle = document.getElementById('lang-toggle');
    if (toggle) toggle.addEventListener('click', switchLang);
    var year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());
    initDeferredGroups();
    initContactLinks();
    initCopy();
    initSlip();
    initAnchorSpy();
    initStickyCta();
    initProgress();
    initStampPress();
    initReveal();
    initPrint();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
