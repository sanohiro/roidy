#!/usr/bin/env node
// Check CSI 14t terminal pixel size query

if (!process.stdin.isTTY) {
  console.log('stdin is not a TTY');
  process.exit(1);
}

process.stdin.setRawMode(true);
process.stdin.resume();

const timeout = setTimeout(() => {
  console.log('CSI 14t: TIMEOUT (no response)');
  console.log('cols:', process.stdout.columns, 'rows:', process.stdout.rows);
  console.log('fallback: cell=10x20, screen=' + (process.stdout.columns * 10) + 'x' + (process.stdout.rows * 20));
  process.stdin.setRawMode(false);
  process.exit(1);
}, 2000);

let buf = '';
process.stdin.on('data', (data) => {
  buf += data.toString();
  const m = buf.match(/\x1b\[4;(\d+);(\d+)t/);
  if (m) {
    clearTimeout(timeout);
    const h = parseInt(m[1]);
    const w = parseInt(m[2]);
    const cols = process.stdout.columns;
    const rows = process.stdout.rows;
    const cellW = Math.floor(w / cols);
    const cellH = Math.floor(h / rows);
    console.log('CSI 14t: OK');
    console.log('terminal pixels:', w, 'x', h);
    console.log('cols:', cols, 'rows:', rows);
    console.log('cell:', cellW, 'x', cellH);
    console.log('screen:', cellW * cols, 'x', cellH * rows);
    process.stdin.setRawMode(false);
    process.exit(0);
  }
});

process.stdout.write('\x1b[14t');
