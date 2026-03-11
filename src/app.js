import {
  buildDateHeading,
  buildDailyTitle,
  buildMonthTitle,
  buildSingleTitle,
  compareIsoDesc,
  getDateKey,
  getMonthKey,
  getTimestamp,
  getTimezone,
  humanizeLastEdited,
  toIso,
  parseDateHeading,
} from "./date.js";
import {
  clearHandle,
  collectProjectFiles,
  ensureDirectory,
  ensurePermission,
  getDirectoryIfExists,
  getFileIfExists,
  getFileText,
  isFileSystemAccessSupported,
  listDirectory,
  loadHandle,
  pickRootDirectory,
  readJsonFile,
  readTextFile,
  removeDirectory,
  requestPermission,
  saveHandle,
  writeJsonFile,
  writeTextFile,
} from "./fs.js";
import { createZip } from "./zip.js";
import { escapeHtml, markdownToText, renderMarkdown, stripFrontmatter } from "./markdown.js";

const ROOT_HANDLE_KEY = "devlog-root";
const PREFERENCES_KEY = "devlog-preferences";
const DOC_LABELS = {
  log: "Log",
  tasks: "Tasks",
  info: "Info",
};
const DEFAULT_PROJECT_SETTINGS = {
  dateFormat: "YYYY-MM-DD (ddd)",
  timeFormat: "HH:mm",
  logPartition: "monthly",
};
const DEFAULT_APP_SETTINGS = {
  activeDoc: "log",
  activeProjectId: "",
  softWrap: true,
  splitRatio: 50,
  timestampVisibility: "muted",
  viewMode: "split",
  sidebarCollapsed: false,
};

const refs = {};
const preferences = loadPreferences();

const state = {
  support: isFileSystemAccessSupported(),
  rootHandle: null,
  rootPermission: "none",
  manifest: {
    version: 1,
    projects: [],
  },
  projectHandles: new Map(),
  activeProjectHandle: null,
  activeProjectConfig: null,
  activeProjectId: preferences.activeProjectId || "",
  activeDoc: preferences.activeDoc || "log",
  activeView: preferences.viewMode || "split",
  currentDocumentDescriptor: null,
  currentContent: "",
  baselineContent: "",
  lastLoadedDiskContent: null,
  activeFileExists: false,
  projectFilter: "",
  dirty: false,
  saveStatus: "idle",
  pendingSaveTimer: 0,
  conflict: null,
  lastFindTerm: "",
  ignoreNextLeadingSpace: false,
  appSettings: {
    softWrap: preferences.softWrap !== false,
    timestampVisibility: preferences.timestampVisibility || "muted",
  },
  sidebarCollapsed: Boolean(preferences.sidebarCollapsed),
  splitRatio: Number(preferences.splitRatio) || 50,
};

function loadPreferences() {
  try {
    return {
      ...DEFAULT_APP_SETTINGS,
      ...JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}"),
    };
  } catch (error) {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

function savePreferences() {
  localStorage.setItem(
    PREFERENCES_KEY,
    JSON.stringify({
      activeDoc: state.activeDoc,
      activeProjectId: state.activeProjectId,
      softWrap: state.appSettings.softWrap,
      splitRatio: state.splitRatio,
      timestampVisibility: state.appSettings.timestampVisibility,
      viewMode: state.activeView,
      sidebarCollapsed: state.sidebarCollapsed,
    }),
  );
}

function byId(id) {
  return document.getElementById(id);
}

function cacheRefs() {
  refs.appShell = byId("app-shell");
  refs.sidebar = byId("sidebar");
  refs.brandButton = byId("brand-button");
  refs.newProjectButton = byId("new-project-button");
  refs.rootPill = byId("root-pill");
  refs.projectSearch = byId("project-search");
  refs.projectList = byId("project-list");
  refs.breadcrumb = byId("breadcrumb");
  refs.projectTitle = byId("project-title");
  refs.docSwitcher = byId("doc-switcher");
  refs.viewSwitcher = byId("view-switcher");
  refs.todayButton = byId("today-button");
  refs.settingsButton = byId("settings-button");
  refs.workspaceBody = document.querySelector(".workspace-body");
  refs.emptyState = byId("empty-state");
  refs.emptyPickRoot = byId("empty-pick-root");
  refs.emptyNewProject = byId("empty-new-project");
  refs.supportNote = byId("support-note");
  refs.editorArea = byId("editor-area");
  refs.editorToolbar = byId("editor-toolbar");
  refs.conflictBanner = byId("conflict-banner");
  refs.reloadDiskButton = byId("reload-disk-button");
  refs.overwriteDiskButton = byId("overwrite-disk-button");
  refs.editorSurface = byId("editor-surface");
  refs.paneResizer = byId("pane-resizer");
  refs.editor = byId("editor-textarea");
  refs.preview = byId("preview");
  refs.previewBadge = byId("preview-badge");
  refs.saveIndicator = byId("save-indicator");
  refs.docKindPill = byId("doc-kind-pill");
  refs.filePath = byId("file-path");
  refs.wordCount = byId("word-count");
  refs.modal = byId("modal");
}

function bindEvents() {
  refs.brandButton.addEventListener("click", handleSidebarToggle);
  refs.emptyPickRoot.addEventListener("click", handlePickRoot);
  refs.newProjectButton.addEventListener("click", handleNewProject);
  refs.emptyNewProject.addEventListener("click", handleNewProject);
  refs.projectSearch.addEventListener("input", handleProjectFilter);
  refs.projectList.addEventListener("click", handleProjectListClick);
  refs.docSwitcher.addEventListener("click", handleDocSwitchClick);
  refs.viewSwitcher.addEventListener("click", handleViewSwitchClick);
  refs.todayButton.addEventListener("click", handleJumpToToday);
  refs.settingsButton.addEventListener("click", handleSettings);
  refs.paneResizer.addEventListener("pointerdown", handlePaneResizeStart);
  refs.editorToolbar.addEventListener("click", handleToolbarClick);
  refs.editor.addEventListener("keydown", handleEditorKeydown);
  refs.editor.addEventListener("input", handleEditorInput);
  refs.editor.addEventListener("blur", handleEditorBlur);
  refs.reloadDiskButton.addEventListener("click", handleReloadDiskCopy);
  refs.overwriteDiskButton.addEventListener("click", handleOverwriteDiskCopy);
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("pagehide", handlePageHide);
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

async function init() {
  cacheRefs();
  bindEvents();
  applySidebarState();
  applyViewMode();
  applyEditorWrap();
  updateSupportNote();
  renderProjectList();
  renderWorkspace();
  registerServiceWorker();
  await restoreRootFromStorage();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.error("Service worker registration failed:", error);
  });
}

async function restoreRootFromStorage() {
  if (!state.support) {
    return;
  }

  try {
    const handle = await loadHandle(ROOT_HANDLE_KEY);

    if (!handle) {
      renderWorkspace();
      return;
    }

    state.rootHandle = handle;
    state.rootPermission = (await ensurePermission(handle)) ? "granted" : "needs-permission";

    if (state.rootPermission === "granted") {
      await loadWorkspace();
    } else {
      renderWorkspace();
    }
  } catch (error) {
    console.error(error);
    await clearHandle(ROOT_HANDLE_KEY);
    state.rootHandle = null;
    state.rootPermission = "none";
    renderWorkspace();
  }
}

function updateSupportNote() {
  refs.supportNote.textContent = state.support
    ? "Direct folder access works best in Chrome, Edge, Arc, or another Chromium browser."
    : "This browser cannot grant a writable folder handle, so the app cannot store Markdown in your chosen directory.";
}

async function handlePickRoot() {
  if (!state.support) {
    return;
  }

  try {
    const handle = await pickRootDirectory();
    const granted = await requestPermission(handle);

    if (!granted) {
      return;
    }

    state.rootHandle = handle;
    state.rootPermission = "granted";
    await saveHandle(ROOT_HANDLE_KEY, handle);
    await loadWorkspace();
  } catch (error) {
    if (error.name !== "AbortError") {
      showError("Could not open the selected folder.", error);
    }
  }
}

