// ── FingerprintJS ──
let visitorFingerprint = null;

async function initFingerprint() {
  try {
    if (typeof FingerprintJS !== 'undefined') {
      const fp = await FingerprintJS.load();
      const result = await fp.get();
      visitorFingerprint = result.visitorId;
      console.log('[fingerprint] initialized');
    }
  } catch (e) {
    console.warn('[fingerprint] FingerprintJS failed, falling back to cookie:', e.message);
  }
}
const _fingerprintReady = initFingerprint();

/**
 * Wrapper around fetch() that injects X-Fingerprint and Authorization headers.
 * Use this for all API calls instead of raw fetch().
 */
function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (visitorFingerprint) {
    headers['X-Fingerprint'] = visitorFingerprint;
  }
  const token = typeof authIdToken !== 'undefined' ? authIdToken : null;
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }
  return fetch(url, { ...options, headers });
}

// ── DOM Elements ──

// Theme
const THEME_KEY = 'figma-to-code-theme';

function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'light';
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

function onThemeToggleClick() {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
}

document.querySelectorAll('.theme-toggle').forEach((el) => {
  el.addEventListener('click', onThemeToggleClick);
});

// Apply saved theme on load
setTheme(getTheme());

// Sidebar
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const mainMenuBtn = document.getElementById('main-menu-btn');
const figmaTokenInput = document.getElementById('figma-token');
const tokenToggle = document.getElementById('token-toggle');
const saveTokenBtn = document.getElementById('save-token-btn');
const tokenStatus = document.getElementById('token-status');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// Project list
const projectListEl = document.getElementById('sidebar-project-list');
const allProjectsBtn = document.getElementById('all-projects-btn');
const sidebarSearchBtn = document.getElementById('sidebar-search-btn');
const commandPaletteOverlay = document.getElementById('command-palette-overlay');
const commandPaletteInput = document.getElementById('command-palette-input');
const commandPaletteResults = document.getElementById('command-palette-results');
const commandPaletteHint = document.getElementById('command-palette-hint');

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
const progressCollapsible = document.getElementById('progress-collapsible');
const progressToggle = document.getElementById('progress-toggle');
const progressToggleTitle = document.getElementById('progress-toggle-title');
const progressBadge = document.getElementById('progress-badge');
const progressCollapsibleBody = document.getElementById('progress-collapsible-body');
const errorBanner = document.getElementById('error-banner');
let progressStepCount = 0;

// Right panel
const modePreviewBtn = document.getElementById('mode-preview');
const modeCodeBtn = document.getElementById('mode-code');
const viewPreview = document.getElementById('view-preview');
const viewCode = document.getElementById('view-code');
const previewEmpty = document.getElementById('preview-empty');
let previewFrame = document.getElementById('preview-frame');

// Replace the preview iframe with a fresh one (gives full isolated JS context).
function replacePreviewIframe(url) {
  try {
    const container = previewFrame.parentNode;
    const newFrame = document.createElement('iframe');
    newFrame.className = previewFrame.className || 'preview-frame';
    newFrame.id = 'preview-frame';
    newFrame.sandbox = previewFrame.getAttribute('sandbox') || 'allow-scripts allow-same-origin';
    newFrame.style.display = previewFrame.style.display || 'block';
    newFrame.src = url;
    // Replace old iframe in DOM
    container.replaceChild(newFrame, previewFrame);
    // Update the reference
    previewFrame = newFrame;
    return newFrame;
  } catch (e) {
    // Fallback: try to set src on existing frame
    try { previewFrame.src = url; } catch (er) { /* ignore */ }
    return previewFrame;
  }
}
const downloadBtn = document.getElementById('download-btn');
const codeExplorer = document.getElementById('code-explorer');
const explorerBody = document.getElementById('explorer-body');
const explorerFiles = document.getElementById('explorer-files');
const codeViewModeEl = document.getElementById('code-view-mode');
const explorerSectionTitle = document.getElementById('explorer-section-title');
const editorTabs = document.getElementById('editor-tabs');
const explorerToggle = document.getElementById('explorer-toggle');
const codeEditBtn = document.getElementById('code-edit-btn');
const codeSaveBtn = document.getElementById('code-save-btn');
const codeCopyBtn = document.getElementById('code-copy-btn');
const monacoContainer = document.getElementById('monaco-editor-container');

// Visual Edit Elements
const enterVisualEditBtn = document.getElementById('enter-visual-edit');
const visualEditBackBtn = document.getElementById('visual-edit-back');
const visualEditSidebar = document.getElementById('visual-edit-sidebar');
const floatingPrompt = document.getElementById('ve-floating-prompt');
const floatingTag = document.getElementById('ve-floating-tag');
const floatingInput = document.getElementById('ve-ai-input');
const floatingSendBtn = document.getElementById('ve-ai-send');
const panelHeaderActions = document.getElementById('panel-header-actions');
const panelHeaderText = document.getElementById('panel-header-label');
const panelInputBar = document.querySelector('.panel__input-bar');

// Draft / Unsaved Edits
let pendingVisualEdits = {};
const veUnsavedBar = document.getElementById('ve-unsaved-bar');
const veUnsavedCount = document.getElementById('ve-unsaved-count');
const veUnsavedDiscard = document.getElementById('ve-unsaved-discard');
const veUnsavedSave = document.getElementById('ve-unsaved-save');

function updateUnsavedBar() {
  const numEdits = Object.values(pendingVisualEdits).reduce((sum, item) => sum + Object.keys(item.changes).length, 0);
  if (numEdits > 0) {
    if (veUnsavedBar) {
      veUnsavedBar.style.display = 'flex';
      veUnsavedCount.textContent = `${numEdits} unsaved edit${numEdits !== 1 ? 's' : ''}`;
    }
  } else {
    if (veUnsavedBar) veUnsavedBar.style.display = 'none';
  }
}

function registerVisualEdit(prop, value) {
  if (!selectedElementInfo) return;
  const key = selectedElementInfo.dataVeId || (selectedElementInfo.tagName + '-' + selectedElementInfo.textContent.replace(/\n/g, ' ').trim().substring(0, 25));
  if (!pendingVisualEdits[key]) {
    pendingVisualEdits[key] = {
      tagName: selectedElementInfo.tagName,
      textContent: selectedElementInfo.textContent,
      variantLabel: selectedElementInfo.variantLabel,
      variantProps: selectedElementInfo.variantProps,
      changes: {}
    };
  }
  pendingVisualEdits[key].changes[prop] = value;
  updateUnsavedBar();
}

// Property Controls
var veTextContent = document.getElementById('ve-text-content');
var veTextContentHint = document.getElementById('ve-text-content-hint');
var veColorText = document.getElementById('ve-color-text');
var veColorTextPreview = document.getElementById('ve-color-text-preview');
var veColorBg = document.getElementById('ve-color-bg');
var veColorBgPreview = document.getElementById('ve-color-bg-preview');
var veColorTextPicker = document.getElementById('ve-color-text-picker');
var veColorBgPicker = document.getElementById('ve-color-bg-picker');
var veFontSize = document.getElementById('ve-font-size');
var veFontWeight = document.getElementById('ve-font-weight');
var veFontStyle = document.getElementById('ve-font-style');
var veMarginAll = document.getElementById('ve-margin-all');
var veMarginExpand = document.getElementById('ve-margin-expand');
var veMarginExpanded = document.getElementById('ve-margin-expanded');
var veMarginTop = document.getElementById('ve-margin-top');
var veMarginRight = document.getElementById('ve-margin-right');
var veMarginBottom = document.getElementById('ve-margin-bottom');
var veMarginLeft = document.getElementById('ve-margin-left');
var vePaddingAll = document.getElementById('ve-padding-all');
var vePaddingExpand = document.getElementById('ve-padding-expand');
var vePaddingExpanded = document.getElementById('ve-padding-expanded');
var vePaddingTop = document.getElementById('ve-padding-top');
var vePaddingRight = document.getElementById('ve-padding-right');
var vePaddingBottom = document.getElementById('ve-padding-bottom');
var vePaddingLeft = document.getElementById('ve-padding-left');
var veBorderRadius = document.getElementById('ve-border-radius');
var veBoxShadow = document.getElementById('ve-box-shadow');
var veColorBorder = document.getElementById('ve-color-border');
var veColorBorderPreview = document.getElementById('ve-color-border-preview');
var veColorBorderPicker = document.getElementById('ve-color-border-picker');
var veOpacitySlider = document.getElementById('ve-opacity-slider');
var veOpacityVal = document.getElementById('ve-opacity-val');
var veGap = document.getElementById('ve-gap');
var veAlignBtns = document.querySelectorAll('.align-btn');
var veAiVoiceBtn = document.getElementById('ve-ai-voice');
var veAiDeleteBtn = document.getElementById('ve-ai-delete');

// Resize
const resizeHandle = document.getElementById('resize-handle');
const panelLeft = document.getElementById('panel-left');
const chatPanelCollapseBtn = document.getElementById('chat-panel-collapse');
const chatPanelExpandBtn = document.getElementById('chat-panel-expand');
const CHAT_PANEL_COLLAPSED_KEY = 'figma2code-chat-panel-collapsed';

// Preview (WebContainer)
const previewHeader = document.getElementById('preview-header');
const previewLiveBadge = document.getElementById('preview-live-badge');
const previewStatus = document.getElementById('preview-status');
const previewLoading = document.getElementById('preview-loading');
const previewLoadingText = document.getElementById('preview-loading-text');
const previewReload = document.getElementById('preview-reload');

// Duplicate dialog
const duplicateOverlay = document.getElementById('duplicate-dialog-overlay');
const duplicateMessage = document.getElementById('duplicate-dialog-message');
const duplicateCloseBtn = document.getElementById('duplicate-dialog-close');
const duplicateConvertAgain = document.getElementById('duplicate-convert-again');
const duplicateOpenExisting = document.getElementById('duplicate-open-existing');
let pendingDuplicateProject = null;

// ── State ──
let currentSessionId = null;
let currentProjectId = null;
let currentFrameworkOutputs = {};
let currentComponentName = '';
let monacoEditor = null;
let monacoReady = false;
let tabsData = [];
let openFiles = [];
let activeFile = null;
let isEditMode = false;
let webContainerInstance = null;
let webContainerDevProcess = null;
let webContainerPreviewUrl = null;
let webContainerLastWritten = {};
let webContainerSyncEnabled = false;
let codeViewMode = 'generated'; // 'generated' | 'wired'
let wiredAppFiles = {}; // path -> content (when template was wired)
let generatedTabsData = [];
let templateWired = false;
let tabsNeedRefresh = false;
let activeConversionSessionId = null; // sessionId of in-flight SSE conversion
let convertAbortController = null;   // AbortController for in-flight conversion SSE
let refineAbortController = null;    // AbortController for in-flight refine SSE
let currentUpdatedShadcnSource = null;
let currentShadcnComponentName = null;
let currentShadcnSubComponents = null;
let currentComponentPropertyDefs = null;
let currentVariantMetadata = null;
let currentElementMap = null;

// ── Undo State ──
let undoStack = []; // { frameworkOutputs, tabsDataSnapshot, wiredAppFilesSnapshot }
const MAX_UNDO_DEPTH = 10;
let lastUserRequestText = '';
/** Set of folder path prefixes that are expanded in wired app tree (e.g. 'src', 'src/components') */
let wiredExplorerExpanded = new Set(['src', 'public']);

// Visual Edit State
window.isVisualEditMode = false;
let selectedElementInfo = null;
let visualEditIframeInjected = false;

// ── Auth State ──
let authEnabled = false;
let isAuthenticated = false;
let currentUser = null;
let authIdToken = null;
let cognitoUserPool = null;
let freeTierUsage = { used: 0, limit: 10, remaining: 10, tier: 'free' };
let loginSuccessCallback = null;

/** Explorer icon config: folder, chevron, fileIcons. Loaded from /explorer-icons.config.json; merged with these defaults. */
const DEFAULT_EXPLORER_ICON_CONFIG = {
  folder: { closed: 'icon-folder-closed', open: 'icon-folder-open' },
  chevron: { right: 'icon-chevron-right', down: 'icon-chevron-down' },
  fileIcons: {
    default: 'icon-file-doc',
    '.json': 'icon-file-json',
    '.html': 'icon-file-html',
    '.ts': 'icon-file-ts',
    '.tsx': 'icon-file-ts',
    '.js': 'icon-file-js',
    '.jsx': 'icon-file-js',
    '.svg': 'icon-file-svg',
    '.css': 'icon-file-css',
    '.md': 'icon-file-md',
    '.env.example': 'icon-file-env',
    '.gitignore': 'icon-file-gitignore',
    'vite.config': 'icon-file-vite',
    'config.toml': 'icon-file-config',
  },
};
let explorerIconConfig = {
  folder: { ...DEFAULT_EXPLORER_ICON_CONFIG.folder },
  chevron: { ...DEFAULT_EXPLORER_ICON_CONFIG.chevron },
  fileIcons: { ...DEFAULT_EXPLORER_ICON_CONFIG.fileIcons },
};

/** Load explorer icon config from JSON; merge with defaults. Edit public/explorer-icons.config.json to customize. */
function loadExplorerIconConfig() {
  fetch('/explorer-icons.config.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || typeof data !== 'object') return;
      if (data.folder && typeof data.folder === 'object') {
        explorerIconConfig.folder = { ...DEFAULT_EXPLORER_ICON_CONFIG.folder, ...data.folder };
      }
      if (data.chevron && typeof data.chevron === 'object') {
        explorerIconConfig.chevron = { ...DEFAULT_EXPLORER_ICON_CONFIG.chevron, ...data.chevron };
      }
      if (data.fileIcons && typeof data.fileIcons === 'object') {
        explorerIconConfig.fileIcons = { ...DEFAULT_EXPLORER_ICON_CONFIG.fileIcons, ...data.fileIcons };
      }
      if (codeViewMode === 'wired' && Object.keys(wiredAppFiles).length > 0) buildExplorer();
    })
    .catch(() => { });
}

/** Render icon HTML: value is sprite id (e.g. icon-folder-closed) or emoji:📁. size in px. */
function renderExplorerIcon(value, size = 16) {
  if (!value || typeof value !== 'string') value = 'icon-file-doc';
  if (value.startsWith('emoji:')) {
    const emoji = value.slice(6).trim() || '📄';
    return `<span class="explorer-icon-emoji" style="width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.9)}px">${escapeHtml(emoji)}</span>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16"><use href="#${escapeHtml(value)}"/></svg>`;
}

// ── Token Storage (server-side) ──
const TOKEN_ID_KEY = 'figma-to-code-tokenId';

async function loadSavedToken() {
  const tokenId = sessionStorage.getItem(TOKEN_ID_KEY);
  if (!tokenId) return;
  try {
    const res = await apiFetch(`/api/verify-token/${tokenId}`);
    const data = await res.json();
    if (data.valid) {
      figmaTokenInput.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
      figmaTokenInput.disabled = true;
      tokenStatus.textContent = 'Token connected';
      tokenStatus.className = 'token-status saved';
      if (saveTokenBtn) saveTokenBtn.textContent = 'Disconnect';
    } else {
      sessionStorage.removeItem(TOKEN_ID_KEY);
      tokenStatus.textContent = 'Session expired \u2014 please re-enter token';
      tokenStatus.className = 'token-status expired';
    }
  } catch {
    // Server unreachable, clear stale tokenId
    sessionStorage.removeItem(TOKEN_ID_KEY);
  }
}

// ── Project History Store ──
const PROJECTS_KEY = 'figma-to-code-projects';
const MAX_PROJECTS = 20;

function loadProjects() {
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
  } catch { return []; }
}

function saveProjects(projects) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) {
      console.warn('[storage] Quota exceeded, trimming project data...');
      const trimmed = trimProjectsForStorage(projects);
      try {
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(trimmed));
      } catch (e2) {
        console.error('[storage] Could not save even after trimming:', e2);
      }
    } else {
      console.error('[storage] Failed to save projects:', e);
    }
  }
}

/**
 * Progressively strip large data from oldest projects to fit localStorage quota.
 * Strips: assets first, then chatHistory, then removes oldest projects entirely.
 */
function trimProjectsForStorage(projects) {
  let trimmed = projects.map(p => ({ ...p }));
  // Sort by updatedAt descending so we strip from oldest first
  const byAge = [...trimmed].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  // Pass 1: strip assets from oldest projects
  for (let i = byAge.length - 1; i >= 0; i--) {
    const p = trimmed.find(pp => pp.id === byAge[i].id);
    if (p && p.assets && p.assets.length > 0) {
      p.assets = [];
      if (fitsInStorage(trimmed)) return trimmed;
    }
  }
  // Pass 2: strip chatHistory from oldest projects
  for (let i = byAge.length - 1; i >= 0; i--) {
    const p = trimmed.find(pp => pp.id === byAge[i].id);
    if (p && p.chatHistory && p.chatHistory.length > 0) {
      p.chatHistory = [];
      if (fitsInStorage(trimmed)) return trimmed;
    }
  }
  // Pass 3: remove oldest projects entirely
  while (trimmed.length > 1) {
    trimmed.pop();
    if (fitsInStorage(trimmed)) return trimmed;
  }
  return trimmed;
}

function fitsInStorage(projects) {
  try {
    const str = JSON.stringify(projects);
    // Rough check: localStorage typically has 5-10MB limit
    return str.length < 4 * 1024 * 1024; // 4MB safety margin
  } catch {
    return false;
  }
}

function saveProject(project) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === project.id);
  if (idx >= 0) {
    projects[idx] = { ...projects[idx], ...project, updatedAt: Date.now() };
  } else {
    projects.unshift({ ...project, createdAt: Date.now(), updatedAt: Date.now() });
  }
  // Prune oldest beyond max
  while (projects.length > MAX_PROJECTS) projects.pop();
  saveProjects(projects);
  renderProjectList();
  // Debounced persist to DynamoDB for authenticated users
  debouncedPersistProject(projects.find(p => p.id === project.id) || project);
}

