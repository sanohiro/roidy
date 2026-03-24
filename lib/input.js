// Input event handling
// Receives keyboard/mouse events via stdin raw mode and forwards them to Android via adb

import { toKeyName } from './keys.js';
import * as adb from './adb.js';

// SGR 1006 mouse button codes
const MOUSE_BTN_LEFT    = 0;
const MOUSE_BTN_DRAG    = 32;
const MOUSE_SCROLL_UP   = 64;
const MOUSE_SCROLL_DOWN = 65;

// Scroll swipe distance (Android pixels)
const SCROLL_SWIPE_PX = 300;

// Enable mouse events (SGR 1006 format)
// 1002 = button-event tracking
export function enableMouse() {
  process.stdout.write('\x1b[?1000;1002;1006h');
}

// Disable mouse events
export function disableMouse() {
  process.stdout.write('\x1b[?1000;1002;1006l');
}

// Convert terminal cell coordinates to Android pixel coordinates
function cellToPixel(col, row, cellWidth, cellHeight) {
  return {
    x: (col - 1) * cellWidth,
    y: (row - 1) * cellHeight,
  };
}

// Escape sequence to key info mapping
const SPECIAL_KEYS = {
  '\x1b[A':  { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
  '\x1b[B':  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
  '\x1b[C':  { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  '\x1b[D':  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
  '\x1b[H':  { key: 'Home',       code: 'Home',       keyCode: 36 },
  '\x1b[F':  { key: 'End',        code: 'End',        keyCode: 35 },
  '\x1b[5~': { key: 'PageUp',     code: 'PageUp',     keyCode: 33 },
  '\x1b[6~': { key: 'PageDown',   code: 'PageDown',   keyCode: 34 },
  '\x1b[3~': { key: 'Delete',     code: 'Delete',     keyCode: 46 },
  '\x7f':    { key: 'Backspace',  code: 'Backspace',  keyCode: 8 },
  '\x08':    { key: 'Backspace',  code: 'Backspace',  keyCode: 8 },
  '\r':      { key: 'Enter',      code: 'Enter',      keyCode: 13 },
  '\n':      { key: 'Enter',      code: 'Enter',      keyCode: 13 },
  '\t':      { key: 'Tab',        code: 'Tab',        keyCode: 9 },
  '\x1b':    { key: 'Escape',     code: 'Escape',     keyCode: 27 },
  ' ':       { key: ' ',          code: 'Space',      keyCode: 32 },
};

// Ctrl+Key (0x01-0x1A)
const CTRL_KEYS = {};
const CTRL_EXCLUDE = new Set([8, 9, 13]); // BS, Tab, Enter
for (let i = 0; i < 26; i++) {
  if (CTRL_EXCLUDE.has(i + 1)) continue;
  const char = String.fromCharCode(i + 1);
  const letter = String.fromCharCode(i + 97);
  CTRL_KEYS[char] = {
    key: letter,
    code: `Key${letter.toUpperCase()}`,
    keyCode: letter.toUpperCase().charCodeAt(0),
    modifiers: 2, // ctrl
  };
}

// Key info to Android keycode mapping
const KEY_TO_ANDROID = {
  'ArrowUp':    adb.KEYCODE.DPAD_UP,
  'ArrowDown':  adb.KEYCODE.DPAD_DOWN,
  'ArrowLeft':  adb.KEYCODE.DPAD_LEFT,
  'ArrowRight': adb.KEYCODE.DPAD_RIGHT,
  'Enter':      adb.KEYCODE.ENTER,
  'Backspace':  adb.KEYCODE.DEL,
  'Delete':     adb.KEYCODE.FORWARD_DEL,
  'Tab':        adb.KEYCODE.TAB,
  'Home':       adb.KEYCODE.HOME,
  'PageUp':     adb.KEYCODE.PAGE_UP,
  'PageDown':   adb.KEYCODE.PAGE_DOWN,
  ' ':          adb.KEYCODE.SPACE,
};

function modifierBits({ alt = false, ctrl = false, meta = false, shift = false } = {}) {
  return (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
}

// Modified escape sequence parsing
const RE_MOD_ARROW = /^\x1b\[1;(\d+)([A-H])$/;
const MOD_SUFFIX = {
  'A': { key: 'ArrowUp',    keyCode: 38 },
  'B': { key: 'ArrowDown',  keyCode: 40 },
  'C': { key: 'ArrowRight', keyCode: 39 },
  'D': { key: 'ArrowLeft',  keyCode: 37 },
  'H': { key: 'Home',       keyCode: 36 },
  'F': { key: 'End',        keyCode: 35 },
};

function modBitsFromParam(p) {
  const n = p - 1;
  return modifierBits({ shift: !!(n & 1), alt: !!(n & 2), ctrl: !!(n & 4) });
}

// Parse input string into key info
function parseInput(str) {
  const special = SPECIAL_KEYS[str];
  if (special) return { ...special, modifiers: 0 };

  if (str.length === 1 && CTRL_KEYS[str]) return CTRL_KEYS[str];

  let m = str.match(RE_MOD_ARROW);
  if (m) {
    const info = MOD_SUFFIX[m[2]];
    if (info) return { ...info, modifiers: modBitsFromParam(parseInt(m[1], 10)) };
  }

  // Alt+char: ESC + single char
  if (str.length === 2 && str[0] === '\x1b' && str[1] !== '[' && str[1] !== 'O') {
    const ch = str[1];
    return {
      key: ch,
      code: `Key${ch.toUpperCase()}`,
      keyCode: ch.toUpperCase().charCodeAt(0),
      modifiers: modifierBits({ alt: true }),
    };
  }

  // Normal characters
  if (!str.startsWith('\x1b') && str.length >= 1) return 'text';

  return undefined;
}

// Main input handling
export function startInputHandling(bindings, screenWidth, screenHeight, cellWidth, cellHeight, forceCapture, getImageOffset) {
  process.stdin.setRawMode(true);
  process.stdin.resume();

  let _cellW = cellWidth;
  let _cellH = cellHeight;
  let _screenW = screenWidth;
  let _screenH = screenHeight;
  // Callback to get current image offset/size from kitty.js
  const _getImageOffset = getImageOffset || (() => ({ col: 1, row: 1, cols: _cols, rows: _rows }));
  const _cols = Math.floor(screenWidth / cellWidth);
  const _rows = Math.floor(screenHeight / cellHeight);

  const keyToAction = bindings;

  // Drag tracking
  let dragStart = null;
  let dragStartTime = 0;
  let dragging = false;
  let scrolled = false;  // suppress tap after scroll
  let tapTimer = null;   // delayed tap to avoid scroll ghost taps
  const TAP_DELAY = 100; // ms to wait before sending tap
  const LONG_PRESS_MS = 400; // press longer than this = long press

  // Scroll debounce: accumulate scroll events and send one swipe
  let scrollAccum = 0;   // positive = down, negative = up
  let scrollTimer = null;
  const SCROLL_DEBOUNCE = 150; // ms

  // ESC buffer (for Alt+Key handling)
  let escBuf = '';
  let escTimer = null;
  const ESC_TIMEOUT = 50;

  process.stdin.on('data', (data) => {
    let str = data.toString();

    if (escTimer) {
      clearTimeout(escTimer);
      escTimer = null;
      str = escBuf + str;
      escBuf = '';
    }

    if (str === '\x1b') {
      escBuf = str;
      escTimer = setTimeout(() => {
        escTimer = null;
        const buf = escBuf;
        escBuf = '';
        handleInput(buf).catch(e => console.error('roidy: input error:', e.message));
      }, ESC_TIMEOUT);
      return;
    }

    handleInput(str).catch(e => console.error('roidy: input error:', e.message));
  });

  async function handleInput(str) {
    // SGR 1006 mouse events
    const mouseRe = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
    let match;
    let hadMouse = false;

    while ((match = mouseRe.exec(str)) !== null) {
      hadMouse = true;
      const cb = parseInt(match[1]);
      const col = parseInt(match[2]);
      const row = parseInt(match[3]);
      const release = match[4] === 'm';
      // Map terminal cell to Android screen coordinate
      // getImageOffset returns the displayed image region in cells
      const imgOff = _getImageOffset();
      const imgPixelX = (col - imgOff.col) * _cellW;
      const imgPixelY = (row - imgOff.row) * _cellH;
      const imgDisplayW = imgOff.cols * _cellW;
      const imgDisplayH = imgOff.rows * _cellH;
      // Use actual Android screen size from image dimensions (rotation may swap W/H)
      const androidW = imgOff.imgW || _screenW;
      const androidH = imgOff.imgH || _screenH;
      const x = Math.round(Math.max(0, Math.min(androidW, imgPixelX / imgDisplayW * androidW)));
      const y = Math.round(Math.max(0, Math.min(androidH, imgPixelY / imgDisplayH * androidH)));

      if (cb === MOUSE_SCROLL_UP || cb === MOUSE_SCROLL_DOWN) {
        if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
        scrolled = true;
        scrollAccum += cb === MOUSE_SCROLL_DOWN ? 1 : -1;
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(async () => {
          const scrollOff = _getImageOffset();
          const cx = (scrollOff.imgW || _screenW) / 2;
          const cy = (scrollOff.imgH || _screenH) / 2;
          const dist = scrollAccum * SCROLL_SWIPE_PX;
          scrollAccum = 0;
          await adb.swipe(cx, cy, cx, cy - dist, 300);
          forceCapture();
        }, SCROLL_DEBOUNCE);
      } else if (cb === MOUSE_BTN_LEFT) {
        if (release) {
          if (scrolled) {
            scrolled = false;
          } else if (dragging && dragStart) {
            await adb.swipe(dragStart.x, dragStart.y, x, y, 300);
          } else if (dragStart) {
            const elapsed = Date.now() - dragStartTime;
            if (elapsed >= LONG_PRESS_MS) {
              // Long press: same position swipe with long duration
              await adb.swipe(dragStart.x, dragStart.y, dragStart.x, dragStart.y, 1000);
            } else {
              // Delay tap to allow scroll events to cancel it
              const tapX = x, tapY = y;
              tapTimer = setTimeout(() => {
                tapTimer = null;
                adb.tap(tapX, tapY);
                forceCapture();
              }, TAP_DELAY);
            }
          }
          dragStart = null;
          dragging = false;
        } else {
          dragStart = { x, y };
          dragStartTime = Date.now();
          dragging = false;
          scrolled = false;
        }
      } else if (cb === MOUSE_BTN_DRAG) {
        dragging = true;
      }
    }

    if (hadMouse) {
      // Capture after mouse input (delay for Android rendering)
      forceCapture();
      return;
    }

    // Check key bindings
    const result = parseInput(str);
    if (result && result !== 'text') {
      const keyName = toKeyName(result);
      const action = keyToAction[keyName];
      if (action) {
        if (await execAction(action)) return;
      }

      // Unbound key → send as Android keyevent
      const androidKey = KEY_TO_ANDROID[result.key];
      if (androidKey) {
        await adb.keyevent(androidKey);
        forceCapture();
        return;
      }
    }

    // Ctrl+C fallback
    if (str === '\x03') {
      process.emit('SIGINT');
      return;
    }

    // Text input → send to Android
    if (result === 'text') {
      await adb.inputText(str);
      forceCapture();
    }
  }

  async function execAction(action) {
    if (action === 'quit') {
      process.emit('SIGINT');
      return true;
    }
    if (action === 'back') {
      await adb.keyevent(adb.KEYCODE.BACK);
      forceCapture();
      return true;
    }
    if (action === 'home') {
      await adb.keyevent(adb.KEYCODE.HOME);
      forceCapture();
      return true;
    }
    if (action === 'menu') {
      await adb.keyevent(adb.KEYCODE.MENU);
      forceCapture();
      return true;
    }
    return false;
  }

  // Update cell/screen size on resize
  function updateSize(cellW, cellH, screenW, screenH) {
    _cellW = cellW;
    _cellH = cellH;
    _screenW = screenW;
    _screenH = screenH;
  }

  return { updateSize };
}
