const CAT_LABEL = {
  todo: '代辦',
  expense: '花費',
  idea: '靈感',
  reminder: '提醒',
  learn: '學習筆記',
  diary: '日記',
  misc: '未分類',
};

const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

const uploadTokenMeta = document.querySelector('meta[name="upload-token"]')?.content ?? '';
const uploadToken = uploadTokenMeta === '__UPLOAD_TOKEN__' ? '' : uploadTokenMeta;

const dayNav = document.querySelector('#dayNav');
const dayLabel = document.querySelector('#dayLabel');
const weekdayLabel = document.querySelector('#weekdayLabel');
const prevButton = document.querySelector('#prevDay');
const nextButton = document.querySelector('#nextDay');
const todayButton = document.querySelector('#todayBtn');
const statsBox = document.querySelector('#stats');
const tabsBox = document.querySelector('#tabs');
const panel = document.querySelector('#panel');

const addEntryButton = document.querySelector('#addEntryBtn');
const addForm = document.querySelector('#addForm');
const addCatsBox = document.querySelector('#addCats');
const addTextInput = document.querySelector('#addText');
const addAmountInput = document.querySelector('#addAmount');
const addDueInput = document.querySelector('#addDue');
const addCancelButton = document.querySelector('#addCancel');

let addCategory = 'todo';

let notes = {};
let dates = [];
let dateIndex = 0;
let activeCategory = 'all';

function authHeaders(extra = {}) {
  return uploadToken ? { ...extra, 'X-Auth-Token': uploadToken } : extra;
}

function formatDate(iso) {
  const [, month, day] = iso.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

function weekdayOf(iso) {
  return WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

function todayIsoTaipei() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function currentEntries() {
  return notes[dates[dateIndex]]?.entries ?? [];
}

function showEmpty(message) {
  const box = document.createElement('div');
  box.className = 'empty';
  box.textContent = message;
  panel.replaceChildren(box);
}

function buildDeleteButton(entry) {
  const button = document.createElement('button');
  button.className = 'entry-delete';
  button.type = 'button';
  button.setAttribute('aria-label', '刪除這則記錄');
  button.textContent = '×';
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await mutate('delete', entry.id);
  });
  return button;
}

function buildEntry(entry) {
  const isTodo = entry.cat === 'todo';
  const row = document.createElement(isTodo ? 'label' : 'div');
  row.className = 'entry';
  row.style.setProperty('--dot', `var(--c-${entry.cat})`);

  if (isTodo) {
    row.classList.add('todo-row');
    if (entry.done) row.classList.add('done');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(entry.done);
    checkbox.addEventListener('change', () => mutate('toggle', entry.id));
    row.append(checkbox);
  } else {
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = entry.time;
    row.append(time);
  }

  const body = document.createElement('div');
  body.className = 'body';

  const text = document.createElement('p');
  text.textContent = entry.text;
  editableField(text, {
    rawValue: entry.text,
    parse: (value) => (value.trim() ? value.trim() : null),
    onSave: (value) => editEntry(entry.id, { text: value }),
  });
  body.append(text);

  if (isTodo && entry.due) {
    const due = document.createElement('span');
    due.className = 'due';
    due.textContent = entry.due;
    editableField(due, {
      rawValue: entry.due,
      parse: (value) => value.trim(),
      onSave: (value) => editEntry(entry.id, { due: value || null }),
    });
    body.append(due);
  } else if (activeCategory === 'all') {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = CAT_LABEL[entry.cat];
    body.append(tag);
  }

  row.append(body);

  if (entry.cat === 'expense' && typeof entry.amount === 'number') {
    row.classList.add('expense');
    const amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = `$${entry.amount.toLocaleString()}`;
    editableField(amount, {
      rawValue: entry.amount,
      inputType: 'number',
      parse: (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
      },
      onSave: (value) => editEntry(entry.id, { amount: value }),
    });
    row.append(amount);
  }

  row.append(buildDeleteButton(entry));
  return row;
}