function deleteProject(id) {
  const wasActive = currentProjectId === id;
  const projects = loadProjects().filter(p => p.id !== id);
  saveProjects(projects);
  // Cancel any pending debounced sync that might re-create this project in DynamoDB
  clearTimeout(_syncDebounceTimer);
  // Also delete from DynamoDB for authenticated users
  if (isAuthenticated && authIdToken) {
    apiFetch(`/api/auth/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .catch(e => console.warn('[delete] Failed to delete from server:', e));
  }
  if (wasActive) {
    resetToHero();
  } else {
    renderProjectList();
  }
}

function getProject(id) {
  return loadProjects().find(p => p.id === id) || null;
}

function updateProjectField(id, updates) {
  const projects = loadProjects();
  const p = projects.find(pp => pp.id === id);
  if (p) {
    Object.assign(p, updates, { updatedAt: Date.now() });
    saveProjects(projects);
  }
}

function formatTimeAgo(ts) {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'Just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function normalizeFigmaUrl(url) {
  if (!url) return '';
  const fileMatch = url.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  if (!fileMatch) return url.trim().toLowerCase();
  const fileKey = fileMatch[1];
  const nodeMatch = url.match(/node-id=([^&]+)/);
  let nodeId = '';
  if (nodeMatch) {
    nodeId = decodeURIComponent(nodeMatch[1]).replace(/-/, ':');
  }
  return nodeId ? `${fileKey}::${nodeId}` : fileKey;
}

function findExistingProject(url) {
  const projects = loadProjects();
  const normalized = normalizeFigmaUrl(url);
  if (!normalized) return null;
  return projects.find(p => normalizeFigmaUrl(p.figmaUrl) === normalized) || null;
}

function showDuplicateDialog(project) {
  pendingDuplicateProject = project;
  const name = project.name || 'Untitled';
  const timeAgo = formatTimeAgo(project.updatedAt || project.createdAt);
  duplicateMessage.innerHTML = `<strong>${escapeHtml(name)}</strong> was already converted <strong>${escapeHtml(timeAgo)}</strong>. Would you like to open the existing project or convert again?`;
  duplicateOverlay.setAttribute('aria-hidden', 'false');
}

function hideDuplicateDialog() {
  duplicateOverlay.setAttribute('aria-hidden', 'true');
  pendingDuplicateProject = null;
}

if (duplicateCloseBtn) duplicateCloseBtn.addEventListener('click', hideDuplicateDialog);
if (duplicateOverlay) duplicateOverlay.addEventListener('click', (e) => {
  if (e.target === duplicateOverlay) hideDuplicateDialog();
});
if (duplicateOpenExisting) duplicateOpenExisting.addEventListener('click', () => {
  const project = pendingDuplicateProject;
  hideDuplicateDialog();
  if (project) restoreProject(project.id);
});
if (duplicateConvertAgain) duplicateConvertAgain.addEventListener('click', () => {
  hideDuplicateDialog();
  startConversion(true);
});

function generatePlaceholderThumbnail(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 56; canvas.height = 56;
  const ctx = canvas.getContext('2d');
  // Deterministic hue from name hash
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  ctx.fillStyle = `hsl(${hue}, 55%, 45%)`;
  ctx.fillRect(0, 0, 56, 56);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((name[0] || '?').toUpperCase(), 28, 30);
  return canvas.toDataURL('image/png');
}

/** Active project title above "Import Design" (visible when split view is open, including collapsed sidebar). */
function updatePanelHeaderProject() {
  const el = document.getElementById('panel-header-project');
  if (!el) return;
  const splitVisible = mainSplit?.classList.contains('visible');
  let display = '';
  if (splitVisible) {
    const p = currentProjectId ? getProject(currentProjectId) : null;
    display = (p?.name || currentComponentName || '').trim();
    if (display === 'Converting...' && currentComponentName) display = currentComponentName.trim();
  }
  if (display) {
    el.hidden = false;
    el.textContent = display;
  } else {
    el.hidden = true;
    el.textContent = '';
  }
}

/** Thumbnail block shared by sidebar project list and command palette (square tile, image or letter on hue). */
function projectThumbMarkup(p) {
  const thumbStyle = p.thumbnail
    ? `background-image: url(${p.thumbnail}); background-size: cover;`
    : `background: hsl(200, 55%, 45%);`;
  const letter = (p.name || '?')[0].toUpperCase();
  const inner = p.thumbnail ? '' : escapeHtml(letter);
  return `<span class="sidebar__project-thumb sidebar__project-thumb--placeholder" style="${thumbStyle}">${inner}</span>`;
}

function renderProjectList() {
  if (!projectListEl) return;
  const projects = loadProjects();
  if (projects.length === 0) {
    projectListEl.innerHTML = '';
    return;
  }
  const items = projects.slice(0, 8);
  let html = '';
  for (const p of items) {
    const isActive = currentProjectId === p.id;
    const convertingClass = p.converting ? ' converting' : '';
    const dateLabel = p.converting ? 'Converting...' : formatTimeAgo(p.updatedAt || p.createdAt);
    html += `<div class="sidebar__project-item${isActive ? ' active' : ''}${convertingClass}" data-project-id="${escapeHtml(p.id)}" title="${escapeHtml(p.name)}">
      ${projectThumbMarkup(p)}
      <div class="sidebar__project-info">
        <div class="sidebar__project-name">${escapeHtml(p.name)}</div>
        <div class="sidebar__project-date">${dateLabel}</div>
      </div>
      <button class="sidebar__project-delete" data-delete-id="${escapeHtml(p.id)}" title="Delete project" aria-label="Delete project">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`;
  }
  html += `<button class="sidebar__new-project-btn" id="new-project-btn" type="button">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    <span>New conversion</span>
  </button>`;
  projectListEl.innerHTML = html;

  // Bind click events
  projectListEl.querySelectorAll('.sidebar__project-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.sidebar__project-delete')) return;
      restoreProject(el.dataset.projectId);
    });
  });
  projectListEl.querySelectorAll('.sidebar__project-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteId;
      const p = getProject(id);
      if (p && confirm(`Delete "${p.name}"?`)) deleteProject(id);
    });
  });
  const newBtn = projectListEl.querySelector('#new-project-btn');
  if (newBtn) newBtn.addEventListener('click', resetToHero);
  updatePanelHeaderProject();
}

function restoreProject(projectId) {
  const project = getProject(projectId);
  if (!project) return;

  // Close profile view if open
  const profileView = document.getElementById('profile-view');
  if (profileView && profileView.style.display !== 'none') {
    profileView.style.display = 'none';
  }

  // Abort in-flight refine stream (interactive, tied to current view).
  // Conversion stream is NOT aborted — it continues in background and
  // handleComplete() will save results to the project when done.
  if (refineAbortController) { refineAbortController.abort(); refineAbortController = null; }

  // If project is still converting, restore the full progress UI
  if (project.converting) {
    currentProjectId = project.id;
    currentSessionId = project.sessionId || project.id;
    currentComponentName = project.name || '';
    currentFrameworkOutputs = {};
    renderProjectList();

    // Restore split view and progress panel
    mainHero.classList.add('hidden');
    mainSplit.classList.add('visible');
    applyChatPanelCollapseFromStorage();
    mainHero.closest('.main')?.classList.add('split-visible');
    figmaUrlInput.value = project.figmaUrl || '';

    // Show progress panel (steps are still in DOM from background SSE)
    if (progressCollapsible) {
      progressCollapsible.style.display = '';
      progressCollapsible.classList.add('visible');
      progressCollapsible.classList.remove('collapsed');
    }
    if (emptyState) emptyState.style.display = 'none';

    // Restore converting UI state
    setLoading(true);
    setStatus('converting', 'Converting...');
    switchMode('preview');
    previewEmpty.style.display = 'flex';
    previewFrame.style.display = 'none';
    if (previewHeader) previewHeader.style.display = 'none';
    if (previewLoading) previewLoading.style.display = 'none';
    downloadBtn.style.display = 'none';
    const pushGithubBtn = document.getElementById('push-github-btn');
    if (pushGithubBtn) pushGithubBtn.style.display = 'none';

    // Hide chat, show URL input
    if (chatMessages) { chatMessages.innerHTML = ''; chatMessages.classList.remove('visible'); }
    if (chatInputGroup) chatInputGroup.style.display = 'none';
    if (urlInputGroup) urlInputGroup.style.display = 'block';

    // Auto-collapse sidebar on selection (non-mobile)
    if (window.innerWidth > 768) {
      sidebar.classList.add('collapsed');
      updateSidebarToggleTitle();
      updateMenuButtonVisibility();
    }

    syncSidebarPrimaryNavToShellView();
    return;
  }

  currentProjectId = project.id;
  currentSessionId = project.sessionId || project.id;
  currentComponentName = project.name || '';
  currentFrameworkOutputs = project.frameworkOutputs || {};
  currentElementMap = project.elementMap || null;
  // Restore shadcn + variant metadata (used by the preview project-tree builder).
  currentUpdatedShadcnSource = project.updatedShadcnSource || null;
  currentShadcnComponentName = project.shadcnComponentName || null;
  currentShadcnSubComponents = project.shadcnSubComponents || null;
  currentComponentPropertyDefs = project.componentPropertyDefinitions || null;
  currentVariantMetadata = project.variantMetadata || null;
  // Switch to split view
  mainHero.classList.add('hidden');
  mainSplit.classList.add('visible');
  applyChatPanelCollapseFromStorage();
  mainHero.closest('.main')?.classList.add('split-visible');

  // Auto-collapse sidebar on selection (non-mobile)
  if (window.innerWidth > 768) {
    sidebar.classList.add('collapsed');
    updateSidebarToggleTitle();
    updateMenuButtonVisibility();
  }

  // Set URL input
  figmaUrlInput.value = project.figmaUrl || '';

  // Sync framework checkboxes (hero only; panel URL bar has no duplicate chips)
  const frameworks = project.frameworks || [];
  mainHero.querySelectorAll('input[name="framework"]').forEach(cb => {
    cb.checked = frameworks.includes(cb.value);
  });

  // Hide progress, clear empty state
  if (progressCollapsible) progressCollapsible.style.display = 'none';
  if (emptyState) emptyState.style.display = 'none';

  // Switch to preview mode
  switchMode('preview');

  // Build code tabs from stored data
  const fakeData = {
    frameworks,
    mitosisSource: project.mitosisSource || '',
    componentName: project.name,
  };
  buildTabs(fakeData);
  generatedTabsData = tabsData.map(t => ({ ...t }));

  // Restore templateWired state and code view mode toggle
  templateWired = Boolean(project.templateWired);
  if (templateWired && codeViewModeEl) {
    codeViewModeEl.style.display = 'flex';
  } else if (codeViewModeEl) {
    codeViewModeEl.style.display = 'none';
  }

  // Restore saved UI state: openFiles, activeFile, codeViewMode
  const savedCodeViewMode = project.codeViewMode || 'generated';
  const savedOpenFiles = (project.openFiles || []).filter(k => tabsData.some(t => t.key === k));
  const savedActiveFile = (project.activeFile && savedOpenFiles.includes(project.activeFile))
    ? project.activeFile
    : (savedOpenFiles[0] || tabsData[0]?.key || null);

  if (savedOpenFiles.length > 0) {
    openFiles = savedOpenFiles;
    activeFile = savedActiveFile;
  }

  buildEditorTabs();
  if (activeFile) {
    openFile(activeFile);
  }

  // Restore download button
  downloadBtn.style.display = 'inline-flex';
  const pushGithubBtn = document.getElementById('push-github-btn');
  if (pushGithubBtn) pushGithubBtn.style.display = 'inline-flex';

  // Preview: check server session first, then choose path — no parallel race
  previewEmpty.style.display = 'none';
  const chartComponents = project.chartComponents || [];
  setPreviewLoading(true, 'Loading preview...');
  apiFetch(`/api/preview/${currentSessionId}`, { method: 'HEAD' })
    .then(r => {
      if (r.ok) {
        // Server session alive — use full preview pipeline
        startPreviewForSession(project.frameworks || [], project.chartComponents || []);
      } else {
        // Server session expired — instant inline preview from localStorage
        showInlinePreview(project);
      }
    })
    .catch(() => showInlinePreview(project));

  // Restore wired app files if template was wired
  if (templateWired) {
    apiFetch(`/api/session/${currentSessionId}/wired-app-files`)
      .then(r => (r.ok ? r.json() : null))
      .then(res => {
        if (res && res.files) {
          wiredAppFiles = res.files;
          // If saved code view was 'wired', switch now that files are loaded
          if (savedCodeViewMode === 'wired') {
            switchCodeViewMode('wired');
          }
        } else {
          // Wired files unavailable, hide toggle
          templateWired = false;
          if (codeViewModeEl) codeViewModeEl.style.display = 'none';
        }
      })
      .catch(() => {
        templateWired = false;
        if (codeViewModeEl) codeViewModeEl.style.display = 'none';
      });
  }

  // Restore chat history
  if (chatMessages) { chatMessages.innerHTML = ''; chatMessages.classList.remove('visible'); }
  if (project.chatHistory && project.chatHistory.length > 0) {
    if (chatMessages) chatMessages.classList.add('visible');
    for (const msg of project.chatHistory) {
      if (msg.meta && msg.role === 'assistant') {
        // New-style rich card entry
        addRichAssistantMessage({ title: msg.content, filesChanged: msg.meta.filesChanged, skipPersist: true });
      } else {
        addChatMessage(msg.role, msg.content, true);
      }
    }
  }

  // Switch to chat input mode
  if (urlInputGroup) urlInputGroup.style.display = 'none';
  if (chatInputGroup) chatInputGroup.style.display = 'block';
  requestAnimationFrame(() => resizeChatInput());

  setStatus('done', 'Conversion complete');
  renderProjectList();
  syncSidebarPrimaryNavToShellView();
}

function transformForBrowser(reactCode, componentName) {
  const lines = reactCode.split('\n');
  const out = [];
  for (const line of lines) {
    // Strip "use client" directive
    if (/^\s*["']use client["'];?\s*$/.test(line)) continue;
    // Strip import lines
    if (/^\s*import\s+/.test(line)) continue;
    // export default function Foo() → function Foo()
    if (/^\s*export\s+default\s+function\s+/.test(line)) {
      out.push(line.replace(/export\s+default\s+/, ''));
      continue;
    }
    // Skip standalone export default
    if (/^\s*export\s+default\s+/.test(line)) continue;
    out.push(line);
  }
  let code = out.join('\n');
  // Extract and remove <style> blocks
  let css = '';
  const styleRegex = /<style>\{`([\s\S]*?)`\}<\/style>/g;
  let m;
  while ((m = styleRegex.exec(code)) !== null) css += m[1] + '\n';
  code = code.replace(styleRegex, '');
  return { code, css };
}

/**
 * Convert a property name to camelCase for variant grid props.
 * e.g. "Show Left Icon#3371:152" → "showLeftIcon"
 */
function toCamelCaseClient(str) {
  const clean = str.replace(/#\d+:\d+$/, '');
  return clean
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

/**
 * Build the variant grid App component source (client-side port of preview.ts buildVariantGridApp).
 * Returns JSX string that renders all variant combinations in a grid.
 */
function buildClientVariantGridApp(componentName, propDefs) {
  if (!propDefs) {
    return `
    function App() {
      return (
        <div style={{ padding: '1rem' }}>
          <${componentName} />
        </div>
      );
    }`;
  }

  const variantAxes = [];
  const booleanProps = [];
  for (const [name, def] of Object.entries(propDefs)) {
    if (def.type === 'VARIANT' && def.variantOptions) {
      variantAxes.push({ name, camel: toCamelCaseClient(name), values: def.variantOptions });
    } else if (def.type === 'BOOLEAN') {
      booleanProps.push({ name, camel: toCamelCaseClient(name), defaultValue: def.defaultValue ?? true });
    }
  }

  const stateKeywords = ['default', 'hover', 'focus', 'disabled', 'loading', 'active', 'pressed', 'error'];
  const stateAxisIdx = variantAxes.findIndex((a) => {
    if (a.name.toLowerCase() === 'state') return true;
    const lowerVals = a.values.map((v) => v.toLowerCase());
    return lowerVals.filter((v) => stateKeywords.includes(v)).length >= 2;
  });
  const stateAxis = stateAxisIdx >= 0 ? variantAxes.splice(stateAxisIdx, 1)[0] : null;
  const propAxes = variantAxes;

  const axisArraysJS = propAxes.map((axis) => {
    const values = JSON.stringify(axis.values.map((v) => v.toLowerCase()));
    return `  const ${axis.camel}Values = ${values};`;
  }).join('\n');

  let statesJS = `  const stateEntries = [{ label: 'Default', props: {} }];`;
  if (stateAxis) {
    const entries = stateAxis.values.map((val) => {
      const lower = val.toLowerCase();
      if (lower === 'default') return `    { label: '${val}', props: {} }`;
      const parts = val.split(/[-\\s]+/).filter(Boolean);
      const propsObj = parts.map((p) => `${toCamelCaseClient(p)}: true`).join(', ');
      return `    { label: '${val}', props: { ${propsObj} } }`;
    });
    statesJS = `  const stateEntries = [\n${entries.join(',\n')}\n  ];`;
  }

  const basePropsEntries = [];
  for (const bp of booleanProps) {
    if (bp.defaultValue === true) basePropsEntries.push(`${bp.camel}: true`);
  }
  const basePropsJS = basePropsEntries.length > 0
    ? `  const baseProps = { ${basePropsEntries.join(', ')} };`
    : `  const baseProps = {};`;

  const propMappings = propAxes.map((axis) => {
    const propName = axis.name.toLowerCase() === 'style' ? 'variant'
      : axis.name.toLowerCase() === 'type' ? 'variant'
        : axis.camel;
    return { axis, propName };
  });

  let variantBuildJS;
  if (propAxes.length === 0) {
    variantBuildJS = `
  const allVariants = stateEntries.map((state) => ({
    label: state.label,
    props: { ...baseProps, ...state.props },
  }));`;
  } else {
    const indent = '    ';
    let inner = `({
${indent}  label: [${propMappings.map((m) => m.axis.camel).join(', ')}, state.label].join(' / '),
${indent}  props: {
${indent}    ...baseProps,
${indent}    ${propMappings.map((m) => {
      const defaultVal = m.axis.values[0].toLowerCase();
      return `...(${m.axis.camel} !== '${defaultVal}' ? { ${m.propName}: ${m.axis.camel} } : {})`;
    }).join(`,\n${indent}    `)},
${indent}    ...state.props,
${indent}  },
${indent}})`;
    let expr = `stateEntries.map((state) => ${inner})`;
    for (let i = propMappings.length - 1; i >= 0; i--) {
      const m = propMappings[i];
      expr = `${m.axis.camel}Values.flatMap((${m.axis.camel}) =>\n      ${expr}\n    )`;
    }
    variantBuildJS = `\n  const allVariants = ${expr};`;
  }

  return `
${axisArraysJS}
${statesJS}
${basePropsJS}
${variantBuildJS}

    function App() {
      return (
        <div style={{ padding: '1rem', minHeight: '100vh' }}>
          <h1 data-ve-ignore="true" style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>${componentName}</h1>
          <p data-ve-ignore="true" style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}>
            {allVariants.length} variant combination{allVariants.length !== 1 ? 's' : ''}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {allVariants.map((v, i) => (
              <div key={i} style={{ width: '100%' }} data-variant-index={i} data-variant-label={v.label} data-variant-props={JSON.stringify(v.props)}>
                <div data-ve-ignore="true" style={{ marginBottom: '0.5rem', fontSize: '0.75rem', color: '#666' }}>{v.label}</div>
                <div style={{ width: '100%' }}>
                  <${componentName} {...v.props} />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }`;
}

/**
 * Build a map of asset filenames to data URIs from project.assets.
 */
function buildAssetDataURIMap(assets) {
  const map = {};
  if (!assets || !assets.length) return map;
  for (const a of assets) {
    if (a.filename && a.content) {
      map[a.filename] = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(a.content)));
    }
  }
  return map;
}

/**
 * Rewrite asset paths in code and CSS to use data URIs.
 */
function rewriteAssetsToDataURIs(code, css, assetMap) {
  let newCode = code;
  let newCss = css;
  for (const [filename, dataURI] of Object.entries(assetMap)) {
    // In code: src="./assets/icon.svg" or src="/api/preview/.../assets/icon.svg"
    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const codePattern = new RegExp(`(["'])(?:\\.\\/assets\\/|/api/preview/[^/]+/assets/)${escaped}\\1`, 'g');
    newCode = newCode.replace(codePattern, `"${dataURI}"`);
    // In CSS: url(./assets/icon.svg) or url("/api/preview/.../assets/icon.svg")
    const cssPattern = new RegExp(`url\\(["']?(?:\\.\\/assets\\/|/api/preview/[^/]+/assets/)${escaped}["']?\\)`, 'g');
    newCss = newCss.replace(cssPattern, `url("${dataURI}")`);
  }
  return { code: newCode, css: newCss };
}

/**
 * Build inline JavaScript definitions for shadcn sub-components so the
 * offline preview can render them without a module bundler.
 * Client-side port of preview.ts buildShadcnInlineDefs().
 */
function buildClientShadcnInlineDefs(shadcnSubComponents) {
  if (!shadcnSubComponents || shadcnSubComponents.length === 0) return '';

  const defs = [];

  // Minimal cn() utility
  defs.push('function cn(...args) { return args.filter(Boolean).join(" "); }');

  // Minimal cva() stub
  defs.push(`function cva(base, config) {
  return function(props) {
    let classes = base || "";
    if (config && config.variants && props) {
      for (const [key, values] of Object.entries(config.variants)) {
        const val = props[key] || (config.defaultVariants && config.defaultVariants[key]);
        if (val && values[val]) classes += " " + values[val];
      }
    }
    return classes;
  };
}`);

  // Minimal Slot stub
  defs.push('function Slot({ children, ...props }) { return children; }');

  for (const sub of shadcnSubComponents) {
    let source = sub.updatedShadcnSource;
    // Strip import lines
    source = source.replace(/^\s*import\s+.*$/gm, '');
    // Strip "use client"
    source = source.replace(/^\s*["']use client["'];?\s*$/gm, '');
    // Strip export { ... }
    source = source.replace(/export\s*\{[^}]*\};?\s*/g, '');
    // export const → const
    source = source.replace(/export\s+const\s+/g, 'const ');
    // Strip export interface blocks
    source = source.replace(/export\s+interface\s+[\s\S]*?\n\}/gm, '');
    // Strip TypeScript generics on React.forwardRef
    source = source.replace(/React\.forwardRef<[^>]*>/g, 'React.forwardRef');
    // Strip type assertions
    source = source.replace(/\)\s+as\s+\w+/g, ')');
    // Strip VariantProps type params
    source = source.replace(/,\s*type\s+VariantProps\b[^)]*\)/g, ')');
    // Strip standalone type aliases
    source = source.replace(/^type\s+\w+\s*=\s*.*$/gm, '');
    // Strip interface blocks
    source = source.replace(/^interface\s+\w+[\s\S]*?\n\}/gm, '');
    defs.push(source.trim());
  }

  return defs.join('\n\n') + '\n\n';
}

function showInlinePreview(project) {
  const reactCode = (project.frameworkOutputs || {}).react;
  if (!reactCode) {
    previewEmpty.style.display = 'flex';
    previewFrame.style.display = 'none';
    return;
  }
  const componentName = project.name || 'Component';
  let { code, css } = transformForBrowser(reactCode, componentName);

  // Rewrite asset paths to data URIs using stored assets
  const assetMap = buildAssetDataURIMap(project.assets);
  if (Object.keys(assetMap).length > 0) {
    const rewritten = rewriteAssetsToDataURIs(code, css, assetMap);
    code = rewritten.code;
    css = rewritten.css;
  }

  // Build variant grid App (or simple App) using stored componentPropertyDefinitions
  const appCode = buildClientVariantGridApp(componentName, project.componentPropertyDefinitions);

  // Detect recharts usage
  const usesRecharts = /from ['"]recharts['"]/.test(reactCode) ||
    (project.chartComponents && project.chartComponents.length > 0);
  const rechartsScript = usesRecharts
    ? '\n<script src="https://unpkg.com/recharts@2/umd/Recharts.js" crossorigin><\/script>'
    : '';
  const rechartsGlobals = usesRecharts
    ? `\nconst { AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
      XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
      ComposedChart, ReferenceLine, Brush } = Recharts;`
    : '';

  // Prepare iframe script injection for Visual Edit
  const visualEditScript = `
    <script>
      (function() {
        let lastHovered = null;
        let selectedEl = null;

        function clearChildHoverOutlines(el) {
          if (!el || !el.children) return;
          for (let i = 0; i < el.children.length; i++) {
            el.children[i].classList.remove('ve-child-hover-outline');
          }
        }

        function applyChildHoverOutlines(el) {
          if (!el || !el.children || el.children.length === 0) return;
          for (let i = 0; i < el.children.length; i++) {
            const child = el.children[i];
            if (child.nodeType !== 1) continue;
            if (child.matches && child.matches('[data-ve-ignore="true"]')) continue;
            child.classList.add('ve-child-hover-outline');
          }
        }

        document.addEventListener('mouseover', (e) => {
          if (!window.parentVisualEditActive) return;
          if (!e.target.closest || e.target.closest('[data-ve-ignore="true"]') || e.target === document.body || e.target === document.documentElement) {
            if (lastHovered) {
              if (lastHovered !== selectedEl) lastHovered.classList.remove('ve-hover-outline');
              clearChildHoverOutlines(lastHovered);
            }
            lastHovered = null;
            return;
          }

          if (lastHovered === e.target) return;

          if (lastHovered) {
            if (lastHovered !== selectedEl) lastHovered.classList.remove('ve-hover-outline');
            clearChildHoverOutlines(lastHovered);
          }
          lastHovered = e.target;
          if (lastHovered && lastHovered !== document.body && lastHovered !== document.documentElement) {
            if (lastHovered !== selectedEl) lastHovered.classList.add('ve-hover-outline');
            applyChildHoverOutlines(lastHovered);
          }
        }, true);

        document.addEventListener('click', (e) => {
          if (!window.parentVisualEditActive) return;
          if (!e.target.closest || e.target.closest('[data-ve-ignore="true"]') || e.target === document.body || e.target === document.documentElement) return;

          e.preventDefault();
          e.stopPropagation();

          if (selectedEl) {
            selectedEl.classList.remove('ve-selected-outline');
          }
          selectedEl = e.target;
          if (!selectedEl || selectedEl === document.body || selectedEl === document.documentElement) return;

          selectedEl.classList.remove('ve-hover-outline');
          selectedEl.classList.add('ve-selected-outline');

          // Find data-ve-id (element or closest ancestor with mapping)
          const veIdEl = selectedEl.closest ? selectedEl.closest('[data-ve-id]') : null;
          const dataVeId = veIdEl ? veIdEl.getAttribute('data-ve-id') : null;
          // Find variant context (when inside variant grid)
          const variantWrapper = selectedEl.closest ? selectedEl.closest('[data-variant-label]') : null;
          const variantLabel = variantWrapper ? variantWrapper.getAttribute('data-variant-label') : null;
          const variantPropsStr = variantWrapper ? variantWrapper.getAttribute('data-variant-props') : null;
          let variantProps = null;
          try { variantProps = variantPropsStr ? JSON.parse(variantPropsStr) : null; } catch (_) {}

          const style = window.getComputedStyle(selectedEl);
          const rect = selectedEl.getBoundingClientRect();
          const trimmedText = selectedEl.textContent.trim();
          const descendantElements = selectedEl.querySelectorAll('*').length;
          const VE_TEXT_LEN_MAX = 280;
          const VE_DESC_EL_MAX = 22;
          const textContentEditable =
            trimmedText.length === 0 ||
            (trimmedText.length <= VE_TEXT_LEN_MAX && descendantElements <= VE_DESC_EL_MAX);

          window.parent.postMessage({
            type: 'elementSelected',
            dataVeId: dataVeId,
            variantLabel: variantLabel,
            variantProps: variantProps,
            tagName: selectedEl.tagName.toLowerCase(),
            textContent: trimmedText,
            textContentEditable,
            textContentStats: {
              length: trimmedText.length,
              descendantElements,
            },
            computedStyle: {
              color: style.color,
              backgroundColor: style.backgroundColor,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              fontStyle: style.fontStyle,
              margin: style.margin,
              padding: style.padding,
              textAlign: style.textAlign
            },
            rect: {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height
            }
          }, '*');
        }, true);

        window.addEventListener('message', (e) => {
          console.log('Iframe received message:', e.data.type, e.data.active);
          if (e.data.type === 'deleteElement') {
            if (selectedEl) {
              selectedEl.remove();
              selectedEl = null;
            }
          } else if (e.data.type === 'updateElement') {
            if (selectedEl) {
              if (e.data.prop === 'textContent') {
                selectedEl.textContent = e.data.value;
              } else {
                selectedEl.style[e.data.prop] = e.data.value;
              }
              // Update rect in case it changed
              const rect = selectedEl.getBoundingClientRect();
              window.parent.postMessage({ type: 'rectUpdated', rect }, '*');
            }
          } else if (e.data.type === 'setVisualEditActive') {
            window.parentVisualEditActive = e.data.active;
            console.log('Iframe Visual Edit Active:', window.parentVisualEditActive);
            if (!e.data.active) {
              if (lastHovered) {
                if (lastHovered !== selectedEl) lastHovered.classList.remove('ve-hover-outline');
                clearChildHoverOutlines(lastHovered);
              }
              if (selectedEl) selectedEl.classList.remove('ve-selected-outline');
              selectedEl = null;
            }
          }
        });

        // Report ready to parent
        window.parent.postMessage({ type: 'iframeReady' }, '*');
      })();
    <\/script>
  `;

  // Inline shadcn sub-component definitions for offline preview
  const shadcnDefs = buildClientShadcnInlineDefs(project.shadcnSubComponents);

  // Build JSX source for manual Babel.transform (with error handling)
  const jsxSource = `const { useState, useEffect, useRef, useCallback, useMemo } = React;${rechartsGlobals}\n` +
    shadcnDefs +
    code + '\n' +
    appCode + '\n' +
    `const root = ReactDOM.createRoot(document.getElementById('root'));\nroot.render(React.createElement(App));`;
  const escapedJSX = jsxSource.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  const escapedCss = css.replace(/<\//g, '<\\/');
  const htmlContent = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:system-ui,-apple-system,sans-serif;background:#f8f9fa;min-height:100vh;}
.preview-error{padding:1rem;color:#dc2626;font-family:monospace;white-space:pre-wrap;font-size:13px;}
.preview-error h3{margin-bottom:0.5rem;font-size:14px;}
.ve-hover-outline { outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; cursor: pointer !important; }
.ve-child-hover-outline { outline: 1px dotted #1e40af !important; outline-offset: -1px !important; }
.ve-selected-outline { outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2) !important; }
${escapedCss}</style>
<script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin><\/script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin><\/script>${rechartsScript}
<script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
</head><body>
<div id="root"></div>
<script>
window.onerror = function(msg, src, line, col, err) {
  var el = document.getElementById('root');
  if (el) { el.innerHTML = '<div class="preview-error"><h3>Preview Error</h3><p id="preview-err-msg"></p></div>'; document.getElementById('preview-err-msg').textContent = msg; }
};
try {
  var jsxCode = \`${escapedJSX}\`;
  var result = Babel.transform(jsxCode, { filename: 'component.tsx', presets: ['typescript', 'react'], plugins: ['proposal-optional-chaining', 'proposal-nullish-coalescing-operator'] });
  var script = document.createElement('script');
  script.textContent = result.code;
  document.body.appendChild(script);
} catch (e) {
  var el = document.getElementById('root');
  if (el) { el.innerHTML = '<div class="preview-error"><h3>Babel Transpile Error</h3><p id="preview-err-msg"></p></div>'; document.getElementById('preview-err-msg').textContent = (e.message || String(e)); }
}
<\/script>
${visualEditScript}
</body></html>`;
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  setPreviewReady(blobUrl, false, 'Offline preview');
}

function resetToHero() {
  currentProjectId = null;
  currentSessionId = null;
  currentComponentName = '';
  currentFrameworkOutputs = {};
  chatRefining = false;

  // Always close profile view if open (no matter how resetToHero is called)
  const profileView = document.getElementById('profile-view');
  if (profileView) profileView.style.display = 'none';

  // Switch to hero view
  mainHero.classList.remove('hidden');
  mainSplit.classList.remove('visible');
  mainHero.closest('.main')?.classList.remove('split-visible');

  // Reset inputs
  heroFigmaUrlInput.value = '';
  figmaUrlInput.value = '';
  autoResizeTextarea(heroFigmaUrlInput);

  // Reset panels
  if (chatMessages) { chatMessages.innerHTML = ''; chatMessages.classList.remove('visible'); }
  if (chatInputGroup) chatInputGroup.style.display = 'none';
  if (urlInputGroup) urlInputGroup.style.display = 'block';
  if (emptyState) emptyState.style.display = 'flex';
  if (progressCollapsible) progressCollapsible.style.display = 'none';
  switchMode('preview');
  previewEmpty.style.display = 'flex';
  previewFrame.style.display = 'none';
  replacePreviewIframe('about:blank');
  if (previewHeader) previewHeader.style.display = 'none';
  if (previewLoading) previewLoading.style.display = 'none';
  downloadBtn.style.display = 'none';
  const pushGithubBtn = document.getElementById('push-github-btn');
  if (pushGithubBtn) pushGithubBtn.style.display = 'none';
  explorerFiles.innerHTML = '';
  editorTabs.innerHTML = '';
  activeFile = null;
  openFiles = [];
  tabsData = [];

  setStatus('ready', 'Ready to convert');
  renderProjectList();
  syncSidebarPrimaryNavToShellView();
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
function updateMenuButtonVisibility() {
  const isMobile = window.innerWidth <= 768;
  const sidebarHidden = isMobile && !sidebar.classList.contains('open');
  if (mainMenuBtn) {
    mainMenuBtn.style.display = sidebarHidden ? 'flex' : 'none';
  }
}

function updateSidebarToggleTitle() {
  const isMobile = window.innerWidth <= 768;
  if (sidebarToggle && !isMobile) {
    sidebarToggle.title = sidebar.classList.contains('collapsed') ? 'Expand sidebar' : 'Collapse sidebar';
    sidebarToggle.setAttribute('aria-label', sidebar.classList.contains('collapsed') ? 'Expand sidebar' : 'Collapse sidebar');
  }
}

sidebarToggle.addEventListener('click', () => {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('visible');
  } else {
    sidebar.classList.toggle('collapsed');
    updateSidebarToggleTitle();
  }
  updateMenuButtonVisibility();
  syncSidebarPrimaryNavToShellView();
});

if (mainMenuBtn) {
  mainMenuBtn.addEventListener('click', () => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      sidebar.classList.add('open');
      sidebarOverlay.classList.add('visible');
    } else {
      sidebar.classList.remove('collapsed');
      updateSidebarToggleTitle();
    }
    updateMenuButtonVisibility();
    syncSidebarPrimaryNavToShellView();
  });
}

sidebarOverlay.addEventListener('click', () => {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('visible');
  updateMenuButtonVisibility();
});

window.addEventListener('resize', () => {
  updateMenuButtonVisibility();
  updateSidebarToggleTitle();
});
updateMenuButtonVisibility();
updateSidebarToggleTitle();

// Sidebar nav item selection (Search opens command palette; All projects has its own handler)
document.querySelectorAll('.sidebar__nav-item').forEach((el) => {
  if (el.id === 'all-projects-btn' || el.id === 'sidebar-search-btn' || el.id === 'sidebar-tour-btn') return;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.id === 'sidebar-profile-btn') {
      clearAllSidebarActive();
      el.classList.add('active');
      showProfileModal();
      // Auto-close sidebar on mobile
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('visible');
        updateMenuButtonVisibility();
      }
      return;
    }
    // Close profile view if open
    const profileView = document.getElementById('profile-view');
    if (profileView && profileView.style.display !== 'none') {
      profileView.style.display = 'none';
    }
    // Home button: always reset to hero (hides split view, clears project state)
    if (el.title === 'Home') {
      resetToHero();
      return;
    }
    clearAllSidebarActive();
    el.classList.add('active');
  });
});

// When collapsed, clicking a section header expands the sidebar
document.querySelectorAll('.sidebar__section-header').forEach((el) => {
  el.addEventListener('click', () => {
    if (window.innerWidth > 768 && sidebar.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
      updateSidebarToggleTitle();
      updateMenuButtonVisibility();
    }
  });
});

// ── Token Toggle Visibility ──
tokenToggle.addEventListener('click', () => {
  const isPassword = figmaTokenInput.type === 'password';
  figmaTokenInput.type = isPassword ? 'text' : 'password';
});

// ── Save Token Button ──
saveTokenBtn.addEventListener('click', async () => {
  const existingId = sessionStorage.getItem(TOKEN_ID_KEY);
  if (existingId) {
    // Disconnect
    sessionStorage.removeItem(TOKEN_ID_KEY);
    figmaTokenInput.value = '';
    figmaTokenInput.disabled = false;
    tokenStatus.textContent = '';
    tokenStatus.className = 'token-status';
    saveTokenBtn.textContent = 'Save Token';
    return;
  }
  // Connect
  const token = figmaTokenInput.value.trim();
  if (!token) return;
  try {
    const res = await apiFetch('/api/store-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ figmaToken: token }),
    });
    const data = await res.json();
    if (data.tokenId) {
      sessionStorage.setItem(TOKEN_ID_KEY, data.tokenId);
      figmaTokenInput.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
      figmaTokenInput.disabled = true;
      tokenStatus.textContent = 'Token connected';
      tokenStatus.className = 'token-status saved';
      saveTokenBtn.textContent = 'Disconnect';
    }
  } catch {
    tokenStatus.textContent = 'Failed to save token';
    tokenStatus.className = 'token-status expired';
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

heroFigmaUrlInput.addEventListener('focus', () => { console.log('[event] focus on hero input'); updateTypewriterVisibility(); hideHeroChatResponse(); });
heroFigmaUrlInput.addEventListener('blur', () => { console.log('[event] blur on hero input'); updateTypewriterVisibility(); });
heroFigmaUrlInput.addEventListener('input', () => { console.log('[event] input on hero input, value:', heroFigmaUrlInput.value.substring(0, 40)); updateTypewriterVisibility(); hideHeroChatResponse(); });
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
  const checkboxes = mainHero.querySelectorAll('input[name="framework"]:checked');
  return Array.from(checkboxes).map((cb) => cb.value);
}

function isFigmaUrl(text) {
  return /figma\.com\/(design|file|proto)\//i.test(text);
}

/** Extract the actual Figma URL from text that may contain surrounding words (e.g. "Implement this design from Figma. @https://...") */
function extractFigmaUrl(text) {
  const match = text.match(/https?:\/\/[^\s]+figma\.com\/[^\s]+/i);
  return match ? match[0].replace(/^@/, '') : text.trim();
}

// ── Hero Chat (LLM-powered assistant) ─────────────────────────────────────

const heroConversation = [];

function appendHeroBubble(role, text) {
  const responseEl = document.getElementById('hero-chat-response');
  if (!responseEl) return null;
  responseEl.style.display = 'block';

  const bubble = document.createElement('div');
  bubble.className = `hero-chat-bubble hero-chat-bubble--${role}`;
  bubble.textContent = text;
  responseEl.appendChild(bubble);
  bubble.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return bubble;
}

function showHeroTypingIndicator() {
  const responseEl = document.getElementById('hero-chat-response');
  if (!responseEl) return null;

  const typing = document.createElement('div');
  typing.className = 'hero-chat-bubble hero-chat-bubble--assistant hero-chat-typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  responseEl.appendChild(typing);
  typing.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return typing;
}

async function sendHeroChatMessage(text) {
  console.log('[hero-chat] sendHeroChatMessage called, text:', text.substring(0, 80));
  // Push user message BEFORE clearing input — prevents hideHeroChatResponse()
  // from wiping the chat when the input's 'input' event fires
  heroConversation.push({ role: 'user', content: text });
  console.log('[hero-chat] heroConversation length:', heroConversation.length);

  appendHeroBubble('user', text);
  console.log('[hero-chat] user bubble appended');
  heroFigmaUrlInput.value = '';
  autoResizeTextarea(heroFigmaUrlInput);
  updateTypewriterVisibility();

  const typingEl = showHeroTypingIndicator();
  console.log('[hero-chat] typing indicator shown, starting fetch...');

  try {
    const res = await fetch('/api/hero-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: heroConversation.slice(-10),
      }),
    });
    console.log('[hero-chat] fetch complete, status:', res.status);
    const data = await res.json();
    console.log('[hero-chat] response data:', JSON.stringify(data).substring(0, 200));
    const reply = data.reply || "Sorry, I couldn't process that. Try pasting a Figma URL!";

    heroConversation.push({ role: 'assistant', content: reply });

    if (typingEl) typingEl.remove();
    appendHeroBubble('assistant', reply);
    console.log('[hero-chat] assistant bubble appended, conversation length:', heroConversation.length);
  } catch (err) {
    console.error('[hero-chat] fetch error:', err);
    if (typingEl) typingEl.remove();
    appendHeroBubble('assistant', "Sorry, something went wrong. Try pasting a Figma design URL to get started!");
  }
}

