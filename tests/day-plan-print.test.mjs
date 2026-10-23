import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../public/shared/calendar-model.js';

test('day plan includes selected published details, notes and journeys without interpreting HTML', async () => {
  const element = (tag, textContent = '') => ({tag, textContent, children: [], append(...items) {this.children.push(...items);}, replaceChildren(...items) {this.children = items;}, add(item) {this.children.push(item);}});
  const select = element('select'), button = element('button'), status = element('p'), body = element('body');
  const elements = {'print-day':select, 'print-day-plan':button, 'print-plan-status':status};
  let printed = 0;
  const context = {
    document: {getElementById: id => elements[id], body},
    Option: function(text, value) {return {text, value};},
    createTextElement: element, CalendarModel: globalThis.CalendarModel,
    portalCalendar: {days:[{isoDate:'2026-10-12'}, {isoDate:'2026-10-13'}], events:[
      {day:1, title:'Treffpunkt', location:'Bahnhof 1', startTime:'09:00', endTime:'10:00', note:'<img onerror=alert(1)>', journeyId:'train'},
      {day:2, title:'Anderer Tag', startTime:'11:00', endTime:'12:00'},
    ]},
    tripConfig:{title:'Reise'}, journeys:{train:{legs:[{service:'ICE 1', origin:'Hamburg', destination:'Berlin'}]}},
    loadVisibleEventNote: async item => item.note || '',
    window:{print:() => printed++},
  };
  vm.createContext(context);
  const source = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function setupDayPlanPrint(')) + '\nsetupDayPlanPrint({publishedAt:"2026-10-10T10:00:00Z"}, "cached");', context);
  select.value = '1';
  await button.onclick();
  const text = JSON.stringify(body.children);
  assert.match(text, /Bahnhof 1/);
  assert.match(text, /<img onerror=alert\(1\)>/);
  assert.match(text, /ICE 1/);
  assert.match(text, /Offline-Kopie/);
  assert.match(text, /print-plan-journey/);
  assert.match(text, /"strong","textContent":"09:00"/);
  assert.doesNotMatch(text, /Anderer Tag/);
  assert.equal(printed, 1);
  assert.equal(button.disabled, false);
});

test('calendar print lays out all days with overlapping events side by side', () => {
  const element = (tag, textContent = '') => ({tag, textContent, className: '', children: [], style: {setProperty(k, v) {this[k] = v;}}, append(...items) {this.children.push(...items);}});
  const button = element('button'), status = element('p'), body = element('body');
  let printed = 0;
  const context = {
    document: {getElementById: id => ({'print-calendar-plan': button, 'print-plan-status': status})[id], body},
    createTextElement: element, CalendarModel: globalThis.CalendarModel,
    portalCalendar: {days: [{isoDate: '2026-10-12'}, {isoDate: '2026-10-13'}], events: [
      {day: 1, title: 'A', type: 'travel', startTime: '07:00', endTime: '09:00'},
      {day: 1, title: 'B', type: 'free', status: 'provisional', startTime: '08:00', endTime: '10:00'},
      {day: 2, title: 'Offen', type: 'free', timing: 'unscheduled'},
    ]},
    tripConfig: {title: 'Reise'}, window: {print: () => printed++},
  };
  vm.createContext(context);
  const source = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function setupCalendarPrint(')) + '\nsetupCalendarPrint({}, false, (t, x, c) => { const e = createTextElement(t, x); if (c) e.className = c; return e; });', context);
  button.onclick();
  const events = [];
  const walk = node => { if (node.className?.startsWith('print-calendar-event')) events.push(node); node.children?.forEach(walk); };
  walk(body);
  assert.equal(events.length, 2);
  assert.match(events[0].className, /train-event/);
  assert.match(events[1].className, /free-event draft-event/);
  assert.match(JSON.stringify(body.children), /print-calendar-open-event free-event/);
  assert.deepEqual(events.map(e => e.style.width), ['50%', '50%']);
  assert.equal(events[0].style.top, '0%');
  assert.match(JSON.stringify(body.children), /Offen/);
  assert.equal(printed, 1);
});
