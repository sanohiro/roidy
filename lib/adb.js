// adb connection and operations
// Uses @devicefarmer/adbkit for TCP connection to Android devices

import AdbKit from '@devicefarmer/adbkit';
const Adb = AdbKit.default || AdbKit;

let _client = null;
let _device = null;
let _deviceId = null;
let _displayId = null;
let _taskId = null;

// Display ID prefix for input/screencap commands
// When set, routes all input and capture to a specific virtual display
function displayArg() {
  return _displayId != null ? `-d ${_displayId} ` : '';
}

// --- Connection ---

// Connect to Android device via TCP
export async function connect(host, port) {
  _client = Adb.createClient();
  _deviceId = `${host}:${port}`;

  await _client.connect(host, port);

  const devices = await _client.listDevices();
  const found = devices.find(d => d.id === _deviceId);
  if (!found) throw new Error(`device ${_deviceId} not found`);

  _device = _client.getDevice(_deviceId);
  return _deviceId;
}

export function disconnect() {
  if (_client) {
    _client.disconnect(_deviceId).catch(() => {});
    _device = null;
  }
}

// --- Shell ---

// Run shell command (returns Buffer)
async function shellRaw(command) {
  const stream = await _device.shell(command);
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// Run shell command (returns trimmed string)
async function shell(command) {
  const buf = await shellRaw(command);
  return buf.toString().trim();
}

// --- Screen ---

export async function getScreenSize() {
  const output = await shell('wm size');
  const m = output.match(/(\d+)x(\d+)/);
  if (!m) throw new Error(`failed to get screen size: ${output}`);
  return { width: parseInt(m[1]), height: parseInt(m[2]) };
}

export async function setScreenSize(width, height) {
  await shell(`wm size ${width}x${height}`);
}

// Take screenshot (returns PNG as base64)
// Uses -d flag to capture from a specific display when in virtual display mode
export async function screencap() {
  const buf = await shellRaw(`screencap ${displayArg()}-p`);
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const start = buf.indexOf(pngSig);
  if (start < 0) return null;
  const png = buf.subarray(start);
  return png.toString('base64');
}

// --- Input ---
// All input commands use displayArg() to route to the correct virtual display.
// Android's `input -d N` sends events to a specific display regardless of focus,
// so multiple roidy instances can operate independently.

export async function tap(x, y) {
  await shell(`input ${displayArg()}tap ${Math.round(x)} ${Math.round(y)}`);
}

export async function swipe(x1, y1, x2, y2, durationMs = 300) {
  await shell(`input ${displayArg()}swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${durationMs}`);
}

// https://developer.android.com/reference/android/view/KeyEvent
export async function keyevent(code) {
  await shell(`input ${displayArg()}keyevent ${code}`);
}

export async function inputText(text) {
  const escaped = text.replace(/'/g, "'\\''");
  await shell(`input ${displayArg()}text '${escaped}'`);
}

// --- Display ID management ---

export function setDisplayId(id) { _displayId = id; }
export function getDisplayId() { return _displayId; }

// --- Virtual display management ---
//
// Each `roidy start <app>` creates a virtual display via Android's
// overlay_display_devices setting. This allows multiple roidy instances
// to show different apps independently.
//
// Key challenge: overlay_display_devices is a single semicolon-separated
// string. When a new entry is added, Android destroys ALL existing virtual
// displays and recreates them with new IDs. This means:
//
//   1. Display IDs are not stable — they change whenever any instance
//      adds or removes a virtual display.
//   2. Apps on destroyed displays lose their surface — they need to be
//      re-launched on the new display ID.
//
// Solution: ~/.roidy/displays.json tracks all running instances with their
// PID, overlay index, and activity. When a new instance modifies overlays:
//   - It sends SIGUSR1 to all other roidy processes
//   - Each process re-queries its display ID by overlay index
//   - Each process re-launches its app on the new display
//
// Stale entries (dead PIDs) are cleaned up automatically on next startup.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DISPLAYS_FILE = join(homedir(), '.roidy', 'displays.json');
let _overlayIndex = -1;
let _currentActivity = null;

function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function readDisplaysState() {
  try { return JSON.parse(readFileSync(DISPLAYS_FILE, 'utf8')); }
  catch { return { entries: [] }; }
}

function writeDisplaysState(state) {
  const dir = join(homedir(), '.roidy');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(DISPLAYS_FILE, JSON.stringify(state));
}

// Check if an app is already running in another roidy instance
export function checkAlreadyRunning(activity) {
  const pkg = activity.split('/')[0];
  const state = readDisplaysState();
  const alive = state.entries.filter(e => isAlive(e.pid));
  const found = alive.find(e => e.activity && e.activity.startsWith(pkg));
  if (found) return found.pid;
  return null;
}

// Create virtual display, returns display ID
export async function createVirtualDisplay(width, height, density) {
  const spec = `${width}x${height}/${density}`;

  const state = readDisplaysState();
  state.entries = state.entries.filter(e => isAlive(e.pid));
  _overlayIndex = state.entries.length;
  state.entries.push({ pid: process.pid, spec, index: _overlayIndex, activity: _currentActivity });

  // Rebuild the overlay string from all entries and apply.
  // This destroys and recreates ALL virtual displays with new IDs.
  const overlayStr = state.entries.map(e => e.spec).join(';');
  await shell(`su 0 settings put global overlay_display_devices '${overlayStr}'`);
  writeDisplaysState(state);

  // Notify other instances so they can re-acquire their display IDs
  for (const entry of state.entries) {
    if (entry.pid !== process.pid) {
      try { process.kill(entry.pid, 'SIGUSR1'); } catch {}
    }
  }

  const displayId = await waitForDisplayByIndex(_overlayIndex);
  return displayId;
}

async function waitForDisplayByIndex(index) {
  for (let i = 0; i < 30; i++) {
    const ids = await getVirtualDisplayIds();
    if (ids.length > index) return ids[index];
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Failed to create virtual display');
}

// Called on SIGUSR1 when another instance changed the overlay config.
// Re-acquires our display ID by overlay index and re-launches the app,
// because the old display was destroyed and a new one was created.
export async function refreshDisplayId() {
  if (_overlayIndex < 0) return;
  const ids = await getVirtualDisplayIds();
  if (ids.length > _overlayIndex) {
    const newId = ids[_overlayIndex];
    _displayId = newId;
    // App must be re-launched because the old display surface is gone
    if (_currentActivity) {
      await shell(`am start --display ${newId} -n ${_currentActivity}`);
    }
  }
}

// Remove our virtual display and notify remaining instances
export async function removeVirtualDisplay() {
  const state = readDisplaysState();
  state.entries = state.entries.filter(e => e.pid !== process.pid);

  if (state.entries.length === 0) {
    await shell('su 0 settings put global overlay_display_devices null');
  } else {
    const overlayStr = state.entries.map(e => e.spec).join(';');
    await shell(`su 0 settings put global overlay_display_devices '${overlayStr}'`);
  }
  writeDisplaysState(state);

  // Remaining instances need to re-acquire their display IDs
  for (const entry of state.entries) {
    try { process.kill(entry.pid, 'SIGUSR1'); } catch {}
  }
  _overlayIndex = -1;
}

async function getVirtualDisplayIds() {
  const output = await shell('dumpsys display');
  const ids = [];
  for (const m of output.matchAll(/Display Id=(\d+)/g)) {
    const id = parseInt(m[1]);
    if (id !== 0) ids.push(id);
  }
  return [...new Set(ids)];
}

// --- App launch ---

export function setCurrentActivity(activity) {
  _currentActivity = activity;
}

// Launch app on a specific display
export async function launchOnDisplay(activity, displayId) {
  _currentActivity = activity;
  const pkg = activity.split('/')[0];
  const taskId = await findTaskId(pkg);
  if (taskId != null) {
    // Move existing task to target display if possible
    await shell(`am display move-stack ${taskId} ${displayId}`).catch(() => {});
  }
  await shell(`am start --display ${displayId} -n ${activity}`);
  await updateTaskId(displayId);
}

async function findTaskId(pkg) {
  const output = await shell('am stack list');
  for (const line of output.split('\n')) {
    if (line.includes(pkg)) {
      const m = line.match(/taskId=(\d+)/);
      if (m) return parseInt(m[1]);
    }
  }
  return null;
}

async function updateTaskId(displayId) {
  const output = await shell('am stack list');
  for (const line of output.split('\n')) {
    const m = line.match(/RootTask id=(\d+).*displayId=(\d+)/);
    if (m && parseInt(m[2]) === displayId) {
      _taskId = parseInt(m[1]);
      return;
    }
  }
}

// Focus this display's task (used for input routing on older Android)
export async function ensureFocus() {
  if (_taskId == null || _displayId == null) return;
  try { await shell(`am task focus ${_taskId}`); } catch {}
}

// --- Android key codes ---

export const KEYCODE = {
  BACK: 4,
  HOME: 3,
  MENU: 82,
  ENTER: 66,
  DEL: 67,
  FORWARD_DEL: 112,
  TAB: 61,
  SPACE: 62,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  PAGE_UP: 92,
  PAGE_DOWN: 93,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  ESCAPE: 111,
};