function hideHeroChatResponse() {
  console.log('[hero-chat] hideHeroChatResponse called, conversation length:', heroConversation.length, new Error().stack.split('\n')[2]?.trim());
  if (heroConversation.length > 0) return; // preserve ongoing chat
  const responseEl = document.getElementById('hero-chat-response');
  if (responseEl) {
    console.log('[hero-chat] HIDING chat response container');
    responseEl.style.display = 'none';
  }
}

async function startConversion(skipDuplicateCheck) {
  console.log('[startConversion] called, skipDuplicateCheck:', skipDuplicateCheck);
  // Ensure fingerprint + auth state are initialized before any auth checks
  await Promise.all([_fingerprintReady, _authReady]);

  const urlInput = getActiveUrlInput();
  const rawInput = urlInput.value.trim();
  const frameworks = getSelectedFrameworks();
  console.log('[startConversion] rawInput:', rawInput.substring(0, 80), 'isFigmaUrl:', isFigmaUrl(rawInput));

  if (!rawInput) {
    console.log('[startConversion] empty input, focusing');
    urlInput.focus();
    return;
  }

  // If input is not a Figma URL, send to LLM chat assistant
  if (!isFigmaUrl(rawInput)) {
    console.log('[startConversion] not a Figma URL, routing to hero chat');
    sendHeroChatMessage(rawInput);
    return;
  }

  // Extract the actual Figma URL from surrounding text
  const figmaUrl = extractFigmaUrl(rawInput);
  urlInput.value = figmaUrl;

  // Hide chat response if visible (user now pasting a real URL)
  hideHeroChatResponse();

  // Auth gate: check conversion limits
  if (authEnabled && freeTierUsage.remaining <= 0) {
    if (isAuthenticated) {
      // Authenticated user hit 20-conversion limit → show contact modal
      showContactNesterLabsModal();
      return;
    }
    // Anonymous user hit 5-conversion limit → require login
    showLoginModal(() => startConversion(skipDuplicateCheck));
    return;
  }

  // Resolve tokenId — auto-store if user typed a raw token
  let tokenId = sessionStorage.getItem(TOKEN_ID_KEY);
  if (!tokenId) {
    const rawToken = figmaTokenInput.value.trim();
    if (!rawToken) {
      if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.remove('collapsed');
      }
      figmaTokenInput.focus();
      showError('Please enter your Figma Access Token in the sidebar.');
      return;
    }
    try {
      const res = await apiFetch('/api/store-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ figmaToken: rawToken }),
      });
      const data = await res.json();
      tokenId = data.tokenId;
      sessionStorage.setItem(TOKEN_ID_KEY, tokenId);
      figmaTokenInput.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
      figmaTokenInput.disabled = true;
      tokenStatus.textContent = 'Token connected';
      tokenStatus.className = 'token-status saved';
      if (saveTokenBtn) saveTokenBtn.textContent = 'Disconnect';
    } catch {
      showError('Failed to save token. Please try again.');
      return;
    }
  }

  // Check for duplicate URL before starting conversion
  if (!skipDuplicateCheck) {
    const existing = findExistingProject(figmaUrl);
    if (existing) {
      showDuplicateDialog(existing);
      return;
    }
  }

  // Switch from hero to split view (animated)
  mainHero.classList.add('hidden');
  mainSplit.classList.add('visible');
  applyChatPanelCollapseFromStorage();
  mainHero.closest('.main')?.classList.add('split-visible');
  syncSidebarPrimaryNavToShellView();

  // Sync URL to panel for "convert another" (frameworks stay on hero inputs)
  figmaUrlInput.value = figmaUrl;
  if (frameworks.length === 0) {
    showError('Please select at least one framework.');
    return;
  }

  // Reset UI
  setLoading(true);
  hideError();
  setStatus('converting', 'Converting...');
  showProgress();
  clearProgress();

  // Reset right panel to preview mode and hide previous results
  switchMode('preview');
  previewEmpty.style.display = 'flex';
  previewFrame.style.display = 'none';
  replacePreviewIframe('about:blank');
  if (previewHeader) previewHeader.style.display = 'none';
  if (previewLoading) previewLoading.style.display = 'none';
  webContainerSyncEnabled = false;
  downloadBtn.style.display = 'none';
  const pushGithubBtnEl = document.getElementById('push-github-btn');
  if (pushGithubBtnEl) pushGithubBtnEl.style.display = 'none';
  explorerFiles.innerHTML = '';
  editorTabs.innerHTML = '';
  activeFile = null;
  openFiles = [];
  tabsData = [];
  wiredAppFiles = {};
  codeViewMode = 'generated';
  templateWired = false;
  wiredExplorerExpanded = new Set(['src', 'public']);
  if (codeViewModeEl) codeViewModeEl.style.display = 'none';
  updateCodeActionsState();

  // Reset chat state and project tracking
  currentProjectId = null;
  if (chatMessages) { chatMessages.innerHTML = ''; chatMessages.classList.remove('visible'); }
  if (chatInputGroup) chatInputGroup.style.display = 'none';
  if (urlInputGroup) urlInputGroup.style.display = 'block';
  chatRefining = false;

  // Start SSE request (always enable template wiring for now)
  const body = JSON.stringify({ figmaUrl, tokenId, frameworks, template: true });

  // Abort any in-flight conversion/refine before starting a new one
  if (convertAbortController) { convertAbortController.abort(); convertAbortController = null; }
  if (refineAbortController) { refineAbortController.abort(); refineAbortController = null; }
  convertAbortController = new AbortController();

  apiFetch('/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: convertAbortController.signal,
  }).then(async (response) => {
    if (response.status === 401) {
      const errData = await response.json().catch(() => ({}));
      if (errData.error && errData.error.includes('Token expired')) {
        sessionStorage.removeItem(TOKEN_ID_KEY);
        figmaTokenInput.value = '';
        figmaTokenInput.disabled = false;
        tokenStatus.textContent = 'Session expired \u2014 please re-enter token';
        tokenStatus.className = 'token-status expired';
        if (saveTokenBtn) saveTokenBtn.textContent = 'Save Token';
        setLoading(false);
        showError('Figma token expired. Please re-enter your token and try again.');
        return Promise.reject(new Error('__token_expired__'));
      }
      setLoading(false);
      showLoginModal(() => startConversion(true));
      return Promise.reject(new Error('__auth_redirect__'));
    }
    if (response.status === 403) {
      setLoading(false);
      showContactNesterLabsModal();
      return Promise.reject(new Error('__auth_limit__'));
    }
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
          convertAbortController = null;
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
        convertAbortController = null;
        if (err.name === 'AbortError') return; // intentional abort
        setLoading(false);
        setStatus('error', 'Connection lost');
        showError(`Connection lost: ${err.message}`);
      });
    }

    readStream();
  }).catch((err) => {
    convertAbortController = null;
    if (err.name === 'AbortError') return; // intentional abort
    if (err.message === '__auth_redirect__' || err.message === '__auth_limit__') return; // handled by modal
    activeConversionSessionId = null;
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
    case 'session':
      handleSessionCreated(data);
      break;
    case 'step':
      addProgressStep(data.message);
      if (currentProjectId === activeConversionSessionId) {
        setStatus('converting', data.message);
      }
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
      activeConversionSessionId = null;
      setLoading(false);
      markLastStepError();
      setStatus('error', 'Error occurred');
      showError(data.message);
      // Remove placeholder project on conversion failure
      if (currentSessionId) {
        deleteProject(currentSessionId);
      }
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
  if (progressCollapsible) {
    progressCollapsible.style.display = '';
    progressCollapsible.classList.add('visible');
    progressCollapsible.classList.remove('collapsed');
  }
  progressStepCount = 0;
  updateProgressBadge('active');
}

function clearProgress() {
  progressList.innerHTML = '';
  progressStepCount = 0;
  if (progressToggleTitle) progressToggleTitle.textContent = 'Processing steps';
  if (progressBadge) { progressBadge.classList.remove('visible'); progressBadge.className = 'progress-collapsible__badge'; }
  if (progressCollapsible) progressCollapsible.classList.remove('collapsed');
}

function collapseProgress() {
  if (progressCollapsible) progressCollapsible.classList.add('collapsed');
}

function expandProgress() {
  if (progressCollapsible) progressCollapsible.classList.remove('collapsed');
}

function toggleProgress() {
  if (progressCollapsible) progressCollapsible.classList.toggle('collapsed');
}

function updateProgressBadge(state) {
  if (!progressBadge) return;
  progressBadge.className = 'progress-collapsible__badge visible progress-collapsible__badge--' + state;
  if (state === 'done') {
    progressBadge.textContent = progressStepCount + ' steps';
  } else if (state === 'error') {
    progressBadge.textContent = 'Error';
  } else {
    progressBadge.textContent = progressStepCount + ' steps';
  }
}

if (progressToggle) {
  progressToggle.addEventListener('click', toggleProgress);
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
  progressStepCount++;
  updateProgressBadge('active');
  if (progressToggleTitle) progressToggleTitle.textContent = message;
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
  if (progressToggleTitle) progressToggleTitle.textContent = 'Error occurred';
  updateProgressBadge('error');
}

// ── WebContainer ──
const WEBCONTAINER_CDN = 'https://cdn.jsdelivr.net/npm/@webcontainer/api@1.2.4';

function isWebContainerSupported() {
  try {
    return typeof SharedArrayBuffer !== 'undefined' && 'serviceWorker' in navigator;
  } catch {
    return false;
  }
}

function setPreviewLoading(show, text) {
  if (previewLoading) {
    previewLoading.style.display = show ? 'flex' : 'none';
    if (previewLoadingText) previewLoadingText.textContent = text || 'Starting preview...';
  }
}

function setPreviewReady(url, isLive, statusText) {
  setPreviewLoading(false);
  previewEmpty.style.display = 'none';
  previewFrame.style.display = 'block';
  replacePreviewIframe(url);
  if (previewHeader) previewHeader.style.display = 'flex';
  if (previewLiveBadge) previewLiveBadge.style.display = isLive ? 'inline-block' : 'none';
  if (previewStatus) previewStatus.textContent = isLive ? 'Live Vite preview' : (statusText || '');
  if (previewReload) previewReload.style.display = 'inline-flex';
}

/**
 * Start the best available preview for the current session.
 * Prefers WebContainer/Vite when supported; falls back to static preview HTML.
 */
function startPreviewForSession(frameworks, chartComponents) {
  webContainerSyncEnabled = false;
  webContainerLastWritten = {};

  // Hide old preview immediately so the user never sees a dead-port error
  // while the WebContainer restarts for the new project.
  previewFrame.style.display = 'none';
  if (previewHeader) previewHeader.style.display = 'none';
  setPreviewLoading(true, 'Loading preview...');

  const hasReact = Array.isArray(frameworks) && frameworks.includes('react');
  const reactCode = currentFrameworkOutputs.react || '';

  if (hasReact && reactCode && !reactCode.startsWith('// Error') && isWebContainerSupported()) {
    const currentChartComponents = chartComponents || [];
    return apiFetch(`/api/session/${currentSessionId}/push-files`)
      .then((r) => r.json())
      .then((res) => {
        const files = res.files || [];
        const reactFile = files.find((f) => f.name.endsWith('.jsx') && f.name.includes(currentComponentName));
        const assetFiles = files.filter((f) => f.name.startsWith('assets/'));
        let componentCode = reactFile?.content || reactCode;
        let componentCss = '';
        const styleMatch = componentCode.match(/<style>\{`([\s\S]*?)`\}<\/style>/);
        if (styleMatch) {
          componentCss = styleMatch[1];
          componentCode = componentCode.replace(/<style>\{`[\s\S]*?`\}<\/style>/g, '');
        }
        componentCode = componentCode.replace(/\.\/assets\//g, '/assets/');
        const assets = assetFiles.map((f) => ({ filename: f.name.replace('assets/', ''), content: f.content }));
        const tree = buildViteProjectTree(currentComponentName, componentCode, componentCss, assets, currentChartComponents);
        return bootWebContainer(tree);
      })
      .then((url) => {
        setPreviewReady(url, true);
        webContainerSyncEnabled = true;
      })
      .catch((err) => {
        console.warn('WebContainer failed, using static preview:', err);
        const statusText = !hasReact ? 'Static preview' : !isWebContainerSupported() ? 'Static preview (Chrome/Edge for live)' : 'Static preview';
        setPreviewReady(`/api/preview/${currentSessionId}`, false, statusText);
      });
  }

  const statusText = !hasReact ? 'Static preview' : !isWebContainerSupported() ? 'Static preview (Chrome/Edge for live)' : '';
  setPreviewReady(`/api/preview/${currentSessionId}`, false, statusText);
  return Promise.resolve();
}

function setPreviewError(msg) {
  setPreviewLoading(false);
  if (previewStatus) previewStatus.textContent = msg || 'Preview failed';
}

function toFileSystemTree(files) {
  const tree = {};
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/').filter(Boolean);
    let current = tree;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        current[name] = { file: { contents: content } };
      } else {
        if (!current[name]) current[name] = { directory: {} };
        current = current[name].directory;
      }
    }
  }
  return tree;
}

function repairTruncatedCSS(css) {
  if (!css) return css;
  let result = css.trimEnd();
  // Remove trailing incomplete declaration (property name without semicolon)
  result = result.replace(/\n[ \t]*[a-zA-Z-]+[ \t]*:?[^;{}]*$/, '');
  // Close any unclosed braces
  let open = 0;
  for (const ch of result) {
    if (ch === '{') open++;
    else if (ch === '}') open--;
  }
  while (open > 0) { result += '\n}'; open--; }
  return result;
}

function extractReactCodeAndCss(reactCode) {
  let css = '';
  const styleRegex = /<style>\{`([\s\S]*?)`\}<\/style>/g;
  let m;
  while ((m = styleRegex.exec(reactCode)) !== null) {
    css += m[1] + '\n';
  }
  const code = reactCode.replace(styleRegex, '');
  return { code, css: repairTruncatedCSS(css) };
}

