const api = window.transcriptStudio;
const MAX_GLOBAL_LOG_CHARS = 200000;
const MAX_JOB_LOG_CHARS = 120000;
const MAX_LOG_PANEL_CHARS = 120000;

const state = {
  deps: null,
  settings: null,
  outputDir: '',
  files: {},
  running: false,
  queue: [],
  queueRunning: false,
  stopAfterCurrent: false,
  activeJobId: null,
  selectedJobId: null,
  transcriptViewerEntries: [],
  selectedTranscriptEntryId: null,
  logText: '',
  progress: {
    stage: 'Ready',
    mode: 'indeterminate',
    percent: null,
    message: 'Add files or a YouTube link to the queue, then start the queue.',
    state: 'idle'
  }
};

const els = {
  dependencyBadge: document.querySelector('#dependencyBadge'),
  setupPanel: document.querySelector('#setupPanel'),
  mainPanel: document.querySelector('#mainPanel'),
  setupMessage: document.querySelector('#setupMessage'),
  pythonStatus: document.querySelector('#pythonStatus'),
  brewStatus: document.querySelector('#brewStatus'),
  ytdlpStatus: document.querySelector('#ytdlpStatus'),
  ffmpegStatus: document.querySelector('#ffmpegStatus'),
  whisperStatus: document.querySelector('#whisperStatus'),
  installButton: document.querySelector('#installButton'),
  recheckButton: document.querySelector('#recheckButton'),
  copyManualButton: document.querySelector('#copyManualButton'),
  copyLogButton: document.querySelector('#copyLogButton'),
  continueButton: document.querySelector('#continueButton'),
  setupLog: document.querySelector('#setupLog'),
  outputBasePath: document.querySelector('#outputBasePath'),
  chooseOutputFolderButton: document.querySelector('#chooseOutputFolderButton'),
  resetOutputFolderButton: document.querySelector('#resetOutputFolderButton'),
  openOutputBaseButton: document.querySelector('#openOutputBaseButton'),
  cleanupIntermediateCheckbox: document.querySelector('#cleanupIntermediateCheckbox'),
  youtubeUrlInput: document.querySelector('#youtubeUrlInput'),
  modelSelect: document.querySelector('#modelSelect'),
  languageSelect: document.querySelector('#languageSelect'),
  tryCaptionsCheckbox: document.querySelector('#tryCaptionsCheckbox'),
  fallbackCheckbox: document.querySelector('#fallbackCheckbox'),
  forceWhisperCheckbox: document.querySelector('#forceWhisperCheckbox'),
  openOutputButton: document.querySelector('#openOutputButton'),
  clearButton: document.querySelector('#clearButton'),
  addFilesToQueueButton: document.querySelector('#addFilesToQueueButton'),
  addYoutubeToQueueButton: document.querySelector('#addYoutubeToQueueButton'),
  startQueueButton: document.querySelector('#startQueueButton'),
  stopCurrentJobButton: document.querySelector('#stopCurrentJobButton'),
  clearCompletedButton: document.querySelector('#clearCompletedButton'),
  queueList: document.querySelector('#queueList'),
  currentJobName: document.querySelector('#currentJobName'),
  stageLabel: document.querySelector('#stageLabel'),
  progressCard: document.querySelector('#progressCard'),
  progressStage: document.querySelector('#progressStage'),
  progressPercent: document.querySelector('#progressPercent'),
  progressBar: document.querySelector('#progressBar'),
  progressFill: document.querySelector('#progressFill'),
  progressMessage: document.querySelector('#progressMessage'),
  jobLog: document.querySelector('#jobLog'),
  transcriptTextarea: document.querySelector('#transcriptTextarea'),
  previousJobButton: document.querySelector('#previousJobButton'),
  nextJobButton: document.querySelector('#nextJobButton'),
  selectedJobName: document.querySelector('#selectedJobName'),
  selectedJobStatus: document.querySelector('#selectedJobStatus'),
  selectedJobSourceType: document.querySelector('#selectedJobSourceType'),
  selectedJobModel: document.querySelector('#selectedJobModel'),
  selectedJobPlannedMethod: document.querySelector('#selectedJobPlannedMethod'),
  selectedJobUsedMethod: document.querySelector('#selectedJobUsedMethod'),
  selectedJobFinishedAt: document.querySelector('#selectedJobFinishedAt'),
  selectedJobOutputDir: document.querySelector('#selectedJobOutputDir'),
  copyTranscriptButton: document.querySelector('#copyTranscriptButton'),
  saveTxtButton: document.querySelector('#saveTxtButton'),
  saveVttButton: document.querySelector('#saveVttButton'),
  saveSrtButton: document.querySelector('#saveSrtButton'),
  removeTranscriptFromViewButton: document.querySelector('#removeTranscriptFromViewButton'),
  clearTranscriptViewerButton: document.querySelector('#clearTranscriptViewerButton'),
  cleanDownloadedFilesButton: document.querySelector('#cleanDownloadedFilesButton'),
  openOutputButtonBottom: document.querySelector('#openOutputButtonBottom')
};

