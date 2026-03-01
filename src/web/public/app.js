// ── DOM Elements ──

// Theme
const themeToggle = document.getElementById('theme-toggle');
const THEME_KEY = 'figma-to-code-theme';

function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

function setTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem(THEME_KEY, theme);
  setMonacoTheme(theme);
}

function setMonacoTheme(appTheme) {
  if (typeof monaco === 'undefined' || !monacoEditor) return;
  const monacoTheme = appTheme === 'light' ? 'vs' : 'vs-dark';
  monaco.editor.setTheme(monacoTheme);
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = getTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
  });
}

// Apply saved theme on load
setTheme(getTheme());

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

// Hero
const mainHero = document.getElementById('main-hero');
const mainSplit = document.getElementById('main-split');
const heroFigmaUrlInput = document.getElementById('hero-figma-url');
const heroConvertBtn = document.getElementById('hero-convert-btn');
const heroSpinner = document.getElementById('hero-spinner');
const heroSendIcon = document.getElementById('hero-send-icon');
const heroError = document.getElementById('hero-error');
const heroForm = document.getElementById('hero-form');
const heroAttachBtn = document.getElementById('hero-attach-btn');
const heroFileUpload = document.getElementById('hero-file-upload');

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
const codeExplorer = document.getElementById('code-explorer');
const explorerBody = document.getElementById('explorer-body');
const explorerFiles = document.getElementById('explorer-files');
const editorTabs = document.getElementById('editor-tabs');
const explorerToggle = document.getElementById('explorer-toggle');
const codeEditBtn = document.getElementById('code-edit-btn');
const codeSaveBtn = document.getElementById('code-save-btn');
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
let openFiles = [];
let activeFile = null;
let isEditMode = false;

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
convertBtn.addEventListener('click', () => startConversion());

heroConvertBtn.addEventListener('click', () => startConversion());

// Prevent form submit, use our handler
heroForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  startConversion();
});

// Attach button opens file picker (for future file upload support)
heroAttachBtn?.addEventListener('click', () => heroFileUpload?.click());

heroFileUpload?.addEventListener('change', (e) => {
  const files = e.target.files;
  if (files?.length) {
    // Placeholder: could add support for .fig files later
    showError('File upload coming soon. Please paste a Figma URL.');
  }
  e.target.value = '';
});

// Enter in URL inputs
figmaUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    startConversion();
  }
});

heroFigmaUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    startConversion();
  }
});

// Typewriter placeholder
const heroTypewriter = document.getElementById('hero-typewriter');
const heroTypewriterText = document.getElementById('hero-typewriter-text');
const typewriterLines = [
  'Convert Figma to production-ready React code',
  'Generate clean, reusable components instantly',
  'Export pixel-perfect Tailwind CSS layouts',
  'Turn designs into scalable frontend systems',
  'Build faster with AI-powered conversion',
];
let typewriterLineIndex = 0;
let typewriterText = '';
let typewriterIsDeleting = false;
let typewriterSpeed = 50;
let typewriterTimeoutId = null;

function runTypewriter() {
  const currentLine = typewriterLines[typewriterLineIndex];
  typewriterTimeoutId = setTimeout(() => {
    if (!typewriterIsDeleting) {
      typewriterText = currentLine.substring(0, typewriterText.length + 1);
      heroTypewriterText.textContent = typewriterText;
      if (typewriterText === currentLine) {
        typewriterTimeoutId = setTimeout(() => { typewriterIsDeleting = true; runTypewriter(); }, 1500);
        return;
      }
    } else {
      typewriterText = currentLine.substring(0, typewriterText.length - 1);
      heroTypewriterText.textContent = typewriterText;
      if (typewriterText === '') {
        typewriterIsDeleting = false;
        typewriterLineIndex = (typewriterLineIndex + 1) % typewriterLines.length;
      }
    }
    runTypewriter();
  }, typewriterIsDeleting ? 30 : typewriterSpeed);
}

function updateTypewriterVisibility() {
  const hasValue = heroFigmaUrlInput.value.trim().length > 0;
  const isFocused = document.activeElement === heroFigmaUrlInput;
  if (hasValue || isFocused) {
    heroTypewriter.classList.add('hidden');
    if (typewriterTimeoutId) {
      clearTimeout(typewriterTimeoutId);
      typewriterTimeoutId = null;
    }
  } else {
    heroTypewriter.classList.remove('hidden');
    if (!typewriterTimeoutId) runTypewriter();
  }
}

heroFigmaUrlInput.addEventListener('focus', updateTypewriterVisibility);
heroFigmaUrlInput.addEventListener('blur', updateTypewriterVisibility);
heroFigmaUrlInput.addEventListener('input', updateTypewriterVisibility);
updateTypewriterVisibility();
if (!heroTypewriter.classList.contains('hidden')) runTypewriter();