function buildViteProjectTree(componentName, componentCode, componentCss, assets, chartComponents) {
  const hasShadcn = !!(currentUpdatedShadcnSource && currentShadcnComponentName);
  const componentPath = `./components/${componentName}`;

  // Build App.tsx — if shadcn with variant grid, build full grid; otherwise simple preview
  let appTsx;
  if (hasShadcn && currentComponentPropertyDefs) {
    appTsx = buildShadcnVariantGridApp(componentName, currentComponentPropertyDefs, currentVariantMetadata);
  } else {
    appTsx = `import ${componentName} from "${componentPath}";
function App() {
  return (
    <div className="p-6">
      <h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-4">${componentName} Preview</h2>
      <${componentName} />
    </div>
  );
}
export default App;
`;
  }

  const hasShadcnSub = !!(currentShadcnSubComponents && currentShadcnSubComponents.length);
  const needsShadcnDeps = hasShadcn || hasShadcnSub;
  // Start from BASE_DEPS so the fingerprint matches pre-boot — avoids redundant npm install
  const deps = { ...BASE_DEPS };
  if (needsShadcnDeps) {
    // Scan generated shadcn source for @radix-ui/* imports and add them dynamically
    const allShadcnSources = [currentUpdatedShadcnSource || ''];
    if (currentShadcnSubComponents) {
      for (const sub of currentShadcnSubComponents) {
        allShadcnSources.push(sub.updatedShadcnSource || '');
      }
    }
    for (const src of allShadcnSources) {
      if (src) {
        const radixMatches = src.matchAll(/@radix-ui\/[\w-]+/g);
        for (const m of radixMatches) {
          if (!deps[m[0]]) deps[m[0]] = '^1.0.0';
        }
      }
    }
  }

  // Vite config — add @/ path alias for shadcn imports
  const viteConfig = needsShadcnDeps
    ? 'import { defineConfig } from "vite"; import react from "@vitejs/plugin-react"; import path from "path"; export default defineConfig({ plugins: [react()], resolve: { alias: { "@": path.resolve(__dirname, "./src") } } });'
    : 'import { defineConfig } from "vite"; import react from "@vitejs/plugin-react"; export default defineConfig({ plugins: [react()] });';

  const packageJson = JSON.stringify({
    name: 'preview-app',
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: deps,
    devDependencies: BASE_DEV_DEPS,
  });
  const files = {
    'package.json': packageJson,
    'vite.config.ts': viteConfig,
    'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Preview</title>
  <style>
    .ve-hover-outline { outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; cursor: pointer !important; }
    .ve-child-hover-outline { outline: 1px dotted #1e40af !important; outline-offset: -1px !important; }
    .ve-selected-outline { outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2) !important; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
  <script>
    (function() {
      let lastHovered = null;
      let selectedEl = null;

      function clearChildHoverOutlines(el) {
        if (!el || !el.children) return;
        for (let i = 0; i < el.children.length; i++) {
          el.children[i].classList.remove('ve-child-hover-outline');
        }
      }

      function applyChildHoverOutlines(el) {
        if (!el || !el.children || el.children.length === 0) return;
        for (let i = 0; i < el.children.length; i++) {
          const child = el.children[i];
          if (child.nodeType !== 1) continue;
          if (child.matches && child.matches('[data-ve-ignore="true"]')) continue;
          child.classList.add('ve-child-hover-outline');
        }
      }

      document.addEventListener('mouseover', (e) => {
        if (!window.parentVisualEditActive) return;
        if (!e.target.closest || e.target.closest('[data-ve-ignore="true"]') || e.target === document.body || e.target === document.documentElement) {
          if (lastHovered) {
            if (lastHovered !== selectedEl) lastHovered.classList.remove('ve-hover-outline');
            clearChildHoverOutlines(lastHovered);
          }
          lastHovered = null;
          return;
        }

        if (lastHovered === e.target) return;

        if (lastHovered) {
          if (lastHovered !== selectedEl) lastHovered.classList.remove('ve-hover-outline');
          clearChildHoverOutlines(lastHovered);
        }
        lastHovered = e.target;
        if (lastHovered && lastHovered !== document.body && lastHovered !== document.documentElement) {
          if (lastHovered !== selectedEl) lastHovered.classList.add('ve-hover-outline');
          applyChildHoverOutlines(lastHovered);
        }
      }, true);

      document.addEventListener('click', (e) => {
        if (!window.parentVisualEditActive) return;
        if (!e.target.closest || e.target.closest('[data-ve-ignore="true"]') || e.target === document.body || e.target === document.documentElement) return;

        if (e.target === selectedEl) return;

        e.preventDefault();
        e.stopPropagation();

        if (selectedEl) {
          selectedEl.classList.remove('ve-selected-outline');
        }
        selectedEl = e.target;
        if (!selectedEl || selectedEl === document.body || selectedEl === document.documentElement) return;

        selectedEl.classList.remove('ve-hover-outline');
        selectedEl.classList.add('ve-selected-outline');

        const veIdEl = selectedEl.closest ? selectedEl.closest('[data-ve-id]') : null;
        const dataVeId = veIdEl ? veIdEl.getAttribute('data-ve-id') : null;
        const variantWrapper = selectedEl.closest ? selectedEl.closest('[data-variant-label]') : null;
        const variantLabel = variantWrapper ? variantWrapper.getAttribute('data-variant-label') : null;
        const variantPropsStr = variantWrapper ? variantWrapper.getAttribute('data-variant-props') : null;
        let variantProps = null;
        try { variantProps = variantPropsStr ? JSON.parse(variantPropsStr) : null; } catch (_) {}

        const style = window.getComputedStyle(selectedEl);
        const rect = selectedEl.getBoundingClientRect();
        const trimmedText = selectedEl.textContent.trim();
        const descendantElements = selectedEl.querySelectorAll('*').length;
        const VE_TEXT_LEN_MAX = 280;
        const VE_DESC_EL_MAX = 22;
        const textContentEditable =
          trimmedText.length === 0 ||
          (trimmedText.length <= VE_TEXT_LEN_MAX && descendantElements <= VE_DESC_EL_MAX);

        window.parent.postMessage({
          type: 'elementSelected',
          dataVeId: dataVeId,
          variantLabel: variantLabel,
          variantProps: variantProps,
          tagName: selectedEl.tagName.toLowerCase(),
          textContent: trimmedText,
          textContentEditable,
          textContentStats: {
            length: trimmedText.length,
            descendantElements,
          },
          computedStyle: {
            color: style.color,
            backgroundColor: style.backgroundColor,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            fontStyle: style.fontStyle,
            margin: style.margin,
            padding: style.padding,
            textAlign: style.textAlign
          },
          rect: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height
          }
        }, '*');
      }, true);

      window.addEventListener('message', (e) => {
        console.log('Iframe received message:', e.data.type, e.data.active);
        if (e.data.type === 'deleteElement') {
          if (selectedEl) {
            selectedEl.remove();
            selectedEl = null;
          }
        } else if (e.data.type === 'updateElement') {
          if (selectedEl) {
            if (e.data.prop === 'textContent') {
              selectedEl.textContent = e.data.value;
            } else {
              selectedEl.style[e.data.prop] = e.data.value;
            }
            const rect = selectedEl.getBoundingClientRect();
            window.parent.postMessage({ type: 'rectUpdated', rect }, '*');
          }
        } else if (e.data.type === 'setVisualEditActive') {
          window.parentVisualEditActive = e.data.active;
          console.log('Iframe Visual Edit Active:', window.parentVisualEditActive);
          if (!e.data.active) {
            if (lastHovered) {
              if (lastHovered !== selectedEl) lastHovered.classList.remove('ve-hover-outline');
              clearChildHoverOutlines(lastHovered);
            }
            if (selectedEl) selectedEl.classList.remove('ve-selected-outline');
            selectedEl = null;
          }
        }
      });

      window.parent.postMessage({ type: 'iframeReady' }, '*');
    })();
  </script>
</body>
</html>`,
    'tailwind.config.js': 'export default { content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"], theme: { extend: {} }, plugins: [] };',
    'postcss.config.js': 'export default { plugins: { tailwindcss: {}, autoprefixer: {} } };',
    'src/main.tsx': 'import { createRoot } from "react-dom/client"; import App from "./App.tsx"; import "./index.css"; createRoot(document.getElementById("root")).render(<App />);',
    'src/index.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;\nbody { margin: 0; background: #ffffff; color: #111111; font-family: system-ui, sans-serif; min-height: 100vh; }',
    'src/App.tsx': appTsx,
    [`src/components/${componentName}.jsx`]: (componentCss ? `import "./${componentName}.css";\n` : '') + componentCode.replace(/\.\/assets\//g, '/assets/'),
    [`src/components/${componentName}.css`]: componentCss || `/* ${componentName} */`,
  };

  // Add shadcn component + cn() utility
  if (hasShadcn) {
    files[`src/components/ui/${currentShadcnComponentName}.tsx`] = currentUpdatedShadcnSource;
    files['src/lib/utils.ts'] = 'import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\n\nexport function cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}\n';
  }

  // Add shadcn sub-components (composite delegation)
  if (currentShadcnSubComponents && currentShadcnSubComponents.length) {
    for (const sub of currentShadcnSubComponents) {
      files[`src/components/ui/${sub.shadcnComponentName}.tsx`] = sub.updatedShadcnSource;
    }
    // Ensure cn() utility is present even if no single shadcn component
    if (!hasShadcn) {
      files['src/lib/utils.ts'] = 'import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\n\nexport function cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}\n';
    }
  }

  // Chart components are inlined into the main React JSX — no separate files needed.
  if (assets && assets.length) {
    assets.forEach((a) => {
      files[`public/assets/${a.filename}`] = a.content;
    });
  }
  return toFileSystemTree(files);
}

/**
 * Build a variant grid App.tsx that renders ALL Figma variant combinations.
 * Reads axes from componentPropertyDefinitions (Figma metadata).
 */
function buildShadcnVariantGridApp(componentName, propDefs, variantMetadata) {
  // Parse variant axes from componentPropertyDefinitions
  const variantAxes = []; // { name, camel, values[], defaultValue }
  const sizeAxes = [];
  const stateAxes = [];
  const booleanProps = [];
  const stateKeywords = ['default', 'hover', 'focus', 'disabled', 'loading', 'active', 'pressed', 'error', 'selected', 'rest'];

  if (propDefs && typeof propDefs === 'object') {
    for (const [name, def] of Object.entries(propDefs)) {
      if (def && def.type === 'VARIANT' && Array.isArray(def.variantOptions)) {
        const lower = name.toLowerCase().trim();
        const vals = def.variantOptions;
        const lowerVals = vals.map(v => v.toLowerCase());

        // Detect state axis
        if (lower === 'state' || lowerVals.filter(v => stateKeywords.includes(v)).length >= 2) {
          stateAxes.push({ name, values: vals, defaultValue: def.defaultValue });
          continue;
        }
        // Detect size axis
        if (lower === 'size') {
          sizeAxes.push({ name, values: vals, defaultValue: def.defaultValue });
          continue;
        }
        // Everything else is a variant axis (Style, Type, Color, etc.)
        variantAxes.push({ name, values: vals, defaultValue: def.defaultValue });
      } else if (def && def.type === 'BOOLEAN') {
        booleanProps.push({ name, defaultValue: def.defaultValue });
      }
    }
  }

  const stateValues = stateAxes.length > 0 ? stateAxes[0].values : ['Default'];
  const sizeValues = sizeAxes.length > 0 ? sizeAxes[0].values : ['Default'];
  const variantValues = variantAxes.length > 0 ? variantAxes[0].values : ['Default'];
  const variantAxisName = variantAxes.length > 0 ? variantAxes[0].name : null;

  // Extra variant axes beyond the first (e.g. Avatar has Type + Shape)
  const extraVariantAxes = variantAxes.slice(1);

  // Parse actual CVA key names from the generated shadcn source to use the exact prop names
  // the LLM chose (instead of guessing from Figma axis names)
  const cvaKeys = {};
  if (currentUpdatedShadcnSource) {
    const cvaMatch = currentUpdatedShadcnSource.match(/variants\s*:\s*\{([\s\S]*?)\n\s*\}/);
    if (cvaMatch) {
      const variantBlock = cvaMatch[1];
      const keyMatches = variantBlock.matchAll(/^\s*(\w+)\s*:/gm);
      for (const m of keyMatches) {
        cvaKeys[m[1]] = true;
      }
    }
  }

  // Use the actual CVA key for variant prop — fall back to Figma axis name if not found
  let variantPropName = 'variant';
  if (cvaKeys['variant']) {
    variantPropName = 'variant';
  } else if (variantAxisName) {
    const camel = variantAxisName.charAt(0).toLowerCase() + variantAxisName.slice(1);
    variantPropName = cvaKeys[camel] ? camel : (Object.keys(cvaKeys).find(k => k !== 'size' && k !== 'state') || camel);
  }

  // Map extra variant axes to their CVA prop names
  const extraAxisPropNames = extraVariantAxes.map(ax => {
    const camel = ax.name.charAt(0).toLowerCase() + ax.name.slice(1);
    return cvaKeys[camel] ? camel : camel;
  });

  const sizePropName = 'size';
  const statePropName = 'state';

  // Build set of valid Figma variant combos for filtering
  // Format: sorted lowercase values joined by "|"
  let figmaComboSet = null;
  if (variantMetadata && Array.isArray(variantMetadata.variants) && variantMetadata.variants.length > 0) {
    const combos = [];
    for (const v of variantMetadata.variants) {
      const values = Object.values(v.props).map(val => String(val).toLowerCase()).sort();
      combos.push(values.join('|'));
    }
    figmaComboSet = new Set(combos);
  }

  // Track which axes are real (not fallback 'Default')
  const hasVariantAxis = variantAxes.length > 0;
  const hasStateAxis = stateAxes.length > 0;
  const hasSizeAxis = sizeAxes.length > 0;

  // Build cartesian product of extra variant axes values
  // e.g. if extraVariantAxes = [{name:'Shape', values:['Square','Circle']}]
  // then extraCombos = [['Square'], ['Circle']]
  let extraCombos = [[]];
  for (const ax of extraVariantAxes) {
    const newCombos = [];
    for (const prev of extraCombos) {
      for (const val of ax.values) {
        newCombos.push([...prev, val]);
      }
    }
    extraCombos = newCombos;
  }

  // Build list of valid combos (filter cartesian product against actual Figma variants)
  const allCombos = [];
  for (const variant of variantValues) {
    for (const state of stateValues) {
      for (const size of sizeValues) {
        for (const extra of extraCombos) {
          // Check if this combo exists in Figma
          if (figmaComboSet) {
            const keyParts = [];
            if (hasVariantAxis) keyParts.push(variant.toLowerCase());
            if (hasStateAxis) keyParts.push(state.toLowerCase());
            if (hasSizeAxis) keyParts.push(size.toLowerCase());
            for (const ev of extra) keyParts.push(ev.toLowerCase());
            const comboKey = keyParts.sort().join('|');
            if (!figmaComboSet.has(comboKey)) continue;
          }
          const combo = { variant, state, size };
          for (let i = 0; i < extra.length; i++) {
            combo[extraAxisPropNames[i]] = extra[i];
          }
          allCombos.push(combo);
        }
      }
    }
  }

  const totalCount = allCombos.length;
  const allCombosJson = JSON.stringify(allCombos);

  // Build extra axis prop assignments for JSX
  const extraPropAssignments = extraAxisPropNames.map(p => `                    ${p}={normalizeName(c.${p})}`).join('\n');
  const extraLabelParts = extraAxisPropNames.map(p => `\${c.${p}}`).join(' / ');
  const extraLabel = extraLabelParts ? ` / ${extraLabelParts}` : '';

  // Build the App component that renders only valid combos
  return `import ${componentName} from "./components/${componentName}";

const allCombos = ${allCombosJson};

// Normalize variant names: "Primary (Action Violet)" → "primary", "Filled in - Hover" → "filled-in-hover"
function normalizeName(name) {
  return name.trim().replace(/\\s*\\([^)]*\\)\\s*/g, '').toLowerCase().replace(/\\s*-\\s*/g, '-').replace(/\\s+/g, '-');
}

// Group combos by variant value for display
function groupByVariant(combos) {
  const groups = {};
  for (const c of combos) {
    if (!groups[c.variant]) groups[c.variant] = [];
    groups[c.variant].push(c);
  }
  return groups;
}

function App() {
  const grouped = groupByVariant(allCombos);
  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', background: '#f8f9fa', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: 700, color: '#1a1a1a' }}>
          ${componentName}
        </h1>
        <p style={{ margin: '0 0 20px', color: '#666', fontSize: '13px' }}>
          ${totalCount} variant combinations
        </p>
        {Object.entries(grouped).map(([variant, combos]) => (
          <div key={variant} style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#333', marginBottom: '12px', textTransform: 'capitalize' }}>
              {variant}
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              {combos.map((c, idx) => (
                <div key={idx} style={{ padding: '12px', background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', flexShrink: 0 }} data-variant-index={idx} data-variant-label={[c.variant, c.state, c.size].filter(Boolean).join(' / ')} data-variant-props={JSON.stringify(c)}>
                  <${componentName}
                    ${variantPropName}={normalizeName(c.variant)}
                    ${sizePropName}={normalizeName(c.size)}
                    ${statePropName}={normalizeName(c.state)}
${extraPropAssignments ? extraPropAssignments + '\n' : ''}                    onClose={() => {}}
                    checked={normalizeName(c.state) === 'checked' || normalizeName(c.state) === 'selected' || normalizeName(c.state) === 'on'}
                    onCheckedChange={() => {}}
                  />
                  <div style={{ fontSize: '9px', color: '#aaa', marginTop: '6px' }}>{c.state} / {c.size}${extraLabel}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
`;
}

function getTabKeyToWcPath() {
  if (!currentComponentName) return {};
  return {
    react: `src/components/${currentComponentName}.jsx`,
    mitosis: null,
  };
}

let _lastInstalledDeps = null; // Track installed dependency keys to skip redundant npm install
let _wcBootPromise = null; // Background pre-boot promise
let _wcBootedWithBaseDeps = false; // Whether base deps are already installed

/**
 * Normalize dependencies object into a deterministic sorted string for comparison.
 * Prevents false mismatches from key insertion order differences.
 */
function normalizeDeps(pkgJsonStr) {
  try {
    const pkg = JSON.parse(pkgJsonStr);
    const deps = pkg.dependencies || {};
    const devDeps = pkg.devDependencies || {};
    const sortedDeps = Object.keys(deps).sort().map(k => `${k}@${deps[k]}`).join(',');
    const sortedDevDeps = Object.keys(devDeps).sort().map(k => `${k}@${devDeps[k]}`).join(',');
    return `deps:${sortedDeps}|dev:${sortedDevDeps}`;
  } catch {
    return null;
  }
}

/**
 * Base dependencies that cover ~95% of conversions.
 * Pre-installed at page load so previews start instantly.
 */
const BASE_DEPS = {
  react: '^18.3.1',
  'react-dom': '^18.3.1',
  recharts: '^2.12.0',
  'class-variance-authority': '^0.7.0',
  clsx: '^2.1.0',
  'tailwind-merge': '^2.2.0',
  '@radix-ui/react-slot': '^1.0.2',
  'lucide-react': '^0.460.0',
  'react-day-picker': '^8.10.0',
  'date-fns': '^3.6.0',
};

const BASE_DEV_DEPS = {
  '@vitejs/plugin-react': '^4.3.4',
  autoprefixer: '^10.4.21',
  postcss: '^8.5.6',
  tailwindcss: '^3.4.17',
  vite: '^5.4.19',
};

/**
 * Pre-boot WebContainer and install base dependencies in the background.
 * Called on page load so deps are ready before the first conversion completes.
 */
function preBootWebContainer() {
  if (!isWebContainerSupported() || _wcBootPromise) return;
  _wcBootPromise = (async () => {
    try {
      const mod = await import(/* webpackIgnore: true */ WEBCONTAINER_CDN + '/+esm');
      const WebContainer = mod.WebContainer || mod.default?.WebContainer || mod.default;
      if (!WebContainer) return;
      webContainerInstance = await WebContainer.boot();
      webContainerInstance.on('error', () => { });

      // Mount a minimal project with base deps and install
      const basePkg = JSON.stringify({
        name: 'preview-app', private: true, version: '0.0.0', type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: BASE_DEPS,
        devDependencies: BASE_DEV_DEPS,
      });
      const baseTree = {
        'package.json': { file: { contents: basePkg } },
        'vite.config.ts': { file: { contents: 'import { defineConfig } from "vite"; import react from "@vitejs/plugin-react"; export default defineConfig({ plugins: [react()] });' } },
        'index.html': { file: { contents: '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>' } },
        src: {
          directory: {
            'main.tsx': { file: { contents: 'document.getElementById("root").textContent = "ready";' } },
          }
        },
      };
      await webContainerInstance.mount(baseTree);
      const installProc = await webContainerInstance.spawn('npm', ['install']);
      const exitCode = await installProc.exit;
      if (exitCode === 0) {
        _wcBootedWithBaseDeps = true;
        _lastInstalledDeps = normalizeDeps(basePkg);
      }
    } catch (e) {
      console.warn('WebContainer pre-boot failed:', e);
    }
  })();
}

// Kick off pre-boot immediately on page load
preBootWebContainer();

async function bootWebContainer(tree) {
  if (!isWebContainerSupported()) {
    throw new Error('WebContainers require Chrome or Edge.');
  }

  // Wait for pre-boot if in progress
  if (_wcBootPromise) {
    await _wcBootPromise;
  }

  const isFirstBoot = !webContainerInstance;
  if (isFirstBoot) {
    // Pre-boot didn't run or failed — boot now
    const mod = await import(/* webpackIgnore: true */ WEBCONTAINER_CDN + '/+esm');
    const WebContainer = mod.WebContainer || mod.default?.WebContainer || mod.default;
    if (!WebContainer) throw new Error('WebContainer API not loaded');
    webContainerInstance = await WebContainer.boot();
    webContainerInstance.on('error', (e) => {
      setPreviewError(e.message || 'WebContainer error');
    });
  }

  if (webContainerDevProcess) {
    webContainerDevProcess.kill?.();
    webContainerDevProcess = null;
  }

  setPreviewLoading(true, 'Mounting project...');
  await webContainerInstance.mount(tree);

  // Compare normalized dependency keys — skip install if unchanged
  const currentPkgJson = tree['package.json']?.file?.contents ?? null;
  const currentDepsKey = normalizeDeps(currentPkgJson);
  const needsInstall = !_lastInstalledDeps || _lastInstalledDeps !== currentDepsKey;

  if (needsInstall) {
    setPreviewLoading(true, 'Installing dependencies...');
    const installProc = await webContainerInstance.spawn('npm', ['install']);
    const installExit = await installProc.exit;
    if (installExit !== 0) throw new Error('npm install failed');
    _lastInstalledDeps = currentDepsKey;
  }

  setPreviewLoading(true, 'Starting preview...');
  const devProc = await webContainerInstance.spawn('npm', ['run', 'dev']);
  webContainerDevProcess = devProc;
  devProc.output.pipeTo(new WritableStream({ write() { } }));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Dev server timeout')), 60000);
    const unsub = webContainerInstance.on('server-ready', (port, url) => {
      clearTimeout(t);
      webContainerPreviewUrl = url;
      unsub();
      resolve(url);
    });
  });
}

async function writeWebContainerFiles(files) {
  if (!webContainerInstance) return;
  for (const [path, content] of Object.entries(files)) {
    if (webContainerLastWritten[path] === content) continue;
    await webContainerInstance.fs.writeFile(path, content);
    webContainerLastWritten[path] = content;
  }
}

function syncEditorToWebContainer() {
  if (!webContainerSyncEnabled || !webContainerInstance || !currentComponentName || !monacoEditor || !activeFile) return;
  if (activeFile !== 'react') return;
  const content = monacoEditor.getValue();
  const { code, css } = extractReactCodeAndCss(content);
  const componentCode = code.replace(/\.\/assets\//g, '/assets/');
  const hasCssImport = /import\s+['"]\.\/.+\.css['"]/.test(componentCode);
  const finalCode = hasCssImport ? componentCode : `import "./${currentComponentName}.css";\n` + componentCode;
  const wcPath = `src/components/${currentComponentName}.jsx`;
  const cssPath = `src/components/${currentComponentName}.css`;
  writeWebContainerFiles({
    [wcPath]: finalCode,
    [cssPath]: css || `/* ${currentComponentName} */`,
  }).catch(() => { });
}

// ── Complete ──
function handleSessionCreated(data) {
  const figmaUrl = figmaUrlInput.value.trim() || heroFigmaUrlInput.value.trim();
  currentSessionId = data.sessionId;
  currentProjectId = data.sessionId;
  activeConversionSessionId = data.sessionId;

  // Create placeholder project immediately so it appears in sidebar
  saveProject({
    id: data.sessionId,
    sessionId: data.sessionId,
    name: 'Converting...',
    figmaUrl,
    frameworks: getSelectedFrameworks(),
    frameworkOutputs: {},
    mitosisSource: '',
    thumbnail: generatePlaceholderThumbnail('Converting'),
    chatHistory: [],
    componentPropertyDefinitions: null,
    assets: [],
    templateWired: false,
    chartComponents: [],
    shadcnSubComponents: null,
    converting: true,
  });
}

function handleComplete(data) {
  const frameworks = data.frameworks || [];
  const completedSessionId = data.sessionId;
  const userSwitchedAway = currentProjectId !== completedSessionId;

  // Don't resurrect a project the user deleted while it was converting
  if (!getProject(completedSessionId)) {
    activeConversionSessionId = null;
    return;
  }

  // Always save completed project to localStorage (even if user switched away)
  saveProject({
    id: completedSessionId,
    sessionId: completedSessionId,
    name: data.componentName,
    figmaUrl: getProject(completedSessionId)?.figmaUrl || figmaUrlInput.value.trim() || heroFigmaUrlInput.value.trim(),
    frameworks,
    frameworkOutputs: data.frameworkOutputs || {},
    mitosisSource: data.mitosisSource || '',
    thumbnail: generatePlaceholderThumbnail(data.componentName),
    chatHistory: [],
    componentPropertyDefinitions: data.componentPropertyDefinitions || null,
    assets: data.assets || [],
    templateWired: Boolean(data.templateWired),
    chartComponents: data.chartComponents || [],
    shadcnSubComponents: data.shadcnSubComponents || null,
    updatedShadcnSource: data.updatedShadcnSource || null,
    shadcnComponentName: data.shadcnComponentName || null,
    variantMetadata: data.variantMetadata || null,
    elementMap: data.elementMap || null,
    converting: false,
  });

  activeConversionSessionId = null;

  // If user switched to a different project, don't touch the UI
  if (userSwitchedAway) return;

  setLoading(false);
  setStatus('done', 'Conversion complete');

  // Update free tier after successful conversion
  if (authEnabled) updateFreeTierDisplay();

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
  progressStepCount++;

  // Update collapsible header to done state and auto-collapse
  if (progressToggleTitle) progressToggleTitle.textContent = 'Generated ' + data.componentName;
  updateProgressBadge('done');
  collapseProgress();

  // Auto-collapse sidebar on completion (non-mobile)
  if (window.innerWidth > 768) {
    sidebar.classList.add('collapsed');
    updateSidebarToggleTitle();
    updateMenuButtonVisibility();
  }

  panelBody.scrollTop = panelBody.scrollHeight;

  // Store state
  currentSessionId = data.sessionId;
  currentFrameworkOutputs = data.frameworkOutputs || {};
  currentComponentName = data.componentName;
  templateWired = Boolean(data.templateWired);
  currentUpdatedShadcnSource = data.updatedShadcnSource || null;
  currentShadcnComponentName = data.shadcnComponentName || null;
  currentShadcnSubComponents = data.shadcnSubComponents || null;
  currentComponentPropertyDefs = data.componentPropertyDefinitions || null;
  currentVariantMetadata = data.variantMetadata || null;
  currentElementMap = data.elementMap || null;

  // Build code tabs (generated view)
  buildTabs(data);
  generatedTabsData = tabsData.map((t) => ({ ...t }));

  // When template was wired, show toggle and fetch wired app files, then auto-switch to Project view
  if (templateWired && codeViewModeEl) {
    codeViewModeEl.style.display = 'flex';
    apiFetch(`/api/session/${currentSessionId}/wired-app-files`)
      .then((r) => (r.ok ? r.json() : { files: {} }))
      .then((res) => {
        wiredAppFiles = res.files || {};
        if (Object.keys(wiredAppFiles).length > 0) {
          switchCodeViewMode('wired');
        }
      })
      .catch(() => { });
  } else if (codeViewModeEl) {
    codeViewModeEl.style.display = 'none';
  }

  // Show download and push buttons
  downloadBtn.style.display = 'inline-flex';
  const pushGithubBtn = document.getElementById('push-github-btn');
  if (pushGithubBtn) pushGithubBtn.style.display = 'inline-flex';

  startPreviewForSession(frameworks, data.chartComponents || []);

  // Initialize chat for iterative refinement
  initChat();
}

// ── Chat Refinement ──
const chatMessages = document.getElementById('chat-messages');
const chatInputGroup = document.getElementById('chat-input-group');
const urlInputGroup = document.getElementById('url-input-group');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatSpinner = document.getElementById('chat-spinner');
const chatSendIcon = document.getElementById('chat-send-icon');
const chatMicBtn = document.getElementById('chat-mic-btn');
let chatRefining = false;

const CHAT_TEXTAREA_MAX_PX = 220;
/** One line + padding floor when empty (browsers differ on scrollHeight after collapse) */
const CHAT_TEXTAREA_MIN_PX = 34;
/** Matches `placeholder` on #chat-input */
const CHAT_INPUT_PLACEHOLDER = 'Ask Nester…';

function resizeChatInput() {
  if (!chatInput) return;
  // Must collapse before reading scrollHeight: `height:auto` then scrollHeight often stays at the
  // previous tall box size, so an empty field keeps a multi-line height. Collapse first, then grow.
  chatInput.style.height = '0px';
  const next = Math.min(
    Math.max(chatInput.scrollHeight, CHAT_TEXTAREA_MIN_PX),
    CHAT_TEXTAREA_MAX_PX,
  );
  chatInput.style.height = `${next}px`;
}

function initChat() {
  if (!currentSessionId) return;
  // Switch input bar from URL to chat mode
  if (urlInputGroup) urlInputGroup.style.display = 'none';
  if (chatInputGroup) chatInputGroup.style.display = 'block';
  // Show chat messages container
  if (chatMessages) chatMessages.classList.add('visible');
  requestAnimationFrame(() => resizeChatInput());
}

function addChatMessage(role, content, skipPersist) {
  if (!chatMessages) return;
  const div = document.createElement('div');
  div.className = `chat-message chat-message--${role}`;
  if (role === 'system' && content.includes('...')) {
    div.innerHTML = `<div class="chat-loading-indicator"><div class="chat-loading-dots"><span></span><span></span><span></span></div></div>`;
  } else {
    div.textContent = content;
  }
  chatMessages.appendChild(div);
  // Persist to project history
  if (!skipPersist && currentProjectId && (role === 'user' || role === 'assistant')) {
    const p = getProject(currentProjectId);
    if (p) {
      const history = p.chatHistory || [];
      history.push({ role, content });
      updateProjectField(currentProjectId, { chatHistory: history });
    }
  }
  // Scroll to bottom
  const panelBodyEl = document.getElementById('panel-body');
  if (panelBodyEl) panelBodyEl.scrollTop = panelBodyEl.scrollHeight;
  return div;
}

function removeChatMessage(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

/** Build a descriptive title for the completion card */
function buildCompletionTitle() {
  // Check if this was a visual edit (lastUserRequestText contains visual edit summary)
  if (lastUserRequestText && lastUserRequestText.startsWith('Apply ') && lastUserRequestText.includes('visual edit')) {
    return lastUserRequestText;
  }
  if (lastUserRequestText) {
    const truncated = lastUserRequestText.length > 80
      ? lastUserRequestText.slice(0, 80).trim() + '...'
      : lastUserRequestText;
    return `Updated component: ${truncated}`;
  }
  return 'Component updated successfully.';
}

/** Derive list of changed files from refine response data */
function deriveFilesChanged(data) {
  const files = [];
  if (data && data.frameworkOutputs) {
    const name = currentComponentName || 'Component';
    const extMap = { react: '.jsx', vue: '.vue', svelte: '.svelte', angular: '.ts', solid: '.tsx' };
    for (const fw of Object.keys(data.frameworkOutputs)) {
      const ext = extMap[fw] || `.${fw}`;
      files.push(`${name}${ext}`);
    }
  }
  if (data && data.mitosisSource) {
    files.unshift(`${currentComponentName || 'Component'}.lite.tsx`);
  }
  if (data && data.updatedShadcnSource && currentShadcnComponentName) {
    files.push(`ui/${currentShadcnComponentName}.tsx`);
  }
  if (data && data.shadcnSubComponents) {
    for (const sub of data.shadcnSubComponents) {
      if (sub.shadcnComponentName) files.push(`ui/${sub.shadcnComponentName}.tsx`);
    }
  }
  return files;
}

/** Add a rich assistant response card (Lovable-style) */
function addRichAssistantMessage({ title, filesChanged, skipPersist }) {
  if (!chatMessages) return;
  const div = document.createElement('div');
  div.className = 'chat-message chat-message--assistant chat-message--rich';

  // Title
  const titleEl = document.createElement('div');
  titleEl.className = 'chat-card__title';
  titleEl.textContent = title || 'Component updated successfully.';
  div.appendChild(titleEl);

  // Files changed
  if (filesChanged && filesChanged.length > 0) {
    const filesEl = document.createElement('div');
    filesEl.className = 'chat-card__files';

    const fileToggle = document.createElement('button');
    fileToggle.className = 'chat-card__files-toggle';
    fileToggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 1h7l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.5"/></svg> ${filesChanged.length} file${filesChanged.length === 1 ? '' : 's'} changed`;
    fileToggle.addEventListener('click', () => {
      fileList.style.display = fileList.style.display === 'none' ? 'block' : 'none';
      fileToggle.classList.toggle('expanded');
    });
    filesEl.appendChild(fileToggle);

    const fileList = document.createElement('div');
    fileList.className = 'chat-card__file-list';
    fileList.style.display = 'none';
    for (const f of filesChanged) {
      const item = document.createElement('div');
      item.className = 'chat-card__file-item';
      item.textContent = f;
      fileList.appendChild(item);
    }
    filesEl.appendChild(fileList);
    div.appendChild(filesEl);
  }

  // Action buttons
  const actionsEl = document.createElement('div');
  actionsEl.className = 'chat-card__actions';

  // Undo button
  const undoBtn = document.createElement('button');
  undoBtn.className = 'chat-action-btn chat-action-btn--undo';
  undoBtn.title = 'Undo';
  undoBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
  undoBtn.addEventListener('click', () => undoLastRefinement(div));
  actionsEl.appendChild(undoBtn);

  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'chat-action-btn';
  copyBtn.title = 'Copy';
  copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  copyBtn.addEventListener('click', () => {
    const code = currentFrameworkOutputs.react || '';
    navigator.clipboard.writeText(code).then(() => {
      copyBtn.title = 'Copied!';
      setTimeout(() => { copyBtn.title = 'Copy'; }, 1500);
    });
  });
  actionsEl.appendChild(copyBtn);

  // Thumbs up
  const thumbsUpBtn = document.createElement('button');
  thumbsUpBtn.className = 'chat-action-btn';
  thumbsUpBtn.title = 'Good';
  thumbsUpBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>';
  thumbsUpBtn.addEventListener('click', () => { thumbsUpBtn.style.color = 'var(--success)'; });
  actionsEl.appendChild(thumbsUpBtn);

  // Thumbs down
  const thumbsDownBtn = document.createElement('button');
  thumbsDownBtn.className = 'chat-action-btn';
  thumbsDownBtn.title = 'Bad';
  thumbsDownBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>';
  thumbsDownBtn.addEventListener('click', () => { thumbsDownBtn.style.color = 'var(--error)'; });
  actionsEl.appendChild(thumbsDownBtn);

  div.appendChild(actionsEl);
  chatMessages.appendChild(div);

  // Persist to project history with meta
  if (!skipPersist && currentProjectId) {
    const p = getProject(currentProjectId);
    if (p) {
      const history = p.chatHistory || [];
      history.push({ role: 'assistant', content: title, meta: { filesChanged } });
      updateProjectField(currentProjectId, { chatHistory: history });
    }
  }

  // Scroll to bottom
  const panelBodyEl = document.getElementById('panel-body');
  if (panelBodyEl) panelBodyEl.scrollTop = panelBodyEl.scrollHeight;
  return div;
}

/** Predefined suggestion chip sets (rotated) */
const SUGGESTION_CHIP_SETS = [
  ['Make it responsive', 'Add hover effects', 'Improve accessibility'],
  ['Add dark mode support', 'Refine spacing', 'Add animations'],
  ['Optimize for mobile', 'Add loading state', 'Improve contrast'],
];
let suggestionChipSetIndex = 0;

/** Remove existing suggestion chips */
function removeSuggestionChips() {
  const existing = document.querySelectorAll('.chat-suggestions');
  existing.forEach(el => el.remove());
}

/** Add suggestion chips after a rich response */
function addSuggestionChips() {
  if (!chatMessages) return;
  removeSuggestionChips();

  const chips = SUGGESTION_CHIP_SETS[suggestionChipSetIndex % SUGGESTION_CHIP_SETS.length];
  suggestionChipSetIndex++;

  const container = document.createElement('div');
  container.className = 'chat-suggestions';
  for (const text of chips) {
    const chip = document.createElement('button');
    chip.className = 'chat-suggestion-chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      removeSuggestionChips();
      sendChatMessage(text);
    });
    container.appendChild(chip);
  }
  chatMessages.appendChild(container);

  // Scroll to bottom
  const panelBodyEl = document.getElementById('panel-body');
  if (panelBodyEl) panelBodyEl.scrollTop = panelBodyEl.scrollHeight;
}

/** Short labels for visual-edit CSS keys in chat summaries */
const VE_CSS_PROP_SUMMARY = {
  backgroundColor: 'background',
  color: 'text color',
  opacity: 'opacity',
  textAlign: 'alignment',
  borderRadius: 'radius',
  margin: 'margin',
  padding: 'padding',
  fontSize: 'font size',
  fontWeight: 'font weight',
  fontStyle: 'font style',
  boxShadow: 'shadow',
  borderColor: 'border color',
  borderWidth: 'border width',
  borderStyle: 'border style',
  display: 'display',
  flexDirection: 'layout',
  justifyContent: 'alignment',
  gap: 'gap',
  delete: 'remove',
};

function describePendingVisualEditItem(item) {
  if (!item) return '';
  if (item.changes && item.changes.delete) {
    return `${(item.tagName || 'element').toLowerCase()}: remove element`;
  }
  const keys = Object.keys(item.changes || {}).filter((k) => k !== 'delete');
  if (keys.length === 0) return `${(item.tagName || 'element').toLowerCase()}: (no props)`;
  const labels = keys.map((k) => VE_CSS_PROP_SUMMARY[k] || k.replace(/([A-Z])/g, ' $1').trim().toLowerCase());
  const maxLabels = 6;
  let tail = labels.slice(0, maxLabels).join(', ');
  if (labels.length > maxLabels) tail += ', …';
  return `${(item.tagName || 'element').toLowerCase()}: ${tail}`;
}

/** User-visible chat line when saving many iframe tweaks; full prompt goes to API only. */
function buildVisualEditsChatSummary(pendingVisualEdits) {
  const items = Object.values(pendingVisualEdits || {});
  const n = items.length;
  if (n === 0) return 'Apply visual edits to the code.';

  const variantLabels = items
    .map((i) => i.variantLabel)
    .filter(Boolean)
    .filter((v) => v !== 'undefined / undefined');
  const uniqueVariants = [...new Set(variantLabels)];

  let variantPart = '';
  if (uniqueVariants.length === 1) {
    variantPart = ` (variant ${uniqueVariants[0]})`;
  } else if (uniqueVariants.length > 1) {
    variantPart = ` (${uniqueVariants.length} variant contexts)`;
  }

  const parts = items.map(describePendingVisualEditItem);
  let detail = parts.join('; ');
  const maxLen = 240;
  if (detail.length > maxLen) {
    detail = detail.slice(0, maxLen - 1).trim() + '…';
  }

  return `Apply ${n} visual edit${n === 1 ? '' : 's'} to the code${variantPart}: ${detail}.`;
}

/** User-visible line for floating “Ask Nester” + refine. */
function buildFloatingRefineSummary(userPrompt, info) {
  const raw = (userPrompt || '').trim();
  if (!info) return raw || 'Refine the component.';
  const tag = (info.tagName || 'element').toLowerCase();
  let variant = '';
  if (info.variantLabel && info.variantLabel !== 'undefined / undefined') {
    variant = ` (${info.variantLabel})`;
  }
  const snippet = raw.length > 100 ? `${raw.slice(0, 100).trim()}…` : raw;
  return `Refine ${tag}${variant}: ${snippet || '…'}`;
}

function setChatLoading(loading) {
  chatRefining = loading;
  if (chatSpinner) chatSpinner.style.display = loading ? 'inline-block' : 'none';
  if (chatSendIcon) chatSendIcon.style.display = loading ? 'none' : 'inline';
  if (chatInput) chatInput.disabled = loading;
  if (chatSendBtn) chatSendBtn.disabled = loading;
}

function captureUndoSnapshot() {
  const snapshot = {
    frameworkOutputs: JSON.parse(JSON.stringify(currentFrameworkOutputs)),
    tabsDataSnapshot: tabsData.map(t => ({ ...t })),
    wiredAppFilesSnapshot: wiredAppFiles ? JSON.parse(JSON.stringify(wiredAppFiles)) : null,
  };
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
}

function undoLastRefinement(messageEl) {
  if (undoStack.length === 0) return;
  const snapshot = undoStack.pop();

  // Restore state
  currentFrameworkOutputs = snapshot.frameworkOutputs;
  tabsData = snapshot.tabsDataSnapshot;
  if (snapshot.wiredAppFilesSnapshot) wiredAppFiles = snapshot.wiredAppFilesSnapshot;

  // Update framework tab data
  for (const [fw, code] of Object.entries(currentFrameworkOutputs)) {
    const tab = tabsData.find(t => t.key === fw);
    if (tab) tab.code = code;
  }

  // Refresh Monaco if open
  if (activeFile && monacoEditor) {
    const currentTab = tabsData.find(t => t.key === activeFile);
    if (currentTab) monacoEditor.setValue(currentTab.code || '');
  }

  // Persist reverted outputs
  if (currentProjectId) {
    updateProjectField(currentProjectId, { frameworkOutputs: currentFrameworkOutputs });
  }

  // Update preview
  if (currentSessionId && previewFrame) {
    const reactCode = currentFrameworkOutputs.react || '';
    if (webContainerSyncEnabled && webContainerInstance && currentComponentName && reactCode) {
      const { code, css } = extractReactCodeAndCss(reactCode);
      const componentCode = code.replace(/\.\/assets\//g, '/assets/');
      const hasCssImport = /import\s+['"]\.\/.+\.css['"]/.test(componentCode);
      const finalCode = hasCssImport ? componentCode : `import "./${currentComponentName}.css";\n` + componentCode;
      const wcPath = `src/components/${currentComponentName}.jsx`;
      const cssPath = `src/components/${currentComponentName}.css`;
      delete webContainerLastWritten[wcPath];
      delete webContainerLastWritten[cssPath];
      syncFilesToWebContainer();
    } else {
      previewFrame.src = `/api/preview/${currentSessionId}?t=${Date.now()}`;
    }
  }

  // Disable the Undo button that was clicked
  if (messageEl) {
    const undoBtn = messageEl.querySelector('.chat-action-btn--undo');
    if (undoBtn) { undoBtn.disabled = true; undoBtn.style.opacity = '0.4'; }
  }

  addChatMessage('system', 'Reverted to previous version.');
}

function sendChatMessage(customText, savedSelectedElement, displayMessage) {
  if (chatRefining || !currentSessionId) return;

  // Capture undo snapshot before making changes
  captureUndoSnapshot();

  // Remove any existing suggestion chips
  removeSuggestionChips();

  let displayText;
  let apiPrompt;

  if (
    customText != null &&
    typeof customText === 'object' &&
    customText.prompt != null
  ) {
    apiPrompt = customText.prompt;
    displayText = customText.displayText != null ? customText.displayText : (typeof apiPrompt === 'string' ? apiPrompt : 'Visual edits applied');
  } else if (typeof customText === 'string') {
    apiPrompt = customText;
    displayText = customText;
  } else {
    apiPrompt = chatInput?.value?.trim();
    displayText = apiPrompt;
  }

  if (!apiPrompt) return;

  // Save the display text for building completion titles
  lastUserRequestText = typeof displayText === 'string' ? displayText : '';

  // User sees a short summary; API still receives the full engineered prompt when provided
  addChatMessage('user', displayText);
  if (chatInput) {
    chatInput.value = '';
    resizeChatInput();
  }

  // Show loading indicator
  setChatLoading(true);
  const loadingMsg = addChatMessage('system', 'Generating...');

  // Use saved selection (from floating prompt) or current global selection
  const selElement = savedSelectedElement || selectedElementInfo;
  const payload = { sessionId: currentSessionId };

  if (typeof apiPrompt === 'object' && apiPrompt._visualEdits) {
    // Batch visual-edit save — send only the edits map
    payload.visualEdits = apiPrompt._visualEdits;
  } else if (selElement && selElement.dataVeId) {
    // Floating prompt targeting a specific element — send raw text + targeting info
    payload.userRequest = typeof apiPrompt === 'string' ? apiPrompt : apiPrompt._rawText || apiPrompt;
    payload.dataVeId = selElement.dataVeId;
    if (selElement.variantLabel) payload.variantLabel = selElement.variantLabel;
    if (selElement.variantProps) payload.variantProps = selElement.variantProps;
  } else {
    // Regular chat — send raw user text
    payload.userRequest = apiPrompt;
  }

  const body = JSON.stringify(payload);

  if (refineAbortController) { refineAbortController.abort(); refineAbortController = null; }
  refineAbortController = new AbortController();

  apiFetch('/api/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: refineAbortController.signal,
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
          refineAbortController = null;
          setChatLoading(false);
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const eventStr of events) {
          if (!eventStr.trim()) continue;
          parseRefineSSEEvent(eventStr, loadingMsg);
        }
        readStream();
      }).catch((err) => {
        refineAbortController = null;
        if (err.name === 'AbortError') return; // intentional abort
        setChatLoading(false);
        removeChatMessage(loadingMsg);
        addChatMessage('system', `Connection lost: ${err.message}`);
      });
    }
    readStream();
  }).catch((err) => {
    refineAbortController = null;
    if (err.name === 'AbortError') return; // intentional abort
    setChatLoading(false);
    removeChatMessage(loadingMsg);
    addChatMessage('system', `Error: ${err.message}`);
  });
}

function parseRefineSSEEvent(eventStr, loadingMsg) {
  const lines = eventStr.split('\n');
  let eventType = '';
  let eventData = '';
  for (const line of lines) {
    if (line.startsWith('event: ')) eventType = line.slice(7);
    else if (line.startsWith('data: ')) eventData = line.slice(6);
  }
  if (!eventType || !eventData) return;
  let data;
  try { data = JSON.parse(eventData); } catch { return; }

  switch (eventType) {
    case 'step':
      // Update the loading message text
      if (loadingMsg) {
        loadingMsg.innerHTML = `<div class="chat-loading-indicator"><div class="chat-loading-dots"><span></span><span></span><span></span></div></div>`;
      }
      break;
    case 'chat_response':
      setChatLoading(false);
      removeChatMessage(loadingMsg);
      addChatMessage('assistant', data.message);
      break;
    case 'complete':
      setChatLoading(false);
      removeChatMessage(loadingMsg);
      handleRefineComplete(data);
      {
        const title = buildCompletionTitle();
        const filesChanged = deriveFilesChanged(data);
        addRichAssistantMessage({ title, filesChanged });
      }
      break;
    case 'error':
      setChatLoading(false);
      removeChatMessage(loadingMsg);
      addChatMessage('system', `Error: ${data.message}`);
      break;
  }
}

function handleRefineComplete(data) {
  console.log('[refine] handleRefineComplete called', {
    hasFrameworkOutputs: !!data.frameworkOutputs,
    hasMitosisSource: !!data.mitosisSource,
    frameworks: data.frameworkOutputs ? Object.keys(data.frameworkOutputs) : [],
    reactCodeLen: data.frameworkOutputs?.react?.length || 0,
  });

  // Update stored outputs
  if (data.frameworkOutputs) {
    currentFrameworkOutputs = data.frameworkOutputs;
  }
  if (data.elementMap) {
    currentElementMap = data.elementMap;
  }
  if (data.mitosisSource) {
    // Update the mitosis tab data
    const mitosisTab = tabsData.find(t => t.key === 'mitosis');
    if (mitosisTab) mitosisTab.code = data.mitosisSource;
  }
  // Update shadcn sub-component data when refined
  if (data.updatedShadcnSource) {
    currentUpdatedShadcnSource = data.updatedShadcnSource;
  }
  if (data.shadcnSubComponents) {
    currentShadcnSubComponents = data.shadcnSubComponents;
    // Update wired app files AND tab data for shadcn sub-components
    for (const sub of data.shadcnSubComponents) {
      if (sub.shadcnComponentName && sub.updatedShadcnSource) {
        const shadcnPath = `src/components/ui/${sub.shadcnComponentName}.tsx`;
        if (wiredAppFiles) wiredAppFiles[shadcnPath] = sub.updatedShadcnSource;
        // Also update the tab so the code editor shows the latest code
        const shadcnTab = tabsData.find(t => t.key === shadcnPath);
        if (shadcnTab) shadcnTab.code = sub.updatedShadcnSource;
      }
    }
  }
  // Update framework tab data
  for (const [fw, code] of Object.entries(currentFrameworkOutputs)) {
    const tab = tabsData.find(t => t.key === fw);
    if (tab) tab.code = code;
  }

  // Synchronize the refined AI output directly into the Editor's file explorer
  if (wiredAppFiles && currentComponentName && currentFrameworkOutputs.react) {
    const extracted = extractReactCodeAndCss(currentFrameworkOutputs.react);
    const componentCode = extracted.code.replace(/\.\/assets\//g, '/assets/');
    const hasCssImport = /import\s+['"]\.\/.+\.css['"]/.test(componentCode);
    const finalCode = hasCssImport ? componentCode : `import "./${currentComponentName}.css";\n` + componentCode;

    const wcPath = `src/components/${currentComponentName}.jsx`;
    wiredAppFiles[wcPath] = finalCode;

    const wiredTab = tabsData.find(t => t.key === wcPath);
    if (wiredTab) wiredTab.code = finalCode;

    if (extracted.css) {
      const cssPath = `src/components/${currentComponentName}.css`;
      wiredAppFiles[cssPath] = extracted.css;
      const cssTab = tabsData.find(t => t.key === cssPath);
      if (cssTab) cssTab.code = extracted.css;
    }
  }

  // Keep generatedTabsData in sync (for Generated/Wired toggle)
  generatedTabsData = tabsData.map(t => ({ ...t }));

  // Persist updated outputs to project history
  if (currentProjectId) {
    const update = { frameworkOutputs: currentFrameworkOutputs };
    if (data.elementMap) update.elementMap = data.elementMap;
    if (data.updatedShadcnSource) update.updatedShadcnSource = data.updatedShadcnSource;
    if (data.shadcnSubComponents) update.shadcnSubComponents = data.shadcnSubComponents;
    updateProjectField(currentProjectId, update);
  }

  // Clear stale visual-edit selection so the next click starts fresh
  selectedElementInfo = null;

  // Refresh Monaco if a tab is open, otherwise defer to switchMode
  if (activeFile && monacoEditor) {
    const currentTab = tabsData.find(t => t.key === activeFile);
    if (currentTab) {
      monacoEditor.setValue(currentTab.code || '');
    }
  } else {
    tabsNeedRefresh = true;
  }

  // Update preview
  const reactCode = currentFrameworkOutputs.react || '';
  console.log('[refine] preview update:', {
    webContainerSyncEnabled,
    hasWebContainer: !!webContainerInstance,
    componentName: currentComponentName,
    reactCodeLen: reactCode.length,
    sessionId: currentSessionId,
    previewFrameDisplay: previewFrame?.style?.display,
    previewFrameSrc: previewFrame?.src?.substring(0, 80),
  });

  if (currentSessionId && previewFrame) {
    const staticUrl = `/api/preview/${currentSessionId}?t=${Date.now()}`;

    if (webContainerSyncEnabled && webContainerInstance && currentComponentName && reactCode) {
      // WebContainer path: write updated component + CSS files
      const { code, css } = extractReactCodeAndCss(reactCode);
      const componentCode = code.replace(/\.\/assets\//g, '/assets/');
      const hasCssImport = /import\s+['"]\.\/.+\.css['"]/.test(componentCode);
      const finalCode = hasCssImport ? componentCode : `import "./${currentComponentName}.css";\n` + componentCode;
      const wcPath = `src/components/${currentComponentName}.jsx`;
      const cssPath = `src/components/${currentComponentName}.css`;
      delete webContainerLastWritten[wcPath];
      delete webContainerLastWritten[cssPath];

      // Also rewrite App.jsx with a new timestamp to force Vite full re-render
      const appJsxPath = 'src/App.jsx';
      const appJsx = `import ${currentComponentName} from "./components/${currentComponentName}";\n` +
        `// Refined: ${Date.now()}\n` +
        `function App() {\n  return (\n    <div className="p-6">\n` +
        `      <h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-4">${currentComponentName} Preview</h2>\n` +
        `      <${currentComponentName} />\n    </div>\n  );\n}\nexport default App;\n`;
      delete webContainerLastWritten[appJsxPath];

      // Include updated shadcn sub-component files so WebContainer serves the latest code
      const wcFiles = {
        [wcPath]: finalCode,
        [cssPath]: css || `/* ${currentComponentName} */`,
        [appJsxPath]: appJsx,
      };
      if (data.updatedShadcnSource && currentShadcnComponentName) {
        const shadcnPath = `src/components/ui/${currentShadcnComponentName}.tsx`;
        wcFiles[shadcnPath] = data.updatedShadcnSource;
        delete webContainerLastWritten[shadcnPath];
      }
      if (data.shadcnSubComponents) {
        for (const sub of data.shadcnSubComponents) {
          const shadcnPath = `src/components/ui/${sub.shadcnComponentName}.tsx`;
          wcFiles[shadcnPath] = sub.updatedShadcnSource;
          delete webContainerLastWritten[shadcnPath];
        }
      }
      writeWebContainerFiles(wcFiles).then(() => {
        // Force reload after Vite processes file changes
        setTimeout(() => {
          if (previewFrame && webContainerPreviewUrl) {
            const url = webContainerPreviewUrl;
            replacePreviewIframe('about:blank');
            setTimeout(() => { replacePreviewIframe(url); }, 150);
          }
        }, 2000);
      }).catch(() => {
        replacePreviewIframe(staticUrl);
      });
    } else {
      // Static preview path: reload iframe
      replacePreviewIframe(staticUrl);
    }
  }
}

// Chat input events
if (chatSendBtn) {
  chatSendBtn.addEventListener('click', () => sendChatMessage());
}
if (chatInput) {
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  chatInput.addEventListener('input', () => resizeChatInput());
  resizeChatInput();
}

if (chatMicBtn && chatInput) {
  chatMicBtn.addEventListener('click', () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      window.alert('Speech recognition is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    if (chatMicBtn.classList.contains('recording')) return;

    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    const cleanup = () => {
      chatMicBtn.classList.remove('recording');
      chatMicBtn.setAttribute('aria-label', 'Voice input');
      chatInput.placeholder = CHAT_INPUT_PLACEHOLDER;
    };

    recognition.onstart = () => {
      chatMicBtn.classList.add('recording');
      chatMicBtn.setAttribute('aria-label', 'Listening…');
      chatInput.placeholder = 'Listening… speak now';
    };

    recognition.onresult = (event) => {
      let piece = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        piece += event.results[i][0].transcript;
      }
      piece = piece.trim();
      if (!piece) return;
      const cur = chatInput.value.trim();
      chatInput.value = cur ? `${cur} ${piece}` : piece;
      resizeChatInput();
    };

    recognition.onerror = () => {
      cleanup();
      chatInput.focus();
    };

    recognition.onend = () => {
      cleanup();
      chatInput.focus();
    };

    try {
      recognition.start();
    } catch {
      cleanup();
    }
  });
}

// ── Monaco Editor ──
const MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min';

function getMonacoLanguage(ext) {
  if (ext.endsWith('.tsx') || ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.jsx') || ext.endsWith('.js')) return 'javascript';
  if (ext.endsWith('.vue') || ext.endsWith('.svelte')) return 'html';
  if (ext.endsWith('.html')) return 'html';
  if (ext.endsWith('.css')) return 'css';
  if (ext.endsWith('.json')) return 'json';
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

let monacoLoading = false;
function initMonaco(callback) {
  if (monacoReady && monacoEditor) {
    callback?.();
    return;
  }
  if (monacoLoading) {
    // Already loading — queue callback for when it finishes
    const waitForMonaco = setInterval(() => {
      if (monacoReady && monacoEditor) {
        clearInterval(waitForMonaco);
        callback?.();
      }
    }, 100);
    return;
  }
  monacoLoading = true;
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
    monacoLoading = false;
    let syncDebounce = null;
    monacoEditor.onDidChangeModelContent(() => {
      if (!webContainerSyncEnabled) return;
      if (syncDebounce) clearTimeout(syncDebounce);
      syncDebounce = setTimeout(() => {
        syncDebounce = null;
        syncEditorToWebContainer();
      }, 500);
    });
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
  if (mode === 'code' && window.isVisualEditMode) {
    toggleVisualEditMode(false);
  }
  if (mode === 'code') {
    if (tabsNeedRefresh && activeFile && monacoEditor) {
      const currentTab = tabsData.find(t => t.key === activeFile);
      if (currentTab) monacoEditor.setValue(currentTab.code || '');
      tabsNeedRefresh = false;
    }
    requestAnimationFrame(() => {
      layoutMonaco();
      requestAnimationFrame(layoutMonaco);
    });
  }
}

// ── File Explorer & Editor Tabs ──
/** Build a tree from flat paths: { children: { 'src': { children: { 'App.tsx': { path: 'src/App.tsx' } } }, 'index.html': { path: 'index.html' } } } */
function pathsToTree(paths) {
  const root = { children: {} };
  for (const path of paths) {
    const parts = path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      if (i === parts.length - 1) {
        current.children[name] = { path, leaf: true };
      } else {
        if (!current.children[name] || current.children[name].leaf) {
          current.children[name] = { children: {} };
        }
        current = current.children[name];
      }
    }
  }
  return root;
}

function renderWiredExplorerTree(container, node, folderPath = '') {
  const entries = Object.entries(node.children || {}).sort(([a, aVal], [b, bVal]) => {
    const aIsFolder = !aVal.leaf;
    const bIsFolder = !bVal.leaf;
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
  for (const [name, value] of entries) {
    if (value.leaf) {
      const path = value.path;
      const { icon: iconValue, class: iconClass } = getWiredFileIcon(path);
      const item = document.createElement('div');
      item.className = 'explorer-file';
      item.dataset.key = path;
      item.innerHTML = `
        <span class="explorer-file-icon explorer-file-icon--${escapeHtml(iconClass)}">${renderExplorerIcon(iconValue, 16)}</span>
        <span class="explorer-file-name">${escapeHtml(name)}</span>
      `;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        openFile(path);
      });
      container.appendChild(item);
    } else {
      const pathPrefix = folderPath ? `${folderPath}/${name}` : name;
      const isExpanded = wiredExplorerExpanded.has(pathPrefix);
      const folderRow = document.createElement('div');
      folderRow.className = 'explorer-folder';
      folderRow.dataset.folderPath = pathPrefix;
      const chevronVal = isExpanded ? explorerIconConfig.chevron.down : explorerIconConfig.chevron.right;
      const folderVal = isExpanded ? explorerIconConfig.folder.open : explorerIconConfig.folder.closed;
      folderRow.innerHTML = `
        <span class="explorer-folder-chevron" aria-hidden="true">${renderExplorerIcon(chevronVal, 10)}</span>
        <span class="explorer-folder-icon">${renderExplorerIcon(folderVal, 16)}</span>
        <span class="explorer-folder-name">${escapeHtml(name)}</span>
      `;
      folderRow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (wiredExplorerExpanded.has(pathPrefix)) {
          wiredExplorerExpanded.delete(pathPrefix);
        } else {
          wiredExplorerExpanded.add(pathPrefix);
        }
        buildExplorer();
      });
      container.appendChild(folderRow);
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'explorer-folder-children';
      if (isExpanded) {
        childrenContainer.style.display = 'block';
        renderWiredExplorerTree(childrenContainer, value, pathPrefix);
      } else {
        childrenContainer.style.display = 'none';
      }
      container.appendChild(childrenContainer);
    }
  }
}

function buildExplorer() {
  explorerFiles.innerHTML = '';
  if (codeViewMode === 'wired' && Object.keys(wiredAppFiles).length > 0) {
    const paths = Object.keys(wiredAppFiles).sort();
    const tree = pathsToTree(paths);
    renderWiredExplorerTree(explorerFiles, tree);
  } else {
    tabsData.forEach((tab) => {
      const displayName = codeViewMode === 'wired' ? tab.key : currentComponentName + tab.ext;
      const item = document.createElement('div');
      item.className = 'explorer-file';
      item.dataset.key = tab.key;
      item.innerHTML = `
        <span class="explorer-file-icon">${getFileIcon(tab.ext)}</span>
        <span class="explorer-file-name">${escapeHtml(displayName)}</span>
      `;
      item.addEventListener('click', () => openFile(tab.key));
      explorerFiles.appendChild(item);
    });
  }
}

/** Resolve file icon from config (explorer-icons.config.json) with fallback. Returns { icon, class } for render. */
function getWiredFileIcon(path) {
  const name = path.split('/').pop() || '';
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')) : '';
  const lower = name.toLowerCase();
  const icons = explorerIconConfig.fileIcons;
  let icon = icons.default;
  if (lower === '.env' || lower === '.env.example' || lower.endsWith('.env')) icon = icons['.env.example'] ?? 'icon-file-env';
  else if (lower === '.gitignore') icon = icons['.gitignore'] ?? 'icon-file-gitignore';
  else if (lower === 'config.toml' || lower.endsWith('config.toml')) icon = icons['config.toml'] ?? 'icon-file-config';
  else if (lower.startsWith('vite.config')) icon = icons['vite.config'] ?? 'icon-file-vite';
  else if (lower.endsWith('tailwind.config.ts') || lower.endsWith('postcss.config.js') || lower.endsWith('eslint.config.js')) icon = icons['config.toml'] ?? 'icon-file-config';
  else if (icons[ext] !== undefined) icon = icons[ext];
  else if (ext === '.html') icon = icons['.html'] ?? 'icon-file-html';
  else if (ext === '.ts' || ext === '.tsx') icon = icons['.ts'] ?? icons['.tsx'] ?? 'icon-file-ts';
  else if (ext === '.js' || ext === '.jsx') icon = icons['.js'] ?? icons['.jsx'] ?? 'icon-file-js';
  else if (ext === '.svg') icon = icons['.svg'] ?? 'icon-file-svg';
  else if (ext === '.css') icon = icons['.css'] ?? 'icon-file-css';
  else if (ext === '.md') icon = icons['.md'] ?? 'icon-file-md';
  else if (ext === '.json') icon = icons['.json'] ?? 'icon-file-json';
  const colorClass = icon && icon.startsWith('emoji:') ? 'doc' : (String(icon).replace('icon-file-', '') || 'doc');
  return { icon: icon || 'icon-file-doc', class: colorClass };
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
    const tabLabel = codeViewMode === 'wired' ? tab.key : currentComponentName + tab.ext;
    const el = document.createElement('div');
    el.className = `editor-tab${key === activeFile ? ' active' : ''}`;
    el.dataset.key = key;
    el.innerHTML = `
      <span class="editor-tab-name">${escapeHtml(tabLabel)}</span>
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
  const canEdit = hasCode && codeViewMode === 'generated';
  codeEditBtn.disabled = !canEdit;
  codeSaveBtn.disabled = !canEdit;
  codeCopyBtn.disabled = !hasCode;
  if (!hasCode) {
    setEditMode(false);
  } else if (codeViewMode === 'wired' && isEditMode) {
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
  tabsNeedRefresh = false;
  setEditMode(false);

  document.querySelectorAll('.editor-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.key === key);
  });
  document.querySelectorAll('.explorer-file').forEach((el) => {
    el.classList.toggle('active', el.dataset.key === key);
  });
  document.querySelectorAll('.explorer-folder').forEach((el) => el.classList.remove('active'));

  if (monacoEditor && typeof monaco !== 'undefined') {
    monacoEditor.setValue(tab.code || '');
    monaco.editor.setModelLanguage(monacoEditor.getModel(), getMonacoLanguage(tab.ext));
    // Mitosis .lite.tsx uses non-standard syntax; framework outputs use standard syntax
    setMonacoValidation(key !== 'mitosis');
  }

  layoutMonaco();
  updateCodeActionsState();

  // Persist UI state
  if (currentProjectId) {
    updateProjectField(currentProjectId, { activeFile, openFiles: [...openFiles] });
  }
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

  // Persist UI state
  if (currentProjectId) {
    updateProjectField(currentProjectId, { activeFile, openFiles: [...openFiles] });
  }
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

  if (explorerSectionTitle) explorerSectionTitle.textContent = 'Components';
  buildExplorer();
  buildEditorTabs();

  initMonaco(() => {
    if (firstKey) openFile(firstKey);
    updateCodeActionsState();
    layoutMonaco();
  });
}

function switchCodeViewMode(mode) {
  if (mode === codeViewMode) return;
  // When leaving generated view, persist current editor content into generatedTabsData
  if (codeViewMode === 'generated' && activeFile && monacoEditor) {
    const tab = tabsData.find((t) => t.key === activeFile);
    if (tab) tab.code = monacoEditor.getValue();
    generatedTabsData = tabsData.map((t) => ({ ...t }));
  }
  codeViewMode = mode;
  // Persist code view mode
  if (currentProjectId) {
    updateProjectField(currentProjectId, { codeViewMode: mode });
  }
  document.querySelectorAll('.code-view-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  if (explorerSectionTitle) {
    explorerSectionTitle.textContent = mode === 'wired' ? 'Project' : 'Components';
  }
  if (mode === 'wired') {
    const paths = Object.keys(wiredAppFiles).sort();
    tabsData = paths.map((path) => ({
      key: path,
      label: path,
      code: wiredAppFiles[path] || '',
      ext: path.includes('.') ? path.slice(path.lastIndexOf('.')) : '',
    }));
  } else {
    tabsData = generatedTabsData.map((t) => ({ ...t }));
  }
  const firstKey = tabsData[0]?.key;
  openFiles = firstKey ? [firstKey] : [];
  activeFile = firstKey;
  buildExplorer();
  buildEditorTabs();
  if (monacoEditor && firstKey) {
    openFile(firstKey);
  } else if (monacoEditor) {
    monacoEditor.setValue('');
  }
  updateCodeActionsState();
  layoutMonaco();
}

// ── Explorer Toggle ──
explorerToggle.addEventListener('click', () => {
  codeExplorer.classList.toggle('collapsed');
  requestAnimationFrame(layoutMonaco);
});

// ── Code view mode (Components | Project) ──
document.querySelectorAll('.code-view-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === 'generated' || mode === 'wired') switchCodeViewMode(mode);
  });
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
    const res = await apiFetch('/api/save-file', {
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

    if (webContainerSyncEnabled && activeFile === 'react') {
      syncEditorToWebContainer();
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
function performDownload() {
  if (!currentSessionId) return;
  apiFetch(`/api/download/${currentSessionId}`)
    .then((r) => {
      if (r.status === 401) { showLoginModal(performDownload); return; }
      if (!r.ok) throw new Error('Download failed');
      return r.blob();
    })
    .then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentComponentName || 'component'}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    })
    .catch((e) => console.error('Download error:', e));
}

downloadBtn.addEventListener('click', () => {
  if (!currentSessionId) return;
  if (authEnabled && !isAuthenticated) {
    showLoginModal(performDownload);
    return;
  }
  performDownload();
});

if (previewReload) {
  previewReload.addEventListener('click', () => {
    if (previewFrame.src && previewFrame.src !== 'about:blank') {
      replacePreviewIframe(previewFrame.src);
    }
  });
}

// ── Push to GitHub ──
const GITHUB_TOKEN_KEY = 'github_token';
const GITHUB_OAUTH_STATE_KEY = 'github_oauth_state';

function getGitHubToken() {
  return sessionStorage.getItem(GITHUB_TOKEN_KEY) || '';
}
function setGitHubToken(token) {
  if (token?.trim()) sessionStorage.setItem(GITHUB_TOKEN_KEY, token.trim());
  else sessionStorage.removeItem(GITHUB_TOKEN_KEY);
}

function normalizeRepoDirectory(input) {
  const normalized = input.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\/+/, '');
  if (normalized === '') return '';
  if (normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\0')) return null;
  const segments = normalized.split('/').filter(Boolean);
  const SAFE = /^[A-Za-z0-9._-]+$/;
  if (segments.length === 0 || segments.some((s) => !SAFE.test(s))) return null;
  return segments.join('/');
}

function buildRepoPath(directory, filePath) {
  if (!filePath || filePath.includes('..') || filePath.includes('\\') || filePath.includes('\0')) return null;
  const safeDir = normalizeRepoDirectory(directory);
  if (safeDir === null) return null;
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const SAFE = /^[A-Za-z0-9._-]+$/;
  if (parts.some((p) => !SAFE.test(p))) return null;
  return safeDir ? `${safeDir}/${parts.join('/')}` : parts.join('/');
}

function humanizeGitHubError(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  if (raw.includes('already exists')) {
    return 'A repository with this name already exists on your GitHub account. Please choose a different name or switch to the "Existing Repo" tab to push to an existing repository.';
  }
  if (raw.includes('401') || raw.toLowerCase().includes('unauthorized') || raw.toLowerCase().includes('bad credentials')) {
    return 'GitHub authentication failed. Please disconnect and reconnect your GitHub account.';
  }
  if (raw.includes('403') || raw.toLowerCase().includes('forbidden')) {
    return 'You do not have permission to push to this repository.';
  }
  return raw;
}

async function getFunctionErrorMessage(err, fallback) {
  if (!(err instanceof Error)) return fallback;
  const ctx = err.context;
  if (ctx instanceof Response) {
    try {
      const json = await ctx.clone().json();
      if (typeof json?.error === 'string' && json.error.trim()) return humanizeGitHubError(json.error);
      if (typeof json?.message === 'string' && json.message.trim()) return humanizeGitHubError(json.message);
    } catch {
      try {
        const text = await ctx.clone().text();
        if (text.trim()) return humanizeGitHubError(text);
      } catch { }
    }
  }
  return humanizeGitHubError(err.message) || fallback;
}

function initGitHubDialog() {
  const overlay = document.getElementById('github-dialog-overlay');
  const closeBtn = document.getElementById('github-dialog-close');
  const pushGithubBtn = document.getElementById('push-github-btn');
  const connectSection = document.getElementById('github-connect-section');
  const oauthSection = document.getElementById('github-oauth-section');
  const connectBtn = document.getElementById('github-connect-btn');
  const connectSpinner = document.getElementById('github-connect-spinner');
  const connectIcon = document.getElementById('github-connect-icon');
  const patInput = document.getElementById('github-pat-input');
  const patBtn = document.getElementById('github-pat-btn');
  const errorEl = document.getElementById('github-error');
  const successEl = document.getElementById('github-success');
  const successLink = document.getElementById('github-success-link');
  const formEl = document.getElementById('github-form');
  const usernameEl = document.getElementById('github-username');
  const disconnectBtn = document.getElementById('github-disconnect');
  const tabExisting = document.getElementById('github-tab-existing');
  const tabNew = document.getElementById('github-tab-new');
  const repoList = document.getElementById('github-repo-list');
  const newRepoInput = document.getElementById('github-new-repo');
  const privateCheckbox = document.getElementById('github-repo-private');
  const directoryInput = document.getElementById('github-directory');
  const dirError = document.getElementById('github-directory-error');
  const commitMsgInput = document.getElementById('github-commit-msg');
  const filesCountEl = document.getElementById('github-files-count');
  const filesListEl = document.getElementById('github-files-list');
  const pushBtn = document.getElementById('github-push-btn');
  const pushSpinner = document.getElementById('github-push-spinner');
  const pushIcon = document.getElementById('github-push-icon');
  const pushBtnText = document.getElementById('github-push-btn-text');

  let githubFiles = [];
  let repos = [];
  let selectedRepo = null;
  let githubTab = 'existing';
  let filesLoading = false;

  function showError(msg) {
    errorEl.textContent = msg || '';
    errorEl.style.display = msg ? 'block' : 'none';
  }

  function setConnectLoading(loading) {
    connectBtn.disabled = loading;
    connectSpinner.style.display = loading ? 'inline-block' : 'none';
    connectIcon.style.display = loading ? 'none' : 'inline';
  }

  function setPushLoading(loading) {
    pushBtn.disabled = loading;
    pushSpinner.style.display = loading ? 'inline-block' : 'none';
    pushIcon.style.display = loading ? 'none' : 'inline';
    pushBtnText.textContent = loading ? 'Pushing...' : githubTab === 'new' ? 'Create & Push' : 'Push to Repository';
  }

  function openDialog() {
    if (!currentSessionId || !currentComponentName) return;
    showError('');
    successEl.style.display = 'none';
    githubTab = 'existing';
    selectedRepo = null;
    newRepoInput.value = currentComponentName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    commitMsgInput.value = `feat: add ${currentComponentName} component`;
    directoryInput.value = templateWired ? '' : 'src/components';
    dirError.style.display = 'none';
    document.querySelectorAll('.github-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'existing'));
    tabExisting.style.display = 'block';
    tabNew.style.display = 'none';

    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('visible');

    githubFiles = [];
    filesLoading = true;
    filesCountEl.textContent = '…';
    filesListEl.innerHTML = '';
    updatePushState();

    const pushMode = templateWired ? 'wired' : codeViewMode;
    apiFetch(`/api/session/${currentSessionId}/push-files?mode=${pushMode}`)
      .then((r) => r.json())
      .then((data) => {
        githubFiles = data.files || [];
        filesCountEl.textContent = githubFiles.length;
        if (pushMode === 'wired') {
          directoryInput.value = '';
        } else {
          directoryInput.value = 'src/components';
        }
        filesLoading = false;
        updatePushState();
        const dir = directoryInput.value;
        const prefix = dir ? dir + '/' : '';
        filesListEl.innerHTML = githubFiles.map((f) => `<div>${escapeHtml(prefix + f.name)}</div>`).join('');
      })
      .catch(() => {
        githubFiles = [];
        filesLoading = false;
        filesCountEl.textContent = '0';
        filesListEl.innerHTML = '';
        updatePushState();
      });

    apiFetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.githubPushConfigured) {
          oauthSection.style.display = 'block';
          connectBtn.disabled = false;
        } else {
          oauthSection.style.display = 'none';
        }
        patInput.value = '';
        const token = getGitHubToken();
        if (!token) {
          connectSection.style.display = 'block';
          formEl.style.display = 'none';
          return;
        }
        connectSection.style.display = 'none';
        formEl.style.display = 'block';
        successEl.style.display = 'none';
        fetchReposAndUser(token);
      })
      .catch(() => {
        oauthSection.style.display = 'none';
        connectSection.style.display = 'block';
        formEl.style.display = 'none';
      });
  }

  function closeDialog() {
    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('visible');
  }

  async function apiJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data?.error || `Request failed: ${response.status}`);
      err.context = response;
      throw err;
    }
    return data;
  }

  async function fetchReposAndUser(token) {
    try {
      const [reposData, userData] = await Promise.all([
        apiFetch('/api/github/repos', { headers: { 'x-github-token': token } }).then(apiJson),
        apiFetch('/api/github/user', { headers: { 'x-github-token': token } }).then(apiJson),
      ]);
      repos = Array.isArray(reposData) ? reposData : [];
      usernameEl.textContent = userData?.login || 'Unknown';
      renderRepoList();
    } catch (e) {
      showError(await getFunctionErrorMessage(e, 'Failed to fetch repos'));
    }
  }

  function renderRepoList() {
    repoList.innerHTML = repos
      .map(
        (r) =>
          `<button type="button" class="github-repo-item${selectedRepo?.id === r.id ? ' selected' : ''}" data-id="${r.id}">${r.private ? '🔒' : '🌐'} ${escapeHtml(r.full_name)}</button>`
      )
      .join('');
    repoList.querySelectorAll('.github-repo-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedRepo = repos.find((x) => x.id === parseInt(btn.dataset.id, 10));
        renderRepoList();
        updatePushState();
      });
    });
  }

  function updatePushState() {
    const dir = directoryInput.value;
    const validDir = normalizeRepoDirectory(dir) !== null;
    dirError.style.display = validDir ? 'none' : 'block';
    const canPush =
      !filesLoading &&
      validDir &&
      (githubTab === 'existing' ? selectedRepo : newRepoInput.value.trim());
    pushBtn.disabled = !canPush;
  }

  directoryInput.addEventListener('input', () => {
    updatePushState();
    const dir = directoryInput.value;
    const prefix = dir ? dir + '/' : '';
    filesListEl.innerHTML = githubFiles.map((f) => `<div>${escapeHtml(prefix + f.name)}</div>`).join('');
  });
  newRepoInput.addEventListener('input', updatePushState);

  document.querySelectorAll('.github-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      githubTab = btn.dataset.tab;
      document.querySelectorAll('.github-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === githubTab));
      tabExisting.style.display = githubTab === 'existing' ? 'block' : 'none';
      tabNew.style.display = githubTab === 'new' ? 'block' : 'none';
      pushBtnText.textContent = githubTab === 'new' ? 'Create & Push' : 'Push to Repository';
      updatePushState();
    });
  });

  connectBtn.addEventListener('click', async () => {
    setConnectLoading(true);
    showError('');
    try {
      const redirectUri = `${window.location.origin}/auth/github/callback`;
      const data = await apiFetch('/api/github/oauth-url?redirect_uri=' + encodeURIComponent(redirectUri)).then(apiJson);
      if (!data?.url || !data?.state) throw new Error('GitHub OAuth is not configured.');
      sessionStorage.setItem(GITHUB_OAUTH_STATE_KEY, data.state);
      const popup = window.open(data.url, 'github-oauth', 'width=620,height=720');
      if (!popup) throw new Error('Popup blocked. Allow popups and try again.');
      popup.focus();
    } catch (e) {
      showError(await getFunctionErrorMessage(e, 'Failed to start GitHub OAuth'));
    } finally {
      setConnectLoading(false);
    }
  });

  patBtn.addEventListener('click', async () => {
    const pat = patInput.value.trim();
    if (!pat) {
      showError('Please enter a Personal Access Token.');
      return;
    }
    patBtn.disabled = true;
    patBtn.textContent = 'Validating...';
    showError('');
    try {
      await apiFetch('/api/github/user', { headers: { 'x-github-token': pat } }).then(apiJson);
      setGitHubToken(pat);
      connectSection.style.display = 'none';
      formEl.style.display = 'block';
      successEl.style.display = 'none';
      await fetchReposAndUser(pat);
    } catch (e) {
      showError('Invalid token — ensure it has the repo scope.');
    } finally {
      patBtn.disabled = false;
      patBtn.textContent = 'Connect';
    }
  });

  patInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') patBtn.click();
  });

  window.addEventListener('message', async (e) => {
    if (e.origin !== window.location.origin) return;
    const p = e.data;
    if (!p || p.type !== 'github-oauth') return;
    if (p.error) {
      showError(`GitHub OAuth failed: ${p.error}`);
      return;
    }
    if (!p.code || !p.state) {
      showError('OAuth callback missing required parameters.');
      return;
    }
    const expected = sessionStorage.getItem(GITHUB_OAUTH_STATE_KEY);
    sessionStorage.removeItem(GITHUB_OAUTH_STATE_KEY);
    if (!expected || expected !== p.state) {
      showError('OAuth state mismatch. Try connecting again.');
      return;
    }
    setConnectLoading(true);
    showError('');
    try {
      const data = await apiFetch('/api/github/exchange-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: p.code, redirectUri: `${window.location.origin}/auth/github/callback` }),
      }).then(apiJson);
      const token = data?.accessToken;
      if (!token) throw new Error('No access token returned.');
      setGitHubToken(token);
      connectSection.style.display = 'none';
      formEl.style.display = 'block';
      successEl.style.display = 'none';
      await fetchReposAndUser(token);
    } catch (e) {
      showError(await getFunctionErrorMessage(e, 'Failed to exchange OAuth code'));
    } finally {
      setConnectLoading(false);
    }
  });

  disconnectBtn.addEventListener('click', () => {
    setGitHubToken('');
    repos = [];
    selectedRepo = null;
    connectSection.style.display = 'block';
    formEl.style.display = 'none';
  });

  pushBtn.addEventListener('click', async () => {
    const token = getGitHubToken();
    if (!token) return;
    setPushLoading(true);
    showError('');
    successEl.style.display = 'none';
    try {
      let owner = usernameEl.textContent;
      let repo = '';
      let branch = 'main';

      if (githubTab === 'new') {
        const name = newRepoInput.value.trim();
        if (!name) throw new Error('Repository name is required');
        const createRes = await apiFetch('/api/github/create-repo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            githubToken: token,
            repo: name,
            repoDescription: `${currentComponentName} - Generated by Figma to Code`,
            isPrivate: privateCheckbox.checked,
          }),
        }).then(apiJson);
        owner = createRes?.owner?.login || owner;
        repo = createRes?.name || name;
        branch = createRes?.default_branch || 'main';
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        if (!selectedRepo) throw new Error('Select a repository');
        repo = selectedRepo.name;
        branch = selectedRepo.default_branch || 'main';
      }

      const dir = directoryInput.value;
      const filesToPush = githubFiles.map((f) => {
        const path = buildRepoPath(dir, f.name);
        if (!path) throw new Error(`Invalid path: ${dir}/${f.name}`);
        return { path, content: f.content };
      });

      const result = await apiFetch('/api/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          githubToken: token,
          owner,
          repo,
          branch,
          commitMessage: commitMsgInput.value.trim() || `feat: add ${currentComponentName} component`,
          files: filesToPush,
        }),
      }).then(apiJson);

      successEl.style.display = 'block';
      successLink.href = result?.commitUrl || `https://github.com/${owner}/${repo}`;
      successLink.textContent = 'View on GitHub';
      formEl.style.display = 'none';
    } catch (e) {
      showError(await getFunctionErrorMessage(e, 'Push failed'));
    } finally {
      setPushLoading(false);
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });
  closeBtn.addEventListener('click', closeDialog);

  if (pushGithubBtn) {
    pushGithubBtn.addEventListener('click', () => {
      if (authEnabled && !isAuthenticated) {
        showLoginModal(openDialog);
        return;
      }
      openDialog();
    });
  }
}

initGitHubDialog();

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
// Pointer capture routes pointermove/pointerup to the handle even when the cursor is not
// over the 6px grip (normal) or when it is over the preview iframe — document mouseup
// misses releases on iframes and left isResizing stuck, so the divider kept tracking mouse.
const PANEL_LEFT_MIN_PX = 280;
const PANEL_LEFT_MAX_PX = 360;
let isResizing = false;
let panelResizePointerId = null;

function stopPanelResize() {
  if (!isResizing) return;
  isResizing = false;
  const pid = panelResizePointerId;
  panelResizePointerId = null;
  resizeHandle.classList.remove('active');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  if (pid != null) {
    try {
      resizeHandle.releasePointerCapture(pid);
    } catch (_err) {
      /* already released or not capturing */
    }
  }
}

resizeHandle.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (mainSplit.classList.contains('main-split--chat-collapsed')) return;
  isResizing = true;
  panelResizePointerId = e.pointerId;
  resizeHandle.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
  try {
    resizeHandle.setPointerCapture(e.pointerId);
  } catch (_err) {
    /* ignore */
  }
});

resizeHandle.addEventListener('pointermove', (e) => {
  if (!isResizing) return;
  if (mainSplit.classList.contains('main-split--chat-collapsed')) return;
  const mainEl = document.querySelector('.main');
  if (!mainEl) return;
  const mainRect = mainEl.getBoundingClientRect();
  const rawPx = e.clientX - mainRect.left;
  const clampedPx = Math.max(PANEL_LEFT_MIN_PX, Math.min(rawPx, PANEL_LEFT_MAX_PX));
  const percent = (clampedPx / mainRect.width) * 100;
  panelLeft.style.width = percent + '%';
});

resizeHandle.addEventListener('pointerup', stopPanelResize);
resizeHandle.addEventListener('pointercancel', stopPanelResize);
window.addEventListener('blur', stopPanelResize);

function applyChatPanelCollapsed(collapsed, persist) {
  if (!mainSplit) return;
  mainSplit.classList.toggle('main-split--chat-collapsed', collapsed);
  if (chatPanelCollapseBtn) {
    chatPanelCollapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  if (chatPanelExpandBtn) {
    chatPanelExpandBtn.style.display = collapsed ? 'inline-flex' : 'none';
  }
  if (persist) {
    try {
      localStorage.setItem(CHAT_PANEL_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (e) { /* ignore quota */ }
  }
}

function applyChatPanelCollapseFromStorage() {
  if (!mainSplit || !mainSplit.classList.contains('visible')) return;
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(CHAT_PANEL_COLLAPSED_KEY) === '1';
  } catch (e) { /* ignore */ }
  applyChatPanelCollapsed(collapsed, false);
}

if (chatPanelCollapseBtn) {
  chatPanelCollapseBtn.addEventListener('click', () => applyChatPanelCollapsed(true, true));
}
if (chatPanelExpandBtn) {
  chatPanelExpandBtn.addEventListener('click', () => applyChatPanelCollapsed(false, true));
}

// ── Utilities ──
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── All Projects Button ──
if (allProjectsBtn) {
  allProjectsBtn.addEventListener('click', () => {
    // Expand sidebar if collapsed
    if (sidebar.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
      updateSidebarToggleTitle();
    }
    // Scroll project list into view
    if (projectListEl) projectListEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

// ── Command palette (⌘K / Ctrl+K) ──

const COMMAND_PALETTE_ACTIONS = [
  {
    id: 'new',
    label: 'New conversion',
    subtitle: 'Start from a Figma URL',
    icon: '+',
    keywords: 'new start hero figma url convert create',
  },
];

let commandPaletteSelected = 0;
/** @type {Array<{ kind: 'action' | 'project', action?: object, project?: object }>} */
let commandPaletteFlat = [];

function commandPaletteFuzzyScore(haystack, query) {
  if (!query || !String(query).trim()) return 1;
  const h = String(haystack).toLowerCase();
  const q = String(query).toLowerCase().trim();
  if (!q) return 1;
  const idx = h.indexOf(q);
  if (idx >= 0) return 2000 - idx;
  let qi = 0;
  let score = 0;
  let lastTi = -99;
  for (let ti = 0; ti < h.length && qi < q.length; ti++) {
    if (h[ti] === q[qi]) {
      score += ti === lastTi + 1 ? 5 : 1;
      const atWord = ti === 0 || /[\s/:=\-_]/.test(h[ti - 1]);
      if (atWord) score += 3;
      lastTi = ti;
      qi++;
    }
  }
  return qi === q.length ? 50 + score : 0;
}

function updateCommandPaletteHintText() {
  if (!commandPaletteHint) return;
  const isMac =
    typeof navigator !== 'undefined' &&
    (navigator.platform?.includes('Mac') || navigator.userAgent?.includes('Mac'));
  const mod = isMac ? '⌘K' : 'Ctrl+K';
  commandPaletteHint.textContent = `${mod} to toggle · ↑↓ navigate · Enter to open · Esc to close`;
}

function rebuildCommandPalette(query) {
  const q = (query || '').trim();
  const actionEntries = COMMAND_PALETTE_ACTIONS.map((a) => {
    const blob = `${a.label} ${a.subtitle} ${a.keywords}`;
    const score = q ? commandPaletteFuzzyScore(blob, q) : 9999;
    return { kind: 'action', score, action: a };
  })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);

  const projects = loadProjects()
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const projectEntries = projects
    .map((p) => {
      const blob = `${p.name || ''} ${p.figmaUrl || ''}`;
      const score = q ? commandPaletteFuzzyScore(blob, q) : 1;
      return { kind: 'project', score, project: p };
    })
    .filter((e) => e.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || (b.project.updatedAt || 0) - (a.project.updatedAt || 0),
    );

  commandPaletteFlat = [
    ...actionEntries.map(({ action }) => ({ kind: 'action', action })),
    ...projectEntries.map(({ project }) => ({ kind: 'project', project })),
  ];
}

function renderCommandPaletteRow(row, index) {
  const sel = index === commandPaletteSelected ? ' command-palette__row--selected' : '';
  const ariaSel = index === commandPaletteSelected ? 'true' : 'false';
  if (row.kind === 'action') {
    const a = row.action;
    return `<button type="button" class="command-palette__row${sel}" role="option" data-index="${index}" aria-selected="${ariaSel}">
      <span class="command-palette__row-icon">${escapeHtml(a.icon)}</span>
      <span class="command-palette__row-body">
        <span class="command-palette__row-title">${escapeHtml(a.label)}</span>
        <span class="command-palette__row-sub">${escapeHtml(a.subtitle)}</span>
      </span>
    </button>`;
  }
  const p = row.project;
  const dateLabel = p.converting ? 'Converting...' : formatTimeAgo(p.updatedAt || p.createdAt);
  const title = escapeHtml(p.name || 'Untitled');
  const convClass = p.converting ? ' command-palette__row--converting' : '';
  return `<button type="button" class="command-palette__row${sel}${convClass}" role="option" data-index="${index}" aria-selected="${ariaSel}">
    ${projectThumbMarkup(p)}
    <span class="sidebar__project-info">
      <span class="sidebar__project-name">${title}</span>
      <span class="sidebar__project-date">${escapeHtml(dateLabel)}</span>
    </span>
  </button>`;
}

function renderCommandPaletteDOM() {
  if (!commandPaletteResults) return;
  if (commandPaletteFlat.length === 0) {
    commandPaletteResults.innerHTML =
      '<div class="command-palette__empty" role="status">No matching projects or actions</div>';
    return;
  }
  const parts = [];
  let lastKind = null;
  for (let i = 0; i < commandPaletteFlat.length; i++) {
    const row = commandPaletteFlat[i];
    if (row.kind !== lastKind) {
      lastKind = row.kind;
      parts.push(
        `<div class="command-palette__section-label">${row.kind === 'action' ? 'Actions' : 'Projects'}</div>`,
      );
    }
    parts.push(renderCommandPaletteRow(row, i));
  }
  commandPaletteResults.innerHTML = parts.join('');
  commandPaletteResults.querySelectorAll('.command-palette__row').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      if (!Number.isNaN(idx)) runCommandPaletteIndex(idx);
    });
  });
}

function scrollCommandPaletteSelectionIntoView() {
  commandPaletteResults
    ?.querySelector('.command-palette__row--selected')
    ?.scrollIntoView({ block: 'nearest' });
}

function refreshCommandPalette() {
  const q = commandPaletteInput?.value ?? '';
  rebuildCommandPalette(q);
  if (commandPaletteFlat.length > 0) {
    commandPaletteSelected = Math.min(
      commandPaletteSelected,
      commandPaletteFlat.length - 1,
    );
    if (commandPaletteSelected < 0) commandPaletteSelected = 0;
  } else {
    commandPaletteSelected = 0;
  }
  renderCommandPaletteDOM();
  scrollCommandPaletteSelectionIntoView();
}

function runCommandPaletteIndex(index) {
  const row = commandPaletteFlat[index];
  if (!row) return;
  closeCommandPalette();
  if (row.kind === 'action' && row.action.id === 'new') {
    resetToHero();
    return;
  }
  if (row.kind === 'project' && row.project?.id) {
    restoreProject(row.project.id);
  }
}

/** Clears ALL sidebar active states (nav items + project items), then optionally activates one. */
function setSidebarPrimaryNavActive(activeEl) {
  // Clear primary nav items
  document.querySelectorAll('.sidebar__nav-item').forEach((item) => {
    if (item.id === 'all-projects-btn') return;
    item.classList.toggle('active', activeEl != null && item === activeEl);
  });
  // Also clear project list items when a primary nav item is activated
  if (activeEl != null) {
    document.querySelectorAll('.sidebar__project-item').forEach((item) => {
      item.classList.remove('active');
    });
  }
}

/** Clears ALL sidebar active states so a project item can be the sole active element. */
function clearAllSidebarActive() {
  document.querySelectorAll('.sidebar__nav-item').forEach((item) => {
    if (item.id === 'all-projects-btn') return;
    item.classList.remove('active');
  });
  document.querySelectorAll('.sidebar__project-item').forEach((item) => {
    item.classList.remove('active');
  });
}

/** Home highlighted only on landing; split/project view clears primary nav (project list shows selection). */
function syncSidebarPrimaryNavToShellView() {
  if (!isCommandPaletteOpen()) {
    // If profile view is open, keep Profile nav active regardless of hero state
    const profileView = document.getElementById('profile-view');
    if (profileView && profileView.style.display !== 'none') {
      const profileNav = document.getElementById('sidebar-profile-btn');
      if (profileNav) setSidebarPrimaryNavActive(profileNav);
      updatePanelHeaderProject();
      return;
    }
    const onHero = mainHero && !mainHero.classList.contains('hidden');
    if (onHero) {
      const homeNav = document.querySelector('.sidebar__nav-item[title="Home"]');
      if (homeNav) setSidebarPrimaryNavActive(homeNav);
    } else {
      setSidebarPrimaryNavActive(null);
    }
  }
  updatePanelHeaderProject();
}

function openCommandPalette() {
  if (!commandPaletteOverlay || !commandPaletteInput) return;
  if (sidebarSearchBtn) setSidebarPrimaryNavActive(sidebarSearchBtn);
  commandPaletteOverlay.setAttribute('aria-hidden', 'false');
  updateCommandPaletteHintText();
  commandPaletteInput.value = '';
  commandPaletteSelected = 0;
  rebuildCommandPalette('');
  renderCommandPaletteDOM();
  requestAnimationFrame(() => {
    commandPaletteInput.focus();
    commandPaletteInput.select?.();
  });
  if (window.innerWidth <= 768) {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
    updateMenuButtonVisibility();
  }
}

function closeCommandPalette() {
  if (!commandPaletteOverlay) return;
  commandPaletteOverlay.setAttribute('aria-hidden', 'true');
  commandPaletteSelected = 0;
  commandPaletteFlat = [];
  syncSidebarPrimaryNavToShellView();
}

function isCommandPaletteOpen() {
  return commandPaletteOverlay?.getAttribute('aria-hidden') === 'false';
}

function initCommandPalette() {
  updateCommandPaletteHintText();
  sidebarSearchBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    openCommandPalette();
  });

  commandPaletteOverlay?.addEventListener('click', (e) => {
    if (e.target === commandPaletteOverlay) closeCommandPalette();
  });

  commandPaletteInput?.addEventListener('input', () => {
    commandPaletteSelected = 0;
    refreshCommandPalette();
  });

  commandPaletteInput?.addEventListener('keydown', (e) => {
    if (!isCommandPaletteOpen()) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!commandPaletteFlat.length) return;
      commandPaletteSelected =
        (commandPaletteSelected + 1) % commandPaletteFlat.length;
      renderCommandPaletteDOM();
      scrollCommandPaletteSelectionIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!commandPaletteFlat.length) return;
      commandPaletteSelected =
        (commandPaletteSelected - 1 + commandPaletteFlat.length) %
        commandPaletteFlat.length;
      renderCommandPaletteDOM();
      scrollCommandPaletteSelectionIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (commandPaletteFlat.length === 0) return;
      runCommandPaletteIndex(commandPaletteSelected);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isCommandPaletteOpen()) {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (isCommandPaletteOpen()) closeCommandPalette();
      else openCommandPalette();
    }
  });
}

