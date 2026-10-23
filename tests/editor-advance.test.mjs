import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
function setup(timing = 'scheduled') {
  const targets = [];
  const elements = {
    day: { value: 'monday' }, timing: { value: timing },
    startTime: { value: '08:00', validity: { valid: true } },
    endTime: { value: '09:00', validity: { valid: true } },
  };
  const context = vm.createContext({
    form: { elements, addEventListener() {} },
    minutes: value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; },
    $: selector => ({ focus() { targets.push(selector); }, scrollIntoView() {} }),
  });
  vm.runInContext(source.slice(source.indexOf('function advanceEditorTo('), source.indexOf('let lastEditorState')), context);
  return { elements, targets, change: name => context.advanceAfterTimeChange(name) };
}
test('complete times lead to confirmation, a status choice leads to the location', () => {
  const app = setup();
  app.change('endTime');
  app.change('status');
  assert.deepEqual(app.targets, ['#confirmation-label select', '#editor-place-heading']);
});
test('open timing skips confirmation', () => {
  const app = setup('unscheduled');
  app.change('timing');
  assert.deepEqual(app.targets, ['#editor-place-heading']);
});
test('incomplete or invalid times and unrelated changes do not advance', () => {
  const app = setup();
  app.change('title');
  app.elements.endTime.value = '';
  app.change('status');
  app.elements.endTime.value = '07:00';
  app.change('endTime');
  app.elements.endTime.value = '09:00';
  app.elements.endTime.validity.valid = false;
  app.change('endTime');
  assert.deepEqual(app.targets, []);
});
