// ── DOM Elements ──

// Theme
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
const previewFrame = document.getElementById('preview-frame');
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
const panelHeaderText = document.querySelector('.panel__header span');

// Property Controls
var veTextContent = document.getElementById('ve-text-content');
var veColorText = document.getElementById('ve-color-text');
var veColorTextPreview = document.getElementById('ve-color-text-preview');
var veColorBg = document.getElementById('ve-color-bg');
var veColorBgPreview = document.getElementById('ve-color-bg-preview');
var veFontSize = document.getElementById('ve-font-size');
var veFontWeight = document.getElementById('ve-font-weight');
var veFontStyle = document.getElementById('ve-font-style');
var veMarginAll = document.getElementById('ve-margin-all');
var vePaddingAll = document.getElementById('ve-padding-all');
var veAlignBtns = document.querySelectorAll('.align-btn');

// Resize
const resizeHandle = document.getElementById('resize-handle');
const panelLeft = document.getElementById('panel-left');

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
let currentUpdatedShadcnSource = null;
let currentShadcnComponentName = null;
let currentShadcnSubComponents = null;
let currentComponentPropertyDefs = null;
let currentVariantMetadata = null;
/** Set of folder path prefixes that are expanded in wired app tree (e.g. 'src', 'src/components') */
let wiredExplorerExpanded = new Set(['src', 'public']);

// Visual Edit State
window.isVisualEditMode = false;
let selectedElementInfo = null;
let visualEditIframeInjected = false;

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
}

