const statusEl = document.getElementById('status');
const findBtn = document.getElementById('find');

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  const { epcApiKey } = await chrome.storage.local.get('epcApiKey');
  const tab = await activeTab();
  const onRightmove = tab && /^https:\/\/www\.rightmove\.co\.uk\/(properties|property-)/.test(tab.url || '');

  if (!epcApiKey) {
    statusEl.className = 'status warn';
    statusEl.textContent = 'No EPC API key yet — add your free key in Options to enable lookups.';
  } else if (!onRightmove) {
    statusEl.className = 'status warn';
    statusEl.textContent = 'Open a Rightmove property page to use Pinpoint.';
  } else {
    statusEl.className = 'status ok';
    statusEl.textContent = 'Ready — API key set and you’re on a Rightmove listing.';
  }
  findBtn.disabled = !onRightmove;
  findBtn.style.opacity = onRightmove ? '1' : '0.55';
}

findBtn.onclick = async () => {
  const tab = await activeTab();
  chrome.tabs.sendMessage(tab.id, { type: 'triggerLookup' }, () => {
    if (chrome.runtime.lastError) {
      statusEl.className = 'status warn';
      statusEl.textContent = 'Reload the Rightmove page, then try again.';
      return;
    }
    window.close();
  });
};

document.getElementById('options').onclick = () => chrome.runtime.openOptionsPage();

init();
