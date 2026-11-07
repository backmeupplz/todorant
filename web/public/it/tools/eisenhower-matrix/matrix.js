(function () {
  'use strict';
  var KEY = 'todorant-eisenhower-v1';
  var T = {
    "js_box_do": "Fai subito",
    "js_box_do_sub": "Urgente e importante",
    "js_box_schedule": "Pianifica",
    "js_box_schedule_sub": "Importante, non urgente",
    "js_box_delegate": "Delega",
    "js_box_delegate_sub": "Urgente, non importante",
    "js_box_drop": "Elimina",
    "js_box_drop_sub": "Né l'uno né l'altro",
    "js_easy": "Facile",
    "js_medium": "Media",
    "js_hard": "Difficile",
    "js_empty": "Ancora niente qui.",
    "js_move_aria": "Sposta «{task}» in un altro riquadro",
    "js_move_to": "Sposta in…",
    "js_remove_aria": "Rimuovi «{task}»",
    "js_frog_lead": "Fai prima questa: ",
    "js_frog_hint": " È urgente, importante e la più difficile del primo riquadro, quindi è la tua rana.",
    "js_none_urgent": "Al momento niente è urgente e importante. Scegli l'attività più importante da «Pianifica» e dalle una data.",
    "js_add_hint": "Aggiungi qualche attività e ordinala nei riquadri. Quella da fare per prima compare qui.",
    "js_copy_box": "{title} ({sub})",
    "js_copied": "Copiato come testo.",
    "js_copy_blocked": "La copia è bloccata in questo browser.",
    "js_copy_unsupported": "La copia non è supportata in questo browser.",
    "js_confirm_clear": "Rimuovere tutte le attività dalla matrice?",
    "js_cleared": "Cancellato."
  };
  var LANG = 'it';
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
