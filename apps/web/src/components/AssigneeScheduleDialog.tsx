import { RotateCcw, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { label } from "../lib/format";
import { Defect, DevTask } from "../types";

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
  kind: "task" | "defect";
  title: string;
  status: string;
  projectName: string;
  sourceName: string;
  priorityScore: number;
  start: Date | null;
  end: Date | null;
  originalStart: Date | null;
  originalEnd: Date | null;
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

const DAY_MS = 24 * 60 * 60 * 1000;
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

function buildItems(tasks: DevTask[], defects: Defect[], overrides: Record<string, DateRange>): ScheduleItem[] {
  return [
    ...tasks.map((task) => {
      const original = normalizeScheduleRange(parseDateOnly(task.plannedStartDate), parseDateOnly(task.plannedFinishDate));
      const key = `task-${task.id}`;
      const current = overrides[key] || original;
      return {
        id: key,
        rawId: task.id,
        kind: "task" as const,
        title: task.title,
        status: task.status,
        projectName: task.project?.name || "-",
        sourceName: task.requirement?.title || "-",
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
        title: defect.title,
        status: defect.status,
        projectName: defect.project?.name || defect.task?.project?.name || "-",
        sourceName: defect.task?.title || "-",
        priorityScore: defect.priorityScore || 0,
        start: current.start,
        end: current.end,
        originalStart: original.start,
        originalEnd: original.end
      };
    })
  ];
}

function sortByPriority(left: ScheduleItem, right: ScheduleItem) {
  return (right.priorityScore || 0) - (left.priorityScore || 0) || formatFullDate(left.start).localeCompare(formatFullDate(right.start)) || left.title.localeCompare(right.title);
}

function dateRangeText(item: ScheduleItem) {
  return `${formatFullDate(item.start)} 至 ${formatFullDate(item.end)}`;
}

function selectedStatusText(selectedValues: string[], options: string[]) {
  if (!selectedValues.length) return "未选择状态";
  if (selectedValues.length === options.length) return "全部状态";
  return selectedValues.map(label).join("、");
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
  tasks,
  defects,
  onClose,
  onSaveChanges
}: {
  assigneeId?: number | string;
  currentPersonId?: number | string;
  assigneeName?: string;
  tasks: DevTask[];
  defects: Defect[];
  onClose: () => void;
  onSaveChanges: (changes: ScheduleChange[]) => Promise<boolean>;
}) {
  const [selectedTaskStatuses, setSelectedTaskStatuses] = useState<string[]>(DEFAULT_TASK_STATUSES);
  const [selectedDefectStatuses, setSelectedDefectStatuses] = useState<string[]>(DEFAULT_DEFECT_STATUSES);
  const [overrides, setOverrides] = useState<Record<string, DateRange>>({});
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const canEditSchedule = Boolean(assigneeId && currentPersonId && String(assigneeId) === String(currentPersonId));

  useEffect(() => {
    setSelectedTaskStatuses(DEFAULT_TASK_STATUSES);
    setSelectedDefectStatuses(DEFAULT_DEFECT_STATUSES);
    setOverrides({});
    setMessage("");
  }, [assigneeId]);

  const taskStatusOptions = useMemo(() => buildStatusOptions(TASK_STATUS_ORDER, tasks.map((task) => task.status)), [tasks]);
  const defectStatusOptions = useMemo(() => buildStatusOptions(DEFECT_STATUS_ORDER, defects.map((defect) => defect.status)), [defects]);
  const baseItems = useMemo(() => buildItems(tasks, defects, overrides), [tasks, defects, overrides]);

  const visibleItems = baseItems
    .filter((item) => (item.kind === "task" ? selectedTaskStatuses.includes(item.status) : selectedDefectStatuses.includes(item.status)))
    .sort(sortByPriority);
  const scheduledItems = visibleItems.filter((item) => item.start && item.end);
  const unscheduledItems = visibleItems.filter((item) => !item.start || !item.end);
  const minStart = scheduledItems.reduce<Date | null>((min, item) => (!min || (item.start && item.start < min) ? item.start : min), null);
  const maxEnd = scheduledItems.reduce<Date | null>((max, item) => (!max || (item.end && item.end > max) ? item.end : max), null);
  const chartStart = minStart ? addDays(minStart, -7) : null;
  const chartEnd = maxEnd ? addDays(maxEnd, 14) : null;
  const chartDays = chartStart && chartEnd ? eachDay(chartStart, chartEnd) : [];
  const totalDays = Math.max(1, chartDays.length);
  const pendingChanges = Object.entries(overrides)
    .map(([id, range]) => {
      const item = baseItems.find((candidate) => candidate.id === id);
      if (!item || !range.start || !range.end || isSameRange({ start: item.originalStart, end: item.originalEnd }, range)) return null;
      return {
        kind: item.kind,
        id: item.rawId,
        plannedStartDate: dateToInput(range.start),
        plannedFinishDate: dateToInput(range.end)
      };
    })
    .filter(Boolean) as ScheduleChange[];

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

  function toggleStatus(kind: "task" | "defect", status: string) {
    const updater = (values: string[]) => (values.includes(status) ? values.filter((item) => item !== status) : [...values, status]);
    if (kind === "task") setSelectedTaskStatuses(updater);
    else setSelectedDefectStatuses(updater);
  }

  function resetFilters() {
    setSelectedTaskStatuses(DEFAULT_TASK_STATUSES);
    setSelectedDefectStatuses(DEFAULT_DEFECT_STATUSES);
  }

  function resetChanges() {
    setOverrides({});
    setMessage("");
  }

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>, item: ScheduleItem, edge: "start" | "end") {
    if (!canEditSchedule) {
      setMessage("只能调整自己的排期");
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

  async function saveChanges() {
    if (!canEditSchedule) {
      setMessage("只能调整自己的排期");
      return;
    }
    if (!pendingChanges.length) return;
    setSaving(true);
    setMessage("");
    const success = await onSaveChanges(pendingChanges);
    setSaving(false);
    if (success) {
      setOverrides({});
      setMessage("排期已保存");
    } else {
      setMessage("保存失败，请查看页面顶部提示");
    }
  }

  return (
    <div className="gantt-backdrop">
      <aside className="gantt-modal">
        <div className="section-title gantt-titlebar">
          <div>
            <h2>{assigneeName || "未选择负责人"}的排期情况</h2>
            <span className="section-note">
              开发任务 {tasks.length} 项，缺陷修复 {defects.length} 项{canEditSchedule ? "；拖动左右边界可调整计划起止时间" : "；仅负责人本人可调整排期"}
            </span>
          </div>
          <div className="gantt-title-actions">
            {canEditSchedule ? (
              <>
                <button className="ghost" type="button" onClick={resetChanges} disabled={!pendingChanges.length || saving}>
                  <RotateCcw size={17} /> 撤销调整
                </button>
                <button className="primary" type="button" onClick={saveChanges} disabled={!pendingChanges.length || saving}>
                  <Save size={17} /> 保存排期{pendingChanges.length ? `（${pendingChanges.length}）` : ""}
                </button>
              </>
            ) : null}
            <button className="ghost icon-button" type="button" onClick={onClose} title="关闭">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="gantt-toolbar">
          <details className="status-multiselect">
            <summary>
              <span>开发任务状态</span>
              <strong>{selectedStatusText(selectedTaskStatuses, taskStatusOptions)}</strong>
            </summary>
            <div className="status-menu">
              {taskStatusOptions.map((status) => (
                <label key={status}>
                  <input type="checkbox" checked={selectedTaskStatuses.includes(status)} onChange={() => toggleStatus("task", status)} />
                  {label(status)}
                </label>
              ))}
            </div>
          </details>
          <details className="status-multiselect">
            <summary>
              <span>缺陷修复状态</span>
              <strong>{selectedStatusText(selectedDefectStatuses, defectStatusOptions)}</strong>
            </summary>
            <div className="status-menu">
              {defectStatusOptions.map((status) => (
                <label key={status}>
                  <input type="checkbox" checked={selectedDefectStatuses.includes(status)} onChange={() => toggleStatus("defect", status)} />
                  {label(status)}
                </label>
              ))}
            </div>
          </details>
          <button className="ghost" type="button" onClick={resetFilters}>恢复默认状态</button>
        </div>

        <div className="gantt-content">
          {scheduledItems.length ? (
            <div className="gantt-scroll">
              <div className="gantt-body">
                <div className="gantt-grid-header">
                  <span>事项</span>
                  <span>起止时间</span>
                  <span>优先级分数</span>
                  <div className="gantt-axis" style={{ gridTemplateColumns: `repeat(${totalDays}, minmax(32px, 1fr))` }}>
                    {chartDays.map((day) => (
                      <span key={day.toISOString()} className={day.getDate() === 1 ? "month-start" : ""}>{formatScheduleDate(day)}</span>
                    ))}
                  </div>
                </div>
                <div className="gantt-list">
                  {scheduledItems.map((item) => {
                    const durationDays = item.start && item.end ? Math.max(1, diffDays(item.start, item.end) + 1) : 1;
                    const startIndex = item.start && chartStart ? Math.max(0, diffDays(chartStart, item.start)) : 0;
                    const tooltip = `${item.title}｜优先级分数：${item.priorityScore}｜${dateRangeText(item)}`;
                    return (
                      <div className={overrides[item.id] ? "gantt-row changed" : "gantt-row"} key={item.id}>
                        <div className="gantt-label">
                          <strong>{item.title}</strong>
                          <span>{item.kind === "task" ? "开发任务" : "缺陷修复"} · {label(item.status)} · {item.projectName} / {item.sourceName}</span>
                        </div>
                        <div className="gantt-date-range">{dateRangeText(item)}</div>
                        <div className="gantt-score">{item.priorityScore}</div>
                        <div className="gantt-track" style={{ gridTemplateColumns: `repeat(${totalDays}, minmax(32px, 1fr))` }}>
                          <div
                            className={`gantt-bar ${item.kind === "defect" ? "defect" : "task"} ${canEditSchedule ? "" : "readonly"}`}
                            style={{ gridColumn: `${startIndex + 1} / span ${durationDays}` }}
                            title={tooltip}
                            data-tooltip={tooltip}
                          >
                            {canEditSchedule ? (
                              <button className="gantt-resize-handle start" type="button" aria-label="调整开始时间" onPointerDown={(event) => beginResize(event, item, "start")} />
                            ) : null}
                            <span>{item.kind === "task" ? "开发任务" : "缺陷修复"}</span>
                            {canEditSchedule ? (
                              <button className="gantt-resize-handle end" type="button" aria-label="调整结束时间" onPointerDown={(event) => beginResize(event, item, "end")} />
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="gantt-empty">暂无符合筛选条件的已排期事项</div>
          )}
          {unscheduledItems.length ? (
            <div className="unscheduled-list">
              <h3>未排期事项</h3>
              {unscheduledItems.map((item) => (
                <div key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.kind === "task" ? "开发任务" : "缺陷修复"} · {label(item.status)} · 优先级分数 {item.priorityScore}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {message ? <p className="gantt-message">{message}</p> : null}
      </aside>
    </div>
  );
}
