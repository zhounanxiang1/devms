import { RotateCcw, Save, X } from "lucide-react";
import { Select as AntSelect } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { label } from "../lib/format";
import { Defect, DevTask } from "../types";
import { DateRangeValue, matchSearchOption, TableSearchControl, TableSearchOption } from "./TableSearchControl";

export type ScheduleChange = {
  kind: "task" | "defect";
  id: number;
  plannedStartDate: string;
  plannedFinishDate: string;
};

type DateRange = {
  start: Date | null;
  end: Date | null;
};

type ScheduleItem = {
  id: string;
  rawId: number;
  kind: "project" | "task" | "defect";
  isDraft?: boolean;
  assigneeId?: number | null;
  assigneeName?: string;
  code: string;
  title: string;
  status: string;
  projectName: string;
  requirementName: string;
  taskName: string;
  priorityScore: number;
  start: Date | null;
  end: Date | null;
  originalStart: Date | null;
  originalEnd: Date | null;
};

export type DraftScheduleItem = {
  title: string;
  projectName?: string;
  requirementName?: string;
  sourceName?: string;
  priorityScore?: number;
  plannedStartDate?: string;
  plannedFinishDate?: string;
};

export type ProjectPlanScheduleItem = {
  title: string;
  code?: string;
  ownerName?: string;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
};

type DragState = {
  itemId: string;
  edge: "start" | "end";
  pointerStartX: number;
  trackWidth: number;
  chartStart: Date;
  totalDays: number;
  originalStartIndex: number;
  originalEndIndex: number;
  originalStart: Date;
  originalEnd: Date;
};

type HoverTip = {
  content: string;
  x: number;
  y: number;
  placement: "top" | "bottom";
};

type InfoColumnKey = "title" | "kind" | "status" | "dates" | "assignee" | "score";

