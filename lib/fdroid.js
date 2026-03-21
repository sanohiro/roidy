// F-Droid API — search and install apps

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url, redirects = 0) => {
      if (redirects > 5) return reject(new Error('too many redirects'));
      const getter = url.startsWith('https') ? httpsGet : httpGet;
      getter(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          writeFileSync(dest, Buffer.concat(chunks));
          resolve();
        });
        res.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    httpsGet(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(JSON.parse(data)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Extract package name from F-Droid URL
// https://f-droid.org/en/packages/org.mozilla.fennec_fdroid -> org.mozilla.fennec_fdroid
function pkgFromUrl(url) {
  const m = url.match(/packages\/([^/]+)/);
  return m ? m[1] : null;
}

// Search F-Droid
export async function search(query) {
  const data = await fetchJson(`https://search.f-droid.org/api/search_apps?q=${encodeURIComponent(query)}`);
  return (data.apps || []).map(app => ({
    name: app.name,
    summary: app.summary || '',
    pkg: pkgFromUrl(app.url || ''),
    icon: app.icon || null,
  })).filter(a => a.pkg);
}

// Get latest version info
export async function getVersion(pkg) {
  const data = await fetchJson(`https://f-droid.org/api/v1/packages/${pkg}`);
  return {
    pkg: data.packageName,
    version: data.suggestedVersionCode,
    apkUrl: `https://f-droid.org/repo/${pkg}_${data.suggestedVersionCode}.apk`,
  };
}

// Get installed version code
function getInstalledVersion(pkg) {
  try {
    const output = execSync(`adb shell "dumpsys package ${pkg} | grep versionCode"`, { encoding: 'utf8', timeout: 5000 });
    const m = output.match(/versionCode=(\d+)/);
    return m ? parseInt(m[1]) : null;
  } catch {
    return null;
  }
}

// Get all F-Droid-installable packages on device (non-system)
function getThirdPartyPackages() {
  const output = execSync('adb shell pm list packages -3', { encoding: 'utf8', timeout: 10000 });
  return output.split('\n').map(l => l.replace('package:', '').trim()).filter(Boolean);
}

// Check for updates — returns list of { pkg, installed, latest, apkUrl }
export async function checkUpdates() {
  const packages = getThirdPartyPackages();
  const updates = [];

  for (const pkg of packages) {
    try {
      const info = await getVersion(pkg);
      const installed = getInstalledVersion(pkg);
      if (installed && info.version > installed) {
        updates.push({
          pkg,
          installed,
          latest: info.version,
          apkUrl: info.apkUrl,
        });
      }
    } catch {
      // Not in F-Droid, skip
    }
  }
  return updates;
}

// Download and install
export async function install(pkg) {
  const { tmpdir } = await import('node:os');
  const info = await getVersion(pkg);
  const apkPath = join(tmpdir(), `${pkg}_${info.version}.apk`);

  console.log(`Downloading ${pkg} (v${info.version})...`);
  await download(info.apkUrl, apkPath);

  console.log(`Installing ${pkg}...`);
  const result = execSync(`adb install "${apkPath}"`, { encoding: 'utf8', timeout: 60000 }).trim();

  // Clean up
  try { (await import('node:fs')).unlinkSync(apkPath); } catch {}

  if (!result.includes('Success')) {
    throw new Error(`Install failed: ${result}`);
  }
  console.log(`Installed ${pkg}`);
}
