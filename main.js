const { app, BrowserWindow, dialog, ipcMain, shell, clipboard } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const APP_NAME = 'Transcript Studio';
const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'Documents', APP_NAME);
const APP_SUPPORT_ROOT = path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
const SETTINGS_PATH = path.join(APP_SUPPORT_ROOT, 'settings.json');
const WHISPER_VENV_PATH = path.join(APP_SUPPORT_ROOT, 'whisper-venv');
const VENV_PYTHON = path.join(WHISPER_VENV_PATH, 'bin', 'python');
const VENV_PIP = path.join(WHISPER_VENV_PATH, 'bin', 'pip');
const TOOL_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin'
];
const INTERMEDIATE_MEDIA_EXTENSIONS = new Set(['.mp3', '.webm', '.m4a', '.mp4', '.wav', '.opus']);
const MAX_CAPTURED_COMMAND_OUTPUT = 200000;
let activeJobCommand = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 920,
    minHeight: 760,
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function commandEnv() {
  const existingPath = process.env.PATH || '';
  return {
    ...process.env,
    PATH: `${TOOL_PATHS.join(path.delimiter)}${path.delimiter}${existingPath}`
  };
}

function sendLog(event, message) {
  if (event && !event.sender.isDestroyed()) {
    event.sender.send('transcript-log', String(message));
  }
}

function sendStatus(event, stage, message = '') {
  if (event && !event.sender.isDestroyed()) {
    event.sender.send('transcript-status', { stage, message });
  }
}

function sendProgress(event, progress) {
  if (event && !event.sender.isDestroyed()) {
    event.sender.send('transcript-progress', {
      stage: progress.stage || 'Preparing',
      mode: progress.mode || 'indeterminate',
      percent: Number.isFinite(progress.percent) ? progress.percent : null,
      message: progress.message || '',
      state: progress.state || 'working'
    });
  }
}

function runCommand(command, args, options = {}) {
  const {
    cwd,
    event,
    label,
    allowFailure = false,
    progressStage = '',
    progressMessage = '',
    trackAsJob = false
  } = options;
  const fullCommand = [command, ...args].join(' ');
  const displayCommand = label || fullCommand;

  return new Promise((resolve, reject) => {
    sendLog(event, `\n$ ${displayCommand}\n`);

    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      cwd,
      env: commandEnv(),
      windowsHide: true,
      detached: process.platform !== 'win32'
    });
    const commandState = { child, cancelled: false };

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout = appendBounded(stdout, text);
      handleCommandOutput(event, text, { progressStage, progressMessage });
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr = appendBounded(stderr, text);
      handleCommandOutput(event, text, { progressStage, progressMessage });
    });

    child.on('error', (error) => {
      if (activeJobCommand === commandState) activeJobCommand = null;
      const result = { command: displayCommand, stdout, stderr, code: null, error: error.message };
      if (allowFailure) resolve(result);
      else reject(Object.assign(new Error(error.message), result));
    });

    child.on('close', (code, signal) => {
      if (activeJobCommand === commandState) activeJobCommand = null;
      const result = { command: displayCommand, stdout, stderr, code };
      if (commandState.cancelled) {
        const error = new Error('Job cancelled by user.');
        error.cancelled = true;
        error.friendlyMessage = 'Job cancelled by user.';
        error.command = displayCommand;
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        error.signal = signal;
        reject(error);
        return;
      }
      if (code === 0 || allowFailure) resolve(result);
      else {
        const error = new Error(`${displayCommand} exited with code ${code}`);
        reject(Object.assign(error, result));
      }
    });

    if (trackAsJob) activeJobCommand = commandState;
  });
}

function appendBounded(current, next) {
  const combined = `${current}${next}`;
  if (combined.length <= MAX_CAPTURED_COMMAND_OUTPUT) return combined;
  return combined.slice(combined.length - MAX_CAPTURED_COMMAND_OUTPUT);
}

function handleCommandOutput(event, text, options = {}) {
  const percent = parseProgressPercent(text);
  if (percent !== null && options.progressStage) {
    sendProgress(event, {
      stage: options.progressStage,
      mode: 'determinate',
      percent,
      message: options.progressMessage
    });
  }

  if (text.includes('\r') && percent !== null) {
    const meaningfulLines = text
      .split(/\r|\n/)
      .map((line) => line.trim())
      .filter((line) => line && parseProgressPercent(line) === null);
    if (meaningfulLines.length > 0) sendLog(event, `${meaningfulLines.join('\n')}\n`);
    return;
  }

  sendLog(event, text);
}