function autoResizeTextarea(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}
heroFigmaUrlInput.addEventListener('input', () => autoResizeTextarea(heroFigmaUrlInput));
autoResizeTextarea(heroFigmaUrlInput);

function getActiveUrlInput() {
  return mainHero.classList.contains('hidden') ? figmaUrlInput : heroFigmaUrlInput;
}

function getSelectedFrameworks() {
  const scope = mainHero.classList.contains('hidden') ? mainSplit : mainHero;
  const checkboxes = scope.querySelectorAll('input[name="framework"]:checked');
  return Array.from(checkboxes).map((cb) => cb.value);
}

function startConversion() {
  const urlInput = getActiveUrlInput();
  const figmaUrl = urlInput.value.trim();
  const figmaToken = figmaTokenInput.value.trim();
  const frameworks = getSelectedFrameworks();

  if (!figmaUrl) {
    urlInput.focus();
    return;
  }
  if (!figmaToken) {
    if (sidebar.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
    }
    figmaTokenInput.focus();
    showError('Please enter your Figma Access Token in the sidebar.');
    return;
  }

  // Switch from hero to split view (animated)
  mainHero.classList.add('hidden');
  mainSplit.classList.add('visible');

  // Sync URL and framework selection to panel for "convert another"
  figmaUrlInput.value = figmaUrl;
  mainHero.querySelectorAll('input[name="framework"]').forEach((cb) => {
    const panelCb = mainSplit.querySelector(`input[name="framework"][value="${cb.value}"]`);
    if (panelCb) panelCb.checked = cb.checked;
  });
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
  explorerFiles.innerHTML = '';
  editorTabs.innerHTML = '';
  activeFile = null;
  openFiles = [];
  tabsData = [];
  updateCodeActionsState();

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

function setMonacoValidation(useStandardSyntax) {
  if (typeof monaco === 'undefined') return;
  const opts = useStandardSyntax
    ? { noSemanticValidation: false, noSyntaxValidation: false }
    : { noSemanticValidation: true, noSyntaxValidation: true };
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(opts);
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(opts);
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
    const monacoTheme = getTheme() === 'light' ? 'vs' : 'vs-dark';
    monacoEditor = monaco.editor.create(monacoContainer, {
      value: '',
      language: 'typescript',
      readOnly: true,
      theme: monacoTheme,
      minimap: { enabled: false },
      fontSize: 12,
      fontFamily: "JetBrains Mono, ui-monospace, Menlo, 'Courier New', monospace",
      scrollBeyondLastLine: false,
      padding: { top: 12 },
    });
    monacoReady = true;
    window.addEventListener('resize', layoutMonaco);
    const resizeObserver = new ResizeObserver(() => layoutMonaco());
    resizeObserver.observe(monacoContainer);
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
    requestAnimationFrame(() => {
      layoutMonaco();
      requestAnimationFrame(layoutMonaco);
    });
  }
}

// ── File Explorer & Editor Tabs ──
function buildExplorer() {
  explorerFiles.innerHTML = '';
  tabsData.forEach((tab) => {
    const filename = currentComponentName + tab.ext;
    const item = document.createElement('div');
    item.className = 'explorer-file';
    item.dataset.key = tab.key;
    item.innerHTML = `
      <span class="explorer-file-icon">${getFileIcon(tab.ext)}</span>
      <span class="explorer-file-name">${escapeHtml(filename)}</span>
    `;
    item.addEventListener('click', () => openFile(tab.key));
    explorerFiles.appendChild(item);
  });
}

function getFileIcon(ext) {
  const icons = {
    '.lite.tsx': '📄',
    '.jsx': '⚛',
    '.vue': '💚',
    '.svelte': '🟠',
    '.ts': '🅰',
    '.tsx': '⚛',
  };
  return icons[ext] || '📄';
}

function buildEditorTabs() {
  editorTabs.innerHTML = '';
  openFiles.forEach((key) => {
    const tab = tabsData.find((t) => t.key === key);
    if (!tab) return;
    const filename = currentComponentName + tab.ext;
    const el = document.createElement('div');
    el.className = `editor-tab${key === activeFile ? ' active' : ''}`;
    el.dataset.key = key;
    el.innerHTML = `
      <span class="editor-tab-name">${escapeHtml(filename)}</span>
      <button class="editor-tab-close" data-key="${key}" aria-label="Close">×</button>
    `;
    el.querySelector('.editor-tab-name').addEventListener('click', () => openFile(key));
    el.querySelector('.editor-tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeFile(key);
    });
    editorTabs.appendChild(el);
  });
}

