import { normalizeLongText } from "../lib/longText";

export function LongTextDisplay({ value, emptyText = "-" }: { value?: string | number | null; emptyText?: string }) {
  const text = normalizeLongText(value);
  if (!text.trim()) return <span className="long-text-empty">{emptyText}</span>;
  return <div className="long-text-display">{text}</div>;
}

export function LongTextEditor({
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
  return (
    <label className={required ? "field required long-text-field" : "field long-text-field"}>
      <span className="field-label">{text}{required ? <span className="required-mark">必填</span> : null}</span>
      <textarea
        className="long-text-editor"
        name={name}
        required={required}
        defaultValue={normalizeLongText(defaultValue)}
        placeholder={`填写${text}`}
      />
    </label>
  );
}
