import { Person, Project } from "../types";

export function ProjectSelect({ projects, defaultValue }: { projects: Project[]; defaultValue?: string | number | null }) {
  return <Select name="projectId" label="所属项目" defaultValue={defaultValue} options={projects.map((project) => [String(project.id), project.name])} />;
}

export function PeopleSelect({
  name,
  label: text,
  people,
  defaultValue,
  required
}: {
  name: string;
  label: string;
  people: Array<Pick<Person, "id" | "name">>;
  defaultValue?: string | number | null;
  required?: boolean;
}) {
  return <Select name={name} label={text} required={required} defaultValue={defaultValue} options={[["", "未指定"], ...people.map((person) => [String(person.id), person.name] as [string, string])]} />;
}

export function Field({
  name,
  label: text,
  type = "text",
  required,
  defaultValue,
  value,
  disabled,
  onChange
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number | null;
  value?: string | number | null;
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  const inputProps = value === undefined ? { defaultValue: defaultValue ?? "" } : { value: value ?? "" };
  return (
    <label className={required ? "field required" : "field"}>
      <span className="field-label">{text}{required ? <span className="required-mark">必填</span> : null}</span>
      <input name={name} type={type} required={required} disabled={disabled} onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined} {...inputProps} />
    </label>
  );
}

export function Textarea({ name, label: text, required, defaultValue }: { name: string; label: string; required?: boolean; defaultValue?: string | number | null }) {
  return (
    <label className={required ? "field required" : "field"}>
      <span className="field-label">{text}{required ? <span className="required-mark">必填</span> : null}</span>
      <textarea name={name} required={required} defaultValue={defaultValue ?? ""} />
    </label>
  );
}

export function Select({
  name,
  label: text,
  options,
  defaultValue,
  value,
  disabled,
  required,
  onChange
}: {
  name: string;
  label: string;
  options: Array<[string, string]>;
  defaultValue?: string | number | null;
  value?: string | number | null;
  disabled?: boolean;
  required?: boolean;
  onChange?: (value: string) => void;
}) {
  const selectProps = value === undefined ? { defaultValue: defaultValue ?? "" } : { value: value ?? "" };
  return (
    <label className={required ? "field required" : "field"}>
      <span className="field-label">{text}{required ? <span className="required-mark">必填</span> : null}</span>
      <select name={name} disabled={disabled} required={required} onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined} {...selectProps}>
        {options.map(([value, name]) => (
          <option key={`${value}-${name}`} value={value}>{name}</option>
        ))}
      </select>
    </label>
  );
}

export function MultiSelect({ name, label: text, options, defaultValue }: { name: string; label: string; options: Array<[string, string]>; defaultValue?: string[] }) {
  return (
    <label className="field">
      <span className="field-label">{text}</span>
      <select name={name} multiple size={Math.min(6, Math.max(3, options.length))} defaultValue={defaultValue || []}>
        {options.map(([value, name]) => (
          <option key={`${value}-${name}`} value={value}>{name}</option>
        ))}
      </select>
    </label>
  );
}

export function ReadonlyField({ name, label: text, value, displayValue }: { name: string; label: string; value?: string | number | null; displayValue?: string | number | null }) {
  return (
    <label className="field readonly-field">
      <span className="field-label">{text}</span>
      <input value={displayValue ?? value ?? "-"} readOnly aria-readonly="true" />
      <input type="hidden" name={name} value={value ?? ""} />
    </label>
  );
}

export function DisplayField({ label: text, value }: { label: string; value?: string | number | null }) {
  return (
    <label className="field readonly-field">
      <span className="field-label">{text}</span>
      <input value={value ?? "-"} readOnly aria-readonly="true" />
    </label>
  );
}
