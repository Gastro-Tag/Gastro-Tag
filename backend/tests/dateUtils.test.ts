import { afterEach, describe, expect, it } from 'vitest';
import { addMonths, daysBetween, kitchenDayStartInstant, kitchenToday, kitchenWeekAgo } from '../src/utils/dateUtils';

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

describe('addMonths and daysBetween', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const iso = (date: Date) => date.toISOString().slice(0, 10);

  it('moves a day missing in the target month to its last day', () => {
    expect(iso(addMonths(day('2028-01-31'), 1))).toBe('2028-02-29');
    expect(iso(addMonths(day('2026-01-31'), 1))).toBe('2026-02-28');
    expect(iso(addMonths(day('2028-02-29'), 12))).toBe('2029-02-28');
  });

  it('crosses the year', () => {
    expect(iso(addMonths(day('2026-12-31'), 2))).toBe('2027-02-28');
  });

  it('counts calendar days, negative when the end comes first', () => {
    expect(daysBetween(day('2026-11-17'), day('2026-11-18'))).toBe(1);
    expect(daysBetween(day('2026-11-18'), day('2026-11-17'))).toBe(-1);
    expect(daysBetween(day('2028-02-01'), day('2028-03-01'))).toBe(29);
  });
});