async function loadWorkspace() {
  if (!state.rootHandle) {
    return;
  }

  try {
    state.projectHandles.clear();
    state.manifest = await loadManifest();
    await writeManifest();

    if (!findProjectMeta(state.activeProjectId)) {
      state.activeProjectId = state.manifest.projects[0]?.id || "";
    }

    savePreferences();
    renderProjectList();

    if (state.activeProjectId) {
      await openProject(state.activeProjectId, { focus: false });
    } else {
      clearDocumentState();
      renderWorkspace();
    }
  } catch (error) {
    showError("Could not load the selected root folder.", error);
  }
}

async function loadManifest() {
  const manifestResult = await readJsonFile(state.rootHandle, "manifest.json");
  const baseManifest =
    manifestResult.value && Array.isArray(manifestResult.value.projects)
      ? {
          version: 1,
          projects: manifestResult.value.projects.map(normalizeProjectMeta),
        }
      : {
          version: 1,
          projects: [],
        };

  const scannedProjects = await scanRootProjects(baseManifest.projects);
  const mergedProjects = new Map();

  for (const project of baseManifest.projects) {
    mergedProjects.set(project.path || project.id, { ...project });
  }

  for (const project of scannedProjects) {
    const key = project.path || project.id;
    const existing = mergedProjects.get(key);
    mergedProjects.set(key, {
      ...existing,
      ...project,
      lastEdited: pickLatestIso(existing?.lastEdited, project.lastEdited),
    });
  }

  return {
    version: 1,
    projects: Array.from(mergedProjects.values()).sort(sortProjects),
  };
}

function normalizeProjectMeta(project) {
  return {
    id: project.id,
    name: project.name,
    path: project.path || project.id,
    lastEdited: project.lastEdited || null,
  };
}

async function scanRootProjects(manifestProjects) {
  const entries = await listDirectory(state.rootHandle);
  const projects = [];

  for (const entry of entries) {
    if (entry.kind !== "directory" || entry.name.startsWith(".")) {
      continue;
    }

    const existingMeta = manifestProjects.find((project) => project.path === entry.name || project.id === entry.name);
    const inferred = await inferProject(entry.handle, existingMeta);

    if (inferred) {
      projects.push(inferred);
    }
  }

  return projects;
}

async function inferProject(projectHandle, existingMeta) {
  const rawProjectJson = await readJsonFile(projectHandle, "project.json");
  let projectConfig = rawProjectJson.value ? normalizeProjectConfig(rawProjectJson.value, existingMeta?.name) : null;

  if (!projectConfig) {
    const logsHandle = await getDirectoryIfExists(projectHandle, "logs");
    const logEntries = logsHandle ? await listDirectory(logsHandle) : [];
    const hasLogs = logEntries.some((entry) => entry.kind === "file" && entry.name.endsWith(".md"));
    const hasTasks = Boolean(await getFileIfExists(projectHandle, "tasks.md"));
    const hasInfo = Boolean(await getFileIfExists(projectHandle, "info.md"));

    if (!hasLogs && !hasTasks && !hasInfo) {
      return null;
    }

    projectConfig = normalizeProjectConfig(
      {
        id: entryNameToId(projectHandle.name),
        name: existingMeta?.name || titleFromSlug(projectHandle.name),
        createdAt: toIso(new Date()),
        logPartition: inferLogPartition(logEntries),
      },
      existingMeta?.name,
    );

    await writeJsonFile(projectHandle, "project.json", projectConfig);
  }

  state.projectHandles.set(projectConfig.id, projectHandle);

  return {
    id: projectConfig.id,
    name: projectConfig.name,
    path: projectHandle.name,
    lastEdited: pickLatestIso(existingMeta?.lastEdited, await inferLastEdited(projectHandle)),
  };
}

function normalizeProjectConfig(rawProject, fallbackName) {
  if (!rawProject) {
    return null;
  }

  const name = rawProject.name?.trim() || fallbackName?.trim() || titleFromSlug(rawProject.id || "project");
  const id = entryNameToId(rawProject.id || name);

  return {
    id,
    name,
    createdAt: rawProject.createdAt || toIso(new Date()),
    dateFormat: rawProject.dateFormat || DEFAULT_PROJECT_SETTINGS.dateFormat,
    timeFormat: rawProject.timeFormat || DEFAULT_PROJECT_SETTINGS.timeFormat,
    logPartition: normalizePartition(rawProject.logPartition),
  };
}

function inferLogPartition(logEntries) {
  const fileNames = logEntries.filter((entry) => entry.kind === "file").map((entry) => entry.name);

  if (fileNames.includes("log.md")) {
    return "single";
  }

  if (fileNames.some((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))) {
    return "daily";
  }

  return "monthly";
}

function normalizePartition(value) {
  if (value === "daily" || value === "single") {
    return value;
  }

  return "monthly";
}

async function inferLastEdited(projectHandle) {
  let latest = 0;

  for (const fileName of ["project.json", "tasks.md", "info.md"]) {
    const fileHandle = await getFileIfExists(projectHandle, fileName);
    if (!fileHandle) {
      continue;
    }

    const file = await getFileText(fileHandle);
    latest = Math.max(latest, file.lastModified);
  }

  const logsHandle = await getDirectoryIfExists(projectHandle, "logs");
  if (logsHandle) {
    const entries = await listDirectory(logsHandle);

    for (const entry of entries) {
      if (entry.kind !== "file" || !entry.name.endsWith(".md")) {
        continue;
      }

      const fileHandle = await logsHandle.getFileHandle(entry.name);
      const file = await getFileText(fileHandle);
      latest = Math.max(latest, file.lastModified);
    }
  }

  return latest ? new Date(latest).toISOString() : null;
}

async function writeManifest() {
  if (!state.rootHandle) {
    return;
  }

  state.manifest.projects.sort(sortProjects);
  await writeJsonFile(state.rootHandle, "manifest.json", {
    version: 1,
    projects: state.manifest.projects.map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
      lastEdited: project.lastEdited,
    })),
  });
}

function sortProjects(left, right) {
  const byRecency = compareIsoDesc(left.lastEdited, right.lastEdited);
  if (byRecency !== 0) {
    return byRecency;
  }

  return left.name.localeCompare(right.name);
}

function findProjectMeta(projectId) {
  return state.manifest.projects.find((project) => project.id === projectId) || null;
}

async function openProject(projectId, options = {}) {
  const nextProject = findProjectMeta(projectId);
  if (!nextProject || !state.rootHandle) {
    return;
  }

  await persistCurrentDocument({ force: true, prune: true });
  state.activeProjectId = projectId;
  savePreferences();

  const projectHandle =
    state.projectHandles.get(projectId) || (await state.rootHandle.getDirectoryHandle(nextProject.path));
  state.projectHandles.set(projectId, projectHandle);
  state.activeProjectHandle = projectHandle;

  const projectJsonResult = await readJsonFile(projectHandle, "project.json");
  state.activeProjectConfig = normalizeProjectConfig(projectJsonResult.value, nextProject.name);

  if (!projectJsonResult.value) {
    await writeJsonFile(projectHandle, "project.json", state.activeProjectConfig);
  }

  await loadDocument(options.doc || state.activeDoc, { focus: options.focus !== false });
  renderProjectList();
}

