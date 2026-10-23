/* Keep the existing newline-based API while offering editable participant chips. */
(() => {
  const input = document.querySelector('#participant-input');
  const list = document.querySelector('#participant-list');
  const value = document.querySelector('[name="TRIP_PARTICIPANTS"]');
  const status = document.querySelector('#participant-status');
  let names = [];
  const split = text => text.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  function validate(next) {
    const valid = next.length <= 300 && next.every(name => name.length <= 100) && next.join('\n').length <= 12000;
    status.textContent = valid ? '' : 'Bitte höchstens 300 Personen mit jeweils maximal 100 Zeichen hinzufügen (insgesamt maximal 12.000 Zeichen).';
    return valid;
  }
  function render() {
    value.value = names.join('\n');
    list.replaceChildren();
    names.forEach((name, index) => {
      const item = document.createElement('li');
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'participant-name';
      edit.textContent = name;
      edit.setAttribute('aria-label', name + ' bearbeiten');
      edit.onclick = () => {
        const field = document.createElement('input');
        field.type = 'text';
        field.value = name;
        field.maxLength = 100;
        field.setAttribute('aria-label', 'Name bearbeiten');
        let finished = false;
        const finish = cancel => {
          if (finished) return;
          const changed = field.value.trim();
          if (!cancel && (!changed || !validate(names.map((n, i) => i === index ? changed : n)))) {
            field.setCustomValidity('Bitte einen Namen mit maximal 100 Zeichen eingeben.');
            field.reportValidity();
            return;
          }
          finished = true;
          if (!cancel) names[index] = changed;
          render();
          if (!cancel) status.textContent = 'Name geändert. Bitte Reise speichern.';
          list.children[index]?.querySelector('button').focus();
        };
        field.oninput = () => field.setCustomValidity('');
        field.onkeydown = event => {
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault();
            finish(event.key === 'Escape');
          }
        };
        field.onblur = () => finish(false);
        edit.replaceWith(field);
        field.focus();
        field.select();
      };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'participant-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', name + ' entfernen');
      remove.onclick = () => {
        names.splice(index, 1);
        render();
        status.textContent = name + ' entfernt. Bitte Reise speichern.';
        const next = list.children[Math.min(index, names.length - 1)];
        (next?.querySelector('.participant-remove') || input).focus();
      };
      item.append(edit, remove);
      list.append(item);
    });
  }
  function commit() {
    // A blank inline edit must also block the outer settings form.
    const editing = list.querySelector('input');
    if (editing) {
      editing.blur();
      if (list.querySelector('input')) { editing.focus(); return false; }
    }
    const added = split(input.value);
    if (!validate([...names, ...added])) { input.focus(); return false; }
    names.push(...added);
    input.value = '';
    render();
    if (added.length) status.textContent = added.length + ' hinzugefügt. Bitte Reise speichern.';
    return true;
  }
  document.querySelector('#participant-add').onclick = () => { if (commit()) input.focus(); };
  input.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      commit();
    }
  };
  window.ParticipantEditor = {set(next) { names = [...next]; input.value = ''; status.textContent = ''; render(); }, commit};
})();
