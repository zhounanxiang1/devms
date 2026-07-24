import { Table } from "antd";
import type { TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import type { CSSProperties, Dispatch, Key, PointerEvent, SetStateAction, ThHTMLAttributes } from "react";

const DEFAULT_COLUMN_WIDTH = 180;
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 720;

type WidthMap = Record<string, number>;

type HeaderCellProps = ThHTMLAttributes<HTMLTableCellElement> & {
  width?: number | string;
  onResizeColumn?: (width: number) => void;
};

function numericWidth(width: unknown) {
  if (typeof width === "number" && Number.isFinite(width)) return width;
  if (typeof width === "string") {
    const parsed = Number.parseFloat(width);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeDataIndex(value: unknown) {
  if (Array.isArray(value)) return value.join(".");
  if (value === undefined || value === null) return "";
  return String(value);
}

function columnIdentity<RecordType>(column: ColumnsType<RecordType>[number], index: number, path: string) {
  const explicitKey = (column as { key?: Key }).key;
  const dataIndex = normalizeDataIndex((column as { dataIndex?: unknown }).dataIndex);
  return String(explicitKey ?? dataIndex ?? `${path}-${index}`);
}

function clampWidth(width: number) {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

function ResizableHeaderCell({ width, onResizeColumn, className, style, children, ...rest }: HeaderCellProps) {
  const currentWidth = numericWidth(width) || DEFAULT_COLUMN_WIDTH;

  function beginResize(event: PointerEvent<HTMLSpanElement>) {
    if (!onResizeColumn) return;
    const resizeColumn = onResizeColumn;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = currentWidth;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";

    function handleMove(moveEvent: globalThis.PointerEvent) {
      resizeColumn(clampWidth(startWidth + moveEvent.clientX - startX));
    }

    function handleUp() {
      document.body.style.cursor = previousCursor;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <th
      {...rest}
      className={[className, "resizable-table-header-cell"].filter(Boolean).join(" ")}
      style={{ ...(style as CSSProperties), width: currentWidth }}
    >
      {children}
      {onResizeColumn ? <span className="table-column-resize-handle" onPointerDown={beginResize} /> : null}
    </th>
  );
}

function enhanceColumns<RecordType extends object>(
  columns: ColumnsType<RecordType>,
  widths: WidthMap,
  setWidths: Dispatch<SetStateAction<WidthMap>>,
  path = "col"
): ColumnsType<RecordType> {
  return columns.map((column, index) => {
    const id = columnIdentity(column, index, path);
    if ("children" in column && column.children?.length) {
      return {
        ...column,
        children: enhanceColumns(column.children as ColumnsType<RecordType>, widths, setWidths, `${path}-${index}`)
      };
    }

    const baseWidth = widths[id] ?? numericWidth((column as { width?: unknown }).width) ?? DEFAULT_COLUMN_WIDTH;
    const originalOnHeaderCell = column.onHeaderCell;

    return {
      ...column,
      width: baseWidth,
      onHeaderCell: (col) => ({
        ...(originalOnHeaderCell?.(col) || {}),
        width: baseWidth,
        onResizeColumn: (nextWidth: number) => {
          setWidths((current) => ({ ...current, [id]: clampWidth(nextWidth) }));
        }
      })
    };
  });
}

export function ResizableTable<RecordType extends object>(props: TableProps<RecordType>) {
  const { columns = [], components, tableLayout, ...rest } = props;
  const [widths, setWidths] = useState<WidthMap>({});

  const mergedColumns = useMemo(
    () => enhanceColumns(columns as ColumnsType<RecordType>, widths, setWidths),
    [columns, widths]
  );
  const mergedComponents = useMemo(
    () => ({
      ...components,
      header: {
        ...components?.header,
        cell: ResizableHeaderCell
      }
    }),
    [components]
  );

  return (
    <Table<RecordType>
      {...rest}
      columns={mergedColumns}
      components={mergedComponents}
      tableLayout={tableLayout || "fixed"}
    />
  );
}
