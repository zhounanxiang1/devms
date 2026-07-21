import { Bold, Heading2, Italic, Link2, List, ListOrdered, Quote, RemoveFormatting, Strikethrough, Underline, Unlink2 } from "lucide-react";
import { useRef, useState, type ClipboardEvent } from "react";
import { normalizeRichText, sanitizeRichTextHtml, stripRichText } from "../lib/richText";

export function RichTextDisplay({ value, emptyText = "-" }: { value?: string | number | null; emptyText?: string }) {
  const html = normalizeRichText(value);
  if (!html) return <span className="rich-empty">{emptyText}</span>;
  return <div className="rich-text-display" dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(html) }} />;
}

export function RichTextEditor({
  name,
  label: text,
  required,
  defaultValue
}: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string | number | null;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const initialHtmlRef = useRef(normalizeRichText(defaultValue));
  const [html, setHtml] = useState(initialHtmlRef.current);
  const sanitizedHtml = sanitizeRichTextHtml(html);

  function syncFromEditor() {
    setHtml(editorRef.current?.innerHTML || "");
  }

  function runCommand(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncFromEditor();
  }

  function createLink() {
    editorRef.current?.focus();
    const input = window.prompt("请输入链接地址");
    if (!input) return;
    const normalized = /^(https?:|mailto:)/i.test(input) ? input : `https://${input}`;
    document.execCommand("createLink", false, normalized);
    cleanEditor();
  }

  function pasteCleanHtml(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const clean = html ? sanitizeRichTextHtml(html) : normalizeRichText(text);
    document.execCommand("insertHTML", false, clean);
    syncFromEditor();
  }

  function cleanEditor() {
    const clean = sanitizeRichTextHtml(editorRef.current?.innerHTML || "");
    if (editorRef.current && editorRef.current.innerHTML !== clean) {
      editorRef.current.innerHTML = clean;
    }
    setHtml(clean);
  }

  return (
    <div className={required ? "field required rich-editor-field" : "field rich-editor-field"}>
      <span className="field-label">{text}{required ? <span className="required-mark">必填</span> : null}</span>
      <div className="rich-toolbar" aria-label={`${text}格式工具`}>
        <button type="button" title="标题" onMouseDown={(event) => { event.preventDefault(); runCommand("formatBlock", "H2"); }}>
          <Heading2 size={15} />
        </button>
        <button type="button" title="引用" onMouseDown={(event) => { event.preventDefault(); runCommand("formatBlock", "BLOCKQUOTE"); }}>
          <Quote size={15} />
        </button>
        <span className="rich-toolbar-divider" />
        <button type="button" title="加粗" onMouseDown={(event) => { event.preventDefault(); runCommand("bold"); }}>
          <Bold size={15} />
        </button>
        <button type="button" title="斜体" onMouseDown={(event) => { event.preventDefault(); runCommand("italic"); }}>
          <Italic size={15} />
        </button>
        <button type="button" title="下划线" onMouseDown={(event) => { event.preventDefault(); runCommand("underline"); }}>
          <Underline size={15} />
        </button>
        <button type="button" title="删除线" onMouseDown={(event) => { event.preventDefault(); runCommand("strikeThrough"); }}>
          <Strikethrough size={15} />
        </button>
        <span className="rich-toolbar-divider" />
        <button type="button" title="无序列表" onMouseDown={(event) => { event.preventDefault(); runCommand("insertUnorderedList"); }}>
          <List size={15} />
        </button>
        <button type="button" title="有序列表" onMouseDown={(event) => { event.preventDefault(); runCommand("insertOrderedList"); }}>
          <ListOrdered size={15} />
        </button>
        <span className="rich-toolbar-divider" />
        <button type="button" title="插入链接" onMouseDown={(event) => { event.preventDefault(); createLink(); }}>
          <Link2 size={15} />
        </button>
        <button type="button" title="取消链接" onMouseDown={(event) => { event.preventDefault(); runCommand("unlink"); }}>
          <Unlink2 size={15} />
        </button>
        <button type="button" title="清除格式" onMouseDown={(event) => { event.preventDefault(); runCommand("removeFormat"); runCommand("formatBlock", "P"); }}>
          <RemoveFormatting size={15} />
        </button>
      </div>
      <div
        ref={editorRef}
        className="rich-editor"
        contentEditable
        data-placeholder={`填写${text}`}
        suppressContentEditableWarning
        onInput={syncFromEditor}
        onPaste={pasteCleanHtml}
        onBlur={cleanEditor}
        dangerouslySetInnerHTML={{ __html: initialHtmlRef.current }}
      />
      <input type="hidden" name={name} value={sanitizedHtml} />
      {required ? <input type="hidden" name={`${name}__required`} value={stripRichText(sanitizedHtml)} data-rich-required="true" data-rich-label={text} /> : null}
    </div>
  );
}
