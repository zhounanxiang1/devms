const BLOCK_TAGS = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL"]);

function htmlToPlainText(value: string) {
  if (typeof document === "undefined") {
    return value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|table|ul|ol)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  const template = document.createElement("template");
  template.innerHTML = value;
  const chunks: string[] = [];

  const appendBreak = () => {
    if (chunks.length && !chunks[chunks.length - 1].endsWith("\n")) {
      chunks.push("\n");
    }
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      chunks.push(node.textContent || "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.tagName === "BR") {
      chunks.push("\n");
      return;
    }
    if (element.tagName === "LI") chunks.push("- ");
    Array.from(element.childNodes).forEach(walk);
    if (BLOCK_TAGS.has(element.tagName)) appendBreak();
  };

  Array.from(template.content.childNodes).forEach(walk);
  return chunks.join("");
}

export function normalizeLongText(value?: string | number | null) {
  const raw = String(value ?? "");
  const text = /<[a-z][\s\S]*>/i.test(raw) ? htmlToPlainText(raw) : raw;
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripLongText(value?: string | number | null) {
  return normalizeLongText(value).trim();
}
