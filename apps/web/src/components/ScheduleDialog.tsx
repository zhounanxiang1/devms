import { CheckCircle2 } from "lucide-react";
import { FormEvent } from "react";
import { toDateInput } from "../lib/format";
import { Defect, DevTask } from "../types";
import { Field } from "./formControls";

export type ScheduleEditState =
  | { type: "task"; item: DevTask }
  | { type: "defect"; item: Defect };

export function ScheduleDialog({
  state,
  onClose,
  onSubmit
}: {
  state: ScheduleEditState | null;
  onClose: () => void;
  onSubmit: (state: ScheduleEditState, body: Record<string, unknown>) => Promise<boolean>;
}) {
  if (!state) return null;
  const activeState = state;
  const isTask = activeState.type === "task";
  const title = isTask ? "调整任务排期" : "调整缺陷修复排期";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    await onSubmit(activeState, body);
  }

  return (
    <div className="drawer-backdrop">
      <aside className="drawer compact-drawer">
        <div className="section-title">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        <form className="drawer-form" onSubmit={submit}>
          <div className="schedule-target">
            <span>{isTask ? "任务" : "缺陷"}</span>
            <strong>{activeState.item.title}</strong>
            <em>{activeState.item.code}</em>
          </div>
          {isTask ? (
            <>
              <Field name="plannedStartDate" label="计划开始时间" type="date" defaultValue={toDateInput(activeState.item.plannedStartDate)} />
              <Field name="plannedFinishDate" label="计划完成时间" type="date" defaultValue={toDateInput(activeState.item.plannedFinishDate)} />
            </>
          ) : (
            <>
              <Field name="plannedStartDate" label="计划开始时间" type="date" defaultValue={toDateInput(activeState.item.plannedStartDate || activeState.item.plannedFixDate)} />
              <Field name="plannedFinishDate" label="计划结束时间" type="date" defaultValue={toDateInput(activeState.item.plannedFinishDate || activeState.item.plannedFixDate)} />
            </>
          )}
          <div className="form-actions">
            <button type="button" className="ghost" onClick={onClose}>取消</button>
            <button className="primary" type="submit">
              <CheckCircle2 size={18} /> 保存
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