// ── Auth: Cognito Integration ──

function authHeaders() {
  if (authIdToken) return { Authorization: 'Bearer ' + authIdToken };
  return {};
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

// ── DynamoDB Project Sync ──

let _syncDebounceTimer = null;

/** Debounced persist of a single project to DynamoDB (for authenticated users). */
function debouncedPersistProject(project) {
  if (!isAuthenticated || !authIdToken) return;
  clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(async () => {
    try {
      await apiFetch('/api/auth/projects/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projects: [{
            id: project.id,
            sessionId: project.sessionId,
            name: project.name || 'Untitled',
            figmaUrl: project.figmaUrl || '',
            frameworks: project.frameworks || [],
            createdAt: project.createdAt || Date.now(),
            updatedAt: project.updatedAt || Date.now(),
          }],
        }),
      });
    } catch (e) {
      console.warn('[sync] DynamoDB persist failed:', e);
    }
  }, 2000);
}

/** After login: push localStorage projects to DynamoDB, then merge server list back. */
async function syncProjectsAfterLogin() {
  if (!isAuthenticated || !authIdToken) return;
  try {
    const localProjects = loadProjects();
    const fingerprint = getCookie('ftfp');

    // Push local projects to server
    if (localProjects.length > 0) {
      await apiFetch('/api/auth/projects/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projects: localProjects.map(p => ({
            id: p.id,
            sessionId: p.sessionId || p.id,
            name: p.name || 'Untitled',
            figmaUrl: p.figmaUrl || '',
            frameworks: p.frameworks || [],
            createdAt: p.createdAt || Date.now(),
            updatedAt: p.updatedAt || Date.now(),
          })),
          fingerprint: fingerprint || undefined,
        }),
      });
    }

    // Fetch merged list from server
    const res = await apiFetch('/api/auth/projects');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.projects)) {
        mergeRemoteProjects(data.projects);
      }
    }
  } catch (e) {
    console.warn('[sync] Project sync after login failed:', e);
  }
}

