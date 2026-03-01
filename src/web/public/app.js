// ── DOM Elements ──

// Sidebar
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const figmaTokenInput = document.getElementById('figma-token');
const tokenToggle = document.getElementById('token-toggle');
const saveTokenBtn = document.getElementById('save-token-btn');
const tokenStatus = document.getElementById('token-status');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// Left panel
const figmaUrlInput = document.getElementById('figma-url');
const convertBtn = document.getElementById('convert-btn');
const btnSpinner = document.getElementById('btn-spinner');
const sendIcon = document.getElementById('send-icon');
const panelBody = document.getElementById('panel-body');
const emptyState = document.getElementById('empty-state');
const progressList = document.getElementById('progress-list');
const errorBanner = document.getElementById('error-banner');

// Right panel
const modePreviewBtn = document.getElementById('mode-preview');
const modeCodeBtn = document.getElementById('mode-code');
const viewPreview = document.getElementById('view-preview');
const viewCode = document.getElementById('view-code');
const previewEmpty = document.getElementById('preview-empty');
const previewFrame = document.getElementById('preview-frame');
const downloadBtn = document.getElementById('download-btn');
const tabsHeader = document.getElementById('tabs-header');
const tabsContent = document.getElementById('tabs-content');
const codeFilename = document.getElementById('code-filename');
const codeCopyBtn = document.getElementById('code-copy-btn');
const monacoContainer = document.getElementById('monaco-editor-container');

// Resize
const resizeHandle = document.getElementById('resize-handle');
const panelLeft = document.getElementById('panel-left');

// ── State ──
let currentSessionId = null;
let currentFrameworkOutputs = {};
let currentComponentName = '';
let monacoEditor = null;
let monacoReady = false;
let tabsData = [];
let currentTabKey = null;

// ── LocalStorage ──
const STORAGE_KEY = 'figma-to-code-token';

function loadSavedToken() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    figmaTokenInput.value = saved;
    tokenStatus.textContent = 'Token saved';
    tokenStatus.className = 'token-status saved';
  }
}

function saveToken(token) {
  localStorage.setItem(STORAGE_KEY, token);
}

// ── Framework Extensions Map ──
const FRAMEWORK_EXT = {
  react: '.jsx',
  vue: '.vue',
  svelte: '.svelte',
  angular: '.ts',
  solid: '.tsx',
};

// ── Sidebar Toggle ──
sidebarToggle.addEventListener('click', () => {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('visible');
  } else {
    sidebar.classList.toggle('collapsed');
  }
});

sidebarOverlay.addEventListener('click', () => {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('visible');
});

// ── Token Toggle Visibility ──
tokenToggle.addEventListener('click', () => {
  const isPassword = figmaTokenInput.type === 'password';
  figmaTokenInput.type = isPassword ? 'text' : 'password';
});

// ── Save Token Button ──
saveTokenBtn.addEventListener('click', () => {
  const token = figmaTokenInput.value.trim();
  if (token) {
    saveToken(token);
    tokenStatus.textContent = 'Token saved';
    tokenStatus.className = 'token-status saved';
  }
});

// ── Convert Button ──
convertBtn.addEventListener('click', () => {
  startConversion();
});

// Also allow Enter in URL input
figmaUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    startConversion();
  }
});

function getSelectedFrameworks() {
  const checkboxes = document.querySelectorAll('input[name="framework"]:checked');
  return Array.from(checkboxes).map((cb) => cb.value);
}

