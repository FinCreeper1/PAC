export class StoredDataError extends Error {
  constructor() {
    super(
      "Gespeicherte Daten sind beschädigt. Der Originalstand bleibt erhalten. Bitte aus einer Wolke-Sicherung wiederherstellen.",
    );
  }
}

export function parseStored(raw, fallback) {
  if (raw === null) return { ...fallback };
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new StoredDataError();
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new StoredDataError();
  const result = { ...fallback, ...value };
  if ("text" in fallback) {
    if (
      typeof result.text !== "string" ||
      !Number.isSafeInteger(result.revision) ||
      result.revision < 0 ||
      !(result.updatedAt === null || typeof result.updatedAt === "string")
    )
      throw new StoredDataError();
  } else {
    if (
      !(
        result.budgetCents === null ||
        (Number.isSafeInteger(result.budgetCents) &&
          result.budgetCents >= 0 &&
          result.budgetCents <= 9999999999)
      ) ||
      !(
        result.students === null ||
        (Number.isSafeInteger(result.students) &&
          result.students > 0 &&
          result.students <= 100000)
      )
    )
      throw new StoredDataError();
  }
  return result;
}