/** Merge remote DynamoDB projects into localStorage. Later updatedAt wins. */
function mergeRemoteProjects(remoteProjects) {
  const local = loadProjects();
  const localMap = new Map(local.map(p => [p.id || p.sessionId, p]));

  for (const remote of remoteProjects) {
    const key = remote.projectId || remote.id;
    const existing = localMap.get(key);
    if (!existing || (remote.updatedAt > (existing.updatedAt || 0))) {
      localMap.set(key, {
        ...existing,
        id: key,
        sessionId: remote.sessionId || key,
        name: remote.name || existing?.name || 'Untitled',
        figmaUrl: remote.figmaUrl || existing?.figmaUrl || '',
        frameworks: remote.frameworks || existing?.frameworks || [],
        createdAt: remote.createdAt || existing?.createdAt || Date.now(),
        updatedAt: remote.updatedAt || existing?.updatedAt || Date.now(),
      });
    }
  }

  const merged = Array.from(localMap.values())
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_PROJECTS);
  saveProjects(merged);
  renderProjectList();
}

async function initAuth() {
  try {
    const res = await apiFetch('/api/auth/config');
    const cfg = await res.json();
    authEnabled = cfg.authEnabled;
    if (!authEnabled) return;

    // Init Cognito UserPool from CDN-loaded SDK
    if (typeof AmazonCognitoIdentity !== 'undefined' && cfg.userPoolId && cfg.clientId) {
      cognitoUserPool = new AmazonCognitoIdentity.CognitoUserPool({
        UserPoolId: cfg.userPoolId,
        ClientId: cfg.clientId,
      });

      // Check for existing session
      const cogUser = cognitoUserPool.getCurrentUser();
      if (cogUser) {
        cogUser.getSession((err, session) => {
          if (!err && session && session.isValid()) {
            authIdToken = session.getIdToken().getJwtToken();
            fetchAuthMe().then(() => syncProjectsAfterLogin());
          }
        });
      }
    }

    await updateFreeTierDisplay();
  } catch (e) {
    console.warn('Auth init failed:', e);
  }
}

async function fetchAuthMe() {
  try {
    const res = await apiFetch('/api/auth/me');
    const data = await res.json();
    isAuthenticated = data.authenticated;
    currentUser = data.user;
    updateAuthUI();
  } catch {
    isAuthenticated = false;
    currentUser = null;
    updateAuthUI();
  }
}

