// roidy setup - configure a fresh Android environment
// Installs launcher, app store, sets timezone, locale, and 24h clock

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';

const LAUNCHERS = [
  {
    name: 'KISS Launcher',
    description: 'Search-based minimal launcher',
    pkg: 'fr.neamar.kiss',
    versionUrl: 'https://f-droid.org/api/v1/packages/fr.neamar.kiss',
    apkUrl: (ver) => `https://f-droid.org/repo/fr.neamar.kiss_${ver}.apk`,
    homeActivity: 'fr.neamar.kiss/.MainActivity',
  },
  {
    name: 'Discreet Launcher',
    description: 'Lightweight and privacy-friendly',
    pkg: 'com.vincent_falzon.discreetlauncher',
    versionUrl: 'https://f-droid.org/api/v1/packages/com.vincent_falzon.discreetlauncher',
    apkUrl: (ver) => `https://f-droid.org/repo/com.vincent_falzon.discreetlauncher_${ver}.apk`,
    homeActivity: 'com.vincent_falzon.discreetlauncher/.ActivityMain',
  },
];

const EXTRA_APPS = [
  {
    name: 'F-Droid',
    pkg: 'org.fdroid.fdroid',
    directUrl: 'https://f-droid.org/F-Droid.apk',
  },
];

function adb(cmd) {
  return execSync(`adb shell "${cmd}"`, { encoding: 'utf8', timeout: 15000 }).trim();
}

function adbInstall(apkPath) {
  return execSync(`adb install "${apkPath}"`, { encoding: 'utf8', timeout: 60000 }).trim();
}

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