type ColumnResizeState = {
  column: InfoColumnKey;
  pointerStartX: number;
  startWidth: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const INFO_GRID_GAP = 8;
const INFO_PANEL_PADDING_RIGHT = 12;
const INFO_COLUMN_KEYS: InfoColumnKey[] = ["title", "kind", "status", "dates", "score"];
const PROJECT_INFO_COLUMN_KEYS: InfoColumnKey[] = ["title", "kind", "status", "assignee", "score"];
const INFO_COLUMN_DEFAULT_WIDTHS: Record<InfoColumnKey, number> = {
  title: 170,
  kind: 74,
  status: 82,
  dates: 300,
  assignee: 110,
  score: 76
};
const INFO_COLUMN_LIMITS: Record<InfoColumnKey, { min: number; max: number }> = {
  title: { min: 120, max: 360 },
  kind: { min: 68, max: 130 },
  status: { min: 76, max: 150 },
  dates: { min: 290, max: 430 },
  assignee: { min: 90, max: 180 },
  score: { min: 70, max: 130 }
};
const DEFAULT_TASK_STATUSES = ["TODO", "DOING"];
const DEFAULT_DEFECT_STATUSES = ["TO_FIX", "FIXING"];
const TASK_STATUS_ORDER = ["TODO", "DOING", "TO_TEST", "TESTING", "TEST_PASSED", "CLOSED"];
const DEFECT_STATUS_ORDER = ["TO_FIX", "FIXING", "FIXED", "VERIFIED", "CLOSED"];

function parseDateOnly(value?: string | null) {
  if (!value) return null;
  const match = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dateToInput(date?: Date | null) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatScheduleDate(date?: Date | null) {
  if (!date) return "-";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatFullDate(date?: Date | null) {
  if (!date) return "-";
  return dateToInput(date);
}

function diffDays(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function todayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function normalizeScheduleRange(start?: Date | null, end?: Date | null): DateRange {
  const normalizedStart = start || end || null;
  const normalizedEnd = end || start || null;
  if (!normalizedStart || !normalizedEnd) return { start: null, end: null };
  return normalizedStart.getTime() <= normalizedEnd.getTime()
    ? { start: normalizedStart, end: normalizedEnd }
    : { start: normalizedEnd, end: normalizedStart };
}

function isSameRange(left: DateRange, right: DateRange) {
  return dateToInput(left.start) === dateToInput(right.start) && dateToInput(left.end) === dateToInput(right.end);
}

function buildStatusOptions(preferredOrder: string[], currentStatuses: string[]) {
  const seen = new Set<string>();
  return [...preferredOrder, ...currentStatuses].filter((status) => {
    if (!status || seen.has(status)) return false;
    seen.add(status);
    return true;
  });
}

function infoGridTemplate(widths: Record<InfoColumnKey, number>, keys = INFO_COLUMN_KEYS) {
  return keys.map((key) => `${widths[key]}px`).join(" ");
}

function infoPanelWidth(widths: Record<InfoColumnKey, number>, keys = INFO_COLUMN_KEYS) {
  return keys.reduce((total, key) => total + widths[key], 0) + INFO_GRID_GAP * (keys.length - 1) + INFO_PANEL_PADDING_RIGHT;
}

function clampInfoColumnWidth(column: InfoColumnKey, width: number) {
  const limit = INFO_COLUMN_LIMITS[column];
  return Math.min(limit.max, Math.max(limit.min, width));
}

function buildItems(tasks: DevTask[], defects: Defect[], overrides: Record<string, DateRange>, draftItem?: DraftScheduleItem | null, projectPlan?: ProjectPlanScheduleItem | null): ScheduleItem[] {
  const draftStart = draftItem ? parseDateOnly(draftItem.plannedStartDate) || todayDate() : null;
  const draftEnd = draftItem ? parseDateOnly(draftItem.plannedFinishDate) || draftStart : null;
  const draftOriginal = normalizeScheduleRange(draftStart, draftEnd);
  const projectPlanOriginal = projectPlan ? normalizeScheduleRange(parseDateOnly(projectPlan.plannedStartDate), parseDateOnly(projectPlan.plannedEndDate)) : null;
  return [
    ...(projectPlan ? [{
      id: "project-plan",
      rawId: 0,
      kind: "project" as const,
      assigneeId: undefined,
      assigneeName: projectPlan.ownerName || "-",
      code: projectPlan.code || "项目计划",
      title: projectPlan.title || "项目计划",
      status: "计划周期",
      projectName: projectPlan.title || "-",
      requirementName: "-",
      taskName: "-",
      priorityScore: 0,
      start: projectPlanOriginal?.start || null,
      end: projectPlanOriginal?.end || null,
      originalStart: projectPlanOriginal?.start || null,
      originalEnd: projectPlanOriginal?.end || null
    }] : []),
    ...tasks.map((task) => {
      const original = normalizeScheduleRange(parseDateOnly(task.plannedStartDate), parseDateOnly(task.plannedFinishDate));
      const key = `task-${task.id}`;
      const current = overrides[key] || original;
      return {
        id: key,
        rawId: task.id,
        kind: "task" as const,
        assigneeId: task.assigneeId || task.assignee?.id,
        assigneeName: task.assignee?.name || "-",
        code: task.code,
        title: task.title,
        status: task.status,
        projectName: task.project?.name || "-",
        requirementName: task.requirement?.title || "-",
        taskName: "-",
        priorityScore: task.priorityScore || 0,
        start: current.start,
        end: current.end,
        originalStart: original.start,
        originalEnd: original.end
      };
    }),
    ...defects.map((defect) => {
      const original = normalizeScheduleRange(parseDateOnly(defect.plannedStartDate || defect.plannedFixDate), parseDateOnly(defect.plannedFinishDate || defect.plannedFixDate));
      const key = `defect-${defect.id}`;
      const current = overrides[key] || original;
      return {
        id: key,
        rawId: defect.id,
        kind: "defect" as const,
        assigneeId: defect.assigneeId || defect.assignee?.id,
        assigneeName: defect.assignee?.name || "-",
        code: defect.code,
        title: defect.title,
        status: defect.status,
        projectName: defect.project?.name || defect.task?.project?.name || "-",
        requirementName: defect.task?.requirement?.title || defect.requirement?.title || "-",
        taskName: defect.task?.title || "-",
        priorityScore: defect.priorityScore || 0,
        start: current.start,
        end: current.end,
        originalStart: original.start,
        originalEnd: original.end
      };
    }),
    ...(draftItem ? [{
      id: "draft-task",
      rawId: 0,
      kind: "task" as const,
      isDraft: true,
      assigneeId: undefined,
      code: "当前表单",
      title: draftItem.title || "当前新建任务",
      status: "TODO",
      projectName: draftItem.projectName || "-",
      requirementName: draftItem.requirementName || draftItem.sourceName || "-",
      taskName: "-",
      priorityScore: draftItem.priorityScore || 0,
      start: (overrides["draft-task"] || draftOriginal).start,
      end: (overrides["draft-task"] || draftOriginal).end,
      originalStart: draftOriginal.start,
      originalEnd: draftOriginal.end
    }] : [])
  ];
}

function sortByPriority(left: ScheduleItem, right: ScheduleItem) {
  if (left.kind === "project") return -1;
  if (right.kind === "project") return 1;
  return (right.priorityScore || 0) - (left.priorityScore || 0) || formatFullDate(left.start).localeCompare(formatFullDate(right.start)) || left.title.localeCompare(right.title);
}

function dateRangeText(item: ScheduleItem) {
  return `${formatFullDate(item.start)} 至 ${formatFullDate(item.end)}`;
}

function canEditItemSchedule(item: ScheduleItem) {
  if (item.kind === "project") return false;
  if (item.isDraft) return true;
  return item.kind === "task" ? DEFAULT_TASK_STATUSES.includes(item.status) : DEFAULT_DEFECT_STATUSES.includes(item.status);
}

function canEditItemByPerson(item: ScheduleItem, personId?: number | string) {
  if (item.isDraft) return true;
  return Boolean(personId && item.assigneeId && String(item.assigneeId) === String(personId));
}

function scheduleDisabledReason(item: ScheduleItem) {
  if (item.kind === "project") return "项目甘特图只读展示";
  if (item.kind === "task") return "只有待处理或处理中的任务可以调整排期";
  return "只有待修复或修复中的缺陷可以调整排期";
}

function eachDay(start: Date, end: Date) {
  const days: Date[] = [];
  const total = Math.max(0, diffDays(start, end));
  for (let offset = 0; offset <= total; offset += 1) days.push(addDays(start, offset));
  return days;
}

export function AssigneeScheduleDialog({
  assigneeId,
  currentPersonId,
  assigneeName,
  title,
  summary,
  tasks,
  defects,
  draftItem,
  projectPlan,
  embedded = false,
  viewMode = "assignee",
  resetKey,
  defaultTaskStatuses,
  defaultDefectStatuses,
  onClose,
  onDraftScheduleChange,
  onSaveChanges
}: {
  assigneeId?: number | string;
  currentPersonId?: number | string;
  assigneeName?: string;
  title?: string;
  summary?: string;
  tasks: DevTask[];
  defects: Defect[];
  draftItem?: DraftScheduleItem | null;
  projectPlan?: ProjectPlanScheduleItem | null;
  embedded?: boolean;
  viewMode?: "assignee" | "project";
  resetKey?: string;
  defaultTaskStatuses?: string[];
  defaultDefectStatuses?: string[];
  onClose: () => void;
  onDraftScheduleChange?: (plannedStartDate: string, plannedFinishDate: string) => void;
  onSaveChanges: (changes: ScheduleChange[]) => Promise<boolean>;
}) {
  const taskStatusDefaults = defaultTaskStatuses || DEFAULT_TASK_STATUSES;
  const defectStatusDefaults = defaultDefectStatuses || DEFAULT_DEFECT_STATUSES;
  const [selectedTaskStatuses, setSelectedTaskStatuses] = useState<string[]>(taskStatusDefaults);
  const [selectedDefectStatuses, setSelectedDefectStatuses] = useState<string[]>(defectStatusDefaults);
  const [overrides, setOverrides] = useState<Record<string, DateRange>>({});
  const [searchField, setSearchField] = useState("title");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchDateRange, setSearchDateRange] = useState<DateRangeValue>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [columnResizeState, setColumnResizeState] = useState<ColumnResizeState | null>(null);
  const [infoColumnWidths, setInfoColumnWidths] = useState<Record<InfoColumnKey, number>>(INFO_COLUMN_DEFAULT_WIDTHS);
  const [hoverTip, setHoverTip] = useState<HoverTip | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const isProjectMode = viewMode === "project";
  const infoColumnKeys = isProjectMode ? PROJECT_INFO_COLUMN_KEYS : INFO_COLUMN_KEYS;
  const canEditSchedule = Boolean(assigneeId && currentPersonId && String(assigneeId) === String(currentPersonId));

  useEffect(() => {
    setSelectedTaskStatuses(taskStatusDefaults);
    setSelectedDefectStatuses(defectStatusDefaults);
    setOverrides({});
    setSearchField("title");
    setSearchKeyword("");
    setSearchDateRange(null);
    setMessage("");
  }, [assigneeId, resetKey]);

  const taskStatusOptions = useMemo(() => buildStatusOptions(TASK_STATUS_ORDER, tasks.map((task) => task.status)), [tasks]);
  const defectStatusOptions = useMemo(() => buildStatusOptions(DEFECT_STATUS_ORDER, defects.map((defect) => defect.status)), [defects]);
  const taskStatusSelectOptions = taskStatusOptions.map((status) => ({ value: status, label: label(status) }));
  const defectStatusSelectOptions = defectStatusOptions.map((status) => ({ value: status, label: label(status) }));
  const baseItems = useMemo(() => buildItems(tasks, defects, overrides, draftItem, projectPlan), [tasks, defects, overrides, draftItem, projectPlan]);
  const baseSearchOptions: Array<TableSearchOption<ScheduleItem>> = [
    { value: "title", label: "事项", type: "text", reader: (item) => item.title },
    { value: "code", label: "编号", type: "text", reader: (item) => item.code },
    { value: "project", label: "所属项目", type: "text", reader: (item) => item.projectName },
    { value: "requirement", label: "关联需求", type: "text", reader: (item) => item.requirementName },
    { value: "task", label: "关联任务", type: "text", reader: (item) => item.taskName }
  ];
  const searchOptions: Array<TableSearchOption<ScheduleItem>> = isProjectMode ? [
    ...baseSearchOptions,
    { value: "assignee", label: "负责人", type: "text", reader: (item) => item.assigneeName }
  ] : [
    ...baseSearchOptions,
    { value: "plannedStartDate", label: "计划开始", type: "date", reader: (item) => item.start },
    { value: "plannedFinishDate", label: "计划完成", type: "date", reader: (item) => item.end }
  ];

  const visibleItems = baseItems
    .filter((item) => item.kind === "project" || item.isDraft || (item.kind === "task" ? !selectedTaskStatuses.length || selectedTaskStatuses.includes(item.status) : !selectedDefectStatuses.length || selectedDefectStatuses.includes(item.status)))
    .filter((item) => matchSearchOption(item, searchField, searchKeyword, searchDateRange, searchOptions))
    .sort(sortByPriority);
  const scheduledItems = visibleItems.filter((item) => item.start && item.end);
  const minStart = scheduledItems.reduce<Date | null>((min, item) => (!min || (item.start && item.start < min) ? item.start : min), null);
  const maxEnd = scheduledItems.reduce<Date | null>((max, item) => (!max || (item.end && item.end > max) ? item.end : max), null);
  const chartStart = addDays(minStart || todayDate(), -7);
  const chartEnd = addDays(maxEnd || todayDate(), 14);
  const chartDays = eachDay(chartStart, chartEnd);
  const totalDays = Math.max(1, chartDays.length);
  const timelineGridStyle = {
    gridTemplateColumns: `repeat(${totalDays}, 42px)`,
    minWidth: `${Math.max(560, totalDays * 42)}px`
  };
  const infoTemplate = infoGridTemplate(infoColumnWidths, infoColumnKeys);
  const infoGridStyle = {
    gridTemplateColumns: infoTemplate
  };
  const ganttGridStyle = {
    gridTemplateColumns: `${infoPanelWidth(infoColumnWidths, infoColumnKeys)}px minmax(560px, 1fr)`
  };
  const pendingChanges = Object.entries(overrides)
    .map(([id, range]) => {
      const item = baseItems.find((candidate) => candidate.id === id);
      if (!item || item.kind === "project" || item.isDraft || !range.start || !range.end || isSameRange({ start: item.originalStart, end: item.originalEnd }, range)) return null;
      return {
        kind: item.kind,
        id: item.rawId,
        plannedStartDate: dateToInput(range.start),
        plannedFinishDate: dateToInput(range.end)
      };
    })
    .filter(Boolean) as ScheduleChange[];
  const pendingDraftRange = (() => {
    const draft = baseItems.find((item) => item.isDraft);
    const range = overrides["draft-task"];
    if (!draft || !range?.start || !range.end || isSameRange({ start: draft.originalStart, end: draft.originalEnd }, range)) return null;
    return range;
  })();
  const pendingCount = pendingChanges.length + (pendingDraftRange ? 1 : 0);

  useEffect(() => {
    if (!dragState) return;
    const activeDrag = dragState;
    function handlePointerMove(event: globalThis.PointerEvent) {
      const dayWidth = activeDrag.trackWidth / activeDrag.totalDays;
      const rawOffset = Math.round((event.clientX - activeDrag.pointerStartX) / dayWidth);
      const nextStartIndex =
        activeDrag.edge === "start"
          ? Math.min(activeDrag.originalEndIndex, Math.max(0, activeDrag.originalStartIndex + rawOffset))
          : activeDrag.originalStartIndex;
      const nextEndIndex =
        activeDrag.edge === "end"
          ? Math.max(activeDrag.originalStartIndex, Math.min(activeDrag.totalDays - 1, activeDrag.originalEndIndex + rawOffset))
          : activeDrag.originalEndIndex;
      const nextStart = addDays(activeDrag.chartStart, nextStartIndex);
      const nextEnd = addDays(activeDrag.chartStart, nextEndIndex);
      setOverrides((current) => {
        const original = { start: activeDrag.originalStart, end: activeDrag.originalEnd };
        const nextRange = { start: nextStart, end: nextEnd };
        if (isSameRange(original, nextRange)) {
          const { [activeDrag.itemId]: _discard, ...rest } = current;
          return rest;
        }
        return { ...current, [activeDrag.itemId]: nextRange };
      });
      setMessage("");
    }
    function handlePointerUp() {
      setDragState(null);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState]);

  useEffect(() => {
    if (!columnResizeState) return;
    const activeResize = columnResizeState;
    function handlePointerMove(event: globalThis.PointerEvent) {
      const nextWidth = clampInfoColumnWidth(activeResize.column, activeResize.startWidth + event.clientX - activeResize.pointerStartX);
      setInfoColumnWidths((current) => ({ ...current, [activeResize.column]: nextWidth }));
    }
    function handlePointerUp() {
      setColumnResizeState(null);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [columnResizeState]);

  function resetChanges() {
    setOverrides({});
    setMessage("");
  }

  function beginColumnResize(event: ReactPointerEvent<HTMLButtonElement>, column: InfoColumnKey) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setColumnResizeState({
      column,
      pointerStartX: event.clientX,
      startWidth: infoColumnWidths[column]
    });
  }

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>, item: ScheduleItem, edge: "start" | "end") {
    if (!canEditSchedule) {
      setMessage("只能调整自己的排期");
      return;
    }
    if (!canEditItemByPerson(item, currentPersonId)) {
      setMessage("只能调整自己作为负责人的事项排期");
      return;
    }
    if (!canEditItemSchedule(item)) {
      setMessage(scheduleDisabledReason(item));
      return;
    }
    if (!item.start || !item.end || !chartStart) return;
    const track = event.currentTarget.closest<HTMLElement>(".gantt-track");
    if (!track) return;
    const rect = track.getBoundingClientRect();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      itemId: item.id,
      edge,
      pointerStartX: event.clientX,
      trackWidth: rect.width,
      chartStart,
      totalDays,
      originalStartIndex: Math.max(0, diffDays(chartStart, item.start)),
      originalEndIndex: Math.max(0, diffDays(chartStart, item.end)),
      originalStart: item.originalStart || item.start,
      originalEnd: item.originalEnd || item.end
    });
  }

  function updateDateInput(item: ScheduleItem, edge: "start" | "end", value: string) {
    if (!canEditSchedule) {
      setMessage("只能调整自己的排期");
      return;
    }
    if (!canEditItemByPerson(item, currentPersonId)) {
      setMessage("只能调整自己作为负责人的事项排期");
      return;
    }
    if (!canEditItemSchedule(item)) {
      setMessage(scheduleDisabledReason(item));
      return;
    }
    const selectedDate = parseDateOnly(value);
    if (!selectedDate) return;
    const currentStart = item.start || item.end || selectedDate;
    const currentEnd = item.end || item.start || selectedDate;
    let nextStart = edge === "start" ? selectedDate : currentStart;
    let nextEnd = edge === "end" ? selectedDate : currentEnd;
    if (nextStart.getTime() > nextEnd.getTime()) {
      if (edge === "start") nextEnd = nextStart;
      else nextStart = nextEnd;
    }
    const original = { start: item.originalStart, end: item.originalEnd };
    const nextRange = { start: nextStart, end: nextEnd };
    setOverrides((current) => {
      if (isSameRange(original, nextRange)) {
        const { [item.id]: _discard, ...rest } = current;
        return rest;
      }
      return { ...current, [item.id]: nextRange };
    });
    setMessage("");
  }

  function showHoverTip(content: string, event: ReactMouseEvent<HTMLElement>) {
    const placement = event.clientY < 150 ? "bottom" : "top";
    setHoverTip({
      content,
      x: Math.max(12, Math.min(event.clientX + 14, window.innerWidth - 340)),
      y: placement === "top" ? event.clientY - 14 : event.clientY + 18,
      placement
    });
  }

  async function saveChanges() {
    if (!canEditSchedule) {
      setMessage("只能调整自己的排期");
      return;
    }
    const invalidPendingChange = pendingChanges.some((change) => {
      const item = baseItems.find((candidate) => candidate.kind === change.kind && candidate.rawId === change.id);
      return item ? !canEditItemSchedule(item) : true;
    });
    if (invalidPendingChange) {
      setMessage("只有待处理/处理中的开发任务、待修复/修复中的缺陷可以调整排期");
      return;
    }
    if (!pendingCount) return;
    setSaving(true);
    setMessage("");
    const success = pendingChanges.length ? await onSaveChanges(pendingChanges) : true;
    setSaving(false);
    if (success) {
      if (pendingDraftRange?.start && pendingDraftRange.end) {
        onDraftScheduleChange?.(dateToInput(pendingDraftRange.start), dateToInput(pendingDraftRange.end));
      }
      setOverrides({});
      setMessage(pendingChanges.length ? "排期已保存" : "当前表单排期已同步");
    } else {
      setMessage("保存失败，请查看页面顶部提示");
    }
  }

  const content = (
    <>
        <div className="section-title gantt-titlebar">
          <div>
            <h2>{title || `${assigneeName || "未选择负责人"}的排期情况`}</h2>
            <span className="section-note">
              {summary || `开发任务 ${tasks.length} 项，缺陷修复 ${defects.length} 项${canEditSchedule ? "；待处理/处理中的任务和待修复/修复中的缺陷可调整排期" : "；仅负责人本人可调整排期"}`}
            </span>
          </div>
          <div className="gantt-title-actions">
            {canEditSchedule ? (
              <>
                <button className="ghost" type="button" onClick={resetChanges} disabled={!pendingCount || saving}>
                  <RotateCcw size={17} /> 撤销调整
                </button>
                <button className="primary" type="button" onClick={saveChanges} disabled={!pendingCount || saving}>
                  <Save size={17} /> 保存排期{pendingCount ? `（${pendingCount}）` : ""}
                </button>
              </>
            ) : null}
            {!embedded ? (
              <button className="ghost icon-button" type="button" onClick={onClose} title="关闭">
                <X size={18} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="gantt-toolbar">
          <TableSearchControl
            options={searchOptions}
            field={searchField}
            keyword={searchKeyword}
            dateRange={searchDateRange}
            onFieldChange={setSearchField}
            onKeywordChange={setSearchKeyword}
            onDateRangeChange={setSearchDateRange}
          />
          <AntSelect
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            className="gantt-filter-select"
            placeholder="开发任务状态"
            value={selectedTaskStatuses}
            options={taskStatusSelectOptions}
            onChange={setSelectedTaskStatuses}
          />
          <AntSelect
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            className="gantt-filter-select"
            placeholder="缺陷修复状态"
            value={selectedDefectStatuses}
            options={defectStatusSelectOptions}
            onChange={setSelectedDefectStatuses}
          />
        </div>

        <div className="gantt-content">
          {visibleItems.length ? (
            <div className="gantt-scroll">
              <div className="gantt-body">
                <div className="gantt-grid-header" style={ganttGridStyle}>
                  <div className="gantt-info-head" style={infoGridStyle}>
                    {[
                      ["title", "事项"],
                      ["kind", "类型"],
                      ["status", "状态"],
                      [isProjectMode ? "assignee" : "dates", isProjectMode ? "负责人" : "起止时间"],
                      ["score", "优先级分数"]
                    ].map(([key, text]) => (
                      <span className="gantt-head-cell" key={key}>
                        {text}
                        <button
                          className="gantt-column-resizer"
                          type="button"
                          aria-label={`调整${text}列宽`}
                          title={`拖拽调整${text}列宽`}
                          onPointerDown={(event) => beginColumnResize(event, key as InfoColumnKey)}
                        />
                      </span>
                    ))}
                  </div>
                  <div className="gantt-axis" style={timelineGridStyle}>
                    {chartDays.map((day) => (
                      <span key={day.toISOString()} className={day.getDate() === 1 ? "month-start" : ""}>{formatScheduleDate(day)}</span>
                    ))}
                  </div>
                </div>
                <div className="gantt-list">
                  {visibleItems.map((item) => {
                    const itemCanEditSchedule = canEditSchedule && canEditItemByPerson(item, currentPersonId) && canEditItemSchedule(item);
                    const durationDays = item.start && item.end ? Math.max(1, diffDays(item.start, item.end) + 1) : 1;
                    const startIndex = item.start ? Math.max(0, diffDays(chartStart, item.start)) : 0;
                    const contextParts = [
                      `项目：${item.projectName}`,
                      item.requirementName !== "-" ? `需求：${item.requirementName}` : null,
                      item.taskName !== "-" ? `任务：${item.taskName}` : null
                    ].filter(Boolean) as string[];
                    const kindText = item.kind === "project" ? "项目计划" : item.kind === "task" ? "开发任务" : "缺陷修复";
                    const scoreText = item.kind === "project" ? "-" : String(item.priorityScore);
                    const tooltipText = `${item.title}｜${label(item.status)}｜负责人：${item.assigneeName || "-"}｜优先级分数：${scoreText}｜${dateRangeText(item)}${contextParts.length ? `｜${contextParts.join("｜")}` : ""}`;
                    return (
                      <div className={`${overrides[item.id] ? "gantt-row changed" : "gantt-row"} ${item.isDraft ? "current-draft" : ""}`} key={item.id} style={ganttGridStyle}>
                        <div className="gantt-row-info" style={infoGridStyle}>
                          <div className="gantt-label" title={`${item.title}\n${contextParts.join("\n")}`}>
                            <strong>{item.title}</strong>
                            <span>{item.isDraft ? `当前表单，提交前不会创建正式任务 / ${contextParts.join(" / ")}` : contextParts.join(" / ")}</span>
                          </div>
                          <div className="gantt-cell">{item.isDraft ? "当前新建" : kindText}</div>
                          <div className="gantt-cell">{label(item.status)}</div>
                          {isProjectMode ? (
                            <div className="gantt-cell">{item.assigneeName || "-"}</div>
                          ) : (
                            <div className="gantt-date-editor">
                              <input type="date" value={dateToInput(item.start)} disabled={!itemCanEditSchedule} title={itemCanEditSchedule ? "调整计划开始时间" : scheduleDisabledReason(item)} onChange={(event) => updateDateInput(item, "start", event.target.value)} aria-label="计划开始时间" />
                              <span>至</span>
                              <input type="date" value={dateToInput(item.end)} disabled={!itemCanEditSchedule} title={itemCanEditSchedule ? "调整计划结束时间" : scheduleDisabledReason(item)} onChange={(event) => updateDateInput(item, "end", event.target.value)} aria-label="计划结束时间" />
                            </div>
                          )}
                          <div className="gantt-score">{scoreText}</div>
                        </div>
                        <div className={item.start && item.end ? "gantt-track" : "gantt-track unscheduled"} style={timelineGridStyle}>
                          {item.start && item.end ? (
                            <div
                              className={`gantt-bar ${item.isDraft ? "draft" : item.kind === "project" ? "project" : item.kind === "defect" ? "defect" : "task"} ${itemCanEditSchedule ? "" : "readonly"}`}
                              style={{ gridColumn: `${startIndex + 1} / span ${durationDays}` }}
                              aria-label={tooltipText}
                              onMouseEnter={(event) => showHoverTip(tooltipText, event)}
                              onMouseMove={(event) => showHoverTip(tooltipText, event)}
                              onMouseLeave={() => setHoverTip(null)}
                            >
                              {itemCanEditSchedule ? (
                                <button className="gantt-resize-handle start" type="button" aria-label="调整开始时间" onPointerDown={(event) => beginResize(event, item, "start")} />
                              ) : null}
                              <span>{item.title}</span>
                              {itemCanEditSchedule ? (
                                <button className="gantt-resize-handle end" type="button" aria-label="调整结束时间" onPointerDown={(event) => beginResize(event, item, "end")} />
                              ) : null}
                            </div>
                          ) : (
                            <span className="gantt-unscheduled-marker">未排期</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="gantt-empty">暂无符合筛选条件的排期事项</div>
          )}
        </div>
        {message ? <p className="gantt-message">{message}</p> : null}
      </>
  );

  return (
    <div className={embedded ? "gantt-embedded" : "gantt-backdrop"}>
      {embedded ? content : <aside className="gantt-modal">{content}</aside>}
      {hoverTip ? (
        <div className={`gantt-hover-popover ${hoverTip.placement}`} style={{ left: hoverTip.x, top: hoverTip.y }}>
          {hoverTip.content}
        </div>
      ) : null}
    </div>
  );
}