async function updateFreeTierDisplay() {
  if (!authEnabled) return;
  try {
    const res = await apiFetch('/api/auth/free-tier');
    freeTierUsage = await res.json();
  } catch { /* ignore */ }

  const badge = document.getElementById('free-tier-badge');
  const text = document.getElementById('free-tier-text');
  if (!badge || !text) return;

  badge.style.display = 'block';
  badge.classList.remove('free-tier-badge--warning', 'free-tier-badge--exhausted');

  if (isAuthenticated) {
    // Authenticated user — show auth usage
    if (freeTierUsage.remaining <= 0) {
      text.textContent = 'Conversion limit reached — contact NesterLabs for more';
      badge.classList.add('free-tier-badge--exhausted');
    } else if (freeTierUsage.remaining <= 5) {
      text.textContent = `${freeTierUsage.remaining} conversion${freeTierUsage.remaining === 1 ? '' : 's'} remaining`;
      badge.classList.add('free-tier-badge--warning');
    } else {
      text.textContent = `${freeTierUsage.remaining} of ${freeTierUsage.limit} conversions remaining`;
    }
  } else {
    // Anonymous user — show free tier usage
    if (freeTierUsage.remaining <= 0) {
      text.textContent = 'Free conversions used up — sign in to continue';
      badge.classList.add('free-tier-badge--exhausted');
    } else if (freeTierUsage.remaining <= 2) {
      text.textContent = `${freeTierUsage.remaining} free conversion${freeTierUsage.remaining === 1 ? '' : 's'} remaining`;
      badge.classList.add('free-tier-badge--warning');
    } else {
      text.textContent = `${freeTierUsage.remaining} free conversions remaining`;
    }
  }
}

function updateAuthUI() {
  if (!authEnabled) {
    return;
  }

  if (isAuthenticated && currentUser) {
    // Hide free tier badge for authenticated users (email / sign out live in Profile)
    const badge = document.getElementById('free-tier-badge');
    if (badge) badge.style.display = 'none';
  }
}

function showLoginModal(onSuccess) {
  loginSuccessCallback = onSuccess || null;
  const overlay = document.getElementById('login-dialog-overlay');
  if (!overlay) return;

  // Reset to sign-in view
  document.getElementById('login-signin-form').style.display = 'flex';
  document.getElementById('login-signup-form').style.display = 'none';
  document.getElementById('login-verify-form').style.display = 'none';
  document.getElementById('login-forgot-form').style.display = 'none';
  document.getElementById('login-reset-form').style.display = 'none';
  document.getElementById('login-dialog-title-text').textContent = 'Sign In';
  document.getElementById('login-error').textContent = '';
  document.getElementById('signup-error').textContent = '';

  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.add('visible');
  document.getElementById('login-email').focus();
}

function closeLoginModal() {
  const overlay = document.getElementById('login-dialog-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.setAttribute('aria-hidden', 'true');
  loginSuccessCallback = null;
}

function showProfileModal() {
  const view = document.getElementById('profile-view');
  if (!view) return;

  const avatarEl = document.getElementById('profile-avatar');
  const nameEl = document.getElementById('profile-name');
  const emailEl = document.getElementById('profile-email');
  const usedEl = document.getElementById('profile-stat-used');
  const remainingEl = document.getElementById('profile-stat-remaining');
  const projectsEl = document.getElementById('profile-stat-projects');
  const signoutBtn = document.getElementById('profile-signout-btn');
  const signinBtn = document.getElementById('profile-signin-btn');

  const allProjects = loadProjects();
  const projectCount = allProjects.length;

  if (isAuthenticated && currentUser) {
    const email = currentUser.email || '';
    const displayName = currentUser.name || email.split('@')[0] || 'User';
    const initial = displayName.charAt(0).toUpperCase();

    if (avatarEl) avatarEl.textContent = initial;
    if (nameEl) nameEl.textContent = displayName;
    if (emailEl) emailEl.textContent = email;
    // Use real API data if available, fall back to project count
    const usedVal = (freeTierUsage.used != null && freeTierUsage.used > 0)
      ? freeTierUsage.used
      : projectCount;
    const remainingVal = freeTierUsage.remaining === Infinity || freeTierUsage.remaining == null
      ? '∞'
      : freeTierUsage.remaining;
    if (usedEl) usedEl.textContent = usedVal;
    if (remainingEl) remainingEl.textContent = remainingVal;
    if (projectsEl) projectsEl.textContent = projectCount;
    if (signoutBtn) signoutBtn.style.display = 'inline-flex';
    if (signinBtn) signinBtn.style.display = 'none';
  } else {
    if (avatarEl) avatarEl.textContent = '?';
    if (nameEl) nameEl.textContent = 'Guest';
    if (emailEl) emailEl.textContent = 'Not signed in';
    // Use project count as conversions used; no limit when auth is off
    if (usedEl) usedEl.textContent = projectCount;
    if (remainingEl) remainingEl.textContent = authEnabled ? (freeTierUsage.remaining ?? '—') : '∞';
    if (projectsEl) projectsEl.textContent = projectCount;
    if (signoutBtn) signoutBtn.style.display = 'none';
    if (signinBtn) signinBtn.style.display = authEnabled ? 'inline-flex' : 'none';
  }

  // Hide hero + split view, show profile view
  if (mainHero) mainHero.classList.add('hidden');
  if (mainSplit) mainSplit.classList.remove('visible');
  mainHero?.closest('.main')?.classList.remove('split-visible');
  view.style.display = 'flex';

  // Ensure Profile nav stays active (sync may fire after DOM changes)
  const profileNav = document.getElementById('sidebar-profile-btn');
  if (profileNav) setSidebarPrimaryNavActive(profileNav);
}

function closeProfileModal() {
  const view = document.getElementById('profile-view');
  if (view) view.style.display = 'none';
  // Return to hero
  if (mainHero) mainHero.classList.remove('hidden');
  // Sync nav back to Home
  syncSidebarPrimaryNavToShellView();
}

function initProfileModal() {
  document.getElementById('profile-back-home-btn')?.addEventListener('click', closeProfileModal);

  document.getElementById('profile-signout-btn')?.addEventListener('click', () => {
    closeProfileModal();
    cognitoSignOut();
  });

  document.getElementById('profile-signin-btn')?.addEventListener('click', () => {
    closeProfileModal();
    showLoginModal(null);
  });
}



function showContactNesterLabsModal() {
  const overlay = document.getElementById('contact-nesterlabs-overlay');
  if (!overlay) return;
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.add('visible');
}

function closeContactNesterLabsModal() {
  const overlay = document.getElementById('contact-nesterlabs-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.setAttribute('aria-hidden', 'true');
}

function initLoginModal() {
  const overlay = document.getElementById('login-dialog-overlay');
  if (!overlay) return;

  const closeBtn = document.getElementById('login-dialog-close');
  closeBtn?.addEventListener('click', closeLoginModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeLoginModal(); });

  // Tab switching
  document.getElementById('login-show-signup')?.addEventListener('click', () => {
    document.getElementById('login-signin-form').style.display = 'none';
    document.getElementById('login-signup-form').style.display = 'flex';
    document.getElementById('login-dialog-title-text').textContent = 'Sign Up';
  });
  document.getElementById('login-show-signin')?.addEventListener('click', () => {
    document.getElementById('login-signup-form').style.display = 'none';
    document.getElementById('login-signin-form').style.display = 'flex';
    document.getElementById('login-dialog-title-text').textContent = 'Sign In';
  });

  // Forgot password
  document.getElementById('login-forgot-btn')?.addEventListener('click', () => {
    document.getElementById('login-signin-form').style.display = 'none';
    document.getElementById('login-forgot-form').style.display = 'flex';
    document.getElementById('login-dialog-title-text').textContent = 'Reset Password';
    const forgotEmail = document.getElementById('forgot-email');
    forgotEmail.value = document.getElementById('login-email').value;
  });
  document.getElementById('forgot-back-btn')?.addEventListener('click', () => {
    document.getElementById('login-forgot-form').style.display = 'none';
    document.getElementById('login-signin-form').style.display = 'flex';
    document.getElementById('login-dialog-title-text').textContent = 'Sign In';
  });

  // Sign In
  document.getElementById('login-submit-btn')?.addEventListener('click', () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const spinner = document.getElementById('login-spinner');
    const btn = document.getElementById('login-submit-btn');
    if (!email || !password) { errorEl.textContent = 'Email and password are required'; return; }
    if (!cognitoUserPool) { errorEl.textContent = 'Auth not configured'; return; }

    errorEl.textContent = '';
    btn.disabled = true;
    spinner.style.display = 'inline-block';

    const cogUser = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: cognitoUserPool });
    const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({ Username: email, Password: password });

    cogUser.authenticateUser(authDetails, {
      onSuccess(session) {
        authIdToken = session.getIdToken().getJwtToken();
        btn.disabled = false;
        spinner.style.display = 'none';
        fetchAuthMe().then(() => {
          updateFreeTierDisplay();
          syncProjectsAfterLogin();
          closeLoginModal();
          if (loginSuccessCallback) { const cb = loginSuccessCallback; loginSuccessCallback = null; cb(); }
        });
      },
      onFailure(err) {
        btn.disabled = false;
        spinner.style.display = 'none';
        errorEl.textContent = err.message || 'Sign in failed';
      },
    });
  });

  // Sign Up
  let pendingSignupEmail = '';
  let pendingSignupPassword = '';

  document.getElementById('signup-submit-btn')?.addEventListener('click', () => {
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    const errorEl = document.getElementById('signup-error');
    const spinner = document.getElementById('signup-spinner');
    const btn = document.getElementById('signup-submit-btn');

    if (!email || !password) { errorEl.textContent = 'Email and password are required'; return; }
    if (password !== confirm) { errorEl.textContent = 'Passwords do not match'; return; }
    if (!cognitoUserPool) { errorEl.textContent = 'Auth not configured'; return; }

    errorEl.textContent = '';
    btn.disabled = true;
    spinner.style.display = 'inline-block';

    const emailAttr = new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'email', Value: email });

    cognitoUserPool.signUp(email, password, [emailAttr], null, (err) => {
      btn.disabled = false;
      spinner.style.display = 'none';
      if (err) {
        errorEl.textContent = err.message || 'Sign up failed';
        return;
      }
      pendingSignupEmail = email;
      pendingSignupPassword = password;
      document.getElementById('login-signup-form').style.display = 'none';
      document.getElementById('login-verify-form').style.display = 'flex';
      document.getElementById('login-dialog-title-text').textContent = 'Verify Email';
    });
  });

  // Verify
  document.getElementById('verify-submit-btn')?.addEventListener('click', () => {
    const code = document.getElementById('verify-code').value.trim();
    const errorEl = document.getElementById('verify-error');
    const spinner = document.getElementById('verify-spinner');
    const btn = document.getElementById('verify-submit-btn');

    if (!code) { errorEl.textContent = 'Enter the verification code'; return; }

    errorEl.textContent = '';
    btn.disabled = true;
    spinner.style.display = 'inline-block';

    const cogUser = new AmazonCognitoIdentity.CognitoUser({ Username: pendingSignupEmail, Pool: cognitoUserPool });

    cogUser.confirmRegistration(code, true, (err) => {
      if (err) {
        btn.disabled = false;
        spinner.style.display = 'none';
        errorEl.textContent = err.message || 'Verification failed';
        return;
      }
      // Auto sign-in after verification
      const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({ Username: pendingSignupEmail, Password: pendingSignupPassword });
      cogUser.authenticateUser(authDetails, {
        onSuccess(session) {
          authIdToken = session.getIdToken().getJwtToken();
          btn.disabled = false;
          spinner.style.display = 'none';
          fetchAuthMe().then(() => {
            updateFreeTierDisplay();
            closeLoginModal();
            if (loginSuccessCallback) { const cb = loginSuccessCallback; loginSuccessCallback = null; cb(); }
          });
        },
        onFailure(authErr) {
          btn.disabled = false;
          spinner.style.display = 'none';
          errorEl.textContent = authErr.message || 'Auto sign-in failed. Please sign in manually.';
          // Switch back to sign-in form
          setTimeout(() => {
            document.getElementById('login-verify-form').style.display = 'none';
            document.getElementById('login-signin-form').style.display = 'flex';
            document.getElementById('login-dialog-title-text').textContent = 'Sign In';
            document.getElementById('login-email').value = pendingSignupEmail;
          }, 2000);
        },
      });
    });
  });

  // Forgot Password — send code
  let forgotPasswordEmail = '';
  document.getElementById('forgot-submit-btn')?.addEventListener('click', () => {
    const email = document.getElementById('forgot-email').value.trim();
    const errorEl = document.getElementById('forgot-error');
    const spinner = document.getElementById('forgot-spinner');
    const btn = document.getElementById('forgot-submit-btn');

    if (!email) { errorEl.textContent = 'Email is required'; return; }
    if (!cognitoUserPool) { errorEl.textContent = 'Auth not configured'; return; }

    errorEl.textContent = '';
    btn.disabled = true;
    spinner.style.display = 'inline-block';

    const cogUser = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: cognitoUserPool });
    forgotPasswordEmail = email;

    cogUser.forgotPassword({
      onSuccess() {
        btn.disabled = false;
        spinner.style.display = 'none';
        document.getElementById('login-forgot-form').style.display = 'none';
        document.getElementById('login-reset-form').style.display = 'flex';
        document.getElementById('login-dialog-title-text').textContent = 'Reset Password';
      },
      onFailure(err) {
        btn.disabled = false;
        spinner.style.display = 'none';
        errorEl.textContent = err.message || 'Failed to send code';
      },
    });
  });

  // Reset Password — confirm new password
  document.getElementById('reset-submit-btn')?.addEventListener('click', () => {
    const code = document.getElementById('reset-code').value.trim();
    const newPassword = document.getElementById('reset-password').value;
    const errorEl = document.getElementById('reset-error');
    const spinner = document.getElementById('reset-spinner');
    const btn = document.getElementById('reset-submit-btn');

    if (!code || !newPassword) { errorEl.textContent = 'Code and new password are required'; return; }

    errorEl.textContent = '';
    btn.disabled = true;
    spinner.style.display = 'inline-block';

    const cogUser = new AmazonCognitoIdentity.CognitoUser({ Username: forgotPasswordEmail, Pool: cognitoUserPool });

    cogUser.confirmPassword(code, newPassword, {
      onSuccess() {
        btn.disabled = false;
        spinner.style.display = 'none';
        // Switch to sign-in form
        document.getElementById('login-reset-form').style.display = 'none';
        document.getElementById('login-signin-form').style.display = 'flex';
        document.getElementById('login-dialog-title-text').textContent = 'Sign In';
        document.getElementById('login-email').value = forgotPasswordEmail;
        document.getElementById('login-error').textContent = '';
      },
      onFailure(err) {
        btn.disabled = false;
        spinner.style.display = 'none';
        errorEl.textContent = err.message || 'Reset failed';
      },
    });
  });
}

function initContactModal() {
  const overlay = document.getElementById('contact-nesterlabs-overlay');
  if (!overlay) return;
  const closeBtn = document.getElementById('contact-dialog-close');
  closeBtn?.addEventListener('click', closeContactNesterLabsModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeContactNesterLabsModal(); });
}

function cognitoSignOut() {
  if (cognitoUserPool) {
    const cogUser = cognitoUserPool.getCurrentUser();
    if (cogUser) cogUser.signOut();
  }
  authIdToken = null;
  isAuthenticated = false;
  currentUser = null;
  updateAuthUI();
  updateFreeTierDisplay();
}

// Token refresh interval (every 50 minutes)
setInterval(() => {
  if (!cognitoUserPool || !isAuthenticated) return;
  const cogUser = cognitoUserPool.getCurrentUser();
  if (!cogUser) return;
  cogUser.getSession((err, session) => {
    if (!err && session && session.isValid()) {
      authIdToken = session.getIdToken().getJwtToken();
    }
  });
}, 50 * 60 * 1000);

// ── Onboarding Tour ──────────────────────────────────────────────────

const ONBOARDING_KEY = 'nester-onboarding-v1';

const ONBOARDING_STEPS = [
  {
    target: null,
    welcome: true,
    icon: null, // illustration replaces the icon on the welcome step
    title: 'Welcome to Nester Compose',
    desc: 'Convert any Figma design into production-ready React, Vue, Svelte, Angular, or Solid code — in seconds.',
    nextLabel: 'Take the tour →',
    skipLabel: 'Skip for now',
  },
  {
    target: '.sidebar__section',
    position: 'right',
    icon: '🔑',
    title: 'Connect Figma',
    desc: 'Paste your Figma Personal Access Token here. Generate one from Figma → Settings → Account → Personal access tokens.',
    link: { label: '↗  Open Figma settings', url: 'https://www.figma.com/settings' },
  },
  {
    target: '#hero-figma-url',
    position: 'bottom',
    icon: '🔗',
    title: 'Paste a Figma URL',
    desc: 'Copy a link from any Figma file — a component, frame, or full page. It looks like figma.com/design/...',
  },
  {
    target: '.hero__prompt-controls',
    position: 'top',
    icon: '⚡',
    title: 'Pick your frameworks',
    desc: 'Select one or more output targets. We generate all of them simultaneously — React, Vue, Svelte, Angular, or Solid.',
  },
  {
    target: '#hero-convert-btn',
    position: 'top',
    icon: '🚀',
    title: 'Hit Convert',
    desc: 'We fetch design tokens, export icons, and generate clean component code. Usually takes 10–30 seconds.',
  },
  {
    target: null,
    done: true,
    icon: '🎉',
    title: "You're ready to ship!",
    desc: 'Convert any Figma design into production-ready components. Live preview, multi-framework code, and AI refinement — all in one place.',
    nextLabel: 'Start converting →',
    skipLabel: null,
  },
];

let onboardingStep = 0;

function isOnboardingDone() {
  return !!localStorage.getItem(ONBOARDING_KEY);
}

function markOnboardingDone() {
  localStorage.setItem(ONBOARDING_KEY, '1');
}

function startOnboarding() {
  onboardingStep = 0;
  // Make sure we're on the hero view
  const profileView = document.getElementById('profile-view');
  if (profileView) profileView.style.display = 'none';
  if (mainHero) mainHero.classList.remove('hidden');
  if (mainSplit) mainSplit.classList.remove('visible');
  mainHero?.closest('.main')?.classList.remove('split-visible');
  syncSidebarPrimaryNavToShellView();

  // Ensure sidebar is expanded for step 1
  if (sidebar && sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
    updateSidebarToggleTitle?.();
  }

  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;
  overlay.style.display = 'block';
  overlay.setAttribute('aria-hidden', 'false');
  renderOnboardingStep(onboardingStep, true);
}

function stopOnboarding() {
  stopConfetti();
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
  markOnboardingDone();
}

// ── Confetti celebration ─────────────────────────────────────────────────────
const CONFETTI_COLORS = ['#e5484d','#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#c77dff','#ffa552','#ffffff'];
let _confettiRaf = null;
let _confettiCanvas = null;
let _confettiCtx = null;
let _confettiParticles = [];

function launchConfetti() {
  const canvas = document.getElementById('onboarding-confetti');
  if (!canvas) return;
  _confettiCanvas = canvas;
  _confettiCtx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';

  // Two side-cannons — fire upward & outward from the edges of the centered card
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.42;
  _confettiParticles = [];

  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 70; i++) {
      const spread = (Math.random() - 0.5) * 0.7;
      const baseAngle = side < 0 ? -Math.PI * 0.65 : -Math.PI * 0.35; // up-outward
      const angle = baseAngle + spread;
      const speed = 6 + Math.random() * 9;
      _confettiParticles.push({
        x: cx + side * 170,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.3,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        shape: Math.random() < 0.5 ? 'rect' : 'circle',
        w: 7 + Math.random() * 7,
        h: 3 + Math.random() * 5,
      });
    }
  }

  const startTime = performance.now();
  const duration = 4000;

  function draw(now) {
    if (!_confettiCtx || !_confettiCanvas) return;
    const elapsed = now - startTime;
    _confettiCtx.clearRect(0, 0, _confettiCanvas.width, _confettiCanvas.height);
    let alive = 0;
    for (const p of _confettiParticles) {
      p.vy += 0.27;       // gravity
      p.vx *= 0.993;      // horizontal drag
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.rotV;
      const alpha = Math.max(0, 1 - Math.pow(elapsed / duration, 1.6));
      if (p.y < _confettiCanvas.height + 40) alive++;
      _confettiCtx.save();
      _confettiCtx.globalAlpha = alpha;
      _confettiCtx.translate(p.x, p.y);
      _confettiCtx.rotate(p.rot);
      _confettiCtx.fillStyle = p.color;
      if (p.shape === 'rect') {
        _confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else {
        _confettiCtx.beginPath();
        _confettiCtx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        _confettiCtx.fill();
      }
      _confettiCtx.restore();
    }
    if (elapsed < duration && alive > 0) {
      _confettiRaf = requestAnimationFrame(draw);
    } else {
      stopConfetti();
    }
  }

  if (_confettiRaf) cancelAnimationFrame(_confettiRaf);
  _confettiRaf = requestAnimationFrame(draw);
}

function stopConfetti() {
  if (_confettiRaf) { cancelAnimationFrame(_confettiRaf); _confettiRaf = null; }
  if (_confettiCanvas) {
    _confettiCanvas.style.display = 'none';
    if (_confettiCtx) _confettiCtx.clearRect(0, 0, _confettiCanvas.width, _confettiCanvas.height);
  }
  _confettiParticles = [];
}

function renderOnboardingStep(index, animate) {
  const step = ONBOARDING_STEPS[index];
  if (!step) return;

  const isCentered = !!(step.welcome || step.done);
  const totalSteps = ONBOARDING_STEPS.filter(s => !s.welcome && !s.done).length;
  const spotlight = document.getElementById('onboarding-spotlight');
  const tooltip = document.getElementById('onboarding-tooltip');
  const titleEl = document.getElementById('onboarding-title');
  const descEl = document.getElementById('onboarding-desc');
  const stepBadge = document.getElementById('onboarding-step-label');
  const linkEl = document.getElementById('onboarding-link');
  const prevBtn = document.getElementById('onboarding-prev');
  const nextBtn = document.getElementById('onboarding-next');
  const skipBtn = document.getElementById('onboarding-skip');
  const skipX = document.getElementById('onboarding-skip-x');
  const iconWrap = document.getElementById('onboarding-icon-wrap');
  const iconEl = document.getElementById('onboarding-icon');
  const progressWrap = document.getElementById('onboarding-progress');
  const progressBar = document.getElementById('onboarding-progress-bar');
  if (!tooltip || !spotlight) return;

  // Switch centered vs regular layout
  tooltip.classList.toggle('onboarding-tooltip--centered', isCentered);
  // Step-type classes drive targeted animations and styles
  tooltip.classList.toggle('onboarding-tooltip--welcome', !!step.welcome);
  tooltip.classList.toggle('onboarding-tooltip--done', !!step.done);

  // Illustration — shown on the welcome step instead of the icon
  const illustrationEl = document.getElementById('onboarding-illustration');
  if (illustrationEl) {
    illustrationEl.style.display = step.welcome ? 'block' : 'none';
  }

  // Icon block — shown only on the done step (🎉 bounce)
  if (step.done && step.icon) {
    if (iconEl) iconEl.innerHTML = step.icon;
    if (iconWrap) {
      iconWrap.style.display = 'flex';
      // Reset the pop animation so it replays each time the done step is shown
      iconWrap.style.animation = 'none';
      void iconWrap.offsetWidth;
      iconWrap.style.animation = '';
    }
  } else {
    if (iconWrap) iconWrap.style.display = 'none';
  }

  // Launch confetti when the done step appears (after the card animation finishes)
  if (step.done) {
    setTimeout(launchConfetti, 420);
  } else {
    stopConfetti(); // clean up if user navigates back from done step
  }

  // Step badge — only for regular steps
  if (stepBadge) {
    if (!isCentered) {
      const stepNum = ONBOARDING_STEPS.slice(0, index + 1).filter(s => !s.welcome && !s.done).length;
      stepBadge.textContent = `Step ${stepNum} of ${totalSteps}`;
      stepBadge.style.display = 'inline-flex';
    } else {
      stepBadge.style.display = 'none';
    }
  }

  // Content
  titleEl.textContent = step.title;
  descEl.textContent = step.desc;

  if (step.link) {
    linkEl.textContent = step.link.label;
    linkEl.href = step.link.url;
    linkEl.style.display = 'inline-flex';
  } else {
    linkEl.style.display = 'none';
  }

  // Progress bar — hidden on welcome, shown on all other steps
  if (progressWrap && progressBar) {
    if (step.welcome) {
      progressWrap.style.display = 'none';
    } else {
      progressWrap.style.display = 'block';
      const stepNum = step.done
        ? totalSteps
        : ONBOARDING_STEPS.slice(0, index + 1).filter(s => !s.welcome && !s.done).length;
      progressBar.style.width = `${(stepNum / totalSteps) * 100}%`;
    }
  }

  // Buttons
  nextBtn.textContent = step.nextLabel || 'Next →';
  prevBtn.style.display = (isCentered || index <= 1) ? 'none' : 'inline-flex';

  if (skipBtn) {
    if (step.skipLabel === null) {
      skipBtn.style.display = 'none';
    } else {
      skipBtn.style.display = 'inline-flex';
      skipBtn.textContent = step.skipLabel || 'Skip tour';
    }
  }
  // Hide close X on the final done step (only the CTA button should dismiss)
  if (skipX) skipX.style.display = step.done ? 'none' : 'flex';

  // Position spotlight + tooltip
  if (step.target) {
    if (step.target.includes('sidebar') || step.target.includes('.sidebar__section')) {
      if (sidebar && sidebar.classList.contains('collapsed')) {
        sidebar.classList.remove('collapsed');
        updateSidebarToggleTitle?.();
      }
    }

    const targetEl = document.querySelector(step.target);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => positionOnboardingSpotlight(targetEl, step, animate), 50);
    } else {
      positionOnboardingCentered(animate);
    }
  } else {
    spotlight.classList.add('onboarding-spotlight--hidden');
    positionOnboardingCentered(animate);
  }

  // Animate entrance — use the correct animation based on step type
  if (animate) {
    tooltip.classList.remove('onboarding-tooltip--animate');
    tooltip.classList.remove('onboarding-tooltip--animate-centered');
    void tooltip.offsetWidth;
    tooltip.classList.add(isCentered ? 'onboarding-tooltip--animate-centered' : 'onboarding-tooltip--animate');
  }
}

function positionOnboardingSpotlight(targetEl, step, animate) {
  const spotlight = document.getElementById('onboarding-spotlight');
  const tooltip = document.getElementById('onboarding-tooltip');
  if (!spotlight || !tooltip) return;

  const pad = 8;
  const rect = targetEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  spotlight.classList.remove('onboarding-spotlight--hidden');
  spotlight.style.top = (rect.top - pad) + 'px';
  spotlight.style.left = (rect.left - pad) + 'px';
  spotlight.style.width = (rect.width + pad * 2) + 'px';
  spotlight.style.height = (rect.height + pad * 2) + 'px';
  spotlight.style.borderRadius = '12px';

  // Position the 4 blur panels around the spotlight hole (light theme only)
  const blurLayer = document.getElementById('onboarding-blur-layer');
  if (blurLayer) {
    blurLayer.style.setProperty('--spotlight-x', (rect.left - pad) + 'px');
    blurLayer.style.setProperty('--spotlight-y', (rect.top - pad) + 'px');
    blurLayer.style.setProperty('--spotlight-w', (rect.width + pad * 2) + 'px');
    blurLayer.style.setProperty('--spotlight-h', (rect.height + pad * 2) + 'px');
  }

  // Determine tooltip placement
  const tWidth = 320;
  const tHeight = 250;
  let pos = step.position || 'right';

  // Auto-flip if not enough space
  if (pos === 'right' && rect.right + tWidth + 32 > vw) pos = 'left';
  if (pos === 'left' && rect.left - tWidth - 32 < 0) pos = 'right';
  if (pos === 'bottom' && rect.bottom + tHeight + 32 > vh) pos = 'top';
  if (pos === 'top' && rect.top - tHeight - 32 < 0) pos = 'bottom';

  // Arrow points BACK toward the target (opposite of where the tooltip sits)
  const arrowDir = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };
  tooltip.setAttribute('data-arrow', arrowDir[pos] || 'none');

  // ARROW_TOP_OFFSET must match the CSS `top` value in [data-arrow="left/right"]::before (22px)
  const ARROW_OFFSET = 22;
  let tipTop, tipLeft;

  if (pos === 'right') {
    tipLeft = rect.right + pad + 16;
    // Align arrow (at ARROW_OFFSET from tooltip top) with the vertical center of the target
    tipTop = rect.top + (rect.height / 2) - ARROW_OFFSET;
  } else if (pos === 'left') {
    tipLeft = rect.left - pad - tWidth - 16;
    tipTop = rect.top + (rect.height / 2) - ARROW_OFFSET;
  } else if (pos === 'bottom') {
    tipLeft = rect.left + (rect.width / 2) - tWidth / 2;
    tipTop = rect.bottom + pad + 16;
  } else { // top
    tipLeft = rect.left + (rect.width / 2) - tWidth / 2;
    tipTop = rect.top - pad - tHeight - 16;
  }

  // Clamp to viewport with some breathing room
  tipLeft = Math.max(16, Math.min(vw - tWidth - 16, tipLeft));
  tipTop = Math.max(16, Math.min(vh - tHeight - 16, tipTop));

  tooltip.style.top = tipTop + 'px';
  tooltip.style.left = tipLeft + 'px';
  tooltip.style.transform = 'none';
}