api.onLog((message) => {
  appendLog(message);
});

api.onStatus((status) => {
  setStage(status.stage, status.message);
});

api.onProgress((progress) => {
  updateProgress(progress);
});

window.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  renderQueue();
  loadSettings();
  checkDependencies();
});

function bindEvents() {
  els.recheckButton.addEventListener('click', checkDependencies);
  els.installButton.addEventListener('click', installMissingTools);
  els.copyManualButton.addEventListener('click', copyManualCommands);
  els.copyLogButton.addEventListener('click', () => api.copyLog(state.logText));
  els.continueButton.addEventListener('click', showMainPanel);
  els.chooseOutputFolderButton.addEventListener('click', chooseOutputFolder);
  els.resetOutputFolderButton.addEventListener('click', resetOutputFolder);
  els.openOutputBaseButton.addEventListener('click', () => openOutputFolder(state.settings && state.settings.outputBaseDir));
  els.cleanupIntermediateCheckbox.addEventListener('change', toggleCleanupIntermediateMedia);
  els.openOutputButton.addEventListener('click', () => openOutputFolder());
  els.openOutputButtonBottom.addEventListener('click', () => openOutputFolder());
  els.clearButton.addEventListener('click', clearJob);
  els.addFilesToQueueButton.addEventListener('click', addFilesToQueue);
  els.addYoutubeToQueueButton.addEventListener('click', addYoutubeToQueue);
  els.startQueueButton.addEventListener('click', startQueue);
  els.stopCurrentJobButton.addEventListener('click', stopCurrentJob);
  els.clearCompletedButton.addEventListener('click', clearCompletedJobs);
  els.queueList.addEventListener('click', handleQueueClick);
  els.previousJobButton.addEventListener('click', selectPreviousJob);
  els.nextJobButton.addEventListener('click', selectNextJob);
  els.copyTranscriptButton.addEventListener('click', copyTranscript);
  els.saveTxtButton.addEventListener('click', () => saveTranscript('txt'));
  els.saveVttButton.addEventListener('click', () => saveTranscript('vtt'));
  els.saveSrtButton.addEventListener('click', () => saveTranscript('srt'));
  els.removeTranscriptFromViewButton.addEventListener('click', removeSelectedTranscriptFromView);
  els.clearTranscriptViewerButton.addEventListener('click', clearTranscriptViewer);
  els.cleanDownloadedFilesButton.addEventListener('click', cleanSelectedJobFiles);
  els.forceWhisperCheckbox.addEventListener('change', () => {
    if (els.forceWhisperCheckbox.checked) {
      els.tryCaptionsCheckbox.checked = false;
    }
  });
}

async function loadSettings() {
  try {
    state.settings = await api.getSettings();
    renderSettings();
    if (state.settings.didFallback) {
      appendLog(`The selected output folder was unavailable, so Transcript Studio reset to ${state.settings.outputBaseDir}\n`);
    }
  } catch (error) {
    appendLog(`Could not load settings: ${error.message}\n`);
  }
}

function renderSettings() {
  els.outputBasePath.textContent = state.settings && state.settings.outputBaseDir
    ? state.settings.outputBaseDir
    : 'Output folder unavailable';
  els.cleanupIntermediateCheckbox.checked = !state.settings || state.settings.cleanupIntermediateMedia !== false;
}

async function chooseOutputFolder() {
  try {
    state.settings = await api.chooseOutputFolder();
    renderSettings();
    appendLog(`Output folder set to ${state.settings.outputBaseDir}\n`);
  } catch (error) {
    appendLog(`Could not choose output folder: ${error.message}\n`);
  }
}

async function resetOutputFolder() {
  try {
    state.settings = await api.resetOutputFolder();
    renderSettings();
    appendLog(`Output folder reset to ${state.settings.outputBaseDir}\n`);
  } catch (error) {
    appendLog(`Could not reset output folder: ${error.message}\n`);
  }
}

async function toggleCleanupIntermediateMedia() {
  try {
    state.settings = await api.setCleanupIntermediateMedia(els.cleanupIntermediateCheckbox.checked);
    renderSettings();
    appendLog(`Automatic downloaded media cleanup ${state.settings.cleanupIntermediateMedia ? 'enabled' : 'disabled'}.\n`);
  } catch (error) {
    appendLog(`Could not update cleanup setting: ${error.message}\n`);
    els.cleanupIntermediateCheckbox.checked = !els.cleanupIntermediateCheckbox.checked;
  }
}