function render() {
  if (dates.length === 0) {
    dayNav.hidden = true;
    statsBox.hidden = true;
    tabsBox.hidden = true;
    showEmpty('還沒有任何整理結果。第一次整理會在明天凌晨 3 點自動執行。');
    return;
  }

  dayNav.hidden = false;
  statsBox.hidden = false;
  tabsBox.hidden = false;

  const iso = dates[dateIndex];
  const entries = currentEntries();

  dayLabel.textContent = formatDate(iso);
  weekdayLabel.textContent = weekdayOf(iso);
  prevButton.disabled = dateIndex === 0;
  nextButton.disabled = dateIndex === dates.length - 1;
  todayButton.hidden = dateIndex === dates.length - 1;

  const spent = entries
    .filter((entry) => entry.cat === 'expense' && typeof entry.amount === 'number')
    .reduce((total, entry) => total + entry.amount, 0);

  document.querySelector('#statCount').textContent = entries.length;
  document.querySelector('#statTodo').textContent = entries.filter((e) => e.cat === 'todo' && !e.done).length;
  document.querySelector('#statMoney').textContent = `$${spent.toLocaleString()}`;

  renderTabs(entries);

  const visible = activeCategory === 'all'
    ? entries
    : entries.filter((entry) => entry.cat === activeCategory);

  if (visible.length === 0) {
    showEmpty(activeCategory === 'all' ? '這天沒有記錄' : `這天沒有「${CAT_LABEL[activeCategory]}」的記錄`);
    return;
  }

  const rows = visible.map(buildEntry);

  if (activeCategory === 'expense') {
    const total = document.createElement('div');
    total.className = 'expense-total';
    const key = document.createElement('span');
    key.className = 'k';
    key.textContent = '當日累計';
    const value = document.createElement('span');
    value.className = 'v';
    value.textContent = `$${spent.toLocaleString()}`;
    total.append(key, value);
    rows.unshift(total);
  }

  panel.replaceChildren(...rows);
}

function renderTabs(entries) {
  const definitions = [['all', '全部', 'var(--accent)']].concat(
    Object.entries(CAT_LABEL).map(([key, label]) => [key, label, `var(--c-${key})`]),
  );

  const tabs = definitions.map(([key, label, color]) => {
    const count = key === 'all' ? entries.length : entries.filter((entry) => entry.cat === key).length;

    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.type = 'button';
    tab.style.setProperty('--dot', color);
    tab.setAttribute('aria-selected', String(activeCategory === key));

    if (key !== 'all') {
      const dot = document.createElement('span');
      dot.className = 'dot';
      tab.append(dot);
    }

    tab.append(document.createTextNode(label));

    const badge = document.createElement('span');
    badge.className = 'count';
    badge.textContent = count;
    tab.append(badge);

    tab.addEventListener('click', () => {
      activeCategory = key;
      render();
    });

    return tab;
  });

  tabsBox.replaceChildren(...tabs);
}

async function editEntry(id, patch) {
  const date = dates[dateIndex];
  try {
    const response = await fetch('/api/notes/edit', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date, id, ...patch }),
    });
    if (!response.ok) return false;
    notes[date] = await response.json();
    render();
    return true;
  } catch {
    return false;
  }
}

// 點一下就把文字變成輸入框，Enter／失焦儲存，Esc 取消。
// parse 回傳 null 代表輸入無效，直接還原不送出。
function editableField(el, { rawValue, inputType = 'text', parse, onSave }) {
  el.classList.add('editable');
  el.title = '點一下編輯';
  el.addEventListener('click', () => {
    if (el.querySelector('input')) return;
    const original = el.textContent;
    const input = document.createElement('input');
    input.type = inputType;
    input.className = 'inline-input';
    input.value = rawValue ?? '';
    el.textContent = '';
    el.append(input);
    input.focus();
    input.select();

    let settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true;
      el.textContent = original;
    };
    const save = async () => {
      if (settled) return;
      const parsed = parse ? parse(input.value) : input.value.trim();
      if (parsed === null) { cancel(); return; }
      if (String(parsed) === String(rawValue ?? '')) { settled = true; el.textContent = original; return; }
      settled = true;
      const ok = await onSave(parsed);
      if (!ok) el.textContent = original;
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); save(); }
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', save);
  });
}

