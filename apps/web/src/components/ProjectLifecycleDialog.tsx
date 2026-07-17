import { CheckCircle2 } from "lucide-react";
import { FormEvent } from "react";
import { projectStageLabel } from "../lib/format";
import { Project } from "../types";
import { Textarea } from "./formControls";

export type ProjectLifecycleAction = "close" | "reopen";

export function ProjectLifecycleDialog({
  project,
  action,
  onClose,
  onSubmit
}: {
  project: Project | null;
  action: ProjectLifecycleAction | null;
  onClose: () => void;
  onSubmit: (project: Project, action: ProjectLifecycleAction, body: Record<string, unknown>) => Promise<boolean>;
}) {
  if (!project || !action) return null;
  const activeProject = project;
  const activeAction = action;
  const title = activeAction === "close" ? "项目结项" : "重新打开项目";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(activeProject, activeAction, Object.fromEntries(new FormData(event.currentTarget).entries()));
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
            <span>项目</span>
            <strong>{activeProject.name}</strong>
            <em>当前状态：{projectStageLabel(activeProject.stage)}</em>
          </div>
          <Textarea name="reason" label={activeAction === "close" ? "结项说明" : "重新打开原因"} />
          <div className="form-actions">
            <button type="button" className="ghost" onClick={onClose}>取消</button>
            <button className="primary" type="submit">
              <CheckCircle2 size={18} /> 确认
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
