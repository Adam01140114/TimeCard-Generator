/* TimeCard Generator
 * Everything runs in the browser. Dates and times are never stored or pre-filled:
 * every day starts empty. Only the optional "Your details" fields and the PDF
 * option switches are kept in localStorage, and only when the user asks for it.
 */
(() => {
  'use strict';

  // ---------- Small helpers ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const KEY_DETAILS = 'tcg.details.v1';
  const KEY_PREFS = 'tcg.prefs.v1';

  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
    },
  };

  let uid = 0;
  const nextId = () => ++uid;
  const FIELDS = ['date', 'timeIn', 'timeOut', 'lunchStart', 'lunchEnd'];
  const newDay = () => ({ id: nextId(), date: '', timeIn: '', timeOut: '', lunchStart: '', lunchEnd: '' });
  const newCard = () => ({ id: nextId(), days: [newDay()] });

  const state = {
    cards: [newCard()],
    sigMode: 'type',
    strokes: [], // each stroke: array of [x, y] in CSS pixels of the pad
    attempted: false, // becomes true after the first Download/Preview/Share
  };

  // ---------- Time & date ----------

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function toMinutes(t) {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  }

  function parseISO(s) {
    if (!DATE_RE.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getMonth() === m - 1 ? date : null;
  }

  const fmtUS = (s) => { const [y, m, d] = s.split('-'); return `${m}/${d}/${y}`; };
  const fmtWeekdayShort = (s) => WEEKDAYS[parseISO(s).getDay()];
  const fmtNice = (s) => { const d = parseISO(s); return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };

  function fmtTime(t) {
    const [h, m] = t.split(':').map(Number);
    const suffix = h < 12 ? 'AM' : 'PM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
  }

  const fmtHours = (minutes) => (minutes / 60).toFixed(2);

  function fmtRange(dates) {
    if (!dates.length) return '';
    const first = parseISO(dates[0]);
    const last = parseISO(dates[dates.length - 1]);
    const md = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    if (dates.length === 1 || dates[0] === dates[dates.length - 1]) return `${md(first)}, ${first.getFullYear()}`;
    if (first.getFullYear() === last.getFullYear()) return `${md(first)} – ${md(last)}, ${last.getFullYear()}`;
    return `${md(first)}, ${first.getFullYear()} – ${md(last)}, ${last.getFullYear()}`;
  }

  /** Work out hours for one day and collect any problems with its fields. */
  function analyzeDay(day) {
    const errors = {};
    const tin = toMinutes(day.timeIn);
    const tout = toMinutes(day.timeOut);
    const ls = toMinutes(day.lunchStart);
    const le = toMinutes(day.lunchEnd);

    if (!day.date) errors.date = 'Enter the date.';
    else if (!parseISO(day.date)) errors.date = 'Enter a valid date.';
    if (tin == null) errors.timeIn = 'Enter the time in.';
    if (tout == null) errors.timeOut = 'Enter the time out.';

    let minutes = null;
    let overnight = false;

    if (tin != null && tout != null) {
      if (tin === tout) {
        errors.timeOut = 'Time out must be different from time in.';
      } else {
        const end = tout < tin ? tout + 1440 : tout;
        overnight = tout < tin;
        let lunch = 0;
        let lunchOk = true;
        if ((ls == null) !== (le == null)) {
          lunchOk = false;
          if (ls == null) errors.lunchStart = 'Add the lunch start, or clear the lunch end.';
          else errors.lunchEnd = 'Add the lunch end, or clear the lunch start.';
        } else if (ls != null) {
          const s = ls < tin ? ls + 1440 : ls;
          const e = le < tin ? le + 1440 : le;
          if (e <= s) {
            lunchOk = false;
            errors.lunchEnd = 'Lunch end must be after lunch start.';
          } else if (e > end) {
            lunchOk = false;
            errors.lunchStart = 'Lunch must fall between time in and time out.';
          } else {
            lunch = e - s;
          }
        }
        if (lunchOk) minutes = end - tin - lunch;
      }
    } else {
      // Still flag a half-entered lunch so the user sees it early.
      if ((ls == null) !== (le == null)) {
        if (ls == null) errors.lunchStart = 'Add the lunch start, or clear the lunch end.';
        else errors.lunchEnd = 'Add the lunch end, or clear the lunch start.';
      }
    }

    return { minutes, overnight, errors };
  }

  const cardMinutes = (card) => card.days.reduce((sum, d) => sum + (analyzeDay(d).minutes || 0), 0);
  const sortedDates = (card) => card.days.map((d) => d.date).filter((d) => parseISO(d)).sort();

  // ---------- DOM refs ----------

  const form = $('#tc-form');
  const cardsEl = $('#cards');
  const tplCard = $('#tpl-card');
  const tplDay = $('#tpl-day');
  const nameInput = $('#f-name');
  const positionInput = $('#f-position');
  const companyInput = $('#f-company');
  const rememberInput = $('#f-remember');
  const optHours = $('#opt-hours');
  const optSupervisor = $('#opt-supervisor');
  const grandTotalEl = $('#grand-total');
  const sigTyped = $('#sig-typed');
  const sigTypeBox = $('#sig-type');
  const sigDrawBox = $('#sig-draw');
  const pad = $('#sig-pad');
  const padWrap = pad.parentElement;
  const sigErr = $('#sig-err');
  const toastEl = $('#toast');
  const shareBtn = $('[data-action="share"]');

  // ---------- Rendering ----------

  function render(focusTarget) {
    const multiCard = state.cards.length > 1;
    const frag = document.createDocumentFragment();

    state.cards.forEach((card, ci) => {
      const cardEl = tplCard.content.firstElementChild.cloneNode(true);
      cardEl.dataset.cardId = card.id;
      $('.tc-card-name', cardEl).textContent = multiCard ? `Card ${ci + 1}` : 'Card';
      const removeCard = $('[data-action="remove-card"]', cardEl);
      removeCard.hidden = !multiCard;
      removeCard.setAttribute('aria-label', `Remove card ${ci + 1}`);

      const daysEl = $('.days', cardEl);
      card.days.forEach((day, di) => {
        const dayEl = tplDay.content.firstElementChild.cloneNode(true);
        dayEl.dataset.dayId = day.id;
        $('.day-num', dayEl).textContent = `Day ${di + 1}`;
        const removeDay = $('[data-action="remove-day"]', dayEl);
        removeDay.hidden = card.days.length < 2;
        removeDay.setAttribute('aria-label', `Remove day ${di + 1}${multiCard ? ` from card ${ci + 1}` : ''}`);

        FIELDS.forEach((field) => {
          const input = $(`[data-field="${field}"]`, dayEl);
          const label = $(`[data-for="${field}"]`, dayEl);
          const id = `d${day.id}-${field}`;
          input.id = id;
          input.name = id;
          input.value = day[field];
          label.setAttribute('for', id);
        });
        const err = $('.day-err', dayEl);
        err.id = `d${day.id}-err`;

        const copy = $('.day-copy', dayEl);
        copy.hidden = di === 0;
        $('.day-copy-label', copy).textContent = `Same times as Day ${di}`;

        daysEl.appendChild(dayEl);
        updateDay(day, dayEl);
      });

      frag.appendChild(cardEl);
      updateCard(card, cardEl);
    });

    cardsEl.replaceChildren(frag);
    updateGrandTotal();

    if (focusTarget) {
      const el = document.getElementById(focusTarget);
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
    }
  }

  function updateDay(day, dayEl = cardsEl.querySelector(`[data-day-id="${day.id}"]`)) {
    if (!dayEl) return;
    const { minutes, overnight, errors } = analyzeDay(day);

    const weekday = $('.day-weekday', dayEl);
    weekday.textContent = parseISO(day.date) ? fmtNice(day.date) : '';

    const chip = $('.day-hours', dayEl);
    if (minutes != null) {
      chip.textContent = `${fmtHours(minutes)} h${overnight ? ' · overnight' : ''}`;
      chip.classList.add('has-value');
    } else {
      chip.textContent = '— h';
      chip.classList.remove('has-value');
    }

    // Only show errors after the user has tried to create the PDF.
    const err = $('.day-err', dayEl);
    let firstMessage = '';
    FIELDS.forEach((field) => {
      const input = $(`[data-field="${field}"]`, dayEl);
      const bad = state.attempted && Boolean(errors[field]);
      if (bad) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', err.id);
        if (!firstMessage) firstMessage = errors[field];
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
    });
    err.textContent = firstMessage;
  }

  function updateCard(card, cardEl = cardsEl.querySelector(`[data-card-id="${card.id}"]`)) {
    if (!cardEl) return;
    const dates = sortedDates(card);
    $('.tc-card-range', cardEl).textContent = dates.length ? fmtRange(dates) : 'No dates yet';
    const mins = cardMinutes(card);
    const total = $('.tc-card-total', cardEl);
    total.innerHTML = '';
    total.append('Card total ');
    const strong = document.createElement('strong');
    strong.textContent = `${fmtHours(mins)} h`;
    total.append(strong);
  }

  function updateGrandTotal() {
    const mins = state.cards.reduce((sum, c) => sum + cardMinutes(c), 0);
    grandTotalEl.textContent = fmtHours(mins);
  }

  function updateNameUI() {
    const name = nameInput.value.trim();
    sigTyped.textContent = name || 'Your name will appear here';
    sigTyped.classList.toggle('is-empty', !name);
    if (state.attempted) showNameError(!name);
  }

  function showNameError(show) {
    const field = nameInput.closest('.field');
    field.classList.toggle('is-invalid', show);
    if (show) nameInput.setAttribute('aria-invalid', 'true');
    else nameInput.removeAttribute('aria-invalid');
    $('#f-name-err').textContent = show ? 'Enter your full name.' : '';
  }

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Lookups ----------

  function findDay(dayId) {
    for (const card of state.cards) {
      const index = card.days.findIndex((d) => d.id === dayId);
      if (index !== -1) return { card, day: card.days[index], index };
    }
    return null;
  }

  // ---------- Events: days & cards ----------

  cardsEl.addEventListener('input', onDayInput);
  cardsEl.addEventListener('change', onDayInput);

  function onDayInput(e) {
    const input = e.target.closest('[data-field]');
    if (!input) return;
    const dayEl = input.closest('.day');
    const hit = findDay(Number(dayEl.dataset.dayId));
    if (!hit) return;
    hit.day[input.dataset.field] = input.value;
    updateDay(hit.day, dayEl);
    updateCard(hit.card);
    updateGrandTotal();
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const cardEl = btn.closest('.tc-card');
    const dayEl = btn.closest('.day');
    const card = cardEl ? state.cards.find((c) => c.id === Number(cardEl.dataset.cardId)) : null;

    switch (action) {
      case 'add-day': {
        if (!card) return;
        const day = newDay();
        card.days.push(day);
        render(`d${day.id}-date`);
        break;
      }
      case 'remove-day': {
        const hit = dayEl && findDay(Number(dayEl.dataset.dayId));
        if (!hit || hit.card.days.length < 2) return;
        hit.card.days.splice(hit.index, 1);
        const neighbour = hit.card.days[Math.max(0, hit.index - 1)];
        render(`d${neighbour.id}-date`);
        toast('Day removed');
        break;
      }
      case 'copy-prev': {
        const hit = dayEl && findDay(Number(dayEl.dataset.dayId));
        if (!hit || hit.index === 0) return;
        const prev = hit.card.days[hit.index - 1];
        const hasTimes = prev.timeIn || prev.timeOut || prev.lunchStart || prev.lunchEnd;
        if (!hasTimes) {
          toast(`Day ${hit.index} has no times to copy yet`);
          return;
        }
        ['timeIn', 'timeOut', 'lunchStart', 'lunchEnd'].forEach((f) => {
          hit.day[f] = prev[f];
          $(`[data-field="${f}"]`, dayEl).value = prev[f];
        });
        updateDay(hit.day, dayEl);
        updateCard(hit.card);
        updateGrandTotal();
        toast(`Copied times from Day ${hit.index}`);
        break;
      }
      case 'add-card': {
        const fresh = newCard();
        state.cards.push(fresh);
        render(`d${fresh.days[0].id}-date`);
        break;
      }
      case 'remove-card': {
        if (!card || state.cards.length < 2) return;
        const filled = card.days.some((d) => FIELDS.some((f) => d[f]));
        if (filled && !window.confirm('Remove this card and all of its days?')) return;
        const index = state.cards.indexOf(card);
        state.cards.splice(index, 1);
        const neighbour = state.cards[Math.max(0, index - 1)];
        render(`d${neighbour.days[0].id}-date`);
        toast('Card removed');
        break;
      }
      case 'reset': {
        const filled = state.cards.some((c) => c.days.some((d) => FIELDS.some((f) => d[f])));
        if (filled && !window.confirm('Clear all days and times? Your details stay.')) return;
        state.cards = [newCard()];
        state.attempted = false;
        clearSignature();
        showNameError(false);
        render();
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        toast('Cleared. Ready for a new time card.');
        break;
      }
      case 'clear-sig':
        clearSignature();
        break;
      case 'preview':
        createPdf('preview');
        break;
      case 'share':
        createPdf('share');
        break;
      default:
        break;
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    createPdf('download');
  });

  // ---------- Details (optionally remembered) ----------

  function loadDetails() {
    const saved = store.get(KEY_DETAILS);
    if (saved && typeof saved === 'object') {
      nameInput.value = typeof saved.name === 'string' ? saved.name : '';
      positionInput.value = typeof saved.position === 'string' ? saved.position : '';
      companyInput.value = typeof saved.company === 'string' ? saved.company : '';
      rememberInput.checked = true;
    }
    const prefs = store.get(KEY_PREFS);
    if (prefs && typeof prefs === 'object') {
      if (typeof prefs.hours === 'boolean') optHours.checked = prefs.hours;
      if (typeof prefs.supervisor === 'boolean') optSupervisor.checked = prefs.supervisor;
      if (prefs.sigMode === 'draw' || prefs.sigMode === 'type') setSigMode(prefs.sigMode);
    }
  }

  function saveDetails() {
    if (rememberInput.checked) {
      store.set(KEY_DETAILS, {
        name: nameInput.value.trim(),
        position: positionInput.value.trim(),
        company: companyInput.value.trim(),
      });
    } else {
      store.remove(KEY_DETAILS);
    }
  }

  function savePrefs() {
    store.set(KEY_PREFS, { hours: optHours.checked, supervisor: optSupervisor.checked, sigMode: state.sigMode });
  }

  [nameInput, positionInput, companyInput].forEach((input) => {
    input.addEventListener('input', () => {
      if (input === nameInput) updateNameUI();
      saveDetails();
    });
  });
  rememberInput.addEventListener('change', () => {
    saveDetails();
    toast(rememberInput.checked ? 'Your details will be remembered on this device' : 'Saved details removed from this device');
  });
  optHours.addEventListener('change', savePrefs);
  optSupervisor.addEventListener('change', savePrefs);

  // ---------- Signature ----------

  $$('input[name="sig-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        setSigMode(radio.value);
        savePrefs();
      }
    });
  });

  function setSigMode(mode) {
    state.sigMode = mode;
    $$('input[name="sig-mode"]').forEach((r) => { r.checked = r.value === mode; });
    sigTypeBox.hidden = mode !== 'type';
    sigDrawBox.hidden = mode !== 'draw';
    if (mode === 'draw') requestAnimationFrame(resizePad);
    showSigError(false);
  }

  function showSigError(show) {
    padWrap.classList.toggle('is-invalid', show);
    sigErr.textContent = show ? 'Draw your signature, or switch to "Type my name".' : '';
  }

  const ctx = pad.getContext('2d');
  let drawing = null;

  function resizePad() {
    const rect = pad.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    pad.width = Math.round(rect.width * dpr);
    pad.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawPad();
  }

  function strokeStyle(context, scale = 1) {
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#1a2b5c';
    context.lineWidth = 2.6 * scale;
  }

  function drawStroke(context, points, scale = 1, offsetX = 0, offsetY = 0) {
    if (!points.length) return;
    const p = (i) => [(points[i][0] - offsetX) * scale, (points[i][1] - offsetY) * scale];
    context.beginPath();
    const [x0, y0] = p(0);
    context.moveTo(x0, y0);
    if (points.length === 1) {
      context.lineTo(x0 + 0.01, y0 + 0.01);
    } else {
      for (let i = 1; i < points.length - 1; i++) {
        const [x1, y1] = p(i);
        const [x2, y2] = p(i + 1);
        context.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
      }
      const [xl, yl] = p(points.length - 1);
      context.lineTo(xl, yl);
    }
    context.stroke();
  }

  function redrawPad() {
    const rect = pad.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    strokeStyle(ctx);
    state.strokes.forEach((s) => drawStroke(ctx, s));
    padWrap.classList.toggle('has-ink', state.strokes.length > 0);
  }

  function padPoint(e) {
    const rect = pad.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  pad.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    drawing = [padPoint(e)];
    state.strokes.push(drawing);
    redrawPad();
    showSigError(false);
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    e.preventDefault();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    (events.length ? events : [e]).forEach((ev) => drawing.push(padPoint(ev)));
    redrawPad();
  });
  const endStroke = () => { drawing = null; };
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);
  pad.addEventListener('lostpointercapture', endStroke);

  function clearSignature() {
    state.strokes = [];
    drawing = null;
    redrawPad();
  }

  /** Render the drawn signature, cropped to its ink, as a PNG data URL. */
  function signatureImage() {
    if (!state.strokes.length) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    state.strokes.forEach((s) => s.forEach(([x, y]) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }));
    const padding = 6;
    minX -= padding; minY -= padding; maxX += padding; maxY += padding;
    const scale = 4;
    const w = Math.max(1, Math.ceil((maxX - minX) * scale));
    const h = Math.max(1, Math.ceil((maxY - minY) * scale));
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const c = off.getContext('2d');
    strokeStyle(c, scale);
    state.strokes.forEach((s) => drawStroke(c, s, scale, minX, minY));
    return { data: off.toDataURL('image/png'), width: w / scale, height: h / scale };
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!sigDrawBox.hidden) resizePad(); }, 120);
  });

  // ---------- Validation ----------

  /** Returns the first element that needs attention, or null when everything is valid. */
  function validateAll() {
    state.attempted = true;
    let first = null;

    const nameMissing = !nameInput.value.trim();
    showNameError(nameMissing);
    if (nameMissing) first = nameInput;

    state.cards.forEach((card) => {
      card.days.forEach((day) => {
        updateDay(day);
        const { errors } = analyzeDay(day);
        if (!first) {
          const field = FIELDS.find((f) => errors[f]);
          if (field) first = document.getElementById(`d${day.id}-${field}`);
        }
      });
    });

    const needsInk = state.sigMode === 'draw' && !state.strokes.length;
    showSigError(needsInk);
    if (needsInk && !first) first = pad;

    return first;
  }

  function countProblems() {
    let n = nameInput.value.trim() ? 0 : 1;
    state.cards.forEach((c) => c.days.forEach((d) => { if (Object.keys(analyzeDay(d).errors).length) n += 1; }));
    if (state.sigMode === 'draw' && !state.strokes.length) n += 1;
    return n;
  }

  // ---------- PDF ----------

  /** jsPDF's built-in fonts cover Latin-1. Swap common typographic characters and drop anything else. */
  function pdfSafe(text) {
    return String(text || '')
      .normalize('NFC')
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[–—−]/g, '-')
      .replace(/…/g, '...')
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fitText(doc, text, maxWidth) {
    if (doc.getTextWidth(text) <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && doc.getTextWidth(`${t}...`) > maxWidth) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  }

  const COLORS = {
    ink: [19, 32, 29],
    sub: [79, 95, 91],
    faint: [122, 136, 132],
    line: [196, 205, 202],
    rule: [120, 132, 128],
    head: [232, 241, 238],
    zebra: [248, 250, 249],
    box: [243, 246, 245],
    accent: [15, 118, 110],
    sig: [26, 43, 92],
  };

  function buildPdf() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });

    const PAGE_W = doc.internal.pageSize.getWidth();
    const PAGE_H = doc.internal.pageSize.getHeight();
    const M = 48;
    const CONTENT_W = PAGE_W - M * 2;
    const BOTTOM = PAGE_H - 64;

    const name = pdfSafe(nameInput.value);
    const position = pdfSafe(positionInput.value);
    const company = pdfSafe(companyInput.value);
    const showHours = optHours.checked;
    const supervisor = optSupervisor.checked;
    const sigImg = state.sigMode === 'draw' ? signatureImage() : null;

    doc.setProperties({
      title: `Time card - ${name}`,
      subject: 'Time card',
      author: name,
      creator: 'TimeCard Generator',
    });
    doc.setLineJoin('miter');

    const fill = (rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    const draw = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
    const color = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    const font = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };

    // Column layout
    const dateW = 132;
    const hoursW = showHours ? 72 : 0;
    const timeW = (CONTENT_W - dateW - hoursW) / 4;
    const cols = [
      { key: 'date', label: 'DATE', w: dateW, align: 'left' },
      { key: 'timeIn', label: 'TIME IN', w: timeW, align: 'center' },
      { key: 'timeOut', label: 'TIME OUT', w: timeW, align: 'center' },
      { key: 'lunchStart', label: 'LUNCH START', w: timeW, align: 'center' },
      { key: 'lunchEnd', label: 'LUNCH END', w: timeW, align: 'center' },
    ];
    if (showHours) cols.push({ key: 'hours', label: 'HOURS', w: hoursW, align: 'right' });
    let cx = M;
    cols.forEach((c) => { c.x = cx; cx += c.w; });

    const HEAD_H = 30;
    const ROW_H = 26;
    const TOTAL_H = 30;
    const SIG_H = supervisor ? 160 : 80;

    const cellText = (col, text, baseline) => {
      if (col.align === 'left') doc.text(text, col.x + 12, baseline);
      else if (col.align === 'right') doc.text(text, col.x + col.w - 12, baseline, { align: 'right' });
      else doc.text(text, col.x + col.w / 2, baseline, { align: 'center' });
    };

    function drawTableHeader(y) {
      fill(COLORS.head);
      doc.rect(M, y, CONTENT_W, HEAD_H, 'F');
      font('bold', 7.5);
      color(COLORS.sub);
      cols.forEach((c) => cellText(c, c.label, y + 18.5));
      return y + HEAD_H;
    }

    function drawGrid(top, bottom, rowLines) {
      draw(COLORS.line);
      doc.setLineWidth(0.6);
      rowLines.forEach((ly) => doc.line(M, ly, M + CONTENT_W, ly));
      cols.slice(1).forEach((c) => doc.line(c.x, top, c.x, bottom));
      draw(COLORS.rule);
      doc.setLineWidth(0.9);
      doc.rect(M, top, CONTENT_W, bottom - top, 'S');
    }

    function drawCardHeader(cardIndex, cardCount, range, continued) {
      let y = 58;
      // Small "TIME CARD" kicker above a custom heading; skipped when the heading itself is "Time Card".
      const kicker = position ? 'TIME CARD' : '';
      const kickerText = continued ? `${kicker ? `${kicker} ` : ''}(CONTINUED)` : kicker;
      if (kickerText) {
        font('bold', 8);
        color(COLORS.accent);
        doc.text(kickerText, M, y, { charSpace: 1.2 });
      }
      if (cardCount > 1) {
        font('normal', 8.5);
        color(COLORS.faint);
        doc.text(`Card ${cardIndex + 1} of ${cardCount}`, PAGE_W - M, y, { align: 'right' });
      }

      y += 26;
      font('bold', continued ? 15 : 22);
      color(COLORS.ink);
      doc.text(fitText(doc, position || 'Time Card', CONTENT_W), M, y);

      y += continued ? 18 : 22;
      // Details box
      const boxH = 52;
      fill(COLORS.box);
      doc.roundedRect(M, y, CONTENT_W, boxH, 6, 6, 'F');
      const fields = [['EMPLOYEE', name]];
      if (company) fields.push(['COMPANY', company]);
      fields.push(['PAY PERIOD', range]);
      const weights = fields.length === 3 ? [0.36, 0.34, 0.30] : [0.56, 0.44];
      let fx = M;
      fields.forEach(([label, value], i) => {
        const w = CONTENT_W * weights[i];
        font('bold', 7);
        color(COLORS.faint);
        doc.text(label, fx + 14, y + 19, { charSpace: 0.8 });
        font('bold', 11);
        color(COLORS.ink);
        doc.text(fitText(doc, value || '-', w - 24), fx + 14, y + 37);
        if (i > 0) {
          draw(COLORS.line);
          doc.setLineWidth(0.6);
          doc.line(fx, y + 12, fx, y + boxH - 12);
        }
        fx += w;
      });
      return y + boxH + 22;
    }

    function drawSignature(y, signDate) {
      const sigW = 300;
      const dateX = M + sigW + 36;
      const lineY = y + 50;

      // Employee signature
      if (sigImg) {
        const maxW = sigW - 16;
        const maxH = 46;
        const ratio = Math.min(maxW / sigImg.width, maxH / sigImg.height, 1.6);
        const w = sigImg.width * ratio;
        const h = sigImg.height * ratio;
        doc.addImage(sigImg.data, 'PNG', M + 6, lineY - h - 2, w, h, undefined, 'FAST');
      } else {
        doc.setFont('times', 'bolditalic');
        doc.setFontSize(21);
        color(COLORS.sig);
        doc.text(fitText(doc, name, sigW - 12), M + 6, lineY - 9);
      }
      font('normal', 11.5);
      color(COLORS.ink);
      doc.text(signDate, dateX + 4, lineY - 9);

      draw(COLORS.rule);
      doc.setLineWidth(0.8);
      doc.line(M, lineY, M + sigW, lineY);
      doc.line(dateX, lineY, PAGE_W - M, lineY);
      font('normal', 8);
      color(COLORS.faint);
      doc.text('Employee signature', M, lineY + 13);
      doc.text('Date', dateX, lineY + 13);

      if (supervisor) {
        const l2 = lineY + 76;
        draw(COLORS.rule);
        doc.line(M, l2, M + sigW, l2);
        doc.line(dateX, l2, PAGE_W - M, l2);
        doc.text('Supervisor signature', M, l2 + 13);
        doc.text('Date', dateX, l2 + 13);
      }
    }

    state.cards.forEach((card, ci) => {
      if (ci > 0) doc.addPage();
      const days = card.days.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const dates = days.map((d) => d.date);
      const range = dates.length > 1 && dates[0] !== dates[dates.length - 1]
        ? `${fmtUS(dates[0])} - ${fmtUS(dates[dates.length - 1])}`
        : fmtUS(dates[0]);
      const signDate = fmtUS(dates[dates.length - 1]);

      let y = drawCardHeader(ci, state.cards.length, range, false);
      let top = y;
      y = drawTableHeader(y);
      let rowLines = [];
      let total = 0;

      days.forEach((day, ri) => {
        if (y + ROW_H > BOTTOM) {
          drawGrid(top, y, rowLines);
          doc.addPage();
          y = drawCardHeader(ci, state.cards.length, range, true);
          top = y;
          y = drawTableHeader(y);
          rowLines = [];
        }
        if (ri % 2 === 1) {
          fill(COLORS.zebra);
          doc.rect(M, y, CONTENT_W, ROW_H, 'F');
        }
        rowLines.push(y);

        const { minutes } = analyzeDay(day);
        total += minutes || 0;
        const base = y + 17;
        font('normal', 10);
        color(COLORS.ink);
        cols.forEach((c) => {
          if (c.key === 'date') {
            doc.text(fmtUS(day.date), c.x + 12, base);
            font('normal', 8.5);
            color(COLORS.faint);
            doc.text(fmtWeekdayShort(day.date).toUpperCase(), c.x + c.w - 12, base, { align: 'right' });
            font('normal', 10);
            color(COLORS.ink);
          } else if (c.key === 'hours') {
            font('bold', 10);
            cellText(c, fmtHours(minutes || 0), base);
            font('normal', 10);
          } else if (day[c.key]) {
            cellText(c, fmtTime(day[c.key]), base);
          }
        });
        y += ROW_H;
      });

      if (showHours) {
        if (y + TOTAL_H > BOTTOM) {
          drawGrid(top, y, rowLines);
          doc.addPage();
          y = drawCardHeader(ci, state.cards.length, range, true);
          top = y;
          rowLines = [];
        } else {
          rowLines.push(y);
        }
        const hoursCol = cols[cols.length - 1];
        fill(COLORS.box);
        doc.rect(M, y, CONTENT_W, TOTAL_H, 'F');
        font('bold', 7.5);
        color(COLORS.sub);
        doc.text('TOTAL HOURS', hoursCol.x - 12, y + 19, { align: 'right', charSpace: 0.8 });
        font('bold', 11.5);
        color(COLORS.ink);
        cellText(hoursCol, fmtHours(total), y + 19.5);
        drawGrid(top, y, rowLines);
        draw(COLORS.rule);
        doc.setLineWidth(0.9);
        doc.rect(M, y, CONTENT_W, TOTAL_H, 'S');
        doc.line(hoursCol.x, y, hoursCol.x, y + TOTAL_H);
        y += TOTAL_H;
      } else {
        drawGrid(top, y, rowLines);
      }

      // Signature block: keep it with the table, or move it to its own page.
      let sigY = y + 40;
      if (sigY + SIG_H > BOTTOM + 20) {
        doc.addPage();
        sigY = drawCardHeader(ci, state.cards.length, range, true) + 10;
      }
      drawSignature(sigY, signDate);
    });

    // Footer on every page
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      draw(COLORS.line);
      doc.setLineWidth(0.6);
      doc.line(M, PAGE_H - 44, PAGE_W - M, PAGE_H - 44);
      font('normal', 8);
      color(COLORS.faint);
      doc.text(fitText(doc, `${name}${company ? ` - ${company}` : ''}`, CONTENT_W - 90), M, PAGE_H - 30);
      doc.text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - 30, { align: 'right' });
    }

    return doc;
  }

  function pdfFilename() {
    const base = pdfSafe(nameInput.value).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Time';
    const all = state.cards.flatMap((c) => c.days.map((d) => d.date)).filter((d) => parseISO(d)).sort();
    const last = all.length ? fmtUS(all[all.length - 1]).replace(/\//g, '') : '';
    const kind = state.cards.length > 1 ? 'Time_Cards' : 'Time_Card';
    return `${base}_${kind}${last ? `_${last}` : ''}.pdf`;
  }

  function createPdf(action) {
    const first = validateAll();
    if (first) {
      const n = countProblems();
      toast(n > 1 ? `Please fix the ${n} highlighted items` : 'Please fix the highlighted item', true);
      first.focus({ preventScroll: true });
      first.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      toast('The PDF engine is still loading. Try again in a moment.', true);
      return;
    }

    let doc;
    try {
      doc = buildPdf();
    } catch (err) {
      console.error(err);
      toast('Something went wrong creating the PDF. Please try again.', true);
      return;
    }
    const filename = pdfFilename();

    if (action === 'download') {
      doc.save(filename);
      toast(`Downloaded ${filename}`);
    } else if (action === 'preview') {
      const url = URL.createObjectURL(doc.output('blob'));
      const win = window.open(url, '_blank');
      if (!win) toast('Your browser blocked the preview. Use Download PDF instead.', true);
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } else if (action === 'share') {
      const file = new File([doc.output('blob')], filename, { type: 'application/pdf' });
      navigator.share({ files: [file], title: filename.replace(/\.pdf$/, '').replace(/_/g, ' ') })
        .catch((err) => {
          if (err && err.name !== 'AbortError') toast('Sharing did not work here. Use Download PDF instead.', true);
        });
    }
  }

  // ---------- Toast ----------

  let toastTimer = 0;
  function toast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.classList.toggle('is-error', isError);
    toastEl.hidden = false;
    // restart the entry animation
    toastEl.style.animation = 'none';
    void toastEl.offsetWidth;
    toastEl.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, isError ? 4200 : 2800);
  }

  // ---------- Share support ----------

  function detectShare() {
    try {
      if (!navigator.share || !navigator.canShare) return false;
      const probe = new File(['%PDF-1.4'], 'probe.pdf', { type: 'application/pdf' });
      return navigator.canShare({ files: [probe] });
    } catch {
      return false;
    }
  }
  // Show Share only on touch devices, where it opens the phone's share sheet.
  shareBtn.hidden = !(detectShare() && window.matchMedia('(pointer: coarse)').matches);

  // ---------- Offline support ----------

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode is optional */ });
    });
  }

  // ---------- Start ----------

  loadDetails();
  updateNameUI();
  render();
})();
