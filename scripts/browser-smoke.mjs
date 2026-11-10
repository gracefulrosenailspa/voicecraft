import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.VOICECRAFT_TEST_URL || 'http://127.0.0.1:4173/';
const sampleRate = 44100;
const samples = sampleRate;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + samples * 2, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 5000), 44 + i * 2);
const wavData = 'data:audio/wav;base64,' + wav.toString('base64');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

try {
  await page.addInitScript(dataUrl => {
    const makeAudio = () => { const audio = new Audio(); audio.src = dataUrl; return audio; };
    window.puter = { ai: { txt2speech: async () => makeAudio(), speech2speech: async () => makeAudio() } };
  }, wavData);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.title(), 'VoiceCraft Studio', 'the studio page loads');
  assert.equal(await page.locator('#script').count(), 1, 'the narration editor is present');
  await page.locator('#script').fill('VoiceCraft browser smoke test.');
  await page.waitForFunction(() => document.querySelector('#count')?.textContent.includes('30'), null, { timeout: 5000 });
  console.log('PASS: app loads and narration editor responds');

  await page.locator('#engineSeg button[data-engine="cloud"]').click();
  await page.locator('#play').click();
  await page.getByRole('button', { name: /complete narration/i }).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: /complete narration/i }).click();
  await page.getByRole('link', { name: /download complete narration/i }).waitFor({ state: 'visible', timeout: 10000 });
  console.log('PASS: mocked Puter generation and combined WAV export');

  await page.locator('#tab-lab').click();
  await page.locator('#file').setInputFiles({ name: 'voicecraft-test.wav', mimeType: 'audio/wav', buffer: wav });
  await page.getByText(/Loaded\. Press Play/i).waitFor({ timeout: 10000 });
  assert.equal(await page.locator('#labPlay').isEnabled(), true, 'Voice Lab playback is enabled after decoding');
  await page.locator('#labExport').click();
  await page.locator('#labDownload').waitFor({ state: 'visible', timeout: 15000 });
  console.log('PASS: Voice Lab decodes audio and exports processed WAV');

  await page.locator('#rvGo').click();
  await page.getByText('Done.', { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await page.locator('#rvOut audio').count(), 1, 're-voice result player is rendered');
  console.log('PASS: mocked re-voice flow returns a playable result');

  await page.locator('#file').setInputFiles({ name: 'invalid-audio.wav', mimeType: 'audio/wav', buffer: Buffer.from('not an audio file') });
  await page.getByText(/could not decode the file/i).waitFor({ timeout: 10000 });
  assert.equal(await page.locator('#labDownload').count(), 0, 'a failed new file load clears the stale WAV download');
  assert.equal(await page.locator('#labExport').isDisabled(), true, 'export stays disabled when the new file cannot be decoded');
  console.log('PASS: failed file replacement clears stale export controls');

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('service worker did not take control')), 8000);
        navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timeout); resolve(); }, { once: true });
      });
    }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
  assert.equal(await page.title(), 'VoiceCraft Studio', 'the app shell reloads while offline');
  assert.equal(await page.locator('#script').count(), 1, 'the offline shell retains the app interface');
  await context.setOffline(false);
  console.log('PASS: service worker serves the cached app shell offline');

  assert.deepEqual(pageErrors, [], 'the page has no uncaught JavaScript errors');
  console.log('PASS: no uncaught browser JavaScript errors');
} finally {
  await context.close();
  await browser.close();
}