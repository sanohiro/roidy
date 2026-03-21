// Configuration loader
// Customizable via ~/.roidy/config.json

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function loadJsonFile(filePath, fallback) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

const configPath = join(homedir(), '.roidy', 'config.json');

const DEFAULTS = {
  host: 'localhost',
  port: 5555,
  interval: 1000,
  transport: 'auto', // 'auto' | 'file' | 'inline'
};

let _cache = null;

export function loadConfig() {
  if (_cache) return _cache;
  _cache = { ...DEFAULTS, ...loadJsonFile(configPath, {}) };
  return _cache;
}
