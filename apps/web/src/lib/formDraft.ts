export type FormDraft = Record<string, string | string[]>;

export const FORM_DRAFT_PREFIX = "dms_form_draft";

export function readFormDraft(key: string): FormDraft | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = "values" in parsed ? (parsed as { values?: unknown }).values : parsed;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    return candidate as FormDraft;
  } catch {
    return null;
  }
}

export function writeFormDraft(key: string, form: HTMLFormElement) {
  const values: FormDraft = {};
  const passwordFields = new Set(
    Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"]')).map((input) => input.name).filter(Boolean)
  );
  new FormData(form).forEach((value, name) => {
    if (passwordFields.has(name) || typeof value !== "string") return;
    const existing = values[name];
    if (existing === undefined) {
      values[name] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      values[name] = [existing, value];
    }
  });
  window.localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), values }));
}

export function clearFormDraft(key: string) {
  if (key) window.localStorage.removeItem(key);
}

export function draftValue(draft: FormDraft | null, name: string, fallback?: string | number | null) {
  const value = draft?.[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? fallback ?? "";
}

export function draftArray(draft: FormDraft | null, name: string) {
  const value = draft?.[name];
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export function hasDraftValues(draft: FormDraft | null) {
  return Boolean(draft && Object.keys(draft).length);
}