function setEditMode(editing) {
  isEditMode = editing;
  if (monacoEditor) monacoEditor.updateOptions({ readOnly: !editing });
  codeEditBtn.style.display = editing ? 'none' : 'inline-flex';
  codeSaveBtn.style.display = editing ? 'inline-flex' : 'none';
}

function updateCodeActionsState() {
  const hasCode = activeFile && tabsData.length > 0;
  codeEditBtn.disabled = !hasCode;
  codeCopyBtn.disabled = !hasCode;
  if (!hasCode) {
    setEditMode(false);
  }
}

function openFile(key) {
  const tab = tabsData.find((t) => t.key === key);
  if (!tab) return;

  if (!openFiles.includes(key)) {
    openFiles.push(key);
    buildEditorTabs();
  }

  activeFile = key;
  setEditMode(false);

  document.querySelectorAll('.editor-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.key === key);
  });
  document.querySelectorAll('.explorer-file').forEach((el) => {
    el.classList.toggle('active', el.dataset.key === key);
  });

  if (monacoEditor && typeof monaco !== 'undefined') {
    monacoEditor.setValue(tab.code || '');
    monaco.editor.setModelLanguage(monacoEditor.getModel(), getMonacoLanguage(tab.ext));
    // Mitosis .lite.tsx uses non-standard syntax; framework outputs use standard syntax
    setMonacoValidation(key !== 'mitosis');
  }

  layoutMonaco();
  updateCodeActionsState();
}

function closeFile(key) {
  const idx = openFiles.indexOf(key);
  if (idx === -1) return;

  openFiles.splice(idx, 1);

  if (activeFile === key) {
    const nextIdx = Math.min(idx, openFiles.length - 1);
    activeFile = openFiles[nextIdx] ?? null;
  }

  buildEditorTabs();

  if (activeFile) {
    openFile(activeFile);
  } else if (monacoEditor) {
    monacoEditor.setValue('');
    document.querySelectorAll('.explorer-file').forEach((el) => el.classList.remove('active'));
  }

  updateCodeActionsState();
  layoutMonaco();
}

// ── Build Tabs (initial setup) ──
function buildTabs(data) {
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

  const firstKey = tabsData[0]?.key;
  openFiles = firstKey ? [firstKey] : [];
  activeFile = firstKey;

  buildExplorer();
  buildEditorTabs();

  initMonaco(() => {
    if (firstKey) openFile(firstKey);
    updateCodeActionsState();
    layoutMonaco();
  });
}

// ── Explorer Toggle ──
explorerToggle.addEventListener('click', () => {
  codeExplorer.classList.toggle('collapsed');
  requestAnimationFrame(layoutMonaco);
});

// ── Edit ──
codeEditBtn.addEventListener('click', () => {
  if (!activeFile) return;
  setEditMode(true);
});

// ── Save ──
codeSaveBtn.addEventListener('click', async () => {
  if (!activeFile || !currentSessionId || !monacoEditor) return;

  const content = monacoEditor.getValue();
  const tab = tabsData.find((t) => t.key === activeFile);
  if (!tab) return;

  codeSaveBtn.disabled = true;
  codeSaveBtn.textContent = 'Saving...';

  try {
    const res = await fetch('/api/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, fileKey: activeFile, content }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Save failed');
    }

    tab.code = content;
    if (activeFile !== 'mitosis') {
      currentFrameworkOutputs[activeFile] = content;
    }

    setEditMode(false);
    codeSaveBtn.textContent = 'Saved!';
    setTimeout(() => {
      codeSaveBtn.textContent = 'Save';
    }, 1500);
  } catch (err) {
    showError(err.message);
  } finally {
    codeSaveBtn.disabled = false;
    codeSaveBtn.textContent = 'Save';
  }
});

// ── Copy ──
codeCopyBtn.addEventListener('click', () => {
  if (!activeFile) return;
  const tab = tabsData.find((t) => t.key === activeFile);
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
  if (heroError) {
    heroError.textContent = message;
    heroError.classList.add('visible');
  }
}

function hideError() {
  errorBanner.classList.remove('visible');
  if (heroError) heroError.classList.remove('visible');
}

// ── Loading ──
function setLoading(loading) {
  convertBtn.disabled = loading;
  heroConvertBtn.disabled = loading;
  btnSpinner.style.display = loading ? 'inline-block' : 'none';
  sendIcon.style.display = loading ? 'none' : 'block';
  heroSpinner.style.display = loading ? 'inline-block' : 'none';
  heroSendIcon.style.display = loading ? 'none' : 'block';
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
updateCodeActionsState();

// Show hero on load, hide split (split has no .visible = hidden by default)
mainHero.classList.remove('hidden');
mainSplit.classList.remove('visible');
