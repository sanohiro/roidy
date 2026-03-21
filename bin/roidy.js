#!/usr/bin/env node
// roidy - Run a real Android device inside your terminal
// Redroid + adb + Kitty Graphics Protocol

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --version / -v
if (process.argv[2] === '--version' || process.argv[2] === '-v') {
  const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
  console.log(`roidy ${pkg.version}`);
  process.exit(0);
}

// --help / -h
if (process.argv[2] === '--help' || process.argv[2] === '-h') {
  console.log(`roidy - Terminal-based adb frontend

Usage: roidy [options]
       roidy start <app> [options]
       roidy setup [options]

Commands:
  start <app>      Launch an app and connect (e.g. roidy start kindle)
  list             List installed apps
  search <query>   Search F-Droid for apps
  install <pkg>    Install app from F-Droid or local APK
  update           Update all apps via F-Droid
  uninstall <pkg>  Uninstall an app (alias: remove)
  info             Show device info
  screenshot [f]   Save screenshot to file (alias: ss)
  restart          Restart system UI (zygote)
  setup            Set up Android environment

Options:
  --help, -h           Show this help
  --version, -v        Show version
  --host <host>        adb host (default: localhost)
  --port <port>        adb port (default: 5555)
  --interval <ms>      Screenshot interval in ms (default: 1000)

Setup options:
  -t, --timezone <tz>  Timezone (e.g. Asia/Tokyo)
  -l, --locale <loc>   Locale (e.g. ja-JP)
  --clock <24|12>      Clock format
  --screen-timeout <s> Screen timeout in seconds (0 = never)
  --screen-lock <on|off> Screen lock
  --launcher <name>    Launcher (e.g. kiss)
  --app-store          Install F-Droid
  --no-install         Skip all app installation prompts

Key bindings (default):
  Ctrl+Q           Quit
  Escape           Android Back
  Mouse click      Android tap
  Mouse drag       Android swipe
  Scroll           Android scroll
  Arrow keys       Android D-pad
  Text input       Android text input

Config: ~/.roidy/config.json
Keys:   ~/.roidy/keys.json

https://github.com/sanohiro/roidy`);
  process.exit(0);
}

// list subcommand
if (process.argv[2] === 'list') {
  const { listApps } = await import('../lib/apps.js');
  const apps = listApps();
  console.log('Installed apps:');
  for (const app of apps) {
    const alias = app.alias ? ` (${app.alias})` : '';
    console.log(`  ${app.pkg}${alias}`);
  }
  process.exit(0);
}

// info subcommand
if (process.argv[2] === 'info') {
  const { execSync } = await import('node:child_process');
  const prop = (k) => {
    try { return execSync(`adb shell getprop ${k}`, { encoding: 'utf8', timeout: 5000 }).trim(); }
    catch { return '?'; }
  };
  const sh = (cmd) => {
    try { return execSync(`adb shell "${cmd}"`, { encoding: 'utf8', timeout: 5000 }).trim(); }
    catch { return '?'; }
  };
  console.log(`Android:    ${prop('ro.build.version.release')} (API ${prop('ro.build.version.sdk')})`);
  console.log(`Build:      ${prop('ro.build.display.id')}`);
  console.log(`ABI:        ${prop('ro.product.cpu.abi')}`);
  console.log(`Locale:     ${prop('persist.sys.locale') || prop('ro.product.locale')}`);
  console.log(`Timezone:   ${prop('persist.sys.timezone')}`);
  console.log(`Screen:     ${sh('wm size').replace('Physical size: ', '')}`);
  console.log(`Density:    ${sh('wm density').replace('Physical density: ', '')}`);
  process.exit(0);
}

// restart subcommand
if (process.argv[2] === 'restart') {
  const { execSync } = await import('node:child_process');
  console.log('Restarting system UI...');
  execSync('adb shell "su 0 setprop ctl.restart zygote"', { encoding: 'utf8', timeout: 5000 });
  for (let i = 0; i < 30; i++) {
    try {
      const result = execSync('adb shell getprop sys.boot_completed', { encoding: 'utf8', timeout: 5000 }).trim();
      if (result === '1') break;
    } catch {}
    execSync('sleep 2');
  }
  console.log('Restarted.');
  process.exit(0);
}

