import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const html = readFileSync(join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
const worker = readFileSync(join(root, 'service-worker.js'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exitCode = 1;
  } else {
    console.log('PASS:', message);
  }
}

// Parse every inline JavaScript block without executing browser-dependent code.
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, attrs]) => !/\bsrc\s*=/i.test(attrs))
  .filter(([, attrs]) => !/\btype\s*=\s*["'](?:application\/json|application\/ld\+json|importmap)["']/i.test(attrs));

for (let i = 0; i < inlineScripts.length; i++) {
  try {
    new vm.Script(inlineScripts[i][2], { filename: 'index.html:inline-script-' + (i + 1) });
    console.log('PASS: inline JavaScript block ' + (i + 1) + ' parses');
  } catch (error) {
    console.error('FAIL: inline JavaScript block ' + (i + 1) + ' does not parse:', error.message);
    process.exitCode = 1;
  }
}

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
assert(duplicates.length === 0, duplicates.length ? 'duplicate HTML ids: ' + duplicates.join(', ') : 'HTML ids are unique');
assert(/<link\b[^>]*rel=["']manifest["'][^>]*>/i.test(html), 'web app manifest is linked');
assert(/navigator\.serviceWorker\.register\(['"]\.\/service-worker\.js['"]/i.test(html), 'service worker registration is present');
assert(manifest.name && manifest.short_name && manifest.start_url && manifest.scope, 'manifest has required app identity and URL fields');

for (const icon of manifest.icons || []) {
  assert(existsSync(join(root, icon.src)), 'manifest icon exists: ' + icon.src);
}

assert(/CACHE_NAME\s*=\s*['"]voicecraft-shell-v\d+['"]/.test(worker), 'service worker cache is versioned');
assert(/request\.method\s*!==\s*['"]GET['"]/.test(worker), 'service worker does not cache non-GET requests');
assert(/url\.origin\s*!==\s*self\.location\.origin/.test(worker), 'service worker excludes cross-origin provider/API requests');
assert(/SHELL_SET\.has/.test(worker), 'service worker only handles its explicit app-shell allowlist');
assert(/serviceWorker/.test(html) && /cloud generation needs internet/i.test(worker), 'offline limitations are documented in code');
assert(/availableVoices\s*=\s*c\.voices\.filter/.test(html), 'OpenAI voices are filtered by selected model');
assert(/labLoadSeq/.test(html), 'Voice Lab rejects stale file-load and export results');
assert(/maxWavBytes\s*=\s*32\s*\*\s*1024\s*\*\s*1024/.test(html), 'combined WAV export has a mobile memory limit');
assert(/voice_settings\s*=\s*\{\s*stability:/.test(html), 'cloud ElevenLabs receives supported voice tuning settings');

for (const id of ['labExport', 'labPlay', 'cloneGo', 'rvGo']) {
  assert(ids.includes(id), 'critical Voice Lab control exists: ' + id);
}

if (process.exitCode) process.exit(process.exitCode);
console.log('VoiceCraft static validation completed.');
