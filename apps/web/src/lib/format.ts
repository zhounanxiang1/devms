import { AdminData, Person } from "../types";
import { dictionaryTypeMeta, positionLabels, projectStageLabels, requirementTypeLabels, statusLabels } from "./labels";

export function fmtDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("zh-CN");
}

export function label(code?: string) {
  if (!code) return "-";
  return statusLabels[code] || positionLabels[code] || requirementTypeLabels[code] || code;
}

export function projectStageLabel(code?: string) {
  if (!code) return "-";
  return projectStageLabels[code] || label(code);
}

export function dictionaryTypeLabel(type: string) {
  const meta = dictionaryTypeMeta[type];
  return meta ? `${meta.name}（${type}）` : type;
}

export function dictionaryTypeUsage(type: string) {
  return dictionaryTypeMeta[type]?.usage || "自定义字典类型。用于系统配置项扩展，具体使用位置需结合业务页面确认。";
}

export function toDateInput(value?: string | null) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

export function todayDateInput() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isDue(value?: string) {
  if (!value) return false;
  return new Date(value).getTime() - Date.now() < 1000 * 60 * 60 * 24 * 2;
}

export function isProductManagerPerson(person?: Pick<Person, "primaryPosition" | "positions"> | null) {
  return person?.primaryPosition?.code === "PRODUCT_MANAGER" || Boolean(person?.positions?.some((item) => item.position.code === "PRODUCT_MANAGER"));
}

export function dictionaryOptions(
  dictionaries: AdminData["dictionaries"],
  type: string,
  fallback: Array<[string, string]>
) {
  const typeItems = dictionaries.filter((item) => item.type === type);
  const existingCodes = new Set(typeItems.map((item) => item.code));
  const options = dictionaries
    .filter((item) => item.type === type && item.isActive)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((item) => [item.code, item.name] as [string, string]);
  const missingFallback = fallback.filter(([code]) => !existingCodes.has(code));
  return options.length ? [...options, ...missingFallback] : fallback;
}
