(function () {
  'use strict';
  var KEY = 'todorant-eisenhower-v1';
  var T = {
    "js_box_do": "Zrób najpierw",
    "js_box_do_sub": "Pilne i ważne",
    "js_box_schedule": "Zaplanuj",
    "js_box_schedule_sub": "Ważne, niepilne",
    "js_box_delegate": "Deleguj",
    "js_box_delegate_sub": "Pilne, nieważne",
    "js_box_drop": "Odpuść",
    "js_box_drop_sub": "Ani jedno, ani drugie",
    "js_easy": "Łatwe",
    "js_medium": "Średnie",
    "js_hard": "Trudne",
    "js_empty": "Na razie nic tu nie ma.",
    "js_move_aria": "Przenieś „{task}” do innego pola",
    "js_move_to": "Przenieś do…",
    "js_remove_aria": "Usuń „{task}”",
    "js_frog_lead": "Zrób to najpierw: ",
    "js_frog_hint": " To zadanie jest pilne, ważne i najtrudniejsze w pierwszym polu, więc to Twoja żaba.",
    "js_none_urgent": "Na razie nic nie jest jednocześnie pilne i ważne. Wybierz z pola „Zaplanuj” najważniejsze zadanie i nadaj mu datę.",
    "js_add_hint": "Dodaj kilka zadań i rozmieść je w polach. Zadanie do zrobienia najpierw pojawi się tutaj.",
    "js_copy_box": "{title} ({sub})",
    "js_copied": "Skopiowano jako tekst.",
    "js_copy_blocked": "Kopiowanie jest zablokowane w tej przeglądarce.",
    "js_copy_unsupported": "Ta przeglądarka nie obsługuje kopiowania.",
    "js_confirm_clear": "Usunąć wszystkie zadania z macierzy?",
    "js_cleared": "Wyczyszczono."
  };
  var LANG = 'pl';
  var fill = function (s, v) { return s.replace(/\{(\w+)\}/g, function (m, k) { return v[k]; }); };
  var BOXES = [
    { id: 'do', title: T.js_box_do, sub: T.js_box_do_sub },
    { id: 'schedule', title: T.js_box_schedule, sub: T.js_box_schedule_sub },
    { id: 'delegate', title: T.js_box_delegate, sub: T.js_box_delegate_sub },
    { id: 'drop', title: T.js_box_drop, sub: T.js_box_drop_sub }
  ];
  var EFFORT = { 1: T.js_easy, 2: T.js_medium, 3: T.js_hard };
  var $ = function (id) { return document.getElementById(id); };
  var tasks = [];
  var nextId = 1;
  var tracked = false;

  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (Array.isArray(saved.tasks)) {
      tasks = saved.tasks.filter(function (t) {
        return t && typeof t.text === 'string' && BOXES.some(function (b) { return b.id === t.box; });
      });
      nextId = tasks.reduce(function (m, t) { return Math.max(m, t.id || 0); }, 0) + 1;
    }
  } catch (e) { tasks = []; }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ tasks: tasks })); } catch (e) { /* private mode */ }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function frog() {
    var best = null;
    tasks.forEach(function (t) {
      if (t.box !== 'do') return;
      if (!best || t.effort > best.effort) best = t;
    });
    return best;
  }

  function render() {
    var f = frog();
    BOXES.forEach(function (b) {
      var list = $('list-' + b.id);
      list.textContent = '';
      var mine = tasks.filter(function (t) { return t.box === b.id; });
      $('count-' + b.id).textContent = mine.length;
      if (!mine.length) list.appendChild(el('li', 'empty', T.js_empty));
      mine.forEach(function (t) {
        var li = el('li', 'task');
        var label = el('span', 'task-text', t.text);
        li.appendChild(label);
        li.appendChild(el('span', 'effort effort-' + t.effort, EFFORT[t.effort]));
        var move = el('select', 'move');
        move.setAttribute('aria-label', fill(T.js_move_aria, { task: t.text }));
        var first = el('option', null, T.js_move_to);
        first.value = '';
        move.appendChild(first);
        BOXES.forEach(function (o) {
          if (o.id === t.box) return;
          var op = el('option', null, o.title);
          op.value = o.id;
          move.appendChild(op);
        });
        move.addEventListener('change', function () {
          if (move.value) { t.box = move.value; save(); render(); }
        });
        li.appendChild(move);
        var rm = el('button', 'remove', '×');
        rm.type = 'button';
        rm.setAttribute('aria-label', fill(T.js_remove_aria, { task: t.text }));
        rm.addEventListener('click', function () {
          tasks = tasks.filter(function (x) { return x !== t; });
          save(); render();
        });
        li.appendChild(rm);
        list.appendChild(li);
      });
    });
    var out = $('frog');
    if (f) {
      out.textContent = '';
      out.appendChild(el('strong', null, T.js_frog_lead));
      out.appendChild(document.createTextNode(f.text));
      out.appendChild(el('span', 'hint', T.js_frog_hint));
    } else if (tasks.length) {
      out.textContent = T.js_none_urgent;
    } else {
      out.textContent = T.js_add_hint;
    }
  }

  $('add').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('text');
    var text = input.value.trim().slice(0, 200);
    if (!text) { input.focus(); return; }
    tasks.push({
      id: nextId++,
      text: text,
      box: $('box').value,
      effort: parseInt($('effort').value, 10) || 2
    });
    input.value = '';
    save(); render();
    input.focus();
    if (!tracked) {
      tracked = true;
      if (typeof window.lumen === 'function') window.lumen('tool-use');
    }
  });

  $('copy').addEventListener('click', function () {
    var lines = [];
    BOXES.forEach(function (b) {
      var mine = tasks.filter(function (t) { return t.box === b.id; });
      lines.push(fill(T.js_copy_box, { title: b.title, sub: b.sub.toLocaleLowerCase(LANG) }));
      if (!mine.length) lines.push('  -');
      mine.forEach(function (t) { lines.push('  - ' + t.text); });
    });
    var s = lines.join('\n');
    var done = function () { $('status').textContent = T.js_copied; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(done, function () { $('status').textContent = T.js_copy_blocked; });
    } else { $('status').textContent = T.js_copy_unsupported; }
  });

  $('clear').addEventListener('click', function () {
    if (!tasks.length) return;
    if (window.confirm(T.js_confirm_clear)) {
      tasks = []; save(); render();
      $('status').textContent = T.js_cleared;
    }
  });

  render();
})();
