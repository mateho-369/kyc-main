const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

// Keep emulator state beside the KYC checkout, not inside it. This lets multiple
// checkouts use the same local Firebase accounts and makes the data easy to back up.
const dataDir = path.resolve(__dirname, '..', '..', 'firebase-data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`Created Firebase Emulator data directory: ${dataDir}`);
} else {
  console.log(`Using existing Firebase Emulator data directory: ${dataDir}`);
}

const projectDir = path.resolve(__dirname, '..');

const isPortOpen = (port) => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port });
  const finish = (open) => {
    socket.destroy();
    resolve(open);
  };
  socket.setTimeout(300, () => finish(false));
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
});

// Older runs and the Emulator UI's manual export create default-named exports
// in the project root. Preserve (do not delete) them under the external data dir
// after this suite exits so future exports stay grouped outside the checkout.
const archiveLegacyExports = async () => {
  if (await isPortOpen(4400)) {
    console.warn('Another emulator suite is still running; leaving legacy exports untouched.');
    return;
  }

  const legacyItems = fs.readdirSync(projectDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && (entry.name === '.firebase-data' || entry.name.startsWith('firebase-export-')));
  if (!legacyItems.length) return;

  const archiveDir = path.join(dataDir, 'legacy-project-exports');
  fs.mkdirSync(archiveDir, { recursive: true });
  for (const entry of legacyItems) {
    const source = path.join(projectDir, entry.name);
    let destination = path.join(archiveDir, entry.name);
    if (fs.existsSync(destination)) destination = path.join(archiveDir, `${entry.name}-${Date.now()}`);
    fs.renameSync(source, destination);
    console.log(`Moved old emulator export into firebase-data: ${entry.name}`);
  }
};

const args = [
  'emulators:start',
  '--config', 'firebase.emulator.json',
  '--project', 'demo-kyc-local',
  `--import=${dataDir}`,
  `--export-on-exit=${dataDir}`
];
// npm adds the local firebase-tools executable to PATH. shell is needed on Windows
// to execute its firebase.cmd shim; arguments are passed separately to preserve spaces.
const child = spawn('firebase', args, {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
child.on('error', error => {
  console.error('Could not start Firebase Emulator. Ensure firebase-tools is installed.', error.message);
  process.exitCode = 1;
});
child.on('exit', async (code, signal) => {
  try {
    await archiveLegacyExports();
  } catch (error) {
    console.error('Could not archive legacy emulator exports:', error.message);
  }
  process.exitCode = signal ? 1 : (code ?? 1);
});
