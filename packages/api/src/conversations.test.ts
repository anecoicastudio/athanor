import { describe, expect, test } from 'vitest';
import { conversationKeys } from './conversations';

describe('conversationKeys', () => {
  test('list + detail key shapes', () => {
    expect(conversationKeys.list()).toEqual(['conversations', 'list']);
    expect(conversationKeys.detail('abc')).toEqual(['conversations', 'detail', 'abc']);
  });
});
