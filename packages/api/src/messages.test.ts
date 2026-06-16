import { describe, expect, test } from 'vitest';
import { messageKeys } from './messages';

describe('messageKeys', () => {
  test('thread key is scoped by conversation id', () => {
    expect(messageKeys.thread('c1')).toEqual(['messages', 'thread', 'c1']);
  });
});
