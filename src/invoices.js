import * as materials from "./legacy/api/materials.js";
import { json } from "./http.js";
const previewTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
function invoiceType(name) {
  return (
    {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
    }[name.split(".").pop().toLowerCase()] || "application/octet-stream"
  );
}
const invoiceCategories = new Set([
  "unterkunft",
  "fahrt",
  "eintritt",
  "verpflegung",
  "sonstiges",
]);
const paidAmount = (m) => Number.isSafeInteger(m.paidCents) ? m.paidCents : m.paid === true ? (m.amountCents ?? 0) : 0;
const invoiceView = (id, m) => ({
  id,
  name: m.name,
  size: m.size,
  uploadedAt: m.uploadedAt,
  note: m.note || "",
  amountCents: Number.isSafeInteger(m.amountCents) ? m.amountCents : null,
  category: invoiceCategories.has(m.category) ? m.category : "sonstiges",
  paidCents: paidAmount(m),
  remainingCents: m.amountCents == null ? null : m.amountCents - paidAmount(m),
  paid: m.amountCents == null ? m.paid === true : paidAmount(m) >= m.amountCents,
});
function decodeHeader(request, name) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(request.headers.get(name) || ""), (c) =>
        c.charCodeAt(0),
      ),
    );
  } catch {
    return "";
  }
}

export async function invoices(request, session) {
  const url = new URL(request.url),
    method = request.method;
  const base = "/api/admin/invoices",
    id = url.pathname === base ? null : url.pathname.slice(base.length + 1);
  if (
    id &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      id,
    )
  )
    return json({ error: "Ungültige Datei." }, 400);
  const prefix = "_admin-invoices/";
  if (!id && method === "GET") {
    const page = await this.cloud.list({ prefix });
    return json({
      csrf: session.csrf,
      files: page.keys.map((item) =>
        invoiceView(item.name.slice(prefix.length), item.metadata),
      ),
    });
  }
  if (!id && method === "PUT") {
    const name = decodeHeader(request, "x-file-name"),
      raw = request.headers.get("content-length");
    const size = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!name || name.length > 255 || !request.body)
      return json({ error: "Dateiname und Datei erforderlich." }, 400);
    if (!Number.isSafeInteger(size) || size < 1 || size > 25 * 1024 * 1024)
      return json(
        { error: "Bitte eine Datei mit höchstens 25 MB hochladen." },
        413,
      );
    const note = decodeHeader(request, "x-file-note").trim(),
      amountRaw = request.headers.get("x-file-amount-cents");
    if (note.length > 300)
      return json(
        { error: "Die Notiz darf höchstens 300 Zeichen lang sein." },
        400,
      );
    if (amountRaw !== null && !/^\d{1,10}$/.test(amountRaw))
      return json({ error: "Ungültiger Betrag." }, 400);
    const category = request.headers.get("x-file-category") || "sonstiges";
    if (!invoiceCategories.has(category))
      return json({ error: "Unbekannte Kategorie." }, 400);
    const id = crypto.randomUUID(),
      metadata = {
        name: materials.safeFilename(name),
        type: invoiceType(name),
        uploadedAt: new Date().toISOString(),
        category,
      };
    if (note) metadata.note = note;
    if (amountRaw !== null) metadata.amountCents = Number(amountRaw);
    if (request.headers.get("x-file-paid") === "yes") metadata.paid = true;
    await this.cloud.putFile(prefix + id, request.body, metadata, size);
    return json({ saved: true, id }, 201);
  }
  if (id && method === "PATCH") {
    const text = await request.text();
    if (text.length > 20000) return json({ error: "Eingabe zu groß." }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "Ungültige Eingabe." }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({error: "Ungültige Eingabe."}, 400);
    const current = await this.cloud.metadata(prefix + id);
    if (!current) return json({error: "Datei nicht gefunden."}, 404);
    const fields = {};
    if ("amountCents" in body) {
      if (
        !(
          body.amountCents === null ||
          (Number.isSafeInteger(body.amountCents) &&
            body.amountCents >= 0 &&
            body.amountCents <= 9999999999)
        )
      )
        return json({ error: "Ungültiger Betrag." }, 400);
      fields.amountCents = body.amountCents ?? undefined;
    }
    if ("note" in body) {
      if (typeof body.note !== "string" || body.note.trim().length > 300)
        return json(
          { error: "Die Notiz darf höchstens 300 Zeichen lang sein." },
          400,
        );
      fields.note = body.note.trim() || undefined;
    }
    if ("category" in body) {
      if (!invoiceCategories.has(body.category))
        return json({ error: "Unbekannte Kategorie." }, 400);
      fields.category = body.category;
    }
    if ("paid" in body) {
      if (typeof body.paid !== "boolean")
        return json({ error: "Ungültiger Status." }, 400);
      fields.paid = body.paid || undefined;
    }
    const amount = "amountCents" in body ? body.amountCents : current.amountCents ?? null;
    if ("paidCents" in body && (!Number.isSafeInteger(body.paidCents) || body.paidCents < 0 || body.paidCents > 9999999999))
      return json({error: "Ungültiger bezahlter Betrag."}, 400);
    const payment = "paidCents" in body ? body.paidCents : "paid" in body ? (body.paid ? amount ?? 0 : 0) : paidAmount(current);
    if ((amount === null && payment > 0) || (amount !== null && payment > amount))
      return json({error: "Der bezahlte Betrag darf den Rechnungsbetrag nicht überschreiten. Bitte beide Beträge prüfen."}, 400);
    fields.paidCents = payment;
    fields.paid = amount === null ? (body.paid ?? current.paid) : payment >= amount;
    const next = await this.cloud.updateMetadata(prefix + id, fields);
    if (!next) return json({ error: "Datei nicht gefunden." }, 404);
    return json(invoiceView(id, next));
  }
  if (id && method === "DELETE") {
    if (request.headers.get("x-confirm-delete") !== "yes")
      return json({ error: "Löschen bitte bestätigen." }, 400);
    await this.cloud.delete(prefix + id);
    return json({ deleted: true });
  }
  if (id && ["GET", "HEAD"].includes(method)) {
    const file = await this.cloud.getWithMetadata(prefix + id, "stream");
    if (!file.value) return json({ error: "Datei nicht gefunden." }, 404);
    if (method === "HEAD") await file.value.cancel();
    const preview =
      !url.searchParams.has("download") && previewTypes.has(file.metadata.type);
    return new Response(method === "HEAD" ? null : file.value, {
      headers: {
        "content-type": preview
          ? file.metadata.type
          : "application/octet-stream",
        "content-disposition":
          (preview ? "inline" : "attachment") +
          "; filename*=UTF-8''" +
          encodeURIComponent(file.metadata.name),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
      },
    });
  }
  return json({ error: "Methode nicht erlaubt." }, 405);
}
