const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const rootDir = path.resolve(__dirname, '..');
const packagePath = path.join(rootDir, 'package.json');
const distDir = path.join(rootDir, 'dist');
const releaseNotesPath = path.join(distDir, 'release-notes.md');
const releaseInfoPath = path.join(distDir, 'release-info.json');

function main() {
  const packageJson = readPackageJson();
  const dmgInfo = findDmg();
  const npmVersion = getCommandVersion('npm', ['--version']);
  const electronVersion = getPackageVersion(packageJson, 'electron');
  const electronBuilderVersion = getPackageVersion(packageJson, 'electron-builder');
  const buildTimeUtc = new Date().toISOString();
  const runnerInfo = getRunnerInfo();
  const warnings = [];

  if (dmgInfo.warning) warnings.push(dmgInfo.warning);

  const releaseInfo = {
    status: 'passed',
    appName: packageJson.productName || packageJson.build?.productName || packageJson.name,
    packageName: packageJson.name,
    version: packageJson.version,
    nodeVersion: process.version,
    npmVersion,
    electronVersion,
    electronBuilderVersion,
    platform: process.platform,
    arch: process.arch,
    runnerInfo,
    buildTimeUtc,
    dmgName: dmgInfo.name,
    dmgPath: path.relative(rootDir, dmgInfo.filePath),
    dmgSizeMb: dmgInfo.sizeMb,
    warnings
  };

  const releaseNotes = buildReleaseNotes(releaseInfo);
  fs.writeFileSync(releaseNotesPath, releaseNotes, 'utf8');
  fs.writeFileSync(releaseInfoPath, `${JSON.stringify(releaseInfo, null, 2)}\n`, 'utf8');
}

function readPackageJson() {
  try {
    return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (error) {
    fail(`Could not read package.json: ${error.message}`);
  }
}

function findDmg() {
  if (!fs.existsSync(distDir)) {
    fail('dist folder does not exist. Run npm run dist before writing release info.');
  }

  const dmgs = fs.readdirSync(distDir)
    .filter((name) => name.toLowerCase().endsWith('.dmg'))
    .map((name) => {
      const filePath = path.join(distDir, name);
      const stat = fs.statSync(filePath);
      return {
        name,
        filePath,
        mtimeMs: stat.mtimeMs,
        sizeMb: Number((stat.size / 1024 / 1024).toFixed(2))
      };
    });

  if (dmgs.length === 0) {
    fail('No DMG file found in dist. Run npm run dist and try again.');
  }

  dmgs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const selected = dmgs[0];
  if (dmgs.length > 1) {
    selected.warning = `Multiple DMG files were found in dist; selected newest artefact: ${selected.name}`;
  }
  return selected;
}

function getPackageVersion(packageJson, packageName) {
  const version = packageJson.dependencies?.[packageName] || packageJson.devDependencies?.[packageName];
  return version || 'not listed';
}

function getCommandVersion(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) return 'unavailable';
  return (result.stdout || result.stderr || '').trim() || 'unavailable';
}

function getRunnerInfo() {
  const parts = [
    process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : 'local',
    process.env.RUNNER_OS || os.type(),
    process.env.RUNNER_ARCH || os.arch(),
    process.env.GITHUB_RUN_ID ? `run ${process.env.GITHUB_RUN_ID}` : null
  ].filter(Boolean);
  return parts.join(' / ');
}

function buildReleaseNotes(info) {
  const warningBlock = info.warnings.length > 0
    ? `\n## Build warnings\n\n${info.warnings.map((warning) => `- ${warning}`).join('\n')}\n`
    : '';

  return `# Transcript Studio v${info.version}

## Build status

Passed automated release validation.

## Download

Download the macOS DMG attached to this release:

${info.dmgName}

## Product update

Transcript Studio is a lightweight local desktop app for turning local audio/video files and YouTube links into transcripts.

This release includes the current local-first transcription workflow:

- local file transcription
- YouTube link transcription
- captions-first YouTube mode
- Whisper fallback when captions are unavailable
- force Whisper option
- job queue
- per-job output folders
- transcript viewer
- copy transcript button
- save TXT output
- save VTT/SRT when available
- open output folder
- per-job technical logs
- retry failed or cancelled jobs
- optional cleanup of downloaded/intermediate media

## YouTube transcript handling

This release includes fixes for YouTube caption output quality:

- removes repeated adjacent caption lines
- cleans caption metadata
- reflows short subtitle fragments into readable transcript paragraphs
- keeps speaker markers readable where present
${warningBlock}
## Build details

- App version: ${info.version}
- App name: ${info.appName}
- Node: ${info.nodeVersion}
- npm: ${info.npmVersion}
- Electron: ${info.electronVersion}
- electron-builder: ${info.electronBuilderVersion}
- Build time: ${info.buildTimeUtc}
- Runner: ${info.runnerInfo}
- DMG: ${info.dmgName}
- DMG size: ${info.dmgSizeMb} MB

## macOS note

Transcript Studio is currently unsigned and not Apple-notarised. macOS may warn that the developer cannot be verified. For early testing, users can right-click or control-click the app and choose Open.

## Known limitations

- Mac-focused at this stage
- no in-app auto-update yet
- first launch may need local setup tools
- Whisper models can take time to download and run
- medium and large models may be slow on CPU
- YouTube transcription depends on yt-dlp and caption availability
- transcripts should be checked before publication or serious use
`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
