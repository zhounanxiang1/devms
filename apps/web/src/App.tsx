import {
  Archive,
  CheckCircle2,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  ListChecks,
  LogOut,
  PackageCheck,
  Pencil,
  Plus,
  Rocket,
  Save,
  Settings,
  Trash2,
  Users
} from "lucide-react";
import { FormEvent, MouseEvent, useEffect, useMemo, useState } from "react";
import { api, clearToken, getToken, patch, post, setToken } from "./api";
import { Badge, EmptyState, ListSection, Metric } from "./components/common";
import { DisplayField, Field, MultiSelect, PeopleSelect, ProjectSelect, ReadonlyField, Select, Textarea } from "./components/formControls";
import { ProjectLifecycleAction, ProjectLifecycleDialog } from "./components/ProjectLifecycleDialog";
import { RichTextDisplay, RichTextEditor } from "./components/RichText";
import { ScheduleDialog, ScheduleEditState } from "./components/ScheduleDialog";
import { clearFormDraft, draftArray, draftValue, FORM_DRAFT_PREFIX, hasDraftValues, readFormDraft, writeFormDraft } from "./lib/formDraft";
import { dictionaryOptions, dictionaryTypeLabel, dictionaryTypeUsage, fmtDate, isDue, isProductManagerPerson, label, projectStageLabel, toDateInput, todayDateInput } from "./lib/format";
import { dictionaryTypeMeta } from "./lib/labels";
import { stripRichText } from "./lib/richText";
import { Account, AdminData, AuthState, Defect, DevTask, Organization, Person, Position, Project, ReleaseVersion, Requirement } from "./types";

type View = "workbench" | "projects" | "execution" | "release" | "admin";
type DrawerKind = "project" | "requirement" | "task" | "defect" | "version" | "document" | "person" | null;
type DrawerContext = { projectId?: number; requirementId?: number; taskId?: number; editProjectId?: number; revisionMode?: "CHANGE" | "OPTIMIZATION" };
type AdminEditKind = "personAccount" | "organization" | "position" | "dictionary" | "requirementPriority" | "defectPriority";
type AdminEditState = { kind: AdminEditKind; item?: any } | null;
type RefreshTarget = "all" | "workbench" | "project" | "execution" | "release" | "admin";

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [view, setView] = useState<View>("workbench");
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [drawerContext, setDrawerContext] = useState<DrawerContext>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [workbench, setWorkbench] = useState<any>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projectDetail, setProjectDetail] = useState<any>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [tasks, setTasks] = useState<DevTask[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [versions, setVersions] = useState<ReleaseVersion[]>([]);
  const [admin, setAdmin] = useState<AdminData | null>(null);
  const [peopleDirectory, setPeopleDirectory] = useState<Person[]>([]);
  const [adminEdit, setAdminEdit] = useState<AdminEditState>(null);
  const [reviewTarget, setReviewTarget] = useState<Requirement | null>(null);
  const [scheduleEdit, setScheduleEdit] = useState<ScheduleEditState | null>(null);
  const [projectLifecycle, setProjectLifecycle] = useState<{ project: Project; action: ProjectLifecycleAction } | null>(null);

  const isProductManager = auth?.user.positions.includes("PRODUCT_MANAGER") || false;
  const canPublish = auth?.user.positions.some((item) => item === "PRODUCT_MANAGER" || item === "TEST") || false;
  const canTest = canPublish;
  const availablePeople = admin?.people?.length ? admin.people : peopleDirectory.length ? peopleDirectory : auth?.person ? [auth.person] : [];
  const availablePositions = admin?.positions || (auth?.user.positions.map((code) => ({ code, name: label(code), isActive: true })) ?? []);

  function openDrawer(kind: DrawerKind, context: DrawerContext = {}) {
    setDrawerContext(context);
    setDrawer(kind);
  }

  function closeDrawer() {
    setDrawer(null);
    setDrawerContext({});
  }

  useEffect(() => {
    if (!getToken()) return;
    api<{ user: AuthState["user"]; account: { person: AuthState["person"] } }>("/auth/me")
      .then((res) => setAuth({ user: res.user, person: res.account.person }))
      .catch(() => clearToken());
  }, []);

  useEffect(() => {
    if (auth) void loadAll();
  }, [auth]);

  async function loadAll() {
    setError("");
    await refreshData("all");
  }

  async function refreshAdminData() {
    if (!isProductManager) {
      setAdmin(null);
      return;
    }
    try {
      setAdmin(await api<AdminData>("/admin/bootstrap"));
    } catch {
      setAdmin(null);
    }
  }

  async function refreshSelectedProjectDetail(projectId = selectedProjectId) {
    if (!projectId) {
      setProjectDetail(null);
      return;
    }
    try {
      setProjectDetail(await api<any>(`/projects/${projectId}`));
    } catch {
      setProjectDetail(null);
    }
  }

  async function refreshData(target: RefreshTarget = "all") {
    const currentProjectId = selectedProjectId;
    if (target === "all") {
      const [wb, ps, reqs, ts, bugs, vers, people] = await Promise.all([
        api<any>("/workbench"),
        api<Project[]>("/projects"),
        api<Requirement[]>("/requirements"),
        api<DevTask[]>("/tasks"),
        api<Defect[]>("/defects"),
        api<ReleaseVersion[]>("/versions"),
        api<Person[]>("/admin/people")
      ]);
      setWorkbench(wb);
      setProjects(ps);
      setRequirements(reqs);
      setTasks(ts);
      setDefects(bugs);
      setVersions(vers);
      setPeopleDirectory(people);
      const nextProjectId = currentProjectId || ps[0]?.id || null;
      if (!currentProjectId && nextProjectId) setSelectedProjectId(nextProjectId);
      await Promise.all([refreshAdminData(), refreshSelectedProjectDetail(nextProjectId)]);
      return;
    }
    if (target === "project") {
      const [ps, reqs, ts, bugs, wb] = await Promise.all([
        api<Project[]>("/projects"),
        api<Requirement[]>("/requirements"),
        api<DevTask[]>("/tasks"),
        api<Defect[]>("/defects"),
        api<any>("/workbench")
      ]);
      setProjects(ps);
      setRequirements(reqs);
      setTasks(ts);
      setDefects(bugs);
      setWorkbench(wb);
      const nextProjectId = currentProjectId || ps[0]?.id || null;
      if (!currentProjectId && nextProjectId) setSelectedProjectId(nextProjectId);
      await refreshSelectedProjectDetail(nextProjectId);
      return;
    }
    if (target === "execution") {
      const [wb, ts, bugs] = await Promise.all([
        api<any>("/workbench"),
        api<DevTask[]>("/tasks"),
        api<Defect[]>("/defects")
      ]);
      setWorkbench(wb);
      setTasks(ts);
      setDefects(bugs);
      await refreshSelectedProjectDetail();
      return;
    }
    if (target === "release") {
      const [vers, reqs, bugs] = await Promise.all([
        api<ReleaseVersion[]>("/versions"),
        api<Requirement[]>("/requirements"),
        api<Defect[]>("/defects")
      ]);
      setVersions(vers);
      setRequirements(reqs);
      setDefects(bugs);
      await refreshSelectedProjectDetail();
      return;
    }
    if (target === "admin") {
      await refreshAdminData();
      return;
    }
    if (target === "workbench") {
      setWorkbench(await api<any>("/workbench"));
    }
  }

  useEffect(() => {
    if (!selectedProjectId || !auth) return;
    api<any>(`/projects/${selectedProjectId}`).then(setProjectDetail).catch(() => setProjectDetail(null));
  }, [selectedProjectId, auth, projects.length]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const res = await post<{ token: string; user: AuthState["user"]; person: AuthState["person"] }>("/auth/login", {
        username: form.get("username"),
        password: form.get("password")
      });
      setToken(res.token);
      setAuth({ user: res.user, person: res.person });
    } catch (err: any) {
      setError(err.message || "登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(action: () => Promise<unknown>, refreshTarget: RefreshTarget = "all") {
    setBusy(true);
    setError("");
    try {
      await action();
      await refreshData(refreshTarget);
      closeDrawer();
      return true;
    } catch (err: any) {
      const details = err.details?.invalidRequirements || err.details?.invalidDefects ? JSON.stringify(err.details, null, 2) : "";
      setError(`${err.message || "操作失败"}${details ? `\n${details}` : ""}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const nav = [
    ["workbench", "工作台", LayoutDashboard],
    ["projects", "项目中心", Archive],
    ["execution", "执行中心", ListChecks],
    ["release", "发布中心", Rocket],
    ...(isProductManager ? ([["admin", "后台管理", Settings]] as const) : [])
  ] as const;

  if (!auth) {
    return (
      <main className="login-screen">
        <section className="login-panel">
          <div>
            <p className="eyebrow">Demand OS</p>
            <h1>内部需求开发管理系统</h1>
          </div>
          <form onSubmit={login} className="login-form">
            <label>
              登录账号
              <input name="username" defaultValue="pm_admin" autoComplete="username" />
            </label>
            <label>
              密码
              <input name="password" type="password" defaultValue="123" autoComplete="current-password" />
            </label>
            {error ? <pre className="error">{error}</pre> : null}
            <button disabled={busy} className="primary" type="submit">
              <CheckCircle2 size={18} /> 登录
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Gauge size={24} />
          <div>
            <strong>需求管理</strong>
            <span>{auth.person?.name || auth.user.username}</span>
          </div>
        </div>
        <nav>
          {nav.map(([id, text, Icon]) => (
            <button key={id} onClick={() => setView(id)} className={view === id ? "active" : ""}>
              <Icon size={18} /> {text}
            </button>
          ))}
        </nav>
        <button
          className="ghost logout"
          onClick={() => {
            clearToken();
            setAuth(null);
          }}
        >
          <LogOut size={18} /> 退出
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{auth.user.positions.map(label).join(" / ")}</p>
            <h1>{nav.find(([id]) => id === view)?.[1]}</h1>
          </div>
          <QuickActions openDrawer={openDrawer} isProductManager={isProductManager} canPublish={canPublish} hasProjects={projects.length > 0} hasOpenProjects={projects.some((project) => project.stage !== "CLOSED")} />
        </header>

        {error ? <pre className="error">{error}</pre> : null}

        {view === "workbench" ? (
          <Workbench
            data={workbench}
            positions={auth.user.positions}
            onEditTask={(task) => setScheduleEdit({ type: "task", item: task })}
            onEditDefect={(defect) => setScheduleEdit({ type: "defect", item: defect })}
            onStartTask={(task) => handleAction(() => post(`/tasks/${task.id}/start`, {}), "execution")}
            onCompleteTask={(task) => handleAction(() => post(`/tasks/${task.id}/complete`, { completionNote: "工作台处理完成" }), "execution")}
            onStartTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-start`, {}), "execution")}
            onPassTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-pass`, { note: "工作台测试通过" }), "execution")}
            onCloseTask={(task) => handleAction(() => post(`/tasks/${task.id}/close`, { note: "工作台手动关闭" }), "execution")}
            onStartDefectFix={(defect) => handleAction(() => post(`/defects/${defect.id}/start-fix`, {}), "execution")}
            onCompleteDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/fix-complete`, { fixNote: "工作台完成修复" }), "execution")}
            canVerify={canTest}
            onVerifyDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/verify`, { verifyNote: "验证通过" }), "execution")}
            onRejectDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reject`, { reason: "验证未通过" }), "execution")}
            onCloseDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/close`, { reason: "手动关闭" }), "execution")}
            onReopenDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reopen`, { reason: "重新开启" }), "execution")}
            isProductManager={isProductManager}
          />
        ) : null}

        {view === "projects" ? (
          <ProjectCenter
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelect={setSelectedProjectId}
            detail={projectDetail}
            onNew={openDrawer}
            onStartTask={(task) => handleAction(() => post(`/tasks/${task.id}/start`, {}), "project")}
            onCompleteTask={(task) => handleAction(() => post(`/tasks/${task.id}/complete`, { completionNote: "项目中心处理完成" }), "project")}
            onStartTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-start`, {}), "project")}
            onPassTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-pass`, { note: "项目中心测试通过" }), "project")}
            onCloseTask={(task) => handleAction(() => post(`/tasks/${task.id}/close`, { note: "项目中心手动关闭" }), "project")}
            onStartDefectFix={(defect) => handleAction(() => post(`/defects/${defect.id}/start-fix`, {}), "project")}
            onCompleteDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/fix-complete`, { fixNote: "项目中心完成修复" }), "project")}
            onVerifyDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/verify`, { verifyNote: "验证通过" }), "project")}
            onRejectDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reject`, { reason: "验证未通过" }), "project")}
            onCloseDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/close`, { reason: "手动关闭" }), "project")}
            onReopenDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reopen`, { reason: "重新开启" }), "project")}
            onReviewRequirement={setReviewTarget}
            onProjectLifecycle={(project, action) => setProjectLifecycle({ project, action })}
            canTest={canTest}
            isProductManager={isProductManager}
            currentPersonId={auth.user.personId}
          />
        ) : null}

        {view === "execution" ? (
          <ExecutionCenter
            tasks={tasks}
            defects={defects}
            onStartTask={(task) => handleAction(() => post(`/tasks/${task.id}/start`, {}), "execution")}
            onCompleteTask={(task) => handleAction(() => post(`/tasks/${task.id}/complete`, { completionNote: "执行中心处理完成" }), "execution")}
            onStartTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-start`, {}), "execution")}
            onPassTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-pass`, { note: "执行中心测试通过" }), "execution")}
            onCloseTask={(task) => handleAction(() => post(`/tasks/${task.id}/close`, { note: "执行中心手动关闭" }), "execution")}
            onStartDefectFix={(defect) => handleAction(() => post(`/defects/${defect.id}/start-fix`, {}), "execution")}
            onCompleteDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/fix-complete`, { fixNote: "执行中心完成修复" }), "execution")}
            canVerify={canTest}
            onVerifyDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/verify`, { verifyNote: "验证通过" }), "execution")}
            onRejectDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reject`, { reason: "验证未通过" }), "execution")}
            onCloseDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/close`, { reason: "手动关闭" }), "execution")}
            onReopenDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reopen`, { reason: "重新开启" }), "execution")}
            isProductManager={isProductManager}
          />
        ) : null}

        {view === "release" ? (
          <ReleaseCenter versions={versions} canPublish={canPublish} onPublish={(version) => handleAction(() => post(`/versions/${version.id}/publish`, { releaseConclusion: "成功" }), "release")} />
        ) : null}

        {view === "admin" && isProductManager ? (
          <AdminCenter
            data={admin}
            onNewPerson={() => setAdminEdit({ kind: "personAccount" })}
            onEdit={setAdminEdit}
            onAdminPost={(path, body) => handleAction(() => post(path, body), "admin")}
          />
        ) : null}
      </main>

      <AdminEditDialog
        state={adminEdit}
        data={admin}
        onClose={() => setAdminEdit(null)}
        onSubmit={async (path, body) => {
          const success = await handleAction(() => post(path, body), "admin");
          if (success) setAdminEdit(null);
          return success;
        }}
      />

      <ReviewDialog
        requirement={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onSubmit={async (requirement, body) => {
          const success = await handleAction(() => post(`/requirements/${requirement.id}/review`, body), "project");
          if (success) setReviewTarget(null);
          return success;
        }}
      />

      <ScheduleDialog
        state={scheduleEdit}
        onClose={() => setScheduleEdit(null)}
        onSubmit={async (state, body) => {
          const path = state.type === "task" ? `/tasks/${state.item.id}` : `/defects/${state.item.id}`;
          const success = await handleAction(() => patch(path, body), "execution");
          if (success) setScheduleEdit(null);
          return success;
        }}
      />

      <ProjectLifecycleDialog
        project={projectLifecycle?.project || null}
        action={projectLifecycle?.action || null}
        onClose={() => setProjectLifecycle(null)}
        onSubmit={async (project, action, body) => {
          const success = await handleAction(() => post(`/projects/${project.id}/${action}`, body), "project");
          if (success) setProjectLifecycle(null);
          return success;
        }}
      />

      <CreateDrawer
        kind={drawer}
        context={drawerContext}
        currentUser={auth.user}
        currentPerson={auth.person}
        onClose={closeDrawer}
        projects={projects}
        requirements={requirements}
        tasks={tasks}
        defects={defects}
        people={availablePeople}
        positions={availablePositions}
        dictionaries={admin?.dictionaries || []}
        requirementPriorities={admin?.requirementPriorities || []}
        defectPriorities={admin?.defectPriorities || []}
        onSubmit={(kind, body) => {
          if (kind === "project" && drawerContext.editProjectId) {
            return handleAction(() => patch(`/projects/${drawerContext.editProjectId}`, body), "project");
          }
          if (kind === "requirement" && drawerContext.requirementId && drawerContext.revisionMode) {
            return handleAction(() => post(`/requirements/${drawerContext.requirementId}/revision`, { ...body, mode: drawerContext.revisionMode }), "project");
          }
          const map: Record<Exclude<DrawerKind, null>, string> = {
            project: "/projects",
            requirement: "/requirements",
            task: "/tasks",
            defect: "/defects",
            version: "/versions",
            document: "/documents",
            person: "/admin/people"
          };
          const refreshByKind: Record<Exclude<DrawerKind, null>, RefreshTarget> = {
            project: "project",
            requirement: "project",
            task: "project",
            defect: "project",
            version: "release",
            document: "project",
            person: "admin"
          };
          return handleAction(() => post(map[kind], body), refreshByKind[kind]);
        }}
      />
    </div>
  );

}

