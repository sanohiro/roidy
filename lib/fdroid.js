// F-Droid API — search and install apps

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';
import { adbExec } from './adb.js';

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
        const total = parseInt(res.headers['content-length'], 10) || 0;
        let received = 0;
        const chunks = [];
        res.on('data', (c) => {
          chunks.push(c);
          received += c.length;
          if (total) {
            const pct = Math.floor(received / total * 100);
            const mb = (received / 1048576).toFixed(1);
            const totalMb = (total / 1048576).toFixed(1);
            process.stderr.write(`\r  ${mb}/${totalMb} MB (${pct}%)`);
          }
        });
        res.on('end', () => {
          if (total) process.stderr.write('\n');
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
    const output = adbExec(`shell "dumpsys package ${pkg} | grep versionCode"`, { timeout: 5000 });
    const m = output.match(/versionCode=(\d+)/);
    return m ? parseInt(m[1]) : null;
  } catch {
    return null;
  }
}

// Get all F-Droid-installable packages on device (non-system)
function getThirdPartyPackages() {
  const output = adbExec('shell pm list packages -3', { timeout: 10000 });
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

// Resolve short name to package name via F-Droid search
export async function resolve(name) {
  // Try as exact package name first (com.foo.bar has at least 2 dots)
  if ((name.match(/\./g) || []).length >= 2) {
    try {
      await getVersion(name);
      return name;
    } catch {}
  }
  const results = await search(name);
  if (results.length === 0) throw new Error(`No F-Droid packages found for "${name}"`);
  if (results.length === 1) return results[0].pkg;
  console.log(`Multiple packages found for "${name}":`);
  results.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}) ${r.pkg} — ${r.name}${r.summary ? ': ' + r.summary : ''}`);
  });
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const choice = await new Promise(r => rl.question('Choose [1]: ', a => { rl.close(); r(a || '1'); }));
  const idx = parseInt(choice);
  if (idx > 0 && idx <= results.length) return results[idx - 1].pkg;
  return results[0].pkg;
}

// Download and install
export async function install(pkg) {
  pkg = await resolve(pkg);
  try {
    const verifier = adbExec('shell settings get global package_verifier_enable', { timeout: 5000 });
    if (verifier === '1') {
      console.warn('Warning: Play Protect is enabled — install may be blocked or hang.');
      console.warn('  Run "roidy setup" to disable it.');
    }
  } catch {}
  const { tmpdir } = await import('node:os');
  const info = await getVersion(pkg);
  const apkPath = join(tmpdir(), `${pkg}_${info.version}.apk`);

  console.log(`Downloading ${pkg} (v${info.version})...`);
  await download(info.apkUrl, apkPath);

  console.log(`Installing ${pkg}...`);
  let result;
  try {
    result = adbExec(`install "${apkPath}"`);
  } catch (err) {
    const stderr = err.stderr?.toString() || err.message;
    // Clean up
    try { (await import('node:fs')).unlinkSync(apkPath); } catch {}
    if (stderr.includes('INSTALL_FAILED_NO_MATCHING_ABIS')) {
      throw new Error(`${pkg} requires native libraries not supported by this device's ABI`);
    }
    throw new Error(`Install failed: ${stderr.trim()}`);
  }

  // Clean up
  try { (await import('node:fs')).unlinkSync(apkPath); } catch {}

  if (!result.includes('Success')) {
    throw new Error(`Install failed: ${result}`);
  }
  console.log(`Installed ${pkg}`);
}
