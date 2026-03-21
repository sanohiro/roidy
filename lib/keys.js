// Key binding configuration
// Customizable via ~/.roidy/keys.json
// Undefined keys are passed through to Android

import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadJsonFile } from './config.js';

const configPath = join(homedir(), '.roidy', 'keys.json');

const DEFAULTS = {
  'ctrl+q': 'quit',
  'escape': 'back',
};

export function loadKeyBindings() {
  return { ...DEFAULTS, ...loadJsonFile(configPath, {}) };
}

// Build a human-readable key name from parsed input
// { key: 'ArrowLeft', modifiers: 1 } → "alt+left"
export function toKeyName(info) {
  const parts = [];
  if (info.modifiers & 2) parts.push('ctrl');
  if (info.modifiers & 1) parts.push('alt');
  if (info.modifiers & 8) parts.push('shift');
  if (info.modifiers & 4) parts.push('meta');

  const k = info.key;
  const normalized =
    k === 'ArrowUp'    ? 'up' :
    k === 'ArrowDown'  ? 'down' :
    k === 'ArrowLeft'  ? 'left' :
    k === 'ArrowRight' ? 'right' :
    k === ' '          ? 'space' :
    k.toLowerCase();

  parts.push(normalized);
  return parts.join('+');
}