async function checkDependencies() {
  setStage('Checking dependencies');
  updateProgress({
    stage: 'Preparing',
    mode: 'indeterminate',
    message: 'Checking required tools.'
  });
  setControlsBusy(true);
  try {
    state.deps = await api.checkDependencies();
    renderDependencies();
    if (state.deps.ready) showMainPanel();
    else showSetupPanel();
  } catch (error) {
    appendLog(`Dependency check failed: ${error.message}\n`);
    showSetupPanel();
  } finally {
    setControlsBusy(false);
    if (!state.running) {
      updateProgress({
        stage: state.deps && state.deps.ready ? 'Ready' : 'Preparing',
        mode: 'indeterminate',
        message: state.deps && state.deps.ready ? 'Add files or a YouTube link to the queue, then start the queue.' : 'Install missing tools to continue.',
        state: 'idle'
      });
    }
  }
}

async function installMissingTools() {
  setControlsBusy(true);
  appendLog('\nStarting setup...\n');
  try {
    state.deps = await api.installMissingTools();
    appendLog('\nSetup finished. Re-checking status...\n');
    renderDependencies();
    if (state.deps.ready) showMainPanel();
  } catch (error) {
    appendLog(`\nSetup could not finish: ${error.message}\n`);
    els.setupMessage.textContent = error.message;
  } finally {
    setControlsBusy(false);
  }
}

async function copyManualCommands() {
  await api.copyManualInstallCommands();
  appendLog('\nManual install commands copied.\n');
}

function renderDependencies() {
  const deps = state.deps || {};
  setDependencyRow(els.pythonStatus, deps.python);
  setDependencyRow(els.brewStatus, deps.brew);
  setDependencyRow(els.ytdlpStatus, deps.ytdlp);
  setDependencyRow(els.ffmpegStatus, deps.ffmpeg);
  setDependencyRow(els.whisperStatus, deps.whisper);

  if (deps.ready) {
    els.dependencyBadge.textContent = 'Dependencies ready';
    els.dependencyBadge.className = 'status-badge status-ready';
    els.setupMessage.textContent = 'All required tools are installed.';
  } else {
    els.dependencyBadge.textContent = 'Setup needed';
    els.dependencyBadge.className = 'status-badge status-missing';

    if (deps.brew && !deps.brew.installed) {
      els.setupMessage.textContent = 'Homebrew is required for automatic yt-dlp and ffmpeg setup. Manual commands are available below.';
    } else {
      els.setupMessage.textContent = 'Install missing tools, then re-check dependencies.';
    }
  }

  els.continueButton.disabled = !deps.ready;
}

function setDependencyRow(element, dep) {
  if (!dep) {
    element.textContent = 'Checking';
    element.className = 'checking';
    return;
  }
  element.textContent = dep.installed ? 'Installed' : 'Missing';
  element.className = dep.installed ? 'installed' : 'missing';
}

function showSetupPanel() {
  els.setupPanel.classList.remove('hidden');
  els.mainPanel.classList.add('hidden');
}

function showMainPanel() {
  els.setupPanel.classList.add('hidden');
  els.mainPanel.classList.remove('hidden');
  setStage('Ready');
}

function getCurrentQueueSettings() {
  return {
    model: els.modelSelect.value,
    language: els.languageSelect.value,
    tryCaptionsFirst: els.tryCaptionsCheckbox.checked,
    useWhisperFallback: els.fallbackCheckbox.checked,
    forceWhisper: els.forceWhisperCheckbox.checked,
    outputBaseDir: state.settings && state.settings.outputBaseDir ? state.settings.outputBaseDir : '',
    cleanupIntermediateMedia: !state.settings || state.settings.cleanupIntermediateMedia !== false
  };
}

