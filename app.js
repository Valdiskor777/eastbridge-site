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
 */
(function () {
  'use strict';

  var CONTENT = window.CONTENT;
  if (!CONTENT || !CONTENT.config || !CONTENT.zh || !CONTENT.ru) return;

  var config = CONTENT.config;
  var STORAGE_KEY = 'eb-lang';
  var current = 'zh';

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
    hidePlaceholders();
    syncDeferredGroups(); // подписи-заглушки пересчитаны — состав групп обязан за ними успевать
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
    var timer = null;

    function say(key, fallback) {
      label.textContent = phrase(key, fallback);
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        label.textContent = phrase('contacts.copy', idle);
      }, COPY_REVERT_MS);
    }
    function done() { say('contacts.copied', idle); }
    function manual() { selectNode(source); say('contacts.copyFail', idle); }
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
    if (toggle) toggle.addEventListener('click', function () { applyLang(current === 'zh' ? 'ru' : 'zh'); });
    var year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());
    initDeferredGroups();
    initContactLinks();
    initCopy();
    initAnchorSpy();
    initStickyCta();
    initPrint();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
