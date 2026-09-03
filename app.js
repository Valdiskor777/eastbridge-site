/**
 * app.js — переключение языка + визуальные компоненты.
 * Приоритет источника языка: ?lang=zh|ru → localStorage → 中文 (по умолчанию).
 * Ставит data-lang и lang на <html>, проходит по [data-i18n], [data-i18n-attr],
 * [data-config], обновляет document.title. Выбор запоминается в localStorage.
 *
 * После applyLang инициализируются: initCarousels() — [data-carousel] без data-carousel-deferred;
 * initTicker() — бегущая строка .ticker; initCountUp() — цифры [data-count];
 * initAccordions() — FAQ [data-accordion]; initProof() — карусель скринов из ЛК в #proof:
 * её обёртка .proof-shots скрыта в разметке, initProof ждёт load/error картинок (или дедлайн),
 * убирает слайды без файла и раскрывает обёртку вместе с каруселью, только если загрузился
 * хотя бы один скрин; скрин, пришедший после дедлайна, возвращается в карусель.
 * Текст секции — навыки продвижения — от скринов не зависит и виден всегда.
 * hidePlaceholders() — в конце каждого applyLang:
 * элементы [data-ph] с текстом-заглушкой «[…]» получают hidden.
 */
(function () {
  'use strict';

  var CONTENT = window.CONTENT;
  if (!CONTENT || !CONTENT.config || !CONTENT.zh || !CONTENT.ru) return;

  var config = CONTENT.config;
  var STORAGE_KEY = 'eb-lang';
  var current = 'zh';

  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

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
          var val = dict[parts[1].trim()];
          if (attrNodes[j].hasAttribute('data-n')) val = val.replace('{n}', attrNodes[j].getAttribute('data-n'));
          attrNodes[j].setAttribute(parts[0].trim(), val);
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
  }

  /* ---------- Публичные плейсхолдеры: [data-ph] ----------
   * Элемент получает hidden, если его текст после подстановки словаря содержит
   * заглушку вида «[…]» («[数字] 个», «[WECHAT ID]», «[ЮРЛИЦО · 法人主体]»). Метка ставится
   * на целую строку «подпись + значение» (метрика кейса, строка контакта, юрлицо в футере),
   * поэтому проверяется текст всего элемента. Вызывается в конце каждого applyLang. */
  var PLACEHOLDER = /\[[^\[\]]+\]/;
  function hidePlaceholders() {
    var nodes = document.querySelectorAll('[data-ph]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].hidden = PLACEHOLDER.test((nodes[i].textContent || '').trim());
    }
  }

  /* ---------- Аккордеон FAQ: [data-accordion] ----------
   * Кнопка с aria-expanded управляет панелью из aria-controls (атрибут hidden).
   * Панели независимы: открытых может быть несколько. Enter/Space — нативно у button,
   * ↑/↓ — переход между вопросами, Home/End — к первому/последнему.
   * В print CSS раскрывает все панели (.faq__a[hidden] → block). */
  function setupAccordion(root) {
    var btns = root.querySelectorAll('button[aria-controls][aria-expanded]');
    if (!btns.length) return;

    function setOpen(btn, open) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (panel) panel.hidden = !open;
    }

    function bind(btn, idx) {
      setOpen(btn, btn.getAttribute('aria-expanded') === 'true');
      btn.addEventListener('click', function () {
        setOpen(btn, btn.getAttribute('aria-expanded') !== 'true');
      });
      btn.addEventListener('keydown', function (e) {
        var to = -1;
        if (e.key === 'ArrowDown') to = (idx + 1) % btns.length;
        else if (e.key === 'ArrowUp') to = (idx - 1 + btns.length) % btns.length;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = btns.length - 1;
        if (to >= 0) { e.preventDefault(); btns[to].focus(); }
      });
    }

    for (var i = 0; i < btns.length; i++) bind(btns[i], i);
  }

  function initAccordions() {
    var roots = document.querySelectorAll('[data-accordion]');
    for (var i = 0; i < roots.length; i++) setupAccordion(roots[i]);
  }

  /* ---------- Карусель: [data-carousel] ----------
   * .carousel__track — scroll-snap трек; страницы = слайды / видимых за раз (perView
   * измеряется по факту, задаётся CSS-переменной --per-view). Стрелки, точки, свайп
   * (нативный скролл), клавиатура ←/→, автопрокрутка data-autoplay мс с паузой на
   * hover / focus-within / touch, зацикливание, стоп при prefers-reduced-motion.
   * .carousel--mobile — активна только ≤768px (шире CSS рисует сетку). */
  function setupCarousel(root) {
    var track = root.querySelector('.carousel__track');
    if (!track) return;
    var prevBtn = root.querySelector('.carousel__prev');
    var nextBtn = root.querySelector('.carousel__next');
    var dotsBox = root.querySelector('.carousel__dots');
    var slides = track.children;
    var mobileOnly = root.classList.contains('carousel--mobile');
    var mq = null;
    try { mq = window.matchMedia('(max-width: 768px)'); } catch (e) {}
    var delay = parseInt(root.getAttribute('data-autoplay'), 10) || 0;
    var perView = 1, pages = 1, page = 0, timer = null;
    var hover = false, focus = false, touch = false;

    function isActive() { return !mobileOnly || (mq && mq.matches); }

    function paintDots() {
      if (!dotsBox) return;
      var dots = dotsBox.children;
      for (var d = 0; d < dots.length; d++) {
        if (d === page) dots[d].setAttribute('aria-current', 'true');
        else dots[d].removeAttribute('aria-current');
      }
    }

    function renderDots() {
      if (!dotsBox) return;
      dotsBox.innerHTML = '';
      for (var p = 0; p < pages; p++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'carousel__dot';
        b.setAttribute('data-page', String(p));
        b.setAttribute('data-n', String(p + 1));
        b.setAttribute('data-i18n-attr', 'aria-label:carousel.page');
        b.setAttribute('aria-label', String(CONTENT[current]['carousel.page'] || '{n}').replace('{n}', String(p + 1)));
        dotsBox.appendChild(b);
      }
      paintDots();
    }

    function syncFromScroll() {
      if (!slides.length) return;
      var x = track.scrollLeft;
      var atEnd = x + track.clientWidth >= track.scrollWidth - 2;
      var p;
      if (atEnd) {
        p = pages - 1;
      } else {
        var idx = 0, best = Infinity;
        for (var s = 0; s < slides.length; s++) {
          var d = Math.abs(slides[s].offsetLeft - x);
          if (d < best) { best = d; idx = s; }
        }
        p = Math.floor(idx / perView);
      }
      if (p !== page) { page = p; paintDots(); }
    }

    function measure() {
      if (!slides.length) return;
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      var w = slides[0].getBoundingClientRect().width || 1;
      perView = Math.max(1, Math.round((track.clientWidth + gap) / (w + gap)));
      var prevPages = pages;
      pages = isActive() ? Math.max(1, Math.ceil(slides.length / perView)) : 1;
      if (page > pages - 1) page = pages - 1;
      root.classList.toggle('carousel--static', pages <= 1);
      if (pages !== prevPages || (dotsBox && dotsBox.children.length !== pages)) renderDots(); else paintDots();
      syncFromScroll();
      restart();
    }

    function goTo(p) {
      if (pages <= 1 || !isActive()) return;
      p = ((p % pages) + pages) % pages;
      var target = slides[Math.min(p * perView, slides.length - 1)];
      var left = target.offsetLeft;
      page = p;
      paintDots();
      try { track.scrollTo({ left: left, behavior: reduceMotion ? 'auto' : 'smooth' }); }
      catch (e) { track.scrollLeft = left; }
    }

    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start() {
      if (timer || !delay || reduceMotion || !isActive() || pages <= 1) return;
      timer = setInterval(function () {
        if (hover || focus || touch) return;
        if (document.hidden) return;
        goTo(page + 1);
      }, delay);
    }
    function restart() { stop(); start(); }

    if (prevBtn) prevBtn.addEventListener('click', function () { goTo(page - 1); restart(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { goTo(page + 1); restart(); });
    if (dotsBox) dotsBox.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.carousel__dot') : null;
      if (b) { goTo(parseInt(b.getAttribute('data-page'), 10)); restart(); }
    });
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // На десктопной сетке (.carousel--mobile шире 768px) и на одностраничном треке
      // карусель не листается — стрелки должны достаться странице, а не быть проглочены.
      if (!isActive() || pages <= 1) return;
      e.preventDefault();
      goTo(e.key === 'ArrowLeft' ? page - 1 : page + 1);
      restart();
    });

    root.addEventListener('mouseenter', function () { hover = true; });
    root.addEventListener('mouseleave', function () { hover = false; restart(); });
    root.addEventListener('focusin', function () { focus = true; });
    root.addEventListener('focusout', function () { focus = false; restart(); });
    root.addEventListener('touchstart', function () { touch = true; }, { passive: true });
    root.addEventListener('touchend', function () { touch = false; restart(); }, { passive: true });
    root.addEventListener('touchcancel', function () { touch = false; restart(); }, { passive: true });

    var raf = null;
    track.addEventListener('scroll', function () {
      if (raf) return;
      raf = window.requestAnimationFrame(function () { raf = null; syncFromScroll(); });
    }, { passive: true });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(measure, 120);
    });
    if (mq && mq.addEventListener) mq.addEventListener('change', measure);
    else if (mq && mq.addListener) mq.addListener(measure);

    measure();
    return measure; // пересчёт страниц, если состав слайдов изменился (см. initProof)
  }

  function initCarousels() {
    // data-carousel-deferred — карусель поднимает не общий цикл, а владелец секции
    var roots = document.querySelectorAll('[data-carousel]:not([data-carousel-deferred])');
    for (var i = 0; i < roots.length; i++) setupCarousel(roots[i]);
  }

  /* ---------- Доказательства: #proof ----------
   * Скрины из личных кабинетов кладёт собственник (assets/proof/SHOTS.md). Скрыта не вся
   * секция, а только обёртка карусели .proof-shots: текст про навыки продвижения — отдельное
   * требование заказчика и виден всегда, скринов может не быть. Обёртка скрыта атрибутом
   * hidden прямо в разметке: без файлов карусели нет ни на экране, ни в print, ни до
   * DOMContentLoaded. Здесь ждём load/error всех figure.shot img, слайды без файла убираем
   * из трека (perView меряется по первому слайду — пустых слайдов в треке быть не должно)
   * и раскрываем обёртку, только если загрузился хотя бы один скрин.
   * Дедлайн нужен на случай, когда загрузка не движется (оборванный запрос, отключённая
   * графика): он не выбрасывает медленные скрины, а показывает то, что уже пришло, —
   * скрин, загрузившийся позже, возвращается на своё место в карусели (place + show).
   * Величина: 6 файлов × 400 КБ (потолок check-photos) = до 2,4 МБ, на канале ~1 Мбит/с
   * это ~20 с; GitHub Pages из материкового Китая отдаёт медленнее, поэтому берём вдвое. */
  var PROOF_SETTLE_MS = 40000;
  function initProof() {
    var section = document.getElementById('proof');
    if (!section) return;
    var shotsBox = section.querySelector('.proof-shots'); // обёртка карусели — она и скрыта
    if (!shotsBox) return;
    var track = shotsBox.querySelector('.carousel__track');
    var carousel = shotsBox.querySelector('[data-carousel]');
    if (!track || !carousel) return;

    var order = [];        // все слайды в исходном порядке
    var loaded = [];       // чьи файлы загрузились — память initProof, в DOM это не выносится
    var pending = 0;
    var settled = false;
    var timer = null;
    var remeasure = null;

    function place(fig) {
      var next = null;
      for (var i = order.indexOf(fig) + 1; i < order.length; i++) {
        if (order[i].parentNode === track) { next = order[i]; break; }
      }
      track.insertBefore(fig, next);
    }

    function show() {
      if (!track.children.length) return;
      shotsBox.hidden = false;
      if (remeasure) remeasure();
      else remeasure = setupCarousel(carousel);
    }

    function sweep() {
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      for (var i = 0; i < order.length; i++) {
        if (loaded.indexOf(order[i]) === -1 && order[i].parentNode === track) {
          track.removeChild(order[i]);
        }
      }
      show();
    }

    function watch(fig) {
      var img = fig.querySelector('img');
      var counted = false;
      function count() {
        if (counted) return;
        counted = true;
        pending--;
        if (pending === 0 && !settled) sweep();
      }
      function ok() {
        if (loaded.indexOf(fig) === -1) loaded.push(fig);
        if (settled) { place(fig); show(); } // пришёл позже дедлайна — возвращаем в карусель
        count();
      }
      if (!img) { count(); return; }
      if (img.complete) { if (img.naturalWidth > 0) ok(); else count(); return; }
      img.addEventListener('load', ok);
      img.addEventListener('error', count);
    }

    var shots = shotsBox.querySelectorAll('figure.shot');
    pending = shots.length;
    if (!pending) return; // слайдов нет — обёртка остаётся hidden
    for (var i = 0; i < shots.length; i++) { order.push(shots[i]); watch(shots[i]); }
    if (!settled) timer = setTimeout(sweep, PROOF_SETTLE_MS);
  }

  /* ---------- Бегущая строка: .ticker ----------
   * Дублирует .ticker__list (aria-hidden) для бесшовного цикла и включает
   * анимацию классом .ticker--live; без JS список просто стоит. */
  function initTicker() {
    var tickers = document.querySelectorAll('.ticker');
    for (var i = 0; i < tickers.length; i++) {
      var inner = tickers[i].querySelector('.ticker__inner');
      var list = tickers[i].querySelector('.ticker__list');
      if (!inner || !list) continue;
      var clone = list.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.classList.add('ticker__list--clone');
      inner.appendChild(clone);
      tickers[i].classList.add('ticker--live');
    }
  }

  /* ---------- Count-up: [data-count] ----------
   * Атрибут булев; целевое число — первая группа цифр в тексте элемента (текст приходит
   * из словаря, в zh/ru цифры могут отличаться: «7000 万+» / «70+ млн»). Текст без цифр («[数字]») не анимируется. Один раз при входе
   * в viewport, 800 мс; при prefers-reduced-motion — сразу финал (текст уже финальный). */
  function initCountUp() {
    var nodes = document.querySelectorAll('[data-count]');
    if (!nodes.length || reduceMotion || !('IntersectionObserver' in window) || !window.requestAnimationFrame) return;

    function animate(el) {
      var tpl = el.textContent;
      var m = /\d+/.exec(tpl);
      if (!m) return;
      var target = parseInt(m[0], 10);
      var head = tpl.slice(0, m.index), tail = tpl.slice(m.index + m[0].length);
      var duration = 800, t0 = null, last, done = false;
      function write(v) { last = head + String(v) + tail; el.textContent = last; }
      function frame(ts) {
        if (el.textContent !== last) return; // текст сменили извне (смена языка) — там уже финал
        if (t0 === null) t0 = ts;
        var k = Math.min(1, (ts - t0) / duration);
        var eased = 1 - Math.pow(1 - k, 3);
        write(Math.round(target * eased));
        if (k < 1) window.requestAnimationFrame(frame); else done = true;
      }
      write(0);
      window.requestAnimationFrame(frame);
      // Страховка: если кадры не приходят (фоновая вкладка) — показать финал
      setTimeout(function () { if (!done && el.textContent === last) write(target); }, duration + 300);
    }

    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          io.unobserve(entries[i].target);
          animate(entries[i].target);
        }
      }
    }, { threshold: 0.35 });
    for (var n = 0; n < nodes.length; n++) io.observe(nodes[n]);
  }

  function init() {
    applyLang(detectLang());

    var toggle = document.getElementById('lang-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        applyLang(current === 'zh' ? 'ru' : 'zh');
      });
    }

    var year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());

    initTicker();
    initCarousels();
    initCountUp();
    initAccordions();
    initProof();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