function startConversion() {
  const figmaUrl = figmaUrlInput.value.trim();
  const figmaToken = figmaTokenInput.value.trim();
  const frameworks = getSelectedFrameworks();

  if (!figmaUrl) {
    figmaUrlInput.focus();
    return;
  }
  if (!figmaToken) {
    // Focus the sidebar token input
    if (sidebar.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
    }
    figmaTokenInput.focus();
    showError('Please enter your Figma Access Token in the sidebar.');
    return;
  }
  if (frameworks.length === 0) {
    showError('Please select at least one framework.');
    return;
  }

  // Save token
  saveToken(figmaToken);

  // Reset UI
  setLoading(true);
  hideError();
  setStatus('converting', 'Converting...');
  showProgress();
  clearProgress();

  // Hide previous results in right panel
  previewEmpty.style.display = 'flex';
  previewFrame.style.display = 'none';
  previewFrame.src = 'about:blank';
  downloadBtn.style.display = 'none';
  tabsHeader.innerHTML = '';

  // Start SSE request
  const body = JSON.stringify({ figmaUrl, figmaToken, frameworks });

  fetch('/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).then((response) => {
    if (!response.ok) {
      return response.json().then((data) => {
        throw new Error(data.error || `Server error: ${response.status}`);
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    function readStream() {
      reader.read().then(({ done, value }) => {
        if (done) {
          setLoading(false);
          return;
        }

        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const eventStr of events) {
          if (!eventStr.trim()) continue;
          parseSSEEvent(eventStr);
        }

        readStream();
      }).catch((err) => {
        setLoading(false);
        setStatus('error', 'Connection lost');
        showError(`Connection lost: ${err.message}`);
      });
    }

    readStream();
  }).catch((err) => {
    setLoading(false);
    setStatus('error', 'Error occurred');
    showError(err.message);
  });
}

function parseSSEEvent(eventStr) {
  const lines = eventStr.split('\n');
  let eventType = '';
  let eventData = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7);
    } else if (line.startsWith('data: ')) {
      eventData = line.slice(6);
    }
  }

  if (!eventType || !eventData) return;

  let data;
  try {
    data = JSON.parse(eventData);
  } catch {
    return;
  }

  switch (eventType) {
    case 'step':
      addProgressStep(data.message);
      setStatus('converting', data.message);
      break;
    case 'attempt':
      if (data.error) {
        markLastStepWarning(data.error);
      }
      break;
    case 'complete':
      handleComplete(data);
      break;
    case 'error':
      setLoading(false);
      markLastStepError();
      setStatus('error', 'Error occurred');
      showError(data.message);
      break;
  }
}

// ── Status ──
function setStatus(state, text) {
  statusDot.className = 'status-dot ' + state;
  statusText.textContent = text;
}

// ── Progress ──
function showProgress() {
  emptyState.style.display = 'none';
  progressList.classList.add('visible');
}

function clearProgress() {
  progressList.innerHTML = '';
}

