const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Keep emulator state beside the KYC checkout, not inside it. This lets multiple
// checkouts use the same local Firebase accounts and makes the data easy to back up.
const dataDir = path.resolve(__dirname, '..', '..', 'firebase-data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`Created Firebase Emulator data directory: ${dataDir}`);
} else {
  console.log(`Using existing Firebase Emulator data directory: ${dataDir}`);
}

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
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
