function loadSubjects() {
  chrome.storage.local.get(['subjects'], (data) => {
    const subjects = data.subjects || [];
    const container = document.getElementById('subjects');
    container.innerHTML = '';

    subjects.forEach((subj, index) => {
      const div = document.createElement('div');

      div.innerHTML = `
        <p>${subj.name}</p>
        <button onclick="mark(${index}, 'present')">+</button>
        <button onclick="mark(${index}, 'absent')">-</button>
      `;

      container.appendChild(div);
    });
  });
}

function mark(index, type) {
  chrome.storage.local.get(['subjects'], (data) => {
    const subjects = data.subjects || [];

    if (type === 'present') subjects[index].present++;
    else subjects[index].total++;

    chrome.storage.local.set({ subjects }, loadSubjects);
  });
}

loadSubjects();