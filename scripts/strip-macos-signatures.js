const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MACHO_MAGICS = new Set([
  0xfeedface,
  0xcefaedfe,
  0xfeedfacf,
  0xcffaedfe,
  0xcafebabe,
  0xbebafeca,
  0xcafebabf,
  0xbfbafeca
]);

exports.default = async function stripMacosSignatures(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appOutDir = context.appOutDir;
  const targets = [];

  walk(appOutDir, (filePath, stat) => {
    const basename = path.basename(filePath);
    if (basename === '_CodeSignature') {
      fs.rmSync(filePath, { recursive: true, force: true });
      return 'skip';
    }

    if (basename === 'CodeResources' || basename.endsWith('.provisionprofile')) {
      fs.rmSync(filePath, { force: true });
      return;
    }

    if (stat.isDirectory() && basename.endsWith('.app')) {
      targets.push(filePath);
      return;
    }

    if (stat.isFile() && isMachO(filePath)) {
      targets.push(filePath);
    }
  });

  for (const target of targets.reverse()) {
    removeSignature(target);
  }
}

function walk(root, visitor) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    let stat;
    try {
      stat = fs.lstatSync(filePath);
    } catch {
      continue;
    }

    const result = visitor(filePath, stat);
    if (result === 'skip') continue;
    if (stat.isDirectory() && !stat.isSymbolicLink()) walk(filePath, visitor);
  }
}

function isMachO(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4);
    if (fs.readSync(fd, buffer, 0, 4, 0) !== 4) return false;
    return MACHO_MAGICS.has(buffer.readUInt32BE(0));
  } finally {
    fs.closeSync(fd);
  }
}

function removeSignature(target) {
  const result = spawnSync('/usr/bin/codesign', ['--remove-signature', target], {
    encoding: 'utf8'
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status === 0 || output.includes('code object is not signed at all')) return;

  throw new Error(`Could not remove code signature from ${target}:\n${output}`);
}