// screenshot subcommand
if (process.argv[2] === 'screenshot' || process.argv[2] === 'ss') {
  const { execSync } = await import('node:child_process');
  const dest = process.argv[3] || `screenshot-${Date.now()}.png`;
  const data = execSync('adb shell screencap -p', { maxBuffer: 50 * 1024 * 1024, timeout: 10000 });
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const start = data.indexOf(pngSig);
  if (start < 0) { console.error('Failed to capture screenshot'); process.exit(1); }
  (await import('node:fs')).writeFileSync(dest, data.subarray(start));
  console.log(`Saved: ${dest}`);
  process.exit(0);
}

// search subcommand
if (process.argv[2] === 'search') {
  const query = process.argv.slice(3).join(' ');
  if (!query) { console.error('Usage: roidy search <query>'); process.exit(1); }
  const { search } = await import('../lib/fdroid.js');
  const results = await search(query);
  if (results.length === 0) { console.log('No results found.'); process.exit(0); }
  for (const app of results.slice(0, 15)) {
    console.log(`  ${app.pkg}`);
    console.log(`    ${app.name} — ${app.summary}`);
  }
  process.exit(0);
}

// install subcommand
if (process.argv[2] === 'install') {
  const target = process.argv[3];
  if (!target) { console.error('Usage: roidy install <package|apk>'); process.exit(1); }
  if (target.endsWith('.apk')) {
    // Local APK
    const { execSync } = await import('node:child_process');
    const result = execSync(`adb install "${target}"`, { encoding: 'utf8', timeout: 60000 }).trim();
    console.log(result);
  } else {
    const { install } = await import('../lib/fdroid.js');
    await install(target);
  }
  process.exit(0);
}

