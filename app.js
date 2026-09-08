/**
 * app.js — переключение языка + визуальные компоненты.
 * Приоритет источника языка: ?lang=zh|ru → localStorage → 中文 (по умолчанию).
 * Ставит data-lang и lang на <html>, проходит по [data-i18n], [data-i18n-attr],
 * [data-config], обновляет document.title. Выбор запоминается в localStorage.
 *
 * После applyLang инициализируются: initCarousels() — [data-carousel] без data-carousel-deferred
 * (положение показывает счётчик «3 / 12» — он же живая область, объявляющая номер
 * страницы при листании руками; строку собирает applyLang через ключ carousel.counter);
 * initTicker() — бегущая строка .ticker; initCountUp() — цифры [data-count];
 * initAccordions() — FAQ [data-accordion]; initTabs() — вкладки [data-tabs] в главе «Условия
 * и экономика»; initDisclosures() — кнопки [data-disclosure], раскрывающие длинный
 * список на узком экране (шире 768px список виден целиком);
 * initDeferredGroups() — отложенные группы изображений, файлы которых кладёт
 * собственник: скрины из ЛК (.proof-shots) и настоящие материалы ([data-real-group]).
 * Группа скрыта в разметке; инициализатор ждёт load/error картинок (или дедлайн), убирает
 * фигуры без файла, раскрывает группу, только если выжила хотя бы одна, и возвращает на
 * место опоздавшую. Текст вокруг группы от файлов не зависит и виден всегда.
 * Группа с data-real-group="<slot>" при раскрытии гасит постановочное figure.photo
 * с этим data-slot: настоящее вытесняет постановочное. Фигура с подписью-заглушкой
 * (портрет без имени и роли) в группу не попадает, а решение пересчитывается на каждой
 * смене языка вместе с hidePlaceholders() — и откатывается, если подписи снова заглушки.
 * initContactLinks() — href для tel:/mailto:/приглашения WeChat из config (плейсхолдер
 * ссылкой не становится); текст всех трёх строк ставит applyLang из data-config,
 * инициализатор занят только адресом ссылки;
 * initCopy() — кнопки [data-copy] с запасным путём execCommand для file://;
 * initAnchorSpy() — подсветка активного якоря в шапке.
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
    syncDeferredGroups(); // подписи-заглушки пересчитаны — состав групп обязан за ними успевать
    syncCarouselCounters(); // «3 / 12» собирается из словаря, а не берётся из разметки
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

  /* ---------- Вкладки: [data-tabs] ----------
   * Тот же приём, что у аккордеона: кнопка управляет панелью из aria-controls (hidden).
   * Отличие в том, что панель ровно одна: выбор вкладки гасит остальные (aria-selected).
   * Клавиатура как в аккордеоне, но по горизонтали: ←/→ переводят и фокус, и выбор,
   * Home/End — к первой/последней. В табличном фокусе (roving tabindex) в цепочке Tab
   * стоит только активная вкладка. В print CSS раскрывает все панели. */
  function setupTabs(root) {
    var tabs = root.querySelectorAll('[role="tab"][aria-controls]');
    if (!tabs.length) return;

    function select(idx, focus) {
      for (var i = 0; i < tabs.length; i++) {
        var on = i === idx;
        tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
        tabs[i].tabIndex = on ? 0 : -1;
        var panel = document.getElementById(tabs[i].getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      }
      if (focus) tabs[idx].focus();
    }

    function bind(tab, idx) {
      tab.addEventListener('click', function () { select(idx, false); });
      tab.addEventListener('keydown', function (e) {
        var to = -1;
        if (e.key === 'ArrowRight') to = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') to = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = tabs.length - 1;
        if (to >= 0) { e.preventDefault(); select(to, true); }
      });
    }

    var initial = 0;
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute('aria-selected') === 'true') initial = i;
      bind(tabs[i], i);
    }
    select(initial, false); // разметка задаёт первую вкладку, состояние приводим к ней целиком
  }

  function initTabs() {
    var roots = document.querySelectorAll('[data-tabs]');
    for (var i = 0; i < roots.length; i++) setupTabs(roots[i]);
  }

  /* ---------- Раскрывашка длинного списка: button[data-disclosure] ----------
   * Тот же приём, что у аккордеона: кнопка с aria-expanded управляет списком из
   * aria-controls. Отличие в том, что список не прячется целиком — на узком экране
   * CSS показывает первые четыре пункта (.disclosure--collapsed), а кнопка снимает
   * ограничение. Шире 768px список виден целиком всегда: кнопки там нет, и состояние
   * приводится к «раскрыто», чтобы aria-expanded не расходилось с картинкой.
   * Подпись кнопки меняется вместе с состоянием: JS переставляет data-i18n, а текст
   * на смене языка дальше обновляет applyLang — второй копии словаря здесь нет. */
  function setupDisclosure(btn) {
    var list = document.getElementById(btn.getAttribute('aria-controls'));
    if (!list) return;
    var mq = null;
    try { mq = window.matchMedia('(max-width: 768px)'); } catch (e) {}
    var open = false;

    function paint() {
      var collapsed = (!mq || mq.matches) && !open;
      list.classList.toggle('disclosure--collapsed', collapsed);
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      var key = collapsed ? 'disclosure.showAll' : 'disclosure.collapse';
      btn.setAttribute('data-i18n', key);
      var text = CONTENT[current][key];
      if (typeof text === 'string') btn.textContent = text;
    }

    btn.addEventListener('click', function () { open = !open; paint(); });
    if (mq && mq.addEventListener) mq.addEventListener('change', paint);
    else if (mq && mq.addListener) mq.addListener(paint);
    paint();
  }

  function initDisclosures() {
    var btns = document.querySelectorAll('button[data-disclosure][aria-controls]');
    for (var i = 0; i < btns.length; i++) setupDisclosure(btns[i]);
  }

  // Окно, в котором прокрутку трека затеяли не пальцем, а стрелкой или клавишей:
  // плавная прокрутка укладывается в него с запасом.
  var SELF_SCROLL_MS = 800;

  // Счётчики положения всех поднятых каруселей: applyLang обходит их после смены языка
  var counterPainters = [];
  function syncCarouselCounters() {
    for (var i = 0; i < counterPainters.length; i++) counterPainters[i]();
  }

  /* ---------- Карусель: [data-carousel] ----------
   * .carousel__track — scroll-snap трек; страницы = слайды / видимых за раз (perView
   * измеряется по факту, задаётся CSS-переменной --per-view). Стрелки, счётчик
   * положения «3 / 12» между ними, свайп (нативный скролл), клавиатура ←/→,
   * автопрокрутка data-autoplay мс с паузой на hover / focus-within / touch,
   * зацикливание, стоп при prefers-reduced-motion. Автопрокрутка осталась только там,
   * где слайд — изображение: текстовую карточку она уводила из-под читателя.
   * .carousel--mobile — активна только ≤768px (шире CSS рисует сетку). */
  function setupCarousel(root) {
    var track = root.querySelector('.carousel__track');
    if (!track) return;
    var prevBtn = root.querySelector('.carousel__prev');
    var nextBtn = root.querySelector('.carousel__next');
    var counterBox = root.querySelector('.carousel__counter');
    var slides = track.children;
    var mobileOnly = root.classList.contains('carousel--mobile');
    var mq = null;
    try { mq = window.matchMedia('(max-width: 768px)'); } catch (e) {}
    var delay = parseInt(root.getAttribute('data-autoplay'), 10) || 0;
    var perView = 1, pages = 1, page = 0, timer = null;
    var hover = false, focus = false, touch = false;

    function isActive() { return !mobileOnly || (mq && mq.matches); }

    // Положение — одной строкой «3 / 12»: ряд точек на двенадцати слайдах
    // переносился на вторую строку и не говорил, где ты находишься. Точки называли
    // позицию вслух (aria-current + подпись на каждой), поэтому счётчик обязан
    // делать это сам — иначе незрячий читатель, листающий стрелками, теряется.
    // Объявляет он только то, что читатель сделал руками: aria-live поднимается
    // до polite перед листанием стрелкой, клавишей или свайпом и опускается в off
    // перед служебной перерисовкой (пересчёт страниц, автопрокрутка, смена языка) —
    // иначе карусель скринов тараторила бы каждые пять секунд, а переключение
    // языка повторяло бы номер страницы ни с того ни с сего. Текст, совпавший
    // с прежним, не переписывается вовсе: пустая правка — тоже объявление.
    function paintCounter(announce) {
      if (!counterBox) return;
      var tpl = CONTENT[current]['carousel.counter'] || '{n} / {total}';
      var text = tpl.replace('{n}', String(page + 1)).replace('{total}', String(pages));
      if (text === counterBox.textContent) return;
      counterBox.setAttribute('aria-live', announce ? 'polite' : 'off');
      counterBox.textContent = text;
    }

    // announce=true приходит только от обработчика скролла: свайп — тоже рука читателя.
    function syncFromScroll(announce) {
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
      if (p !== page) { page = p; paintCounter(announce); }
    }

    function measure() {
      if (!slides.length) return;
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      var w = slides[0].getBoundingClientRect().width || 1;
      perView = Math.max(1, Math.round((track.clientWidth + gap) / (w + gap)));
      pages = isActive() ? Math.max(1, Math.ceil(slides.length / perView)) : 1;
      if (page > pages - 1) page = pages - 1;
      root.classList.toggle('carousel--static', pages <= 1);
      paintCounter(false);
      syncFromScroll(false);
      restart();
    }

    // Пока едет ЗАТЕЯННАЯ НАМИ прокрутка, события scroll игнорируются: на полпути
    // ближайшим оказывается ещё старый слайд, и syncFromScroll откатывал бы номер
    // туда-обратно. Молчаливый откат страшнее мигания: он переписывает живую область
    // сразу после объявления, и читалка успевает потерять уже сказанное. По затуханию
    // окна состояние сверяется один раз и без объявления — на случай, если читатель
    // перехватил трек пальцем прямо посреди анимации.
    var selfScroll = null;
    function markSelfScroll() {
      clearTimeout(selfScroll);
      selfScroll = setTimeout(function () { selfScroll = null; syncFromScroll(false); }, SELF_SCROLL_MS);
    }

    function goTo(p, announce) {
      if (pages <= 1 || !isActive()) return;
      p = ((p % pages) + pages) % pages;
      var target = slides[Math.min(p * perView, slides.length - 1)];
      var left = target.offsetLeft;
      page = p;
      paintCounter(announce);
      markSelfScroll();
      try { track.scrollTo({ left: left, behavior: reduceMotion ? 'auto' : 'smooth' }); }
      catch (e) { track.scrollLeft = left; }
    }

    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start() {
      if (timer || !delay || reduceMotion || !isActive() || pages <= 1) return;
      timer = setInterval(function () {
        if (hover || focus || touch) return;
        if (document.hidden) return;
        goTo(page + 1); // без объявления: автопрокрутка — не действие читателя
      }, delay);
    }
    function restart() { stop(); start(); }

    if (prevBtn) prevBtn.addEventListener('click', function () { goTo(page - 1, true); restart(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { goTo(page + 1, true); restart(); });
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // На десктопной сетке (.carousel--mobile шире 768px) и на одностраничном треке
      // карусель не листается — стрелки должны достаться странице, а не быть проглочены.
      if (!isActive() || pages <= 1) return;
      e.preventDefault();
      goTo(e.key === 'ArrowLeft' ? page - 1 : page + 1, true);
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
      if (raf || selfScroll) return;
      raf = window.requestAnimationFrame(function () { raf = null; syncFromScroll(true); });
    }, { passive: true });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(measure, 120);
    });
    if (mq && mq.addEventListener) mq.addEventListener('change', measure);
    else if (mq && mq.addListener) mq.addListener(measure);

    // Счётчик — не атрибут разметки, а собранная строка: перерисовать его на смене
    // языка некому, кроме самой карусели, поэтому она отдаётся applyLang.
    counterPainters.push(paintCounter);

    measure();
    return measure; // пересчёт страниц, если состав слайдов изменился (см. setupDeferredGroup)
  }

  function initCarousels() {
    // data-carousel-deferred — карусель поднимает не общий цикл, а владелец секции
    var roots = document.querySelectorAll('[data-carousel]:not([data-carousel-deferred])');
    for (var i = 0; i < roots.length; i++) setupCarousel(roots[i]);
  }

  /* ---------- Отложенные группы изображений: .proof-shots и [data-real-group] ----------
   * Файлы для этих групп кладёт собственник (assets/proof/SHOTS.md, assets/real/SHOTS.md),
   * и до этого момента их нет. Скрыта не секция, а обёртка группы: текст вокруг — отдельное
   * требование заказчика и виден всегда (D03). Обёртка скрыта атрибутом hidden прямо
   * в разметке: без файлов группы нет ни на экране, ни в print, ни до DOMContentLoaded.
   * Здесь ждём load/error всех картинок группы, фигуры без файла убираем из контейнера
   * (в карусели perView меряется по первому слайду — пустых слайдов в треке быть не должно)
   * и раскрываем обёртку, только если загрузилась хотя бы одна.
   * Дедлайн нужен на случай, когда загрузка не движется (оборванный запрос, отключённая
   * графика): он не выбрасывает медленные файлы, а показывает то, что уже пришло, —
   * картинка, загрузившаяся позже, возвращается на своё место (place + show).
   * Величина: 6 файлов × 400 КБ (потолок check-photos) = до 2,4 МБ, на канале ~1 Мбит/с
   * это ~20 с; GitHub Pages из материкового Китая отдаёт медленнее, поэтому берём вдвое.
   * Своя карусель у группы поднимается здесь же (D02): общий цикл initCarousels её
   * не трогает — она помечена data-carousel-deferred, в скрытой обёртке perView мерить
   * нечем. У группы без карусели этой части просто нет. */
  var DEFERRED_SETTLE_MS = 40000;
  var syncs = []; // по одному пересчёту на группу — их зовёт applyLang после hidePlaceholders()

  function setupDeferredGroup(box) {
    var figures = box.querySelectorAll('figure.shot, figure.real');
    if (!figures.length) return;
    var container = figures[0].parentNode; // трек карусели или сетка группы
    var carousel = box.querySelector('[data-carousel-deferred]');
    // Настоящий материал вытесняет постановочное фото того же смысла (R10.2):
    // значение data-real-group — data-slot этого фото, пустое значение = вытеснять нечего.
    var stagedSlot = box.getAttribute('data-real-group');
    var staged = stagedSlot ? document.querySelector('figure.photo[data-slot="' + stagedSlot + '"]') : null;

    var order = [];  // все фигуры в исходном порядке
    var loaded = []; // чьи файлы загрузились — память группы, в DOM это не выносится
    var pending = figures.length;
    var settled = false;
    var timer = null;
    var remeasure = null;

    function place(fig) {
      var next = null;
      for (var i = order.indexOf(fig) + 1; i < order.length; i++) {
        if (order[i].parentNode === container) { next = order[i]; break; }
      }
      container.insertBefore(fig, next);
    }

    // Подпись фигуры лежит под data-ph: hidePlaceholders() пометил её hidden, если
    // собственник не вписал значения в текущем словаре. Портрет без имени и роли
    // показывать нельзя — он вытеснит постановочное фото и оставит безымянное лицо (R10).
    // Условие пересчитывается при каждой смене языка: имена могут быть вписаны только
    // в одном словаре, и тогда во втором портреты обязаны исчезнуть, а переговорная — вернуться.
    function captionPending(fig) {
      var ph = fig.querySelector('[data-ph]');
      return !!ph && ph.hidden;
    }

    /* Единственное место, где состав группы и её видимость приводятся в соответствие
     * с фактами. Зовётся по итогам загрузки, по дедлайну и заново после каждой смены
     * языка. Считаем по фигурам, а не по детям контейнера: в обёртке могут лежать
     * подписи и сноски, и группа без единой картинки раскрылась бы пустой.
     * Две разные причины — два разных приёма, и оба обратимы:
     *  — файла нет: фигуру выносим из контейнера совсем (в карусели пустых слайдов быть
     *    не должно, perView меряется по первому слайду); опоздавший файл возвращается place();
     *  — подпись-заглушка: фигуру гасим атрибутом hidden, но из документа не выносим —
     *    applyLang и hidePlaceholders ходят по документу, и вынесенная фигура перестала бы
     *    получать новый текст, то есть решение стало бы необратимым.
     * Пропала последняя показанная фигура — обёртка снова hidden, а вытесненное
     * постановочное фото возвращается на место. */
    function sync() {
      if (!settled) return;
      var alive = 0;
      for (var i = 0; i < order.length; i++) {
        var fig = order[i];
        var inDom = fig.parentNode === container;
        if (loaded.indexOf(fig) === -1) { if (inDom) container.removeChild(fig); continue; }
        if (!inDom) place(fig);
        fig.hidden = captionPending(fig);
        if (!fig.hidden) alive++;
      }
      box.hidden = alive === 0;
      if (staged) staged.hidden = alive > 0;
      if (alive === 0 || !carousel) return;
      if (remeasure) remeasure();
      else remeasure = setupCarousel(carousel);
    }
    syncs.push(sync);

    function settle() {
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      sync();
    }

    function watch(fig) {
      var img = fig.querySelector('img');
      var counted = false;
      function count() {
        if (counted) return;
        counted = true;
        pending--;
        if (pending === 0 && !settled) settle();
      }
      function ok() {
        if (loaded.indexOf(fig) === -1) loaded.push(fig);
        sync(); // после дедлайна — возвращаем опоздавшего на место; до него sync молчит
        count();
      }
      if (!img) { count(); return; }
      if (img.complete) { if (img.naturalWidth > 0) ok(); else count(); return; }
      img.addEventListener('load', ok);
      img.addEventListener('error', count);
    }

    for (var i = 0; i < figures.length; i++) { order.push(figures[i]); watch(figures[i]); }
    if (!settled) timer = setTimeout(settle, DEFERRED_SETTLE_MS);
  }

  function initDeferredGroups() {
    var boxes = document.querySelectorAll('.proof-shots, [data-real-group]');
    for (var i = 0; i < boxes.length; i++) setupDeferredGroup(boxes[i]);
  }

  // Пересчёт из applyLang: до initDeferredGroups() список пуст, и вызов ничего не стоит.
  function syncDeferredGroups() {
    for (var i = 0; i < syncs.length; i++) syncs[i]();
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

  /* ---------- Кликабельные телефон и почта: [data-contact-link] ----------
   * href собирается из config, а не хардкодится в разметке. Телефон нормализуется
   * до «+» и цифр; если цифр меньше семи — там плейсхолдер «[ТЕЛЕФОН · 电话]»,
   * и ссылка не создаётся: <a> без href остаётся обычным текстом (битых ссылок нет).
   * Третий вид — приглашение WeChat: обычная https-ссылка из config.wechat; его собирает
   * любой вид, кроме tel и mailto. Текста инициализатор не касается ни у одного вида —
   * все три строки показывают значение из config, которое поставил applyLang, целиком. */
  function telHref(value) {
    var s = String(value).replace(/[^\d+]/g, '');
    var plus = s.charAt(0) === '+';
    var digits = s.replace(/\D/g, '');
    if (digits.length < 7) return '';
    return 'tel:' + (plus ? '+' : '') + digits;
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

  /* ---------- Копирование значения: [data-copy] ----------
   * data-copy — id элемента-источника. Сначала navigator.clipboard, затем запасной путь
   * через скрытое поле и document.execCommand('copy'): сайт показывают с file://, где
   * clipboard-API обычно недоступен. Если не вышло и это — значение выделяется, чтобы
   * его можно было скопировать вручную. Подпись кнопки меняется на 2 секунды и возвращается
   * (текст берётся из словаря на момент возврата — язык мог смениться). */
  var COPY_REVERT_MS = 2000;

  // Ключи contacts.copy* читает только app.js — check-i18n их не сторожит, поэтому у чтения
  // всегда есть запасное значение: подпись кнопки не должна стать пустой или undefined.
  function phrase(key, fallback) {
    var dict = CONTENT[current] || {};
    return typeof dict[key] === 'string' && dict[key] ? dict[key] : fallback;
  }

  function execCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // Поле должно оставаться выделяемым: display:none/hidden ломает execCommand
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
      return true;
    } catch (e) { return false; }
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

    function done() { say('contacts.copied', '✓'); }
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
      // execCommand разрешён только в синхронном такте клика: из обработчика отказа промиса
      // он уже не сработает. На file://, где clipboard-API обычно отказывает, идём им первым.
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

  /* ---------- Подсветка активного якоря в шапке ----------
   * Активна та глава, что первой пересекает полосу под шапкой. Ссылка помечается
   * aria-current="true" (на ней же держится и оформление). На ≤768px якорей в шапке нет,
   * поэтому и подсветки нет — отдельного условия не нужно. */
  function initAnchorSpy() {
    var links = document.querySelectorAll('.site-nav__link');
    if (!links.length || !('IntersectionObserver' in window)) return;

    var pairs = [];
    for (var i = 0; i < links.length; i++) {
      var id = (links[i].getAttribute('href') || '').slice(1);
      var section = id ? document.getElementById(id) : null;
      if (section) pairs.push({ link: links[i], section: section, visible: false });
    }
    if (!pairs.length) return;
    // Порядок ссылок в шапке не обязан совпадать с порядком глав в документе
    pairs.sort(function (a, b) {
      return (a.section.compareDocumentPosition(b.section) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });

    function paint() {
      var active = null;
      for (var i = 0; i < pairs.length; i++) {
        if (pairs[i].visible) { active = pairs[i]; break; }
      }
      if (!active) return; // между главами — оставляем прежнюю отметку, чтобы не мигало
      for (var j = 0; j < pairs.length; j++) {
        if (pairs[j] === active) pairs[j].link.setAttribute('aria-current', 'true');
        else pairs[j].link.removeAttribute('aria-current');
      }
    }

    var io = new IntersectionObserver(function (entries) {
      for (var e = 0; e < entries.length; e++) {
        for (var i = 0; i < pairs.length; i++) {
          if (pairs[i].section === entries[e].target) pairs[i].visible = entries[e].isIntersecting;
        }
      }
      paint();
    }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });

    for (var k = 0; k < pairs.length; k++) io.observe(pairs[k].section);
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
    initTabs();
    initDisclosures();
    initDeferredGroups();
    initContactLinks();
    initCopy();
    initAnchorSpy();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