async function loadDocument(docType, options = {}) {
  if (!state.activeProjectHandle || !state.activeProjectConfig) {
    clearDocumentState();
    renderWorkspace();
    return;
  }

  clearTimeout(state.pendingSaveTimer);
  state.activeDoc = docType;
  savePreferences();

  const descriptor = await buildDocumentDescriptor(docType, options.date || new Date());
  const fileResult = await readTextFile(descriptor.directoryHandle, descriptor.fileName);
  const text = normalizeLineEndings(fileResult.exists ? fileResult.text || descriptor.scaffold : descriptor.scaffold);

  state.currentDocumentDescriptor = descriptor;
  state.activeFileExists = fileResult.exists;
  state.baselineContent = text;
  state.currentContent = text;
  state.lastLoadedDiskContent = fileResult.exists ? normalizeLineEndings(fileResult.text) : null;
  state.dirty = false;
  state.conflict = null;
  state.saveStatus = fileResult.exists ? "synced" : "draft";
  state.ignoreNextLeadingSpace = false;

  refs.editor.value = text;
  refs.editor.placeholder = descriptor.placeholder;
  refs.workspaceBody.scrollTop = 0;
  refs.editor.scrollTop = 0;
  refs.editor.scrollLeft = 0;
  refs.editor.setSelectionRange(0, 0);
  refs.preview.scrollTop = 0;

  if (options.focus !== false) {
    refs.editor.focus();
  }

  updatePreview();
  renderWorkspace();
}

async function buildDocumentDescriptor(docType, date) {
  if (docType === "log") {
    const logsHandle = await ensureDirectory(state.activeProjectHandle, "logs");
    const partition = normalizePartition(state.activeProjectConfig.logPartition);
    let fileName = `${getMonthKey(date)}.md`;
    let title = buildMonthTitle(state.activeProjectConfig.name, date);
    let metadataLine = `month: ${getMonthKey(date)}`;

    if (partition === "daily") {
      fileName = `${getDateKey(date)}.md`;
      title = buildDailyTitle(state.activeProjectConfig.name, date);
      metadataLine = `day: ${getDateKey(date)}`;
    } else if (partition === "single") {
      fileName = "log.md";
      title = buildSingleTitle(state.activeProjectConfig.name);
      metadataLine = "scope: full-project";
    }

    return {
      docType,
      directoryHandle: logsHandle,
      fileName,
      relativePath: `logs/${fileName}`,
      placeholder: "Type to add today’s dated section and a timestamped bullet.",
      scaffold: buildLogScaffold(title, metadataLine),
    };
  }

  return {
    docType,
    directoryHandle: state.activeProjectHandle,
    fileName: docType === "tasks" ? "tasks.md" : "info.md",
    relativePath: docType === "tasks" ? "tasks.md" : "info.md",
    placeholder:
      docType === "tasks"
        ? "Use Markdown task lists to track project follow-ups."
        : "Keep project context, repos, staging URLs, or non-secret notes here.",
    scaffold: docType === "tasks" ? "# Tasks\n" : "# Project Info\n",
  };
}

function buildLogScaffold(title, metadataLine) {
  return [
    "---",
    `projectId: ${state.activeProjectConfig.id}`,
    metadataLine,
    `timezone: ${getTimezone()}`,
    "generatedBy: Devlog v1",
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n");
}

function clearDocumentState() {
  clearTimeout(state.pendingSaveTimer);
  state.activeProjectHandle = null;
  state.activeProjectConfig = null;
  state.currentDocumentDescriptor = null;
  state.currentContent = "";
  state.baselineContent = "";
  state.lastLoadedDiskContent = null;
  state.activeFileExists = false;
  state.dirty = false;
  state.saveStatus = "idle";
  state.conflict = null;
  refs.editor.value = "";
  updatePreview();
}

function renderWorkspace() {
  const hasProject = Boolean(state.activeProjectConfig);
  refs.projectSearch.disabled = !state.rootHandle || state.rootPermission !== "granted";
  refs.newProjectButton.disabled = !state.rootHandle || state.rootPermission !== "granted";
  refs.emptyNewProject.disabled = !state.rootHandle || state.rootPermission !== "granted";
  refs.settingsButton.disabled = !hasProject;
  refs.todayButton.disabled = !hasProject || state.activeDoc !== "log";
  refs.emptyState.classList.toggle("is-hidden", hasProject);
  refs.editorArea.classList.toggle("is-hidden", !hasProject);

  const rootLabel = !state.rootHandle
    ? "No root selected"
    : state.rootPermission !== "granted"
      ? `${state.rootHandle.name} (reconnect to write)`
      : state.rootHandle.name;
  refs.rootPill.querySelector(".root-pill-label").textContent = rootLabel;

  if (hasProject) {
    refs.breadcrumb.textContent = `${state.rootHandle?.name || "Root"} / ${state.activeProjectConfig.name}`;
    refs.projectTitle.textContent = state.activeProjectConfig.name;
  } else {
    refs.breadcrumb.textContent = "No project selected";
    refs.projectTitle.textContent = "Project logs, stored as Markdown.";
  }

  updateDocSwitcher();
  updateViewSwitcher();
  updatePreview();
  updateSaveIndicator();
  updateStatusRow();
  updateConflictBanner();
}

function updateDocSwitcher() {
  const buttons = refs.docSwitcher.querySelectorAll("[data-doc]");
  buttons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.doc === state.activeDoc);
    button.disabled = !state.activeProjectConfig;
  });
  refs.docKindPill.textContent = DOC_LABELS[state.activeDoc];
}

function updateViewSwitcher() {
  const buttons = refs.viewSwitcher.querySelectorAll("[data-view]");
  buttons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.activeView);
    button.disabled = !state.activeProjectConfig;
  });
}

function updateStatusRow() {
  refs.filePath.textContent = state.currentDocumentDescriptor
    ? `${state.activeProjectConfig?.name || ""} / ${state.currentDocumentDescriptor.relativePath}`
    : "No file loaded";

  const plainText = markdownToText(state.currentContent);
  const count = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
  refs.wordCount.textContent = `${count} ${count === 1 ? "word" : "words"}`;
}

function updateSaveIndicator() {
  refs.saveIndicator.classList.remove("is-saving", "is-synced", "is-conflict");

  if (state.saveStatus === "saving") {
    refs.saveIndicator.textContent = "Saving";
    refs.saveIndicator.classList.add("is-saving");
    return;
  }

  if (state.saveStatus === "synced") {
    refs.saveIndicator.textContent = "Saved";
    refs.saveIndicator.classList.add("is-synced");
    return;
  }

  if (state.saveStatus === "conflict") {
    refs.saveIndicator.textContent = "Conflict";
    refs.saveIndicator.classList.add("is-conflict");
    return;
  }

  if (state.saveStatus === "error") {
    refs.saveIndicator.textContent = "Save failed";
    refs.saveIndicator.classList.add("is-conflict");
    return;
  }

  refs.saveIndicator.textContent = state.activeProjectConfig ? "Draft only" : "Idle";
}

function updateConflictBanner() {
  refs.conflictBanner.classList.toggle("is-hidden", !state.conflict);
}

