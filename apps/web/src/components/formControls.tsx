import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Person, Project } from "../types";

export function ProjectSelect({ projects, defaultValue }: { projects: Project[]; defaultValue?: string | number | null }) {
  return <Select searchable name="projectId" label="所属项目" defaultValue={defaultValue} options={projects.map((project) => [String(project.id), `${project.name}（${project.code}）`])} />;
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
  people: Array<Pick<Person, "id" | "name"> & { employeeNo?: string | null }>;
  defaultValue?: string | number | null;
  required?: boolean;
}) {
  return <Select searchable name={name} label={text} required={required} defaultValue={defaultValue} options={[["", "未指定"], ...people.map((person) => [String(person.id), `${person.name}${person.employeeNo ? `（${person.employeeNo}）` : ""}`] as [string, string])]} />;
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
  if (type === "date") {
    return <DateField name={name} label={text} required={required} defaultValue={defaultValue} value={value} disabled={disabled} onChange={onChange} />;
  }
  const inputProps = value === undefined ? { defaultValue: defaultValue ?? "" } : { value: value ?? "" };
  return (
    <label className={required ? "field required" : "field"}>
      <span className="field-label">{text}{required ? <span className="required-mark">必填</span> : null}</span>
      <input name={name} type={type} required={required} disabled={disabled} onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined} {...inputProps} />
    </label>
  );
}

function isDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function DateField({
  name,
  label: text,
  required,
  defaultValue,
  value,
  disabled,
  onChange
}: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string | number | null;
  value?: string | number | null;
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const controlled = value !== undefined;
  const [innerValue, setInnerValue] = useState(String(defaultValue ?? ""));
  const currentValue = String((controlled ? value : innerValue) ?? "");

  function commit(nextValue: string) {
    if (!controlled) setInnerValue(nextValue);
    onChange?.(nextValue);
  }

  function openPicker() {
    if (disabled) return;
    try {
      pickerRef.current?.showPicker();
    } catch {
      pickerRef.current?.focus();
    }
  }

  function handleTextChange(event: ChangeEvent<HTMLInputElement>) {
    commit(event.currentTarget.value);
  }

  function handlePickerChange(event: ChangeEvent<HTMLInputElement>) {
    commit(event.currentTarget.value);
  }

  return (
    <label className={required ? "field required date-field" : "field date-field"}>
      <span className="field-label">{text}{required ? <span className="required-mark">必填</span> : null}</span>
      <span className="date-field-control">
        <input
          name={name}
          type="text"
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          pattern="\d{4}-\d{2}-\d{2}"
          title="请输入 YYYY-MM-DD 格式的日期"
          required={required}
          disabled={disabled}
          value={currentValue}
          onChange={handleTextChange}
          onClick={openPicker}
        />
        <input
          ref={pickerRef}
          className="date-picker-proxy"
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          value={isDateValue(currentValue) ? currentValue : ""}
          onChange={handlePickerChange}
        />
      </span>
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

export function FileField({ name, label: text, accept }: { name: string; label: string; accept?: string }) {
  return (
    <label className="field file-field">
      <span className="field-label">{text}</span>
      <input name={name} type="file" accept={accept} />
      <span className="file-field-note">选择本地文件后，提交时会作为附件保存。</span>
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
  searchable,
  onChange
}: {
  name: string;
  label: string;
  options: Array<[string, string]>;
  defaultValue?: string | number | null;
  value?: string | number | null;
  disabled?: boolean;
  required?: boolean;
  searchable?: boolean;
  onChange?: (value: string) => void;
}) {
  if (searchable) {
    return (
      <SearchableSelect
        name={name}
        label={text}
        options={options}
        defaultValue={defaultValue}
        value={value}
        disabled={disabled}
        required={required}
        onChange={onChange}
      />
    );
  }
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

function SearchableSelect({
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
  const controlled = value !== undefined;
  const [innerValue, setInnerValue] = useState(String(defaultValue ?? ""));
  const selectedValue = String((controlled ? value : innerValue) ?? "");
  const selectedLabel = options.find(([optionValue]) => optionValue === selectedValue)?.[1] || "";
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter(([optionValue, optionLabel]) => `${optionLabel} ${optionValue}`.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, options]);

  function commit(nextValue: string) {
    if (!controlled) setInnerValue(nextValue);
    const nextLabel = options.find(([optionValue]) => optionValue === nextValue)?.[1] || "";
    setQuery(nextLabel);
    setOpen(false);
    onChange?.(nextValue);
  }

  return (
    <label className={required ? "field required searchable-field" : "field searchable-field"}>
      <span className="field-label">{text}{required ? <span className="required-mark">必填</span> : null}</span>
      <input type="hidden" name={name} value={selectedValue} />
      {required ? <input type="hidden" name={`${name}__required`} value={text} /> : null}
      <div className="searchable-select">
        <input
          type="text"
          value={open ? query : selectedLabel}
          disabled={disabled}
          required={required && !selectedValue}
          placeholder="输入关键词查询"
          autoComplete="off"
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setQuery(selectedLabel);
          }}
        />
        {open && !disabled ? (
          <div className="searchable-select-list">
            {filteredOptions.length ? filteredOptions.map(([optionValue, optionLabel]) => (
              <button
                key={`${optionValue}-${optionLabel}`}
                type="button"
                className={optionValue === selectedValue ? "selected" : ""}
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(optionValue);
                }}
              >
                {optionLabel}
              </button>
            )) : (
              <span className="searchable-empty">没有匹配的数据</span>
            )}
          </div>
        ) : null}
      </div>
    </label>
  );
}

export function MultiSelect({
  name,
  label: text,
  options,
  defaultValue,
  searchable
}: {
  name: string;
  label: string;
  options: Array<[string, string]>;
  defaultValue?: string[];
  searchable?: boolean;
}) {
  if (searchable) return <SearchableMultiSelect name={name} label={text} options={options} defaultValue={defaultValue} />;
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

function SearchableMultiSelect({ name, label: text, options, defaultValue }: { name: string; label: string; options: Array<[string, string]>; defaultValue?: string[] }) {
  const [selectedValues, setSelectedValues] = useState<string[]>(defaultValue || []);
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter(([optionValue, optionLabel]) => `${optionLabel} ${optionValue}`.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, options]);

  function toggle(optionValue: string) {
    setSelectedValues((current) => current.includes(optionValue) ? current.filter((value) => value !== optionValue) : [...current, optionValue]);
  }

  return (
    <label className="field searchable-field">
      <span className="field-label">{text}</span>
      <div className="searchable-multi">
        <input type="text" value={query} placeholder="输入关键词查询" onChange={(event) => setQuery(event.currentTarget.value)} />
        <div className="searchable-multi-list">
          {filteredOptions.length ? filteredOptions.map(([optionValue, optionLabel]) => (
            <button
              key={`${optionValue}-${optionLabel}`}
              type="button"
              className={selectedSet.has(optionValue) ? "selected" : ""}
              onClick={() => toggle(optionValue)}
            >
              <span>{selectedSet.has(optionValue) ? "已选" : "选择"}</span>
              {optionLabel}
            </button>
          )) : (
            <span className="searchable-empty">没有匹配的数据</span>
          )}
        </div>
      </div>
      {selectedValues.map((selectedValue) => <input key={selectedValue} type="hidden" name={name} value={selectedValue} />)}
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