async function mutate(action, id) {
  const date = dates[dateIndex];
  try {
    const response = await fetch(`/api/notes/${action}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date, id }),
    });
    if (!response.ok) throw new Error('failed');
    notes[date] = await response.json();
    render();
  } catch {
    showEmpty('操作失敗，請重新整理頁面再試一次。');
  }
}

function renderAddCats() {
  const cats = Object.entries(CAT_LABEL).map(([key, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'add-cat';
    button.style.setProperty('--dot', `var(--c-${key})`);
    button.setAttribute('aria-pressed', String(addCategory === key));
    const dot = document.createElement('span');
    dot.className = 'dot';
    button.append(dot, document.createTextNode(label));
    button.addEventListener('click', () => {
      addCategory = key;
      updateAddFormFields();
      addCatsBox.querySelectorAll('.add-cat').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn === button));
      });
    });
    return button;
  });
  addCatsBox.replaceChildren(...cats);
}

function updateAddFormFields() {
  addAmountInput.hidden = addCategory !== 'expense';
  addDueInput.hidden = addCategory !== 'todo';
}

function openAddForm() {
  addForm.hidden = false;
  addEntryButton.hidden = true;
  addTextInput.focus();
}

function closeAddForm() {
  addForm.hidden = true;
  addEntryButton.hidden = false;
  addForm.reset();
  addCategory = 'todo';
  addCatsBox.querySelectorAll('.add-cat').forEach((btn, i) => {
    btn.setAttribute('aria-pressed', String(i === 0));
  });
  updateAddFormFields();
}

async function submitAddForm(event) {
  event.preventDefault();
  const text = addTextInput.value.trim();
  if (!text) return;

  const date = dates.length ? dates[dateIndex] : todayIsoTaipei();
  const payload = { date, cat: addCategory, text };
  if (addCategory === 'expense' && addAmountInput.value.trim()) {
    const amount = Number(addAmountInput.value);
    if (Number.isFinite(amount)) payload.amount = amount;
  }
  if (addCategory === 'todo' && addDueInput.value.trim()) {
    payload.due = addDueInput.value.trim();
  }

  try {
    const response = await fetch('/api/notes/add', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('failed');
    notes[date] = await response.json();
    if (!dates.includes(date)) {
      dates = [...dates, date].sort();
    }
    dateIndex = dates.indexOf(date);
    closeAddForm();
    render();
  } catch {
    addTextInput.setCustomValidity('新增失敗，請再試一次');
    addTextInput.reportValidity();
    addTextInput.setCustomValidity('');
  }
}

addEntryButton.addEventListener('click', openAddForm);
addCancelButton.addEventListener('click', closeAddForm);
addForm.addEventListener('submit', submitAddForm);
renderAddCats();
updateAddFormFields();

async function load() {
  try {
    const response = await fetch('/api/notes', { headers: authHeaders() });
    if (!response.ok) throw new Error('failed');
    notes = await response.json();
    dates = Object.keys(notes).sort();
    dateIndex = dates.length - 1;
    render();
  } catch {
    showEmpty('讀取失敗，請確認服務是否正常運作。');
  }
}

prevButton.addEventListener('click', () => {
  if (dateIndex > 0) { dateIndex -= 1; render(); }
});

nextButton.addEventListener('click', () => {
  if (dateIndex < dates.length - 1) { dateIndex += 1; render(); }
});

todayButton.addEventListener('click', () => {
  dateIndex = dates.length - 1;
  render();
});

load();