// uninstall subcommand
if (process.argv[2] === 'uninstall' || process.argv[2] === 'remove') {
  const pkg = process.argv[3];
  if (!pkg) { console.error('Usage: roidy uninstall <package>'); process.exit(1); }
  const { resolveApp } = await import('../lib/apps.js');
  const result = resolveApp(pkg);
  const target = result.error ? pkg : result.pkg;
  const { execSync } = await import('node:child_process');
  try {
    const out = execSync(`adb uninstall "${target}"`, { encoding: 'utf8', timeout: 30000 }).trim();
    console.log(out);
  } catch (err) {
    console.error(`Failed to uninstall ${target}: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// update subcommand
if (process.argv[2] === 'update') {
  const { checkUpdates, install } = await import('../lib/fdroid.js');
  console.log('Checking for updates...');
  const updates = await checkUpdates();
  if (updates.length === 0) {
    console.log('All apps are up to date.');
    process.exit(0);
  }
  console.log(`\n${updates.length} update(s) available:`);
  for (const u of updates) {
    console.log(`  ${u.pkg}: ${u.installed} → ${u.latest}`);
  }
  console.log('');
  for (const u of updates) {
    try {
      await install(u.pkg);
    } catch (err) {
      console.error(`  ${u.pkg}: update failed — ${err.message}`);
    }
  }
  process.exit(0);
}

// start subcommand
let _startApp = null;
let _useVirtualDisplay = false;
if (process.argv[2] === 'start') {
  const appName = process.argv[3];
  if (!appName) {
    console.error('Usage: roidy start <app>  (use "roidy list" to see installed apps)');
    process.exit(1);
  }
  const { resolveApp } = await import('../lib/apps.js');
  let result = resolveApp(appName);
  if (result.candidates) {
    console.error(`Multiple matches for "${appName}":`);
    result.candidates.forEach((c, i) => {
      console.error(`  ${i + 1}) ${c.pkg}`);
    });
    process.exit(1);
  }
  if (result.error) {
    console.error(`roidy: ${result.error}`);
    process.exit(1);
  }
  _startApp = result;

  // Check if same app is already running in another roidy instance
  if (_startApp) {
    const { checkAlreadyRunning } = await import('../lib/adb.js');
    const existingPid = checkAlreadyRunning(_startApp.activity);
    if (existingPid) {
      console.error(`roidy: ${_startApp.pkg} is already running (pid ${existingPid})`);
      process.exit(1);
    }
  }

  // Check for --display 0 flag (fallback to main display)
  const argv = process.argv.slice(2);
  const dispIdx = argv.indexOf('--display');
  if (dispIdx >= 0 && argv[dispIdx + 1] === '0') {
    _useVirtualDisplay = false;
  } else {
    _useVirtualDisplay = true;
  }

  // Remove start subcommand args from argv
  process.argv.splice(2, 2);
  const di = process.argv.indexOf('--display');
  if (di >= 0) process.argv.splice(di, 2);
}

// setup subcommand
if (process.argv[2] === 'setup') {
  const { loadConfig } = await import('../lib/config.js');
  const { runSetup } = await import('../lib/setup.js');
  const config = loadConfig();
  const argv = process.argv.slice(3);
  let host = config.host, port = config.port;
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--host' && argv[i + 1]) host = argv[++i];
    else if (argv[i] === '--port' && argv[i + 1]) port = parseInt(argv[++i]);
    else if (argv[i] === '--timezone' || argv[i] === '-t') { if (argv[i + 1]) opts.timezone = argv[++i]; }
    else if (argv[i] === '--locale' || argv[i] === '-l') { if (argv[i + 1]) opts.locale = argv[++i]; }
    else if (argv[i] === '--launcher' && argv[i + 1]) opts.launcher = argv[++i];
    else if (argv[i] === '--clock' && argv[i + 1]) opts.clock = argv[++i];
    else if (argv[i] === '--screen-timeout' && argv[i + 1]) opts.screenTimeout = argv[++i];
    else if (argv[i] === '--screen-lock' && argv[i + 1]) opts.screenLock = argv[++i];
    else if (argv[i] === '--app-store') opts.appStore = true;
    else if (argv[i] === '--no-install') opts.noInstall = true;
  }
  await runSetup(host, port, opts);
  process.exit(0);
}

import * as adb from '../lib/adb.js';
import { sendFrame, resetFrameCache, clearScreen, hideCursor, showCursor, cleanup as cleanupTmp, transport, setDisplaySize, disableDedup } from '../lib/kitty.js';
import { enableMouse, disableMouse, startInputHandling } from '../lib/input.js';
import { loadKeyBindings } from '../lib/keys.js';
import { loadConfig } from '../lib/config.js';

const config = loadConfig();
const bindings = loadKeyBindings();

// Parse CLI arguments
function parseArgs() {
  const args = { host: config.host, port: config.port, interval: config.interval };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--host' && argv[i + 1]) { args.host = argv[++i]; }
    else if (argv[i] === '--port' && argv[i + 1]) { args.port = parseInt(argv[++i]); }
    else if (argv[i] === '--interval' && argv[i + 1]) { args.interval = parseInt(argv[++i]); }
  }
  return args;
}

const TERM_QUERY_TIMEOUT = 1000;

// Query terminal pixel size via CSI 14t
function queryTermPixelSize({ keepAlive = false } = {}) {
  if (!process.stdin.isTTY) return Promise.resolve(null);

  let resolve;
  const promise = new Promise(r => { resolve = r; });
  const wasRaw = process.stdin.isRaw;
  const timeout = setTimeout(() => {
    process.stdin.removeListener('data', onData);
    if (!keepAlive) {
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
    }
    resolve(null);
  }, TERM_QUERY_TIMEOUT);

  if (!keepAlive) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  let buf = '';
  const onData = (data) => {
    buf += data.toString();
    const match = buf.match(/\x1b\[4;(\d+);(\d+)t/);
    if (match) {
      clearTimeout(timeout);
      process.stdin.removeListener('data', onData);
      if (!keepAlive) process.stdin.setRawMode(wasRaw);
      resolve({ height: parseInt(match[1]), width: parseInt(match[2]) });
    }
  };
  process.stdin.on('data', onData);

  process.stdout.write('\x1b[14t');
  return promise;
}

// Get terminal info
async function getTermInfo({ keepAlive = false } = {}) {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const pixelSize = await queryTermPixelSize({ keepAlive });
  if (pixelSize) {
    const cellWidth = Math.floor(pixelSize.width / cols);
    const cellHeight = Math.floor(pixelSize.height / rows);
    const width = cellWidth * cols;
    const height = cellHeight * rows;
    return { cols, rows, width, height, cellWidth, cellHeight };
  }

  // Fallback
  const cellWidth = 10;
  const cellHeight = 20;
  return {
    cols, rows,
    width: cols * cellWidth,
    height: rows * cellHeight,
    cellWidth, cellHeight,
  };
}

async function main() {
  const args = parseArgs();

  // Get terminal info first (prevent CSI 14t response leak)
  const term = await getTermInfo();

  // Connect to Redroid
  console.error(`roidy: connecting to ${args.host}:${args.port}...`);
  const deviceId = await adb.connect(args.host, args.port);
  console.error(`roidy: connected (${deviceId})`);

  // Virtual display for app mode
  if (_startApp && _useVirtualDisplay) {
    const displayId = await adb.createVirtualDisplay(term.width, term.height, 320);
    adb.setDisplayId(displayId);
    console.error(`roidy: virtual display ${displayId} (${term.width}x${term.height})`);
    await adb.launchOnDisplay(_startApp.activity, displayId);
    console.error(`roidy: launched ${_startApp.pkg} on display ${displayId}`);
  } else {
    // Mirror mode — set Android screen size to match terminal
    await adb.setScreenSize(term.width, term.height);
    if (_startApp) {
      const { launchApp } = await import('../lib/apps.js');
      launchApp(_startApp.activity);
      console.error(`roidy: launched ${_startApp.pkg} on display 0`);
    }
  }
  console.error(`roidy: screen ${term.width}x${term.height} cell=${term.cellWidth}x${term.cellHeight} transport=${transport}`);

  setDisplaySize(term.cols, term.rows);
  hideCursor();
  clearScreen();
  enableMouse();

  // Handle SIGUSR1: another roidy instance changed virtual displays
  process.on('SIGUSR1', async () => {
    const oldId = adb.getDisplayId();
    // Wait a bit for displays to be recreated
    await new Promise(r => setTimeout(r, 1000));
    await adb.refreshDisplayId();
    const newId = adb.getDisplayId();
    if (oldId !== newId) {
      console.error(`roidy: display changed ${oldId} → ${newId}`);
      resetFrameCache();
    }
  });

  // Poll for screenshots
  let polling = true;
  let capturing = false;

  async function capture() {
    if (!polling || capturing) return;
    capturing = true;
    try {
      const data = await adb.screencap();
      if (data) sendFrame(data);
    } catch (err) {
      console.error('roidy: screencap error:', err.message);
    }
    capturing = false;
  }

  // Initial capture
  await capture();

  // Start polling
  let pollTimer = setInterval(capture, args.interval);

  // Burst mode: after input, capture rapidly for a short period then resume normal polling
  const BURST_INTERVAL = 150;
  const BURST_DURATION = 1500;
  let burstTimer = null;
  let burstEnd = 0;

  function forceCapture() {
    capture();

    // Enter burst mode
    const now = Date.now();
    if (now < burstEnd) return; // already in burst mode
    burstEnd = now + BURST_DURATION;

    // Switch to fast polling
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (Date.now() >= burstEnd) {
        // Return to normal polling
        clearInterval(pollTimer);
        pollTimer = setInterval(capture, args.interval);
        burstEnd = 0;
      }
      capture();
    }, BURST_INTERVAL);
  }

  // Start input handling
  const inputHandler = startInputHandling(
    bindings, term.width, term.height, term.cellWidth, term.cellHeight, forceCapture
  );

  // Shutdown
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error('roidy: shutting down...');
    polling = false;
    clearInterval(pollTimer);
    if (_useVirtualDisplay && adb.getDisplayId() != null) {
      try { await adb.removeVirtualDisplay(); } catch {}
    }
    adb.disconnect();
    disableMouse();
    showCursor();
    try { process.stdin.setRawMode(false); } catch {}
    clearScreen();
    cleanupTmp();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  // SIGWINCH: follow terminal resize
  let resizeTimer = null;
  process.on('SIGWINCH', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(handleResize, 150);
  });

  async function handleResize() {
    try {
      const t = await getTermInfo({ keepAlive: true });
      setDisplaySize(t.cols, t.rows);
      clearScreen();
      resetFrameCache();
      disableDedup(3000);

      // Update Android screen size
      await adb.setScreenSize(t.width, t.height);
      inputHandler.updateSize(t.cellWidth, t.cellHeight, t.width, t.height);

      console.error(`roidy: resize ${t.width}x${t.height}`);

      // Capture immediately after resize
      await capture();
    } catch (err) {
      console.error('roidy: resize error:', err.message);
    }
  }
}

try {
  await main();
} catch (err) {
  try { process.stdin.setRawMode(false); process.stdin.pause(); } catch {}
  console.error('roidy: error:', err.message);
  if (_useVirtualDisplay) { try { await adb.removeVirtualDisplay(); } catch {} }
  disableMouse();
  showCursor();
  cleanupTmp();
  process.exit(1);
}
