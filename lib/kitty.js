// Kitty graphics protocol output
//
// Ported from casty. No URL bar — full screen display.
//
// Protocol parameters:
//   a=T  : transmit and display
//   a=d  : delete image(s)
//   f=100: PNG format
//   t=f  : file transfer (send file path as base64)
//   t=d  : inline transfer (send image data as base64)
//   q=2  : suppress response
//   C=1  : no cursor movement
//   i=N  : image ID (replace existing image with same ID)
//   m=0/1: chunk continuation

import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from './config.js';

const tmpFile = join(tmpdir(), `roidy-frame-${process.pid}.png`);
const tmpPathB64 = Buffer.from(tmpFile).toString('base64');

// Display size in cells
let _cols = 0;
let _rows = 0;

export function setDisplaySize(cols, rows) {
  _cols = cols;
  _rows = rows;
}

// Detect transfer mode
function detectTransport() {
  const config = loadConfig();
  const setting = config.transport || 'auto';

  if (setting === 'file') return 'file';
  if (setting === 'inline') return 'inline';

  const termProg = process.env.TERM_PROGRAM || '';
  if (/bcon/i.test(termProg)) return 'file';
  if (/kitty/i.test(termProg)) return 'file';
  return 'inline';
}

export const transport = detectTransport();

// Cursor to top-left (no URL bar, display from row 1)
const CURSOR_HOME = '\x1b[1;1H';
export function cursorHome() {
  process.stdout.write(CURSOR_HOME);
}

// tmux DCS passthrough wrapper
function wrapKitty(seq) {
  if (!process.env.TMUX) return seq;
  return `\x1bPtmux;${seq.replaceAll('\x1b', '\x1b\x1b')}\x1b\\`;
}

// Clear screen (also delete all Kitty images)
export function clearScreen() {
  process.stdout.write(`${wrapKitty('\x1b_Ga=d,d=A,q=2;\x1b\\')}\x1b[2J\x1b[H`);
}

export function hideCursor() {
  process.stdout.write('\x1b[?25l');
}

export function showCursor() {
  process.stdout.write('\x1b[?25h');
}

export function cleanup() {
  try { unlinkSync(tmpFile); } catch {}
}

// Frame deduplication
let lastFrameData = '';
let _dedupDisabled = false;
let _dedupTimer = null;

export function disableDedup(ms = 3000) {
  _dedupDisabled = true;
  clearTimeout(_dedupTimer);
  _dedupTimer = setTimeout(() => { _dedupDisabled = false; }, ms);
}

// File transfer mode (fast: sends only path)
// Works with both PNG and JPEG data — bcon detects format from file content.
function sendFrameFile(base64Data) {
  if (!_dedupDisabled && base64Data.length === lastFrameData.length && base64Data === lastFrameData) {
    return;
  }
  lastFrameData = base64Data;
  writeFileSync(tmpFile, Buffer.from(base64Data, 'base64'));
  const crFile = _cols && _rows ? `,c=${_cols},r=${_rows}` : '';
  const seq = `\x1b_Ga=T,f=100,t=f,q=2,C=1,i=1${crFile};${tmpPathB64}\x1b\\`;
  process.stdout.write(`${CURSOR_HOME}${wrapKitty(seq)}`);
}

// Inline mode (4096B chunked)
function sendFrameInline(pngBase64) {
  if (!_dedupDisabled && pngBase64.length === lastFrameData.length && pngBase64 === lastFrameData) {
    return;
  }
  lastFrameData = pngBase64;
  const CHUNK = 4096;
  const crInline = _cols && _rows ? `,c=${_cols},r=${_rows}` : '';
  if (pngBase64.length <= CHUNK) {
    const seq = `\x1b_Ga=T,f=100,q=2,C=1,i=1${crInline};${pngBase64}\x1b\\`;
    process.stdout.write(`${CURSOR_HOME}${wrapKitty(seq)}`);
    return;
  }
  const parts = [];
  let i = 0;
  while (i < pngBase64.length) {
    const chunk = pngBase64.slice(i, i + CHUNK);
    const more = i + CHUNK < pngBase64.length ? 1 : 0;
    if (i === 0) {
      parts.push(`\x1b_Ga=T,f=100,q=2,C=1,i=1${crInline},m=${more};${chunk}\x1b\\`);
    } else {
      parts.push(`\x1b_Gm=${more};${chunk}\x1b\\`);
    }
    i += CHUNK;
  }
  process.stdout.write(`${CURSOR_HOME}${wrapKitty(parts.join(''))}`);
}

export function resetFrameCache() {
  lastFrameData = '';
}

export const sendFrame = transport === 'file' ? sendFrameFile : sendFrameInline;