function QuickActions({
  openDrawer,
  isProductManager,
  canPublish,
  hasProjects,
  hasOpenProjects
}: {
  openDrawer: (kind: DrawerKind, context?: DrawerContext) => void;
  isProductManager: boolean;
  canPublish: boolean;
  hasProjects: boolean;
  hasOpenProjects: boolean;
}) {
  const projectRequiredTitle = hasProjects ? undefined : "请先新建项目";
  const openProjectRequiredTitle = hasOpenProjects ? undefined : hasProjects ? "没有可继续维护的项目，请先重新打开项目" : "请先新建项目";
  return (
    <div className="actions">
      {isProductManager ? (
        <>
          <button onClick={() => openDrawer("project")} title="新建项目">
            <Plus size={17} /> 新建项目
          </button>
          <button onClick={() => openDrawer("requirement")} title={openProjectRequiredTitle || "新建需求"} disabled={!hasOpenProjects}>
            <ClipboardList size={17} /> 新建需求
          </button>
        </>
      ) : null}
      <button onClick={() => openDrawer("document")} title={projectRequiredTitle || "新增资料"} disabled={!hasProjects}>
        <Archive size={17} /> 新增资料
      </button>
      {canPublish ? (
        <button onClick={() => openDrawer("version")} title={openProjectRequiredTitle || "新建版本"} disabled={!hasOpenProjects}>
          <Rocket size={17} /> 新建版本
        </button>
      ) : null}
    </div>
  );
}

function Workbench({
  data,
  positions,
  onEditTask,
  onEditDefect,
  onStartTask,
  onCompleteTask,
  onStartTaskTest,
  onPassTaskTest,
  onCloseTask,
  onStartDefectFix,
  onCompleteDefect,
  canVerify,
  onVerifyDefect,
  onRejectDefect,
  onCloseDefect,
  onReopenDefect,
  isProductManager
}: {
  data: any;
  positions: string[];
  onEditTask: (task: DevTask) => void;
  onEditDefect: (defect: Defect) => void;
  onStartTask: (task: DevTask) => void;
  onCompleteTask: (task: DevTask) => void;
  onStartTaskTest: (task: DevTask) => void;
  onPassTaskTest: (task: DevTask) => void;
  onCloseTask: (task: DevTask) => void;
  onStartDefectFix: (defect: Defect) => void;
  onCompleteDefect: (defect: Defect) => void;
  canVerify: boolean;
  onVerifyDefect: (defect: Defect) => void;
  onRejectDefect: (defect: Defect) => void;
  onCloseDefect: (defect: Defect) => void;
  onReopenDefect: (defect: Defect) => void;
  isProductManager: boolean;
}) {
  const emphasis = useMemo(() => {
    if (positions.includes("PRODUCT_MANAGER")) return "待评审需求、需求变更、测试确认和后台管理";
    if (positions.includes("TEST")) return "测试中需求、待验证缺陷和发布检查";
    if (positions.includes("UI")) return "设计任务和相关需求";
    if (positions.includes("OPS")) return "待发布版本和上线资料";
    return "开发任务、缺陷修复和排期调整";
  }, [positions]);

  return (
    <section className="page-stack">
      <div className="summary-band">
        <Metric label="需求开发" value={data?.summary?.developmentTasks || 0} />
        <Metric label="缺陷修复" value={data?.summary?.defectTasks || 0} />
        <Metric label="临期超期" value={data?.summary?.dueSoon || 0} tone="warn" />
        <div className="focus-line">{emphasis}</div>
      </div>
      <TaskTable
        tasks={data?.developmentTasks || []}
        onEdit={onEditTask}
        onStart={onStartTask}
        onComplete={onCompleteTask}
        onStartTest={onStartTaskTest}
        onPassTest={onPassTaskTest}
        onClose={onCloseTask}
        canTest={canVerify}
        isProductManager={isProductManager}
      />
      <DefectTable
        defects={data?.defectTasks || []}
        onEdit={onEditDefect}
        onStartFix={onStartDefectFix}
        onComplete={onCompleteDefect}
        canVerify={canVerify}
        onVerify={onVerifyDefect}
        onReject={onRejectDefect}
        onClose={onCloseDefect}
        onReopen={onReopenDefect}
      />
      <RecentLogs logs={data?.recentLogs || []} />
    </section>
  );
}