function renderProjectList() {
  if (!state.rootHandle || state.rootPermission !== "granted") {
    refs.projectList.innerHTML = `
      <div class="project-row">
        <div class="project-open">
          <strong>No writable root connected</strong>
          <small>Choose a folder to list or create projects.</small>
        </div>
      </div>
    `;
    return;
  }

  const query = state.projectFilter.trim().toLowerCase();
  const projects = state.manifest.projects
    .filter((project) => !query || project.name.toLowerCase().includes(query) || project.id.toLowerCase().includes(query))
    .sort(sortProjects);

  if (!projects.length) {
    refs.projectList.innerHTML = `
      <div class="project-row">
        <div class="project-open">
          <strong>No matching projects</strong>
          <small>Create one or clear the filter.</small>
        </div>
      </div>
    `;
    return;
  }

  refs.projectList.innerHTML = projects
    .map((project) => {
      const isActive = project.id === state.activeProjectId;
      return `
        <div class="project-row${isActive ? " is-active" : ""}">
          <button class="project-open" type="button" data-action="open" data-project-id="${escapeHtml(project.id)}">
            <span class="project-avatar">${escapeHtml(project.name.trim().charAt(0).toUpperCase() || project.id.charAt(0).toUpperCase())}</span>
            <strong>${escapeHtml(project.name)}</strong>
          </button>
          <div class="project-meta">
            <div class="project-actions">
              <button class="project-action" type="button" title="Info" data-action="info" data-project-id="${escapeHtml(project.id)}">info</button>
              <button class="project-action" type="button" title="Tasks" data-action="tasks" data-project-id="${escapeHtml(project.id)}">tasks</button>
              <button class="project-action" type="button" title="Export" data-action="export" data-project-id="${escapeHtml(project.id)}">export</button>
              <button class="project-action" type="button" title="Delete" data-action="delete" data-project-id="${escapeHtml(project.id)}">delete</button>
            </div>
            <span class="project-age">${escapeHtml(humanizeLastEdited(project.lastEdited))}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function applySidebarState() {
  refs.sidebar?.classList.toggle("is-collapsed", state.sidebarCollapsed);
  refs.appShell?.classList.toggle("is-sidebar-collapsed", state.sidebarCollapsed);
}

function applyViewMode() {
  if (!refs.editorSurface) {
    return;
  }

  refs.editorSurface.classList.remove("mode-write", "mode-preview", "mode-split");
  refs.editorSurface.classList.add(`mode-${state.activeView}`);

  if (state.activeView === "split") {
    refs.editorSurface.style.gridTemplateColumns = `minmax(280px, ${state.splitRatio}fr) 14px minmax(280px, ${100 - state.splitRatio}fr)`;
    return;
  }

  refs.editorSurface.style.removeProperty("grid-template-columns");
}

function applyEditorWrap() {
  if (!refs.editor) {
    return;
  }

  refs.editor.classList.toggle("wrap-off", !state.appSettings.softWrap);
  refs.editor.setAttribute("wrap", state.appSettings.softWrap ? "soft" : "off");
}

function updatePreview() {
  if (!refs.preview) {
    return;
  }

  refs.preview.classList.remove("timestamps-muted", "timestamps-normal", "timestamps-hidden");
  refs.preview.classList.add(`timestamps-${state.appSettings.timestampVisibility}`);
  refs.preview.innerHTML = renderMarkdown(state.currentContent, {
    todayKey: getDateKey(new Date()),
  });

  refs.previewBadge.textContent =
    state.appSettings.timestampVisibility === "hidden"
      ? "Hidden timestamps"
      : state.appSettings.timestampVisibility === "normal"
        ? "Normal timestamps"
        : "Muted timestamps";
}

function handleSidebarToggle() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  savePreferences();
  applySidebarState();
}

function handleProjectFilter(event) {
  state.projectFilter = event.target.value || "";
  renderProjectList();
}

async function handleProjectListClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const projectId = button.dataset.projectId;
  const action = button.dataset.action;

  if (action === "open") {
    await openProject(projectId);
    return;
  }

  if (action === "tasks" || action === "info") {
    await openProject(projectId, { doc: action });
    return;
  }

  if (action === "export") {
    await handleExport(projectId);
    return;
  }

  if (action === "delete") {
    await deleteProject(projectId);
  }
}

async function handleNewProject() {
  if (!state.rootHandle || state.rootPermission !== "granted") {
    return;
  }

  const values = await showFormDialog({
    title: "Create project",
    description: "Use a stable display name now. The directory slug is generated automatically and kept filesystem-safe.",
    submitLabel: "Create project",
    body: `
      <div class="dialog-fields">
        <div class="dialog-field">
          <label for="project-name">Project name</label>
          <input id="project-name" name="name" type="text" placeholder="Acme Site" required />
        </div>
      </div>
      <div class="dialog-fields two-up">
        <div class="dialog-field">
          <label for="project-partition">Log partition</label>
          <select id="project-partition" name="logPartition">
            <option value="monthly">Monthly</option>
            <option value="daily">Daily</option>
            <option value="single">Single file</option>
          </select>
        </div>
        <div class="dialog-field">
          <label for="project-time-format">Time format</label>
          <select id="project-time-format" name="timeFormat">
            <option value="HH:mm">24h (HH:mm)</option>
            <option value="hh:mm A">12h (hh:mm A)</option>
          </select>
        </div>
      </div>
      <div class="dialog-fields">
        <div class="dialog-field">
          <label for="project-date-format">Date format</label>
          <input id="project-date-format" name="dateFormat" type="text" value="${escapeHtml(DEFAULT_PROJECT_SETTINGS.dateFormat)}" required />
        </div>
      </div>
    `,
  });

  if (!values) {
    return;
  }

  const projectName = values.name?.trim();
  if (!projectName) {
    return;
  }

  const projectId = await makeUniqueProjectId(projectName);
  const projectHandle = await ensureDirectory(state.rootHandle, projectId);
  await ensureDirectory(projectHandle, "logs");

  const projectConfig = normalizeProjectConfig({
    id: projectId,
    name: projectName,
    createdAt: toIso(new Date()),
    logPartition: values.logPartition,
    dateFormat: values.dateFormat?.trim() || DEFAULT_PROJECT_SETTINGS.dateFormat,
    timeFormat: values.timeFormat || DEFAULT_PROJECT_SETTINGS.timeFormat,
  });

  await writeJsonFile(projectHandle, "project.json", projectConfig);
  state.projectHandles.set(projectId, projectHandle);

  state.manifest.projects.push({
    id: projectConfig.id,
    name: projectConfig.name,
    path: projectId,
    lastEdited: null,
  });

  await writeManifest();
  renderProjectList();
  await openProject(projectConfig.id);
}

async function makeUniqueProjectId(projectName) {
  const baseId = entryNameToId(projectName);
  let candidate = baseId;
  let suffix = 2;

  while (state.manifest.projects.some((project) => project.id === candidate || project.path === candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function deleteProject(projectId) {
  const project = findProjectMeta(projectId);
  if (!project || !state.rootHandle) {
    return;
  }

  const confirmed = await showConfirmDialog({
    title: `Delete ${project.name}?`,
    description:
      "Browsers cannot move folders to the system Trash here, so this permanently removes the project directory from the selected root.",
    confirmLabel: "Delete project",
  });

  if (!confirmed) {
    return;
  }

  await persistCurrentDocument({ force: true, prune: true });
  await removeDirectory(state.rootHandle, project.path);

  state.manifest.projects = state.manifest.projects.filter((entry) => entry.id !== projectId);
  state.projectHandles.delete(projectId);

  if (state.activeProjectId === projectId) {
    state.activeProjectId = state.manifest.projects[0]?.id || "";
    state.activeProjectConfig = null;
    state.activeProjectHandle = null;
    state.currentDocumentDescriptor = null;
  }

  await writeManifest();
  renderProjectList();

  if (state.activeProjectId) {
    await openProject(state.activeProjectId, { focus: false });
  } else {
    clearDocumentState();
    renderWorkspace();
  }
}

async function handleDocSwitchClick(event) {
  const button = event.target.closest("[data-doc]");
  if (!button || !state.activeProjectConfig) {
    return;
  }

  const nextDoc = button.dataset.doc;
  if (nextDoc === state.activeDoc) {
    return;
  }

  await persistCurrentDocument({ force: true, prune: true });
  await loadDocument(nextDoc);
}

function handleViewSwitchClick(event) {
  const button = event.target.closest("[data-view]");
  if (!button) {
    return;
  }

  state.activeView = button.dataset.view;
  savePreferences();
  applyViewMode();
  updateViewSwitcher();
}

async function handleExport(projectId = state.activeProjectId) {
  const project = findProjectMeta(projectId);
  if (!project) {
    return;
  }

  const choice = await showChoiceDialog({
    title: `Export ${project.name}`,
    description: "Save one combined Markdown file or a zip archive with the project folder structure intact.",
    choices: [
      { label: "Markdown", value: "markdown", kind: "primary" },
      { label: "Zip archive", value: "zip", kind: "secondary" },
    ],
  });

  if (!choice) {
    return;
  }

  if (choice === "markdown") {
    await exportProjectMarkdown(project);
  } else {
    await exportProjectZip(project);
  }
}

async function exportProjectMarkdown(project) {
  const projectHandle =
    state.projectHandles.get(project.id) || (await state.rootHandle.getDirectoryHandle(project.path));
  const logsHandle = await getDirectoryIfExists(projectHandle, "logs");
  const sections = [`# ${project.name}`, ""];

  if (logsHandle) {
    const entries = (await listDirectory(logsHandle))
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(".md"))
      .sort((left, right) => right.name.localeCompare(left.name));

    for (const entry of entries) {
      const fileHandle = await logsHandle.getFileHandle(entry.name);
      const file = await getFileText(fileHandle);
      const stripped = stripFrontmatter(normalizeLineEndings(file.text)).trim();

      if (!stripped) {
        continue;
      }

      sections.push(downgradeTopHeading(stripped), "");
    }
  }

  const tasks = await readTextFile(projectHandle, "tasks.md");
  if (tasks.exists && tasks.text.trim()) {
    sections.push("## Tasks", "", removeTopHeading(tasks.text).trim(), "");
  }

  const info = await readTextFile(projectHandle, "info.md");
  if (info.exists && info.text.trim()) {
    sections.push("## Info", "", removeTopHeading(info.text).trim(), "");
  }

  const output = `${sections.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
  await saveBlob(new Blob([output], { type: "text/markdown;charset=utf-8" }), `${project.path}.md`, "text/markdown");
}

async function exportProjectZip(project) {
  const projectHandle =
    state.projectHandles.get(project.id) || (await state.rootHandle.getDirectoryHandle(project.path));
  const files = await collectProjectFiles(projectHandle);
  const blob = createZip(
    files.map((file) => ({
      path: `${project.path}/${file.path}`,
      text: file.text,
      lastModified: file.lastModified,
    })),
  );
  await saveBlob(blob, `${project.path}.zip`, "application/zip");
}

async function saveBlob(blob, suggestedName, mimeType) {
  if ("showSaveFilePicker" in window) {
    try {
      const extension = suggestedName.split(".").pop();
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: mimeType,
            accept: {
              [mimeType]: [`.${extension}`],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }

      throw error;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleSettings() {
  if (!state.activeProjectConfig || !state.activeProjectHandle) {
    return;
  }

  const action = await showChoiceDialog({
    title: "Settings",
    description: "Project settings, root-folder access, and export live here so the main workspace stays focused on writing.",
    choices: [
      { label: "Project settings", value: "project", kind: "primary" },
      { label: "Choose folder", value: "root", kind: "secondary" },
      { label: "Export project", value: "export", kind: "secondary" },
    ],
  });

  if (!action) {
    return;
  }

  if (action === "root") {
    await handlePickRoot();
    return;
  }

  if (action === "export") {
    await handleExport();
    return;
  }

  const currentProject = findProjectMeta(state.activeProjectId);
  const values = await showFormDialog({
    title: "Project settings",
    description: "Project settings affect future log sections and preview behavior. Existing Markdown is left untouched.",
    submitLabel: "Save settings",
    body: `
      <div class="dialog-fields">
        <div class="dialog-field">
          <label for="settings-name">Project name</label>
          <input id="settings-name" name="name" type="text" value="${escapeHtml(state.activeProjectConfig.name)}" required />
        </div>
      </div>
      <div class="dialog-fields two-up">
        <div class="dialog-field">
          <label for="settings-partition">Log partition</label>
          <select id="settings-partition" name="logPartition">
            <option value="monthly"${state.activeProjectConfig.logPartition === "monthly" ? " selected" : ""}>Monthly</option>
            <option value="daily"${state.activeProjectConfig.logPartition === "daily" ? " selected" : ""}>Daily</option>
            <option value="single"${state.activeProjectConfig.logPartition === "single" ? " selected" : ""}>Single file</option>
          </select>
        </div>
        <div class="dialog-field">
          <label for="settings-time-format">Time format</label>
          <select id="settings-time-format" name="timeFormat">
            <option value="HH:mm"${state.activeProjectConfig.timeFormat === "HH:mm" ? " selected" : ""}>24h (HH:mm)</option>
            <option value="hh:mm A"${state.activeProjectConfig.timeFormat === "hh:mm A" ? " selected" : ""}>12h (hh:mm A)</option>
          </select>
        </div>
      </div>
      <div class="dialog-fields">
        <div class="dialog-field">
          <label for="settings-date-format">Date format</label>
          <input id="settings-date-format" name="dateFormat" type="text" value="${escapeHtml(state.activeProjectConfig.dateFormat)}" required />
        </div>
      </div>
      <div class="dialog-fields two-up">
        <div class="dialog-field">
          <label for="settings-preview">Preview timestamps</label>
          <select id="settings-preview" name="timestampVisibility">
            <option value="muted"${state.appSettings.timestampVisibility === "muted" ? " selected" : ""}>Muted</option>
            <option value="normal"${state.appSettings.timestampVisibility === "normal" ? " selected" : ""}>Normal</option>
            <option value="hidden"${state.appSettings.timestampVisibility === "hidden" ? " selected" : ""}>Hidden</option>
          </select>
        </div>
        <div class="dialog-field">
          <label for="settings-wrap">Soft wrap</label>
          <select id="settings-wrap" name="softWrap">
            <option value="true"${state.appSettings.softWrap ? " selected" : ""}>On</option>
            <option value="false"${!state.appSettings.softWrap ? " selected" : ""}>Off</option>
          </select>
        </div>
      </div>
      <p class="dialog-note">This build keeps settings local and focuses on the folder-backed MVP flow.</p>
    `,
  });

  if (!values) {
    return;
  }

  await persistCurrentDocument({ force: true, prune: true });

  state.activeProjectConfig = normalizeProjectConfig({
    ...state.activeProjectConfig,
    name: values.name?.trim() || state.activeProjectConfig.name,
    logPartition: values.logPartition,
    dateFormat: values.dateFormat?.trim() || state.activeProjectConfig.dateFormat,
    timeFormat: values.timeFormat || state.activeProjectConfig.timeFormat,
  });

  state.appSettings.timestampVisibility = values.timestampVisibility || state.appSettings.timestampVisibility;
  state.appSettings.softWrap = values.softWrap !== "false";
  savePreferences();
  applyEditorWrap();

  await writeJsonFile(state.activeProjectHandle, "project.json", state.activeProjectConfig);

  if (currentProject) {
    currentProject.name = state.activeProjectConfig.name;
  }

  await writeManifest();
  renderProjectList();
  await loadDocument(state.activeDoc, { focus: false });
}

function handlePaneResizeStart(event) {
  if (state.activeView !== "split") {
    return;
  }

  event.preventDefault();

  const move = (moveEvent) => {
    const rect = refs.editorSurface.getBoundingClientRect();
    const nextRatio = ((moveEvent.clientX - rect.left) / rect.width) * 100;
    state.splitRatio = Math.max(28, Math.min(72, nextRatio));
    savePreferences();
    applyViewMode();
  };

  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
}

function handleToolbarClick(event) {
  const button = event.target.closest("[data-format]");
  if (!button || !state.activeProjectConfig) {
    return;
  }

  applyFormat(button.dataset.format);
}

async function handleEditorKeydown(event) {
  if (!state.activeProjectConfig) {
    return;
  }

  const key = event.key.toLowerCase();
  const metaKey = event.metaKey || event.ctrlKey;

  if (state.ignoreNextLeadingSpace && isPlainTextInsertion(event)) {
    if (event.key === " ") {
      event.preventDefault();
      state.ignoreNextLeadingSpace = false;
      return;
    }

    state.ignoreNextLeadingSpace = false;
  }

  if (metaKey) {
    if (key === "b") {
      event.preventDefault();
      applyFormat("bold");
      return;
    }

    if (key === "i") {
      event.preventDefault();
      applyFormat("italic");
      return;
    }

    if (key === "k") {
      event.preventDefault();
      applyFormat("link");
      return;
    }

    if (key === "`") {
      event.preventDefault();
      applyFormat("code");
      return;
    }

    if (key === "enter") {
      event.preventDefault();
      toggleTaskAtSelection();
      return;
    }
  }

  if (event.altKey && key === "x") {
    event.preventDefault();
    toggleTaskAtSelection();
    return;
  }

  if (event.key === "Tab") {
    event.preventDefault();
    adjustIndent(event.shiftKey ? -2 : 2);
    return;
  }

  if (state.activeDoc === "log" && isPlainTextInsertion(event)) {
    const bootstrapped = await maybeBootstrapLogTyping(event);
    if (bootstrapped) {
      return;
    }
  }

  if (event.key === "Enter") {
    if (state.activeDoc === "log") {
      const handled = await handleLogEnter(event);
      if (handled) {
        return;
      }
    } else {
      const handled = handleGenericListEnter(event);
      if (handled) {
        return;
      }
    }
  }
}