function addProgressStep(message) {
  // Mark previous active step as done
  const activeItem = progressList.querySelector('.progress-icon--active');
  if (activeItem) {
    activeItem.classList.remove('progress-icon--active');
    activeItem.classList.add('progress-icon--done');
    activeItem.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  const li = document.createElement('li');
  li.className = 'progress-item';
  li.innerHTML = `
    <span class="progress-icon progress-icon--active"><span class="dot"></span></span>
    <span>${escapeHtml(message)}</span>
  `;
  progressList.appendChild(li);
  panelBody.scrollTop = panelBody.scrollHeight;
}

function markLastStepWarning(error) {
  const lastItem = progressList.lastElementChild;
  if (!lastItem) return;
  const span = lastItem.querySelector('span:last-child');
  if (span) {
    span.innerHTML += `<br><span style="color: var(--orange); font-size: 12px;">${escapeHtml(error)}</span>`;
  }
}

function markLastStepError() {
  const activeItem = progressList.querySelector('.progress-icon--active');
  if (activeItem) {
    activeItem.classList.remove('progress-icon--active');
    activeItem.classList.add('progress-icon--error');
    activeItem.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
}

// ── Complete ──
function handleComplete(data) {
  setLoading(false);
  setStatus('done', 'Conversion complete');

  // Mark last step done
  const activeItem = progressList.querySelector('.progress-icon--active');
  if (activeItem) {
    activeItem.classList.remove('progress-icon--active');
    activeItem.classList.add('progress-icon--done');
    activeItem.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // Add completion step
  const li = document.createElement('li');
  li.className = 'progress-item';
  li.innerHTML = `
    <span class="progress-icon progress-icon--done"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    <span style="color: var(--success); font-weight: 500;">Done! Generated ${escapeHtml(data.componentName)}</span>
  `;
  progressList.appendChild(li);
  panelBody.scrollTop = panelBody.scrollHeight;

  // Store state
  currentSessionId = data.sessionId;
  currentFrameworkOutputs = data.frameworkOutputs || {};
  currentComponentName = data.componentName;

  // Build code tabs
  buildTabs(data);

  // Show download button
  downloadBtn.style.display = 'inline-flex';

  // Auto-load preview
  previewEmpty.style.display = 'none';
  previewFrame.style.display = 'block';
  previewFrame.src = `/api/preview/${currentSessionId}`;
}

// ── Monaco Editor ──
const MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min';

function getMonacoLanguage(ext) {
  if (ext.endsWith('.tsx') || ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.jsx') || ext.endsWith('.js')) return 'javascript';
  if (ext.endsWith('.vue') || ext.endsWith('.svelte')) return 'html';
  return 'plaintext';
}

function initMonaco(callback) {
  if (monacoReady && monacoEditor) {
    callback?.();
    return;
  }
  if (typeof require === 'undefined') {
    console.error('Monaco loader not loaded');
    callback?.();
    return;
  }
  require.config({
    paths: { vs: `${MONACO_CDN}/vs` },
    'vs/nls': { availableLanguages: {} },
  });
  window.MonacoEnvironment = {
    getWorkerUrl: function (workerId, label) {
      return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        self.MonacoEnvironment = { baseUrl: "${MONACO_CDN}/" };
        importScripts("${MONACO_CDN}/vs/base/worker/workerMain.js");
      `)}`;
    },
  };
  require(['vs/editor/editor.main'], function () {
    monacoEditor = monaco.editor.create(monacoContainer, {
      value: '',
      language: 'typescript',
      readOnly: true,
      theme: 'vs-dark',
      minimap: { enabled: false },
      fontSize: 12,
      fontFamily: "JetBrains Mono, ui-monospace, Menlo, 'Courier New', monospace",
      scrollBeyondLastLine: false,
      padding: { top: 12 },
    });
    monacoReady = true;
    window.addEventListener('resize', layoutMonaco);
    callback?.();
  });
}

function layoutMonaco() {
  if (monacoEditor && monacoContainer) {
    monacoEditor.layout({
      width: monacoContainer.offsetWidth,
      height: monacoContainer.offsetHeight,
    });
  }
}

// ── Mode Toggle (Preview / Code) ──
modePreviewBtn.addEventListener('click', () => switchMode('preview'));
modeCodeBtn.addEventListener('click', () => switchMode('code'));

function switchMode(mode) {
  modePreviewBtn.classList.toggle('active', mode === 'preview');
  modeCodeBtn.classList.toggle('active', mode === 'code');
  viewPreview.style.display = mode === 'preview' ? 'flex' : 'none';
  viewCode.style.display = mode === 'code' ? 'flex' : 'none';
  if (mode === 'code') {
    requestAnimationFrame(layoutMonaco);
  }
}

// ── Build Tabs ──
function buildTabs(data) {
  tabsHeader.innerHTML = '';

  const frameworks = data.frameworks || [];

  tabsData = [
    { key: 'mitosis', label: 'Mitosis', code: data.mitosisSource || '', ext: '.lite.tsx' },
    ...frameworks.map((fw) => ({
      key: fw,
      label: fw.charAt(0).toUpperCase() + fw.slice(1),
      code: currentFrameworkOutputs[fw] || '',
      ext: FRAMEWORK_EXT[fw] || '.tsx',
    })),
  ];

  tabsData.forEach((tab, idx) => {
    const btn = document.createElement('button');
    btn.className = `tab-btn${idx === 0 ? ' active' : ''}`;
    btn.textContent = tab.label;
    btn.dataset.tab = tab.key;
    btn.addEventListener('click', () => switchTab(tab.key));
    tabsHeader.appendChild(btn);
  });

  const firstKey = tabsData[0]?.key;
  currentTabKey = firstKey;

  initMonaco(() => {
    if (firstKey) switchTab(firstKey);
    layoutMonaco();
  });
}

function switchTab(key) {
  currentTabKey = key;
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === key);
  });

  const tab = tabsData.find((t) => t.key === key);
  if (!tab) return;

  codeFilename.textContent = currentComponentName + tab.ext;

  if (monacoEditor && typeof monaco !== 'undefined') {
    monacoEditor.setValue(tab.code || '');
    monaco.editor.setModelLanguage(monacoEditor.getModel(), getMonacoLanguage(tab.ext));
  }

  layoutMonaco();
}

// ── Copy ──
codeCopyBtn.addEventListener('click', () => {
  const tab = tabsData.find((t) => t.key === currentTabKey);
  const code = tab?.code || (monacoEditor ? monacoEditor.getValue() : '');
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => {
    codeCopyBtn.textContent = 'Copied!';
    codeCopyBtn.classList.add('copied');
    setTimeout(() => {
      codeCopyBtn.textContent = 'Copy';
      codeCopyBtn.classList.remove('copied');
    }, 2000);
  });
});

// ── Download ──
downloadBtn.addEventListener('click', () => {
  if (!currentSessionId) return;
  window.location.href = `/api/download/${currentSessionId}`;
});

// ── Error ──
function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.add('visible');
}

function hideError() {
  errorBanner.classList.remove('visible');
}

// ── Loading ──
function setLoading(loading) {
  convertBtn.disabled = loading;
  btnSpinner.style.display = loading ? 'inline-block' : 'none';
  sendIcon.style.display = loading ? 'none' : 'block';
}

// ── Resize Handle ──
let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizeHandle.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const mainEl = document.querySelector('.main');
  const mainRect = mainEl.getBoundingClientRect();
  const newWidth = e.clientX - mainRect.left;
  const percent = (newWidth / mainRect.width) * 100;
  if (percent > 20 && percent < 65) {
    panelLeft.style.width = percent + '%';
  }
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizeHandle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// ── Utilities ──
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Init ──
loadSavedToken();
