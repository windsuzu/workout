import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('install manifest provides real PNG icons and iOS home-screen metadata', async () => {
  const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.id, '/'); assert.equal(manifest.scope, '/'); assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}` && icon.purpose === 'any'); assert.ok(icon);
    const png = await readFile('public' + icon.src); assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  const touch = await readFile('public/icons/apple-touch-icon.png'); assert.equal(touch.readUInt32BE(16), 180);
  assert.match(await readFile('index.html', 'utf8'), /rel="apple-touch-icon"/);
});