function handleEditorInput() {
  state.currentContent = normalizeLineEndings(refs.editor.value);
  state.dirty = state.currentContent !== state.baselineContent;

  if (state.conflict) {
    state.conflict = null;
  }

  if (state.saveStatus !== "saving") {
    state.saveStatus = state.dirty ? "draft" : state.saveStatus;
  }

  updatePreview();
  renderWorkspace();
  scheduleSave();
}

async function handleEditorBlur() {
  await persistCurrentDocument({ force: true, prune: true });
}

function scheduleSave() {
  clearTimeout(state.pendingSaveTimer);

  if (!state.activeProjectConfig || state.conflict) {
    return;
  }

  state.pendingSaveTimer = window.setTimeout(() => {
    persistCurrentDocument({ force: false, prune: false }).catch((error) => {
      showError("Autosave failed.", error);
    });
  }, 700);
}

async function persistCurrentDocument(options = {}) {
  if (!state.currentDocumentDescriptor || !state.activeProjectConfig) {
    return false;
  }

  clearTimeout(state.pendingSaveTimer);

  const normalized = prepareDocumentForSave(state.currentContent, options.prune);

  if (!options.overwrite && normalized === state.baselineContent) {
    if (options.prune && normalized !== refs.editor.value) {
      refs.editor.value = normalized;
    }

    state.currentContent = normalized;
    state.dirty = false;
    state.saveStatus = state.activeFileExists ? "synced" : "draft";
    updatePreview();
    renderWorkspace();
    return true;
  }

  const existsOnDisk = await readTextFile(
    state.currentDocumentDescriptor.directoryHandle,
    state.currentDocumentDescriptor.fileName,
  );

  if (
    existsOnDisk.exists &&
    state.lastLoadedDiskContent !== null &&
    normalizeLineEndings(existsOnDisk.text) !== normalizeLineEndings(state.lastLoadedDiskContent) &&
    !options.overwrite
  ) {
    state.conflict = {
      diskText: normalizeLineEndings(existsOnDisk.text),
      memoryText: normalized,
    };
    state.saveStatus = "conflict";
    renderWorkspace();
    return false;
  }

  const meaningful = isMeaningfulDocument(normalized);

  if (!meaningful && !existsOnDisk.exists) {
    if (options.prune && normalized !== refs.editor.value) {
      refs.editor.value = normalized;
    }

    state.currentContent = normalized;
    state.baselineContent = normalized;
    state.lastLoadedDiskContent = null;
    state.activeFileExists = false;
    state.dirty = false;
    state.saveStatus = "draft";
    updatePreview();
    renderWorkspace();
    return true;
  }

  state.saveStatus = "saving";
  renderWorkspace();

  const contentToWrite = normalized;
  await writeTextFile(state.currentDocumentDescriptor.directoryHandle, state.currentDocumentDescriptor.fileName, contentToWrite);

  if (options.prune && contentToWrite !== refs.editor.value) {
    refs.editor.value = contentToWrite;
  }

  state.currentContent = contentToWrite;
  state.baselineContent = contentToWrite;
  state.lastLoadedDiskContent = contentToWrite;
  state.activeFileExists = true;
  state.dirty = false;
  state.saveStatus = "synced";
  state.conflict = null;

  await touchProjectManifest();
  updatePreview();
  renderWorkspace();
  return true;
}