function parseProgressPercent(text) {
  const patterns = [
    /\[download\]\s+(\d+(?:\.\d+)?)%/,
    /Downloading[^\n\r]*?(\d+(?:\.\d+)?)%/i,
    /\b(\d+(?:\.\d+)?)%\b/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number.parseFloat(match[1]);
      if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
    }
  }

  return null;
}

async function getSettings() {
  try {
    const raw = await fsp.readFile(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const outputBaseDir = typeof parsed.outputBaseDir === 'string' && parsed.outputBaseDir.trim()
      ? parsed.outputBaseDir
      : DEFAULT_OUTPUT_DIR;
    const cleanupIntermediateMedia = typeof parsed.cleanupIntermediateMedia === 'boolean'
      ? parsed.cleanupIntermediateMedia
      : true;
    return { outputBaseDir, cleanupIntermediateMedia };
  } catch (_error) {
    return { outputBaseDir: DEFAULT_OUTPUT_DIR, cleanupIntermediateMedia: true };
  }
}

async function saveSettings(settings) {
  const current = await getSettings();
  const nextSettings = { ...current, ...settings };
  await fsp.mkdir(APP_SUPPORT_ROOT, { recursive: true });
  await fsp.writeFile(SETTINGS_PATH, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');
  return nextSettings;
}

async function ensureOutputBaseDir(event, outputBaseDir) {
  try {
    await fsp.mkdir(outputBaseDir, { recursive: true });
    return outputBaseDir;
  } catch (_error) {
    sendLog(event, `\nThe selected output folder is unavailable. Falling back to ${DEFAULT_OUTPUT_DIR}\n`);
    await fsp.mkdir(DEFAULT_OUTPUT_DIR, { recursive: true });
    await saveSettings({ outputBaseDir: DEFAULT_OUTPUT_DIR });
    return DEFAULT_OUTPUT_DIR;
  }
}

async function checkOne(name, command, args) {
  try {
    const result = await runCommand(command, args, { allowFailure: true });
    return {
      name,
      installed: result.code === 0,
      detail: (result.stdout || result.stderr || '').split('\n').find(Boolean) || ''
    };
  } catch (error) {
    return { name, installed: false, detail: error.message };
  }
}

async function checkDependencies() {
  const [python, ytdlp, ffmpeg, whisper, brew] = await Promise.all([
    checkOne('python', 'python3', ['--version']),
    checkOne('ytdlp', 'yt-dlp', ['--version']),
    checkOne('ffmpeg', 'ffmpeg', ['-version']),
    checkOne('whisper', VENV_PYTHON, ['-m', 'whisper', '--help']),
    checkOne('brew', 'brew', ['--version'])
  ]);

  const required = { python, ytdlp, ffmpeg, whisper };
  return {
    python,
    ytdlp,
    ffmpeg,
    whisper,
    brew,
    paths: {
      appSupportRoot: APP_SUPPORT_ROOT,
      whisperVenvPath: WHISPER_VENV_PATH,
      venvPython: VENV_PYTHON,
      venvPip: VENV_PIP
    },
    ready: Object.values(required).every((item) => item.installed)
  };
}

ipcMain.handle('check-dependencies', async () => checkDependencies());

ipcMain.handle('get-settings', async () => {
  const settings = await getSettings();
  const outputBaseDir = await ensureOutputBaseDir(null, settings.outputBaseDir);
  if (outputBaseDir !== settings.outputBaseDir) {
    return {
      ...settings,
      outputBaseDir,
      didFallback: true
    };
  }
  return settings;
});

ipcMain.handle('choose-output-folder', async () => {
  const current = await getSettings();
  const result = await dialog.showOpenDialog({
    title: 'Choose output folder',
    defaultPath: current.outputBaseDir,
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) return current;

  const outputBaseDir = result.filePaths[0];
  await fsp.mkdir(outputBaseDir, { recursive: true });
  return saveSettings({ outputBaseDir });
});

ipcMain.handle('reset-output-folder', async () => {
  await fsp.mkdir(DEFAULT_OUTPUT_DIR, { recursive: true });
  return saveSettings({ outputBaseDir: DEFAULT_OUTPUT_DIR });
});

ipcMain.handle('set-cleanup-intermediate-media', async (_event, enabled) => {
  return saveSettings({ cleanupIntermediateMedia: Boolean(enabled) });
});

ipcMain.handle('cleanup-intermediate-media', async (event, outputDir) => {
  return cleanupIntermediateMedia(outputDir, event);
});

ipcMain.handle('has-intermediate-media', async (_event, outputDir) => {
  const files = await findIntermediateMediaFiles(outputDir);
  return files.length > 0;
});

ipcMain.handle('stop-current-job', async (event) => {
  if (!activeJobCommand || !activeJobCommand.child) return { stopped: false };

  const commandToStop = activeJobCommand;
  commandToStop.cancelled = true;
  sendLog(event, '\nJob cancelled by user.\n');
  sendStatus(event, 'Cancelled', 'Job cancelled by user');
  sendProgress(event, {
    stage: 'Cancelled',
    mode: 'determinate',
    percent: 100,
    message: 'Job cancelled by user.',
    state: 'failed'
  });

  try {
    if (process.platform !== 'win32') {
      process.kill(-commandToStop.child.pid, 'SIGTERM');
    } else {
      commandToStop.child.kill('SIGTERM');
    }
  } catch (_error) {
    try {
      commandToStop.child.kill('SIGTERM');
    } catch (__error) {
      return { stopped: false };
    }
  }

  setTimeout(() => {
    if (activeJobCommand !== commandToStop) return;
    try {
      if (process.platform !== 'win32') {
        process.kill(-commandToStop.child.pid, 'SIGKILL');
      } else {
        commandToStop.child.kill('SIGKILL');
      }
    } catch (_error) {
      // The process may have already exited after SIGTERM.
    }
  }, 2500);

  return { stopped: true };
});

ipcMain.handle('install-missing-tools', async (event) => {
  sendStatus(event, 'Checking dependencies', 'Checking which tools need setup');
  sendProgress(event, {
    stage: 'Preparing',
    mode: 'indeterminate',
    message: 'Checking which tools need setup.'
  });
  const before = await checkDependencies();

  if (!before.python.installed) {
    throw new Error('python3 is missing. Please install Python 3, then re-check.');
  }

  if ((!before.ytdlp.installed || !before.ffmpeg.installed) && !before.brew.installed) {
    throw new Error('Homebrew is required for automatic yt-dlp and ffmpeg installation. Use the manual commands instead.');
  }

  try {
    if (!before.ytdlp.installed || !before.ffmpeg.installed) {
      sendStatus(event, 'Checking dependencies', 'Installing yt-dlp and ffmpeg');
      await runCommand('brew', ['install', 'yt-dlp', 'ffmpeg'], {
        event,
        label: 'brew install yt-dlp ffmpeg',
        progressStage: 'Preparing',
        progressMessage: 'Installing yt-dlp and ffmpeg with Homebrew.'
      });
    }

    if (!before.whisper.installed) {
      await installWhisperEnvironment(event);
    }
  } catch (error) {
    sendProgress(event, {
      stage: 'Failed',
      mode: 'determinate',
      percent: 100,
      message: error.friendlyMessage || error.message,
      state: 'failed'
    });
    sendLog(event, `\nInstall failed while running: ${error.command || error.message}\n`);
    throw error;
  }

  sendLog(event, '\nWhisper environment ready.\n');
  sendProgress(event, {
    stage: 'Finished',
    mode: 'determinate',
    percent: 100,
    message: 'Whisper environment ready.',
    state: 'success'
  });
  sendStatus(event, 'Ready', 'Setup finished');
  return checkDependencies();
});

async function installWhisperEnvironment(event) {
  sendStatus(event, 'Checking dependencies', 'Creating Whisper environment');
  sendProgress(event, {
    stage: 'Preparing',
    mode: 'indeterminate',
    message: 'Creating Whisper environment.'
  });
  sendLog(event, `\nCreating Whisper environment at ${WHISPER_VENV_PATH}\n`);

  try {
    await fsp.mkdir(APP_SUPPORT_ROOT, { recursive: true });
    if (!fs.existsSync(VENV_PYTHON)) {
      await runCommand('python3', ['-m', 'venv', WHISPER_VENV_PATH], {
        event,
        label: `python3 -m venv "${WHISPER_VENV_PATH}"`
      });
    }
  } catch (error) {
    error.friendlyMessage = 'Transcript Studio could not create its private Whisper environment.';
    error.message = error.friendlyMessage;
    throw error;
  }

  try {
    sendStatus(event, 'Checking dependencies', 'Upgrading pip');
    sendProgress(event, {
      stage: 'Preparing',
      mode: 'indeterminate',
      message: 'Upgrading pip inside the Whisper environment.'
    });
    sendLog(event, '\nUpgrading pip inside the Whisper environment\n');
    await runCommand(VENV_PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
      event,
      label: `"${VENV_PYTHON}" -m pip install --upgrade pip`,
      progressStage: 'Preparing',
      progressMessage: 'Upgrading pip inside the Whisper environment.'
    });

    sendStatus(event, 'Checking dependencies', 'Installing openai-whisper');
    sendProgress(event, {
      stage: 'Preparing',
      mode: 'indeterminate',
      message: 'Installing openai-whisper. This can take a while because dependencies are large.'
    });
    sendLog(event, '\nInstalling openai-whisper into the Whisper environment\n');
    await runCommand(VENV_PYTHON, ['-m', 'pip', 'install', '-U', 'openai-whisper'], {
      event,
      label: `"${VENV_PYTHON}" -m pip install -U openai-whisper`,
      progressStage: 'Preparing',
      progressMessage: 'Installing openai-whisper. This can take a while because dependencies are large.'
    });
  } catch (error) {
    error.friendlyMessage = 'Transcript Studio could not install Whisper into its private environment.';
    error.message = error.friendlyMessage;
    throw error;
  }
}

ipcMain.handle('choose-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose audio or video',
    properties: ['openFile'],
    filters: [
      { name: 'Audio and Video', extensions: ['mp3', 'm4a', 'wav', 'aiff', 'aac', 'flac', 'mp4', 'mov', 'mkv', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('choose-files', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose audio or video files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio and Video', extensions: ['mp3', 'm4a', 'wav', 'aiff', 'aac', 'flac', 'mp4', 'mov', 'mkv', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths;
});

ipcMain.handle('open-output-folder', async (_event, outputDir) => {
  const settings = await getSettings();
  const target = outputDir || settings.outputBaseDir || DEFAULT_OUTPUT_DIR;
  await fsp.mkdir(target, { recursive: true });
  return shell.openPath(target);
});

ipcMain.handle('copy-transcript', async (_event, text) => {
  clipboard.writeText(text || '');
  return true;
});

ipcMain.handle('copy-manual-commands', async () => {
  clipboard.writeText([
    'brew install yt-dlp ffmpeg',
    `mkdir -p "${APP_SUPPORT_ROOT}"`,
    `python3 -m venv "${WHISPER_VENV_PATH}"`,
    `"${VENV_PYTHON}" -m pip install --upgrade pip`,
    `"${VENV_PYTHON}" -m pip install -U openai-whisper`
  ].join('\n'));
  return true;
});

ipcMain.handle('copy-log', async (_event, text) => {
  clipboard.writeText(text || '');
  return true;
});

ipcMain.handle('save-transcript', async (_event, payload) => {
  const { text, outputDir, format = 'txt', sourcePath } = payload || {};
  if (!outputDir) throw new Error('No output folder is available yet.');
  await fsp.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `transcript.${format}`);
  if (sourcePath) {
    await assertPathInsideDirectory(sourcePath, outputDir);
    if (sourcePath !== filePath) await fsp.copyFile(sourcePath, filePath);
    return filePath;
  }
  await fsp.writeFile(filePath, text || '', 'utf8');
  return filePath;
});

ipcMain.handle('start-transcript', async (event, options) => {
  try {
    sendProgress(event, {
      stage: 'Preparing',
      mode: 'indeterminate',
      message: 'Preparing transcript job.'
    });
    const result = await startTranscript(event, options);
    sendStatus(event, 'Finished', 'Transcript ready');
    sendProgress(event, {
      stage: 'Finished',
      mode: 'determinate',
      percent: 100,
      message: 'Transcript ready.',
      state: 'success'
    });
    return result;
  } catch (error) {
    if (error.cancelled) {
      sendStatus(event, 'Cancelled', 'Job cancelled by user');
      sendProgress(event, {
        stage: 'Cancelled',
        mode: 'determinate',
        percent: 100,
        message: 'Job cancelled by user.',
        state: 'failed'
      });
      sendLog(event, '\nJob cancelled by user.\n');
      return {
        cancelled: true,
        error: 'Job cancelled by user.',
        outputDir: error.outputDir || '',
        outputBaseDir: error.outputBaseDir || ''
      };
    }
    sendStatus(event, 'Failed', error.friendlyMessage || error.message);
    sendProgress(event, {
      stage: 'Failed',
      mode: 'determinate',
      percent: 100,
      message: error.friendlyMessage || error.message,
      state: 'failed'
    });
    sendLog(event, `\nFailed: ${error.friendlyMessage || error.message}\n`);
    if (error.command) sendLog(event, `Command: ${error.command}\n`);
    throw error;
  }
});

async function startTranscript(event, options = {}) {
  const filePath = (options.filePath || '').trim();
  const youtubeUrl = (options.youtubeUrl || '').trim();
  const model = options.model || 'small';
  const language = options.language || 'English';
  const queueMeta = {
    queueJobId: options.queueJobId || null,
    createdAt: options.createdAt || new Date().toISOString(),
    startedAt: options.startedAt || new Date().toISOString(),
    cleanupIntermediateMedia: typeof options.cleanupIntermediateMedia === 'boolean'
      ? options.cleanupIntermediateMedia
      : null
  };

  if (!filePath && !youtubeUrl) {
    throw friendlyError('Choose a local audio/video file or paste a YouTube URL.');
  }

  if (filePath && youtubeUrl) {
    throw friendlyError('Use one source at a time: choose a file or paste a YouTube URL, not both.');
  }

  sendStatus(event, 'Checking dependencies');
  sendProgress(event, {
    stage: 'Preparing',
    mode: 'indeterminate',
    message: 'Checking required tools.'
  });
  const deps = await checkDependencies();
  const missing = ['python', 'ytdlp', 'ffmpeg', 'whisper'].filter((key) => !deps[key].installed);
  if (missing.length > 0) {
    throw friendlyError(`Missing required tools: ${missing.join(', ')}. Run setup, then try again.`);
  }

  const sourceType = filePath ? 'local-file' : 'youtube';
  const settings = await getSettings();
  const requestedOutputBaseDir = options.outputBaseDir || settings.outputBaseDir;
  const outputBaseDir = await ensureOutputBaseDir(event, requestedOutputBaseDir);
  const jobDir = await createJobDir(filePath || youtubeUrl, outputBaseDir);
  sendLog(event, `Output folder: ${jobDir}\n`);

  if (sourceType === 'local-file') {
    await ensureFileExists(filePath);
    try {
      return await runWhisperFlow(event, {
        inputPath: filePath,
        jobDir,
        sourceType,
        source: filePath,
        model,
        language,
        outputBaseDir,
        queueMeta
      });
    } catch (error) {
      error.outputDir = jobDir;
      error.outputBaseDir = outputBaseDir;
      throw error;
    }
  }

  const forceWhisper = Boolean(options.forceWhisper);
  const tryCaptionsFirst = options.tryCaptionsFirst !== false;
  const useWhisperFallback = options.useWhisperFallback !== false;

  if (sourceType === 'youtube' && forceWhisper) {
    sendLog(event, 'Force Whisper enabled, skipping caption check.\n');
  }

  if (tryCaptionsFirst && !forceWhisper) {
    try {
      const captionResult = await tryYouTubeCaptions(event, {
        url: youtubeUrl,
        jobDir,
        model,
        language,
        useWhisperFallback,
        outputBaseDir,
        queueMeta
      });
      if (captionResult) return captionResult;
      sendLog(event, 'Using Whisper fallback...\n');
    } catch (error) {
      error.outputDir = jobDir;
      error.outputBaseDir = outputBaseDir;
      throw error;
    }
  }

  try {
    return await runYouTubeWhisperFlow(event, {
      url: youtubeUrl,
      jobDir,
      sourceType,
      source: youtubeUrl,
      model,
      language,
      outputBaseDir,
      queueMeta
    });
  } catch (error) {
    error.outputDir = jobDir;
    error.outputBaseDir = outputBaseDir;
    throw error;
  }
}

function friendlyError(message) {
  const error = new Error(message);
  error.friendlyMessage = message;
  return error;
}

async function ensureFileExists(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('Not a file');
  } catch (_error) {
    throw friendlyError('The selected local file could not be found.');
  }
}

async function createJobDir(source, outputBaseDir) {
  await fsp.mkdir(outputBaseDir, { recursive: true });
  const date = new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-') + '-' + String(date.getHours()).padStart(2, '0') + String(date.getMinutes()).padStart(2, '0');

  const slug = slugFromSource(source);
  let jobDir = path.join(outputBaseDir, `${stamp}-${slug}`);
  let suffix = 1;
  while (fs.existsSync(jobDir)) {
    suffix += 1;
    jobDir = path.join(outputBaseDir, `${stamp}-${slug}-${suffix}`);
  }
  await fsp.mkdir(jobDir, { recursive: true });
  return jobDir;
}

function slugFromSource(source) {
  const raw = source.startsWith('http')
    ? source.replace(/^https?:\/\//, '').split(/[/?#]/)[0]
    : path.basename(source, path.extname(source));

  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42);
  return slug || 'transcript';
}

async function tryYouTubeCaptions(event, options) {
  const { url, jobDir, model, language, useWhisperFallback, outputBaseDir, queueMeta } = options;
  sendStatus(event, 'Checking YouTube captions');
  sendLog(event, 'Checking YouTube captions...\n');
  sendProgress(event, {
    stage: 'Checking YouTube captions',
    mode: 'indeterminate',
    message: 'Looking for English captions before using Whisper.'
  });

  const listResult = await runCommand('yt-dlp', ['--list-subs', url], {
    event,
    label: `yt-dlp --list-subs "${url}"`,
    allowFailure: true,
    trackAsJob: true
  });

  const subOutput = `${listResult.stdout}\n${listResult.stderr}`;
  const englishLooksAvailable = /(^|\n)en([\s-]|$)|English/i.test(subOutput);
  if (!englishLooksAvailable) {
    sendLog(event, '\nNo usable captions found.\n');
    if (!useWhisperFallback) {
      throw friendlyError('YouTube captions are unavailable and Whisper fallback is disabled.');
    }
    return null;
  }

  sendStatus(event, 'Downloading captions');
  sendLog(event, 'Captions found, downloading captions...\n');
  sendProgress(event, {
    stage: 'Downloading captions',
    mode: 'indeterminate',
    message: 'Downloading YouTube captions.'
  });
  await runCommand('yt-dlp', [
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs',
    'en,en-US,en-GB,en.*',
    '--skip-download',
    '--convert-subs',
    'vtt',
    '--output',
    path.join(jobDir, '%(title)s.%(ext)s'),
    url
  ], {
    event,
    label: `yt-dlp --write-subs --write-auto-subs --sub-langs en,en-US,en-GB,en.* --skip-download --convert-subs vtt --output "${path.join(jobDir, '%(title)s.%(ext)s')}" "${url}"`,
    allowFailure: true,
    progressStage: 'Downloading captions',
    progressMessage: 'Downloading YouTube captions.',
    trackAsJob: true
  });

  const vttPath = await findNewestFile(jobDir, '.vtt');
  if (!vttPath) {
    sendLog(event, '\nNo usable captions found.\n');
    if (!useWhisperFallback) {
      throw friendlyError('YouTube captions could not be downloaded and Whisper fallback is disabled.');
    }
    return null;
  }

  sendStatus(event, 'Cleaning captions');
  sendProgress(event, {
    stage: 'Cleaning captions',
    mode: 'indeterminate',
    message: 'Cleaning YouTube captions.'
  });
  const rawVtt = await fsp.readFile(vttPath, 'utf8');
  const transcript = cleanVtt(rawVtt);
  if (!transcript.trim()) {
    sendLog(event, '\nNo usable captions found.\n');
    if (!useWhisperFallback) throw friendlyError('The downloaded captions were empty.');
    return null;
  }

  sendStatus(event, 'Saving transcript');
  sendProgress(event, {
    stage: 'Saving transcript',
    mode: 'indeterminate',
    message: 'Saving transcript files and metadata.'
  });
  const transcriptPath = path.join(jobDir, 'transcript.txt');
  const normalizedVttPath = path.join(jobDir, 'transcript.vtt');
  await fsp.writeFile(transcriptPath, transcript, 'utf8');
  if (vttPath !== normalizedVttPath) await fsp.copyFile(vttPath, normalizedVttPath);

  const finished = await finishSuccessfulJob(event, jobDir, {
    sourceType: 'youtube',
    source: url,
    method: 'youtube-captions',
    model,
    language,
    outputBaseDir,
    queueMeta
  });

  return {
    outputBaseDir,
    outputDir: jobDir,
    transcript,
    method: 'youtube-captions',
    cleanupIntermediateMedia: finished.cleanupIntermediateMedia,
    cleanup: finished.cleanup,
    files: {
      txt: transcriptPath,
      vtt: normalizedVttPath,
      srt: null,
      metadata: finished.metadataPath
    }
  };
}

async function runYouTubeWhisperFlow(event, options) {
  const { url, jobDir, sourceType, source, model, language, outputBaseDir, queueMeta } = options;
  sendStatus(event, 'Downloading audio');
  sendProgress(event, {
    stage: 'Downloading audio',
    mode: 'indeterminate',
    message: 'Downloading audio for Whisper transcription.'
  });

  try {
    await runCommand('yt-dlp', [
      '-x',
      '--audio-format',
      'mp3',
      '--output',
      path.join(jobDir, '%(title)s.%(ext)s'),
      url
    ], {
      event,
      label: `yt-dlp -x --audio-format mp3 --output "${path.join(jobDir, '%(title)s.%(ext)s')}" "${url}"`,
      progressStage: 'Downloading audio',
      progressMessage: 'Downloading audio for Whisper transcription.',
      trackAsJob: true
    });
  } catch (error) {
    error.friendlyMessage = 'YouTube audio download failed.';
    throw error;
  }

  const mp3Path = await findNewestFile(jobDir, '.mp3');
  if (!mp3Path) throw friendlyError('YouTube audio download finished, but no MP3 file was found.');

  return runWhisperFlow(event, {
    inputPath: mp3Path,
    jobDir,
    sourceType,
    source,
    model,
    language,
    outputBaseDir,
    queueMeta
  });
}

async function runWhisperFlow(event, options) {
  const { inputPath, jobDir, sourceType, source, model, language, outputBaseDir, queueMeta } = options;
  sendStatus(event, 'Running Whisper');
  sendProgress(event, {
    stage: 'Running Whisper',
    mode: 'indeterminate',
    message: 'This may take a few minutes for longer audio files. First use of a model may take longer because Whisper may download model files.'
  });

  try {
    await runCommand(VENV_PYTHON, [
      '-m',
      'whisper',
      inputPath,
      '--model',
      model,
      '--language',
      language,
      '--task',
      'transcribe',
      '--output_dir',
      jobDir
    ], {
      event,
      label: `"${VENV_PYTHON}" -m whisper "${inputPath}" --model ${model} --language ${language} --task transcribe --output_dir "${jobDir}"`,
      progressStage: 'Downloading Whisper model',
      progressMessage: 'First use of a model may take longer because Whisper may download model files.',
      trackAsJob: true
    });
  } catch (error) {
    error.friendlyMessage = 'Whisper transcription failed.';
    throw error;
  }

  sendStatus(event, 'Saving transcript');
  sendProgress(event, {
    stage: 'Saving transcript',
    mode: 'indeterminate',
    message: 'Saving transcript files and metadata.'
  });
  const txtPath = await findNewestFile(jobDir, '.txt', ['transcript.txt']);
  if (!txtPath) throw friendlyError('Whisper finished, but no transcript text file was found.');

  const transcriptPath = path.join(jobDir, 'transcript.txt');
  if (txtPath !== transcriptPath) await fsp.copyFile(txtPath, transcriptPath);
  const transcript = await fsp.readFile(transcriptPath, 'utf8');

  const generatedVtt = await findNewestFile(jobDir, '.vtt', ['transcript.vtt']);
  const generatedSrt = await findNewestFile(jobDir, '.srt', ['transcript.srt']);
  const vttPath = generatedVtt ? path.join(jobDir, 'transcript.vtt') : null;
  const srtPath = generatedSrt ? path.join(jobDir, 'transcript.srt') : null;

  if (generatedVtt && generatedVtt !== vttPath) await fsp.copyFile(generatedVtt, vttPath);
  if (generatedSrt && generatedSrt !== srtPath) await fsp.copyFile(generatedSrt, srtPath);

  const finished = await finishSuccessfulJob(event, jobDir, {
    sourceType,
    source,
    method: 'whisper',
    model,
    language,
    outputBaseDir,
    queueMeta
  });

  return {
    outputBaseDir,
    outputDir: jobDir,
    transcript,
    method: 'whisper',
    cleanupIntermediateMedia: finished.cleanupIntermediateMedia,
    cleanup: finished.cleanup,
    files: {
      txt: transcriptPath,
      vtt: vttPath,
      srt: srtPath,
      metadata: finished.metadataPath
    }
  };
}

async function findNewestFile(dir, extension, excludeNames = []) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (excludeNames.includes(entry.name)) continue;
    if (path.extname(entry.name).toLowerCase() !== extension) continue;
    const filePath = path.join(dir, entry.name);
    const stat = await fsp.stat(filePath);
    files.push({ filePath, mtimeMs: stat.mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0] ? files[0].filePath : null;
}

async function findIntermediateMediaFiles(outputDir) {
  if (!outputDir) return [];
  let resolvedOutputDir;
  try {
    resolvedOutputDir = await fsp.realpath(outputDir);
    await verifyTranscriptStudioJobFolder(resolvedOutputDir);
  } catch (_error) {
    return [];
  }

  const entries = await fsp.readdir(resolvedOutputDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!INTERMEDIATE_MEDIA_EXTENSIONS.has(extension)) continue;
    const filePath = path.join(resolvedOutputDir, entry.name);
    const resolvedFilePath = await fsp.realpath(filePath);
    if (path.dirname(resolvedFilePath) !== resolvedOutputDir) continue;
    files.push({ filePath: resolvedFilePath, filename: entry.name });
  }

  return files;
}

async function cleanupIntermediateMedia(outputDir, event) {
  await verifyTranscriptStudioJobFolder(outputDir);
  const files = await findIntermediateMediaFiles(outputDir);
  if (files.length === 0) {
    sendLog(event, 'No intermediate media files to clean up.\n');
    return { deleted: [], hasIntermediateMedia: false };
  }

  const deleted = [];
  for (const file of files) {
    await fsp.unlink(file.filePath);
    deleted.push(file.filename);
    sendLog(event, `Deleted intermediate file: ${file.filename}\n`);
  }

  return { deleted, hasIntermediateMedia: false };
}

async function verifyTranscriptStudioJobFolder(outputDir) {
  if (!outputDir) throw new Error('No job output folder was provided.');
  const resolvedOutputDir = await fsp.realpath(outputDir);
  const metadataPath = path.join(resolvedOutputDir, 'metadata.json');
  const metadataRaw = await fsp.readFile(metadataPath, 'utf8');
  const metadata = JSON.parse(metadataRaw);
  if (metadata.appName !== APP_NAME) {
    throw new Error('This is not a Transcript Studio job folder.');
  }
  return resolvedOutputDir;
}

async function assertPathInsideDirectory(filePath, directoryPath) {
  const [resolvedFilePath, resolvedDirectoryPath] = await Promise.all([
    fsp.realpath(filePath),
    fsp.realpath(directoryPath)
  ]);
  const relativePath = path.relative(resolvedDirectoryPath, resolvedFilePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Export source file must be inside the selected job output folder.');
  }
}

async function finishSuccessfulJob(event, outputDir, metadata) {
  const settings = await getSettings();
  const cleanupPreference = typeof metadata.queueMeta?.cleanupIntermediateMedia === 'boolean'
    ? metadata.queueMeta.cleanupIntermediateMedia
    : settings.cleanupIntermediateMedia;
  const metadataPath = await writeMetadata(outputDir, {
    ...metadata,
    cleanupIntermediateMedia: cleanupPreference
  });

  let cleanup = { deleted: [], hasIntermediateMedia: false };
  if (cleanupPreference) {
    cleanup = await cleanupIntermediateMedia(outputDir, event);
  } else {
    const files = await findIntermediateMediaFiles(outputDir);
    cleanup = { deleted: [], hasIntermediateMedia: files.length > 0 };
  }

  return { metadataPath, cleanup, cleanupIntermediateMedia: cleanupPreference };
}

function cleanVtt(content) {
  const seen = new Set();
  const lines = content
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return true;
      if (/^WEBVTT/i.test(line)) return false;
      if (/^(NOTE|STYLE|REGION)(\s|$)/i.test(line)) return false;
      if (/^\d+$/.test(line)) return false;
      if (/-->/.test(line)) return false;
      if (/^(align|position|line|size):/i.test(line)) return false;
      return true;
    })
    .map((line) => line.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

  const cleaned = [];
  for (const line of lines) {
    if (!line) {
      if (cleaned[cleaned.length - 1] !== '') cleaned.push('');
      continue;
    }
    const key = line.toLowerCase();
    if (seen.has(key) && cleaned[cleaned.length - 1] === line) continue;
    seen.add(key);
    cleaned.push(line);
  }

  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

async function writeMetadata(outputDir, data) {
  const metadataPath = path.join(outputDir, 'metadata.json');
  const queueMeta = data.queueMeta || {};
  const metadata = {
    appName: APP_NAME,
    queueJobId: queueMeta.queueJobId || null,
    sourceType: data.sourceType,
    source: data.source,
    method: data.method,
    model: data.model,
    language: data.language,
    createdAt: queueMeta.createdAt || new Date().toISOString(),
    startedAt: queueMeta.startedAt || null,
    finishedAt: new Date().toISOString(),
    outputBaseDir: data.outputBaseDir,
    outputDir,
    cleanupIntermediateMedia: Boolean(data.cleanupIntermediateMedia)
  };
  await fsp.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadataPath;
}
