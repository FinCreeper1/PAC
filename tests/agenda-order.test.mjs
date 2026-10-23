import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/shared/calendar-model.js';

const calendar = { days: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map(isoDate => ({ isoDate })) };

test('mobile agenda shows today, then following days, then past days', () => {
  assert.deepEqual(globalThis.CalendarModel.agendaGroups(calendar, '2026-10-14'), { today: 2, upcoming: [3], past: [0, 1] });
});

test('mobile agenda stays chronological outside the trip', () => {
  for (const date of ['2026-10-01', '2026-10-20'])
    assert.deepEqual(globalThis.CalendarModel.agendaGroups(calendar, date), { today: null, upcoming: [0, 1, 2, 3], past: [] });
});

test('current state reports the Berlin minute for the now line', () => {
  const state = globalThis.CalendarModel.current({ ...calendar, events: [] }, new Date('2026-10-14T12:34:00Z'));
  assert.equal(state.minute, 14 * 60 + 34);
});
