// cast.js — Low-latency screen streaming via scrcpy-server + ffmpeg
//
// Pipeline:
//   scrcpy-server (H264 raw stream) → TCP → ffmpeg (decode) → PNG/JPEG frames → Kitty GP
//
// Uses raw_stream=true so scrcpy sends a pure H264 elementary stream
// with no headers or packet framing. This goes directly into ffmpeg.
// ffmpeg decodes H264 and outputs image frames.
//
// Output format:
//   - PNG (default): works with all Kitty GP terminals (inline or file transfer)
//     Uses compression_level=1 for speed over size.
//   - JPEG: faster encoding, smaller output. Requires file transfer mode
//     (bcon supports JPEG via file transfer, Ghostty/Kitty do not inline).

import { spawn, execSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { adbExec, getDeviceId } from './adb.js';

const SCRCPY_SERVER_PATH = '/data/local/tmp/scrcpy-server.jar';
const SCRCPY_VERSION = '3.3.4';
const FORWARD_PORT = 27183;

// Frame boundary markers
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

export class CastSession {
  constructor({ displayId = null, maxFps = 30, format = 'png', onFrame, onError }) {
    this._displayId = displayId;
    this._maxFps = maxFps;
    this._format = format; // 'png' or 'jpeg'
    this._onFrame = onFrame;
    this._frameTimes = [];
    this._onError = onError || (() => {});
    this._server = null;
    this._ffmpeg = null;
    this._socket = null;
    this._stopped = false;
    this._buf = Buffer.alloc(0);
  }

  async start() {
    await this._ensureServer();

    // Set up adb port forward for scrcpy connection
    try { adbExec(`forward --remove tcp:${FORWARD_PORT}`, { stdio: 'ignore' }); } catch {}
    adbExec(`forward tcp:${FORWARD_PORT} localabstract:scrcpy`);

    // Start scrcpy-server on device
    const serverArgs = [
      SCRCPY_VERSION,
      'tunnel_forward=true',
      'video=true',
      'audio=false',
      'control=false',
      'raw_stream=true',            // Pure H264 stream, no packet headers
      `max_fps=${this._maxFps}`,
    ];
    if (this._displayId != null) {
      serverArgs.push(`display_id=${this._displayId}`);
    }

    const serverCmd = `CLASSPATH=${SCRCPY_SERVER_PATH} app_process / com.genymobile.scrcpy.Server ${serverArgs.join(' ')}`;
    const deviceId = getDeviceId();
    const adbArgs = deviceId ? ['-s', deviceId, 'shell', serverCmd] : ['shell', serverCmd];
    this._server = spawn('adb', adbArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    this._server.stderr.on('data', () => {});
    this._server.on('close', () => {
      if (!this._stopped) this._onError(new Error('scrcpy-server exited'));
    });

    // Wait for server to be ready
    await new Promise(r => setTimeout(r, 1500));

    // Connect and start pipeline
    await this._connect();
  }

  async _connect() {
    return new Promise((resolve, reject) => {
      this._socket = createConnection(FORWARD_PORT, '127.0.0.1', () => {
        this._startFfmpeg();

        // raw_stream=true: pipe H264 directly to ffmpeg, no parsing needed
        this._socket.on('data', (data) => {
          if (this._ffmpeg && this._ffmpeg.stdin.writable) {
            this._ffmpeg.stdin.write(data);
          }
        });

        resolve();
      });

      this._socket.on('error', (err) => {
        if (!this._stopped) reject(err);
      });
    });
  }

  _startFfmpeg() {
    const outputArgs = this._format === 'jpeg'
      ? ['-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '5']
      : ['-f', 'image2pipe', '-vcodec', 'png', '-compression_level', '1'];

    this._ffmpeg = spawn('ffmpeg', [
      '-probesize', '32',           // Minimal probe for fast startup
      '-analyzeduration', '0',      // Don't analyze stream duration
      '-f', 'h264',
      '-i', 'pipe:0',
      '-an',                        // No audio
      ...outputArgs,
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    this._ffmpeg.stderr.on('data', () => {});

    this._lastFrameTime = Date.now();
    this._ffmpeg.stdout.on('data', (data) => {
      this._buf = Buffer.concat([this._buf, data]);
      this._extractFrames();
    });

    this._ffmpeg.on('close', () => {
      if (!this._stopped) this._onError(new Error('ffmpeg exited'));
    });
  }

  _extractFrames() {
    if (this._format === 'jpeg') {
      this._extractJpegFrames();
    } else {
      this._extractPngFrames();
    }
  }

  // Extract complete PNG frames from ffmpeg output buffer.
  // Each PNG starts with the 8-byte PNG signature and ends with the
  // 12-byte IEND chunk.
  _extractPngFrames() {
    while (true) {
      const start = this._buf.indexOf(PNG_SIG);
      if (start < 0) { this._buf = Buffer.alloc(0); break; }
      if (start > 0) this._buf = this._buf.subarray(start);

      const end = this._buf.indexOf(PNG_IEND);
      if (end < 0) break;

      const frameEnd = end + PNG_IEND.length;
      const frame = this._buf.subarray(0, frameEnd);
      this._buf = this._buf.subarray(frameEnd);
      this._recordFrameTime();
      this._onFrame(frame.toString('base64'));
    }
  }

  // Extract complete JPEG frames from ffmpeg output buffer.
  // Each JPEG starts with SOI (FF D8) and ends with EOI (FF D9).
  _extractJpegFrames() {
    while (true) {
      const start = this._buf.indexOf(JPEG_SOI);
      if (start < 0) break;

      const end = this._buf.indexOf(JPEG_EOI, start + 2);
      if (end < 0) break;

      const frame = this._buf.subarray(start, end + 2);
      this._buf = this._buf.subarray(end + 2);
      this._recordFrameTime();
      this._onFrame(frame.toString('base64'));
    }
  }

  _recordFrameTime() {
    const now = Date.now();
    this._frameTimes.push(now - this._lastFrameTime);
    this._lastFrameTime = now;
  }

  // Get frame timing stats
  getStats() {
    const times = this._frameTimes.slice();
    if (times.length === 0) return null;
    times.sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    return {
      frames: times.length,
      avg: Math.round(sum / times.length),
      median: times[Math.floor(times.length / 2)],
      min: times[0],
      max: times[times.length - 1],
      fps: Math.round(1000 / (sum / times.length) * 10) / 10,
    };
  }

  // Ensure scrcpy-server exists on device.
  // Downloads and caches to ~/.roidy/scrcpy-server.jar if needed.
  async _ensureServer() {
    try {
      const check = adbExec('shell "ls /data/local/tmp/scrcpy-server.jar 2>&1"', {
        timeout: 5000
      });
      if (!check.includes('No such file') && !check.includes('not found')) return;
    } catch {}

    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const localPath = join(homedir(), '.roidy', 'scrcpy-server.jar');

    try {
      const { existsSync } = await import('node:fs');
      if (existsSync(localPath)) {
        adbExec(`push "${localPath}" /data/local/tmp/scrcpy-server.jar`, { timeout: 10000 });
        return;
      }
    } catch {}

    console.error('roidy cast: downloading scrcpy-server...');
    const dir = join(homedir(), '.roidy');
    const { mkdirSync } = await import('node:fs');
    try { mkdirSync(dir, { recursive: true }); } catch {}
    execSync(
      `curl -L -o "${localPath}" "https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-server-v${SCRCPY_VERSION}"`,
      { timeout: 30000 }
    );
    adbExec(`push "${localPath}" /data/local/tmp/scrcpy-server.jar`, { timeout: 10000 });
  }

  stop() {
    this._stopped = true;
    if (this._ffmpeg) {
      this._ffmpeg.stdin.end();
      this._ffmpeg.kill();
      this._ffmpeg = null;
    }
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
    if (this._server) {
      this._server.kill();
      this._server = null;
    }
    try { adbExec(`forward --remove tcp:${FORWARD_PORT}`, { stdio: 'ignore' }); } catch {}
  }
}
