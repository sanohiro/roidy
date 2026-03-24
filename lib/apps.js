// App resolver — resolve short names or partial matches to package names
// Uses adb to query installed launcher activities

import { adbExec } from './adb.js';

// Well-known aliases
const ALIASES = {
  kindle:     'com.amazon.kindle',
  play:       'com.android.vending',
  chrome:     'com.android.chrome',
  settings:   'com.android.settings',
  calendar:   'com.android.calendar',
  contacts:   'com.android.contacts',
  clock:      'com.android.deskclock',
  gallery:    'com.android.gallery3d',
  files:      'com.android.documentsui',
  fdroid:     'org.fdroid.fdroid',
  magisk:     'com.topjohnwu.magisk',
  gboard:     'com.google.android.inputmethod.latin',
  firefox:    'org.mozilla.firefox',
  fennec:     'org.mozilla.fennec_fdroid',
};

// Get launcher activities from device
function getLauncherActivities() {
  try {
    const output = adbExec(
      'shell "pm query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER"',
      { timeout: 10000 }
    );
    const activities = [];
    for (const line of output.split('\n')) {
      const m = line.trim().match(/^([\w.]+)\/([\w.]+)$/);
      if (m) activities.push({ pkg: m[1], activity: `${m[1]}/${m[2]}` });
    }
    return activities;
  } catch {
    return [];
  }
}

// Resolve app name to { pkg, activity }
export function resolveApp(name) {
  const lower = name.toLowerCase();

  // Check aliases first
  const aliased = ALIASES[lower];
  if (aliased) name = aliased;

  // Exact package match
  const activities = getLauncherActivities();
  const exact = activities.find(a => a.pkg === name);
  if (exact) return exact;

  // Partial match on package name
  const partial = activities.filter(a => a.pkg.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    return { candidates: partial };
  }

  // Check if package exists but has no launcher activity
  try {
    const check = adbExec(`shell pm list packages ${name}`, { timeout: 5000 });
    if (check.includes(name)) {
      return { error: `${name} is installed but has no launcher activity` };
    }
  } catch {}

  return { error: `App not found: ${name}` };
}

// Launch app via am start
export function launchApp(activity) {
  try {
    adbExec(`shell "am start -n ${activity}"`, { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

// List installed apps with launcher activities
export function listApps() {
  const activities = getLauncherActivities();
  // Build reverse alias map
  const reverseAlias = {};
  for (const [alias, pkg] of Object.entries(ALIASES)) {
    reverseAlias[pkg] = alias;
  }
  return activities.map(a => ({
    ...a,
    alias: reverseAlias[a.pkg] || null,
    label: reverseAlias[a.pkg] || a.pkg.split('.').pop(),
  }));
}