function prepareDocumentForSave(content, prune) {
  const normalized = normalizeLineEndings(content);

  if (state.activeDoc === "log") {
    return finalizeLogDocument(normalized, prune);
  }

  return finalizeNoteDocument(normalized, prune);
}

function finalizeLogDocument(content, prune) {
  const cleaned = content
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");

  if (!prune) {
    return ensureTrailingNewline(cleaned);
  }

  const withoutEmptyBullets = cleaned
    .split("\n")
    .filter((line) => !/^\s*-\s+\[(\d{1,2}:\d{2}(?:\s?[AP]M)?)\]\s*$/.test(line.trim()))
    .join("\n");

  const withoutEmptyDates = removeEmptyDateSections(withoutEmptyBullets);
  const collapsed = withoutEmptyDates.replace(/\n{3,}/g, "\n\n").trimEnd();

  if (!hasMeaningfulLogContent(collapsed)) {
    return ensureTrailingNewline(state.currentDocumentDescriptor.scaffold);
  }

  return ensureTrailingNewline(collapsed);
}

function finalizeNoteDocument(content, prune) {
  const trimmedLines = content
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  if (!prune) {
    return ensureTrailingNewline(trimmedLines);
  }

  const trimmed = trimmedLines.trimEnd();
  return ensureTrailingNewline(trimmed || state.currentDocumentDescriptor.scaffold.trimEnd());
}

function isMeaningfulDocument(content) {
  if (state.activeDoc === "log") {
    return hasMeaningfulLogContent(content);
  }

  return normalizeComparable(content) !== normalizeComparable(state.currentDocumentDescriptor.scaffold);
}

function hasMeaningfulLogContent(content) {
  const body = stripFrontmatter(content)
    .split("\n")
    .filter((line) => !line.startsWith("# ") && !parseDateHeading(line))
    .filter((line) => !/^\s*-\s+\[(\d{1,2}:\d{2}(?:\s?[AP]M)?)\]\s*$/.test(line.trim()))
    .join("\n");

  return /\S/.test(body);
}

function removeEmptyDateSections(content) {
  const lines = content.split("\n");
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const currentLine = lines[index];
    const headingKey = parseDateHeading(currentLine);

    if (!headingKey) {
      output.push(currentLine);
      index += 1;
      continue;
    }

    let endIndex = index + 1;
    while (endIndex < lines.length && !parseDateHeading(lines[endIndex])) {
      endIndex += 1;
    }

    const sectionLines = lines.slice(index + 1, endIndex);
    const meaningful = sectionLines.some((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return false;
      }

      return !/^\-\s+\[(\d{1,2}:\d{2}(?:\s?[AP]M)?)\]\s*$/.test(trimmed);
    });

    if (meaningful) {
      output.push(currentLine, ...sectionLines);
    }

    index = endIndex;
  }

  return output.join("\n");
}

async function touchProjectManifest() {
  const project = findProjectMeta(state.activeProjectId);
  if (!project) {
    return;
  }

  project.name = state.activeProjectConfig.name;
  project.lastEdited = toIso(new Date());
  await writeManifest();
  renderProjectList();
}

async function maybeEnsureCurrentLogDocument() {
  if (state.activeDoc !== "log" || !state.activeProjectConfig) {
    return false;
  }

  const expectedPath = getExpectedLogPath(new Date());
  if (state.currentDocumentDescriptor?.relativePath === expectedPath) {
    return false;
  }

  await persistCurrentDocument({ force: true, prune: true });
  await loadDocument("log", { focus: false, date: new Date() });
  return true;
}

function getExpectedLogPath(date) {
  const partition = normalizePartition(state.activeProjectConfig.logPartition);

  if (partition === "daily") {
    return `logs/${getDateKey(date)}.md`;
  }

  if (partition === "single") {
    return "logs/log.md";
  }

  return `logs/${getMonthKey(date)}.md`;
}

