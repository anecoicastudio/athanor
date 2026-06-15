import { describe, expect, it } from 'vitest';
import { eventKeys } from './events';

describe('eventKeys', () => {
  it('namespaces rsvp + attendees distinctly under the events root', () => {
    expect(eventKeys.all).toEqual(['events']);
    expect(eventKeys.detail('e1')).toEqual(['events', 'detail', 'e1']);
    expect(eventKeys.rsvp('e1')).toEqual(['events', 'rsvp', 'e1']);
    expect(eventKeys.attendees('e1')).toEqual(['events', 'attendees', 'e1']);
  });
});
