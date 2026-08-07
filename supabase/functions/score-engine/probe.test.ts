import { z } from 'zod';
import { applyCap } from '../../../packages/core/src/score/caps.ts';
import { STAR_KEYS } from '../../../packages/schemas/src/aura.ts';
Deno.test('probe', () => {
  if (!z || !applyCap || !STAR_KEYS) throw new Error('nope');
});
