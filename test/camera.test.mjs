import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dimensionsCompressees } from '../js/ui/camera.js';

// Seule logique pure de js/ui/camera.js (le reste est DOM/média, vérifié au
// navigateur — voir Task 16 du plan). Côté long ramené à `max` (2000px par
// défaut), aspect conservé, jamais d'agrandissement.

test('dimensionsCompressees : réduit le côté long à 2000px, ratio conservé', () => {
  assert.deepEqual(dimensionsCompressees(3000, 2000), { w: 2000, h: 1333 });
  assert.deepEqual(dimensionsCompressees(2000, 3000), { w: 1333, h: 2000 });
});

test('dimensionsCompressees : jamais d’agrandissement (image déjà sous la limite)', () => {
  assert.deepEqual(dimensionsCompressees(800, 600), { w: 800, h: 600 });
});

test('dimensionsCompressees : côté exactement à la limite → inchangé', () => {
  assert.deepEqual(dimensionsCompressees(2000, 1000), { w: 2000, h: 1000 });
});

test('dimensionsCompressees : limite personnalisée', () => {
  assert.deepEqual(dimensionsCompressees(1000, 500, 400), { w: 400, h: 200 });
});