async function fetchJson(url) {
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

function prompt(question, defaultValue) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

function getCurrentHome() {
  try {
    const output = adb('cmd package resolve-activity -a android.intent.action.MAIN -c android.intent.category.HOME');
    const m = output.match(/name=(\S+)/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function getInstalledApps() {
  const output = execSync('adb shell pm list packages', { encoding: 'utf8' });
  return new Set(output.split('\n').map(l => l.replace('package:', '').trim()).filter(Boolean));
}

async function installApp(app) {
  const installed = execSync(`adb shell pm list packages ${app.pkg}`, { encoding: 'utf8' });
  if (installed.includes(app.pkg)) {
    console.log(`  ${app.name}: already installed`);
    return true;
  }

  let apkPath;
  if (app.directUrl) {
    apkPath = join(tmpdir(), `${app.pkg}.apk`);
    console.log(`  ${app.name}: downloading...`);
    await download(app.directUrl, apkPath);
  } else {
    const info = await fetchJson(app.versionUrl);
    const ver = info.suggestedVersionCode;
    apkPath = join(tmpdir(), `${app.pkg}_${ver}.apk`);
    const url = app.apkUrl(ver);
    console.log(`  ${app.name}: downloading (v${ver})...`);
    await download(url, apkPath);
  }

  console.log(`  ${app.name}: installing...`);
  const result = adbInstall(apkPath);
  try { unlinkSync(apkPath); } catch {}
  if (!result.includes('Success')) {
    console.error(`  ${app.name}: install failed — ${result}`);
    return false;
  }
  console.log(`  ${app.name}: installed`);
  return true;
}

export async function runSetup(host, port, opts = {}) {
  console.log('roidy setup: starting...\n');

  // Verify adb connection
  try {
    execSync(`adb connect ${host}:${port}`, { encoding: 'utf8', timeout: 10000 });
    const devices = execSync('adb devices', { encoding: 'utf8' });
    if (!devices.includes(`${host}:${port}`)) {
      throw new Error(`device ${host}:${port} not found`);
    }
  } catch (err) {
    console.error(`roidy setup: failed to connect to ${host}:${port} — ${err.message}`);
    process.exit(1);
  }

  // Get current values from device
  const currentTz = adb('getprop persist.sys.timezone');
  const currentLocale = adb('getprop persist.sys.locale') || adb('getprop ro.product.locale');

  // Timezone
  const tz = opts.timezone ?? await prompt(`Timezone (current: ${currentTz})`, '');

  // Locale
  const locale = opts.locale ?? await prompt(`Locale (current: ${currentLocale})`, '');

  console.log('');

  let needsReboot = false;
  let setHomeActivity = null;
  let setHomeName = null;

  // Apply timezone
  if (tz) {
    console.log(`Setting timezone to ${tz}`);
    adb(`su 0 setprop persist.sys.timezone ${tz}`);
    adb(`su 0 service call alarm 3 s16 ${tz}`);
    needsReboot = true;
  }

  // Apply locale
  if (locale) {
    console.log(`Setting locale to ${locale}`);
    adb(`su 0 setprop persist.sys.locale ${locale}`);
    needsReboot = true;
  }

  // 24h clock
  const currentClock = adb('settings get system time_12_24') || '12';
  const clockFormat = opts.clock ?? await prompt(`Clock format — 24 or 12 (current: ${currentClock})`, '');
  if (clockFormat === '24' || clockFormat === '12') {
    console.log(`Setting clock format to ${clockFormat}h`);
    adb(`su 0 settings put system time_12_24 ${clockFormat}`);
  }

  // Screen timeout
  const currentTimeout = adb('settings get system screen_off_timeout');
  const timeoutSec = currentTimeout !== 'null' ? Math.round(parseInt(currentTimeout) / 1000) : 30;
  const timeoutLabel = timeoutSec >= 2147483 ? 'never' : `${timeoutSec}s`;
  const timeoutInput = opts.screenTimeout ?? await prompt(`Screen timeout in seconds, 0 for never (current: ${timeoutLabel})`, '');
  if (timeoutInput !== '') {
    const sec = parseInt(timeoutInput);
    if (!isNaN(sec)) {
      const ms = sec === 0 ? 2147483647 : sec * 1000;
      console.log(`Setting screen timeout to ${sec === 0 ? 'never' : sec + 's'}`);
      adb(`su 0 settings put system screen_off_timeout ${ms}`);
    }
  }

  // Screen lock
  const currentLock = adb('settings get secure lockscreen.disabled');
  const lockStatus = currentLock === '1' ? 'disabled' : 'enabled';
  const lockInput = opts.screenLock ?? await prompt(`Screen lock — on or off (current: ${lockStatus})`, '');
  if (lockInput === 'off') {
    console.log('Disabling screen lock');
    adb('su 0 settings put secure lockscreen.disabled 1');
  } else if (lockInput === 'on') {
    console.log('Enabling screen lock');
    adb('su 0 settings put secure lockscreen.disabled 0');
  }

  // App installation
  const currentHome = getCurrentHome();
  const installedApps = getInstalledApps();
  const currentLauncherName = LAUNCHERS.find(l => currentHome.includes(l.pkg))?.name;
  const homeLabel = currentLauncherName || currentHome || 'default';
  const fdroidStatus = installedApps.has('org.fdroid.fdroid') ? 'installed' : 'not installed';

  console.log(`\nApps:`);
  console.log(`  Launcher: ${homeLabel}`);
  console.log(`  F-Droid: ${fdroidStatus}`);

  if (!opts.noInstall) {

    // App store
    const doAppStore = opts.appStore ??
      (await prompt(`\nInstall F-Droid? (y/N)`, 'N')).toLowerCase() === 'y';
    if (doAppStore) {
      for (const app of EXTRA_APPS) {
        await installApp(app);
      }
    }

    // Launcher
    let launcher = null;
    if (opts.launcher) {
      launcher = LAUNCHERS.find(l => l.pkg === opts.launcher || l.name.toLowerCase().includes(opts.launcher.toLowerCase()));
      if (!launcher) {
        console.error(`roidy setup: unknown launcher "${opts.launcher}"`);
        process.exit(1);
      }
    } else {
      const doLauncher = (await prompt(`Install a launcher? (y/N)`, 'N')).toLowerCase() === 'y';
      if (doLauncher) {
        console.log('\nLauncher:');
        LAUNCHERS.forEach((l, i) => {
          const mark = currentHome.includes(l.pkg) ? ' *' : '';
          const status = installedApps.has(l.pkg) ? 'installed' : '';
          const info = [l.description, status].filter(Boolean).join(', ');
          console.log(`  ${i + 1}) ${l.name} — ${info}${mark}`);
        });
        const choice = await prompt('Choose', '1');
        const idx = parseInt(choice);
        if (idx > 0 && idx <= LAUNCHERS.length) {
          launcher = LAUNCHERS[idx - 1];
        }
      }
    }

    if (launcher) {
      const ok = await installApp(launcher);
      if (ok) {
        setHomeActivity = launcher.homeActivity;
        setHomeName = launcher.name;
        adb(`cmd package set-home-activity ${setHomeActivity}`);
        console.log(`  ${launcher.name}: set as default home`);
      }
    }
  }

  console.log('\nroidy setup: done');
  if (needsReboot) {
    // Auto-restart if CLI flags were used, otherwise ask
    const interactive = !opts.timezone && !opts.locale;
    const doRestart = interactive
      ? (await prompt('Restart system UI to apply changes? (y/N)', 'N')).toLowerCase() === 'y'
      : true;
    if (doRestart) {
      console.log('roidy setup: restarting...');
      adb('su 0 setprop ctl.restart zygote');
      // Wait for zygote to come back
      for (let i = 0; i < 30; i++) {
        try {
          const result = execSync(`adb shell getprop sys.boot_completed`, { encoding: 'utf8', timeout: 5000 }).trim();
          if (result === '1') break;
        } catch {}
        execSync('sleep 2');
      }
      // Wait for package service to be ready, then re-apply home activity
      const homeToApply = setHomeActivity || LAUNCHERS.find(l => currentHome.includes(l.pkg))?.homeActivity;
      if (homeToApply) {
        for (let i = 0; i < 15; i++) {
          try {
            const out = execSync(`adb shell "cmd package set-home-activity ${homeToApply}"`, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
            if (out.includes('Success') || !out.includes("Can't find service")) break;
          } catch {}
          execSync('sleep 1');
        }
      }
      console.log('roidy setup: restarted');
    }
  }
}