function positionOnboardingCentered(animate) {
  const spotlight = document.getElementById('onboarding-spotlight');
  const tooltip = document.getElementById('onboarding-tooltip');
  if (!spotlight || !tooltip) return;

  spotlight.classList.add('onboarding-spotlight--hidden');
  tooltip.setAttribute('data-arrow', 'none');
  tooltip.style.top = '50%';
  tooltip.style.left = '50%';
  tooltip.style.transform = 'translate(-50%, -50%)';

  // Centered steps: push spotlight vars off-screen so the top panel covers everything
  const blurLayer = document.getElementById('onboarding-blur-layer');
  if (blurLayer) {
    blurLayer.style.setProperty('--spotlight-x', '200vw');
    blurLayer.style.setProperty('--spotlight-y', '200vh');
    blurLayer.style.setProperty('--spotlight-w', '0px');
    blurLayer.style.setProperty('--spotlight-h', '0px');
  }
}

function initOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;

  /**
   * Smoothly cross-fades to a new step:
   * 1. Fade tooltip out (140ms)
   * 2. Snap content + position to new step (no CSS position transition)
   * 3. Fade tooltip back in with bounce entrance
   * This hides the transform/position jump between spotlight ↔ centered steps.
   */
  function smoothGoToStep(newIndex) {
    const tooltip = document.getElementById('onboarding-tooltip');
    if (!tooltip) {
      onboardingStep = newIndex;
      renderOnboardingStep(newIndex, true);
      return;
    }

    // Phase 1: fade out
    tooltip.classList.add('onboarding-tooltip--exit');

    setTimeout(() => {
      // Phase 2: snap — disable CSS position transitions so the move is instant
      tooltip.style.transition = 'none';
      onboardingStep = newIndex;
      renderOnboardingStep(newIndex, false); // renders new content + repositions

      // Phase 3: in next paint — restore transitions and play entrance animation
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          tooltip.style.transition = ''; // restore CSS-defined transitions
          tooltip.classList.remove('onboarding-tooltip--exit');

          // Pick the right animation: centered steps must include translate(-50%,-50%)
          // in keyframes so the animation never fights the inline positioning style.
          const isCentered = !!(ONBOARDING_STEPS[newIndex]?.welcome || ONBOARDING_STEPS[newIndex]?.done);
          tooltip.classList.remove('onboarding-tooltip--animate');
          tooltip.classList.remove('onboarding-tooltip--animate-centered');
          void tooltip.offsetWidth; // force reflow so animation restarts cleanly
          tooltip.classList.add(isCentered ? 'onboarding-tooltip--animate-centered' : 'onboarding-tooltip--animate');
        });
      });
    }, 150);
  }

  document.getElementById('onboarding-next')?.addEventListener('click', () => {
    const step = ONBOARDING_STEPS[onboardingStep];
    if (step?.done) {
      stopOnboarding();
      return;
    }
    if (onboardingStep < ONBOARDING_STEPS.length - 1) {
      smoothGoToStep(onboardingStep + 1);
    }
  });

  document.getElementById('onboarding-prev')?.addEventListener('click', () => {
    if (onboardingStep > 0) {
      smoothGoToStep(onboardingStep - 1);
    }
  });

  document.getElementById('onboarding-skip')?.addEventListener('click', stopOnboarding);
  document.getElementById('onboarding-skip-x')?.addEventListener('click', stopOnboarding);

  // Keyboard navigation
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') stopOnboarding();
    if (e.key === 'ArrowRight' || e.key === 'Enter') document.getElementById('onboarding-next')?.click();
    if (e.key === 'ArrowLeft') document.getElementById('onboarding-prev')?.click();
  });

  // Reposition on window resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (overlay.style.display !== 'none') {
        renderOnboardingStep(onboardingStep, false);
      }
    }, 100);
  });
}

initLoginModal();
initContactModal();
initProfileModal();
initOnboarding();

// ── Init ──
loadSavedToken();
loadExplorerIconConfig();
updateCodeActionsState();
renderProjectList();
initCommandPalette();
const _authReady = initAuth();

// Show hero on load, hide split (split has no .visible = hidden by default)
mainHero.classList.remove('hidden');
mainSplit.classList.remove('visible');
mainHero.closest('.main')?.classList.remove('split-visible');
syncSidebarPrimaryNavToShellView();

// Auto-start onboarding for first-time visitors
if (!isOnboardingDone()) {
  setTimeout(startOnboarding, 700);
}

function launchProductTour() {
  closeProfileModal();
  setTimeout(startOnboarding, 300);
}

document.getElementById('sidebar-tour-btn')?.addEventListener('click', launchProductTour);

// ── Visual Edit ──

function toggleVisualEditMode(active) {
  console.log('toggleVisualEditMode called with:', active);
  window.isVisualEditMode = active;
  console.log('window.isVisualEditMode is now:', window.isVisualEditMode);
  if (active) {
    if (mainSplit && mainSplit.classList.contains('main-split--chat-collapsed')) {
      applyChatPanelCollapsed(false, true);
    }
    if (emptyState) emptyState.style.display = 'none';
    if (chatMessages) chatMessages.style.display = 'none';
    if (progressCollapsible) progressCollapsible.style.display = 'none';
    if (visualEditSidebar) visualEditSidebar.style.display = 'flex';
    if (panelHeaderActions) panelHeaderActions.style.display = 'flex';
    if (panelInputBar) panelInputBar.style.display = 'none';
    if (panelHeaderText) panelHeaderText.textContent = 'Design / Visual edits';
    // Tell iframe to enable interaction
    if (previewFrame && previewFrame.contentWindow) {
      console.log('Sending setVisualEditActive:true to iframe');
      previewFrame.contentWindow.postMessage({ type: 'setVisualEditActive', active: true }, '*');
    }
  } else {
    if (visualEditSidebar) visualEditSidebar.style.display = 'none';
    if (panelHeaderActions) panelHeaderActions.style.display = 'none';
    if (floatingPrompt) floatingPrompt.style.display = 'none';
    if (chatMessages) chatMessages.style.display = 'flex';
    if (panelInputBar) panelInputBar.style.display = '';
    if (panelHeaderText) panelHeaderText.textContent = 'Import Design';
    // Clear stale visual-edit selection when leaving visual edit mode
    selectedElementInfo = null;
    if (loadProjects().length > 0 && currentProjectId) {
      // Restore appropriate view
    } else if (emptyState) {
      emptyState.style.display = 'flex';
    }
    // Tell iframe to disable interaction
    if (previewFrame && previewFrame.contentWindow) {
      console.log('Sending setVisualEditActive:false to iframe');
      previewFrame.contentWindow.postMessage({ type: 'setVisualEditActive', active: false }, '*');
    }
  }
  if (chatPanelCollapseBtn) {
    chatPanelCollapseBtn.hidden = active;
  }
}

if (enterVisualEditBtn) enterVisualEditBtn.addEventListener('click', () => toggleVisualEditMode(true));
if (visualEditBackBtn) visualEditBackBtn.addEventListener('click', () => toggleVisualEditMode(false));

window.addEventListener('message', (e) => {
  console.log('Parent received message:', e.data.type);
  if (e.data.type === 'elementSelected') {
    selectedElementInfo = e.data;
    updateVisualEditSidebar(e.data);
    showFloatingPrompt(e.data);
  } else if (e.data.type === 'rectUpdated') {
    if (selectedElementInfo) {
      selectedElementInfo.rect = e.data.rect;
      positionFloatingPrompt(e.data.rect);
    }
  } else if (e.data.type === 'iframeReady') {
    console.log('Iframe reported ready, current window.isVisualEditMode:', window.isVisualEditMode);
    if (window.isVisualEditMode && previewFrame && previewFrame.contentWindow) {
      previewFrame.contentWindow.postMessage({ type: 'setVisualEditActive', active: true }, '*');
    }
  }
});

function updateVisualEditSidebar(info) {
  const rgbToHexLocal = (color) => {
    if (!color) return "#000000";
    if (color.startsWith('#')) return color;
    let [r, g, b] = color.match(/\d+/g) || [];
    if (r && g && b) return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
    return "#000000";
  };

  const canEditText = info.textContentEditable !== false;
  if (veTextContent) {
    veTextContent.disabled = !canEditText;
    veTextContent.value = canEditText ? info.textContent : '';
    veTextContent.placeholder = canEditText
      ? 'Enter text…'
      : 'Select a label or small text block…';
  }
  if (veTextContentHint) {
    if (canEditText) {
      veTextContentHint.hidden = true;
      veTextContentHint.textContent = '';
    } else {
      const stats = info.textContentStats || {};
      const n = stats.descendantElements != null ? stats.descendantElements : 'many';
      const len = stats.length != null ? stats.length : (info.textContent || '').length;
      veTextContentHint.hidden = false;
      veTextContentHint.textContent =
        `This selection includes ${n} nested elements and about ${len} characters of combined text. ` +
        'Click a specific label, heading, or input caption to edit text safely.';
    }
  }
  if (veColorText) veColorText.value = info.computedStyle.color;
  if (veColorTextPreview) veColorTextPreview.style.backgroundColor = info.computedStyle.color;
  if (veColorTextPicker && info.computedStyle.color) {
    veColorTextPicker.value = rgbToHexLocal(info.computedStyle.color);
  }

  const bgColor = info.computedStyle.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'transparent' : info.computedStyle.backgroundColor;
  if (veColorBg) veColorBg.value = bgColor;
  if (veColorBgPreview) veColorBgPreview.style.backgroundColor = bgColor;
  if (veColorBgPicker && bgColor !== 'transparent' && info.computedStyle.backgroundColor) {
    veColorBgPicker.value = rgbToHexLocal(info.computedStyle.backgroundColor);
  }

  // Sync Typography
  if (veFontSize) {
    let hasOption = Array.from(veFontSize.options).some(opt => opt.value === info.computedStyle.fontSize);
    if (!hasOption && info.computedStyle.fontSize) {
      let opt = document.createElement('option');
      opt.value = opt.textContent = info.computedStyle.fontSize;
      veFontSize.appendChild(opt);
    }
    veFontSize.value = info.computedStyle.fontSize;
  }
  if (veFontWeight) {
    let hasOption = Array.from(veFontWeight.options).some(opt =>
      opt.value === info.computedStyle.fontWeight ||
      (info.computedStyle.fontWeight === 'bold' && opt.value === '700') ||
      (info.computedStyle.fontWeight === 'normal' && opt.value === '400')
    );
    if (!hasOption && info.computedStyle.fontWeight) {
      let opt = document.createElement('option');
      opt.value = opt.textContent = info.computedStyle.fontWeight;
      veFontWeight.appendChild(opt);
    }
    let wMap = { 'bold': '700', 'normal': '400' };
    veFontWeight.value = wMap[info.computedStyle.fontWeight] || info.computedStyle.fontWeight;
  }
  if (veFontStyle) {
    veFontStyle.value = info.computedStyle.fontStyle || 'normal';
  }

  if (veAlignBtns) {
    veAlignBtns.forEach(btn => {
      if (btn.dataset.align) {
        btn.classList.toggle('active', btn.dataset.align === info.computedStyle.textAlign);
      } else if (btn.dataset.flex) {
        if (info.computedStyle.display === 'flex' || info.computedStyle.display === 'inline-flex') {
          btn.classList.toggle('active', btn.dataset.flex === info.computedStyle.flexDirection);
        } else {
          btn.classList.remove('active');
        }
      } else if (btn.dataset.justify) {
        if (info.computedStyle.display === 'flex' || info.computedStyle.display === 'inline-flex') {
          btn.classList.toggle('active', btn.dataset.justify === info.computedStyle.justifyContent);
        } else {
          btn.classList.remove('active');
        }
      }
    });
  }

  // Sync Layout & Borders
  if (veGap) veGap.value = info.computedStyle.gap || '0px';

  if (veBorderRadius) {
    let hasOption = Array.from(veBorderRadius.options).some(opt => opt.value === info.computedStyle.borderRadius);
    if (!hasOption && info.computedStyle.borderRadius) {
      let opt = document.createElement('option');
      opt.value = opt.textContent = info.computedStyle.borderRadius;
      veBorderRadius.appendChild(opt);
    }
    veBorderRadius.value = info.computedStyle.borderRadius || '0px';
  }

  if (veBoxShadow) {
    let shadowVal = 'none';
    if (info.computedStyle.boxShadow && info.computedStyle.boxShadow !== 'none') {
      shadowVal = info.computedStyle.boxShadow;
      let hasOption = Array.from(veBoxShadow.options).some(o => o.value === shadowVal);
      if (!hasOption) {
        let opt = document.createElement('option');
        opt.value = shadowVal;
        opt.textContent = shadowVal.substring(0, 15) + '...';
        veBoxShadow.appendChild(opt);
      }
    }
    veBoxShadow.value = shadowVal;
  }

  if (veOpacitySlider) {
    veOpacitySlider.value = info.computedStyle.opacity || '1';
    if (veOpacityVal) veOpacityVal.textContent = Math.round(veOpacitySlider.value * 100);
  }

  const borderCol = info.computedStyle.borderColor === 'rgba(0, 0, 0, 0)' ? 'transparent' : (info.computedStyle.borderColor || 'transparent');
  if (veColorBorder) veColorBorder.value = borderCol;
  if (veColorBorderPreview) veColorBorderPreview.style.borderColor = borderCol;
  if (veColorBorderPicker && borderCol !== 'transparent') {
    veColorBorderPicker.value = rgbToHexLocal(borderCol);
  }

  // Sync Spacing
  if (veMarginAll) veMarginAll.value = info.computedStyle.margin;
  if (vePaddingAll) vePaddingAll.value = info.computedStyle.padding;

  const parseSpacing = (str) => {
    let parts = (str || '0px').split(' ').filter(Boolean);
    if (parts.length === 0) return { t: '0px', r: '0px', b: '0px', l: '0px' };
    if (parts.length === 1) return { t: parts[0], r: parts[0], b: parts[0], l: parts[0] };
    if (parts.length === 2) return { t: parts[0], r: parts[1], b: parts[0], l: parts[1] };
    if (parts.length === 3) return { t: parts[0], r: parts[1], b: parts[2], l: parts[1] };
    return { t: parts[0], r: parts[1], b: parts[2], l: parts[3] };
  };

  const cMar = parseSpacing(info.computedStyle.margin);
  if (veMarginTop) veMarginTop.value = cMar.t;
  if (veMarginRight) veMarginRight.value = cMar.r;
  if (veMarginBottom) veMarginBottom.value = cMar.b;
  if (veMarginLeft) veMarginLeft.value = cMar.l;

  const cPad = parseSpacing(info.computedStyle.padding);
  if (vePaddingTop) vePaddingTop.value = cPad.t;
  if (vePaddingRight) vePaddingRight.value = cPad.r;
  if (vePaddingBottom) vePaddingBottom.value = cPad.b;
  if (vePaddingLeft) vePaddingLeft.value = cPad.l;

  console.log('Selected element:', info.tagName, info.computedStyle);
}

function showFloatingPrompt(info) {
  if (floatingTag) floatingTag.textContent = info.tagName;
  if (floatingPrompt) floatingPrompt.style.display = 'flex';
  positionFloatingPrompt(info.rect);
  if (floatingInput) floatingInput.focus();
}

function positionFloatingPrompt(rect) {
  if (!floatingPrompt || !previewFrame) return;
  // rect is from iframe, need to consider iframe position and scroll
  const iframeRect = previewFrame.getBoundingClientRect();
  const top = iframeRect.top + rect.top;
  const left = iframeRect.left + rect.left + rect.width / 2;

  floatingPrompt.style.top = `${top}px`;
  floatingPrompt.style.left = `${left}px`;
}

// Ensure iframe state is synced on load
if (previewFrame) {
  previewFrame.addEventListener('load', () => {
    console.log('Iframe load event, window.isVisualEditMode:', window.isVisualEditMode);
    if (window.isVisualEditMode && previewFrame.contentWindow) {
      previewFrame.contentWindow.postMessage({ type: 'setVisualEditActive', active: true }, '*');
    }
  });
}

// Handling Property Updates from Sidebar
function updateIframeElement(prop, value) {
  if (prop === 'textContent' && selectedElementInfo && selectedElementInfo.textContentEditable === false) {
    return;
  }
  if (previewFrame && previewFrame.contentWindow) {
    previewFrame.contentWindow.postMessage({ type: 'updateElement', prop, value }, '*');
  }
  registerVisualEdit(prop, value);
}

if (veTextContent) {
  veTextContent.addEventListener('input', (e) => {
    if (e.target.disabled) return;
    updateIframeElement('textContent', e.target.value);
  });
}

if (veColorText) {
  veColorText.addEventListener('input', (e) => {
    updateIframeElement('color', e.target.value);
    if (veColorTextPreview) veColorTextPreview.style.backgroundColor = e.target.value;
  });
}

if (veColorBg) {
  veColorBg.addEventListener('input', (e) => {
    updateIframeElement('backgroundColor', e.target.value);
    if (veColorBgPreview) veColorBgPreview.style.backgroundColor = e.target.value;
  });
}

if (veFontSize) {
  veFontSize.addEventListener('change', (e) => updateIframeElement('fontSize', e.target.value));
}

if (veFontWeight) {
  veFontWeight.addEventListener('change', (e) => updateIframeElement('fontWeight', e.target.value));
}

if (veAlignBtns) {
  veAlignBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.parentElement;
      if (group) {
        group.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
      }
      btn.classList.add('active');

      if (btn.dataset.align) {
        updateIframeElement('textAlign', btn.dataset.align);
      } else if (btn.dataset.flex) {
        updateIframeElement('display', 'flex');
        updateIframeElement('flexDirection', btn.dataset.flex);
      } else if (btn.dataset.justify) {
        updateIframeElement('display', 'flex');
        updateIframeElement('justifyContent', btn.dataset.justify);
      }
    });
  });
}

if (veGap) {
  veGap.addEventListener('input', (e) => updateIframeElement('gap', e.target.value));
}

if (veBorderRadius) {
  veBorderRadius.addEventListener('change', (e) => updateIframeElement('borderRadius', e.target.value));
}

if (veBoxShadow) {
  veBoxShadow.addEventListener('change', (e) => updateIframeElement('boxShadow', e.target.value));
}

if (veOpacitySlider) {
  veOpacitySlider.addEventListener('input', (e) => {
    updateIframeElement('opacity', e.target.value);
    if (veOpacityVal) veOpacityVal.textContent = Math.round(e.target.value * 100);
  });
}

if (veColorBorderPicker) {
  veColorBorderPicker.addEventListener('input', (e) => {
    let hex = e.target.value;
    if (veColorBorder) veColorBorder.value = hex;
    updateIframeElement('borderStyle', 'solid');
    updateIframeElement('borderWidth', '1px');
    updateIframeElement('borderColor', hex);
    if (veColorBorderPreview) veColorBorderPreview.style.borderColor = hex;
  });
}

if (veColorBorder) {
  veColorBorder.addEventListener('input', (e) => {
    updateIframeElement('borderStyle', 'solid');
    updateIframeElement('borderWidth', '1px');
    updateIframeElement('borderColor', e.target.value);
    if (veColorBorderPreview) veColorBorderPreview.style.borderColor = e.target.value;
  });
}

if (veMarginAll) {
  veMarginAll.addEventListener('input', (e) => updateIframeElement('margin', e.target.value));
}

if (vePaddingAll) {
  vePaddingAll.addEventListener('input', (e) => updateIframeElement('padding', e.target.value));
}

function generateContextFromFloatingInput(promptText) {
  let variantDetails = "";
  if (selectedElementInfo.variantLabel && selectedElementInfo.variantLabel !== 'undefined / undefined') {
    variantDetails = ` [Clicked inside variant state: "${selectedElementInfo.variantLabel}"]`;
  }
  const veIdHint = selectedElementInfo.dataVeId
    ? ` (data-ve-id="${selectedElementInfo.dataVeId}")`
    : '';
  return `You are an expert Frontend Developer. Please update the underlying React component code based on the following user request.

IMPORTANT: Only modify the SPECIFIC element identified below. Do NOT change any other elements in the component.

Target Element: <${selectedElementInfo.tagName.toUpperCase()}>${veIdHint} containing text "${selectedElementInfo.textContent.replace(/\n/g, ' ').substring(0, 30).trim()}"${variantDetails}

User Request: "${promptText}"

Return the fully rewritten React component code incorporating this requested modification ONLY to the target element. Leave all other elements unchanged.`;
}

// AI Input in Floating Prompt
function buildVisualEditDisplayMessage(promptText) {
  const tag = selectedElementInfo?.tagName || 'element';
  const text = selectedElementInfo?.textContent?.replace(/\n/g, ' ').trim().substring(0, 30);
  const target = text ? `"${text}" <${tag}>` : `<${tag}>`;
  return `[Visual Edit] ${target}: ${promptText}`;
}

if (floatingInput) {
  floatingInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const promptText = floatingInput.value.trim();
      if (!promptText) return;

      // Capture selection BEFORE toggle clears it
      const savedSelection = selectedElementInfo ? { ...selectedElementInfo } : null;
      const displayLine = buildFloatingRefineSummary(promptText, selectedElementInfo);
      toggleVisualEditMode(false);
      if (chatInput) chatInput.value = '';
      resizeChatInput();
      sendChatMessage({ displayText: displayLine, prompt: promptText }, savedSelection);
      floatingInput.value = '';
    }
  });
}

if (floatingSendBtn) {
  floatingSendBtn.addEventListener('click', () => {
    const promptText = floatingInput.value.trim();
    if (!promptText) return;
    // Capture selection BEFORE toggle clears it
    const savedSelection = selectedElementInfo ? { ...selectedElementInfo } : null;
    const displayLine = buildFloatingRefineSummary(promptText, selectedElementInfo);
    toggleVisualEditMode(false);
    if (chatInput) chatInput.value = '';
    resizeChatInput();
    sendChatMessage({ displayText: displayLine, prompt: promptText }, savedSelection);
    floatingInput.value = '';
  });
}

if (veColorTextPicker) {
  veColorTextPicker.addEventListener('input', (e) => {
    let hex = e.target.value;
    if (veColorText) veColorText.value = hex;
    updateIframeElement('color', hex);
    if (veColorTextPreview) veColorTextPreview.style.backgroundColor = hex;
  });
}

if (veColorBgPicker) {
  veColorBgPicker.addEventListener('input', (e) => {
    let hex = e.target.value;
    if (veColorBg) veColorBg.value = hex;
    updateIframeElement('backgroundColor', hex);
    if (veColorBgPreview) veColorBgPreview.style.backgroundColor = hex;
  });
}

if (veFontStyle) {
  veFontStyle.addEventListener('change', (e) => updateIframeElement('fontStyle', e.target.value));
}

if (veMarginExpand) {
  veMarginExpand.addEventListener('click', () => {
    veMarginExpanded.style.display = veMarginExpanded.style.display === 'none' ? 'grid' : 'none';
  });
}
[veMarginTop, veMarginRight, veMarginBottom, veMarginLeft].forEach(input => {
  if (input) {
    input.addEventListener('input', () => {
      let marginStr = `${veMarginTop.value || '0px'} ${veMarginRight.value || '0px'} ${veMarginBottom.value || '0px'} ${veMarginLeft.value || '0px'}`;
      if (veMarginAll) veMarginAll.value = marginStr;
      updateIframeElement('margin', marginStr);
    });
  }
});

if (vePaddingExpand) {
  vePaddingExpand.addEventListener('click', () => {
    vePaddingExpanded.style.display = vePaddingExpanded.style.display === 'none' ? 'grid' : 'none';
  });
}
[vePaddingTop, vePaddingRight, vePaddingBottom, vePaddingLeft].forEach(input => {
  if (input) {
    input.addEventListener('input', () => {
      let paddingStr = `${vePaddingTop.value || '0px'} ${vePaddingRight.value || '0px'} ${vePaddingBottom.value || '0px'} ${vePaddingLeft.value || '0px'}`;
      if (vePaddingAll) vePaddingAll.value = paddingStr;
      updateIframeElement('padding', paddingStr);
    });
  }
});

if (veAiDeleteBtn) {
  veAiDeleteBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete this element?')) {
      if (previewFrame && previewFrame.contentWindow) {
        previewFrame.contentWindow.postMessage({ type: 'deleteElement' }, '*');
      }
      registerVisualEdit('delete', true);
      if (floatingPrompt) floatingPrompt.style.display = 'none';
      if (visualEditSidebar) {
        veTextContent.value = '';
      }
    }
  });
}

if (veAiVoiceBtn) {
  veAiVoiceBtn.addEventListener('click', () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.onstart = () => {
      veAiVoiceBtn.classList.add('recording');
      floatingInput.placeholder = "Listening...";
    };
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      floatingInput.value = transcript;
    };
    recognition.onend = () => {
      veAiVoiceBtn.classList.remove('recording');
      floatingInput.placeholder = "Ask Nester...";
      floatingInput.focus();
    };
    recognition.start();
  });
}

if (veUnsavedDiscard) {
  veUnsavedDiscard.addEventListener('click', () => {
    pendingVisualEdits = {};
    updateUnsavedBar();
    if (previewReload) previewReload.click();
    if (visualEditBackBtn) visualEditBackBtn.click();
  });
}

if (veUnsavedSave) {
  veUnsavedSave.addEventListener('click', () => {
    if (Object.keys(pendingVisualEdits).length === 0) return;

    // Send structured edits including element metadata for server-side prompt construction
    const editsPayload = {};
    for (const [veId, item] of Object.entries(pendingVisualEdits)) {
      editsPayload[veId] = {
        changes: item.changes,
        tagName: item.tagName,
        textContent: (item.textContent || '').substring(0, 80),
      };
    }

    const displayLine = buildVisualEditsChatSummary(pendingVisualEdits);
    pendingVisualEdits = {};
    updateUnsavedBar();

    toggleVisualEditMode(false);
    if (chatInput) chatInput.value = '';
    resizeChatInput();
    sendChatMessage({ displayText: displayLine, prompt: { _visualEdits: editsPayload } });
  });
}

// ── Custom Dropdown Converter ──
function initCustomSelects() {
  document.querySelectorAll('.ve-sidebar__control select').forEach(selectEl => {
    if (selectEl.dataset.customized) return;
    selectEl.dataset.customized = 'true';
    selectEl.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';

    const selectedText = document.createElement('div');
    selectedText.className = 'custom-select-selected';

    const renderSelected = () => {
      const label = selectEl.options[selectEl.selectedIndex]?.textContent || '';
      selectedText.innerHTML = `<span>${label}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    };
    renderSelected();

    const dropdown = document.createElement('div');
    dropdown.className = 'custom-select-dropdown';

    const renderOptions = () => {
      dropdown.innerHTML = '';
      Array.from(selectEl.options).forEach((opt, index) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'custom-select-option';
        if (index === selectEl.selectedIndex) {
          optionDiv.classList.add('selected');
        }
        optionDiv.innerHTML = `<span>${opt.textContent}</span>${index === selectEl.selectedIndex ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}`;

        optionDiv.addEventListener('mousedown', (e) => {
          e.preventDefault(); // prevent blur from closing early if focus logic is added
          selectEl.selectedIndex = index;
          renderSelected();
          selectEl.dispatchEvent(new Event('change'));
          wrapper.classList.remove('open');
          renderOptions();
        });
        dropdown.appendChild(optionDiv);
      });
    };

    renderOptions();

    selectEl.addEventListener('change', () => {
      renderSelected();
      renderOptions();
    });

    const observer = new MutationObserver(() => {
      renderSelected();
      renderOptions();
    });
    observer.observe(selectEl, { childList: true });

    selectedText.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wrapper.classList.contains('open');
      document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
      if (!isOpen) {
        wrapper.classList.add('open');
        const rect = wrapper.getBoundingClientRect();
        const dropHeight = 220; // safe arbitrary max height 
        if (window.innerHeight - rect.bottom < dropHeight && rect.top > dropHeight) {
          dropdown.style.bottom = '100%';
          dropdown.style.top = 'auto';
          dropdown.style.marginBottom = '4px';
          dropdown.style.marginTop = '0';
        } else {
          dropdown.style.top = '100%';
          dropdown.style.bottom = 'auto';
          dropdown.style.marginTop = '4px';
          dropdown.style.marginBottom = '0';
        }
      }
    });

    document.addEventListener('click', () => {
      wrapper.classList.remove('open');
    });

    selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);
    wrapper.appendChild(selectEl);
    wrapper.appendChild(selectedText);
    wrapper.appendChild(dropdown);
  });
}

// Initialize custom selects on load
setTimeout(initCustomSelects, 200);