function ProjectCenter({
  projects,
  selectedProjectId,
  onSelect,
  detail,
  onNew,
  onStartTask,
  onCompleteTask,
  onStartTaskTest,
  onPassTaskTest,
  onCloseTask,
  onStartDefectFix,
  onCompleteDefect,
  onVerifyDefect,
  onRejectDefect,
  onCloseDefect,
  onReopenDefect,
  onReviewRequirement,
  onProjectLifecycle,
  canTest,
  isProductManager,
  currentPersonId
}: {
  projects: Project[];
  selectedProjectId: number | null;
  onSelect: (id: number) => void;
  detail: any;
  onNew: (kind: DrawerKind, context?: DrawerContext) => void;
  onStartTask: (task: DevTask) => void;
  onCompleteTask: (task: DevTask) => void;
  onStartTaskTest: (task: DevTask) => void;
  onPassTaskTest: (task: DevTask) => void;
  onCloseTask: (task: DevTask) => void;
  onStartDefectFix: (defect: Defect) => void;
  onCompleteDefect: (defect: Defect) => void;
  onVerifyDefect: (defect: Defect) => void;
  onRejectDefect: (defect: Defect) => void;
  onCloseDefect: (defect: Defect) => void;
  onReopenDefect: (defect: Defect) => void;
  onReviewRequirement: (requirement: Requirement) => void;
  onProjectLifecycle: (project: Project, action: ProjectLifecycleAction) => void;
  canTest: boolean;
  isProductManager: boolean;
  currentPersonId: number;
}) {
  const [activeTab, setActiveTab] = useState<"requirements" | "tasks" | "defects">("requirements");
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState("ALL");
  const requirements = (detail?.requirements || []) as Requirement[];
  const tasks = (detail?.tasks || []) as DevTask[];
  const defects = (detail?.defects || []) as Defect[];
  const normalizedKeyword = keyword.trim().toLowerCase();
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || detail;
  const canEditProject = isProductManager || detail?.owner?.id === currentPersonId || detail?.ownerId === currentPersonId;
  const isProjectClosed = detail?.stage === "CLOSED";
  const statusOptions = useMemo(() => {
    const source = activeTab === "requirements" ? requirements : activeTab === "tasks" ? tasks : defects;
    return Array.from(new Set(source.map((item: any) => item.status).filter(Boolean)));
  }, [activeTab, requirements, tasks, defects]);
  const assigneeOptions = useMemo(() => {
    const source = activeTab === "tasks" ? tasks : defects;
    const pairs = source
      .map((item: any) => item.assignee ? [String(item.assignee.id), item.assignee.name] as [string, string] : null)
      .filter(Boolean) as Array<[string, string]>;
    return Array.from(new Map(pairs).entries());
  }, [activeTab, tasks, defects]);
  const filteredRequirements = requirements.filter((item) => {
    const text = `${item.title} ${item.code} ${item.type} ${item.priorityLevel}`.toLowerCase();
    return (!normalizedKeyword || text.includes(normalizedKeyword)) && (statusFilter === "ALL" || item.status === statusFilter);
  });
  const filteredTasks = tasks.filter((item) => {
    const text = `${item.title} ${item.code} ${item.type} ${item.requirement?.title || ""}`.toLowerCase();
    const assigneeId = item.assignee?.id ? String(item.assignee.id) : "";
    return (!normalizedKeyword || text.includes(normalizedKeyword)) && (statusFilter === "ALL" || item.status === statusFilter) && (assigneeFilter === "ALL" || assigneeId === assigneeFilter);
  });
  const filteredDefects = defects.filter((item) => {
    const text = `${item.title} ${item.code} ${item.level} ${item.task?.title || ""} ${item.task?.requirement?.title || ""}`.toLowerCase();
    const assigneeId = item.assignee?.id ? String(item.assignee.id) : "";
    return (!normalizedKeyword || text.includes(normalizedKeyword)) && (statusFilter === "ALL" || item.status === statusFilter) && (assigneeFilter === "ALL" || assigneeId === assigneeFilter);
  });

  function resetFilters(nextTab: "requirements" | "tasks" | "defects") {
    setActiveTab(nextTab);
    setKeyword("");
    setStatusFilter("ALL");
    setAssigneeFilter("ALL");
  }

  return (
    <section className="page-stack project-page">
      <section className="project-overview">
        <div className="section-title">
          <div>
            <h2>项目选择</h2>
            <p className="section-note">先选定项目，再查看和维护项目内的需求、任务、缺陷。</p>
          </div>
          <label className="inline-filter project-picker">
            项目
            <select value={selectedProjectId || ""} onChange={(event) => onSelect(Number(event.currentTarget.value))}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
        </div>
        {detail ? (
          <>
            <div className="project-summary">
              <div className="project-heading">
                <span className="status-pill">项目状态：{projectStageLabel(detail.stage)}</span>
                <h2>{detail.name}</h2>
                <div className="project-rich-block">
                  <span>需求范围</span>
                  <RichTextDisplay value={detail.scope} />
                </div>
              </div>
              <div className="project-meta-grid">
                <span>项目编号<strong>{detail.code}</strong></span>
                <span>当前阶段<strong>{projectStageLabel(detail.stage)}</strong></span>
                <span>计划周期<strong>{fmtDate(detail.plannedStartDate)} - {fmtDate(detail.plannedEndDate)}</strong></span>
                <span>期望上线<strong>{fmtDate(detail.expectedLaunchDate)}</strong></span>
                <span>项目负责人<strong>{detail.owner?.name || "-"}</strong></span>
              </div>
              <div className="actions">
                {canEditProject ? (
                  <button onClick={() => onNew("project", { editProjectId: detail.id })}>
                    <Pencil size={17} /> 编辑项目
                  </button>
                ) : null}
                {canEditProject && !isProjectClosed ? (
                  <button onClick={() => onProjectLifecycle(detail, "close")}>
                    <CheckCircle2 size={17} /> 项目结项
                  </button>
                ) : null}
                {canEditProject && isProjectClosed ? (
                  <button onClick={() => onProjectLifecycle(detail, "reopen")}>
                    <Rocket size={17} /> 重新打开
                  </button>
                ) : null}
                <button disabled={isProjectClosed} title={isProjectClosed ? "项目已结项，不能新增需求" : "新增需求"} onClick={() => onNew("requirement", { projectId: detail.id })}>
                  <Plus size={17} /> 需求
                </button>
                <button onClick={() => onNew("document", { projectId: detail.id })}>
                  <Plus size={17} /> 资料
                </button>
              </div>
            </div>
            <div className="project-info-grid">
              <div className="project-rich-block">
                <span>项目背景</span>
                <RichTextDisplay value={detail.background} />
              </div>
              <div className="project-rich-block">
                <span>项目目标</span>
                <RichTextDisplay value={detail.goal} />
              </div>
              <div className="project-rich-block">
                <span>涉及系统</span>
                <RichTextDisplay value={detail.relatedSystems} />
              </div>
            </div>
          </>
        ) : (
          <EmptyState text="暂无项目" />
        )}
      </section>

      {detail ? (
        <>
          <div className="tabs">
            <button className={activeTab === "requirements" ? "active" : ""} onClick={() => resetFilters("requirements")}>需求</button>
            <button className={activeTab === "tasks" ? "active" : ""} onClick={() => resetFilters("tasks")}>任务</button>
            <button className={activeTab === "defects" ? "active" : ""} onClick={() => resetFilters("defects")}>缺陷</button>
          </div>
          <div className="table-filters">
            <Field name="projectKeywordFilter" label="关键字" value={keyword} onChange={setKeyword} />
            <Select name="projectStatusFilter" label="状态" value={statusFilter} onChange={setStatusFilter} options={[["ALL", "全部状态"], ...statusOptions.map((status) => [status, label(status)] as [string, string])]} />
            {activeTab !== "requirements" ? (
              <Select name="projectAssigneeFilter" label="负责人" value={assigneeFilter} onChange={setAssigneeFilter} options={[["ALL", "全部负责人"], ...assigneeOptions]} />
            ) : null}
          </div>
          {activeTab === "requirements" ? (
            <RequirementTable
              requirements={filteredRequirements}
              project={selectedProject}
              onNewTask={(requirement) => onNew("task", { projectId: requirement.projectId, requirementId: requirement.id })}
              onRevision={(requirement, revisionMode) => onNew("requirement", { projectId: requirement.projectId, requirementId: requirement.id, revisionMode })}
              onReview={onReviewRequirement}
              isProductManager={isProductManager}
              isProjectClosed={isProjectClosed}
            />
          ) : null}
          {activeTab === "tasks" ? (
            <TaskTable
              tasks={filteredTasks}
              onStart={onStartTask}
              onComplete={onCompleteTask}
              onStartTest={onStartTaskTest}
              onPassTest={onPassTaskTest}
              onClose={onCloseTask}
              onNewDefect={(task) => onNew("defect", { projectId: task.project?.id || task.requirement?.projectId, requirementId: task.requirement?.id, taskId: task.id })}
              canTest={canTest}
              isProductManager={isProductManager}
              isProjectClosed={isProjectClosed}
            />
          ) : null}
          {activeTab === "defects" ? (
            <DefectTable
              defects={filteredDefects}
              onStartFix={onStartDefectFix}
              onComplete={onCompleteDefect}
              canVerify={canTest}
              onVerify={onVerifyDefect}
              onReject={onRejectDefect}
              onClose={onCloseDefect}
              onReopen={onReopenDefect}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ExecutionCenter({
  tasks,
  defects,
  onStartTask,
  onCompleteTask,
  onStartTaskTest,
  onPassTaskTest,
  onCloseTask,
  onStartDefectFix,
  onCompleteDefect,
  canVerify,
  onVerifyDefect,
  onRejectDefect,
  onCloseDefect,
  onReopenDefect,
  isProductManager
}: {
  tasks: DevTask[];
  defects: Defect[];
  onStartTask: (task: DevTask) => void;
  onCompleteTask: (task: DevTask) => void;
  onStartTaskTest: (task: DevTask) => void;
  onPassTaskTest: (task: DevTask) => void;
  onCloseTask: (task: DevTask) => void;
  onStartDefectFix: (defect: Defect) => void;
  onCompleteDefect: (defect: Defect) => void;
  canVerify: boolean;
  onVerifyDefect: (defect: Defect) => void;
  onRejectDefect: (defect: Defect) => void;
  onCloseDefect: (defect: Defect) => void;
  onReopenDefect: (defect: Defect) => void;
  isProductManager: boolean;
}) {
  return (
    <section className="page-stack">
      <TaskTable
        tasks={tasks}
        onStart={onStartTask}
        onComplete={onCompleteTask}
        onStartTest={onStartTaskTest}
        onPassTest={onPassTaskTest}
        onClose={onCloseTask}
        canTest={canVerify}
        isProductManager={isProductManager}
      />
      <DefectTable
        defects={defects}
        onStartFix={onStartDefectFix}
        onComplete={onCompleteDefect}
        canVerify={canVerify}
        onVerify={onVerifyDefect}
        onReject={onRejectDefect}
        onClose={onCloseDefect}
        onReopen={onReopenDefect}
      />
    </section>
  );
}

function ReleaseCenter({ versions, canPublish, onPublish }: { versions: ReleaseVersion[]; canPublish: boolean; onPublish: (version: ReleaseVersion) => void }) {
  return (
    <section className="table-section">
      <div className="section-title">
        <h2>版本发布</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th>版本</th>
            <th>项目</th>
            <th>状态</th>
            <th>计划上线</th>
            <th>需求</th>
            <th>缺陷</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => (
            <tr key={version.id}>
              <td>
                <strong>{version.name}</strong>
                <span>{version.code}</span>
              </td>
              <td>{version.project?.name || "-"}</td>
              <td><Badge value={label(version.status)} /></td>
              <td>{fmtDate(version.plannedReleaseAt)}</td>
              <td>{version.requirements?.length || 0}</td>
              <td>{version.defects?.length || 0}</td>
              <td>
                {canPublish ? (
                  <button className="compact primary" onClick={() => onPublish(version)}>
                    <PackageCheck size={16} /> 发布
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AdminCenter({
  data,
  onNewPerson,
  onEdit
}: {
  data: AdminData | null;
  onNewPerson: () => void;
  onEdit: (state: Exclude<AdminEditState, null>) => void;
  onAdminPost: (path: string, body: any) => Promise<boolean>;
}) {
  const [dictionaryType, setDictionaryType] = useState("ALL");
  if (!data) return <EmptyState text="后台数据加载中" />;
  const accountByPerson = new Map(data.accounts.map((account) => [account.person.id, account]));
  const dictionaryTypes = Array.from(new Set(data.dictionaries.map((item) => item.type))).sort();
  const dictionaries = dictionaryType === "ALL" ? data.dictionaries : data.dictionaries.filter((item) => item.type === dictionaryType);
  const activeDictionaryMeta = dictionaryType === "ALL" ? null : dictionaryTypeMeta[dictionaryType];
  return (
    <section className="page-stack">
      <section className="table-section">
        <div className="section-title">
          <h2>人员与登录账号</h2>
          <div className="actions">
            <button onClick={onNewPerson}>
              <Plus size={17} /> 人员与账号
            </button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>姓名</th>
              <th>员工编号</th>
              <th>组织</th>
              <th>岗位</th>
              <th>登录账号</th>
              <th>账号状态</th>
              <th>登录</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.people.map((person) => {
              const account = accountByPerson.get(person.id);
              return (
                <tr key={person.id}>
                  <td>{person.name}</td>
                  <td>{person.employeeNo || "-"}</td>
                  <td>{person.organization?.name || "-"}</td>
                  <td>{person.primaryPosition?.name || "-"}</td>
                  <td>{account?.username || "-"}</td>
                  <td><Badge value={account ? label(account.status) : "未开通"} /></td>
                  <td>{account ? (account.allowLogin ? "允许" : "禁止") : "-"}</td>
                  <td className="row-actions">
                    <button className="compact" onClick={() => onEdit({ kind: "personAccount", item: { ...person, account } })}>
                      <Pencil size={15} /> 编辑
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section className="config-grid">
        <div className="table-section">
          <div className="section-title">
            <h2>组织配置</h2>
            <button onClick={() => onEdit({ kind: "organization" })}>
              <Plus size={17} /> 组织
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>组织名称</th>
                <th>编码</th>
                <th>负责人</th>
                <th>状态</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.organizations.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.code}</td>
                  <td>{data.people.find((person) => person.id === item.managerId)?.name || "-"}</td>
                  <td><Badge value={label(item.status)} /></td>
                  <td><button className="compact" onClick={() => onEdit({ kind: "organization", item })}>编辑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-section">
          <div className="section-title">
            <h2>岗位配置</h2>
            <button onClick={() => onEdit({ kind: "position" })}>
              <Plus size={17} /> 岗位
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>岗位名称</th>
                <th>编码</th>
                <th>状态</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.positions.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.code}</td>
                  <td><Badge value={item.isActive ? "启用" : "停用"} /></td>
                  <td><button className="compact" onClick={() => onEdit({ kind: "position", item })}>编辑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="table-section">
        <div className="section-title">
          <h2>需求优先级分值</h2>
          <span className="section-note">需求分 = 基础分 + 时效加分；缺陷会使用这里的缺陷系数。</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>等级</th>
              <th>基础分</th>
              <th>缺陷系数</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.requirementPriorities.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.baseScore}</td>
                <td>{item.defectWeight}</td>
                <td><Badge value={item.isActive === false ? "停用" : "启用"} /></td>
                <td><button className="compact" onClick={() => onEdit({ kind: "requirementPriority", item })}>编辑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="table-section">
        <div className="section-title">
          <h2>缺陷基础分值</h2>
          <span className="section-note">缺陷分 = 环境基础分 * 需求缺陷系数 + 时效加分。</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>等级</th>
              <th>线上</th>
              <th>线下/灰度</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.defectPriorities.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.onlineScore}</td>
                <td>{item.offlineScore}</td>
                <td><Badge value={item.isActive === false ? "停用" : "启用"} /></td>
                <td><button className="compact" onClick={() => onEdit({ kind: "defectPriority", item })}>编辑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="table-section">
        <div className="section-title">
          <div>
            <h2>字典配置</h2>
            <p className="section-note">
              字典类型是系统配置分类；编码给系统识别，显示名称给页面展示。
              {activeDictionaryMeta ? ` 当前类型：${activeDictionaryMeta.name}，${activeDictionaryMeta.usage}` : " 选择具体类型可查看它在系统中的使用位置。"}
            </p>
          </div>
          <div className="actions">
            <label className="inline-filter">
              类型
              <select value={dictionaryType} onChange={(event) => setDictionaryType(event.currentTarget.value)}>
                <option value="ALL">全部</option>
                {dictionaryTypes.map((type) => (
                  <option key={type} value={type}>{dictionaryTypeLabel(type)}</option>
                ))}
              </select>
            </label>
            <button onClick={() => onEdit({ kind: "dictionary" })}>
              <Plus size={17} /> 字典
            </button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>编码</th>
              <th>显示名称</th>
              <th>使用位置</th>
              <th>状态</th>
              <th>排序</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {dictionaries.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{dictionaryTypeMeta[item.type]?.name || item.type}</strong>
                  <span>{item.type}</span>
                </td>
                <td>{item.code}</td>
                <td>{item.name}</td>
                <td className="usage-cell">{dictionaryTypeUsage(item.type)}</td>
                <td><Badge value={item.isActive ? "启用" : "停用"} /></td>
                <td>{item.sort ?? 0}</td>
                <td><button className="compact" onClick={() => onEdit({ kind: "dictionary", item })}>编辑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <RecentLogs logs={data.logs} />
    </section>
  );
}

function AdminEditDialog({
  state,
  data,
  onClose,
  onSubmit
}: {
  state: AdminEditState;
  data: AdminData | null;
  onClose: () => void;
  onSubmit: (path: string, body: any) => Promise<boolean>;
}) {
  const kind = state?.kind;
  const item = state?.item || {};
  const account = item.account || {};
  const draftKey = kind ? `${FORM_DRAFT_PREFIX}:admin:${kind}:${item.id || account.id || "new"}` : "";
  const draft = readFormDraft(draftKey);
  const draftRestored = hasDraftValues(draft);
  const [draftMessage, setDraftMessage] = useState("");
  const [draftStamp, setDraftStamp] = useState(0);
  useEffect(() => {
    setDraftMessage("");
  }, [draftKey]);
  if (!state || !data || !kind) return null;
  const activeAdminKind = kind;
  const titleMap: Record<AdminEditKind, string> = {
    personAccount: item.id ? "编辑人员与账号" : "新增人员与账号",
    organization: item.id ? "编辑组织" : "新增组织",
    position: item.id ? "编辑岗位" : "新增岗位",
    dictionary: item.id ? "编辑字典" : "新增字典",
    requirementPriority: "编辑需求优先级",
    defectPriority: "编辑缺陷分值"
  };
  const pathMap: Record<AdminEditKind, string> = {
    personAccount: "/admin/person-account",
    organization: "/admin/organizations",
    position: "/admin/positions",
    dictionary: "/admin/dictionaries",
    requirementPriority: "/admin/requirement-priorities",
    defectPriority: "/admin/defect-priorities"
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, any> = Object.fromEntries(form.entries());
    if (item.id) body.id = item.id;
    if (activeAdminKind === "personAccount" && account.id) body.accountId = account.id;
    if ((activeAdminKind === "requirementPriority" || activeAdminKind === "defectPriority") && item.code) {
      body.code = item.code;
    }
    const success = await onSubmit(pathMap[activeAdminKind], body);
    if (success) clearFormDraft(draftKey);
  }

  function saveDraft(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form) return;
    writeFormDraft(draftKey, form);
    setDraftMessage("草稿已暂存，下次打开这个表单会自动带出。");
  }

  function discardDraft() {
    clearFormDraft(draftKey);
    setDraftMessage("草稿已清除。");
    setDraftStamp((value) => value + 1);
  }

  return (
    <div className="drawer-backdrop">
      <aside className="drawer">
        <div className="section-title">
          <h2>{titleMap[activeAdminKind]}</h2>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        <form key={`${draftKey}:${draftStamp}`} className="drawer-form" onSubmit={submit}>
          {activeAdminKind === "personAccount" ? (
            <>
              <h3 className="form-section-title">人员档案</h3>
              <Field name="name" label="姓名" required defaultValue={draftValue(draft, "name", item.name)} />
              <Field name="employeeNo" label="员工编号（工号，非登录账号）" defaultValue={draftValue(draft, "employeeNo", item.employeeNo)} />
              <Field name="phone" label="手机号" defaultValue={draftValue(draft, "phone", item.phone)} />
              <Field name="email" label="邮箱" defaultValue={draftValue(draft, "email", item.email)} />
              <Select name="organizationId" label="所属组织" defaultValue={draftValue(draft, "organizationId", item.organizationId)} options={[["", "未指定"], ...data.organizations.map((org) => [String(org.id), org.name] as [string, string])]} />
              <Select name="primaryPositionCode" label="主岗位" defaultValue={draftValue(draft, "primaryPositionCode", item.primaryPosition?.code)} options={data.positions.filter((position) => position.isActive !== false).map((position) => [position.code, position.name])} />
              <Select name="employmentStatus" label="人员状态" defaultValue={draftValue(draft, "employmentStatus", item.employmentStatus || "ACTIVE")} options={[["ACTIVE", "在职"], ["LEFT", "离职"], ["DISABLED", "停用"]]} />
              <h3 className="form-section-title">登录账号</h3>
              <Field name="username" label="登录账号（留空则暂不开通）" required={Boolean(account.id)} defaultValue={draftValue(draft, "username", account.username)} />
              <Field name="password" label={account.id ? "重置密码（留空则不修改）" : "初始密码（留空默认 123）"} type="password" />
              <Select name="accountStatus" label="账号状态" defaultValue={draftValue(draft, "accountStatus", account.status || "ACTIVE")} options={[["ACTIVE", "正常"], ["DISABLED", "停用"], ["LOCKED", "锁定"]]} />
              <Select name="allowLogin" label="是否允许登录" defaultValue={draftValue(draft, "allowLogin", String(account.allowLogin ?? true))} options={[["true", "允许"], ["false", "禁止"]]} />
              <Textarea name="accountNote" label="账号备注" defaultValue={draftValue(draft, "accountNote", account.note)} />
            </>
          ) : null}

          {activeAdminKind === "organization" ? (
            <>
              <Field name="name" label="组织名称" required defaultValue={draftValue(draft, "name", item.name)} />
              <Field name="code" label="组织编码" required defaultValue={draftValue(draft, "code", item.code)} />
              <Select name="parentId" label="上级组织" defaultValue={draftValue(draft, "parentId", item.parentId)} options={[["", "无上级"], ...data.organizations.filter((org) => org.id !== item.id).map((org) => [String(org.id), org.name] as [string, string])]} />
              <PeopleSelect name="managerId" label="组织负责人" people={data.people} defaultValue={draftValue(draft, "managerId", item.managerId)} />
              <Select name="status" label="组织状态" defaultValue={draftValue(draft, "status", item.status || "ACTIVE")} options={[["ACTIVE", "启用"], ["DISABLED", "停用"]]} />
              <Field name="sort" label="排序" type="number" defaultValue={draftValue(draft, "sort", item.sort ?? 0)} />
            </>
          ) : null}

          {activeAdminKind === "position" ? (
            <>
              <Field name="name" label="岗位名称" required defaultValue={draftValue(draft, "name", item.name)} />
              <Field name="code" label={item.isSystem ? "岗位编码（内置，不可修改）" : "岗位编码"} required={!item.id} defaultValue={draftValue(draft, "code", item.code)} disabled={item.isSystem} />
              <Field name="category" label="岗位分类" defaultValue={draftValue(draft, "category", item.category)} />
              <Textarea name="description" label="岗位说明" defaultValue={draftValue(draft, "description", item.description)} />
              <Select name="isActive" label="状态" defaultValue={draftValue(draft, "isActive", String(item.isActive ?? true))} options={[["true", "启用"], ["false", "停用"]]} />
            </>
          ) : null}

          {activeAdminKind === "dictionary" ? (
            <>
              <Field name="type" label={item.isSystem ? "字典类型（内置，不可修改）" : "字典类型"} required defaultValue={draftValue(draft, "type", item.type)} disabled={item.isSystem} />
              <Field name="code" label={item.isSystem ? "字典编码（内置，不可修改）" : "字典编码"} required defaultValue={draftValue(draft, "code", item.code)} disabled={item.isSystem} />
              <Field name="name" label="显示名称" required defaultValue={draftValue(draft, "name", item.name)} />
              <Textarea name="description" label="说明" defaultValue={draftValue(draft, "description", item.description)} />
              <Select name="isActive" label="状态" defaultValue={draftValue(draft, "isActive", String(item.isActive ?? true))} options={[["true", "启用"], ["false", "停用"]]} />
              <Field name="sort" label="排序" type="number" defaultValue={draftValue(draft, "sort", item.sort ?? 0)} />
            </>
          ) : null}

          {activeAdminKind === "requirementPriority" ? (
            <>
              <Field name="name" label="等级名称" required defaultValue={draftValue(draft, "name", item.name)} />
              <Textarea name="description" label="说明" defaultValue={draftValue(draft, "description", item.description)} />
              <Field name="baseScore" label="基础分" type="number" required defaultValue={draftValue(draft, "baseScore", item.baseScore)} />
              <Field name="defectWeight" label="缺陷加权系数" type="number" required defaultValue={draftValue(draft, "defectWeight", item.defectWeight)} />
              <Select name="isActive" label="状态" defaultValue={draftValue(draft, "isActive", String(item.isActive ?? true))} options={[["true", "启用"], ["false", "停用"]]} />
              <Field name="sort" label="排序" type="number" defaultValue={draftValue(draft, "sort", item.sort ?? 0)} />
            </>
          ) : null}

          {activeAdminKind === "defectPriority" ? (
            <>
              <Field name="name" label="等级名称" required defaultValue={draftValue(draft, "name", item.name)} />
              <Textarea name="description" label="说明" defaultValue={draftValue(draft, "description", item.description)} />
              <Field name="onlineScore" label="线上生产基础分" type="number" required defaultValue={draftValue(draft, "onlineScore", item.onlineScore)} />
              <Field name="offlineScore" label="线下/灰度基础分" type="number" required defaultValue={draftValue(draft, "offlineScore", item.offlineScore)} />
              <Select name="isActive" label="状态" defaultValue={draftValue(draft, "isActive", String(item.isActive ?? true))} options={[["true", "启用"], ["false", "停用"]]} />
              <Field name="sort" label="排序" type="number" defaultValue={draftValue(draft, "sort", item.sort ?? 0)} />
            </>
          ) : null}

          {draftMessage || draftRestored ? <p className="draft-hint">{draftMessage || "已恢复上次暂存草稿，提交成功后会自动清除。"}</p> : null}
          <div className="form-actions">
            {draftRestored ? (
              <button type="button" className="ghost" onClick={discardDraft}>
                <Trash2 size={18} /> 清除草稿
              </button>
            ) : null}
            <button type="button" onClick={saveDraft}>
              <Save size={18} /> 暂存草稿
            </button>
            <button className="primary" type="submit">
              <CheckCircle2 size={18} /> 提交
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function TaskTable({
  tasks,
  onEdit,
  onStart,
  onComplete,
  onStartTest,
  onPassTest,
  onClose,
  onNewDefect,
  canTest,
  isProductManager,
  isProjectClosed
}: {
  tasks: DevTask[];
  onEdit?: (task: DevTask) => void;
  onStart?: (task: DevTask) => void;
  onComplete?: (task: DevTask) => void;
  onStartTest?: (task: DevTask) => void;
  onPassTest?: (task: DevTask) => void;
  onClose?: (task: DevTask) => void;
  onNewDefect?: (task: DevTask) => void;
  canTest?: boolean;
  isProductManager?: boolean;
  isProjectClosed?: boolean;
}) {
  const canPassTask = (task: DevTask) => !task.defects?.some((defect) => !["VERIFIED", "CLOSED"].includes(defect.status));
  return (
    <section className="table-section">
      <div className="section-title">
        <h2>需求开发</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th>任务</th>
            <th>项目</th>
            <th>需求</th>
            <th>负责人</th>
            <th>状态</th>
            <th>排期</th>
            <th>优先级分数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tasks.length ? tasks.map((task) => (
            <tr key={task.id} className={isDue(task.plannedFinishDate) ? "due" : ""}>
              <td>
                <strong>{task.title}</strong>
                <span>{task.code} · {task.type}</span>
              </td>
              <td>{task.project?.name || "-"}</td>
              <td>{task.requirement?.title || "-"}</td>
              <td>{task.assignee?.name || "-"}</td>
              <td><Badge value={label(task.status)} /></td>
              <td>{fmtDate(task.plannedStartDate)} - {fmtDate(task.plannedFinishDate)}</td>
              <td>{task.priorityScore}</td>
              <td className="row-actions">
                {onEdit ? <button className="compact" onClick={() => onEdit(task)}>编辑</button> : null}
                {onNewDefect ? (
                  <button className="compact" disabled={isProjectClosed} title={isProjectClosed ? "项目已结项，不能新增缺陷" : "创建缺陷"} onClick={() => onNewDefect(task)}>
                    <Plus size={15} /> 缺陷
                  </button>
                ) : null}
                {onStart && task.status === "TODO" ? <button className="compact primary" onClick={() => onStart(task)}>开始处理</button> : null}
                {onComplete && task.status === "DOING" ? <button className="compact primary" onClick={() => onComplete(task)}>处理完成</button> : null}
                {canTest && onStartTest && task.status === "TO_TEST" ? <button className="compact primary" onClick={() => onStartTest(task)}>开始测试</button> : null}
                {canTest && onPassTest && task.status === "TESTING" ? (
                  <button className="compact primary" disabled={!canPassTask(task)} title={canPassTask(task) ? "测试通过" : "任务下仍有未验证或未关闭的缺陷"} onClick={() => onPassTest(task)}>
                    测试通过
                  </button>
                ) : null}
                {isProductManager && onClose && !["TEST_PASSED", "CLOSED"].includes(task.status) ? <button className="compact" onClick={() => onClose(task)}>关闭</button> : null}
              </td>
            </tr>
          )) : (
            <tr>
              <td colSpan={8}><div className="table-empty">暂无需求开发任务</div></td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function DefectTable({
  defects,
  onEdit,
  onStartFix,
  onComplete,
  canVerify,
  onVerify,
  onReject,
  onClose,
  onReopen
}: {
  defects: Defect[];
  onEdit?: (defect: Defect) => void;
  onStartFix?: (defect: Defect) => void;
  onComplete?: (defect: Defect) => void;
  canVerify?: boolean;
  onVerify?: (defect: Defect) => void;
  onReject?: (defect: Defect) => void;
  onClose?: (defect: Defect) => void;
  onReopen?: (defect: Defect) => void;
}) {
  return (
    <section className="table-section">
      <div className="section-title">
        <h2>缺陷修复</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th>缺陷</th>
            <th>项目</th>
            <th>关联任务/需求</th>
            <th>负责人</th>
            <th>状态</th>
            <th>环境</th>
            <th>优先级分数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {defects.length ? defects.map((defect) => (
            <tr key={defect.id} className={isDue(defect.plannedFixDate) ? "due" : ""}>
              <td>
                <strong>{defect.title}</strong>
                <span>{defect.code} · {defect.level}</span>
              </td>
              <td>{defect.project?.name || "-"}</td>
              <td>{defect.task?.title || "-"} / {defect.task?.requirement?.title || defect.requirement?.title || "-"}</td>
              <td>{defect.assignee?.name || "-"}</td>
              <td><Badge value={label(defect.status)} /></td>
              <td>{defect.environment}</td>
              <td>{defect.priorityScore}</td>
              <td className="row-actions">
                {onEdit ? <button className="compact" onClick={() => onEdit(defect)}>编辑</button> : null}
                {onStartFix && defect.status === "TO_FIX" ? <button className="compact primary" onClick={() => onStartFix(defect)}>开始修复</button> : null}
                {onComplete && ["TO_FIX", "FIXING"].includes(defect.status) ? <button className="compact primary" onClick={() => onComplete(defect)}>已修复</button> : null}
                {canVerify && onVerify && defect.status === "FIXED" ? <button className="compact primary" onClick={() => onVerify(defect)}>验证通过</button> : null}
                {canVerify && onReject && defect.status === "FIXED" ? <button className="compact" onClick={() => onReject(defect)}>验证未通过</button> : null}
                {canVerify && onClose && defect.status !== "CLOSED" ? <button className="compact" onClick={() => onClose(defect)}>关闭</button> : null}
                {canVerify && onReopen && defect.status === "CLOSED" ? <button className="compact" onClick={() => onReopen(defect)}>开启</button> : null}
              </td>
            </tr>
          )) : (
            <tr>
              <td colSpan={8}><div className="table-empty">暂无缺陷修复任务</div></td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function RequirementTable({
  requirements,
  project,
  onNewTask,
  onRevision,
  onReview,
  isProductManager,
  isProjectClosed
}: {
  requirements: Requirement[];
  project?: Project | null;
  onNewTask: (requirement: Requirement) => void;
  onRevision: (requirement: Requirement, revisionMode: "CHANGE" | "OPTIMIZATION") => void;
  onReview: (requirement: Requirement) => void;
  isProductManager?: boolean;
  isProjectClosed?: boolean;
}) {
  const canOperateRequirement = (requirement: Requirement) => !["CHANGE", "OPTIMIZATION"].includes(requirement.status);
  const canCreateTask = (requirement: Requirement) => !isProjectClosed && ["APPROVED", "DEVELOPING"].includes(requirement.status);
  const canReview = (requirement: Requirement) => isProductManager && ["TO_REVIEW", "NEEDS_SUPPLEMENT"].includes(requirement.status);
  const taskButtonTitle = (requirement: Requirement) => {
    if (isProjectClosed) return "项目已结项，不能创建任务";
    return canCreateTask(requirement) ? "创建任务" : "评审通过或开发中才可以创建任务";
  };
  return (
    <section className="table-section">
      <div className="section-title">
        <h2>需求</h2>
        <span className="section-note">任务从需求行内创建；缺陷从任务行内创建。需求变更/优化会关闭原需求下的任务和缺陷，并创建一个新需求。</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>需求</th>
            <th>项目</th>
            <th>类型</th>
            <th>性质</th>
            <th>需求状态</th>
            <th>上线状态</th>
            <th>优先级分数</th>
            <th>任务</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {requirements.length ? requirements.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.title}</strong>
                <span>{item.code}</span>
              </td>
              <td>{item.project?.name || project?.name || "-"}</td>
              <td>{item.type}</td>
              <td>{item.priorityLevel}</td>
              <td><Badge value={label(item.status)} /></td>
              <td><Badge value={label(item.launchStatus || "TO_RELEASE")} /></td>
              <td>{item.priorityScore}</td>
              <td>{(item as any)._count?.tasks ?? "-"}</td>
              <td className="row-actions">
                {canReview(item) ? <button className="compact primary" onClick={() => onReview(item)}>评审</button> : null}
                <button className="compact" disabled={!canCreateTask(item)} title={taskButtonTitle(item)} onClick={() => onNewTask(item)}>
                  <Plus size={15} /> 任务
                </button>
                {isProductManager && canOperateRequirement(item) ? <button className="compact" onClick={() => onRevision(item, "CHANGE")}>变更</button> : null}
                {isProductManager && canOperateRequirement(item) ? <button className="compact" onClick={() => onRevision(item, "OPTIMIZATION")}>优化</button> : null}
              </td>
            </tr>
          )) : (
            <tr>
              <td colSpan={9}><div className="table-empty">暂无需求</div></td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function RecentLogs({ logs }: { logs: Array<{ id: number; summary: string; createdAt: string; actor?: { name: string } }> }) {
  return (
    <section className="timeline">
      <div className="section-title">
        <h2>处理记录</h2>
      </div>
      {logs.length ? logs.map((log) => (
        <div key={log.id} className="timeline-item">
          <span>{fmtDate(log.createdAt)}</span>
          <strong>{log.summary}</strong>
          <em>{log.actor?.name || ""}</em>
        </div>
      )) : <EmptyState text="暂无处理记录" />}
    </section>
  );
}

function ReviewDialog({
  requirement,
  onClose,
  onSubmit
}: {
  requirement: Requirement | null;
  onClose: () => void;
  onSubmit: (requirement: Requirement, body: any) => Promise<boolean>;
}) {
  const draftKey = requirement ? `${FORM_DRAFT_PREFIX}:review:${requirement.id}` : "";
  const draft = requirement ? readFormDraft(draftKey) : null;
  const draftRestored = hasDraftValues(draft);
  const [draftMessage, setDraftMessage] = useState("");
  const [draftStamp, setDraftStamp] = useState(0);
  useEffect(() => {
    setDraftMessage("");
  }, [draftKey]);
  if (!requirement) return null;
  const activeRequirement = requirement;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    const success = await onSubmit(activeRequirement, body);
    if (success) clearFormDraft(draftKey);
  }

  function saveDraft(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form) return;
    writeFormDraft(draftKey, form);
    setDraftMessage("草稿已暂存，下次打开这个评审表单会自动带出。");
  }

  function discardDraft() {
    clearFormDraft(draftKey);
    setDraftMessage("草稿已清除。");
    setDraftStamp((value) => value + 1);
  }

  return (
    <div className="drawer-backdrop">
      <aside className="drawer">
        <div className="section-title">
          <h2>填写评审结果</h2>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        <form key={`${draftKey}:${draftStamp}`} className="drawer-form" onSubmit={submit}>
          <ReadonlyField name="requirementTitle" label="需求" value={requirement.title} displayValue={`${requirement.title}（${requirement.code}）`} />
          <Select
            name="conclusion"
            label="评审结论"
            required
            defaultValue={draftValue(draft, "conclusion", requirement.reviewConclusion || "PASS")}
            options={[
              ["PASS", "通过"],
              ["REJECT", "不通过"],
              ["SUPPLEMENT", "待补充"],
              ["DEFER", "暂缓"],
              ["CANCEL", "取消"]
            ]}
          />
          <Field name="reviewDate" label="评审日期" type="date" required defaultValue={draftValue(draft, "reviewDate", toDateInput(requirement.reviewDate) || todayDateInput())} />
          <Textarea name="reviewRecord" label="评审记录/结论说明" defaultValue={draftValue(draft, "reviewRecord", requirement.reviewRecord)} />
          {draftMessage || draftRestored ? <p className="draft-hint">{draftMessage || "已恢复上次暂存草稿，提交成功后会自动清除。"}</p> : null}
          <div className="form-actions">
            {draftRestored ? (
              <button type="button" className="ghost" onClick={discardDraft}>
                <Trash2 size={18} /> 清除草稿
              </button>
            ) : null}
            <button type="button" onClick={saveDraft}>
              <Save size={18} /> 暂存草稿
            </button>
            <button className="primary" type="submit">
              <CheckCircle2 size={18} /> 提交
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function personPrimaryPositionCode(person?: Person | null) {
  return person?.primaryPosition?.code || person?.positions?.find((item) => item.isPrimary)?.position.code || person?.positions?.[0]?.position.code || "";
}

function personPrimaryPositionName(person?: Person | null) {
  return person?.primaryPosition?.name || person?.positions?.find((item) => item.isPrimary)?.position.name || person?.positions?.[0]?.position.name || "";
}

function RequirementPrioritySummary({ requirement }: { requirement?: Requirement | null }) {
  return (
    <section className="priority-overview requirement-priority">
      <span>需求优先级分数</span>
      <strong>{requirement?.priorityScore ?? "-"}</strong>
      <em>{requirement ? `${requirement.title}（${requirement.code}）` : "请选择关联需求"}</em>
    </section>
  );
}

function AssigneeWorkloadPanel({
  assigneeName,
  assigneeTasks,
  assigneeDefects
}: {
  assigneeName?: string;
  assigneeTasks: DevTask[];
  assigneeDefects: Defect[];
}) {
  return (
    <section className="priority-panel">
      <div className="section-title compact-title">
        <div>
          <h3>{assigneeName || "未选择负责人"}</h3>
          <span className="section-note">完整展示当前待处理开发任务和缺陷修复，按优先级分数倒序。</span>
        </div>
        <div className="workload-stats">
          <span>开发 {assigneeTasks.length}</span>
          <span>缺陷 {assigneeDefects.length}</span>
        </div>
      </div>
      <div className="priority-columns">
        <PriorityItems
          title="开发任务"
          emptyText="暂无开发任务"
          items={assigneeTasks.map((task) => ({
            id: task.id,
            title: task.title,
            meta: `${task.project?.name || "-"} / ${task.requirement?.title || "-"}`,
            status: task.status,
            plannedAt: fmtDate(task.plannedFinishDate),
            priorityScore: task.priorityScore
          }))}
        />
        <PriorityItems
          title="缺陷修复"
          emptyText="暂无缺陷修复"
          items={assigneeDefects.map((defect) => ({
            id: defect.id,
            title: defect.title,
            meta: `${defect.project?.name || "-"} / ${defect.task?.title || "-"}`,
            status: defect.status,
            plannedAt: fmtDate(defect.plannedFixDate),
            priorityScore: defect.priorityScore
          }))}
        />
      </div>
    </section>
  );
}

function PriorityItems({
  title,
  emptyText,
  items
}: {
  title: string;
  emptyText: string;
  items: Array<{ id: number; title: string; meta: string; status: string; plannedAt: string; priorityScore: number }>;
}) {
  return (
    <div className="priority-list">
      <div className="priority-list-head">
        <h4>{title}</h4>
        <span>{items.length} 项</span>
      </div>
      {items.length ? (
        <div className="priority-table-wrap">
          <table className="priority-table">
            <thead>
              <tr>
                <th>事项</th>
                <th>状态</th>
                <th>计划</th>
                <th>优先级</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                    <span>{item.meta}</span>
                  </td>
                  <td><Badge value={label(item.status)} /></td>
                  <td>{item.plannedAt}</td>
                  <td className="priority-score">{item.priorityScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{emptyText}</p>
      )}
    </div>
  );
}

function CreateDrawer({
  kind,
  context,
  currentUser,
  currentPerson,
  onClose,
  projects,
  requirements,
  tasks,
  defects,
  people,
  positions,
  dictionaries,
  requirementPriorities,
  defectPriorities,
  onSubmit
}: {
  kind: DrawerKind;
  context: DrawerContext;
  currentUser: AuthState["user"];
  currentPerson?: AuthState["person"];
  onClose: () => void;
  projects: Project[];
  requirements: Requirement[];
  tasks: DevTask[];
  defects: Defect[];
  people: Person[];
  positions: Array<{ code: string; name: string; isActive?: boolean }>;
  dictionaries: AdminData["dictionaries"];
  requirementPriorities: AdminData["requirementPriorities"];
  defectPriorities: AdminData["defectPriorities"];
  onSubmit: (kind: Exclude<DrawerKind, null>, body: any) => Promise<boolean>;
}) {
  const currentPositionCode = currentUser.primaryPosition || currentUser.positions[0] || "";
  const currentPersonId = currentPerson?.id || currentUser.personId;
  const activeKind = kind;
  const draftScope = context.editProjectId
    ? `project-edit:${context.editProjectId}`
    : context.taskId
    ? `task:${context.taskId}`
    : context.requirementId
      ? `${context.revisionMode || "requirement"}:${context.requirementId}`
      : context.projectId
        ? `project:${context.projectId}`
        : "general";
  const draftKey = activeKind ? `${FORM_DRAFT_PREFIX}:create:${activeKind}:${draftScope}` : "";
  const draft = readFormDraft(draftKey);
  const draftRestored = hasDraftValues(draft);
  const [draftMessage, setDraftMessage] = useState("");
  const [draftStamp, setDraftStamp] = useState(0);
  const [versionProjectId, setVersionProjectId] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState(String(currentPersonId || ""));
  const openProjectFallbackId = projects.find((project) => project.stage !== "CLOSED")?.id || "";
  useEffect(() => {
    setDraftMessage("");
  }, [draftKey]);
  useEffect(() => {
    if (kind === "version") {
      setVersionProjectId(String(draftValue(draft, "projectId", openProjectFallbackId) || ""));
    }
  }, [kind, draftKey, openProjectFallbackId]);
  useEffect(() => {
    if (kind === "task") {
      setTaskAssigneeId(String(draftValue(draft, "assigneeId", currentPersonId) || ""));
    }
  }, [kind, draftKey, currentPersonId]);
  if (!activeKind) return null;
  const activeDrawerKind = activeKind;
  const selectedProject = context.projectId ? projects.find((project) => project.id === context.projectId) : null;
  const editingProject = context.editProjectId ? projects.find((project) => project.id === context.editProjectId) : null;
  const selectedTask = context.taskId ? tasks.find((task) => task.id === context.taskId) : null;
  const selectedRequirement = context.requirementId
    ? requirements.find((requirement) => requirement.id === context.requirementId)
    : selectedTask?.requirement || null;
  const contextProject = editingProject || selectedProject || selectedTask?.project || selectedRequirement?.project || (selectedRequirement?.projectId ? projects.find((project) => project.id === selectedRequirement.projectId) : null);
  const openProjects = projects.filter((project) => project.stage !== "CLOSED");
  const openProjectIds = new Set(openProjects.map((project) => project.id));
  const selectableProjects = activeDrawerKind === "document" ? projects : openProjects;
  const selectableTaskRequirements = requirements.filter((item) => openProjectIds.has(item.projectId) && ["APPROVED", "DEVELOPING"].includes(item.status));
  const selectableDefectTasks = tasks.filter((item) => {
    const projectId = item.project?.id || item.requirement?.projectId;
    return Boolean(projectId && openProjectIds.has(projectId) && !["TEST_PASSED", "CLOSED"].includes(item.status));
  });
  const selectedVersionProjectId = Number(versionProjectId || openProjectFallbackId || 0);
  const selectableVersionRequirements = requirements.filter((item) => item.projectId === selectedVersionProjectId && openProjectIds.has(item.projectId) && item.status === "COMPLETED" && (item.launchStatus || "TO_RELEASE") === "TO_RELEASE");
  const selectableVersionDefects = defects.filter((item) => {
    const projectId = item.project?.id || item.task?.project?.id || item.task?.requirement?.projectId;
    return Boolean(projectId && projectId === selectedVersionProjectId && openProjectIds.has(projectId) && ["VERIFIED", "CLOSED"].includes(item.status));
  });
  const productManagers = people.filter(isProductManagerPerson);
  const defaultProjectOwnerId = editingProject?.ownerId || editingProject?.owner?.id || (isProductManagerPerson(currentPerson) ? currentPersonId : productManagers[0]?.id);
  const requirementTypeOptions = dictionaryOptions(dictionaries, "REQUIREMENT_TYPE", [["FEATURE", "功能需求"], ["PROCESS", "流程需求"], ["DATA", "数据需求"], ["REPORT", "报表需求"], ["UX", "体验优化"]]);
  const requirementLaunchStatusOptions = dictionaryOptions(dictionaries, "REQUIREMENT_LAUNCH_STATUS", [["TO_RELEASE", "待上线"], ["RELEASED", "已上线"]]);
  const versionTypeOptions = dictionaryOptions(dictionaries, "VERSION_TYPE", [["NORMAL", "常规版本"], ["HOTFIX", "紧急修复"], ["GRAY", "灰度版本"]]);
  const documentTypeOptions = dictionaryOptions(dictionaries, "DOCUMENT_TYPE", [["BUSINESS", "业务资料"], ["TECH", "技术资料"], ["TEST", "测试资料"], ["RELEASE", "上线资料"]]);
  const taskAssigneeNumberId = Number(taskAssigneeId);
  const selectedTaskAssignee = people.find((person) => person.id === taskAssigneeNumberId);
  const taskTypeCode = personPrimaryPositionCode(selectedTaskAssignee) || currentPositionCode;
  const taskTypeName = personPrimaryPositionName(selectedTaskAssignee) || positions.find((position) => position.code === taskTypeCode)?.name || label(taskTypeCode);
  const assigneeTasks = tasks
    .filter((task) => task.assignee?.id === taskAssigneeNumberId && !["TEST_PASSED", "CLOSED"].includes(task.status))
    .sort((left, right) => (right.priorityScore || 0) - (left.priorityScore || 0));
  const assigneeDefects = defects
    .filter((defect) => defect.assignee?.id === taskAssigneeNumberId && !["VERIFIED", "CLOSED"].includes(defect.status))
    .sort((left, right) => (right.priorityScore || 0) - (left.priorityScore || 0));
  const titles: Record<Exclude<DrawerKind, null>, string> = {
    project: "新建项目",
    requirement: "新建需求",
    task: "新建开发任务",
    defect: "新建缺陷",
    version: "新建版本",
    document: "新增资料",
    person: "新增人员"
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalidRichField = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>("[data-rich-required='true']")).find((input) => !stripRichText(input.value));
    if (invalidRichField) {
      setDraftMessage(`${invalidRichField.dataset.richLabel || "必填内容"}不能为空。`);
      invalidRichField.closest(".rich-editor-field")?.querySelector<HTMLElement>(".rich-editor")?.focus();
      return;
    }
    const form = new FormData(event.currentTarget);
    const body: Record<string, any> = Object.fromEntries(form.entries());
    Object.keys(body).forEach((key) => {
      if (key.endsWith("__required")) delete body[key];
    });
    if (activeDrawerKind === "version") {
      body.requirementIds = form.getAll("requirementIds").map(Number) as any;
      body.defectIds = form.getAll("defectIds").map(Number) as any;
    }
    const success = await onSubmit(activeDrawerKind, body);
    if (success) clearFormDraft(draftKey);
  }

  function saveDraft(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form) return;
    writeFormDraft(draftKey, form);
    setDraftMessage("草稿已暂存，下次打开这个表单会自动带出。");
  }

  function discardDraft() {
    clearFormDraft(draftKey);
    if (activeDrawerKind === "task") setTaskAssigneeId(String(currentPersonId || ""));
    setDraftMessage("草稿已清除。");
    setDraftStamp((value) => value + 1);
  }

  return (
    <div className="drawer-backdrop">
      <aside className="drawer">
        <div className="section-title">
          <h2>{activeDrawerKind === "project" && editingProject ? "编辑项目" : activeDrawerKind === "requirement" && context.revisionMode ? (context.revisionMode === "OPTIMIZATION" ? "需求优化" : "需求变更") : titles[activeDrawerKind]}</h2>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        <form key={`${draftKey}:${draftStamp}`} className="drawer-form" onSubmit={submit}>
          {activeDrawerKind === "project" ? (
            <>
              <Field name="name" label="项目名称" required defaultValue={draftValue(draft, "name", editingProject?.name)} />
              <RichTextEditor name="scope" label="需求范围" required defaultValue={draftValue(draft, "scope", editingProject?.scope)} />
              <Field name="plannedStartDate" label="计划开始时间" type="date" defaultValue={draftValue(draft, "plannedStartDate", editingProject ? toDateInput(editingProject.plannedStartDate) : todayDateInput())} />
              <Field name="plannedEndDate" label="计划结束时间" type="date" defaultValue={draftValue(draft, "plannedEndDate", toDateInput(editingProject?.plannedEndDate))} />
              <Field name="expectedLaunchDate" label="期望上线时间" type="date" defaultValue={draftValue(draft, "expectedLaunchDate", toDateInput(editingProject?.expectedLaunchDate))} />
              <DisplayField label="当前阶段" value={editingProject ? projectStageLabel(editingProject.stage) : "已立项"} />
              <PeopleSelect name="ownerId" label="项目负责人" people={productManagers} required defaultValue={draftValue(draft, "ownerId", defaultProjectOwnerId)} />
              <RichTextEditor name="background" label="项目背景" defaultValue={draftValue(draft, "background", editingProject?.background)} />
              <RichTextEditor name="goal" label="项目目标" defaultValue={draftValue(draft, "goal", editingProject?.goal)} />
              <RichTextEditor name="relatedSystems" label="涉及系统" defaultValue={draftValue(draft, "relatedSystems", editingProject?.relatedSystems)} />
            </>
          ) : null}
          {activeDrawerKind === "requirement" ? (
            <>
              {context.revisionMode && selectedRequirement ? (
                <ReadonlyField name="sourceRequirementTitle" label="原需求" value={selectedRequirement.title} displayValue={`${selectedRequirement.title}（${selectedRequirement.code}）`} />
              ) : null}
              {contextProject ? (
                <ReadonlyField name="projectId" label="所属项目" value={contextProject.id} displayValue={`${contextProject.name}（${contextProject.code}）`} />
              ) : (
                <ProjectSelect projects={selectableProjects} defaultValue={draftValue(draft, "projectId")} />
              )}
              {context.revisionMode ? (
                <Select name="launchStatus" label="上线状态" options={requirementLaunchStatusOptions} defaultValue={draftValue(draft, "launchStatus", "TO_RELEASE")} />
              ) : null}
              <Field name="title" label="需求标题" required defaultValue={draftValue(draft, "title")} />
              <Select name="type" label="需求类型" options={requirementTypeOptions} defaultValue={draftValue(draft, "type")} />
              <Select name="priorityLevel" label="需求性质" defaultValue={draftValue(draft, "priorityLevel")} options={(requirementPriorities.length ? requirementPriorities.filter((item) => item.isActive !== false).map((item) => [item.code, item.name] as [string, string]) : [["P0", "P0"], ["P1", "P1"], ["P2", "P2"], ["P3", "P3"], ["P4", "P4"]])} />
              <Textarea name="description" label="需求描述" required defaultValue={draftValue(draft, "description")} />
              <Textarea name="acceptanceCriteria" label="验收标准" required defaultValue={draftValue(draft, "acceptanceCriteria")} />
            </>
          ) : null}
          {activeDrawerKind === "task" ? (
            <>
              {selectedRequirement ? (
                <>
                  {contextProject ? <ReadonlyField name="projectId" label="所属项目" value={contextProject.id} displayValue={`${contextProject.name}（${contextProject.code}）`} /> : null}
                  <ReadonlyField name="requirementId" label="关联需求" value={selectedRequirement.id} displayValue={`${selectedRequirement.title}（${selectedRequirement.code}）`} />
                  <RequirementPrioritySummary requirement={selectedRequirement} />
                </>
              ) : (
                <Select name="requirementId" label="关联需求" options={selectableTaskRequirements.map((item) => [String(item.id), item.title])} defaultValue={draftValue(draft, "requirementId")} />
              )}
              <Field name="title" label="任务标题" required defaultValue={draftValue(draft, "title")} />
              <Select name="assigneeId" label="负责人" options={people.map((person) => [String(person.id), person.name])} value={taskAssigneeId} onChange={setTaskAssigneeId} />
              <ReadonlyField name="type" label="任务类型（由负责人岗位带出）" value={taskTypeCode} displayValue={taskTypeName} />
              <AssigneeWorkloadPanel assigneeName={selectedTaskAssignee?.name} assigneeTasks={assigneeTasks} assigneeDefects={assigneeDefects} />
              <Field name="plannedStartDate" label="计划开始时间" type="date" defaultValue={draftValue(draft, "plannedStartDate", todayDateInput())} />
              <Field name="plannedFinishDate" label="计划完成时间" type="date" defaultValue={draftValue(draft, "plannedFinishDate")} />
            </>
          ) : null}
          {activeDrawerKind === "defect" ? (
            <>
              {contextProject ? (
                <ReadonlyField name="projectId" label="所属项目" value={contextProject.id} displayValue={`${contextProject.name}（${contextProject.code}）`} />
              ) : null}
              {selectedTask ? (
                <>
                  <ReadonlyField name="taskId" label="关联任务" value={selectedTask.id} displayValue={`${selectedTask.title}（${selectedTask.code}）`} />
                  {selectedRequirement ? <ReadonlyField name="requirementTitle" label="对应需求" value={selectedRequirement.title} displayValue={`${selectedRequirement.title}（${selectedRequirement.code}）`} /> : null}
                </>
              ) : (
                <Select name="taskId" label="关联任务" required defaultValue={draftValue(draft, "taskId")} options={selectableDefectTasks.map((item) => [String(item.id), `${item.title} / ${item.requirement?.title || "-"}`])} />
              )}
              <Field name="title" label="缺陷标题" required defaultValue={draftValue(draft, "title")} />
              <Select name="level" label="缺陷等级" defaultValue={draftValue(draft, "level")} options={(defectPriorities.length ? defectPriorities.filter((item) => item.isActive !== false).map((item) => [item.code, item.name] as [string, string]) : [["L1", "1级 致命"], ["L2", "2级 严重"], ["L3", "3级 一般"], ["L4", "4级 轻微"]])} />
              <Select name="environment" label="发现环境" defaultValue={draftValue(draft, "environment")} options={[["ONLINE", "线上生产"], ["GRAY", "灰度"], ["TEST", "测试"], ["DEV", "开发"]]} />
              <PeopleSelect name="assigneeId" label="负责人" people={people} defaultValue={draftValue(draft, "assigneeId")} />
              <Textarea name="description" label="缺陷描述" required defaultValue={draftValue(draft, "description")} />
            </>
          ) : null}
          {activeDrawerKind === "version" ? (
            <>
              <Select name="projectId" label="所属项目" options={selectableProjects.map((project) => [String(project.id), project.name])} value={versionProjectId} onChange={setVersionProjectId} />
              <Field name="name" label="版本名称" required defaultValue={draftValue(draft, "name")} />
              <Select name="type" label="版本类型" options={versionTypeOptions} defaultValue={draftValue(draft, "type")} />
              <Field name="plannedReleaseAt" label="计划上线时间" type="date" defaultValue={draftValue(draft, "plannedReleaseAt")} />
              <MultiSelect name="requirementIds" label="上线需求" options={selectableVersionRequirements.map((item) => [String(item.id), item.title])} defaultValue={draftArray(draft, "requirementIds")} />
              <MultiSelect name="defectIds" label="修复缺陷" options={selectableVersionDefects.map((item) => [String(item.id), item.title])} defaultValue={draftArray(draft, "defectIds")} />
            </>
          ) : null}
          {activeDrawerKind === "document" ? (
            <>
              <ProjectSelect projects={projects} defaultValue={draftValue(draft, "projectId")} />
              <Field name="name" label="资料名称" required defaultValue={draftValue(draft, "name")} />
              <Select name="type" label="资料类型" options={documentTypeOptions} defaultValue={draftValue(draft, "type")} />
              <Field name="linkUrl" label="资料链接" defaultValue={draftValue(draft, "linkUrl")} />
              <Field name="attachmentUrl" label="上传附件地址" defaultValue={draftValue(draft, "attachmentUrl")} />
              <Textarea name="description" label="说明" defaultValue={draftValue(draft, "description")} />
            </>
          ) : null}
          {activeDrawerKind === "person" ? (
            <>
              <Field name="name" label="姓名" required defaultValue={draftValue(draft, "name")} />
              <Field name="employeeNo" label="员工编号（工号，非登录账号）" defaultValue={draftValue(draft, "employeeNo")} />
              <Field name="email" label="邮箱" defaultValue={draftValue(draft, "email")} />
              <Select name="primaryPositionCode" label="岗位" options={positions.map((item) => [item.code, item.name])} defaultValue={draftValue(draft, "primaryPositionCode")} />
            </>
          ) : null}
          {draftMessage || draftRestored ? <p className="draft-hint">{draftMessage || "已恢复上次暂存草稿，提交成功后会自动清除。"}</p> : null}
          <div className="form-actions">
            {draftRestored ? (
              <button type="button" className="ghost" onClick={discardDraft}>
                <Trash2 size={18} /> 清除草稿
              </button>
            ) : null}
            <button type="button" onClick={saveDraft}>
              <Save size={18} /> 暂存草稿
            </button>
            <button className="primary" type="submit">
              <CheckCircle2 size={18} /> 提交
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
