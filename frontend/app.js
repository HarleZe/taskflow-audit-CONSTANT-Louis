// Logique métier TaskFlow (CRUD tasks via API)
// Volontairement simple — l'objectif du cours est l'instrumentation, pas la logique app.

const API = 'http://localhost:3000';

const $tasks = document.getElementById('tasks');
const $form = document.getElementById('add-form');
const $input = document.getElementById('task-input');

async function fetchTasks() {
  const res = await fetch(`${API}/api/tasks`);
  const tasks = await res.json();
  render(tasks);
}

function render(tasks) {
  $tasks.innerHTML = '';
  for (const t of tasks) {
    const li = document.createElement('li');
    if (t.done) li.classList.add('done');
    li.innerHTML = `
      <input type="checkbox" ${t.done ? 'checked' : ''} data-id="${t.id}" data-track="task_toggle" />
      <span>${escapeHtml(t.title)}</span>
      <button data-id="${t.id}" data-track="task_delete">×</button>
    `;
    $tasks.appendChild(li);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $input.value.trim();
  if (!title) return;
  await fetch(`${API}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  $input.value = '';
  fetchTasks();
});

$tasks.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.matches('input[type=checkbox]')) {
    await fetch(`${API}/api/tasks/${t.dataset.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: t.checked }),
    });
    fetchTasks();
  } else if (t.matches('button')) {
    await fetch(`${API}/api/tasks/${t.dataset.id}`, { method: 'DELETE' });
    fetchTasks();
  }
});

fetchTasks();
