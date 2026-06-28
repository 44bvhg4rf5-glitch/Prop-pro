/* DayTrack — personal daily tracker. All data stored locally in this browser. */
(() => {
  'use strict';

  const KEY = 'daytrack.v1';
  const DEFAULTS = {
    settings: { name: '', calGoal: 2000, sleepTarget: 8, waterTarget: 8, exerciseTarget: 30 },
    days: {},
  };
  const QUICK_FOODS = [
    ['Coffee', 5], ['Banana', 105], ['Apple', 95], ['Egg', 78], ['Toast', 90],
    ['Chicken breast', 165], ['Salad', 150], ['Sandwich', 350], ['Pasta bowl', 450],
    ['Rice (1 cup)', 205], ['Protein shake', 160], ['Yogurt', 120], ['Pizza slice', 285],
    ['Biscuit', 70], ['Beer', 150],
  ];

  // ── storage ──
  let state = load();
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && raw.settings && raw.days) return raw;
    } catch (_) {}
    return structuredClone(DEFAULTS);
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

  function emptyDay() {
    return { prod: 0, tasks: [], sleep: 0, water: 0, exercise: 0, mood: 0, foods: [] };
  }
  function dayKey(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function getDay(key) {
    if (!state.days[key]) state.days[key] = emptyDay();
    return state.days[key];
  }

  // ── current date being viewed ──
  let viewing = new Date();
  let curMeal = 'Breakfast';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ── score helpers ──
  function healthScore(d) {
    const s = state.settings;
    const c = (v, t) => Math.max(0, Math.min(100, t > 0 ? (v / t) * 100 : 0));
    const parts = [c(d.sleep, s.sleepTarget), c(d.water, s.waterTarget), c(d.exercise, s.exerciseTarget), (d.mood / 5) * 100];
    return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  }
  function calsEaten(d) { return d.foods.reduce((a, f) => a + (f.cal || 0), 0); }
  function dayScore(d) { return Math.round((d.prod + healthScore(d)) / 2); }

  // ── rendering ──
  function render() {
    const key = dayKey(viewing);
    const d = getDay(key);
    renderDateBar(key);

    // day score ring
    const ds = dayScore(d);
    $('#dayScore').textContent = ds;
    const circ = 2 * Math.PI * 52;
    $('#dayRing').style.strokeDashoffset = circ - (circ * ds) / 100;

    // productivity
    $('#prodSlider').value = d.prod;
    $('#prodBadge').textContent = d.prod + '%';
    renderTasks(d);

    // health
    $('#sleepVal').textContent = d.sleep;
    $('#waterVal').textContent = d.water;
    $('#exerciseVal').textContent = d.exercise;
    $('#healthBadge').textContent = healthScore(d) + '%';
    $$('#moodRow button').forEach((b) => b.classList.toggle('active', +b.dataset.mood === d.mood));

    // food summary (today card)
    const eaten = calsEaten(d), goal = state.settings.calGoal;
    $('#calBadge').textContent = eaten + ' kcal';
    setCalBar('#calFill', eaten, goal);
    $('#calEaten').textContent = eaten + ' eaten';
    $('#calRemain').textContent = (eaten <= goal ? (goal - eaten) + ' left' : (eaten - goal) + ' over');

    renderFood(d);
  }

  function renderDateBar(key) {
    const today = dayKey(new Date());
    const y = new Date(); y.setDate(y.getDate() - 1);
    const opts = { weekday: 'long', day: 'numeric', month: 'long' };
    $('#dateLabel').textContent = key === today ? 'Today' : (key === dayKey(y) ? 'Yesterday' : viewing.toLocaleDateString(undefined, { weekday: 'long' }));
    $('#dateSub').textContent = viewing.toLocaleDateString(undefined, opts);
    $('#nextDay').style.visibility = key === today ? 'hidden' : 'visible';
  }

  function renderTasks(d) {
    const ul = $('#taskList'); ul.innerHTML = '';
    d.tasks.forEach((t, i) => {
      const li = document.createElement('li');
      if (t.done) li.classList.add('done');
      li.innerHTML = `<span class="chk">${t.done ? '✓' : ''}</span><span class="txt"></span><button class="del">×</button>`;
      li.querySelector('.txt').textContent = t.text;
      li.querySelector('.chk').onclick = () => { t.done = !t.done; save(); render(); };
      li.querySelector('.del').onclick = () => { d.tasks.splice(i, 1); save(); render(); };
      ul.appendChild(li);
    });
  }

  function setCalBar(sel, eaten, goal) {
    const el = $(sel); if (!el) return;
    const pct = goal > 0 ? Math.min(100, (eaten / goal) * 100) : 0;
    el.style.width = pct + '%';
    el.classList.toggle('over', eaten > goal);
  }

  function renderFood(d) {
    const eaten = calsEaten(d), goal = state.settings.calGoal;
    $('#foodCalBadge').textContent = `${eaten} / ${goal}`;
    setCalBar('#foodCalFill', eaten, goal);

    const wrap = $('#mealsList'); wrap.innerHTML = '';
    const meals = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
    let any = false;
    meals.forEach((m) => {
      const items = d.foods.map((f, i) => ({ f, i })).filter((x) => x.f.meal === m);
      if (!items.length) return;
      any = true;
      const g = document.createElement('div'); g.className = 'mealgroup';
      const sub = items.reduce((a, x) => a + x.f.cal, 0);
      g.innerHTML = `<h4>${m} · ${sub} kcal</h4>`;
      items.forEach(({ f, i }) => {
        const row = document.createElement('div'); row.className = 'fooditem';
        row.innerHTML = `<span class="fname"></span><span class="fcal">${f.cal}</span><button class="del">×</button>`;
        row.querySelector('.fname').textContent = f.name;
        row.querySelector('.del').onclick = () => { d.foods.splice(i, 1); save(); render(); };
        g.appendChild(row);
      });
      wrap.appendChild(g);
    });
    if (!any) wrap.innerHTML = '<div class="empty">Nothing logged yet today.</div>';

    // quick-add chips
    const q = $('#quickAdd');
    if (!q.dataset.built) {
      QUICK_FOODS.forEach(([name, cal]) => {
        const b = document.createElement('button');
        b.textContent = `${name} · ${cal}`;
        b.onclick = () => addFood(name, cal);
        q.appendChild(b);
      });
      q.dataset.built = '1';
    }
  }

  function addFood(name, cal) {
    name = (name || '').trim();
    cal = Math.round(+cal);
    if (!name || !cal || cal < 0) { toast('Enter a food and calories'); return; }
    const d = getDay(dayKey(viewing));
    d.foods.push({ name, cal, meal: curMeal });
    save(); render();
    $('#foodName').value = ''; $('#foodCals').value = '';
    toast(`Added ${name}`);
  }

  // ── trends ──
  function renderTrends() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(); dt.setDate(dt.getDate() - i);
      const k = dayKey(dt);
      const d = state.days[k] || emptyDay();
      days.push({ dt, prod: d.prod, health: healthScore(d), cals: calsEaten(d) });
    }
    const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    $('#avgProd').textContent = avg(days.map((x) => x.prod)) + '%';
    $('#avgHealth').textContent = avg(days.map((x) => x.health)) + '%';
    $('#avgCals').textContent = avg(days.map((x) => x.cals));

    chart('#chartProd', days, (x) => x.prod, 100);
    chart('#chartHealth', days, (x) => x.health, 100);
    const maxCal = Math.max(state.settings.calGoal, ...days.map((x) => x.cals), 1);
    chart('#chartCals', days, (x) => x.cals, maxCal);
  }
  function chart(sel, days, val, max) {
    const el = $(sel); el.innerHTML = '';
    const todayK = dayKey(new Date());
    days.forEach((x) => {
      const h = Math.round((val(x) / max) * 100);
      const bar = document.createElement('div'); bar.className = 'bar';
      if (dayKey(x.dt) === todayK) bar.classList.add('today');
      bar.innerHTML = `<div class="col" style="height:${Math.max(2, h)}%"></div><div class="lab">${x.dt.toLocaleDateString(undefined, { weekday: 'narrow' })}</div>`;
      el.appendChild(bar);
    });
  }

  // ── settings ──
  function fillSettings() {
    const s = state.settings;
    $('#setName').value = s.name;
    $('#setCalGoal').value = s.calGoal;
    $('#setSleep').value = s.sleepTarget;
    $('#setWater').value = s.waterTarget;
    $('#setExercise').value = s.exerciseTarget;
  }

  // ── navigation ──
  function showView(name) {
    $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    if (name === 'trends') renderTrends();
    if (name === 'settings') fillSettings();
    window.scrollTo(0, 0);
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 1600);
  }

  // ── events ──
  function bind() {
    $('#prevDay').onclick = () => { viewing.setDate(viewing.getDate() - 1); render(); };
    $('#nextDay').onclick = () => {
      const t = new Date();
      if (dayKey(viewing) === dayKey(t)) return;
      viewing.setDate(viewing.getDate() + 1); render();
    };

    $('#prodSlider').oninput = (e) => {
      const d = getDay(dayKey(viewing)); d.prod = +e.target.value;
      $('#prodBadge').textContent = d.prod + '%'; save();
      const ds = dayScore(d); $('#dayScore').textContent = ds;
      const circ = 2 * Math.PI * 52; $('#dayRing').style.strokeDashoffset = circ - (circ * ds) / 100;
    };

    $('#addTask').onclick = addTaskFromInput;
    $('#taskInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTaskFromInput(); });
    function addTaskFromInput() {
      const v = $('#taskInput').value.trim();
      if (!v) return;
      getDay(dayKey(viewing)).tasks.push({ text: v, done: false });
      $('#taskInput').value = ''; save(); render();
    }

    $$('.steprow button').forEach((b) => {
      b.onclick = () => {
        const d = getDay(dayKey(viewing));
        const field = b.dataset.h;
        d[field] = Math.max(0, Math.round((d[field] + parseFloat(b.dataset.d)) * 10) / 10);
        save(); render();
      };
    });
    $$('#moodRow button').forEach((b) => {
      b.onclick = () => { getDay(dayKey(viewing)).mood = +b.dataset.mood; save(); render(); };
    });

    $('#foodCard').onclick = () => showView('food');
    $$('.tab').forEach((t) => (t.onclick = () => showView(t.dataset.view)));

    $$('#mealPick button').forEach((b) => {
      b.onclick = () => { curMeal = b.dataset.meal; $$('#mealPick button').forEach((x) => x.classList.toggle('active', x === b)); };
    });
    $('#addFood').onclick = () => addFood($('#foodName').value, $('#foodCals').value);
    $('#foodCals').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFood($('#foodName').value, $('#foodCals').value); });

    $('#saveSettings').onclick = () => {
      const s = state.settings;
      s.name = $('#setName').value.trim();
      s.calGoal = clampNum($('#setCalGoal').value, 500, 9000, 2000);
      s.sleepTarget = clampNum($('#setSleep').value, 1, 16, 8);
      s.waterTarget = clampNum($('#setWater').value, 1, 30, 8);
      s.exerciseTarget = clampNum($('#setExercise').value, 1, 600, 30);
      save(); render(); toast('Settings saved');
    };

    $('#exportData').onclick = exportData;
    $('#importData').onclick = () => $('#importFile').click();
    $('#importFile').onchange = importData;
    $('#clearData').onclick = () => {
      if (confirm('Erase ALL DayTrack data on this device? This cannot be undone.')) {
        state = structuredClone(DEFAULTS); save(); render(); showView('today'); toast('All data erased');
      }
    };
  }

  function clampNum(v, lo, hi, fallback) {
    const n = parseFloat(v); if (isNaN(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daytrack-backup-${dayKey(new Date())}.json`;
    a.click(); URL.revokeObjectURL(a.href); toast('Backup downloaded');
  }
  function importData(e) {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data.settings || !data.days) throw new Error('bad');
        state = data; save(); render(); toast('Backup restored');
      } catch (_) { toast('Could not read that file'); }
    };
    r.readAsText(file); e.target.value = '';
  }

  // ── boot ──
  bind();
  render();
  showView('today');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
