export function toInt(value: string | number | undefined | null) {
  if (value === "" || value === undefined || value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function toNullableInt(value: string | number | undefined | null) {
  if (value === "" || value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toDate(value: unknown) {
  if (!value) return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function toBool(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on", "启用"].includes(normalized)) return true;
  if (["false", "0", "no", "off", "停用"].includes(normalized)) return false;
  return undefined;
}

export function businessDate(value = new Date()) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")
  ].join("");
}

export function formatBusinessCode(prefix: string, date: string, sequence: number) {
  return `${prefix}-${date}-${String(sequence).padStart(4, "0")}`;
}

export function formatTypedBusinessCode(prefix: string, date: string, typeCode: string, sequence: number) {
  return `${prefix}-${date}-${typeCode}-${String(sequence).padStart(2, "0")}`;
}

export function pickDefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}
