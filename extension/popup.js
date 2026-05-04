document.addEventListener('DOMContentLoaded', () => {
  loadSubjects();
});

async function loadSubjects() {
  const { data: subjects, error } = await supabase
    .from('subjects')
    .select('*');

  const container = document.getElementById('subjects');
  container.innerHTML = '';

  if (error) {
    container.innerHTML = "Error loading 😭";
    console.error(error);
    return;
  }

  if (!subjects || subjects.length === 0) {
    container.innerHTML = "No subjects yet 😭";
    return;
  }

  subjects.forEach((sub) => {
    const percent = sub.total
      ? Math.round((sub.present / sub.total) * 100)
      : 0;

    const div = document.createElement('div');
    div.className = 'subject';

    div.innerHTML = `
      <div class="subject-name">${sub.name} (${percent}%)</div>
      <div class="btns">
        <button class="present" data-id="${sub.id}" data-type="present">✔</button>
        <button class="absent" data-id="${sub.id}" data-type="absent">✖</button>
      </div>
    `;

    container.appendChild(div);
  });

  // attach click listeners
  document.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const type = btn.dataset.type;
      mark(id, type);
    });
  });
}

async function mark(id, type) {
  const { data: sub, error } = await supabase
    .from('subjects')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !sub) {
    console.error(error);
    return;
  }

  let updated = {};

  if (type === 'present') {
    updated.present = sub.present + 1;
    updated.total = sub.total + 1;
  } else {
    updated.total = sub.total + 1;
  }

  await supabase
    .from('subjects')
    .update(updated)
    .eq('id', id);

  loadSubjects();
}