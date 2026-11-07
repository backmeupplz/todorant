(function () {
  'use strict';
  var KEY = 'todorant-eisenhower-v1';
  var BOXES = [
    { id: 'do', title: 'Do first', sub: 'Urgent and important' },
    { id: 'schedule', title: 'Schedule', sub: 'Important, not urgent' },
    { id: 'delegate', title: 'Delegate', sub: 'Urgent, not important' },
    { id: 'drop', title: 'Drop', sub: 'Neither' }
  ];
  var EFFORT = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
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
      if (!mine.length) list.appendChild(el('li', 'empty', 'Nothing here yet.'));
      mine.forEach(function (t) {
        var li = el('li', 'task');
        var label = el('span', 'task-text', t.text);
        li.appendChild(label);
        li.appendChild(el('span', 'effort effort-' + t.effort, EFFORT[t.effort]));
        var move = el('select', 'move');
        move.setAttribute('aria-label', 'Move "' + t.text + '" to another box');
        var first = el('option', null, 'Move to…');
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
        rm.setAttribute('aria-label', 'Remove "' + t.text + '"');
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
      out.appendChild(el('strong', null, 'Do this one first: '));
      out.appendChild(document.createTextNode(f.text));
      out.appendChild(el('span', 'hint', ' It is urgent, important and the hardest one in the first box, so it is your frog.'));
    } else if (tasks.length) {
      out.textContent = 'Nothing is urgent and important right now. Pick the most important task from "Schedule" and give it a date.';
    } else {
      out.textContent = 'Add a few tasks and sort them into the boxes. The one to do first shows up here.';
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
      lines.push(b.title + ' (' + b.sub.toLowerCase() + ')');
      if (!mine.length) lines.push('  -');
      mine.forEach(function (t) { lines.push('  - ' + t.text); });
    });
    var s = lines.join('\n');
    var done = function () { $('status').textContent = 'Copied as text.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(done, function () { $('status').textContent = 'Copying is blocked in this browser.'; });
    } else { $('status').textContent = 'Copying is not supported in this browser.'; }
  });

  $('clear').addEventListener('click', function () {
    if (!tasks.length) return;
    if (window.confirm('Remove all tasks from the matrix?')) {
      tasks = []; save(); render();
      $('status').textContent = 'Cleared.';
    }
  });

  render();
})();
