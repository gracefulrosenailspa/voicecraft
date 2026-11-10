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
    window.__ttsCalls = [];
    window.__speechPreviewCalls = [];
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      cancel() {},
      getVoices() { return [{ name: 'Test device voice', lang: 'en-US', voiceURI: 'test' }]; },
      speak(utterance) { window.__speechPreviewCalls.push({ text: utterance.text }); if (utterance.onstart) utterance.onstart(); if (utterance.onend) utterance.onend(); }
    }});
    window.puter = { ai: { txt2speech: async (text, options) => { window.__ttsCalls.push({ text, options }); return makeAudio(); }, speech2speech: async () => makeAudio() } };
  }, wavData);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.title(), 'VoiceCraft Studio', 'the studio page loads');
  assert.equal(await page.locator('#script').count(), 1, 'the narration editor is present');
  const installAssets = await page.evaluate(async () => {
    const manifest = await (await fetch('./manifest.webmanifest')).json();
    const icons = await Promise.all(manifest.icons.filter(icon => icon.type === 'image/png').map(icon => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve({ sizes: icon.sizes, width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = reject; image.src = icon.src;
    })));
    return { manifest, icons };
  });
  assert.ok(installAssets.icons.some(icon => icon.sizes === '192x192' && icon.width === 192 && icon.height === 192), '192px PWA icon loads at the declared size');
  assert.ok(installAssets.icons.some(icon => icon.sizes === '512x512' && icon.width === 512 && icon.height === 512), '512px PWA icon loads at the declared size');
  console.log('PASS: PWA manifest and raster install icons load at their declared dimensions');

  await page.locator('#engineSeg button[data-engine="cloud"]').click();
  await page.locator('#cModel').selectOption('tts-1');
  const restrictedVoices = await page.locator('#cVoice option').evaluateAll(options => options.map(option => option.value));
  assert.ok(!restrictedVoices.some(voice => ['ballad', 'verse', 'marin', 'cedar'].includes(voice)), 'OpenAI legacy models do not offer voices restricted to gpt-4o-mini-tts');
  await page.locator('#cModel').selectOption('gpt-4o-mini-tts');
  const expressiveVoices = await page.locator('#cVoice option').evaluateAll(options => options.map(option => option.value));
  assert.ok(['ballad', 'verse', 'marin', 'cedar'].every(voice => expressiveVoices.includes(voice)), 'gpt-4o-mini-tts exposes its supported expressive voices');
  console.log('PASS: OpenAI voice choices follow the selected model');
  assert.equal(await page.locator('#previewDevice').count(), 1, 'device voice audition control is available');
  assert.equal(await page.locator('#previewCloud').count(), 1, 'cloud voice audition control is available');
  assert.equal(await page.locator('#previewKeys').count(), 1, 'pro voice audition control is available');
  await page.locator('#previewCloud').click();
  await page.waitForFunction(() => window.__speechPreviewCalls && window.__speechPreviewCalls.length === 1);
  const freePreview = await page.evaluate(() => window.__speechPreviewCalls[0]);
  assert.match(freePreview.text, /world does not change in a moment/i, 'free audition uses the short generic sample');
  assert.equal(await page.locator('#previewCloudAudio').count(), 0, 'generic preview does not create provider audio');
  assert.equal(await page.evaluate(() => window.__ttsCalls.length), 0, 'generic preview makes no paid provider TTS request');
  console.log('PASS: generic voice audition uses device speech without provider credits');  await page.locator('#script').fill('VoiceCraft browser smoke test.');
  await page.waitForFunction(() => document.querySelector('#count')?.textContent.includes('30'), null, { timeout: 5000 });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  assert.ok(mobileLayout.document <= mobileLayout.viewport && mobileLayout.body <= mobileLayout.viewport,
    'the app has no horizontal overflow at a 390px mobile viewport: ' + JSON.stringify(mobileLayout));
  assert.equal(await page.locator('#play').isVisible(), true, 'primary narration control remains visible on mobile');
  await page.setViewportSize({ width: 1280, height: 720 });
  console.log('PASS: responsive layout fits a 390px mobile viewport');
  console.log('PASS: app loads and narration editor responds');

  await page.evaluate(() => { const input = document.querySelector('#intensity'); input.value = '100'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#play').click();
  await page.getByRole('button', { name: /complete narration/i }).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: /complete narration/i }).click();
  await page.getByRole('link', { name: /download complete narration/i }).waitFor({ state: 'visible', timeout: 10000 });
  const combinedWav = await page.getByRole('link', { name: /download complete narration/i }).evaluate(async link => {
    const bytes = await (await fetch(link.href)).arrayBuffer();
    const view = new DataView(bytes);
    return { size: bytes.byteLength, riff: String.fromCharCode(...new Uint8Array(bytes, 0, 4)),
      wave: String.fromCharCode(...new Uint8Array(bytes, 8, 4)), bits: view.getUint16(34, true) };
  });
  assert.equal(combinedWav.riff, 'RIFF', 'combined export has a RIFF header');
  assert.equal(combinedWav.wave, 'WAVE', 'combined export has a WAVE format marker');
  assert.equal(combinedWav.bits, 16, 'combined export is 16-bit PCM');
  assert.ok(combinedWav.size > 44, 'combined export contains audio samples');
  const ttsOptions = await page.evaluate(() => window.__ttsCalls[0]?.options || {});
  assert.match(ttsOptions.instructions || '', /strong, vivid emotional expression/i, 'cloud TTS receives the selected intensity');
  console.log('PASS: mocked Puter generation and combined WAV export');

  await page.locator('#tab-lab').click();
  await page.locator('#file').setInputFiles({ name: 'voicecraft-test.wav', mimeType: 'audio/wav', buffer: wav });
  await page.getByText(/Loaded\. Press Play/i).waitFor({ timeout: 10000 });
  assert.equal(await page.locator('#labPlay').isEnabled(), true, 'Voice Lab playback is enabled after decoding');
  await page.locator('#labExport').click();
  await page.locator('#labDownload').waitFor({ state: 'visible', timeout: 15000 });
  const processedWav = await page.locator('#labDownload').evaluate(async link => {
    const bytes = await (await fetch(link.href)).arrayBuffer();
    const view = new DataView(bytes);
    return { size: bytes.byteLength, riff: String.fromCharCode(...new Uint8Array(bytes, 0, 4)),
      wave: String.fromCharCode(...new Uint8Array(bytes, 8, 4)), bits: view.getUint16(34, true) };
  });
  assert.equal(processedWav.riff, 'RIFF', 'processed export has a RIFF header');
  assert.equal(processedWav.wave, 'WAVE', 'processed export has a WAVE format marker');
  assert.equal(processedWav.bits, 16, 'processed export is 16-bit PCM');
  assert.ok(processedWav.size > 44, 'processed export contains audio samples');
  console.log('PASS: Voice Lab decodes audio and exports processed WAV');

  await page.locator('#rvGo').click();
  await page.getByText(/confirm that you own this recording/i).waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#rvOut audio').count(), 0, 're-voice is blocked without permission confirmation');
  await page.locator('#rvConsent').check();
  await page.locator('#rvGo').click();
  await page.getByText('Done.', { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await page.locator('#rvOut audio').count(), 1, 're-voice result player is rendered');
  console.log('PASS: mocked re-voice flow returns a playable result');

  await page.locator('#file').setInputFiles({ name: 'invalid-audio.wav', mimeType: 'audio/wav', buffer: Buffer.from('not an audio file') });
  await page.getByText(/could not decode the file/i).waitFor({ timeout: 10000 });
  assert.equal(await page.locator('#labDownload').count(), 0, 'a failed new file load clears the stale WAV download');
  assert.equal(await page.locator('#labExport').isDisabled(), true, 'export stays disabled when the new file cannot be decoded');
  assert.equal(await page.locator('#rvConsent').isChecked(), false, 're-voice permission resets for a new recording');
  assert.equal(await page.locator('#cloneConsent').isChecked(), false, 'clone permission resets for a new recording');
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