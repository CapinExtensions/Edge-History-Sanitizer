
function send(msg) { return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve)); }
function toCSV(rows) { return rows.map(r => r.map(v => '"' + String(v).replace('"', '""') + '"').join(',')).join('\n'); }

async function refresh() {
  const state = await send({ type: 'getState' });

  // Rules
  const tbody = document.getElementById('rules-body');
  tbody.innerHTML = '';
  (state.rules || []).forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="mono">${r.pattern}</td>
      <td>${r.type}</td>
      <td><label class="switch"><input type="checkbox" ${r.enabled !== false ? 'checked' : ''} data-index="${i}" class="toggle"><span class="slider"></span></label></td>
      <td><button class="danger remove" data-index="${i}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });

  // Stats
  document.getElementById('deletedCount').textContent = state.counters?.deletedCount ?? 0;
  document.getElementById('last30Count').textContent = state.last30Count ?? 0;
  document.getElementById('lastReset').textContent = state.counters?.lastReset ?? '–';

  // Logs (all)
  const allLogs = [...(state.logs || [])].reverse();
  const lbody = document.getElementById('logs-body');
  lbody.innerHTML = '';
  allLogs.forEach(entry => {
    const tr = document.createElement('tr');
    const date = new Date(entry.ts);
    tr.innerHTML = `
      <td>${date.toLocaleString()}</td>
      <td class="mono">${entry.url}</td>
      <td>${entry.source}</td>
    `;
    lbody.appendChild(tr);
  });

  document.getElementById('exportCsv').onclick = () => {
    const header = ['ts','time_local','url','source'];
    const rows = [header, ...allLogs.map(e => [e.ts, new Date(e.ts).toLocaleString(), e.url, e.source])];
    const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'history-sanitizer-logs.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
}

// Add rule
const form = document.getElementById('add-form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pattern = document.getElementById('pattern').value.trim();
  const matchType = document.getElementById('matchType').value; // keyword|domain
  if (!pattern) return;
  await send({ type: 'addRule', pattern, matchType });
  form.reset();
  refresh();
});

// Toggle & remove
 document.getElementById('rules-table').addEventListener('change', async (e) => {
  if (e.target.classList.contains('toggle')) {
    const index = Number(e.target.getAttribute('data-index'));
    await send({ type: 'toggleRule', index });
    refresh();
  }
});

document.getElementById('rules-table').addEventListener('click', async (e) => {
  if (e.target.classList.contains('remove')) {
    const index = Number(e.target.getAttribute('data-index'));
    await send({ type: 'removeRule', index });
    refresh();
  }
});

// Stats buttons
 document.getElementById('resetCounter').addEventListener('click', async () => {
  await send({ type: 'resetCounter' });
  refresh();
});

// Logs buttons
 document.getElementById('clearLogs').addEventListener('click', async () => {
  await send({ type: 'clearLogs' });
  refresh();
});

refresh();