function deleteProject(id) {
  const projects = loadProjects().filter(p => p.id !== id);
  saveProjects(projects);
  if (currentProjectId === id) currentProjectId = null;
  renderProjectList();
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
  duplicateMessage.innerHTML = `<strong>${name}</strong> was already converted <strong>${timeAgo}</strong>. Would you like to open the existing project or convert again?`;
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
    const thumbStyle = p.thumbnail
      ? `background-image: url(${p.thumbnail}); background-size: cover;`
      : `background: hsl(200, 55%, 45%);`;
    const letter = (p.name || '?')[0].toUpperCase();
    html += `<div class="sidebar__project-item${isActive ? ' active' : ''}" data-project-id="${escapeHtml(p.id)}" title="${escapeHtml(p.name)}">
      <div class="sidebar__project-thumb sidebar__project-thumb--placeholder" style="${thumbStyle}">${p.thumbnail ? '' : letter}</div>
      <div class="sidebar__project-info">
        <div class="sidebar__project-name">${escapeHtml(p.name)}</div>
        <div class="sidebar__project-date">${formatTimeAgo(p.updatedAt || p.createdAt)}</div>
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
}

function restoreProject(projectId) {
  const project = getProject(projectId);
  if (!project) return;

  currentProjectId = project.id;
  currentSessionId = project.sessionId || project.id;
  currentComponentName = project.name || '';
  currentFrameworkOutputs = project.frameworkOutputs || {};

  // Switch to split view
  mainHero.classList.add('hidden');
  mainSplit.classList.add('visible');
  mainHero.closest('.main')?.classList.add('split-visible');

  // Auto-collapse sidebar on selection (non-mobile)
  if (window.innerWidth > 768) {
    sidebar.classList.add('collapsed');
    updateSidebarToggleTitle();
    updateMenuButtonVisibility();
  }

  // Set URL input
  figmaUrlInput.value = project.figmaUrl || '';

  // Sync framework checkboxes
  const frameworks = project.frameworks || [];
  mainSplit.querySelectorAll('input[name="framework"]').forEach(cb => {
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

  // Preview: show loading state, then try server session first, fall back to inline
  previewEmpty.style.display = 'none';
  setPreviewLoading(true, 'Loading preview...');
  fetch(`/api/preview/${currentSessionId}`, { method: 'HEAD' })
    .then(r => {
      if (r.ok) {
        setPreviewReady(`/api/preview/${currentSessionId}`, false, 'Static preview');
      } else {
        showInlinePreview(project);
      }
    })
    .catch(() => showInlinePreview(project));

  // Restore wired app files if template was wired
  if (templateWired) {
    fetch(`/api/session/${currentSessionId}/wired-app-files`)
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
      addChatMessage(msg.role, msg.content, true);
    }
  }

  // Switch to chat input mode
  if (urlInputGroup) urlInputGroup.style.display = 'none';
  if (chatInputGroup) chatInputGroup.style.display = 'block';

  setStatus('done', 'Conversion complete');
  renderProjectList();
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
          <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>${componentName}</h1>
          <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#666' }}>
            {allVariants.length} variant combination{allVariants.length !== 1 ? 's' : ''}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {allVariants.map((v, i) => (
              <div key={i} style={{ width: '100%' }}>
                <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', color: '#666' }}>{v.label}</div>
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

        document.addEventListener('mouseover', (e) => {
          if (!window.parentVisualEditActive) return;
          if (lastHovered && lastHovered !== selectedEl) {
            lastHovered.classList.remove('ve-hover-outline');
          }
          lastHovered = e.target;
          if (lastHovered && lastHovered !== selectedEl && lastHovered !== document.body && lastHovered !== document.documentElement) {
            lastHovered.classList.add('ve-hover-outline');
          }
        }, true);

        document.addEventListener('click', (e) => {
          if (!window.parentVisualEditActive) return;
          e.preventDefault();
          e.stopPropagation();

          if (selectedEl) {
            selectedEl.classList.remove('ve-selected-outline');
          }
          selectedEl = e.target;
          if (!selectedEl || selectedEl === document.body || selectedEl === document.documentElement) return;

          selectedEl.classList.remove('ve-hover-outline');
          selectedEl.classList.add('ve-selected-outline');

          const style = window.getComputedStyle(selectedEl);
          const rect = selectedEl.getBoundingClientRect();

          window.parent.postMessage({
            type: 'elementSelected',
            tagName: selectedEl.tagName.toLowerCase(),
            textContent: selectedEl.textContent.trim(),
            computedStyle: {
              color: style.color,
              backgroundColor: style.backgroundColor,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
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
          if (e.data.type === 'updateElement') {
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
              if (lastHovered) lastHovered.classList.remove('ve-hover-outline');
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

  // Build JSX source for manual Babel.transform (with error handling)
  const jsxSource = `const { useState, useEffect, useRef, useCallback, useMemo } = React;${rechartsGlobals}\n` +
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
  if (el) el.innerHTML = '<div class="preview-error"><h3>Preview Error</h3>' + msg + '</div>';
};
try {
  var jsxCode = \`${escapedJSX}\`;
  var result = Babel.transform(jsxCode, { presets: ['react'], plugins: ['proposal-optional-chaining', 'proposal-nullish-coalescing-operator'] });
  var script = document.createElement('script');
  script.textContent = result.code;
  document.body.appendChild(script);
} catch (e) {
  var el = document.getElementById('root');
  if (el) el.innerHTML = '<div class="preview-error"><h3>Babel Transpile Error</h3>' + (e.message || e) + '</div>';
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
  previewFrame.src = 'about:blank';
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

// Sidebar nav item selection
document.querySelectorAll('.sidebar__nav-item').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.sidebar__nav-item').forEach((item) => item.classList.remove('active'));
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

function startConversion(skipDuplicateCheck) {
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
  mainHero.closest('.main')?.classList.add('split-visible');

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

  // Reset right panel to preview mode and hide previous results
  switchMode('preview');
  previewEmpty.style.display = 'flex';
  previewFrame.style.display = 'none';
  previewFrame.src = 'about:blank';
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
  const body = JSON.stringify({ figmaUrl, figmaToken, frameworks, template: true });

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
  previewFrame.src = url;
  if (previewHeader) previewHeader.style.display = 'flex';
  if (previewLiveBadge) previewLiveBadge.style.display = isLive ? 'inline-block' : 'none';
  if (previewStatus) previewStatus.textContent = isLive ? 'Live Vite preview' : (statusText || '');
  if (previewReload) previewReload.style.display = 'inline-flex';
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

  const hasCharts = (chartComponents && chartComponents.length > 0) ||
    /from ['"]recharts['"]/.test(componentCode);
  const hasShadcnSub = !!(currentShadcnSubComponents && currentShadcnSubComponents.length);
  const needsShadcnDeps = hasShadcn || hasShadcnSub;
  const deps = { react: '^18.3.1', 'react-dom': '^18.3.1' };
  if (hasCharts) deps['recharts'] = '^2.12.0';
  if (needsShadcnDeps) {
    deps['class-variance-authority'] = '^0.7.0';
    deps['clsx'] = '^2.1.0';
    deps['tailwind-merge'] = '^2.2.0';
    deps['@radix-ui/react-slot'] = '^1.0.2';
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
    // Also scan consumer code for any additional imports
    const allCode = componentCode + allShadcnSources.join('');
    if (/lucide-react/.test(allCode)) deps['lucide-react'] = '^0.460.0';
    if (/react-day-picker/.test(allCode)) deps['react-day-picker'] = '^8.10.0';
    if (/date-fns/.test(allCode)) deps['date-fns'] = '^3.6.0';
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
    devDependencies: {
      '@vitejs/plugin-react': '^4.3.4',
      autoprefixer: '^10.4.21',
      postcss: '^8.5.6',
      tailwindcss: '^3.4.17',
      vite: '^5.4.19',
    },
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

      document.addEventListener('mouseover', (e) => {
        if (!window.parentVisualEditActive) return;
        if (lastHovered && lastHovered !== selectedEl) {
          lastHovered.classList.remove('ve-hover-outline');
        }
        lastHovered = e.target;
        if (lastHovered && lastHovered !== selectedEl && lastHovered !== document.body && lastHovered !== document.documentElement) {
          lastHovered.classList.add('ve-hover-outline');
        }
      }, true);

      document.addEventListener('click', (e) => {
        if (!window.parentVisualEditActive) return;
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

        const style = window.getComputedStyle(selectedEl);
        const rect = selectedEl.getBoundingClientRect();

        window.parent.postMessage({
          type: 'elementSelected',
          tagName: selectedEl.tagName.toLowerCase(),
          textContent: selectedEl.textContent.trim(),
          computedStyle: {
            color: style.color,
            backgroundColor: style.backgroundColor,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
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
        if (e.data.type === 'updateElement') {
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
            if (lastHovered) lastHovered.classList.remove('ve-hover-outline');
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
    'src/index.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;\nbody { margin: 0; padding: 40px; background: #ffffff; color: #111111; font-family: system-ui, sans-serif; min-height: 100vh; }',
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
  const stateKeywords = ['default','hover','focus','disabled','loading','active','pressed','error','selected','rest'];

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
                <div key={idx} style={{ padding: '12px', background: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', flexShrink: 0 }}>
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

async function bootWebContainer(tree) {
  if (!isWebContainerSupported()) {
    throw new Error('WebContainers require Chrome or Edge.');
  }
  const mod = await import(/* webpackIgnore: true */ WEBCONTAINER_CDN + '/+esm');
  const WebContainer = mod.WebContainer || mod.default?.WebContainer || mod.default;
  if (!WebContainer) throw new Error('WebContainer API not loaded');
  if (webContainerDevProcess) {
    webContainerDevProcess.kill?.();
    webContainerDevProcess = null;
  }
  if (!webContainerInstance) {
    webContainerInstance = await WebContainer.boot();
    webContainerInstance.on('error', (e) => {
      setPreviewError(e.message || 'WebContainer error');
    });
  }
  setPreviewLoading(true, 'Mounting project...');
  await webContainerInstance.mount(tree);
  setPreviewLoading(true, 'Installing dependencies...');
  const installProc = await webContainerInstance.spawn('npm', ['install']);
  const installExit = await installProc.exit;
  if (installExit !== 0) throw new Error('npm install failed');
  setPreviewLoading(true, 'Starting Vite...');
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

  // Build code tabs (generated view)
  buildTabs(data);
  generatedTabsData = tabsData.map((t) => ({ ...t }));

  // When template was wired, show "Generated | Wired app" toggle and fetch wired app files
  if (templateWired && codeViewModeEl) {
    codeViewModeEl.style.display = 'flex';
    fetch(`/api/session/${currentSessionId}/wired-app-files`)
      .then((r) => (r.ok ? r.json() : { files: {} }))
      .then((res) => {
        wiredAppFiles = res.files || {};
      })
      .catch(() => { });
  } else if (codeViewModeEl) {
    codeViewModeEl.style.display = 'none';
  }

  // Show download and push buttons
  downloadBtn.style.display = 'inline-flex';
  const pushGithubBtn = document.getElementById('push-github-btn');
  if (pushGithubBtn) pushGithubBtn.style.display = 'inline-flex';

  // Preview: try WebContainer live when React available and supported
  webContainerSyncEnabled = false;
  webContainerLastWritten = {};
  const frameworks = data.frameworks || [];
  const hasReact = frameworks.includes('react');
  const reactCode = currentFrameworkOutputs.react || '';

  if (hasReact && reactCode && !reactCode.startsWith('// Error') && isWebContainerSupported()) {
    const currentChartComponents = data.chartComponents || [];
    fetch(`/api/session/${currentSessionId}/push-files`)
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
        setPreviewReady(`/api/preview/${currentSessionId}`, false, 'Static preview');
      });
  } else {
    const statusText = !hasReact ? 'Static preview' : !isWebContainerSupported() ? 'Static preview (Chrome/Edge for live)' : '';
    setPreviewReady(`/api/preview/${currentSessionId}`, false, statusText);
  }

  // Save project to history
  const figmaUrl = figmaUrlInput.value.trim() || heroFigmaUrlInput.value.trim();
  currentProjectId = data.sessionId;
  saveProject({
    id: data.sessionId,
    sessionId: data.sessionId,
    name: data.componentName,
    figmaUrl,
    frameworks,
    frameworkOutputs: currentFrameworkOutputs,
    mitosisSource: data.mitosisSource || '',
    thumbnail: generatePlaceholderThumbnail(data.componentName),
    chatHistory: [],
    componentPropertyDefinitions: data.componentPropertyDefinitions || null,
    assets: data.assets || [],
    templateWired: Boolean(data.templateWired),
    chartComponents: data.chartComponents || [],
  });

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
let chatRefining = false;

function initChat() {
  if (!currentSessionId) return;
  // Switch input bar from URL to chat mode
  if (urlInputGroup) urlInputGroup.style.display = 'none';
  if (chatInputGroup) chatInputGroup.style.display = 'block';
  // Show chat messages container
  if (chatMessages) chatMessages.classList.add('visible');
  // Add a system message
  addChatMessage('system', 'Conversion complete. Describe changes to refine the component.');
}

function addChatMessage(role, content, skipPersist) {
  if (!chatMessages) return;
  const div = document.createElement('div');
  div.className = `chat-message chat-message--${role}`;
  if (role === 'system' && content.includes('...')) {
    div.innerHTML = `<span class="chat-spinner-inline"></span>${escapeHtml(content)}`;
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

function setChatLoading(loading) {
  chatRefining = loading;
  if (chatSpinner) chatSpinner.style.display = loading ? 'inline-block' : 'none';
  if (chatSendIcon) chatSendIcon.style.display = loading ? 'none' : 'inline';
  if (chatInput) chatInput.disabled = loading;
  if (chatSendBtn) chatSendBtn.disabled = loading;
}

function sendChatMessage(customText) {
  if (chatRefining || !currentSessionId) return;
  const prompt = customText || chatInput?.value?.trim();
  if (!prompt) return;

  // Add user message to chat
  addChatMessage('user', prompt);
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // Show loading indicator
  setChatLoading(true);
  const loadingMsg = addChatMessage('system', 'Generating...');

  const body = JSON.stringify({ sessionId: currentSessionId, prompt });

  fetch('/api/refine', {
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
        setChatLoading(false);
        removeChatMessage(loadingMsg);
        addChatMessage('system', `Connection lost: ${err.message}`);
      });
    }
    readStream();
  }).catch((err) => {
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
        loadingMsg.innerHTML = `<span class="chat-spinner-inline"></span>${escapeHtml(data.message)}`;
      }
      break;
    case 'complete':
      setChatLoading(false);
      removeChatMessage(loadingMsg);
      handleRefineComplete(data);
      addChatMessage('assistant', 'Component updated successfully.');
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
  if (data.mitosisSource) {
    // Update the mitosis tab data
    const mitosisTab = tabsData.find(t => t.key === 'mitosis');
    if (mitosisTab) mitosisTab.code = data.mitosisSource;
  }
  // Update framework tab data
  for (const [fw, code] of Object.entries(currentFrameworkOutputs)) {
    const tab = tabsData.find(t => t.key === fw);
    if (tab) tab.code = code;
  }

  // Keep generatedTabsData in sync (for Generated/Wired toggle)
  generatedTabsData = tabsData.map(t => ({ ...t }));

  // Persist updated outputs to project history
  if (currentProjectId) {
    updateProjectField(currentProjectId, { frameworkOutputs: currentFrameworkOutputs });
  }

  // Refresh Monaco if a tab is open
  if (activeFile && monacoEditor) {
    const currentTab = tabsData.find(t => t.key === activeFile);
    if (currentTab) {
      monacoEditor.setValue(currentTab.code || '');
    }
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

      writeWebContainerFiles({
        [wcPath]: finalCode,
        [cssPath]: css || `/* ${currentComponentName} */`,
        [appJsxPath]: appJsx,
      }).then(() => {
        // Force reload after Vite processes file changes
        setTimeout(() => {
          if (previewFrame && webContainerPreviewUrl) {
            const url = webContainerPreviewUrl;
            previewFrame.src = 'about:blank';
            setTimeout(() => { previewFrame.src = url; }, 150);
          }
        }, 2000);
      }).catch(() => {
        previewFrame.src = staticUrl;
      });
    } else {
      // Static preview path: reload iframe
      previewFrame.src = staticUrl;
    }
  }
}

// Chat input events
if (chatSendBtn) {
  chatSendBtn.addEventListener('click', sendChatMessage);
}
if (chatInput) {
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  // Auto-resize textarea
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
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

  if (explorerSectionTitle) explorerSectionTitle.textContent = 'Generated Files';
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
    explorerSectionTitle.textContent = mode === 'wired' ? 'Wired app' : 'Generated Files';
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

// ── Code view mode (Generated | Wired app) ──
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
downloadBtn.addEventListener('click', () => {
  if (!currentSessionId) return;
  window.location.href = `/api/download/${currentSessionId}`;
});

if (previewReload) {
  previewReload.addEventListener('click', () => {
    if (previewFrame.src && previewFrame.src !== 'about:blank') {
      previewFrame.src = previewFrame.src;
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
  const connectBtn = document.getElementById('github-connect-btn');
  const connectSpinner = document.getElementById('github-connect-spinner');
  const connectIcon = document.getElementById('github-connect-icon');
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

  let supabaseUrl = '';
  let supabaseKey = '';
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
    fetch(`/api/session/${currentSessionId}/push-files?mode=${pushMode}`)
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

    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        supabaseUrl = cfg.supabaseUrl || '';
        supabaseKey = cfg.supabaseKey || '';
        if (!cfg.githubPushConfigured) {
          connectBtn.disabled = true;
          showError('GitHub push is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to the server environment.');
          connectSection.style.display = 'block';
          formEl.style.display = 'none';
          return;
        }
        connectBtn.disabled = false;
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
        showError('Failed to load configuration.');
        connectSection.style.display = 'block';
        formEl.style.display = 'none';
      });
  }

  function closeDialog() {
    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('visible');
  }

  async function invokeSupabase(action, options = {}) {
    const params = new URLSearchParams({ action });
    if (options.query) {
      Object.entries(options.query).forEach(([k, v]) => params.set(k, v));
    }
    const url = `${supabaseUrl}/functions/v1/github-push?${params}`;
    const headers = {
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };
    if (options.githubToken) headers['x-github-token'] = options.githubToken;
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error || `Request failed: ${res.status}`);
      err.context = res;
      throw err;
    }
    return data;
  }

  async function fetchReposAndUser(token) {
    try {
      const [reposData, userData] = await Promise.all([
        invokeSupabase('repos', { method: 'GET', githubToken: token }),
        invokeSupabase('user', { method: 'GET', githubToken: token }),
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
      const data = await invokeSupabase('oauth-url', { method: 'GET', query: { redirect_uri: redirectUri } });
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
      const data = await invokeSupabase('exchange-code', {
        method: 'POST',
        body: JSON.stringify({ code: p.code, redirectUri: `${window.location.origin}/auth/github/callback` }),
      });
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
        const createRes = await invokeSupabase('create-repo', {
          method: 'POST',
          body: JSON.stringify({
            githubToken: token,
            repo: name,
            repoDescription: `${currentComponentName} - Generated by Figma to Code`,
            isPrivate: privateCheckbox.checked,
          }),
        });
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

      const result = await invokeSupabase('push', {
        method: 'POST',
        body: JSON.stringify({
          githubToken: token,
          owner,
          repo,
          branch,
          commitMessage: commitMsgInput.value.trim() || `feat: add ${currentComponentName} component`,
          files: filesToPush,
        }),
      });

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
    pushGithubBtn.addEventListener('click', openDialog);
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

// ── Init ──
loadSavedToken();
loadExplorerIconConfig();
updateCodeActionsState();
renderProjectList();

// Show hero on load, hide split (split has no .visible = hidden by default)
mainHero.classList.remove('hidden');
mainSplit.classList.remove('visible');
mainHero.closest('.main')?.classList.remove('split-visible');

// ── Visual Edit ──

function toggleVisualEditMode(active) {
  console.log('toggleVisualEditMode called with:', active);
  window.isVisualEditMode = active;
  console.log('window.isVisualEditMode is now:', window.isVisualEditMode);
  if (active) {
    if (emptyState) emptyState.style.display = 'none';
    if (chatMessages) chatMessages.style.display = 'none';
    if (progressCollapsible) progressCollapsible.style.display = 'none';
    if (visualEditSidebar) visualEditSidebar.style.display = 'flex';
    if (panelHeaderActions) panelHeaderActions.style.display = 'flex';
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
    if (panelHeaderText) panelHeaderText.textContent = 'Import Design';
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
  if (veTextContent) veTextContent.value = info.textContent;
  if (veColorText) veColorText.value = info.computedStyle.color;
  if (veColorTextPreview) veColorTextPreview.style.backgroundColor = info.computedStyle.color;
  if (veColorBg) veColorBg.value = info.computedStyle.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'transparent' : info.computedStyle.backgroundColor;
  if (veColorBgPreview) veColorBgPreview.style.backgroundColor = info.computedStyle.backgroundColor;

  // Sync Typography
  if (veFontSize) {
    veFontSize.value = info.computedStyle.fontSize;
    // If exact match not found, we could find closest or default
  }
  if (veFontWeight) {
    veFontWeight.value = info.computedStyle.fontWeight;
  }
  
  if (veAlignBtns) {
    veAlignBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.align === info.computedStyle.textAlign);
    });
  }

  // Sync Spacing
  if (veMarginAll) veMarginAll.value = info.computedStyle.margin;
  if (vePaddingAll) vePaddingAll.value = info.computedStyle.padding;

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
  if (previewFrame && previewFrame.contentWindow) {
    previewFrame.contentWindow.postMessage({ type: 'updateElement', prop, value }, '*');
  }
}

if (veTextContent) {
  veTextContent.addEventListener('input', (e) => updateIframeElement('textContent', e.target.value));
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
      const align = btn.dataset.align;
      updateIframeElement('textAlign', align);
      veAlignBtns.forEach(b => b.classList.toggle('active', b === btn));
    });
  });
}

if (veMarginAll) {
  veMarginAll.addEventListener('input', (e) => updateIframeElement('margin', e.target.value));
}

if (vePaddingAll) {
  vePaddingAll.addEventListener('input', (e) => updateIframeElement('padding', e.target.value));
}

// AI Input in Floating Prompt
if (floatingInput) {
  floatingInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const promptText = floatingInput.value.trim();
      if (!promptText) return;

      // Switch back to chat and send prompt
      const context = `Modify the selected ${selectedElementInfo.tagName}: ${promptText}`;
      toggleVisualEditMode(false);
      if (chatInput) chatInput.value = context;
      sendChatMessage(context);
      floatingInput.value = '';
    }
  });
}

if (floatingSendBtn) {
  floatingSendBtn.addEventListener('click', () => {
    const promptText = floatingInput.value.trim();
    if (!promptText) return;
    const context = `Modify the selected ${selectedElementInfo.tagName}: ${promptText}`;
    toggleVisualEditMode(false);
    if (chatInput) chatInput.value = context;
    sendChatMessage(context);
    floatingInput.value = '';
  });
}
