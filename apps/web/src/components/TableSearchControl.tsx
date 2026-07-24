import { Search } from "lucide-react";
import { Button as AntButton, DatePicker as AntDatePicker, Input as AntInput, Select as AntSelect } from "antd";

export type DateRangeValue = [any, any] | null;

export type TableSearchOption<T> = {
  value: string;
  label: string;
  type: "text" | "date";
  reader: (item: T) => unknown;
};

function textOf(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).toLowerCase();
}

function matchDateRange(value: unknown, range: DateRangeValue) {
  if (!range?.[0] || !range?.[1]) return true;
  if (!value) return false;
  const current = new Date(String(value)).getTime();
  if (Number.isNaN(current)) return false;
  const start = typeof range[0]?.startOf === "function" ? range[0].startOf("day").valueOf() : new Date(String(range[0])).getTime();
  const end = typeof range[1]?.endOf === "function" ? range[1].endOf("day").valueOf() : new Date(String(range[1])).getTime();
  return current >= start && current <= end;
}

export function matchSearchOption<T>(item: T, searchField: string, keyword: string, dateRange: DateRangeValue, options: Array<TableSearchOption<T>>) {
  const option = options.find((item) => item.value === searchField);
  if (!option) return true;
  if (option.type === "date") return matchDateRange(option.reader(item), dateRange);
  const query = keyword.trim().toLowerCase();
  if (!query) return true;
  return textOf(option.reader(item)).includes(query);
}

export function TableSearchControl<T>({
  options,
  field,
  keyword,
  dateRange,
  onFieldChange,
  onKeywordChange,
  onDateRangeChange,
  placeholder = "请输入关键词"
}: {
  options: Array<TableSearchOption<T>>;
  field: string;
  keyword: string;
  dateRange: DateRangeValue;
  onFieldChange: (value: string) => void;
  onKeywordChange: (value: string) => void;
  onDateRangeChange: (value: DateRangeValue) => void;
  placeholder?: string;
}) {
  const selected = options.find((item) => item.value === field) || options[0];
  const changeField = (value: string) => {
    onFieldChange(value);
    onKeywordChange("");
    onDateRangeChange(null);
  };

  return (
    <div className="table-search-control">
      {selected?.type === "date" ? (
        <AntDatePicker.RangePicker
          className="table-search-control-input table-search-control-date"
          value={dateRange as any}
          onChange={(dates) => onDateRangeChange(dates as DateRangeValue)}
        />
      ) : (
        <AntInput
          allowClear
          className="table-search-control-input"
          placeholder={placeholder}
          value={keyword}
          onChange={(event) => onKeywordChange(event.currentTarget.value)}
          onPressEnter={() => onKeywordChange(keyword.trim())}
        />
      )}
      <AntSelect
        className="table-search-control-field"
        popupMatchSelectWidth={false}
        value={field}
        options={options.map((item) => ({ value: item.value, label: item.label }))}
        onChange={changeField}
      />
      <AntButton className="table-search-control-button" icon={<Search size={16} />} onClick={() => onKeywordChange(keyword.trim())} />
    </div>
  );
}
