import { CheckCircle2 } from "lucide-react";
import { FormEvent } from "react";
import { projectStageLabel } from "../lib/format";
import { Project } from "../types";
import { Select, Textarea } from "./formControls";

export type ProjectLifecycleAction = "start" | "close" | "reopen";

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
  const title = activeAction === "start" ? "启动项目" : activeAction === "close" ? "项目结项" : "重新打开项目";
  const reasonLabel = activeAction === "start" ? "启动说明" : activeAction === "close" ? "结项说明" : "重新打开原因";

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
          {activeAction === "reopen" ? (
            <Select name="stage" label="重新打开后状态" defaultValue="ONLINE_OPS" options={[["ONLINE_OPS", "上线运维"], ["IN_PROGRESS", "进行中"]]} />
          ) : null}
          <Textarea name="reason" label={reasonLabel} />
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
