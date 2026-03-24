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
let _cellW = 10;
let _cellH = 20;
let _lastFitC = 0;
let _lastFitR = 0;
let _lastOffsetCol = 1;
let _lastOffsetRow = 1;
let _lastImgW = 0;
let _lastImgH = 0;

export function getImageOffset() {
  return { col: _lastOffsetCol, row: _lastOffsetRow, cols: _lastFitC, rows: _lastFitR, imgW: _lastImgW, imgH: _lastImgH };
}
// Clear screen + delete all Kitty images
const CLEAR = `\x1b_Ga=d,d=A,q=2;\x1b\\\x1b[2J`;

export function setDisplaySize(cols, rows, cellW, cellH) {
  _cols = cols;
  _rows = rows;
  if (cellW) _cellW = cellW;
  if (cellH) _cellH = cellH;
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
// Calculate display cols/rows from image dimensions, fitting within terminal
function fitCells(base64Data) {
  // Read PNG width/height from IHDR (bytes 16-23 of PNG)
  let imgW = 0, imgH = 0;
  try {
    const buf = Buffer.from(base64Data.slice(0, 200), 'base64');
    imgW = buf.readUInt32BE(16);
    imgH = buf.readUInt32BE(20);
  } catch {}
  if (!imgW || !imgH || !_cols || !_rows) return { c: _cols, r: _rows, offsetCol: 1, offsetRow: 1 };
  _lastImgW = imgW;
  _lastImgH = imgH;

  const termW = _cols * _cellW;
  const termH = _rows * _cellH;
  // Scale image to fit terminal, preserving aspect ratio
  const scale = Math.min(termW / imgW, termH / imgH);
  const c = Math.round(imgW * scale / _cellW);
  const r = Math.round(imgH * scale / _cellH);
  // Center offset in cells
  const offsetCol = Math.max(1, Math.floor((_cols - c) / 2) + 1);
  const offsetRow = Math.max(1, Math.floor((_rows - r) / 2) + 1);
  return { c, r, offsetCol, offsetRow };
}

function sendFrameFile(base64Data) {
  if (!_dedupDisabled && base64Data.length === lastFrameData.length && base64Data === lastFrameData) {
    return;
  }
  lastFrameData = base64Data;
  writeFileSync(tmpFile, Buffer.from(base64Data, 'base64'));
  const { c, r, offsetCol, offsetRow } = fitCells(base64Data);
  const sizeChanged = c !== _lastFitC || r !== _lastFitR;
  _lastFitC = c;
  _lastFitR = r;
  _lastOffsetCol = offsetCol;
  _lastOffsetRow = offsetRow;
  const crFile = c && r ? `,c=${c},r=${r}` : '';
  const cursorPos = `\x1b[${offsetRow};${offsetCol}H`;
  const seq = `\x1b_Ga=T,f=100,t=f,q=2,C=1,i=1${crFile};${tmpPathB64}\x1b\\`;
  process.stdout.write(`${sizeChanged ? CLEAR : ''}${cursorPos}${wrapKitty(seq)}`);
}

// Inline mode (4096B chunked)
function sendFrameInline(pngBase64) {
  if (!_dedupDisabled && pngBase64.length === lastFrameData.length && pngBase64 === lastFrameData) {
    return;
  }
  lastFrameData = pngBase64;
  const CHUNK = 4096;
  const { c, r, offsetCol, offsetRow } = fitCells(pngBase64);
  const sizeChanged = c !== _lastFitC || r !== _lastFitR;
  _lastFitC = c;
  _lastFitR = r;
  _lastOffsetCol = offsetCol;
  _lastOffsetRow = offsetRow;
  const crInline = c && r ? `,c=${c},r=${r}` : '';
  const cursorPos = `\x1b[${offsetRow};${offsetCol}H`;
  if (pngBase64.length <= CHUNK) {
    const seq = `\x1b_Ga=T,f=100,q=2,C=1,i=1${crInline};${pngBase64}\x1b\\`;
    process.stdout.write(`${sizeChanged ? CLEAR : ''}${cursorPos}${wrapKitty(seq)}`);
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
  process.stdout.write(`${sizeChanged ? CLEAR : ''}${cursorPos}${wrapKitty(parts.join(''))}`);
}

export function resetFrameCache() {
  lastFrameData = '';
}

export const sendFrame = transport === 'file' ? sendFrameFile : sendFrameInline;