async function maybeBootstrapLogTyping(event) {
  await maybeEnsureCurrentLogDocument();

  const todayKey = getDateKey(new Date());
  if (documentHasDateHeading(state.currentContent, todayKey)) {
    return false;
  }

  event.preventDefault();

  let seedText = event.key;
  state.ignoreNextLeadingSpace = false;

  if (seedText === "-" || seedText === " ") {
    seedText = "";
    state.ignoreNextLeadingSpace = event.key === "-";
  }

  insertTodayEntry(seedText);
  return true;
}

async function handleLogEnter(event) {
  await maybeEnsureCurrentLogDocument();

  const selectionStart = refs.editor.selectionStart;
  const selectionEnd = refs.editor.selectionEnd;
  const todayKey = getDateKey(new Date());

  if (!documentHasDateHeading(state.currentContent, todayKey)) {
    event.preventDefault();
    insertTodayEntry("");
    return true;
  }

  if (selectionStart !== selectionEnd) {
    return false;
  }

  const line = getCurrentLineInfo(refs.editor.value, selectionStart);
  const currentSection = getSectionKeyAtCursor(refs.editor.value, selectionStart);
  const atEndOfLine = selectionStart === line.end;

  if (!atEndOfLine || currentSection !== todayKey) {
    return false;
  }

  if (
    /^\s*-\s+/.test(line.text) ||
    /^\s*$/.test(line.text) ||
    parseDateHeading(line.text) === todayKey
  ) {
    event.preventDefault();
    const indent = line.text.match(/^\s*/)?.[0] || "";
    const insertion = `\n${indent}- [${getTimestamp(new Date(), state.activeProjectConfig.timeFormat)}] `;
    replaceSelection(selectionStart, selectionEnd, insertion, insertion.length, insertion.length);
    return true;
  }

  return false;
}

function handleGenericListEnter(event) {
  const selectionStart = refs.editor.selectionStart;
  const selectionEnd = refs.editor.selectionEnd;

  if (selectionStart !== selectionEnd) {
    return false;
  }

  const line = getCurrentLineInfo(refs.editor.value, selectionStart);
  const atEndOfLine = selectionStart === line.end;

  if (!atEndOfLine) {
    return false;
  }

  const taskMatch = line.text.match(/^(\s*)-\s+\[( |x|X)\]\s+/);
  if (taskMatch) {
    event.preventDefault();
    const insertion = `\n${taskMatch[1]}- [ ] `;
    replaceSelection(selectionStart, selectionEnd, insertion, insertion.length, insertion.length);
    return true;
  }

  const listMatch = line.text.match(/^(\s*)-\s+/);
  if (listMatch) {
    event.preventDefault();
    const insertion = `\n${listMatch[1]}- `;
    replaceSelection(selectionStart, selectionEnd, insertion, insertion.length, insertion.length);
    return true;
  }

  return false;
}

function insertTodayEntry(seedText) {
  const date = new Date();
  const todayHeading = `## ${buildDateHeading(date, state.activeProjectConfig.dateFormat)}`;
  const timestampPrefix = `- [${getTimestamp(date, state.activeProjectConfig.timeFormat)}] `;
  const lines = normalizeLineEndings(refs.editor.value).split("\n");
  const insertLineIndex = findBodyInsertLine(lines);
  const insertionLines = [todayHeading, `${timestampPrefix}${seedText}`];

  if (insertLineIndex < lines.length && lines[insertLineIndex].trim()) {
    insertionLines.push("");
  }

  const nextLines = [
    ...lines.slice(0, insertLineIndex),
    ...insertionLines,
    ...lines.slice(insertLineIndex),
  ];

  const bulletLineIndex = insertLineIndex + 1;
  const cursor = charIndexFromLine(nextLines, bulletLineIndex) + timestampPrefix.length + seedText.length;
  setEditorValue(nextLines.join("\n"), cursor, cursor);
}

function findBodyInsertLine(lines) {
  let index = 0;

  if (lines[index] === "---") {
    let end = index + 1;
    while (end < lines.length && lines[end] !== "---") {
      end += 1;
    }
    if (end < lines.length) {
      index = end + 1;
    }
  }

  while (index < lines.length && !lines[index].startsWith("# ")) {
    index += 1;
  }

  if (index < lines.length && lines[index].startsWith("# ")) {
    index += 1;
  }

  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }

  return index;
}

function documentHasDateHeading(content, targetDateKey) {
  return normalizeLineEndings(content)
    .split("\n")
    .some((line) => parseDateHeading(line) === targetDateKey);
}

function getSectionKeyAtCursor(content, cursorIndex) {
  const lines = normalizeLineEndings(content).slice(0, cursorIndex).split("\n");
  let currentKey = null;

  for (const line of lines) {
    const heading = parseDateHeading(line);
    if (heading) {
      currentKey = heading;
    }
  }

  return currentKey;
}

function getCurrentLineInfo(content, cursorIndex) {
  const start = content.lastIndexOf("\n", cursorIndex - 1) + 1;
  const endIndex = content.indexOf("\n", cursorIndex);
  const end = endIndex === -1 ? content.length : endIndex;

  return {
    start,
    end,
    text: content.slice(start, end),
  };
}

function charIndexFromLine(lines, lineIndex) {
  let index = 0;

  for (let line = 0; line < lineIndex; line += 1) {
    index += lines[line].length + 1;
  }

  return index;
}

function setEditorValue(nextValue, selectionStart, selectionEnd) {
  refs.editor.value = nextValue;
  refs.editor.focus();
  refs.editor.setSelectionRange(selectionStart, selectionEnd);
  handleEditorInput();
}

function replaceSelection(start, end, replacement, nextSelectionStartOffset, nextSelectionEndOffset) {
  const value = refs.editor.value;
  const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  const nextSelectionStart = start + nextSelectionStartOffset;
  const nextSelectionEnd = start + nextSelectionEndOffset;
  setEditorValue(nextValue, nextSelectionStart, nextSelectionEnd);
}

function applyFormat(format) {
  if (!state.activeProjectConfig) {
    return;
  }

  switch (format) {
    case "bold":
      wrapSelection("**", "**", "bold");
      break;
    case "italic":
      wrapSelection("*", "*", "italic");
      break;
    case "code":
      wrapSelection("`", "`", "code");
      break;
    case "link":
      insertLink();
      break;
    case "task":
      toggleTaskAtSelection();
      break;
    case "quote":
      prefixSelectionLines("> ");
      break;
    case "heading":
      prefixSelectionLines("## ");
      break;
    case "codeblock":
      wrapSelection("```\n", "\n```", "code");
      break;
    default:
      break;
  }
}

function wrapSelection(prefix, suffix, placeholder) {
  const selectionStart = refs.editor.selectionStart;
  const selectionEnd = refs.editor.selectionEnd;
  const selectedText = refs.editor.value.slice(selectionStart, selectionEnd) || placeholder;
  const replacement = `${prefix}${selectedText}${suffix}`;
  const cursorStart = prefix.length;
  const cursorEnd = prefix.length + selectedText.length;
  replaceSelection(selectionStart, selectionEnd, replacement, cursorStart, cursorEnd);
}

function prefixSelectionLines(prefix) {
  const selectionStart = refs.editor.selectionStart;
  const selectionEnd = refs.editor.selectionEnd;
  const lineStart = refs.editor.value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEndIndex = refs.editor.value.indexOf("\n", selectionEnd);
  const lineEnd = lineEndIndex === -1 ? refs.editor.value.length : lineEndIndex;
  const block = refs.editor.value.slice(lineStart, lineEnd);
  const updated = block
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
  replaceSelection(lineStart, lineEnd, updated, 0, updated.length);
}

function insertLink() {
  const selectionStart = refs.editor.selectionStart;
  const selectionEnd = refs.editor.selectionEnd;
  const selectedText = refs.editor.value.slice(selectionStart, selectionEnd) || "link";
  const url = window.prompt("Link URL", "https://");

  if (!url) {
    return;
  }

  const replacement = `[${selectedText}](${url})`;
  replaceSelection(selectionStart, selectionEnd, replacement, 1, 1 + selectedText.length);
}

