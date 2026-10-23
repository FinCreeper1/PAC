import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function setup() {
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, {
      value: '', elements: {}, hidden: true,
      listeners: {}, addEventListener(type, handler) {this.listeners[type] = handler}, replaceChildren() {}, focus() {},
    });
    return nodes.get(key);
  };
  node('#editor').elements.day = {value: '1', replaceChildren() {}};
  for (const key of ['enabled','deadlineEnabled','deadlineTitle','deadlineStartDate','deadlineStartTime','deadlineEndDate','deadlineEndTime','deadlineHideAt','warningMinutes']) node('#countdown-form').elements[key] = {};
  const context = vm.createContext({
    document: {querySelector: node, querySelectorAll: () => [], addEventListener() {}},
    window: {addEventListener() {}, matchMedia: () => ({matches: false})},
    structuredClone, confirm: () => true,
    fetch: () => new Promise(() => {}),
  });
  vm.runInContext(readFileSync(new URL('../public/shared/calendar-model.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8'), context);
  for (const file of ['invoices.js','settings.js']) vm.runInContext(readFileSync(new URL('../public/admin/'+file, import.meta.url), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  run(`calendar = {events: [], days: [], timeSlots: ['08:00', '09:00']};
    revision = 'v1'; csrf = 'test-csrf';
    render = () => {}; refreshDayOptions = () => {};`);
  let published;
  context.fetch = async (url, options) => {
    published = JSON.parse(options.body);
    return {ok: true, json: async () => ({revision: 'v2'})};
  };
  return {node, run, context, published: () => published};
}

test('published changes remain undoable and the restored plan can be published', async () => {
  const app = setup();
  app.run(`checkpoint(); calendar.countdown = {enabled: false}; controls();`);
  await app.node('#save').onclick();
  assert.equal(app.run('dirty'), false);
  assert.equal(app.node('#undo').disabled, false);
  app.node('#undo').onclick();
  assert.equal(app.run('calendar.countdown'), undefined);
  assert.equal(app.run('dirty'), true);
  assert.equal(app.node('#undo').disabled, true);
  await app.node('#save').onclick();
  assert.equal(app.published().calendar.countdown, undefined);
  assert.equal(app.published().revision, 'v2');
  assert.equal(app.run('dirty'), false);
});

test('multiple publications keep changes in reverse order', async () => {
  const app = setup();
  for (const title of ['First', 'Second']) {
    app.run(`checkpoint(); calendar.label = ${JSON.stringify(title)};`);
    await app.node('#save').onclick();
  }
  app.node('#undo').onclick();
  assert.equal(app.run('calendar.label'), 'First');
  app.node('#undo').onclick();
  assert.equal(app.run('calendar.label'), undefined);
});

test('empty, saving and expired sessions do not consume history', () => {
  const app = setup();
  app.node('#undo').onclick();
  assert.equal(app.run('calendar.events.length'), 0);
  app.run('checkpoint(); saving = true; controls();');
  assert.equal(app.node('#undo').disabled, true);
  app.node('#undo').onclick();
  assert.equal(app.run('history.length'), 1);
  app.run('saving = false; sessionExpired = true;');
  app.node('#undo').onclick();
  assert.equal(app.run('history.length'), 1);
});

test('failed publication preserves undo history', async () => {
  const app = setup();
  app.run('checkpoint(); calendar.label = "changed";');
  app.context.fetch = async () => ({ok: false, json: async () => ({error: 'Conflict'})});
  await app.node('#save').onclick();
  assert.equal(app.run('dirty'), true);
  app.node('#undo').onclick();
  assert.equal(app.run('calendar.label'), undefined);
});
function editor(app) {
  app.node('#editor').elements.title = {name: 'title', value: 'Original'};
  app.run(`draft = {id: 'event-1', title:'Original'}; selected = 'event-1';
    showDraft = () => {}; syncTimeFields = () => {}; mapLink = () => {};
    updateSaveState();`);
}
test('each unsaved field change can be undone and redone independently', () => {
 const app = setup();editor(app);
 for (const title of ['First', 'Second']) {
  app.node('#editor').elements.title.value = title;
  app.run('editing = true; updateSaveState();');
 }
 assert.equal(app.node('#undo').disabled, false);
 app.node('#undo').onclick();
 assert.equal(app.node('#editor').elements.title.value, 'First');
 app.node('#undo').onclick();
 assert.equal(app.node('#editor').elements.title.value, 'Original');
 assert.equal(app.node('#undo').disabled, true);
 app.node('#redo').onclick();
 assert.equal(app.node('#editor').elements.title.value, 'First');
 app.node('#redo').onclick();
 assert.equal(app.node('#editor').elements.title.value, 'Second');
 assert.equal(app.node('#redo').disabled, true);
});
test('a new edit after undo discards the redo branch', () => {
 const app=setup();editor(app);
 app.node('#editor').elements.title.value='First';app.run('editing=true; updateSaveState();');
 app.node('#undo').onclick();
 app.node('#editor').elements.title.value='Different';app.run('editing=true; updateSaveState();');
 assert.equal(app.node('#redo').disabled,true);
 app.node('#redo').onclick();
 assert.equal(app.node('#editor').elements.title.value,'Different');
});
test('calendar undo and redo survive publishing and refresh countdown settings', async () => {
 const app=setup();
 app.run('checkpoint(); calendar.countdown={enabled:false}; controls();');
 await app.node('#save').onclick();
 app.node('#undo').onclick();
 assert.equal(app.node('#countdown-form').elements.enabled.checked,true);
 app.node('#redo').onclick();
 assert.equal(app.node('#countdown-form').elements.enabled.checked,false);
 assert.equal(app.run('calendar.countdown.enabled'),false);
});
test('route points and train legs restore with the editor fields', () => {
 const app=setup();editor(app);
 app.run(`window.captureJourneyHistory=()=>window.legs;
  window.restoreJourneyHistory=value=>{window.legs=value};
  window.legs=[{origin:'A'}];draft.mapRoute={points:[]};updateSaveState();
  draft.mapRoute.points.push({name:'Stop'});window.legs=[{origin:'B'}];editing=true;updateSaveState();`);
 app.node('#undo').onclick();
 assert.equal(app.run('draft.mapRoute.points.length'),0);
 assert.equal(app.run('window.legs[0].origin'),'A');
 app.node('#redo').onclick();
 assert.equal(app.run('draft.mapRoute.points[0].name'),'Stop');
 assert.equal(app.run('window.legs[0].origin'),'B');
});
test('unsubmitted countdown inputs support undo and redo', () => {
 const app=setup();
 const field=app.node('#countdown-form').elements.deadlineTitle;
 field.value='Original';app.run('updateSaveState();');
 field.value='Changed';app.run('updateSaveState();');
 app.node('#undo').onclick();
 assert.equal(field.value,'Original');
 app.node('#redo').onclick();
 assert.equal(field.value,'Changed');
});

test('deadline form publishes booking date and time fields with optional hide time', async () => {
  const app=setup(), form=app.node('#countdown-form'), fields=form.elements;
  fields.enabled.checked=true; fields.deadlineEnabled.checked=true;
  fields.deadlineTitle.value='Unterlagen'; fields.warningMinutes.value='60';
  fields.deadlineStartDate.value='2026-10-18'; fields.deadlineStartTime.value='10:00'; fields.deadlineEndDate.value='2026-10-19'; fields.deadlineEndTime.value='12:00'; fields.deadlineHideAt.value='';
  form.onsubmit({preventDefault(){},currentTarget:form});
  assert.equal(app.run('calendar.countdown.deadline.startAt'),new Date('2026-10-18T10:00').toISOString());
  assert.equal(app.run('calendar.countdown.deadline.hideAt'),new Date('2026-10-19T12:00').toISOString());
  await app.node('#save').onclick();
  assert.equal(app.published().calendar.countdown.deadline.title,'Unterlagen');
  fields.deadlineHideAt.value='2026-10-20T12:00';
  form.onsubmit({preventDefault(){},currentTarget:form});
  assert.equal(app.run('calendar.countdown.deadline.startAt'),new Date('2026-10-18T10:00').toISOString());
  assert.equal(app.run('calendar.countdown.deadline.hideAt'),new Date(fields.deadlineHideAt.value).toISOString());
});

test('invalid deadline range does not replace the current calendar', () => {
  const app=setup(),form=app.node('#countdown-form'),fields=form.elements;
  fields.deadlineEnabled.checked=true;fields.deadlineTitle.value='Unterlagen'; fields.warningMinutes.value='60';
  fields.deadlineStartDate.value='2026-10-20';fields.deadlineStartTime.value='12:00';fields.deadlineEndDate.value='2026-10-19';fields.deadlineEndTime.value='12:00';fields.deadlineHideAt.value='';
  form.onsubmit({preventDefault(){},currentTarget:form});
  assert.equal(app.run('calendar.countdown'),undefined);
});

test('invoice partial payments retain totals and distinguish partial, open and paid filters', () => {
  const app = setup();
  app.run(`invoiceFiles = [{id:'a',name:'Hostel',note:'Anzahlung',category:'unterkunft',amountCents:186000,paidCents:60000,paid:false,uploadedAt:'2026-10-20'}];`);
  app.node('#invoice-category-filter').value = 'all';
  app.node('#invoice-state').value = 'partial';
  assert.equal(app.run('visibleInvoices().length'), 1);
  assert.equal(app.run('remainingCents(invoiceFiles[0])'), 126000);
  assert.equal(app.run('invoiceSum(invoiceFiles)'), 186000);
  assert.equal(app.run('paymentLabel(invoiceFiles[0])'), 'Teilbezahlt');
  app.node('#invoice-state').value = 'paid';
  assert.equal(app.run('visibleInvoices().length'), 0);
  app.node('#invoice-state').value = 'open';
  assert.equal(app.run('visibleInvoices().length'), 1);
  assert.equal(app.run('paidCents({amountCents:1000,paid:true})'), 1000);
});


test('invoice budget multiplies the student limit in cents and preserves legacy totals', () => {
  const app = setup();
  app.node('#budget-limit').value = '249,99';
  app.node('#budget-students').value = '24';
  assert.equal(app.run('calculateInvoiceBudget()'), 599976);
  assert.equal(app.node('#budget-amount').value, '5999,76');
  app.node('#budget-students').value = '25';
  assert.equal(app.run('calculateInvoiceBudget()'), 624975);
  app.node('#budget-limit').value = '0';
  assert.equal(app.run('calculateInvoiceBudget()'), 0);
  app.node('#budget-students').value = '';
  assert.throws(() => app.run('calculateInvoiceBudget()'), /Anzahl/);
  app.node('#budget-limit').value = '99999999';
  app.node('#budget-students').value = '100000';
  assert.throws(() => app.run('calculateInvoiceBudget()'), /zu groß/);
  app.run('invoiceBudget = {budgetCents: 10000, students: 3}; resetBudgetInputs()');
  assert.equal(app.node('#budget-limit').value, '');
  assert.equal(app.run('calculateInvoiceBudget()'), 10000);
  app.run('invoiceBudget = {budgetCents: 600000, students: 24}; resetBudgetInputs()');
  assert.equal(app.node('#budget-limit').value, '250,00');
});

test('invoice categories include unused budget and use budget percentages', () => {
  const app = setup();
  const makeNode = () => ({children: [], style: {setProperty() {}}, append(...items) {this.children.push(...items)}, setAttribute() {}, addEventListener() {}});
  app.context.document.createElement = makeNode;
  for (const id of ['#category-bar', '#category-legend']) {
    Object.assign(app.node(id), makeNode());
    app.node(id).replaceChildren = function() {this.children = []};
  }
  app.run(`invoiceBudget = {budgetCents: 20000, students: 2};
    invoiceFiles = [{category: 'fahrt', amountCents: 5000}]; renderCategories(5000)`);
  const legend = app.node('#category-legend').children;
  assert.equal(legend[0].children[2].textContent, '25 %');
  assert.equal(legend[1].children[0].textContent, 'Frei');
  assert.match(legend[1].children[1].textContent, /150,00/);
  assert.equal(legend[1].children[2].textContent, '75 %');
  app.run('renderCategories(25000)');
  assert.equal(app.node('#category-legend').children.length, 1);
  app.run('invoiceFiles = []; renderCategories(0)');
  assert.equal(app.node('.invoice-categories').hidden, false);
  assert.equal(app.node('#category-legend').children[0].children[2].textContent, '100 %');
  app.run('invoiceBudget.budgetCents = null; renderCategories(0)');
  assert.equal(app.node('.invoice-categories').hidden, true);
});

test('invoice editor previews the balance and fills full payment without saving', () => {
  const app = setup();
  app.context.queueMicrotask = () => {};
  app.context.document.createElement = () => ({
    children: [], listeners: {}, classList: {add() {}},
    append(...items) {this.children.push(...items)},
    setAttribute() {}, addEventListener(type, listener) {this.listeners[type] = listener},
  });
  const form = app.run(`invoiceEditor({amountCents:186000,paidCents:60000,paid:false,category:'unterkunft',note:'Anzahlung'})`);
  const amounts = form.children[1], balance = form.children[2];
  const total = amounts.children[0].children[1], payment = amounts.children[1].children[1], full = amounts.children[2];
  assert.match(balance.textContent, /1.260,00/);
  full.listeners.click();
  assert.equal(payment.value, '1860,00');
  assert.match(balance.textContent, /vollständig bezahlt/);
  assert.equal(app.published(), undefined);
  payment.value = '2000'; payment.listeners.input();
  assert.match(balance.textContent, /höher/);
  total.value = 'ungültig'; total.listeners.input();
  assert.equal(full.disabled, true);
  const actions = form.children[4];
  assert.equal(actions.children[0].textContent, 'Änderungen speichern');
  assert.equal(actions.children[1].textContent, 'Abbrechen');
});


test('saving an event stages it without publishing; only Publish sends the plan', async () => {
  const app = setup(), form = app.node('#editor');
  const values = {title:'Museum',day:'1',lane:'',location:'',latitude:'',longitude:'',note:'',responsible:'',type:'program',status:'confirmed',display:'normal',timing:'scheduled',startTime:'08:00',endTime:'09:00',showMap:''};
  for (const [name,value] of Object.entries(values)) form.elements[name] = {name,value,checked:false};
  form.reportValidity = () => true;
  app.context.window.applyJourneyDraft = () => true;
  app.run(`calendar.days = [{isoDate:'2026-10-23'}];
    selected = 'museum'; draft = {id:'museum',mapRoute:{points:[]}}; editing = true;`);
  form.listeners.submit({preventDefault(){}});
  assert.equal(app.published(), undefined);
  assert.equal(app.run('calendar.events[0].title'), 'Museum');
  assert.equal(app.run('editing'), false);
  assert.equal(app.run('dirty'), true);
  assert.equal(app.node('#save').disabled, false);
  assert.equal(app.node('#save-event').disabled, true);
  assert.match(app.node('#status').textContent, /nichts veröffentlicht/);
  await app.node('#save').onclick();
  assert.equal(app.published().calendar.events[0].title, 'Museum');
  assert.equal(app.run('dirty'), false);
});

test('invalid event cannot be saved to the draft or published', async () => {
  const app = setup();
  app.run('editing = true; applyDraft = () => false;');
  app.node('#editor').listeners.submit({preventDefault(){}});
  await app.node('#save').onclick();
  assert.equal(app.published(), undefined);
  assert.equal(app.run('editing'), true);
  assert.equal(app.run('calendar.events.length'), 0);
});

test('publication summary counts added, edited and deleted events and resets after publication',async()=>{
 const app=setup();
 app.run(`calendar.events = [{id:'keep',title:'Before'},{id:'remove',title:'Remove'}]; publishedCalendar=structuredClone(calendar);
   calendar.events = [{id:'keep',title:'After'},{id:'new',title:'New'}]; dirty=true; controls();`);
 assert.match(app.node('#publish-summary').textContent,/1 neu · 1 geändert · 1 gelöscht/);
 await app.node('#save').onclick();assert.equal(app.node('#publish-summary').textContent,'');assert.match(app.node('#status').textContent,/online neu laden/);
});
