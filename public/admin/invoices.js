"use strict";
let invoiceCsrf,
  invoiceFiles = [],
  invoiceBudget = { budgetCents: null, students: null },
  invoiceEditing = null;
const invoiceCategories = [
  ["unterkunft", "Unterkunft", "#2f5d8a"],
  ["fahrt", "Fahrt", "#c81d25"],
  ["eintritt", "Eintritte & Programm", "#d08a1a"],
  ["verpflegung", "Verpflegung", "#3d8a5a"],
  ["sonstiges", "Sonstiges", "#8a8d86"],
];
const categoryInfo = (id) =>
  invoiceCategories.find(([key]) => key === id) || invoiceCategories.at(-1);
const invoiceSize = (bytes) =>
  bytes < 1024 * 1024
    ? Math.max(1, Math.round(bytes / 1024)) + " KB"
    : (bytes / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
const euro = (cents) =>
  (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const centsText = (cents) =>
  cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
function parseEuro(text) {
  const value = text.trim().replace(/\s|€/g, "");
  if (!value) return null;
  const normalized = value.includes(",")
    ? value.replace(/\./g, "").replace(",", ".")
    : value;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(normalized))
    throw new Error("Bitte den Betrag als Zahl eingeben, z. B. 24,90.");
  return Math.round(Number(normalized) * 100);
}
const option = (label, value, selected = false) => {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  node.selected = selected;
  return node;
};
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
function categorySelect(value) {
  const select = el("select");
  for (const [key, label] of invoiceCategories)
    select.append(option(label, key, key === value));
  return select;
}
const invoiceSum = (files) =>
  files.reduce((sum, file) => sum + (file.amountCents || 0), 0);
const paidCents = (file) => file.paidCents ?? (file.paid ? file.amountCents ?? 0 : 0);
const remainingCents = (file) => file.amountCents == null ? null : file.amountCents - paidCents(file);
const paymentLabel = (file) => file.paid ? "Bezahlt" : paidCents(file) > 0 ? "Teilbezahlt" : "Offen";
function visibleInvoices() {
  const query = $("#invoice-search").value.trim().toLowerCase(),
    sort = $("#invoice-sort").value;
  const category = $("#invoice-category-filter").value,
    state = $("#invoice-state").value;
  const files = invoiceFiles.filter(
    (file) =>
      (!query || (file.name + " " + file.note).toLowerCase().includes(query)) &&
      (category === "all" || file.category === category) &&
      (state === "all" ||
        (state === "paid"
          ? file.paid
          : state === "partial"
            ? !file.paid && paidCents(file) > 0
          : state === "open"
            ? !file.paid
            : file.amountCents === null)),
  );
  return files.sort((a, b) =>
    sort === "name"
      ? a.name.localeCompare(b.name, "de")
      : sort === "amount"
        ? (b.amountCents ?? -1) - (a.amountCents ?? -1)
        : sort === "old"
          ? a.uploadedAt.localeCompare(b.uploadedAt)
          : b.uploadedAt.localeCompare(a.uploadedAt),
  );
}
async function patchInvoice(file, changes) {
  const response = await adminFetch("/api/admin/invoices/" + file.id, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": invoiceCsrf,
    },
    body: JSON.stringify(changes),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  invoiceFiles = invoiceFiles.map((entry) =>
    entry.id === file.id ? data : entry,
  );
  return data;
}
function invoiceEditor(file) {
  const form = el("form", "invoice-edit");
  const amount = el("input"),
    payment = el("input"),
    note = el("input"),
    category = categorySelect(file.category);
  amount.inputMode = "decimal";
  amount.placeholder = "z. B. 24,90";
  amount.value = centsText(file.amountCents);
  payment.inputMode = "decimal";
  payment.value = centsText(paidCents(file));
  note.maxLength = 300;
  note.placeholder = "z. B. Museumseintritt Gruppe";
  note.value = file.note;
  const field = (label, input) => {
    const wrap = el("label");
    wrap.append(el("span", null, label), input);
    return wrap;
  };
  const save = el("button", "primary", "Speichern"),
    cancel = el("button", "ghost", "Abbrechen"),
    status = el("p", "upload-status");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    invoiceEditing = null;
    renderInvoices();
  });
  save.textContent = "Änderungen speichern";
  status.setAttribute("role", "status");
  const amounts = el("div", "invoice-edit-amounts"),
    details = el("div", "invoice-edit-details"),
    actions = el("div", "invoice-edit-actions"),
    balance = el("p", "invoice-edit-balance"),
    fullPayment = el("button", "ghost", "Vollständig bezahlt");
  fullPayment.type = "button";
  balance.setAttribute("role", "status");
  const updateBalance = () => {
    try {
      const total = parseEuro(amount.value), paid = parseEuro(payment.value) ?? 0;
      if (total === null) {
        balance.textContent = "Bitte den Rechnungsbetrag eintragen.";
        fullPayment.disabled = true;
      } else {
        balance.textContent = paid > total
          ? "Der bezahlte Betrag ist höher als der Rechnungsbetrag."
          : paid === total ? "Diese Rechnung ist vollständig bezahlt."
          : "Noch zu bezahlen: " + euro(total - paid);
        fullPayment.disabled = false;
      }
    } catch (error) {
      balance.textContent = error.message;
      fullPayment.disabled = true;
    }
  };
  amount.addEventListener("input", updateBalance);
  payment.addEventListener("input", updateBalance);
  fullPayment.addEventListener("click", () => {
    payment.value = centsText(parseEuro(amount.value));
    updateBalance();
  });
  amounts.append(field("Rechnungsbetrag in €", amount), field("Davon bereits bezahlt in €", payment), fullPayment);
  details.append(field("Kategorie", category), field("Notiz (optional)", note));
  actions.append(save, cancel);
  form.append(el("strong", "invoice-edit-title", "Rechnung und Zahlung bearbeiten"), amounts, balance, details, actions, status);
  updateBalance();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const total = parseEuro(amount.value), paid = parseEuro(payment.value) ?? 0;
      if (paid > 0 && (total === null || paid > total))
        throw Error("Bitte einen Rechnungsbetrag eintragen, der mindestens dem bezahlten Betrag entspricht.");
      await patchInvoice(file, {
        amountCents: total,
        paidCents: paid,
        category: category.value,
        note: note.value,
      });
      invoiceEditing = null;
      renderInvoices();
    } catch (error) {
      status.classList.add("error");
      status.textContent = error.message;
      save.disabled = false;
    }
  });
  queueMicrotask(() => amount.focus());
  return form;
}
function invoiceRow(file) {
  const url = "/api/admin/invoices/" + file.id,
    row = el("div", "invoice-row" + (file.paid ? " is-paid" : ""));
  const [, categoryLabel, color] = categoryInfo(file.category);
  const icon = el(
    "span",
    "resource-icon",
    file.name.includes(".")
      ? file.name.split(".").pop().toUpperCase().slice(0, 4)
      : "DATEI",
  );
  const copy = el("div", "invoice-copy"),
    title = el("a", "invoice-name", file.name);
  title.href = url;
  title.target = "_blank";
  title.rel = "noopener";
  title.title = "Ansehen";
  const meta = el("span", "invoice-meta"),
    pill = el("span", "category-pill", categoryLabel);
  pill.style.setProperty("--dot", color);
  meta.append(
    pill,
    document.createTextNode(
      new Date(file.uploadedAt).toLocaleDateString("de-DE") +
        " · " +
        invoiceSize(file.size),
    ),
  );
  copy.append(title, meta);
  if (file.note) copy.append(el("span", "invoice-note", file.note));
  const amount =
    file.amountCents != null
      ? el("span", "invoice-amount", euro(file.amountCents))
      : el("button", "invoice-amount missing", "Betrag eintragen");
  if (file.amountCents == null) {
    amount.type = "button";
    amount.addEventListener("click", () => {
      invoiceEditing = file.id;
      renderInvoices();
    });
  }
  if (file.amountCents != null) copy.append(el("span", "invoice-note", "Bezahlt: " + euro(paidCents(file)) + " · Restbetrag: " + euro(remainingCents(file))));
  const paid = el("button", "paid-toggle", paymentLabel(file));
  paid.type = "button";
  paid.setAttribute("aria-pressed", String(file.paid));
  paid.title = "Zahlung bearbeiten";
  paid.addEventListener("click", () => {
    invoiceEditing = file.id;
    renderInvoices();
  });
  const actions = el("div", "invoice-actions");
  const edit = el("button", null, "Bearbeiten"),
    download = el("a", null, "Herunterladen"),
    remove = el("button", "delete-material", "Löschen");
  edit.type = "button";
  edit.setAttribute("aria-expanded", String(invoiceEditing === file.id));
  edit.addEventListener("click", () => {
    invoiceEditing = invoiceEditing === file.id ? null : file.id;
    renderInvoices();
  });
  download.href = url + "?download";
  download.download = file.name;
  download.title = "Herunterladen";
  remove.type = "button";
  remove.addEventListener("click", async () => {
    if (!confirm("„" + file.name + "“ endgültig löschen?")) return;
    remove.disabled = true;
    try {
      const response = await adminFetch(url, {
        method: "DELETE",
        headers: { "X-CSRF-Token": invoiceCsrf, "X-Confirm-Delete": "yes" },
      });
      if (!response.ok) throw new Error((await response.json()).error);
      invoiceFiles = invoiceFiles.filter((entry) => entry.id !== file.id);
      renderInvoices();
    } catch (error) {
      $("#invoice-status").textContent = error.message;
      remove.disabled = false;
    }
  });
  actions.append(edit, download, remove);
  row.append(icon, copy, amount, paid, actions);
  if (invoiceEditing === file.id) row.append(invoiceEditor(file));
  return row;
}
function renderInvoices() {
  const total = invoiceSum(invoiceFiles),
    files = visibleInvoices();
  $("#invoice-total").textContent = euro(total);
  $("#invoice-count").textContent =
    invoiceFiles.length === 1 ? "1 Beleg" : invoiceFiles.length + " Belege";
  const open = invoiceFiles.filter((file) => !file.paid);
  $("#invoice-open").textContent = euro(open.reduce((sum, file) => sum + (remainingCents(file) ?? 0), 0));
  $("#invoice-open-detail").textContent = open.length
    ? open.length + " offen oder teilbezahlt" + (open.some(file => file.amountCents == null) ? " · Beträge fehlen" : "")
    : "Alles bezahlt";
  renderInvoiceBudget(total);
  renderCategories(total);
  const list = $("#invoice-list");
  list.replaceChildren();
  if (!files.length) {
    list.append(
      el(
        "p",
        "resource-empty",
        invoiceFiles.length
          ? "Keine Belege passend zum Filter."
          : "Noch keine Rechnungen oder Belege. Mit „+ Belege hinzufügen“ geht es los.",
      ),
    );
  } else for (const file of files) list.append(invoiceRow(file));
  const filtered = files.length !== invoiceFiles.length;
  $("#invoice-foot").textContent = files.length
    ? (filtered
        ? files.length + " von " + invoiceFiles.length + " Belegen"
        : files.length === 1
          ? "1 Beleg"
          : files.length + " Belege") +
      " · Summe " +
      euro(invoiceSum(files))
    : "";
}
function renderCategories(total) {
  const bar = $("#category-bar"),
    legend = $("#category-legend"),
    active = $("#invoice-category-filter").value;
  bar.replaceChildren();
  legend.replaceChildren();
  const budget = invoiceBudget.budgetCents;
  const free = budget === null ? 0 : Math.max(0, budget - total);
  const basis = Math.max(total, budget ?? 0);
  $(".invoice-categories").hidden = !invoiceFiles.length && budget === null;
  for (const [key, label, color] of invoiceCategories) {
    const files = invoiceFiles.filter((file) => file.category === key),
      sum = invoiceSum(files);
    if (!files.length) continue;
    if (sum) {
      const part = el("span");
      part.style.cssText = "flex-grow:" + sum + ";background:" + color;
      bar.append(part);
    }
    const item = el("button", "legend-item");
    item.type = "button";
    item.style.setProperty("--dot", color);
    item.setAttribute("aria-pressed", String(active === key));
    item.title =
      active === key ? "Filter aufheben" : "Nur " + label + " anzeigen";
    item.append(
      el("span", "legend-label", label),
      el("strong", null, euro(sum)),
      el(
        "span",
        "legend-share",
        basis ? Math.round((sum / basis) * 100) + " %" : "–",
      ),
    );
    item.addEventListener("click", () => {
      const filter = $("#invoice-category-filter");
      filter.value = filter.value === key ? "all" : key;
      renderInvoices();
    });
    legend.append(item);
  }
  if (free > 0) {
    const color = "#3d8a5a";
    const part = el("span");
    part.style.cssText = "flex-grow:" + free + ";background:" + color;
    bar.append(part);
    const item = el("span", "legend-item");
    item.style.setProperty("--dot", color);
    item.append(
      el("span", "legend-label", "Frei"),
      el("strong", null, euro(free)),
      el("span", "legend-share", Math.round((free / basis) * 100) + " %"),
    );
    legend.append(item);
  }
  bar.hidden = !basis;
  const missing = invoiceFiles.filter(
    (file) => file.amountCents === null,
  ).length;
  $("#budget-missing").textContent = missing
    ? (missing === 1 ? "1 Beleg hat" : missing + " Belege haben") +
      " noch keinen Betrag und " +
      (missing === 1 ? "ist" : "sind") +
      " nicht eingerechnet."
    : "";
}
function renderInvoiceBudget(total = invoiceSum(invoiceFiles)) {
  const { budgetCents: budget, students } = invoiceBudget;
  const remaining = budget === null ? null : budget - total;
  const percent =
    budget > 0 ? Math.min(100, (total / budget) * 100) : total > 0 ? 100 : 0;
  const progress = $("#budget-progress");
  progress.style.width = (budget === null ? 0 : percent) + "%";
  progress.classList.toggle("over", remaining !== null && remaining < 0);
  progress.classList.toggle(
    "warn",
    remaining !== null && remaining >= 0 && percent >= 85,
  );
  $("#budget-edit").textContent = budget === null ? "festlegen" : "ändern";
  $("#budget-remaining").textContent =
    remaining === null
      ? "Nicht festgelegt"
      : euro(Math.abs(remaining)) + (remaining < 0 ? " drüber" : " übrig");
  $("#budget-remaining").classList.toggle(
    "over",
    remaining !== null && remaining < 0,
  );
  $("#budget-detail").textContent =
    budget === null
      ? "Budget festlegen, um den Verbrauch zu sehen"
      : (budget > 0 ? Math.round((total / budget) * 100) + " % von " : "von ") +
        euro(budget) +
        " verbraucht";
  $("#budget-per-student").textContent = students
    ? euro(total / students)
    : "–";
  $("#budget-per-student-detail").textContent = !students
    ? "Schülerzahl unter „Budget“ eintragen"
    : budget === null
      ? students + " Schüler"
      : "von " + euro(budget / students) + " · " + students + " Schüler";
}
async function loadInvoices() {
  const status = $("#invoice-status");
  status.textContent = "Belege werden geladen …";
  try {
    const response = await adminFetch("/api/admin/invoices", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    invoiceCsrf = data.csrf;
    invoiceFiles = data.files;
    await loadInvoiceBudget();
    status.textContent = "";
    renderInvoices();
  } catch (error) {
    status.textContent = error.message;
  }
}
async function loadInvoiceBudget() {
  $("#budget-save").disabled = true;
  try {
    const response = await adminFetch("/api/admin/invoice-budget", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    invoiceBudget = data;
    invoiceCsrf = data.csrf;
    resetBudgetInputs();
    $("#budget-status").textContent = "";
    $("#budget-save").disabled = false;
  } catch (error) {
    $("#budget-status").textContent = error.message;
  }
}
function toggleBudgetForm(open) {
  $("#budget-form").hidden = !open;
  $("#budget-edit").setAttribute("aria-expanded", String(open));
  if (open) $("#budget-limit").focus();
}
function resetBudgetInputs() {
  const { budgetCents, students } = invoiceBudget;
  $("#budget-amount").value = centsText(budgetCents);
  $("#budget-students").value = students ?? "";
  // Preserve older totals that cannot be split into whole cents per student.
  $("#budget-limit").value = students && budgetCents !== null && budgetCents % students === 0
    ? centsText(budgetCents / students) : "";
  $("#budget-amount").readOnly = $("#budget-limit").value !== "";
}
function calculateInvoiceBudget() {
  const limit = parseEuro($("#budget-limit").value);
  const students = Number($("#budget-students").value);
  $("#budget-amount").readOnly = limit !== null;
  if (limit === null) return parseEuro($("#budget-amount").value);
  if (!Number.isInteger(students) || students < 1 || students > 100000)
    throw Error("Bitte die Anzahl der Schüler eingeben (1 bis 100000).");
  const total = limit * students;
  if (!Number.isSafeInteger(total) || total > 9999999999)
    throw Error("Das berechnete Gesamtbudget ist zu groß.");
  $("#budget-amount").value = centsText(total);
  return total;
}
for (const id of ["#budget-limit", "#budget-students"])
  $(id).addEventListener("input", () => {
    try {
      calculateInvoiceBudget();
      $("#budget-status").textContent = "";
    } catch (error) {
      if ($("#budget-limit").value.trim()) $("#budget-amount").value = "";
      $("#budget-status").textContent = error.message;
    }
  });
$("#budget-edit").addEventListener("click", () =>
  toggleBudgetForm($("#budget-form").hidden),
);
$("#budget-cancel").addEventListener("click", () => {
  resetBudgetInputs();
  toggleBudgetForm(false);
});
$("#budget-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  let budgetCents;
  try {
    budgetCents = calculateInvoiceBudget();
  } catch (error) {
    $("#budget-status").textContent = error.message;
    return;
  }
  const students = $("#budget-students").value;
  $("#budget-save").disabled = true;
  try {
    const response = await adminFetch("/api/admin/invoice-budget", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": invoiceCsrf,
      },
      body: JSON.stringify({
        budgetCents,
        students: students ? Number(students) : null,
        revision: invoiceBudget.revision,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    invoiceBudget = data;
    $("#budget-status").textContent = "";
    renderInvoices();
    toggleBudgetForm(false);
  } catch (error) {
    $("#budget-status").textContent = error.message;
  } finally {
    $("#budget-save").disabled = false;
  }
});
$("#invoice-search").addEventListener("input", renderInvoices);
for (const id of [
  "#invoice-category-filter",
  "#invoice-state",
  "#invoice-sort",
])
  $(id).addEventListener("change", renderInvoices);
$("#invoice-toggle").addEventListener("click", () => {
  const form = $("#invoice-upload");
  form.hidden = !form.hidden;
  $("#invoice-toggle").setAttribute("aria-expanded", String(!form.hidden));
  if (!form.hidden)
    form.scrollIntoView({ block: "nearest", behavior: "smooth" });
});
$("#invoice-export").addEventListener("click", () => {
  const cell = (value) =>
    /[";\n]/.test(String(value))
      ? '"' + String(value).replace(/"/g, '""') + '"'
      : String(value);
  const rows = [
    ["Datum", "Datei", "Kategorie", "Betrag (EUR)", "Bezahlt (EUR)", "Restbetrag (EUR)", "Status", "Notiz"],
  ];
  for (const file of visibleInvoices())
    rows.push([
      new Date(file.uploadedAt).toLocaleDateString("de-DE"),
      file.name,
      categoryInfo(file.category)[1],
      centsText(file.amountCents),
      centsText(paidCents(file)),
      centsText(remainingCents(file)),
      paymentLabel(file),
      file.note,
    ]);
  const link = el("a");
  link.href = URL.createObjectURL(
    new Blob(["﻿" + rows.map((row) => row.map(cell).join(";")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  link.download =
    "Rechnungen-" + new Date().toISOString().slice(0, 10) + ".csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
function guessCategory(name) {
  const text = name.toLowerCase();
  if (/hotel|hostel|herberge|djh|unterkunft|übernacht/.test(text))
    return "unterkunft";
  if (/bahn|\bdb\b|ticket|bus|zug|flug|taxi|fahr/.test(text)) return "fahrt";
  if (/eintritt|museum|führung|tour|programm|zoo|theater/.test(text))
    return "eintritt";
  if (
    /essen|restaurant|verpflegung|mensa|café|cafe|bäcker|supermarkt|rewe|edeka|aldi|lidl/.test(
      text,
    )
  )
    return "verpflegung";
  return "sonstiges";
}
function describeInvoiceSelection() {
  const files = Array.from($("#invoice-file").files),
    items = $("#invoice-items");
  $("#invoice-upload-status").classList.remove("error");
  $("#invoice-upload-status").textContent = "";
  items.replaceChildren();
  items.hidden = $("#invoice-shared").hidden = !files.length;
  $("#invoice-drop").classList.toggle("compact", files.length > 0);
  for (const file of files) {
    const row = el("div", "upload-item"),
      amount = el("input"),
      category = categorySelect(guessCategory(file.name));
    amount.inputMode = "decimal";
    amount.placeholder = "Betrag in €";
    amount.setAttribute("aria-label", "Betrag für " + file.name);
    category.setAttribute("aria-label", "Kategorie für " + file.name);
    const name = el("span", "upload-item-name");
    name.append(
      el("strong", null, file.name),
      el("small", null, invoiceSize(file.size)),
    );
    row.append(name, amount, category);
    items.append(row);
  }
  $("#invoice-submit").textContent =
    files.length > 1 ? files.length + " Belege hochladen" : "Hochladen";
  items.querySelector("input")?.focus();
}
$("#invoice-file").addEventListener("change", describeInvoiceSelection);
for (const type of ["dragenter", "dragover"])
  $("#invoice-drop").addEventListener(type, (event) => {
    event.preventDefault();
    $("#invoice-drop").classList.add("dragging");
  });
for (const type of ["dragleave", "drop"])
  $("#invoice-drop").addEventListener(type, () =>
    $("#invoice-drop").classList.remove("dragging"),
  );
$("#invoice-drop").addEventListener("drop", (event) => {
  event.preventDefault();
  if (!event.dataTransfer?.files.length) return;
  $("#invoice-file").files = event.dataTransfer.files;
  describeInvoiceSelection();
});
function sendInvoice(file, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", "/api/admin/invoices");
    request.responseType = "json";
    for (const [name, value] of Object.entries(headers))
      request.setRequestHeader(name, value);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () =>
      request.status >= 200 && request.status < 300
        ? resolve(request.response)
        : reject(
            new Error(
              request.response?.error ||
                "Upload fehlgeschlagen (HTTP " + request.status + ").",
            ),
          ),
    );
    request.addEventListener("error", () =>
      reject(new Error("Upload fehlgeschlagen. Bitte die Verbindung prüfen.")),
    );
    request.send(file);
  });
}
const encodeHeader = (value) => {
  let binary = "";
  for (const byte of new TextEncoder().encode(value))
    binary += String.fromCharCode(byte);
  return btoa(binary);
};
$("#invoice-upload").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    status = $("#invoice-upload-status"),
    submit = $("#invoice-submit");
  const files = Array.from($("#invoice-file").files),
    rows = Array.from($("#invoice-items").children);
  if (!files.length || !invoiceCsrf || submit.disabled) return;
  status.classList.add("error");
  const invalid = files.find(
    (file) => !file.size || file.size > 25 * 1024 * 1024,
  );
  if (invalid) {
    status.textContent =
      "„" + invalid.name + "“ ist leer oder größer als 25 MB.";
    return;
  }
  let amounts;
  try {
    amounts = rows.map((row) => parseEuro(row.querySelector("input").value));
  } catch (error) {
    status.textContent = error.message;
    return;
  }
  const note = $("#invoice-note").value.trim(),
    paid = $("#invoice-paid").checked,
    failures = [];
  submit.disabled = true;
  status.classList.remove("error");
  for (const [index, file] of files.entries()) {
    const headers = {
      "X-CSRF-Token": invoiceCsrf,
      "X-File-Name": encodeHeader(file.name),
      "X-File-Category": rows[index].querySelector("select").value,
    };
    if (note) headers["X-File-Note"] = encodeHeader(note);
    if (amounts[index] !== null)
      headers["X-File-Amount-Cents"] = String(amounts[index]);
    if (paid) headers["X-File-Paid"] = "yes";
    try {
      await sendInvoice(file, headers, (percent) => {
        status.textContent =
          (files.length > 1
            ? "Datei " + (index + 1) + " von " + files.length + ": "
            : "") +
          file.name +
          " … " +
          percent +
          " %";
      });
    } catch (error) {
      failures.push(file.name + ": " + error.message);
    }
  }
  submit.disabled = false;
  if (failures.length) {
    status.classList.add("error");
    status.textContent = failures.join(" ");
  } else {
    form.reset();
    describeInvoiceSelection();
    status.textContent =
      files.length === 1
        ? "Beleg hochgeladen."
        : files.length + " Belege hochgeladen.";
  }
  await loadInvoices();
});