function toggleTaskAtSelection() {
  const selectionStart = refs.editor.selectionStart;
  const selectionEnd = refs.editor.selectionEnd;
  const lineStart = refs.editor.value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEndIndex = refs.editor.value.indexOf("\n", selectionEnd);
  const lineEnd = lineEndIndex === -1 ? refs.editor.value.length : lineEndIndex;
  const block = refs.editor.value.slice(lineStart, lineEnd);
  const updated = block
    .split("\n")
    .map((line) => {
      if (/^\s*-\s+\[( |x|X)\]\s+/.test(line)) {
        return line.replace(/\[( |x|X)\]/, (_match, checked) => (checked.toLowerCase() === "x" ? "[ ]" : "[x]"));
      }

      if (/^\s*-\s+/.test(line)) {
        return line.replace(/^\s*-\s+/, (match) => `${match}[ ] `);
      }

      if (!line.trim()) {
        return "- [ ] ";
      }

      return `- [ ] ${line.trim()}`;
    })
    .join("\n");

  replaceSelection(lineStart, lineEnd, updated, 0, updated.length);
}

function adjustIndent(delta) {
  const selectionStart = refs.editor.selectionStart;
  const selectionEnd = refs.editor.selectionEnd;
  const lineStart = refs.editor.value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEndIndex = refs.editor.value.indexOf("\n", selectionEnd);
  const lineEnd = lineEndIndex === -1 ? refs.editor.value.length : lineEndIndex;
  const block = refs.editor.value.slice(lineStart, lineEnd);
  const updated = block
    .split("\n")
    .map((line) => {
      if (delta > 0) {
        return `${" ".repeat(delta)}${line}`;
      }

      if (line.startsWith(" ".repeat(-delta))) {
        return line.slice(-delta);
      }

      return line.replace(/^\s+/, (spaces) => spaces.slice(Math.min(spaces.length, -delta)));
    })
    .join("\n");

  replaceSelection(lineStart, lineEnd, updated, 0, updated.length);
}

function handleGlobalKeydown(event) {
  if (!state.activeProjectConfig) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
      event.preventDefault();
      refs.projectSearch.focus();
    }
    return;
  }

  const key = event.key.toLowerCase();
  const metaKey = event.metaKey || event.ctrlKey;

  if (!metaKey) {
    return;
  }

  if (key === "p") {
    event.preventDefault();
    refs.projectSearch.focus();
    refs.projectSearch.select();
    return;
  }

  if (key === "j") {
    event.preventDefault();
    handleJumpToToday();
    return;
  }

  if (key === "f") {
    event.preventDefault();
    openFindDialog();
  }
}

async function handleJumpToToday() {
  if (!state.activeProjectConfig || state.activeDoc !== "log") {
    return;
  }

  await maybeEnsureCurrentLogDocument();
  const todayKey = getDateKey(new Date());
  const lines = normalizeLineEndings(refs.editor.value).split("\n");
  let targetLine = findBodyInsertLine(lines);

  for (let index = 0; index < lines.length; index += 1) {
    if (parseDateHeading(lines[index]) === todayKey) {
      targetLine = index;
      break;
    }
  }

  const targetIndex = charIndexFromLine(lines, targetLine);
  refs.editor.focus();
  refs.editor.setSelectionRange(targetIndex, targetIndex);
}

function openFindDialog() {
  const query = window.prompt("Find in current note", state.lastFindTerm || "");
  if (!query) {
    return;
  }

  state.lastFindTerm = query;
  const haystack = refs.editor.value.toLowerCase();
  const needle = query.toLowerCase();
  const startIndex = refs.editor.selectionEnd;
  let matchIndex = haystack.indexOf(needle, startIndex);

  if (matchIndex === -1) {
    matchIndex = haystack.indexOf(needle);
  }

  if (matchIndex === -1) {
    window.alert(`No match for "${query}".`);
    return;
  }

  refs.editor.focus();
  refs.editor.setSelectionRange(matchIndex, matchIndex + query.length);
}

function handleReloadDiskCopy() {
  if (!state.conflict) {
    return;
  }

  refs.editor.value = state.conflict.diskText;
  state.currentContent = state.conflict.diskText;
  state.baselineContent = state.conflict.diskText;
  state.lastLoadedDiskContent = state.conflict.diskText;
  state.dirty = false;
  state.conflict = null;
  state.saveStatus = "synced";
  updatePreview();
  renderWorkspace();
}

async function handleOverwriteDiskCopy() {
  if (!state.conflict) {
    return;
  }

  state.currentContent = refs.editor.value;
  await persistCurrentDocument({ force: true, prune: true, overwrite: true });
}

function handlePageHide() {
  persistCurrentDocument({ force: true, prune: true, overwrite: false }).catch(() => {});
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    persistCurrentDocument({ force: true, prune: true, overwrite: false }).catch(() => {});
  }
}

async function showFormDialog({ title, description, body, submitLabel }) {
  return new Promise((resolve) => {
    refs.modal.innerHTML = `
      <form class="dialog-card dialog-form" method="dialog">
        <div class="dialog-copy">
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(description)}</p>
        </div>
        ${body}
        <div class="dialog-actions">
          <button class="secondary-button" type="button" data-cancel>Cancel</button>
          <button class="primary-button" type="submit">${escapeHtml(submitLabel)}</button>
        </div>
      </form>
    `;

    const form = refs.modal.querySelector("form");
    const cleanup = () => {
      refs.modal.innerHTML = "";
    };

    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      refs.modal.close();
      cleanup();
      resolve(value);
    };

    form.querySelector("[data-cancel]").addEventListener("click", () => finish(null));
    refs.modal.addEventListener(
      "cancel",
      (event) => {
        event.preventDefault();
        finish(null);
      },
      { once: true },
    );

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(Object.fromEntries(new FormData(form).entries()));
    });

    refs.modal.showModal();
    form.querySelector("input, select, textarea")?.focus();
  });
}

async function showChoiceDialog({ title, description, choices }) {
  return new Promise((resolve) => {
    refs.modal.innerHTML = `
      <div class="dialog-card">
        <div class="dialog-copy">
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(description)}</p>
        </div>
        <div class="dialog-actions">
          <button class="secondary-button" type="button" data-choice="">Cancel</button>
          ${choices
            .map(
              (choice) =>
                `<button class="${choice.kind === "primary" ? "primary-button" : "secondary-button"}" type="button" data-choice="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</button>`,
            )
            .join("")}
        </div>
      </div>
    `;

    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      refs.modal.close();
      refs.modal.innerHTML = "";
      resolve(value);
    };

    refs.modal.querySelectorAll("[data-choice]").forEach((button) => {
      button.addEventListener("click", () => finish(button.dataset.choice || null));
    });

    refs.modal.addEventListener(
      "cancel",
      (event) => {
        event.preventDefault();
        finish(null);
      },
      { once: true },
    );

    refs.modal.showModal();
  });
}

async function showConfirmDialog({ title, description, confirmLabel }) {
  const result = await showChoiceDialog({
    title,
    description,
    choices: [{ label: confirmLabel, value: "confirm", kind: "primary" }],
  });

  return result === "confirm";
}

function showError(message, error) {
  console.error(message, error);
  state.saveStatus = "error";
  renderWorkspace();
  window.alert(message);
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, "\n");
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function normalizeComparable(value) {
  return normalizeLineEndings(value).trim();
}

function downgradeTopHeading(text) {
  return text.replace(/^#\s+/m, "## ");
}

function removeTopHeading(text) {
  return stripFrontmatter(normalizeLineEndings(text)).replace(/^#\s+.*\n?/m, "");
}

function pickLatestIso(left, right) {
  if (!left) {
    return right || null;
  }

  if (!right) {
    return left;
  }

  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function entryNameToId(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

function titleFromSlug(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isPlainTextInsertion(event) {
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
}

init().catch((error) => {
  showError("The app failed to initialize.", error);
});