function createQueueJob(sourceType, source) {
  const settings = getCurrentQueueSettings();
  const createdAt = new Date().toISOString();
  return {
    id: `job-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sourceType,
    source,
    displayName: sourceType === 'local-file' ? source.split(/[\\/]/).pop() : source,
    model: settings.model,
    language: settings.language,
    tryCaptionsFirst: settings.tryCaptionsFirst,
    useWhisperFallback: settings.useWhisperFallback,
    forceWhisper: settings.forceWhisper,
    plannedMethod: plannedMethodForJob(sourceType, settings),
    outputBaseDir: settings.outputBaseDir,
    cleanupIntermediateMedia: settings.cleanupIntermediateMedia,
    status: 'Waiting',
    outputDir: '',
    files: {},
    transcriptPath: '',
    vttPath: '',
    srtPath: '',
    method: '',
    hasIntermediateMedia: false,
    transcriptText: '',
    error: '',
    log: '',
    createdAt,
    startedAt: '',
    finishedAt: ''
  };
}

function plannedMethodForJob(sourceType, settings) {
  if (sourceType === 'local-file') return 'Whisper';
  if (settings.forceWhisper) return 'Whisper forced';
  if (settings.tryCaptionsFirst && settings.useWhisperFallback) return 'Captions first, Whisper fallback';
  if (settings.tryCaptionsFirst && !settings.useWhisperFallback) return 'Captions only';
  return 'Whisper';
}

async function addFilesToQueue() {
  const filePaths = await api.chooseFiles();
  if (!filePaths || filePaths.length === 0) return;
  filePaths.forEach((filePath) => {
    state.queue.push(createQueueJob('local-file', filePath));
  });
  state.selectedJobId = state.queue[state.queue.length - 1].id;
  selectQueueJob(state.selectedJobId);
}

function addYoutubeToQueue() {
  const url = els.youtubeUrlInput.value.trim();
  if (!url) {
    appendLog('Paste a YouTube URL before adding it to the queue.\n');
    return;
  }
  const job = createQueueJob('youtube', url);
  state.queue.push(job);
  state.selectedJobId = job.id;
  els.youtubeUrlInput.value = '';
  selectQueueJob(job.id);
}

async function startQueue() {
  if (state.queueRunning) return;
  state.queueRunning = true;
  state.stopAfterCurrent = false;
  renderQueue();

  while (!state.stopAfterCurrent) {
    const nextJob = state.queue.find((job) => job.status === 'Waiting');
    if (!nextJob) break;
    const outcome = await runQueueJob(nextJob);
    if (outcome === 'cancelled') break;
  }

  state.queueRunning = false;
  state.activeJobId = null;
  els.currentJobName.textContent = 'None';
  updateQueueButtons();
  renderQueue();
}

async function runQueueJob(job) {
  job.status = 'Running';
  job.startedAt = new Date().toISOString();
  job.finishedAt = '';
  job.error = '';
  job.log = '';
  state.activeJobId = job.id;
  state.selectedJobId = job.id;
  state.running = true;
  state.logText = '';
  if (!getSelectedTranscriptEntry()) {
    state.outputDir = '';
    state.files = {};
    els.jobLog.textContent = '';
    els.transcriptTextarea.value = getEmptyTranscriptViewerMessage();
    updateSelectedTranscriptDetails(null);
  }
  els.setupLog.textContent = '';
  els.currentJobName.textContent = job.displayName;
  updateFileButtons();
  updateQueueButtons();
  renderQueue();
  updateProgress({
    stage: 'Preparing',
    mode: 'indeterminate',
    message: `Preparing ${job.displayName}.`,
    state: 'working'
  });

  try {
    const result = await api.startTranscript({
      filePath: job.sourceType === 'local-file' ? job.source : '',
      youtubeUrl: job.sourceType === 'youtube' ? job.source : '',
      model: job.model,
      language: job.language,
      tryCaptionsFirst: job.tryCaptionsFirst,
      useWhisperFallback: job.useWhisperFallback,
      forceWhisper: job.forceWhisper,
      outputBaseDir: job.outputBaseDir,
      cleanupIntermediateMedia: job.cleanupIntermediateMedia,
      queueJobId: job.id,
      createdAt: job.createdAt,
      startedAt: job.startedAt
    });

    if (result && result.cancelled) {
      job.status = 'Cancelled';
      job.method = 'cancelled';
      job.error = result.error || 'Job cancelled by user.';
      job.outputDir = result.outputDir || job.outputDir;
      job.outputBaseDir = result.outputBaseDir || job.outputBaseDir;
      job.finishedAt = new Date().toISOString();
      job.log += 'Job cancelled by user.\n';
      selectQueueJob(job.id);
      return 'cancelled';
    }

    job.status = 'Finished';
    job.outputDir = result.outputDir;
    job.outputBaseDir = result.outputBaseDir || job.outputBaseDir;
    job.files = result.files || {};
    job.transcriptPath = result.files && result.files.txt ? result.files.txt : '';
    job.vttPath = result.files && result.files.vtt ? result.files.vtt : '';
    job.srtPath = result.files && result.files.srt ? result.files.srt : '';
    job.method = result.method || '';
    job.hasIntermediateMedia = Boolean(result.cleanup && result.cleanup.hasIntermediateMedia);
    job.transcriptText = result.transcript || '';
    job.finishedAt = new Date().toISOString();
    addTranscriptViewerEntry(job);
    return 'finished';
  } catch (error) {
    job.status = 'Failed';
    job.method = 'failed';
    job.error = error.message || 'Job failed.';
    job.finishedAt = new Date().toISOString();
    selectQueueJob(job.id);
    return 'failed';
  } finally {
    state.running = false;
    updateQueueButtons();
    renderQueue();
  }
}

async function stopCurrentJob() {
  if (!state.activeJobId) return;
  const shouldStop = window.confirm('Stop the current job? Partial output may be incomplete.');
  if (!shouldStop) return;
  state.stopAfterCurrent = true;
  await api.stopCurrentJob();
}

function clearCompletedJobs() {
  state.queue = state.queue.filter((job) => job.status !== 'Finished');
  if (state.selectedJobId && !state.queue.some((job) => job.id === state.selectedJobId)) {
    state.selectedJobId = state.queue[0] ? state.queue[0].id : null;
  }
  renderQueue();
}

function handleQueueClick(event) {
  const button = event.target.closest('button[data-action]');
  const row = event.target.closest('tr[data-job-id]');
  if (!row) return;
  const jobId = row.dataset.jobId;

  if (!button) {
    selectQueueJob(jobId);
    return;
  }

  const job = state.queue.find((item) => item.id === jobId);
  if (!job) return;

  if (button.dataset.action === 'open' && job.outputDir) {
    openOutputFolder(job.outputDir);
  } else if (button.dataset.action === 'retry') {
    retryQueueJob(job);
  } else if (button.dataset.action === 'remove' && job.status === 'Waiting') {
    state.queue = state.queue.filter((item) => item.id !== job.id);
    if (state.selectedJobId === job.id) state.selectedJobId = null;
    renderQueue();
  }
}

function retryQueueJob(job) {
  if (job.status !== 'Failed' && job.status !== 'Cancelled') return;
  job.status = 'Waiting';
  job.outputDir = '';
  job.files = {};
  job.transcriptPath = '';
  job.vttPath = '';
  job.srtPath = '';
  job.method = '';
  job.hasIntermediateMedia = false;
  job.transcriptText = '';
  removeTranscriptEntriesForJob(job.id);
  job.error = '';
  job.log = '';
  job.startedAt = '';
  job.finishedAt = '';
  renderQueue();
}

function selectQueueJob(jobId) {
  const job = state.queue.find((item) => item.id === jobId);
  if (!job) return;
  state.selectedJobId = job.id;
  const transcriptEntry = state.transcriptViewerEntries.find((entry) => entry.jobId === job.id);
  if (transcriptEntry) {
    selectTranscriptEntry(transcriptEntry.id);
    return;
  }
  els.jobLog.textContent = job.log || '';
  renderQueue();
}

function clearTranscriptSelection() {
  state.selectedTranscriptEntryId = null;
  state.outputDir = '';
  state.files = {};
  els.jobLog.textContent = '';
  els.transcriptTextarea.value = getEmptyTranscriptViewerMessage();
  updateSelectedTranscriptDetails(null);
  updateFileButtons();
  renderQueue();
}

function getEmptyTranscriptViewerMessage() {
  return 'No transcripts in viewer. Completed jobs will appear here when they finish.';
}

function getSelectedJob() {
  return state.queue.find((job) => job.id === state.selectedJobId) || null;
}

function getSelectedTranscriptEntry() {
  return state.transcriptViewerEntries.find((entry) => entry.id === state.selectedTranscriptEntryId) || null;
}

function addTranscriptViewerEntry(job) {
  removeTranscriptEntriesForJob(job.id);
  const entry = {
    id: `transcript-${job.id}-${Date.now()}`,
    jobId: job.id,
    displayName: job.displayName,
    transcriptText: job.transcriptText || '',
    outputDir: job.outputDir || '',
    transcriptPath: job.transcriptPath || '',
    srtPath: job.srtPath || '',
    vttPath: job.vttPath || '',
    sourceType: job.sourceType,
    model: job.model,
    plannedMethod: job.plannedMethod || plannedMethodForJob(job.sourceType, job),
    actualMethod: job.method || '',
    status: job.status,
    finishedAt: job.finishedAt || '',
    log: job.log || '',
    hasIntermediateMedia: job.hasIntermediateMedia
  };
  state.transcriptViewerEntries.push(entry);
  selectTranscriptEntry(entry.id);
}

function removeTranscriptEntriesForJob(jobId) {
  const removedSelectedEntry = state.transcriptViewerEntries.some((entry) => {
    return entry.jobId === jobId && entry.id === state.selectedTranscriptEntryId;
  });
  state.transcriptViewerEntries = state.transcriptViewerEntries.filter((entry) => entry.jobId !== jobId);
  if (removedSelectedEntry) state.selectedTranscriptEntryId = null;
}

function selectTranscriptEntry(entryId) {
  const entry = state.transcriptViewerEntries.find((item) => item.id === entryId);
  if (!entry) {
    clearTranscriptSelection();
    return;
  }

  state.selectedTranscriptEntryId = entry.id;
  state.selectedJobId = entry.jobId;
  state.outputDir = entry.outputDir || '';
  state.files = {
    txt: entry.transcriptPath || null,
    vtt: entry.vttPath || null,
    srt: entry.srtPath || null
  };
  els.jobLog.textContent = entry.log || '';
  els.transcriptTextarea.value = entry.transcriptText || '';
  updateSelectedTranscriptDetails(entry);
  updateFileButtons();
  renderQueue();
}

function updateSelectedTranscriptDetails(entry = getSelectedTranscriptEntry()) {
  if (!entry) {
    els.selectedJobName.textContent = 'No transcript selected';
    els.selectedJobStatus.textContent = 'Ready';
    els.selectedJobSourceType.textContent = 'Not selected';
    els.selectedJobModel.textContent = 'Not selected';
    els.selectedJobPlannedMethod.textContent = 'Not selected';
    els.selectedJobUsedMethod.textContent = 'Not run';
    els.selectedJobFinishedAt.textContent = 'Not finished';
    els.selectedJobOutputDir.textContent = 'Not available';
    return;
  }

  els.selectedJobName.textContent = entry.displayName;
  els.selectedJobStatus.textContent = entry.status || 'Finished';
  els.selectedJobSourceType.textContent = entry.sourceType === 'local-file' ? 'Local file' : 'YouTube';
  els.selectedJobModel.textContent = entry.model;
  els.selectedJobPlannedMethod.textContent = entry.plannedMethod || 'Not available';
  els.selectedJobUsedMethod.textContent = entry.actualMethod ? methodLabel(entry.actualMethod) : 'Not available';
  els.selectedJobFinishedAt.textContent = entry.finishedAt ? new Date(entry.finishedAt).toLocaleString() : 'Not finished';
  els.selectedJobOutputDir.textContent = entry.outputDir || 'Not available';
}

function methodLabel(method) {
  if (method === 'youtube-captions') return 'YouTube captions';
  if (method === 'youtube-auto-captions') return 'YouTube auto-captions';
  if (method === 'whisper') return 'Whisper';
  if (method === 'failed') return 'Failed';
  if (method === 'cancelled') return 'Cancelled';
  return method;
}

function actualMethodForJob(job) {
  if (job.method) return methodLabel(job.method);
  if (job.status === 'Waiting') return 'Not run';
  if (job.status === 'Running') return 'Running';
  return 'Not available';
}

function selectPreviousJob() {
  if (state.transcriptViewerEntries.length === 0) return;
  const index = state.transcriptViewerEntries.findIndex((entry) => entry.id === state.selectedTranscriptEntryId);
  const previous = state.transcriptViewerEntries[Math.max(0, index - 1)];
  if (previous) selectTranscriptEntry(previous.id);
}

function selectNextJob() {
  if (state.transcriptViewerEntries.length === 0) return;
  const index = state.transcriptViewerEntries.findIndex((entry) => entry.id === state.selectedTranscriptEntryId);
  const next = state.transcriptViewerEntries[Math.min(state.transcriptViewerEntries.length - 1, index + 1)];
  if (next) selectTranscriptEntry(next.id);
}

async function cleanSelectedJobFiles() {
  const entry = getSelectedTranscriptEntry();
  const outputDir = entry ? entry.outputDir : state.outputDir;
  if (!outputDir) return;

  try {
    const cleanup = await api.cleanupIntermediateMedia(outputDir);
    const job = entry ? state.queue.find((item) => item.id === entry.jobId) : null;
    if (job) {
      job.hasIntermediateMedia = Boolean(cleanup.hasIntermediateMedia);
      job.log += cleanup.deleted.length > 0
        ? cleanup.deleted.map((filename) => `Deleted intermediate file: ${filename}\n`).join('')
        : 'No intermediate media files to clean up.\n';
    }
    if (entry) {
      entry.hasIntermediateMedia = Boolean(cleanup.hasIntermediateMedia);
      entry.log = appendBoundedText(
        entry.log,
        cleanup.deleted.length > 0
          ? cleanup.deleted.map((filename) => `Deleted intermediate file: ${filename}\n`).join('')
          : 'No intermediate media files to clean up.\n',
        MAX_JOB_LOG_CHARS
      );
      selectTranscriptEntry(entry.id);
    }
    appendLog(cleanup.deleted.length > 0
      ? `Cleaned ${cleanup.deleted.length} downloaded file(s).\n`
      : 'No intermediate media files to clean up.\n');
    updateFileButtons();
    renderQueue();
  } catch (error) {
    appendLog(`Cleanup failed: ${error.message}\n`);
  }
}

function removeSelectedTranscriptFromView() {
  const entry = getSelectedTranscriptEntry();
  if (!entry) return;

  const currentIndex = state.transcriptViewerEntries.findIndex((item) => item.id === entry.id);
  state.transcriptViewerEntries = state.transcriptViewerEntries.filter((item) => item.id !== entry.id);
  const replacement = state.transcriptViewerEntries[currentIndex] || state.transcriptViewerEntries[currentIndex - 1] || null;
  if (replacement) selectTranscriptEntry(replacement.id);
  else clearTranscriptSelection();
}

function clearTranscriptViewer() {
  state.transcriptViewerEntries = [];
  clearTranscriptSelection();
}

function renderQueue() {
  if (state.queue.length === 0) {
    els.queueList.innerHTML = '<tr><td colspan="7" class="queue-empty">No jobs in the queue. Add an audio file or YouTube link to begin.</td></tr>';
    state.selectedJobId = null;
    if (!getSelectedTranscriptEntry()) {
      els.transcriptTextarea.value = getEmptyTranscriptViewerMessage();
      updateSelectedTranscriptDetails(null);
    }
    updateFileButtons();
    updateQueueButtons();
    return;
  }

  els.queueList.innerHTML = state.queue.map((job) => {
    const selected = job.id === state.selectedJobId ? ' selected-row' : '';
    const canOpen = job.outputDir && (job.status === 'Finished' || job.status === 'Cancelled');
    const canRetry = job.status === 'Failed' || job.status === 'Cancelled';
    const canRemove = job.status === 'Waiting';
    const error = job.error ? `<div class="queue-error">${escapeHtml(job.error)}</div>` : '';
    return `
      <tr class="queue-row${selected}" data-job-id="${job.id}">
        <td>
          <strong>${escapeHtml(job.displayName)}</strong>
          ${error}
        </td>
        <td>${job.sourceType === 'local-file' ? 'Local file' : 'YouTube'}</td>
        <td>${escapeHtml(job.model)}</td>
        <td>${escapeHtml(job.plannedMethod || plannedMethodForJob(job.sourceType, job))}</td>
        <td>${escapeHtml(actualMethodForJob(job))}</td>
        <td><span class="queue-status ${job.status.toLowerCase()}">${job.status}</span></td>
        <td class="queue-row-actions">
          <button data-action="open" ${canOpen ? '' : 'disabled'}>Output</button>
          <button data-action="retry" ${canRetry ? '' : 'disabled'}>Retry</button>
          <button data-action="remove" ${canRemove ? '' : 'disabled'}>Remove</button>
        </td>
      </tr>
    `;
  }).join('');
  updateFileButtons();
  updateQueueButtons();
}

function updateQueueButtons() {
  const hasWaiting = state.queue.some((job) => job.status === 'Waiting');
  els.startQueueButton.disabled = state.queueRunning || !hasWaiting;
  els.stopCurrentJobButton.disabled = !state.activeJobId;
  els.addFilesToQueueButton.disabled = state.queueRunning;
  els.addYoutubeToQueueButton.disabled = state.queueRunning;
  els.clearCompletedButton.disabled = state.queueRunning || !state.queue.some((job) => job.status === 'Finished');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setStage(stage, message = '') {
  els.stageLabel.textContent = message ? `${stage}: ${message}` : stage;
}

function updateProgress(progress = {}) {
  state.progress = { ...state.progress, ...progress };
  const { stage, mode, percent, message, state: progressState } = state.progress;
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;

  els.progressStage.textContent = stage || 'Preparing';
  els.progressMessage.textContent = message || '';
  els.progressPercent.textContent = mode === 'determinate' && safePercent !== null ? `${Math.round(safePercent)}%` : '';
  els.progressBar.classList.toggle('indeterminate', mode !== 'determinate');
  els.progressBar.classList.toggle('determinate', mode === 'determinate');
  els.progressBar.classList.toggle('success', progressState === 'success');
  els.progressBar.classList.toggle('failed', progressState === 'failed');
  if (mode === 'determinate' && safePercent !== null) {
    els.progressBar.setAttribute('aria-valuenow', String(Math.round(safePercent)));
  } else {
    els.progressBar.removeAttribute('aria-valuenow');
  }
  els.progressFill.style.width = mode === 'determinate' && safePercent !== null ? `${safePercent}%` : '35%';
}

function appendLog(message) {
  state.logText = appendBoundedText(state.logText, message, MAX_GLOBAL_LOG_CHARS);
  const activeJob = state.queue.find((job) => job.id === state.activeJobId);
  if (activeJob) activeJob.log = appendBoundedText(activeJob.log, message, MAX_JOB_LOG_CHARS);
  const selectedEntry = getSelectedTranscriptEntry();
  if (!activeJob || !selectedEntry || selectedEntry.jobId === activeJob.id) {
    els.jobLog.textContent = appendBoundedText(els.jobLog.textContent, message, MAX_LOG_PANEL_CHARS);
  }
  els.setupLog.textContent = appendBoundedText(els.setupLog.textContent, message, MAX_LOG_PANEL_CHARS);
  els.jobLog.scrollTop = els.jobLog.scrollHeight;
  els.setupLog.scrollTop = els.setupLog.scrollHeight;
}

function appendBoundedText(current, next, limit) {
  const combined = `${current || ''}${next || ''}`;
  if (combined.length <= limit) return combined;
  return combined.slice(combined.length - limit);
}

function setControlsBusy(isBusy) {
  const busy = Boolean(isBusy);
  [
    els.installButton,
    els.recheckButton,
    els.clearButton,
    els.copyManualButton,
    els.chooseOutputFolderButton,
    els.resetOutputFolderButton,
    els.cleanupIntermediateCheckbox,
    els.addFilesToQueueButton,
    els.addYoutubeToQueueButton,
    els.startQueueButton,
    els.clearCompletedButton
  ].forEach((button) => {
    button.disabled = busy;
  });

  if (!busy) {
    els.continueButton.disabled = !(state.deps && state.deps.ready);
    updateQueueButtons();
  }
}

async function openOutputFolder(outputDir = state.outputDir) {
  try {
    await api.openOutputFolder(outputDir);
  } catch (error) {
    appendLog(`Could not open output folder: ${error.message}\n`);
  }
}

function clearJob() {
  state.logText = '';
  els.youtubeUrlInput.value = '';
  els.jobLog.textContent = '';
  els.setupLog.textContent = '';
  clearTranscriptSelection();
  updateFileButtons();
  setStage('Ready');
  updateProgress({
    stage: 'Ready',
    mode: 'indeterminate',
    percent: null,
    message: 'Add files or a YouTube link to the queue, then start the queue.',
    state: 'idle'
  });
}

async function copyTranscript() {
  await api.copyTranscript(els.transcriptTextarea.value);
  appendLog('Transcript copied.\n');
}

async function saveTranscript(format) {
  try {
    const sourcePath = format === 'vtt' ? state.files.vtt : format === 'srt' ? state.files.srt : null;
    const filePath = await api.saveTranscript({
      text: els.transcriptTextarea.value,
      outputDir: state.outputDir,
      format,
      sourcePath
    });
    appendLog(`Saved ${filePath}\n`);
  } catch (error) {
    appendLog(`Save failed: ${error.message}\n`);
  }
}

function updateFileButtons() {
  const selectedEntry = getSelectedTranscriptEntry();
  const files = selectedEntry
    ? {
        txt: selectedEntry.transcriptPath,
        vtt: selectedEntry.vttPath,
        srt: selectedEntry.srtPath
      }
    : state.files;
  const hasTranscript = Boolean(selectedEntry && selectedEntry.transcriptText);
  const hasAnyVisibleTranscript = state.transcriptViewerEntries.length > 0;
  els.copyTranscriptButton.disabled = !hasTranscript;
  els.saveTxtButton.disabled = !hasTranscript || !selectedEntry.outputDir;
  els.saveVttButton.disabled = !files.vtt;
  els.saveSrtButton.disabled = !files.srt;
  els.removeTranscriptFromViewButton.disabled = !selectedEntry;
  els.clearTranscriptViewerButton.disabled = !hasAnyVisibleTranscript;
  els.cleanDownloadedFilesButton.disabled = !(selectedEntry && selectedEntry.hasIntermediateMedia);
  els.openOutputButtonBottom.disabled = selectedEntry ? !selectedEntry.outputDir : !state.outputDir;
  const selectedIndex = state.transcriptViewerEntries.findIndex((entry) => entry.id === state.selectedTranscriptEntryId);
  els.previousJobButton.disabled = selectedIndex <= 0;
  els.nextJobButton.disabled = selectedIndex < 0 || selectedIndex >= state.transcriptViewerEntries.length - 1;
}
