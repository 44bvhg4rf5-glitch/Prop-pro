const keyInput = document.getElementById('key');
const savedEl = document.getElementById('saved');

chrome.storage.local.get('epcApiKey').then(({ epcApiKey }) => {
  if (epcApiKey) keyInput.value = epcApiKey;
});

document.getElementById('save').onclick = async () => {
  await chrome.storage.local.set({ epcApiKey: keyInput.value.trim() });
  savedEl.classList.add('show');
  setTimeout(() => savedEl.classList.remove('show'), 1800);
};

document.getElementById('toggle').onclick = () => {
  const isPw = keyInput.type === 'password';
  keyInput.type = isPw ? 'text' : 'password';
  document.getElementById('toggle').textContent = isPw ? 'Hide' : 'Show';
};
