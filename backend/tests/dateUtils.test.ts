import { afterEach, describe, expect, it } from 'vitest';
import { kitchenDayStartInstant, kitchenToday, kitchenWeekAgo } from '../src/utils/dateUtils';

const originalTimeZone = process.env.KITCHEN_TIME_ZONE;
afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.KITCHEN_TIME_ZONE;
  else process.env.KITCHEN_TIME_ZONE = originalTimeZone;
});

describe('kitchen calendar boundaries', () => {
  it('uses the configured timezone for the start of the day', () => {
    process.env.KITCHEN_TIME_ZONE = 'America/Manaus';
    const start = kitchenDayStartInstant();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Manaus', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(start);
    expect(parts.find((part) => part.type === 'hour')?.value).toBe('00');
    expect(parts.find((part) => part.type === 'minute')?.value).toBe('00');
  });

  it('defines today and the rolling week from kitchen-local calendar days', () => {
    process.env.KITCHEN_TIME_ZONE = 'America/Manaus';
    const today = kitchenToday();
    const weekStart = kitchenWeekAgo();
    const startAsDate = kitchenDayStartInstant(today);
    expect((startAsDate.getTime() - weekStart.getTime()) / 86_400_000).toBe(7);
  });
});
