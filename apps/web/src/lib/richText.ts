function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function stripRichText(value?: string | number | null) {
  if (!value) return "";
  if (typeof document === "undefined") return String(value).replace(/<[^>]+>/g, "").trim();
  const container = document.createElement("div");
  container.innerHTML = String(value);
  return (container.textContent || "").trim();
}

export function sanitizeRichTextHtml(value?: string | number | null) {
  if (!value) return "";
  const raw = String(value);
  if (typeof document === "undefined") return raw;
  const template = document.createElement("template");
  template.innerHTML = raw;
  const allowedTags = new Set(["B", "STRONG", "I", "EM", "U", "S", "BR", "P", "DIV", "UL", "OL", "LI", "SPAN"]);
  const cleanNode = (node: Node) => {
    Array.from(node.childNodes).forEach(cleanNode);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
    }
  };
  cleanNode(template.content);
  return template.innerHTML.trim();
}

export function normalizeRichText(value?: string | number | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/<[a-z][\s\S]*>/i.test(raw)) return sanitizeRichTextHtml(raw);
  return raw
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
