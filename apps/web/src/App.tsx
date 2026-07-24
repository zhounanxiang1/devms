import {
  Archive,
  CalendarDays,
  CheckCircle2,
  LayoutDashboard,
  MoreHorizontal,
  PackageCheck,
  Pencil,
  Plus,
  Rocket,
  Save,
  Settings,
  Trash2,
  Users
} from "lucide-react";
import { Avatar, Button as AntButton, Card, Collapse as AntCollapse, Descriptions, Dropdown as AntDropdown, Empty as AntEmpty, Input as AntInput, InputNumber as AntInputNumber, Menu as AntMenu, Modal as AntModal, Select as AntSelect, Space, Tabs as AntTabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Children, FormEvent, isValidElement, MouseEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { api, clearToken, getToken, patch, post, setToken } from "./api";
import { AssigneeScheduleDialog, ScheduleChange } from "./components/AssigneeScheduleDialog";
import { Badge, EmptyState, ListSection, Metric } from "./components/common";
import { DisplayField, Field, FileField, PeopleSelect, ProjectSelect, ReadonlyField, Select, Textarea } from "./components/formControls";
import { ProjectLifecycleAction, ProjectLifecycleDialog } from "./components/ProjectLifecycleDialog";
import { ResizableTable as AntTable } from "./components/ResizableTable";
import { RichTextDisplay, RichTextEditor } from "./components/RichText";
import { ScheduleDialog, ScheduleEditState } from "./components/ScheduleDialog";
import { DateRangeValue, matchSearchOption, TableSearchControl, TableSearchOption } from "./components/TableSearchControl";
import { clearFormDraft, draftArray, draftValue, FORM_DRAFT_PREFIX, hasDraftValues, readFormDraft, writeFormDraft } from "./lib/formDraft";
import { dictionaryOptions, dictionaryTypeLabel, dictionaryTypeUsage, fmtDate, isDue, isProductManagerPerson, label, projectStageLabel, toDateInput, todayDateInput } from "./lib/format";
import { dictionaryTypeMeta } from "./lib/labels";
import { stripRichText } from "./lib/richText";
import { Account, AdminData, AuthState, Defect, DevTask, Organization, Person, Position, Project, ReleaseVersion, Requirement } from "./types";

type View = "workbench" | "projects" | "admin";
type DrawerKind = "project" | "requirement" | "task" | "defect" | "version" | "document" | "person" | null;
type DrawerContext = { projectId?: number; requirementId?: number; taskId?: number; editProjectId?: number; revisionMode?: "CHANGE" | "OPTIMIZATION" };
type AdminEditKind = "personAccount" | "organization" | "position" | "dictionary" | "requirementPriority" | "defectPriority";
type AdminEditState = { kind: AdminEditKind; item?: any } | null;
type RefreshTarget = "all" | "workbench" | "project" | "execution" | "release" | "admin";
type TaskCompleteState = { task: DevTask; refreshTarget: RefreshTarget } | null;

const QUALITY_POSITIONS = ["PRODUCT_MANAGER", "TEST"];
const TASK_CREATOR_POSITIONS = ["PRODUCT_MANAGER", "UI", "FRONTEND", "BACKEND", "DATA", "OPS"];
const TERMINAL_VERSION_STATUSES = ["RELEASED", "ROLLED_BACK", "CANCELED"];
const TASK_OWNER_EDITABLE_STATUSES = ["TODO", "DOING"];
const DEFECT_OWNER_EDITABLE_STATUSES = ["TO_FIX", "FIXING"];

function hasAnyPositionCode(positions: string[] = [], allowed: string[]) {
  return allowed.some((code) => positions.includes(code));
}

function hasAssignedPerson(item: { assigneeId?: number | null; assignee?: Person }) {
  return Boolean(item.assigneeId ?? item.assignee?.id);
}

function isAssignedToPerson(item: { assigneeId?: number | null; assignee?: Person }, personId?: number | null) {
  const assigneeId = item.assigneeId ?? item.assignee?.id;
  return Boolean(personId && assigneeId && assigneeId === personId);
}

function hasAssignedTester(item: { testerId?: number | null; tester?: Person }) {
  return Boolean(item.testerId ?? item.tester?.id);
}

function canPublishVersionAction(version: ReleaseVersion) {
  return !TERMINAL_VERSION_STATUSES.includes(version.status);
}

type ProjectRichInfo = Pick<Project, "id" | "scope" | "background" | "goal" | "relatedSystems">;

const PROJECT_RICH_FIELDS = [
  { key: "scope", label: "需求范围", emptyText: "暂未填写需求范围" },
  { key: "background", label: "项目背景", emptyText: "暂未填写项目背景" },
  { key: "goal", label: "项目目标", emptyText: "暂未填写项目目标" },
  { key: "relatedSystems", label: "涉及系统", emptyText: "暂未填写涉及系统" }
] as const;

function projectRichValue(project: ProjectRichInfo, key: (typeof PROJECT_RICH_FIELDS)[number]["key"]) {
  return project[key] || "";
}

function hasProjectRichValue(project: ProjectRichInfo, key: (typeof PROJECT_RICH_FIELDS)[number]["key"]) {
  return Boolean(stripRichText(projectRichValue(project, key)).trim());
}

function ProjectRichContent({ value, emptyText }: { value?: string | null; emptyText: string }) {
  if (!stripRichText(value || "").trim()) {
    return (
      <AntEmpty
        className="project-rich-empty-state"
        image={AntEmpty.PRESENTED_IMAGE_SIMPLE}
        description={emptyText}
      />
    );
  }
  return (
    <div className="project-rich-content">
      <RichTextDisplay value={value} />
    </div>
  );
}

function ProjectRichCollapse({ project }: { project: ProjectRichInfo }) {
  const filledKeys = PROJECT_RICH_FIELDS
    .filter((field) => hasProjectRichValue(project, field.key))
    .map((field) => field.key);
  const defaultActiveKey = filledKeys.length ? filledKeys : ["scope"];

  return (
    <AntCollapse
      key={project.id}
      className="ant-project-rich-grid project-rich-collapse"
      bordered={false}
      defaultActiveKey={defaultActiveKey}
      items={PROJECT_RICH_FIELDS.map((field) => {
        const filled = hasProjectRichValue(project, field.key);
        return {
          key: field.key,
          label: field.label,
          extra: <Tag color={filled ? "blue" : "default"}>{filled ? "已填写" : "未填写"}</Tag>,
          children: <ProjectRichContent value={projectRichValue(project, field.key)} emptyText={field.emptyText} />
        };
      })}
    />
  );
}

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
  const [acceptanceTarget, setAcceptanceTarget] = useState<Requirement | null>(null);
  const [scheduleEdit, setScheduleEdit] = useState<ScheduleEditState | null>(null);
  const [projectLifecycle, setProjectLifecycle] = useState<{ project: Project; action: ProjectLifecycleAction } | null>(null);
  const [defectDetail, setDefectDetail] = useState<Defect | null>(null);
  const [requirementDetail, setRequirementDetail] = useState<Requirement | null>(null);
  const [taskDetail, setTaskDetail] = useState<DevTask | null>(null);
  const [taskComplete, setTaskComplete] = useState<TaskCompleteState>(null);
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);

  const userPositions = auth?.user.positions || [];
  const isProductManager = userPositions.includes("PRODUCT_MANAGER");
  const canPublish = hasAnyPositionCode(userPositions, QUALITY_POSITIONS);
  const canTest = canPublish;
  const canCreateTaskByPosition = hasAnyPositionCode(userPositions, TASK_CREATOR_POSITIONS);
  const canCreateDefectByPosition = canPublish;
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
    async function load<T>(path: string) {
      try {
        return { ok: true as const, path, value: await api<T>(path) };
      } catch (error) {
        console.error(`加载 ${path} 失败`, error);
        return { ok: false as const, path, error };
      }
    }

    function showPartialLoadError(results: Array<{ ok: boolean; path: string }>) {
      const failed = results.filter((result) => !result.ok).map((result) => result.path);
      if (failed.length) {
        setError(`部分数据加载失败：${failed.join("、")}。请刷新页面或检查后端服务。`);
      }
    }

    if (target === "all") {
      const [wb, ps, reqs, ts, bugs, vers, people] = await Promise.all([
        load<any>("/workbench"),
        load<Project[]>("/projects"),
        load<Requirement[]>("/requirements"),
        load<DevTask[]>("/tasks"),
        load<Defect[]>("/defects"),
        load<ReleaseVersion[]>("/versions"),
        load<Person[]>("/admin/people")
      ]);
      if (wb.ok) setWorkbench(wb.value);
      if (ps.ok) setProjects(ps.value);
      if (reqs.ok) setRequirements(reqs.value);
      if (ts.ok) setTasks(ts.value);
      if (bugs.ok) setDefects(bugs.value);
      if (vers.ok) setVersions(vers.value);
      if (people.ok) setPeopleDirectory(people.value);
      showPartialLoadError([wb, ps, reqs, ts, bugs, vers, people]);
      const nextProjectId = currentProjectId || (ps.ok ? ps.value[0]?.id : projects[0]?.id) || null;
      if (!currentProjectId && nextProjectId) setSelectedProjectId(nextProjectId);
      await Promise.all([refreshAdminData(), refreshSelectedProjectDetail(nextProjectId)]);
      return;
    }
    if (target === "project") {
      const [ps, reqs, ts, bugs, wb] = await Promise.all([
        load<Project[]>("/projects"),
        load<Requirement[]>("/requirements"),
        load<DevTask[]>("/tasks"),
        load<Defect[]>("/defects"),
        load<any>("/workbench")
      ]);
      if (ps.ok) setProjects(ps.value);
      if (reqs.ok) setRequirements(reqs.value);
      if (ts.ok) setTasks(ts.value);
      if (bugs.ok) setDefects(bugs.value);
      if (wb.ok) setWorkbench(wb.value);
      showPartialLoadError([ps, reqs, ts, bugs, wb]);
      const nextProjectId = currentProjectId || (ps.ok ? ps.value[0]?.id : projects[0]?.id) || null;
      if (!currentProjectId && nextProjectId) setSelectedProjectId(nextProjectId);
      await refreshSelectedProjectDetail(nextProjectId);
      return;
    }
    if (target === "execution") {
      const [wb, ts, bugs] = await Promise.all([
        load<any>("/workbench"),
        load<DevTask[]>("/tasks"),
        load<Defect[]>("/defects")
      ]);
      if (wb.ok) setWorkbench(wb.value);
      if (ts.ok) setTasks(ts.value);
      if (bugs.ok) setDefects(bugs.value);
      showPartialLoadError([wb, ts, bugs]);
      await refreshSelectedProjectDetail();
      return;
    }
    if (target === "release") {
      const [vers, reqs, bugs] = await Promise.all([
        load<ReleaseVersion[]>("/versions"),
        load<Requirement[]>("/requirements"),
        load<Defect[]>("/defects")
      ]);
      if (vers.ok) setVersions(vers.value);
      if (reqs.ok) setRequirements(reqs.value);
      if (bugs.ok) setDefects(bugs.value);
      showPartialLoadError([vers, reqs, bugs]);
      await refreshSelectedProjectDetail();
      return;
    }
    if (target === "admin") {
      await refreshAdminData();
      return;
    }
    if (target === "workbench") {
      const wb = await load<any>("/workbench");
      if (wb.ok) setWorkbench(wb.value);
      showPartialLoadError([wb]);
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

  async function createProjectAndEnter(body: any) {
    setBusy(true);
    setError("");
    try {
      const created = await post<Project>("/projects", body);
      const [ps, reqs, ts, bugs, wb] = await Promise.all([
        api<Project[]>("/projects"),
        api<Requirement[]>("/requirements"),
        api<DevTask[]>("/tasks"),
        api<Defect[]>("/defects"),
        api<any>("/workbench")
      ]);
      const nextProjectId = created?.id || ps[0]?.id || null;
      const detail = nextProjectId ? await api<any>(`/projects/${nextProjectId}`).catch(() => null) : null;
      setProjects(ps);
      setRequirements(reqs);
      setTasks(ts);
      setDefects(bugs);
      setWorkbench(wb);
      setSelectedProjectId(nextProjectId);
      setProjectDetail(detail);
      setView("projects");
      closeDrawer();
      return true;
    } catch (err: any) {
      setError(err.message || "创建项目失败");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openTaskFromWorkbench(task: DevTask) {
    const projectId = task.project?.id || task.requirement?.projectId;
    if (projectId) setSelectedProjectId(projectId);
    setView("projects");
    setTaskDetail(task);
  }

  function openDefectFromWorkbench(defect: Defect) {
    const projectId = defect.project?.id || defect.task?.project?.id || defect.task?.requirement?.projectId;
    if (projectId) setSelectedProjectId(projectId);
    setView("projects");
    setDefectDetail(defect);
  }

  async function saveScheduleChanges(changes: ScheduleChange[]) {
    setBusy(true);
    setError("");
    try {
      const currentPersonId = auth?.user.personId;
      const hasForeignSchedule = changes.some((change) => {
        const item = change.kind === "task" ? tasks.find((task) => task.id === change.id) : defects.find((defect) => defect.id === change.id);
        return !item || !isAssignedToPerson(item, currentPersonId);
      });
      if (hasForeignSchedule) {
        setError("只能调整自己的排期");
        return false;
      }
      const hasInvalidScheduleStatus = changes.some((change) => {
        const item = change.kind === "task" ? tasks.find((task) => task.id === change.id) : defects.find((defect) => defect.id === change.id);
        if (!item) return true;
        return change.kind === "task" ? !TASK_OWNER_EDITABLE_STATUSES.includes(item.status) : !DEFECT_OWNER_EDITABLE_STATUSES.includes(item.status);
      });
      if (hasInvalidScheduleStatus) {
        setError("只有待处理/处理中的开发任务、待修复/修复中的缺陷可以调整排期");
        return false;
      }
      await Promise.all(
        changes.map((change) =>
          patch(change.kind === "task" ? `/tasks/${change.id}` : `/defects/${change.id}`, {
            plannedStartDate: change.plannedStartDate,
            plannedFinishDate: change.plannedFinishDate,
            ...(change.kind === "defect" ? { plannedFixDate: change.plannedFinishDate } : {})
          })
        )
      );
      await refreshData("project");
      return true;
    } catch (err: any) {
      setError(err.message || "保存排期失败");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const nav = [
    ["workbench", "工作台", LayoutDashboard],
    ["projects", "项目管理", Archive],
    ...(isProductManager ? ([["admin", "后台管理", Settings]] as const) : [])
  ] as const;
  const userDisplayName = auth?.person?.name || auth?.user.username || "";
  const userRoleText = auth?.user.positions.map(label).join(" / ") || "";
  const accountMenuItems = [
    { key: "profile", label: "个人中心" },
    { key: "workbench", label: "我的工作台" },
    ...(isProductManager ? [{ key: "admin", label: "后台管理" }] : []),
    { type: "divider" as const },
    { key: "logout", label: "退出登录", danger: true }
  ];

  function logout() {
    clearToken();
    setAuth(null);
  }
  const currentNavTitle = nav.find(([id]) => id === view)?.[1] || "工作台";
  const currentModuleHint = (() => {
    if (view === "workbench") return "个人事项、待办和排期处理";
    if (view === "projects") return "项目概览、需求、缺陷、版本和资料";
    return "组织、人员和规则配置";
  })();

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
        <div className="sidebar-brand">
          <div>
            <strong>Demand OS</strong>
            <span>内部需求开发管理</span>
          </div>
        </div>
        <div className="module-context-card">
          <span>当前模块</span>
          <strong>{currentNavTitle}</strong>
          <em>{currentModuleHint}</em>
        </div>
        <div className="sidebar-section-label">功能导航</div>
        <AntMenu
          className="sidebar-menu"
          mode="inline"
          selectedKeys={[view]}
          onClick={({ key }) => setView(key as View)}
          items={nav.map(([id, text, Icon]) => ({
            key: id,
            icon: <Icon size={18} />,
            label: text
          }))}
        />
        <div className="sidebar-footer">
          <AntDropdown
            trigger={["click"]}
            placement="topLeft"
            menu={{
              items: accountMenuItems,
              onClick: ({ key }) => {
                if (key === "profile") setAccountCenterOpen(true);
                if (key === "workbench") setView("workbench");
                if (key === "admin") setView("admin");
                if (key === "logout") logout();
              }
          }}
        >
          <button className="sidebar-account-trigger" type="button">
            <Avatar className="sidebar-avatar">{userDisplayName.slice(0, 1).toUpperCase()}</Avatar>
              <span>
                <strong>{userDisplayName}</strong>
                <em>{userRoleText}</em>
              </span>
              <MoreHorizontal className="account-more-icon" size={17} />
            </button>
          </AntDropdown>
        </div>
      </aside>

      <main className="main">
        {error ? <pre className="error">{error}</pre> : null}

        {view === "workbench" ? (
          <Workbench
            data={workbench}
            positions={auth.user.positions}
            canCreateRequirement={isProductManager && projects.some((project) => project.stage !== "CLOSED")}
            requirementActionTitle={projects.length ? "没有可继续维护的项目，请先重新打开项目" : "请先新建项目"}
            onNewRequirement={() => openDrawer("requirement")}
            onEditTask={(task) => setScheduleEdit({ type: "task", item: task })}
            onEditDefect={(defect) => setScheduleEdit({ type: "defect", item: defect })}
            onNewDefect={(task) => openDrawer("defect", { projectId: task.project?.id || task.requirement?.projectId, requirementId: task.requirement?.id, taskId: task.id })}
            onViewTask={openTaskFromWorkbench}
            onViewDefect={openDefectFromWorkbench}
            onStartTask={(task) => handleAction(() => post(`/tasks/${task.id}/start`, {}), "execution")}
            onCompleteTask={(task) => setTaskComplete({ task, refreshTarget: "execution" })}
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
            currentPersonId={auth.user.personId}
            canCreateDefect={canCreateDefectByPosition}
            onSaveScheduleChanges={saveScheduleChanges}
          />
        ) : null}

        {view === "projects" ? (
          <ProjectManagement
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelect={setSelectedProjectId}
            detail={projectDetail}
            onNew={openDrawer}
            onEditTask={(task) => setScheduleEdit({ type: "task", item: task })}
            onViewTask={setTaskDetail}
            onStartTask={(task) => handleAction(() => post(`/tasks/${task.id}/start`, {}), "project")}
            onCompleteTask={(task) => setTaskComplete({ task, refreshTarget: "project" })}
            onStartTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-start`, {}), "project")}
            onPassTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-pass`, { note: "项目中心测试通过" }), "project")}
            onCloseTask={(task) => handleAction(() => post(`/tasks/${task.id}/close`, { note: "项目中心手动关闭" }), "project")}
            onStartDefectFix={(defect) => handleAction(() => post(`/defects/${defect.id}/start-fix`, {}), "project")}
            onViewDefect={setDefectDetail}
            onCompleteDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/fix-complete`, { fixNote: "项目中心完成修复" }), "project")}
            onVerifyDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/verify`, { verifyNote: "验证通过" }), "project")}
            onRejectDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reject`, { reason: "验证未通过" }), "project")}
            onCloseDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/close`, { reason: "手动关闭" }), "project")}
            onReopenDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reopen`, { reason: "重新开启" }), "project")}
            onReviewRequirement={setReviewTarget}
            onAcceptRequirement={setAcceptanceTarget}
            onViewRequirement={setRequirementDetail}
            onProjectLifecycle={(project, action) => setProjectLifecycle({ project, action })}
            canTest={canTest}
            isProductManager={isProductManager}
            currentPersonId={auth.user.personId}
            versions={versions}
            canPublish={canPublish}
            canCreateTask={canCreateTaskByPosition}
            canCreateDefect={canCreateDefectByPosition}
            onPublish={(version) => handleAction(() => post(`/versions/${version.id}/publish`, { releaseConclusion: "成功" }), "release")}
          />
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

      <RequirementAcceptanceDialog
        requirement={acceptanceTarget}
        tasks={tasks}
        onClose={() => setAcceptanceTarget(null)}
        onSubmit={async (requirement, body) => {
          const success = await handleAction(() => post(`/requirements/${requirement.id}/acceptance`, body), "project");
          if (success) setAcceptanceTarget(null);
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

      <DefectDetailDialog defect={defectDetail} onClose={() => setDefectDetail(null)} />
      <RequirementDetailDialog requirement={requirementDetail} tasks={tasks} defects={defects} onClose={() => setRequirementDetail(null)} />
      <TaskDetailDialog task={taskDetail} onClose={() => setTaskDetail(null)} />
      <TaskCompleteDialog
        state={taskComplete}
        documentTypeOptions={dictionaryOptions(admin?.dictionaries || [], "DOCUMENT_TYPE", [["BUSINESS", "业务资料"], ["TECH", "技术资料"], ["TEST", "测试资料"], ["RELEASE", "上线资料"]])}
        onClose={() => setTaskComplete(null)}
        onSubmit={async (task, body, refreshTarget) => {
          const success = await handleAction(() => post(`/tasks/${task.id}/complete`, body), refreshTarget);
          if (success) setTaskComplete(null);
          return success;
        }}
      />
      <AccountCenterDialog
        open={accountCenterOpen}
        auth={auth}
        onClose={() => setAccountCenterOpen(false)}
        onGoWorkbench={() => {
          setView("workbench");
          setAccountCenterOpen(false);
        }}
        onLogout={logout}
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
        onSaveScheduleChanges={saveScheduleChanges}
        onSubmit={(kind, body) => {
          if (kind === "project" && drawerContext.editProjectId) {
            return handleAction(() => patch(`/projects/${drawerContext.editProjectId}`, body), "project");
          }
          if (kind === "project") {
            return createProjectAndEnter(body);
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

function AccountCenterDialog({
  open,
  auth,
  onClose,
  onGoWorkbench,
  onLogout
}: {
  open: boolean;
  auth: AuthState | null;
  onClose: () => void;
  onGoWorkbench: () => void;
  onLogout: () => void;
}) {
  if (!auth) return null;
  const person = auth.person;
  const roles = auth.user.positions.map(label);
  return (
    <AntModal
      title="个人中心"
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <AntButton onClick={onGoWorkbench}>我的工作台</AntButton>
          <AntButton onClick={onClose}>关闭</AntButton>
          <AntButton type="text" danger onClick={onLogout}>退出登录</AntButton>
        </Space>
      }
    >
      <div className="account-center">
        <div className="account-center-head">
          <Avatar size={48} className="sidebar-avatar">{(person?.name || auth.user.username).slice(0, 1).toUpperCase()}</Avatar>
          <div>
            <h3>{person?.name || auth.user.username}</h3>
            <Space size={6} wrap>
              {roles.map((role) => <Tag key={role}>{role}</Tag>)}
            </Space>
          </div>
        </div>
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="登录账号">{auth.user.username}</Descriptions.Item>
          <Descriptions.Item label="员工编号">{person?.employeeNo || "-"}</Descriptions.Item>
          <Descriptions.Item label="所属组织">{person?.organization?.name || "-"}</Descriptions.Item>
          <Descriptions.Item label="主岗位">{personPrimaryPositionName(person) || "-"}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{person?.email || "-"}</Descriptions.Item>
          <Descriptions.Item label="手机号">{person?.phone || "-"}</Descriptions.Item>
        </Descriptions>
      </div>
    </AntModal>
  );
}

function tablePagination(total: number) {
  return {
    pageSize: 10,
    showSizeChanger: true,
    pageSizeOptions: ["10", "20", "50"],
    showTotal: (count: number) => `共 ${count} 条`
  };
}

function TableActions({ children, visibleCount = 3 }: { children: ReactNode; visibleCount?: number }) {
  const actions = Children.toArray(children).filter(Boolean);
  if (!actions.length) return null;
  const actionDisabled = (action: ReactNode) => isValidElement<{ disabled?: boolean }>(action) ? Boolean(action.props.disabled) : false;
  const orderedActions = [...actions.filter((action) => !actionDisabled(action)), ...actions.filter(actionDisabled)];
  const visibleActions = orderedActions.slice(0, visibleCount);
  const overflowActions = orderedActions.slice(visibleCount);
  return (
    <Space size={6} wrap className="table-actions">
      {visibleActions}
      {overflowActions.length ? (
        <AntDropdown
          trigger={["click"]}
          menu={{
            items: overflowActions.map((action, index) => ({
              key: String(index),
              disabled: actionDisabled(action),
              label: <div className="table-actions-menu-item">{action}</div>
            }))
          }}
        >
          <AntButton size="small" icon={<MoreHorizontal size={16} />} title="更多操作" />
        </AntDropdown>
      ) : null}
    </Space>
  );
}

function textOf(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).toLowerCase();
}

function fmtDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

type FilterOption = { value: string; label: string };

const REQUIREMENT_STATUS_OPTIONS = ["TO_REVIEW", "APPROVED", "REJECTED", "NEEDS_SUPPLEMENT", "DEFERRED", "DEVELOPING", "COMPLETED", "CANCELED", "CHANGE", "OPTIMIZATION"].map((value) => ({ value, label: label(value) }));
const REQUIREMENT_LAUNCH_STATUS_OPTIONS = ["TO_RELEASE", "RELEASED"].map((value) => ({ value, label: label(value) }));
const REQUIREMENT_TYPE_OPTIONS = [
  { value: "FEATURE", label: "功能需求" },
  { value: "PROCESS", label: "流程需求" },
  { value: "DATA", label: "数据需求" },
  { value: "REPORT", label: "报表需求" },
  { value: "UX", label: "体验优化" },
  { value: "NON_FUNCTIONAL", label: "非功能需求" }
];
const REQUIREMENT_PRIORITY_OPTIONS = ["P0", "P1", "P2", "P3", "P4"].map((value) => ({ value, label: value }));
const TASK_STATUS_OPTIONS = ["TODO", "DOING", "TO_TEST", "TESTING", "TEST_PASSED", "CLOSED"].map((value) => ({ value, label: label(value) }));
const TASK_TYPE_OPTIONS = ["PRODUCT_MANAGER", "UI", "FRONTEND", "BACKEND", "DATA", "TEST", "OPS", "BUSINESS"].map((value) => ({ value, label: label(value) }));
const DEFECT_STATUS_OPTIONS = ["TO_FIX", "FIXING", "FIXED", "VERIFIED", "CLOSED"].map((value) => ({ value, label: label(value) }));
const DEFECT_LEVEL_OPTIONS = [
  { value: "L1", label: "阻塞" },
  { value: "L2", label: "严重" },
  { value: "L3", label: "一般" },
  { value: "L4", label: "次要" }
];
const DEFECT_ENVIRONMENT_OPTIONS = [
  { value: "ONLINE", label: "线上" },
  { value: "OFFLINE", label: "线下" }
];
const VERSION_STATUS_OPTIONS = ["PLANNING", "DEVELOPING", "TESTING", "READY_TO_RELEASE", "RELEASED", "ROLLED_BACK", "CANCELED"].map((value) => ({ value, label: label(value) }));
const VERSION_TYPE_OPTIONS = [
  { value: "NORMAL", label: "常规版本" },
  { value: "HOTFIX", label: "紧急修复" },
  { value: "GRAY", label: "灰度版本" }
];
const DOCUMENT_TYPE_OPTIONS = [
  { value: "BUSINESS", label: "业务资料" },
  { value: "TECH", label: "技术资料" },
  { value: "TEST", label: "测试资料" },
  { value: "RELEASE", label: "上线资料" }
];
const EMPLOYMENT_STATUS_OPTIONS = ["ACTIVE", "LEFT", "DISABLED"].map((value) => ({ value, label: label(value) }));
const ACCOUNT_STATUS_OPTIONS = [
  ...["ACTIVE", "DISABLED", "LOCKED"].map((value) => ({ value, label: label(value) })),
  { value: "NO_ACCOUNT", label: "未开通" }
];
const ACTIVE_STATUS_OPTIONS = [
  { value: "true", label: "启用" },
  { value: "false", label: "停用" }
];
const ALLOW_LOGIN_OPTIONS = [
  { value: "true", label: "允许" },
  { value: "false", label: "禁止" },
  { value: "NO_ACCOUNT", label: "未开通" }
];
const ORGANIZATION_STATUS_OPTIONS = ["ACTIVE", "DISABLED"].map((value) => ({ value, label: label(value) }));

function matchKeyword<T>(item: T, keyword: string, fields: string[], readers: Record<string, (item: T) => unknown>) {
  const query = keyword.trim().toLowerCase();
  if (!query) return true;
  const activeFields = fields.length ? fields : Object.keys(readers);
  return activeFields.some((field) => textOf(readers[field]?.(item)).includes(query));
}

function inSelected<T>(selected: T[], value: T) {
  return !selected.length || selected.includes(value);
}

function countFilterOptions<T>(options: FilterOption[], items: T[], reader: (item: T) => unknown) {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const rawValue = reader(item);
    if (rawValue === undefined || rawValue === null || rawValue === "") return;
    const value = String(rawValue);
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return options.map((option) => ({ value: option.value, label: `${option.label} (${counts.get(option.value) || 0})` }));
}

function mergeOptions(baseOptions: FilterOption[], extraOptions: FilterOption[]) {
  const values = new Set(baseOptions.map((option) => option.value));
  return [...baseOptions, ...extraOptions.filter((option) => !values.has(option.value))];
}

function uniqueOptions<T>(items: T[], reader: (item: T) => unknown, labeler: (value: string) => string = (value) => label(value)) {
  const values = new Map<string, string>();
  items.forEach((item) => {
    const rawValue = reader(item);
    if (rawValue === undefined || rawValue === null || rawValue === "") return;
    const value = String(rawValue);
    values.set(value, labeler(value));
  });
  return Array.from(values.entries()).map(([value, label]) => ({ value, label }));
}

function compareText<T>(reader: (item: T) => unknown) {
  return (left: T, right: T) => String(reader(left) || "").localeCompare(String(reader(right) || ""), "zh-CN");
}

function compareNumber<T>(reader: (item: T) => unknown) {
  return (left: T, right: T) => Number(reader(left) || 0) - Number(reader(right) || 0);
}

function compareDate<T>(reader: (item: T) => unknown) {
  return (left: T, right: T) => {
    const leftTime = reader(left) ? new Date(String(reader(left))).getTime() : 0;
    const rightTime = reader(right) ? new Date(String(reader(right))).getTime() : 0;
    return leftTime - rightTime;
  };
}

function Workbench({
  data,
  positions,
  canCreateRequirement,
  requirementActionTitle,
  onNewRequirement,
  onEditTask,
  onEditDefect,
  onNewDefect,
  onViewTask,
  onViewDefect,
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
  isProductManager,
  currentPersonId,
  canCreateDefect,
  onSaveScheduleChanges
}: {
  data: any;
  positions: string[];
  canCreateRequirement: boolean;
  requirementActionTitle?: string;
  onNewRequirement: () => void;
  onEditTask: (task: DevTask) => void;
  onEditDefect: (defect: Defect) => void;
  onNewDefect: (task: DevTask) => void;
  onViewTask: (task: DevTask) => void;
  onViewDefect: (defect: Defect) => void;
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
  currentPersonId: number;
  canCreateDefect: boolean;
  onSaveScheduleChanges: (changes: ScheduleChange[]) => Promise<boolean>;
}) {
  const [activeTab, setActiveTab] = useState("owned");
  const [dueThreshold, setDueThreshold] = useState(3);
  const [dueFilter, setDueFilter] = useState("ALL");
  const emphasis = useMemo(() => {
    if (positions.includes("PRODUCT_MANAGER")) return "待评审需求、需求变更、测试确认和后台管理";
    if (positions.includes("TEST")) return "测试中需求、待验证缺陷和发布检查";
    if (positions.includes("UI")) return "设计任务和相关需求";
    if (positions.includes("OPS")) return "待发布版本和上线资料";
    return "开发任务、缺陷修复和排期调整";
  }, [positions]);

  const workbenchTasks = (data?.developmentTasks || []) as DevTask[];
  const workbenchDefects = (data?.defectTasks || []) as Defect[];
  const scheduleTasks = workbenchTasks.filter((task) => String(task.assigneeId || task.assignee?.id) === String(currentPersonId));
  const scheduleDefects = workbenchDefects.filter((defect) => String(defect.assigneeId || defect.assignee?.id) === String(currentPersonId));

  return (
    <section className="page-stack workbench-shell">
      <div className="module-page-head workbench-page-head">
        <div>
          <p className="page-kicker">我的工作</p>
          <h1>工作台</h1>
          <p>{emphasis}</p>
        </div>
        <Space size={8} wrap>
          {isProductManager ? (
            <AntButton type="primary" disabled={!canCreateRequirement} title={canCreateRequirement ? "新建需求" : requirementActionTitle} onClick={onNewRequirement}>
              <Plus size={16} /> 新建需求
            </AntButton>
          ) : null}
        </Space>
      </div>

      <AntTabs
        className="workbench-tabs"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: "owned", label: "我负责的事项" },
          { key: "schedule", label: "排期" }
        ]}
      />

      {activeTab === "schedule" ? (
        <AssigneeScheduleDialog
          embedded
          assigneeId={currentPersonId}
          currentPersonId={currentPersonId}
          assigneeName="我"
          tasks={scheduleTasks}
          defects={scheduleDefects}
          onClose={() => undefined}
          onSaveChanges={onSaveScheduleChanges}
        />
      ) : null}

      {activeTab === "owned" ? (
        <OwnedItemsTable
          tasks={workbenchTasks}
          defects={workbenchDefects}
          currentPersonId={currentPersonId}
          dueThreshold={dueThreshold}
          dueFilter={dueFilter}
          onDueThresholdChange={setDueThreshold}
          onDueFilterChange={setDueFilter}
          onViewTask={onViewTask}
          onEditTask={onEditTask}
          onViewDefect={onViewDefect}
          onEditDefect={onEditDefect}
          onNewDefect={onNewDefect}
          onStartTask={onStartTask}
          onCompleteTask={onCompleteTask}
          onStartTaskTest={onStartTaskTest}
          onPassTaskTest={onPassTaskTest}
          onCloseTask={onCloseTask}
          onStartDefectFix={onStartDefectFix}
          onCompleteDefect={onCompleteDefect}
          canVerify={canVerify}
          onVerifyDefect={onVerifyDefect}
          onRejectDefect={onRejectDefect}
          onCloseDefect={onCloseDefect}
          onReopenDefect={onReopenDefect}
          canCreateDefect={canCreateDefect}
        />
      ) : null}
    </section>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function scheduleAlertType(dateValue?: string | null, thresholdDays = 3) {
  if (!dateValue) return "normal";
  const date = new Date(String(dateValue));
  if (Number.isNaN(date.getTime())) return "normal";
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.ceil((targetStart - todayStart) / DAY_MS);
  if (days < 0) return "overdue";
  if (days <= thresholdDays) return "dueSoon";
  return "normal";
}

type OwnedWorkbenchItem = {
  key: string;
  itemType: "TASK" | "DEFECT";
  typeLabel: string;
  title: string;
  code: string;
  projectName: string;
  sourceName: string;
  ownerId?: number | null;
  ownerName: string;
  testerId?: number | null;
  testerName: string;
  creatorName: string;
  status: string;
  plannedStartDate?: string | null;
  plannedFinishDate?: string | null;
  priorityScore: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  raw: DevTask | Defect;
};

function isOwnedItemDone(item: OwnedWorkbenchItem) {
  return item.itemType === "TASK"
    ? ["TEST_PASSED", "CLOSED"].includes(item.status)
    : ["VERIFIED", "CLOSED"].includes(item.status);
}

function compareTimestampDesc(left?: string | null, right?: string | null) {
  const leftTime = left ? new Date(String(left)).getTime() : 0;
  const rightTime = right ? new Date(String(right)).getTime() : 0;
  return rightTime - leftTime;
}

function compareOwnedWorkbenchItems(left: OwnedWorkbenchItem, right: OwnedWorkbenchItem) {
  const leftDone = isOwnedItemDone(left);
  const rightDone = isOwnedItemDone(right);
  if (leftDone !== rightDone) return leftDone ? 1 : -1;
  if (!leftDone) {
    return (right.priorityScore || 0) - (left.priorityScore || 0) || compareDate<OwnedWorkbenchItem>((item) => item.plannedFinishDate)(left, right);
  }
  return compareTimestampDesc(left.completedAt || left.updatedAt, right.completedAt || right.updatedAt);
}

function ownedItemScheduleAlertType(item: OwnedWorkbenchItem, thresholdDays: number) {
  if (isOwnedItemDone(item)) return "normal";
  return scheduleAlertType(item.plannedFinishDate, thresholdDays);
}

function OwnedItemsTable({
  tasks,
  defects,
  currentPersonId,
  dueThreshold,
  dueFilter,
  onDueThresholdChange,
  onDueFilterChange,
  onViewTask,
  onEditTask,
  onViewDefect,
  onEditDefect,
  onNewDefect,
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
  canCreateDefect
}: {
  tasks: DevTask[];
  defects: Defect[];
  currentPersonId: number;
  dueThreshold: number;
  dueFilter: string;
  onDueThresholdChange: (value: number) => void;
  onDueFilterChange: (value: string) => void;
  onViewTask: (task: DevTask) => void;
  onEditTask: (task: DevTask) => void;
  onViewDefect: (defect: Defect) => void;
  onEditDefect: (defect: Defect) => void;
  onNewDefect: (task: DevTask) => void;
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
  canCreateDefect: boolean;
}) {
  const [searchField, setSearchField] = useState("title");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchDateRange, setSearchDateRange] = useState<DateRangeValue>(null);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  const items: OwnedWorkbenchItem[] = [
    ...tasks.map((task) => ({
      key: `task-${task.id}`,
      itemType: "TASK" as const,
      typeLabel: "开发任务",
      title: task.title,
      code: task.code,
      projectName: task.project?.name || "-",
      sourceName: task.requirement?.title || "-",
      ownerId: task.assigneeId || task.assignee?.id,
      ownerName: task.assignee?.name || "-",
      testerId: task.testerId || task.tester?.id,
      testerName: task.tester?.name || "-",
      creatorName: task.creator?.name || "-",
      status: task.status,
      plannedStartDate: task.plannedStartDate,
      plannedFinishDate: task.plannedFinishDate,
      priorityScore: task.priorityScore || 0,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: ["TEST_PASSED", "CLOSED"].includes(task.status) ? task.updatedAt || task.actualFinishDate : null,
      raw: task
    })),
    ...defects.map((defect) => ({
      key: `defect-${defect.id}`,
      itemType: "DEFECT" as const,
      typeLabel: "缺陷修复",
      title: defect.title,
      code: defect.code,
      projectName: defect.project?.name || defect.task?.project?.name || "-",
      sourceName: defect.task?.requirement?.title || defect.requirement?.title || defect.task?.title || "-",
      ownerId: defect.assigneeId || defect.assignee?.id,
      ownerName: defect.assignee?.name || "-",
      testerId: defect.testerId || defect.tester?.id,
      testerName: defect.tester?.name || "-",
      creatorName: defect.reporter?.name || "-",
      status: defect.status,
      plannedStartDate: defect.plannedStartDate || defect.plannedFixDate,
      plannedFinishDate: defect.plannedFinishDate || defect.plannedFixDate,
      priorityScore: defect.priorityScore || 0,
      createdAt: defect.createdAt,
      updatedAt: defect.updatedAt,
      completedAt: ["VERIFIED", "CLOSED"].includes(defect.status) ? defect.updatedAt || defect.actualFixDate : null,
      raw: defect
    }))
  ];
  const typeOptions = countFilterOptions(
    [{ value: "TASK", label: "开发任务" }, { value: "DEFECT", label: "缺陷修复" }],
    items,
    (item) => item.itemType
  );
  const statusCounts = items.reduce((counts, item) => {
    const key = `${item.itemType}:${item.status}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map<string, number>());
  const statusOptions = [
    {
      label: "开发任务状态",
      options: TASK_STATUS_OPTIONS.map((option) => ({
        value: `TASK:${option.value}`,
        label: `${option.label} (${statusCounts.get(`TASK:${option.value}`) || 0})`
      }))
    },
    {
      label: "缺陷状态",
      options: DEFECT_STATUS_OPTIONS.map((option) => ({
        value: `DEFECT:${option.value}`,
        label: `${option.label} (${statusCounts.get(`DEFECT:${option.value}`) || 0})`
      }))
    }
  ];
  const searchOptions: Array<TableSearchOption<(typeof items)[number]>> = [
    { value: "code", label: "编号", type: "text", reader: (item) => item.code },
    { value: "title", label: "名称", type: "text", reader: (item) => item.title },
    { value: "project", label: "项目", type: "text", reader: (item) => item.projectName },
    { value: "source", label: "关联需求/任务", type: "text", reader: (item) => item.sourceName },
    { value: "owner", label: "负责人", type: "text", reader: (item) => item.ownerName },
    { value: "tester", label: "测试负责人", type: "text", reader: (item) => item.testerName },
    { value: "creator", label: "创建人", type: "text", reader: (item) => item.creatorName },
    { value: "plannedStartDate", label: "计划开始", type: "date", reader: (item) => item.plannedStartDate },
    { value: "plannedFinishDate", label: "计划完成", type: "date", reader: (item) => item.plannedFinishDate },
    { value: "createdAt", label: "创建时间", type: "date", reader: (item) => item.createdAt }
  ];
  const dueCounts = items.reduce(
    (counts, item) => {
      const alertType = ownedItemScheduleAlertType(item, dueThreshold);
      if (alertType === "dueSoon") counts.dueSoon += 1;
      if (alertType === "overdue") counts.overdue += 1;
      return counts;
    },
    { dueSoon: 0, overdue: 0 }
  );
  const dueFilterOptions = [
    { value: "ALL", label: `全部时间状态 (${items.length})` },
    { value: "DUE_SOON", label: `只看临期 (${dueCounts.dueSoon})` },
    { value: "OVERDUE", label: `只看超期 (${dueCounts.overdue})` },
    { value: "DUE_OR_OVERDUE", label: `临期或超期 (${dueCounts.dueSoon + dueCounts.overdue})` }
  ];
  const filteredItems = items.filter((item) => {
    const alertType = ownedItemScheduleAlertType(item, dueThreshold);
    const dueMatched =
      dueFilter === "ALL" ||
      (dueFilter === "DUE_SOON" && alertType === "dueSoon") ||
      (dueFilter === "OVERDUE" && alertType === "overdue") ||
      (dueFilter === "DUE_OR_OVERDUE" && ["dueSoon", "overdue"].includes(alertType));
    return (
      matchSearchOption(item, searchField, searchKeyword, searchDateRange, searchOptions) &&
      inSelected(typeFilter, item.itemType) &&
      (!statusFilter.length || statusFilter.includes(`${item.itemType}:${item.status}`)) &&
      dueMatched
    );
  });
  const sortedItems = [...filteredItems].sort(compareOwnedWorkbenchItems);
  const canPassTask = (task: DevTask) => !task.defects?.some((defect) => !["VERIFIED", "CLOSED"].includes(defect.status));
  const isOwner = (item: OwnedWorkbenchItem) => String(item.ownerId || "") === String(currentPersonId);
  const hasTester = (item: OwnedWorkbenchItem) => Boolean(item.testerId);
  const canEditSchedule = (item: OwnedWorkbenchItem) =>
    item.itemType === "TASK" ? TASK_OWNER_EDITABLE_STATUSES.includes(item.status) : DEFECT_OWNER_EDITABLE_STATUSES.includes(item.status);
  const taskHasAssignee = (task: DevTask) => hasAssignedPerson(task);
  const canCreateDefectByTaskStatus = (task: DevTask) => taskHasAssignee(task) && ["TESTING", "TEST_PASSED"].includes(task.status);
  const defectButtonTitle = (task: DevTask) => {
    if (!taskHasAssignee(task)) return "任务负责人为空，不能创建缺陷";
    if (task.status === "TEST_PASSED") return "创建缺陷后，任务会退回测试中";
    return canCreateDefectByTaskStatus(task) ? "创建缺陷" : "只有测试中或测试通过的任务可以创建缺陷";
  };
  const columns = [
    {
      title: "事项",
      width: 260,
      sorter: compareText<(typeof items)[number]>((item) => item.title),
      render: (_: unknown, item: (typeof items)[number]) => (
        <Space direction="vertical" size={1}>
          <strong>{item.title}</strong>
          <span className="muted-line">{item.code} · {item.sourceName}</span>
        </Space>
      )
    },
    { title: "类型", width: 110, sorter: compareText<(typeof items)[number]>((item) => item.typeLabel), render: (_: unknown, item: (typeof items)[number]) => item.typeLabel },
    { title: "状态", width: 110, sorter: compareText<(typeof items)[number]>((item) => label(item.status)), render: (_: unknown, item: (typeof items)[number]) => <Tag color={item.itemType === "TASK" ? taskStatusColor(item.status) : defectStatusColor(item.status)}>{label(item.status)}</Tag> },
    { title: "项目", width: 180, sorter: compareText<(typeof items)[number]>((item) => item.projectName), render: (_: unknown, item: (typeof items)[number]) => item.projectName },
    { title: "负责人", width: 110, sorter: compareText<(typeof items)[number]>((item) => item.ownerName), render: (_: unknown, item: (typeof items)[number]) => item.ownerName },
    { title: "测试负责人", width: 120, sorter: compareText<(typeof items)[number]>((item) => item.testerName), render: (_: unknown, item: (typeof items)[number]) => item.testerName },
    { title: "创建人", width: 110, sorter: compareText<(typeof items)[number]>((item) => item.creatorName), render: (_: unknown, item: (typeof items)[number]) => item.creatorName },
    { title: "创建时间", width: 150, sorter: compareDate<(typeof items)[number]>((item) => item.createdAt), render: (_: unknown, item: (typeof items)[number]) => fmtDateTime(item.createdAt) },
    { title: "排期", width: 190, sorter: compareDate<(typeof items)[number]>((item) => item.plannedFinishDate), render: (_: unknown, item: (typeof items)[number]) => `${fmtDate(item.plannedStartDate || undefined)} - ${fmtDate(item.plannedFinishDate || undefined)}` },
    {
      title: "时间状态",
      width: 110,
      sorter: compareText<(typeof items)[number]>((item) => ownedItemScheduleAlertType(item, dueThreshold)),
      render: (_: unknown, item: (typeof items)[number]) => {
        const alertType = ownedItemScheduleAlertType(item, dueThreshold);
        if (alertType === "overdue") return <Tag color="red">超期</Tag>;
        if (alertType === "dueSoon") return <Tag color="orange">临期</Tag>;
        return <Tag>正常</Tag>;
      }
    },
    { title: "优先级分数", width: 120, dataIndex: "priorityScore", sorter: compareNumber<(typeof items)[number]>((item) => item.priorityScore) },
    {
      title: "操作",
      width: 210,
      fixed: "right" as const,
      render: (_: unknown, item: (typeof items)[number]) => {
        if (item.itemType === "TASK") {
          const task = item.raw as DevTask;
          const owner = isOwner(item);
          const testerReady = hasTester(item);
          const scheduleEnabled = canEditSchedule(item);
          return (
            <TableActions>
              <AntButton size="small" onClick={() => onViewTask(task)}>详情</AntButton>
              {owner ? <AntButton size="small" disabled={!scheduleEnabled} title={scheduleEnabled ? "调整排期" : "只有待处理或处理中的任务可以调整排期"} onClick={() => onEditTask(task)}>排期</AntButton> : null}
              {canCreateDefect ? (
                <AntButton size="small" disabled={!canCreateDefectByTaskStatus(task)} title={defectButtonTitle(task)} onClick={() => onNewDefect(task)}>缺陷</AntButton>
              ) : null}
              {owner ? <AntButton size="small" type="primary" disabled={task.status !== "TODO"} title={task.status === "TODO" ? "开始处理" : "只有待处理任务可以开始处理"} onClick={() => onStartTask(task)}>开始处理</AntButton> : null}
              {owner ? <AntButton size="small" type="primary" disabled={task.status !== "DOING"} title={task.status === "DOING" ? "处理完成" : "只有处理中的任务可以处理完成"} onClick={() => onCompleteTask(task)}>处理完成</AntButton> : null}
              {canVerify && testerReady ? <AntButton size="small" type="primary" disabled={task.status !== "TO_TEST"} title={task.status === "TO_TEST" ? "开始测试" : "只有待测试任务可以开始测试"} onClick={() => onStartTaskTest(task)}>开始测试</AntButton> : null}
              {canVerify && testerReady ? (
                <AntButton size="small" type="primary" disabled={task.status !== "TESTING" || !canPassTask(task)} title={task.status !== "TESTING" ? "只有测试中的任务可以测试通过" : canPassTask(task) ? "测试通过" : "任务下仍有未验证或未关闭的缺陷"} onClick={() => onPassTaskTest(task)}>
                  测试通过
                </AntButton>
              ) : null}
              {owner ? <AntButton size="small" disabled={!scheduleEnabled} title={scheduleEnabled ? "关闭任务" : "只有待处理或处理中的任务可以手动关闭"} onClick={() => onCloseTask(task)}>关闭</AntButton> : null}
            </TableActions>
          );
        }
        const defect = item.raw as Defect;
        const owner = isOwner(item);
        const testerReady = hasTester(item);
        const scheduleEnabled = canEditSchedule(item);
        return (
          <TableActions>
            <AntButton size="small" onClick={() => onViewDefect(defect)}>详情</AntButton>
            {owner ? <AntButton size="small" disabled={!scheduleEnabled} title={scheduleEnabled ? "调整排期" : "只有待修复或修复中的缺陷可以调整排期"} onClick={() => onEditDefect(defect)}>排期</AntButton> : null}
            {owner ? <AntButton size="small" type="primary" disabled={defect.status !== "TO_FIX"} title={defect.status === "TO_FIX" ? "开始修复" : "只有待修复缺陷可以开始修复"} onClick={() => onStartDefectFix(defect)}>开始修复</AntButton> : null}
            {owner ? <AntButton size="small" type="primary" disabled={defect.status !== "FIXING"} title={defect.status === "FIXING" ? "已修复" : "只有修复中的缺陷可以标记已修复"} onClick={() => onCompleteDefect(defect)}>已修复</AntButton> : null}
            {canVerify && testerReady ? <AntButton size="small" type="primary" disabled={defect.status !== "FIXED"} title={defect.status === "FIXED" ? "验证通过" : "只有已修复缺陷可以验证通过"} onClick={() => onVerifyDefect(defect)}>验证通过</AntButton> : null}
            {canVerify && testerReady ? <AntButton size="small" disabled={defect.status !== "FIXED"} title={defect.status === "FIXED" ? "验证未通过" : "只有已修复缺陷可以验证未通过"} onClick={() => onRejectDefect(defect)}>验证未通过</AntButton> : null}
            {canVerify && testerReady ? <AntButton size="small" disabled={!scheduleEnabled} title={scheduleEnabled ? "关闭缺陷" : "只有待修复或修复中的缺陷可以关闭"} onClick={() => onCloseDefect(defect)}>关闭</AntButton> : null}
            {canVerify && testerReady ? <AntButton size="small" disabled={defect.status !== "CLOSED"} title={defect.status === "CLOSED" ? "开启缺陷" : "只有已关闭缺陷可以开启"} onClick={() => onReopenDefect(defect)}>开启</AntButton> : null}
          </TableActions>
        );
      }
    }
  ];

  return (
    <Card className="enterprise-card" title="我负责的事项">
      <Space size={8} wrap style={{ marginBottom: 14 }}>
        <TableSearchControl
          options={searchOptions}
          field={searchField}
          keyword={searchKeyword}
          dateRange={searchDateRange}
          onFieldChange={setSearchField}
          onKeywordChange={setSearchKeyword}
          onDateRangeChange={setSearchDateRange}
        />
        <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 170 }} placeholder="事项类型" value={typeFilter} options={typeOptions} onChange={setTypeFilter} />
        <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 170 }} placeholder="事项状态" value={statusFilter} options={statusOptions} onChange={setStatusFilter} />
        <AntSelect
          style={{ minWidth: 160 }}
          value={dueFilter}
          options={dueFilterOptions}
          onChange={onDueFilterChange}
        />
        <AntInputNumber
          style={{ width: 160 }}
          min={0}
          value={dueThreshold}
          addonBefore="临期阈值"
          addonAfter="天"
          onChange={(value) => onDueThresholdChange(Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0)}
        />
      </Space>
      <AntTable
        className="enterprise-table"
        rowKey="key"
        columns={columns}
        dataSource={sortedItems}
        pagination={tablePagination(sortedItems.length)}
        scroll={{ x: 1770 }}
        rowClassName={(item) => {
          const alertType = ownedItemScheduleAlertType(item, dueThreshold);
          if (alertType === "overdue") return "workbench-overdue-row";
          if (alertType === "dueSoon") return "workbench-due-row";
          return "";
        }}
        locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无负责事项" /> }}
      />
    </Card>
  );
}

function ProjectManagement({
  projects,
  selectedProjectId,
  onSelect,
  detail,
  onNew,
  onStartDefectFix,
  onViewDefect,
  onViewTask,
  onEditTask,
  onStartTask,
  onCompleteTask,
  onStartTaskTest,
  onPassTaskTest,
  onCloseTask,
  onCompleteDefect,
  onVerifyDefect,
  onRejectDefect,
  onCloseDefect,
  onReopenDefect,
  onReviewRequirement,
  onAcceptRequirement,
  onViewRequirement,
  onProjectLifecycle,
  canTest,
  isProductManager,
  currentPersonId,
  versions,
  canPublish,
  canCreateTask: canCreateTaskByPosition,
  canCreateDefect,
  onPublish
}: {
  projects: Project[];
  selectedProjectId: number | null;
  onSelect: (id: number) => void;
  detail: any;
  onNew: (kind: DrawerKind, context?: DrawerContext) => void;
  onStartDefectFix: (defect: Defect) => void;
  onViewDefect: (defect: Defect) => void;
  onViewTask: (task: DevTask) => void;
  onEditTask: (task: DevTask) => void;
  onStartTask: (task: DevTask) => void;
  onCompleteTask: (task: DevTask) => void;
  onStartTaskTest: (task: DevTask) => void;
  onPassTaskTest: (task: DevTask) => void;
  onCloseTask: (task: DevTask) => void;
  onCompleteDefect: (defect: Defect) => void;
  onVerifyDefect: (defect: Defect) => void;
  onRejectDefect: (defect: Defect) => void;
  onCloseDefect: (defect: Defect) => void;
  onReopenDefect: (defect: Defect) => void;
  onReviewRequirement: (requirement: Requirement) => void;
  onAcceptRequirement: (requirement: Requirement) => void;
  onViewRequirement: (requirement: Requirement) => void;
  onProjectLifecycle: (project: Project, action: ProjectLifecycleAction) => void;
  canTest: boolean;
  isProductManager: boolean;
  currentPersonId: number;
  versions: ReleaseVersion[];
  canPublish: boolean;
  canCreateTask: boolean;
  canCreateDefect: boolean;
  onPublish: (version: ReleaseVersion) => void;
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [requirementSearchField, setRequirementSearchField] = useState("title");
  const [requirementSearchKeyword, setRequirementSearchKeyword] = useState("");
  const [requirementSearchDateRange, setRequirementSearchDateRange] = useState<DateRangeValue>(null);
  const [requirementStatusFilter, setRequirementStatusFilter] = useState<string[]>([]);
  const [requirementLaunchStatusFilter, setRequirementLaunchStatusFilter] = useState<string[]>([]);
  const [requirementTypeFilter, setRequirementTypeFilter] = useState<string[]>([]);
  const [requirementPriorityFilter, setRequirementPriorityFilter] = useState<string[]>([]);
  const [versionSearchField, setVersionSearchField] = useState("name");
  const [versionSearchKeyword, setVersionSearchKeyword] = useState("");
  const [versionSearchDateRange, setVersionSearchDateRange] = useState<DateRangeValue>(null);
  const [versionStatusFilter, setVersionStatusFilter] = useState<string[]>([]);
  const [versionTypeFilter, setVersionTypeFilter] = useState<string[]>([]);
  const [documentSearchField, setDocumentSearchField] = useState("name");
  const [documentSearchKeyword, setDocumentSearchKeyword] = useState("");
  const [documentSearchDateRange, setDocumentSearchDateRange] = useState<DateRangeValue>(null);
  const [documentTypeFilter, setDocumentTypeFilter] = useState<string[]>([]);
  const requirements = (detail?.requirements || []) as Requirement[];
  const tasks = (detail?.tasks || []) as DevTask[];
  const defects = (detail?.defects || []) as Defect[];
  const documents = (detail?.documents || []) as any[];
  const projectVersions = versions.filter((version) => version.project?.id === detail?.id || (version as any).projectId === detail?.id);
  const versionStatusFilterOptions = countFilterOptions(VERSION_STATUS_OPTIONS, projectVersions, (version) => version.status);
  const versionTypeFilterOptions = countFilterOptions(VERSION_TYPE_OPTIONS, projectVersions, (version) => version.type);
  const versionSearchOptions: Array<TableSearchOption<ReleaseVersion>> = [
    { value: "code", label: "编号", type: "text", reader: (version) => version.code },
    { value: "name", label: "名称", type: "text", reader: (version) => version.name },
    { value: "creator", label: "创建人", type: "text", reader: (version) => version.creator?.name },
    { value: "releaseOwner", label: "发布负责人", type: "text", reader: (version) => version.releaseOwner?.name },
    { value: "plannedReleaseAt", label: "计划发版", type: "date", reader: (version) => version.plannedReleaseAt },
    { value: "createdAt", label: "创建时间", type: "date", reader: (version) => version.createdAt }
  ];
  const documentTypeFilterOptions = countFilterOptions(DOCUMENT_TYPE_OPTIONS, documents, (doc) => doc.type);
  const documentSearchOptions: Array<TableSearchOption<any>> = [
    { value: "name", label: "名称", type: "text", reader: (doc) => doc.name },
    { value: "description", label: "资料描述", type: "text", reader: (doc) => stripRichText(doc.description || "") },
    { value: "creator", label: "创建人", type: "text", reader: (doc) => doc.createdBy?.name },
    { value: "tags", label: "标签/版本", type: "text", reader: (doc) => doc.tags || doc.version },
    { value: "createdAt", label: "创建时间", type: "date", reader: (doc) => doc.createdAt }
  ];
  const filteredProjectVersions = projectVersions.filter((version) =>
    matchSearchOption(version, versionSearchField, versionSearchKeyword, versionSearchDateRange, versionSearchOptions) &&
    inSelected(versionStatusFilter, version.status) &&
    inSelected(versionTypeFilter, version.type)
  );
  const filteredDocuments = documents.filter((doc) =>
    matchSearchOption(doc, documentSearchField, documentSearchKeyword, documentSearchDateRange, documentSearchOptions) &&
    inSelected(documentTypeFilter, doc.type)
  );
  const isProjectClosed = detail?.stage === "CLOSED";
  const canEditProject = isProductManager || detail?.owner?.id === currentPersonId || detail?.ownerId === currentPersonId;
  const openTasks = tasks.filter((task) => !["TEST_PASSED", "CLOSED"].includes(task.status));
  const openDefects = defects.filter((defect) => !["VERIFIED", "CLOSED"].includes(defect.status));
  const projectOptions = projects.map((project) => ({ value: project.id, label: project.name }));
  const requirementStatusOptions = countFilterOptions(REQUIREMENT_STATUS_OPTIONS, requirements, (requirement) => requirement.status);
  const requirementLaunchStatusOptions = countFilterOptions(REQUIREMENT_LAUNCH_STATUS_OPTIONS, requirements, (requirement) => requirement.launchStatus || "TO_RELEASE");
  const requirementTypeOptions = countFilterOptions(REQUIREMENT_TYPE_OPTIONS, requirements, (requirement) => requirement.type);
  const requirementPriorityOptions = countFilterOptions(REQUIREMENT_PRIORITY_OPTIONS, requirements, (requirement) => requirement.priorityLevel);
  const requirementSearchOptions: Array<TableSearchOption<Requirement>> = [
    { value: "code", label: "编号", type: "text", reader: (requirement) => requirement.code },
    { value: "title", label: "名称", type: "text", reader: (requirement) => requirement.title },
    { value: "submitter", label: "创建人", type: "text", reader: (requirement) => requirement.submitter?.name },
    { value: "expectedLaunchDate", label: "期望上线", type: "date", reader: (requirement) => requirement.expectedLaunchDate },
    { value: "createdAt", label: "创建时间", type: "date", reader: (requirement) => requirement.createdAt }
  ];
  const filteredRequirements = requirements.filter((requirement) =>
    matchSearchOption(requirement, requirementSearchField, requirementSearchKeyword, requirementSearchDateRange, requirementSearchOptions) &&
    inSelected(requirementStatusFilter, requirement.status) &&
    inSelected(requirementLaunchStatusFilter, requirement.launchStatus || "TO_RELEASE") &&
    inSelected(requirementTypeFilter, requirement.type) &&
    inSelected(requirementPriorityFilter, requirement.priorityLevel)
  );
  const canReviewRequirementByStatus = (requirement: Requirement) => ["TO_REVIEW", "NEEDS_SUPPLEMENT"].includes(requirement.status);
  const canOperateRequirement = (requirement: Requirement) => !["CHANGE", "OPTIMIZATION"].includes(requirement.status);
  const canCreateTaskByStatus = (requirement: Requirement) => !isProjectClosed && canOperateRequirement(requirement) && ["APPROVED", "DEVELOPING"].includes(requirement.status);
  const requirementTasks = (requirement: Requirement) => tasks.filter((task) => task.requirement?.id === requirement.id);
  const canAcceptRequirementByStatus = (requirement: Requirement) => {
    const linkedTasks = requirementTasks(requirement);
    return !isProjectClosed && requirement.status === "DEVELOPING" && linkedTasks.length > 0 && linkedTasks.every((task) => task.status === "TEST_PASSED");
  };
  const acceptanceButtonTitle = (requirement: Requirement) => {
    if (isProjectClosed) return "项目已结项，不能验收需求";
    if (requirement.status !== "DEVELOPING") return "只有开发中的需求可以验收完成";
    const linkedTasks = requirementTasks(requirement);
    if (!linkedTasks.length) return "需求尚未创建开发任务，不能验收完成";
    if (!linkedTasks.every((task) => task.status === "TEST_PASSED")) return "需求下所有任务测试通过后才能验收完成";
    return "填写验收结论并完成需求";
  };
  const projectTabs = [
    ["overview", "概览"],
    ["requirements", "需求"],
    ["tasks", "任务"],
    ["defects", "缺陷"],
    ["versions", "版本"],
    ["documents", "资料"]
  ] as const;
  const requirementColumns = [
    {
      title: "需求",
      dataIndex: "title",
      sorter: compareText<Requirement>((requirement) => requirement.title),
      render: (_: unknown, requirement: Requirement) => (
        <Space direction="vertical" size={1}>
          <strong>{requirement.title}</strong>
          <span className="muted-line">{requirement.code} · {label(requirement.type)} · {requirement.priorityLevel}</span>
        </Space>
      )
    },
    { title: "需求状态", width: 120, sorter: compareText<Requirement>((requirement) => label(requirement.status)), render: (_: unknown, requirement: Requirement) => <Tag color={requirementStatusColor(requirement.status)}>{label(requirement.status)}</Tag> },
    { title: "上线状态", width: 110, sorter: compareText<Requirement>((requirement) => label(requirement.launchStatus || "TO_RELEASE")), render: (_: unknown, requirement: Requirement) => <Tag>{label(requirement.launchStatus || "TO_RELEASE")}</Tag> },
    { title: "优先级分数", width: 120, dataIndex: "priorityScore", sorter: compareNumber<Requirement>((requirement) => requirement.priorityScore) },
    { title: "期望上线", width: 120, sorter: compareDate<Requirement>((requirement) => requirement.expectedLaunchDate), render: (_: unknown, requirement: Requirement) => fmtDate(requirement.expectedLaunchDate) },
    { title: "任务", width: 90, sorter: compareNumber<Requirement>((requirement) => (requirement as any)._count?.tasks ?? tasks.filter((task) => task.requirement?.id === requirement.id).length), render: (_: unknown, requirement: Requirement) => (requirement as any)._count?.tasks ?? tasks.filter((task) => task.requirement?.id === requirement.id).length },
    { title: "创建人", width: 110, sorter: compareText<Requirement>((requirement) => requirement.submitter?.name), render: (_: unknown, requirement: Requirement) => requirement.submitter?.name || "-" },
    { title: "创建时间", width: 160, sorter: compareDate<Requirement>((requirement) => requirement.createdAt), render: (_: unknown, requirement: Requirement) => fmtDateTime(requirement.createdAt) },
    {
      title: "操作",
      width: 210,
      fixed: "right" as const,
      render: (_: unknown, requirement: Requirement) => (
        <TableActions>
          {isProductManager ? (
            <AntButton size="small" type="primary" disabled={!canReviewRequirementByStatus(requirement)} title={canReviewRequirementByStatus(requirement) ? "填写评审结果" : "只有待评审或待补充需求可以填写评审结果"} onClick={() => onReviewRequirement(requirement)}>评审</AntButton>
          ) : null}
          <AntButton size="small" onClick={() => onViewRequirement(requirement)}>详情</AntButton>
          {isProductManager ? (
            <AntButton size="small" disabled={!canAcceptRequirementByStatus(requirement)} title={acceptanceButtonTitle(requirement)} onClick={() => onAcceptRequirement(requirement)}>验收</AntButton>
          ) : null}
          {canCreateTaskByPosition ? (
            <AntButton size="small" disabled={!canCreateTaskByStatus(requirement)} title={canCreateTaskByStatus(requirement) ? "创建任务" : "评审通过或开发中才可以创建任务"} onClick={() => onNew("task", { projectId: requirement.projectId, requirementId: requirement.id })}>任务</AntButton>
          ) : null}
          {isProductManager ? <AntButton size="small" disabled={!canOperateRequirement(requirement) || isProjectClosed} title={canOperateRequirement(requirement) ? "创建需求变更" : "需求变更或需求优化状态为终态，不能继续操作"} onClick={() => onNew("requirement", { projectId: requirement.projectId, requirementId: requirement.id, revisionMode: "CHANGE" })}>变更</AntButton> : null}
          {isProductManager ? <AntButton size="small" disabled={!canOperateRequirement(requirement) || isProjectClosed} title={canOperateRequirement(requirement) ? "创建需求优化" : "需求变更或需求优化状态为终态，不能继续操作"} onClick={() => onNew("requirement", { projectId: requirement.projectId, requirementId: requirement.id, revisionMode: "OPTIMIZATION" })}>优化</AntButton> : null}
        </TableActions>
      )
    }
  ];
  const versionColumns = [
    {
      title: "版本",
      sorter: compareText<ReleaseVersion>((version) => version.name),
      render: (_: unknown, version: ReleaseVersion) => (
        <Space direction="vertical" size={1}>
          <strong>{version.name}</strong>
          <span className="muted-line">{version.code}</span>
        </Space>
      )
    },
    { title: "状态", width: 110, sorter: compareText<ReleaseVersion>((version) => label(version.status)), render: (_: unknown, version: ReleaseVersion) => <Tag color={version.status === "RELEASED" ? "green" : "blue"}>{label(version.status)}</Tag> },
    { title: "计划发版", width: 130, sorter: compareDate<ReleaseVersion>((version) => version.plannedReleaseAt), render: (_: unknown, version: ReleaseVersion) => fmtDate(version.plannedReleaseAt) },
    { title: "实际发版", width: 130, sorter: compareDate<ReleaseVersion>((version) => version.actualReleaseAt), render: (_: unknown, version: ReleaseVersion) => fmtDateTime(version.actualReleaseAt || undefined) },
    { title: "上线需求", width: 100, sorter: compareNumber<ReleaseVersion>((version) => version.requirements?.length || 0), render: (_: unknown, version: ReleaseVersion) => version.requirements?.length || 0 },
    { title: "修复缺陷", width: 100, sorter: compareNumber<ReleaseVersion>((version) => version.defects?.length || 0), render: (_: unknown, version: ReleaseVersion) => version.defects?.length || 0 },
    { title: "创建人", width: 110, sorter: compareText<ReleaseVersion>((version) => version.creator?.name), render: (_: unknown, version: ReleaseVersion) => version.creator?.name || "-" },
    { title: "创建时间", width: 160, sorter: compareDate<ReleaseVersion>((version) => version.createdAt), render: (_: unknown, version: ReleaseVersion) => fmtDateTime(version.createdAt) },
    { title: "操作", width: 120, fixed: "right" as const, render: (_: unknown, version: ReleaseVersion) => <TableActions>{canPublish ? <AntButton size="small" type="primary" disabled={!canPublishVersionAction(version)} title={canPublishVersionAction(version) ? "发布版本" : "版本已发布、已回滚或已取消，不能重复发布"} onClick={() => onPublish(version)}>发布</AntButton> : null}</TableActions> }
  ];
  const documentColumns = [
    { title: "资料", sorter: compareText<any>((doc) => doc.name), render: (_: unknown, doc: any) => <Space direction="vertical" size={1}><strong>{doc.name}</strong><span className="muted-line">{doc.tags || doc.version || "-"}</span></Space> },
    { title: "类型", width: 110, sorter: compareText<any>((doc) => label(doc.type)), render: (_: unknown, doc: any) => label(doc.type) },
    { title: "版本", width: 100, sorter: compareText<any>((doc) => doc.version), render: (_: unknown, doc: any) => doc.version || "-" },
    { title: "资料描述", render: (_: unknown, doc: any) => <RichTextDisplay value={doc.description} /> },
    { title: "附件", width: 100, render: (_: unknown, doc: any) => doc.attachmentUrl ? <a href={doc.attachmentUrl} target="_blank" rel="noreferrer">打开附件</a> : "-" },
    { title: "创建人", width: 110, sorter: compareText<any>((doc) => doc.createdBy?.name), render: (_: unknown, doc: any) => doc.createdBy?.name || "-" },
    { title: "创建时间", width: 160, sorter: compareDate<any>((doc) => doc.createdAt), render: (_: unknown, doc: any) => fmtDateTime(doc.createdAt) }
  ];
  return (
    <section className="page-stack project-management-page ant-project-page">
      <div className="module-page-head project-page-head">
        <div>
          <p className="page-kicker">项目空间</p>
          <h1>项目管理</h1>
          <p>围绕当前项目管理需求、缺陷、版本和资料。</p>
        </div>
        <div className="page-actions">
          <Space size={8} wrap>
            <AntSelect showSearch optionFilterProp="label" className="antd-project-picker" value={selectedProjectId || undefined} options={projectOptions} onChange={onSelect} placeholder="选择项目" />
            {isProductManager ? <AntButton icon={<Plus size={16} />} onClick={() => onNew("project")}>新建项目</AntButton> : null}
          </Space>
        </div>
      </div>
      <Card
        className="project-context-card"
        title="项目概要"
      >
        {detail ? (
          <>
            <div className="ant-project-header">
              <div>
                <h2>{detail.name}</h2>
              </div>
              <Space size={8} wrap>
                {canEditProject ? <AntButton icon={<Pencil size={16} />} onClick={() => onNew("project", { editProjectId: detail.id })}>编辑项目</AntButton> : null}
                {canEditProject ? <AntButton type="primary" disabled={detail.stage !== "INITIATED"} title={detail.stage === "INITIATED" ? "启动项目" : "只有已立项项目可以启动"} icon={<Rocket size={16} />} onClick={() => onProjectLifecycle(detail, "start")}>启动项目</AntButton> : null}
                {canEditProject ? <AntButton disabled={isProjectClosed} title={isProjectClosed ? "项目已结项，不能再次结项" : "项目结项"} icon={<CheckCircle2 size={16} />} onClick={() => onProjectLifecycle(detail, "close")}>项目结项</AntButton> : null}
                {canEditProject ? <AntButton type="primary" disabled={!isProjectClosed} title={isProjectClosed ? "重新打开项目" : "只有已结项项目可以重新打开"} icon={<Rocket size={16} />} onClick={() => onProjectLifecycle(detail, "reopen")}>重新打开</AntButton> : null}
                {isProductManager ? <AntButton type="primary" disabled={isProjectClosed} title={isProjectClosed ? "项目已结项，不能新增需求" : "新建需求"} icon={<Plus size={16} />} onClick={() => onNew("requirement", { projectId: detail.id })}>需求</AntButton> : null}
                {canPublish ? <AntButton disabled={isProjectClosed} icon={<Plus size={16} />} onClick={() => onNew("version", { projectId: detail.id })}>版本</AntButton> : null}
                <AntButton icon={<Plus size={16} />} onClick={() => onNew("document", { projectId: detail.id })}>资料</AntButton>
              </Space>
            </div>
            <Descriptions className="ant-project-descriptions" size="small" column={4} bordered>
              <Descriptions.Item label="当前状态">{projectStageLabel(detail.stage)}</Descriptions.Item>
              <Descriptions.Item label="项目负责人">{detail.owner?.name || "-"}</Descriptions.Item>
              <Descriptions.Item label="计划周期">{fmtDate(detail.plannedStartDate)} - {fmtDate(detail.plannedEndDate)}</Descriptions.Item>
              <Descriptions.Item label="期望上线">{fmtDate(detail.expectedLaunchDate)}</Descriptions.Item>
              <Descriptions.Item label="实际开始">{fmtDateTime(detail.actualStartDate || undefined)}</Descriptions.Item>
              <Descriptions.Item label="实际结束">{fmtDateTime(detail.actualEndDate || undefined)}</Descriptions.Item>
            </Descriptions>
          </>
        ) : (
          <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无项目" />
        )}
      </Card>

      {detail ? (
        <>
          <div className="project-module-tabs">
            {projectTabs.map(([key, text]) => (
              <button key={key} type="button" className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)}>
                {text}
              </button>
            ))}
          </div>

          {activeTab === "overview" ? (
            <>
              <section className="project-overview-grid">
                <Metric label="需求" value={requirements.length} />
                <Metric label="未完成任务" value={openTasks.length} tone={openTasks.length ? "warn" : undefined} />
                <Metric label="未闭环缺陷" value={openDefects.length} tone={openDefects.length ? "warn" : undefined} />
                <Metric label="版本" value={projectVersions.length} />
              </section>
              <ProjectRichCollapse project={detail} />
            </>
          ) : null}

          {activeTab === "requirements" ? (
            <Card className="enterprise-card" title="需求" extra={isProductManager ? <AntButton type="primary" disabled={isProjectClosed} title={isProjectClosed ? "项目已结项，不能新增需求" : "新建需求"} onClick={() => onNew("requirement", { projectId: detail.id })}><Plus size={16} /> 需求</AntButton> : null}>
              <Space size={8} wrap style={{ marginBottom: 14 }}>
                <TableSearchControl
                  options={requirementSearchOptions}
                  field={requirementSearchField}
                  keyword={requirementSearchKeyword}
                  dateRange={requirementSearchDateRange}
                  onFieldChange={setRequirementSearchField}
                  onKeywordChange={setRequirementSearchKeyword}
                  onDateRangeChange={setRequirementSearchDateRange}
                />
                <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 180 }} placeholder={"需求状态"} value={requirementStatusFilter} options={requirementStatusOptions} onChange={setRequirementStatusFilter} />
                <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 180 }} placeholder={"上线状态"} value={requirementLaunchStatusFilter} options={requirementLaunchStatusOptions} onChange={setRequirementLaunchStatusFilter} />
                <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 180 }} placeholder={"需求类型"} value={requirementTypeFilter} options={requirementTypeOptions} onChange={setRequirementTypeFilter} />
                <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 180 }} placeholder={"需求性质"} value={requirementPriorityFilter} options={requirementPriorityOptions} onChange={setRequirementPriorityFilter} />
              </Space>
              <AntTable
                className="enterprise-table"
                rowKey="id"
                columns={requirementColumns}
                dataSource={filteredRequirements}
                pagination={tablePagination(filteredRequirements.length)}
                scroll={{ x: 1260 }}
                locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无需求" /> }}
              />
            </Card>
          ) : null}

          {activeTab === "tasks" ? (
            <TaskTable
              title="开发任务"
              extra={<span className="section-note">任务从需求创建，缺陷从任务创建</span>}
              showProjectColumn={false}
              tasks={tasks}
              onView={onViewTask}
              onEdit={onEditTask}
              onStart={onStartTask}
              onComplete={onCompleteTask}
              onStartTest={onStartTaskTest}
              onPassTest={onPassTaskTest}
              onClose={onCloseTask}
              onNewDefect={(task) => onNew("defect", { projectId: detail.id, requirementId: task.requirement?.id, taskId: task.id })}
              canTest={canTest}
              isProductManager={isProductManager}
              isProjectClosed={isProjectClosed}
              currentPersonId={currentPersonId}
              canCreateDefect={canCreateDefect}
            />
          ) : null}

          {activeTab === "defects" ? (
            <DefectTable
              title="缺陷"
              defects={defects}
              onView={onViewDefect}
              onStartFix={onStartDefectFix}
              onComplete={onCompleteDefect}
              canVerify={canTest}
              onVerify={onVerifyDefect}
              onReject={onRejectDefect}
              onClose={onCloseDefect}
              onReopen={onReopenDefect}
              currentPersonId={currentPersonId}
            />
          ) : null}

          {activeTab === "versions" ? (
            <Card className="enterprise-card" title="版本" extra={canPublish ? <AntButton type="primary" disabled={isProjectClosed} title={isProjectClosed ? "项目已结项，不能新增版本" : "新建版本"} onClick={() => onNew("version", { projectId: detail.id })}><Plus size={16} /> 版本</AntButton> : null}>
              <Space size={8} wrap style={{ marginBottom: 14 }}>
                <TableSearchControl
                  options={versionSearchOptions}
                  field={versionSearchField}
                  keyword={versionSearchKeyword}
                  dateRange={versionSearchDateRange}
                  onFieldChange={setVersionSearchField}
                  onKeywordChange={setVersionSearchKeyword}
                  onDateRangeChange={setVersionSearchDateRange}
                />
                <AntSelect
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  style={{ minWidth: 180 }}
                  placeholder="版本状态"
                  value={versionStatusFilter}
                  options={versionStatusFilterOptions}
                  onChange={setVersionStatusFilter}
                />
                <AntSelect
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  style={{ minWidth: 180 }}
                  placeholder="版本类型"
                  value={versionTypeFilter}
                  options={versionTypeFilterOptions}
                  onChange={setVersionTypeFilter}
                />
              </Space>
              <AntTable
                className="enterprise-table"
                rowKey="id"
                columns={versionColumns}
                dataSource={filteredProjectVersions}
                pagination={tablePagination(filteredProjectVersions.length)}
                scroll={{ x: 1020 }}
                locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无版本" /> }}
              />
            </Card>
          ) : null}

          {activeTab === "documents" ? (
            <Card className="enterprise-card" title="资料" extra={<AntButton type="primary" onClick={() => onNew("document", { projectId: detail.id })}><Plus size={16} /> 资料</AntButton>}>
              <Space size={8} wrap style={{ marginBottom: 14 }}>
                <TableSearchControl
                  options={documentSearchOptions}
                  field={documentSearchField}
                  keyword={documentSearchKeyword}
                  dateRange={documentSearchDateRange}
                  onFieldChange={setDocumentSearchField}
                  onKeywordChange={setDocumentSearchKeyword}
                  onDateRangeChange={setDocumentSearchDateRange}
                />
                <AntSelect
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  style={{ minWidth: 180 }}
                  placeholder="资料类型"
                  value={documentTypeFilter}
                  options={documentTypeFilterOptions}
                  onChange={setDocumentTypeFilter}
                />
              </Space>
              <AntTable
                className="enterprise-table"
                rowKey="id"
                columns={documentColumns}
                dataSource={filteredDocuments}
                pagination={tablePagination(filteredDocuments.length)}
                scroll={{ x: 1080 }}
                locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无资料" /> }}
              />
            </Card>
          ) : null}

        </>
      ) : null}
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
  onViewDefect,
  onViewTask,
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
  onViewDefect: (defect: Defect) => void;
  onViewTask: (task: DevTask) => void;
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
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState("ALL");
  const [selectedRequirementId, setSelectedRequirementId] = useState<number | null>(null);
  const requirements = (detail?.requirements || []) as Requirement[];
  const tasks = (detail?.tasks || []) as DevTask[];
  const defects = (detail?.defects || []) as Defect[];
  const normalizedKeyword = keyword.trim().toLowerCase();
  const canEditProject = isProductManager || detail?.owner?.id === currentPersonId || detail?.ownerId === currentPersonId;
  const isProjectClosed = detail?.stage === "CLOSED";
  const canPassTask = (task: DevTask) => !task.defects?.some((defect) => !["VERIFIED", "CLOSED"].includes(defect.status));
  const taskHasAssignee = (task: DevTask) => hasAssignedPerson(task);
  const canCreateDefect = (task: DevTask) => !isProjectClosed && taskHasAssignee(task) && ["TESTING", "TEST_PASSED"].includes(task.status);
  useEffect(() => {
    const firstRequirementId = requirements[0]?.id || null;
    if (!firstRequirementId) {
      if (selectedRequirementId !== null) setSelectedRequirementId(null);
      return;
    }
    if (!selectedRequirementId || !requirements.some((requirement) => requirement.id === selectedRequirementId)) {
      setSelectedRequirementId(firstRequirementId);
    }
  }, [detail?.id, requirements.length, selectedRequirementId]);
  const statusOptions = useMemo(() => {
    const source = [...requirements, ...tasks, ...defects];
    return countFilterOptions(
      mergeOptions(mergeOptions(REQUIREMENT_STATUS_OPTIONS, TASK_STATUS_OPTIONS), DEFECT_STATUS_OPTIONS),
      source,
      (item: any) => item.status
    );
  }, [requirements, tasks, defects]);
  const assigneeOptions = useMemo(() => {
    const pairs = [...tasks, ...defects]
      .map((item: any) => item.assignee ? [String(item.assignee.id), item.assignee.name] as [string, string] : null)
      .filter(Boolean) as Array<[string, string]>;
    return Array.from(new Map(pairs).entries());
  }, [tasks, defects]);
  const isFilterEmpty = !normalizedKeyword && statusFilter === "ALL" && assigneeFilter === "ALL";
  const matchesKeyword = (parts: Array<string | number | null | undefined>) => {
    if (!normalizedKeyword) return true;
    return parts.join(" ").toLowerCase().includes(normalizedKeyword);
  };
  const matchesStatus = (status?: string) => statusFilter === "ALL" || status === statusFilter;
  const matchesTask = (task: DevTask) => {
    const assigneeId = task.assignee?.id ? String(task.assignee.id) : "";
    return matchesKeyword([task.title, task.code, task.type, task.requirement?.title]) && matchesStatus(task.status) && (assigneeFilter === "ALL" || assigneeId === assigneeFilter);
  };
  const matchesDefect = (defect: Defect) => {
    const assigneeId = defect.assignee?.id ? String(defect.assignee.id) : "";
    return matchesKeyword([defect.title, defect.code, defect.level, defect.task?.title, defect.task?.requirement?.title]) && matchesStatus(defect.status) && (assigneeFilter === "ALL" || assigneeId === assigneeFilter);
  };
  const requirementGroups = requirements
    .map((requirement) => {
      const requirementTasks = tasks.filter((task) => task.requirement?.id === requirement.id || (task as any).requirementId === requirement.id);
      const taskIds = new Set(requirementTasks.map((task) => task.id));
      const requirementDefects = defects.filter((defect) => (defect.taskId && taskIds.has(defect.taskId)) || defect.task?.requirement?.id === requirement.id || defect.requirement?.id === requirement.id);
      const requirementMatches = matchesKeyword([requirement.title, requirement.code, requirement.type, requirement.priorityLevel]) && matchesStatus(requirement.status) && assigneeFilter === "ALL";
      const visibleTasks = requirementTasks
        .map((task) => {
          const taskDefects = requirementDefects.filter((defect) => defect.taskId === task.id || defect.task?.id === task.id);
          const taskMatches = matchesTask(task);
          const visibleDefects = taskDefects.filter(matchesDefect);
          const showTask = isFilterEmpty || requirementMatches || taskMatches || visibleDefects.length > 0;
          if (!showTask) return null;
          return {
            ...task,
            childDefects: isFilterEmpty || requirementMatches || taskMatches ? taskDefects : visibleDefects
          };
        })
        .filter(Boolean) as Array<DevTask & { childDefects: Defect[] }>;
      const showRequirement = isFilterEmpty || requirementMatches || visibleTasks.length > 0;
      if (!showRequirement) return null;
      return { requirement, tasks: visibleTasks, totalTasks: requirementTasks.length, totalDefects: requirementDefects.length };
    })
    .filter(Boolean) as Array<{ requirement: Requirement; tasks: Array<DevTask & { childDefects: Defect[] }>; totalTasks: number; totalDefects: number }>;
  const activeRequirementGroup = requirementGroups.find((group) => group.requirement.id === selectedRequirementId) || requirementGroups[0] || null;
  const projectOptions = projects.map((project) => ({ value: project.id, label: project.name }));
  const statusSelectOptions = [{ value: "ALL", label: "全部状态" }, ...statusOptions];
  const assigneeSelectOptions = [{ value: "ALL", label: "全部负责人" }, ...assigneeOptions.map(([value, text]) => ({ value, label: text }))];

  return (
    <section className="page-stack project-page ant-project-page">
      <Card
        title="项目总览"
        extra={<AntSelect showSearch optionFilterProp="label" className="antd-project-picker" value={selectedProjectId || undefined} options={projectOptions} onChange={onSelect} placeholder="选择项目" />}
      >
        {detail ? (
          <>
            <div className="ant-project-header">
              <div>
                <h2>{detail.name}</h2>
              </div>
              <Space size={8} wrap>
                {canEditProject ? (
                  <AntButton icon={<Pencil size={16} />} onClick={() => onNew("project", { editProjectId: detail.id })}>编辑项目</AntButton>
                ) : null}
                {canEditProject && detail.stage === "INITIATED" ? (
                  <AntButton type="primary" icon={<Rocket size={16} />} onClick={() => onProjectLifecycle(detail, "start")}>启动项目</AntButton>
                ) : null}
                {canEditProject && !isProjectClosed ? (
                  <AntButton icon={<CheckCircle2 size={16} />} onClick={() => onProjectLifecycle(detail, "close")}>项目结项</AntButton>
                ) : null}
                {canEditProject && isProjectClosed ? (
                  <AntButton type="primary" icon={<Rocket size={16} />} onClick={() => onProjectLifecycle(detail, "reopen")}>重新打开</AntButton>
                ) : null}
                <AntButton type="primary" disabled={isProjectClosed} icon={<Plus size={16} />} onClick={() => onNew("requirement", { projectId: detail.id })}>需求</AntButton>
                <AntButton icon={<Plus size={16} />} onClick={() => onNew("document", { projectId: detail.id })}>资料</AntButton>
              </Space>
            </div>
            <Descriptions className="ant-project-descriptions" size="small" column={3} bordered>
              <Descriptions.Item label="项目负责人">{detail.owner?.name || "-"}</Descriptions.Item>
              <Descriptions.Item label="计划周期">{fmtDate(detail.plannedStartDate)} - {fmtDate(detail.plannedEndDate)}</Descriptions.Item>
              <Descriptions.Item label="期望上线">{fmtDate(detail.expectedLaunchDate)}</Descriptions.Item>
              <Descriptions.Item label="实际开始">{fmtDateTime(detail.actualStartDate || undefined)}</Descriptions.Item>
              <Descriptions.Item label="实际结束">{fmtDateTime(detail.actualEndDate || undefined)}</Descriptions.Item>
            </Descriptions>
            <ProjectRichCollapse project={detail} />
          </>
        ) : (
          <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无项目" />
        )}
      </Card>

      {detail ? (
        <Card
          title="需求交付结构"
          extra={<span className="section-note">左侧选需求，右侧直接处理任务和缺陷</span>}
        >
          <div className="antd-tree-filters">
            <AntInput.Search allowClear placeholder="搜索需求、任务、缺陷" value={keyword} onChange={(event) => setKeyword(event.currentTarget.value)} />
            <AntSelect value={statusFilter} options={statusSelectOptions} onChange={setStatusFilter} />
            <AntSelect showSearch optionFilterProp="label" value={assigneeFilter} options={assigneeSelectOptions} onChange={setAssigneeFilter} />
          </div>
          {requirementGroups.length ? (
            <div className="delivery-workspace">
              <aside className="requirement-rail" aria-label="需求列表">
                {requirementGroups.map(({ requirement, totalTasks, totalDefects }) => (
                  <button
                    key={requirement.id}
                    className={activeRequirementGroup?.requirement.id === requirement.id ? "requirement-card selected" : "requirement-card"}
                    type="button"
                    onClick={() => setSelectedRequirementId(requirement.id)}
                  >
                    <span className="requirement-card-title">{requirement.title}</span>
                    <span>{requirement.code} · {label(requirement.type)} · {requirement.priorityLevel}</span>
                    <span className="requirement-card-tags">
                      <Tag color={requirementStatusColor(requirement.status)}>{label(requirement.status)}</Tag>
                      <Tag>{label(requirement.launchStatus || "TO_RELEASE")}</Tag>
                    </span>
                    <span className="requirement-card-stats">
                      <em>分数 {requirement.priorityScore}</em>
                      <em>任务 {totalTasks}</em>
                      <em>缺陷 {totalDefects}</em>
                    </span>
                  </button>
                ))}
              </aside>
              <div className="delivery-detail-panel">
                {activeRequirementGroup ? (() => {
                  const requirement = activeRequirementGroup.requirement;
                  const canOperateRequirement = !["CHANGE", "OPTIMIZATION"].includes(requirement.status);
                  const canCreateTask = !isProjectClosed && ["APPROVED", "DEVELOPING"].includes(requirement.status);
                  const canReview = isProductManager && ["TO_REVIEW", "NEEDS_SUPPLEMENT"].includes(requirement.status);
                  return (
                    <>
                      <div className="requirement-detail-head">
                        <div>
                          <Space size={6} wrap>
                            <Tag color={requirementStatusColor(requirement.status)}>{label(requirement.status)}</Tag>
                            <Tag>{label(requirement.launchStatus || "TO_RELEASE")}</Tag>
                            <Tag color="blue">优先级分数 {requirement.priorityScore}</Tag>
                          </Space>
                          <h3>{requirement.title}</h3>
                          <p>{requirement.code} · {label(requirement.type)} · {requirement.priorityLevel}</p>
                        </div>
                        <Space size={8} wrap>
                          {canReview ? <AntButton size="small" type="primary" onClick={() => onReviewRequirement(requirement)}>填写评审</AntButton> : null}
                          <AntButton size="small" disabled={!canCreateTask} onClick={() => onNew("task", { projectId: requirement.projectId, requirementId: requirement.id })}>创建任务</AntButton>
                          {isProductManager && canOperateRequirement ? <AntButton size="small" onClick={() => onNew("requirement", { projectId: requirement.projectId, requirementId: requirement.id, revisionMode: "CHANGE" })}>需求变更</AntButton> : null}
                          {isProductManager && canOperateRequirement ? <AntButton size="small" onClick={() => onNew("requirement", { projectId: requirement.projectId, requirementId: requirement.id, revisionMode: "OPTIMIZATION" })}>需求优化</AntButton> : null}
                        </Space>
                      </div>
                      <div className="task-worklist">
                        {activeRequirementGroup.tasks.length ? activeRequirementGroup.tasks.map((task) => {
                          const taskOwner = isAssignedToPerson(task, currentPersonId);
                          const taskTesterReady = hasAssignedTester(task);
                          const taskCanCreateDefect = canTest && canCreateDefect(task);
                          return (
                          <div className={isDue(task.plannedFinishDate) ? "task-work-item due" : "task-work-item"} key={task.id}>
                            <div className="task-work-main">
                              <div className="task-work-title">
                                <strong>{task.title}</strong>
                                <span>{task.code} · {label(task.type)}</span>
                              </div>
                              <div className="task-work-meta">
                                <span>负责人：{task.assignee?.name || "-"}</span>
                                <span>排期：{fmtDate(task.plannedStartDate)} - {fmtDate(task.plannedFinishDate)}</span>
                                <span>优先级分数：{task.priorityScore}</span>
                              </div>
                              <Space size={6} wrap>
                                <Tag color={taskStatusColor(task.status)}>{label(task.status)}</Tag>
                                <Tag>缺陷 {task.childDefects.length}</Tag>
                              </Space>
                            </div>
                            <div className="task-work-actions">
                              {canTest ? <AntButton size="small" disabled={!taskCanCreateDefect} onClick={() => onNew("defect", { projectId: task.project?.id || task.requirement?.projectId, requirementId: task.requirement?.id, taskId: task.id })}>创建缺陷</AntButton> : null}
                              <AntButton size="small" onClick={() => onViewTask(task)}>查看</AntButton>
                              {taskOwner && task.status === "TODO" ? <AntButton size="small" type="primary" onClick={() => onStartTask(task)}>开始处理</AntButton> : null}
                              {taskOwner && task.status === "DOING" ? <AntButton size="small" type="primary" onClick={() => onCompleteTask(task)}>处理完成</AntButton> : null}
                              {canTest && taskTesterReady && task.status === "TO_TEST" ? <AntButton size="small" type="primary" onClick={() => onStartTaskTest(task)}>开始测试</AntButton> : null}
                              {canTest && taskTesterReady && task.status === "TESTING" ? <AntButton size="small" type="primary" disabled={!canPassTask(task)} onClick={() => onPassTaskTest(task)}>测试通过</AntButton> : null}
                              {taskOwner && TASK_OWNER_EDITABLE_STATUSES.includes(task.status) ? <AntButton size="small" onClick={() => onCloseTask(task)}>关闭任务</AntButton> : null}
                            </div>
                            <div className="defect-inline-list">
                              {task.childDefects.length ? task.childDefects.map((defect) => {
                                const defectOwner = isAssignedToPerson(defect, currentPersonId);
                                const defectTesterReady = hasAssignedTester(defect);
                                return (
                                <div className="defect-inline-item" key={defect.id}>
                                  <div>
                                    <strong>{defect.title}</strong>
                                    <span>{defect.code} · {defectLevelLabel(defect.level)} · {defectEnvironmentLabel(defect.environment)}</span>
                                  </div>
                                  <Space size={6} wrap>
                                    <Tag color={defectStatusColor(defect.status)}>{label(defect.status)}</Tag>
                                    <Tag>分数 {defect.priorityScore}</Tag>
                                    <AntButton size="small" onClick={() => onViewDefect(defect)}>查看</AntButton>
                                    {defectOwner && defect.status === "TO_FIX" ? <AntButton size="small" type="primary" onClick={() => onStartDefectFix(defect)}>开始修复</AntButton> : null}
                                    {defectOwner && defect.status === "FIXING" ? <AntButton size="small" type="primary" onClick={() => onCompleteDefect(defect)}>已修复</AntButton> : null}
                                    {canTest && defectTesterReady && defect.status === "FIXED" ? <AntButton size="small" type="primary" onClick={() => onVerifyDefect(defect)}>验证通过</AntButton> : null}
                                    {canTest && defectTesterReady && defect.status === "FIXED" ? <AntButton size="small" onClick={() => onRejectDefect(defect)}>验证未通过</AntButton> : null}
                                    {canTest && defectTesterReady && DEFECT_OWNER_EDITABLE_STATUSES.includes(defect.status) ? <AntButton size="small" onClick={() => onCloseDefect(defect)}>关闭</AntButton> : null}
                                    {canTest && defectTesterReady && defect.status === "CLOSED" ? <AntButton size="small" onClick={() => onReopenDefect(defect)}>开启</AntButton> : null}
                                  </Space>
                                </div>
                              );
                              }) : (
                                <div className="defect-inline-empty">该任务暂无缺陷</div>
                              )}
                            </div>
                          </div>
                          );
                        }) : (
                          <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="该需求下暂无可展示任务" />
                        )}
                      </div>
                    </>
                  );
                })() : null}
              </div>
            </div>
          ) : (
            <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无符合条件的需求交付项" />
          )}
        </Card>
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
  onViewDefect,
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
  onViewDefect: (defect: Defect) => void;
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
        onView={onViewDefect}
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
  const columns = [
    {
      title: "版本",
      dataIndex: "name",
      render: (_: unknown, version: ReleaseVersion) => (
        <Space direction="vertical" size={1}>
          <strong>{version.name}</strong>
          <span className="muted-line">{version.code}</span>
        </Space>
      )
    },
    { title: "项目", render: (_: unknown, version: ReleaseVersion) => version.project?.name || "-" },
    { title: "状态", width: 110, render: (_: unknown, version: ReleaseVersion) => <Tag color={version.status === "RELEASED" ? "green" : "blue"}>{label(version.status)}</Tag> },
    { title: "计划发版", width: 140, render: (_: unknown, version: ReleaseVersion) => fmtDate(version.plannedReleaseAt) },
    { title: "实际发版", width: 160, render: (_: unknown, version: ReleaseVersion) => fmtDateTime(version.actualReleaseAt || undefined) },
    { title: "上线需求", width: 100, render: (_: unknown, version: ReleaseVersion) => version.requirements?.length || 0 },
    { title: "修复缺陷", width: 100, render: (_: unknown, version: ReleaseVersion) => version.defects?.length || 0 },
    {
      title: "操作",
      width: 120,
      fixed: "right" as const,
      render: (_: unknown, version: ReleaseVersion) => canPublish ? (
        <TableActions>
          <AntButton size="small" type="primary" disabled={!canPublishVersionAction(version)} title={canPublishVersionAction(version) ? "发布版本" : "版本已发布、已回滚或已取消，不能重复发布"} onClick={() => onPublish(version)}>
            <PackageCheck size={15} /> 发布
          </AntButton>
        </TableActions>
      ) : null
    }
  ];
  return (
    <section className="page-stack">
      <Card className="enterprise-card" title="版本发布" extra={<span className="section-note">发布前会校验需求上线状态和缺陷闭环情况</span>}>
        <AntTable
          className="enterprise-table"
          rowKey="id"
          columns={columns}
          dataSource={versions}
          pagination={versions.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
          scroll={{ x: 820 }}
          locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无版本" /> }}
        />
      </Card>
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
  const [activeAdminSection, setActiveAdminSection] = useState("people");
  const [peopleSearchField, setPeopleSearchField] = useState("name");
  const [peopleKeyword, setPeopleKeyword] = useState("");
  const [peopleDateRange, setPeopleDateRange] = useState<DateRangeValue>(null);
  const [peopleOrganizationFilter, setPeopleOrganizationFilter] = useState<string[]>([]);
  const [peoplePositionFilter, setPeoplePositionFilter] = useState<string[]>([]);
  const [peopleStatusFilter, setPeopleStatusFilter] = useState<string[]>([]);
  const [accountStatusFilter, setAccountStatusFilter] = useState<string[]>([]);
  const [allowLoginFilter, setAllowLoginFilter] = useState<string[]>([]);
  const [organizationSearchField, setOrganizationSearchField] = useState("name");
  const [organizationKeyword, setOrganizationKeyword] = useState("");
  const [organizationDateRange, setOrganizationDateRange] = useState<DateRangeValue>(null);
  const [organizationStatusFilter, setOrganizationStatusFilter] = useState<string[]>([]);
  const [positionSearchField, setPositionSearchField] = useState("name");
  const [positionKeyword, setPositionKeyword] = useState("");
  const [positionDateRange, setPositionDateRange] = useState<DateRangeValue>(null);
  const [positionCategoryFilter, setPositionCategoryFilter] = useState<string[]>([]);
  const [positionStatusFilter, setPositionStatusFilter] = useState<string[]>([]);
  const [prioritySearchField, setPrioritySearchField] = useState("name");
  const [priorityKeyword, setPriorityKeyword] = useState("");
  const [priorityDateRange, setPriorityDateRange] = useState<DateRangeValue>(null);
  const [priorityStatusFilter, setPriorityStatusFilter] = useState<string[]>([]);
  const [dictionarySearchField, setDictionarySearchField] = useState("name");
  const [dictionaryKeyword, setDictionaryKeyword] = useState("");
  const [dictionaryDateRange, setDictionaryDateRange] = useState<DateRangeValue>(null);
  const [dictionaryStatusFilter, setDictionaryStatusFilter] = useState<string[]>([]);
  if (!data) return <EmptyState text="后台数据加载中" />;
  const accountByPerson = new Map(data.accounts.map((account) => [account.person.id, account]));
  const dictionaryTypes = Array.from(new Set(data.dictionaries.map((item) => item.type))).sort();
  const dictionaries = dictionaryType === "ALL" ? data.dictionaries : data.dictionaries.filter((item) => item.type === dictionaryType);
  const activeDictionaryMeta = dictionaryType === "ALL" ? null : dictionaryTypeMeta[dictionaryType];
  const peopleSearchOptions: Array<TableSearchOption<Person>> = [
    { value: "name", label: "姓名", type: "text", reader: (person) => person.name },
    { value: "employeeNo", label: "员工编号", type: "text", reader: (person) => person.employeeNo },
    { value: "account", label: "登录账号", type: "text", reader: (person) => accountByPerson.get(person.id)?.username },
    { value: "createdAt", label: "创建时间", type: "date", reader: (person) => person.createdAt }
  ];
  const peopleOrganizationOptions = countFilterOptions(data.organizations.map((item) => ({ value: String(item.id), label: item.name })), data.people, (person) => person.organization?.id);
  const peoplePositionOptions = countFilterOptions(data.positions.map((item) => ({ value: item.code, label: item.name })), data.people, (person) => person.primaryPosition?.code);
  const peopleStatusOptions = countFilterOptions(EMPLOYMENT_STATUS_OPTIONS, data.people, (person) => person.employmentStatus);
  const accountStatusOptions = countFilterOptions(ACCOUNT_STATUS_OPTIONS, data.people, (person) => accountByPerson.get(person.id)?.status || "NO_ACCOUNT");
  const allowLoginOptions = countFilterOptions(ALLOW_LOGIN_OPTIONS, data.people, (person) => String(accountByPerson.get(person.id)?.allowLogin ?? "NO_ACCOUNT"));
  const organizationSearchOptions: Array<TableSearchOption<Organization>> = [
    { value: "name", label: "名称", type: "text", reader: (item) => item.name },
    { value: "code", label: "编码", type: "text", reader: (item) => item.code },
    { value: "manager", label: "负责人", type: "text", reader: (item) => data.people.find((person) => person.id === item.managerId)?.name },
    { value: "createdAt", label: "创建时间", type: "date", reader: (item) => item.createdAt }
  ];
  const organizationStatusOptions = countFilterOptions(ORGANIZATION_STATUS_OPTIONS, data.organizations, (item) => item.status);
  const positionSearchOptions: Array<TableSearchOption<Position>> = [
    { value: "name", label: "名称", type: "text", reader: (item) => item.name },
    { value: "code", label: "编码", type: "text", reader: (item) => item.code },
    { value: "createdAt", label: "创建时间", type: "date", reader: (item) => item.createdAt }
  ];
  const positionCategoryOptions = countFilterOptions(uniqueOptions(data.positions, (item) => item.category, (value) => value), data.positions, (item) => item.category);
  const positionStatusOptions = countFilterOptions(ACTIVE_STATUS_OPTIONS, data.positions, (item) => String(item.isActive));
  const prioritySearchOptions: Array<TableSearchOption<any>> = [
    { value: "code", label: "编码", type: "text", reader: (item) => item.code },
    { value: "name", label: "名称", type: "text", reader: (item) => item.name },
    { value: "description", label: "说明", type: "text", reader: (item) => item.description },
    { value: "createdAt", label: "创建时间", type: "date", reader: (item) => item.createdAt }
  ];
  const requirementPriorityStatusOptions = countFilterOptions(ACTIVE_STATUS_OPTIONS, data.requirementPriorities, (item) => String(item.isActive !== false));
  const defectPriorityStatusOptions = countFilterOptions(ACTIVE_STATUS_OPTIONS, data.defectPriorities, (item) => String(item.isActive !== false));
  const dictionarySearchOptions: Array<TableSearchOption<any>> = [
    { value: "code", label: "编码", type: "text", reader: (item) => item.code },
    { value: "name", label: "名称", type: "text", reader: (item) => item.name },
    { value: "usage", label: "使用位置", type: "text", reader: (item) => dictionaryTypeUsage(item.type) },
    { value: "createdAt", label: "创建时间", type: "date", reader: (item) => item.createdAt }
  ];
  const dictionaryStatusOptions = countFilterOptions(ACTIVE_STATUS_OPTIONS, dictionaries, (item) => String(Boolean(item.isActive)));
  const filteredPeople = data.people.filter((person) =>
    matchSearchOption(person, peopleSearchField, peopleKeyword, peopleDateRange, peopleSearchOptions) &&
    inSelected(peopleOrganizationFilter, String(person.organization?.id ?? "")) &&
    inSelected(peoplePositionFilter, person.primaryPosition?.code || "") &&
    inSelected(peopleStatusFilter, person.employmentStatus) &&
    inSelected(accountStatusFilter, accountByPerson.get(person.id)?.status || "NO_ACCOUNT") &&
    inSelected(allowLoginFilter, String(accountByPerson.get(person.id)?.allowLogin ?? "NO_ACCOUNT"))
  );
  const filteredOrganizations = data.organizations.filter((item) =>
    matchSearchOption(item, organizationSearchField, organizationKeyword, organizationDateRange, organizationSearchOptions) &&
    inSelected(organizationStatusFilter, item.status)
  );
  const filteredPositions = data.positions.filter((item) =>
    matchSearchOption(item, positionSearchField, positionKeyword, positionDateRange, positionSearchOptions) &&
    inSelected(positionCategoryFilter, item.category || "") &&
    inSelected(positionStatusFilter, String(item.isActive))
  );
  const filteredRequirementPriorities = data.requirementPriorities.filter((item) =>
    matchSearchOption(item, prioritySearchField, priorityKeyword, priorityDateRange, prioritySearchOptions) &&
    inSelected(priorityStatusFilter, String(item.isActive !== false))
  );
  const filteredDefectPriorities = data.defectPriorities.filter((item) =>
    matchSearchOption(item, prioritySearchField, priorityKeyword, priorityDateRange, prioritySearchOptions) &&
    inSelected(priorityStatusFilter, String(item.isActive !== false))
  );
  const filteredDictionaries = dictionaries.filter((item) =>
    matchSearchOption(item, dictionarySearchField, dictionaryKeyword, dictionaryDateRange, dictionarySearchOptions) &&
    inSelected(dictionaryStatusFilter, String(Boolean(item.isActive)))
  );
  const adminSections = [
    ["people", "人员账号", data.people.length],
    ["org", "组织岗位", data.organizations.length + data.positions.length],
    ["dictionary", "字典配置", data.dictionaries.length],
    ["priority", "优先级规则", data.requirementPriorities.length + data.defectPriorities.length],
    ["logs", "处理记录", data.logs.length]
  ] as const;
  const peopleColumns = [
    { title: "姓名", dataIndex: "name", sorter: compareText<Person>((person) => person.name) },
    { title: "员工编号", sorter: compareText<Person>((person) => person.employeeNo), render: (_: unknown, person: Person) => person.employeeNo || "-" },
    { title: "组织", sorter: compareText<Person>((person) => person.organization?.name), render: (_: unknown, person: Person) => person.organization?.name || "-" },
    { title: "岗位", sorter: compareText<Person>((person) => person.primaryPosition?.name), render: (_: unknown, person: Person) => person.primaryPosition?.name || "-" },
    { title: "登录账号", sorter: compareText<Person>((person) => accountByPerson.get(person.id)?.username), render: (_: unknown, person: Person) => accountByPerson.get(person.id)?.username || "-" },
    { title: "账号状态", render: (_: unknown, person: Person) => {
      const account = accountByPerson.get(person.id);
      return <Tag color={account?.status === "ACTIVE" ? "green" : "default"}>{account ? label(account.status) : "未开通"}</Tag>;
    } },
    { title: "登录", render: (_: unknown, person: Person) => {
      const account = accountByPerson.get(person.id);
      return account ? (account.allowLogin ? "允许" : "禁止") : "-";
    } },
    { title: "创建时间", width: 160, sorter: compareDate<Person>((person) => person.createdAt), render: (_: unknown, person: Person) => fmtDateTime(person.createdAt) },
    { title: "操作", width: 100, fixed: "right" as const, render: (_: unknown, person: Person) => <TableActions><AntButton size="small" onClick={() => onEdit({ kind: "personAccount", item: { ...person, account: accountByPerson.get(person.id) } })}>编辑</AntButton></TableActions> }
  ];
  const organizationColumns = [
    { title: "组织名称", dataIndex: "name", sorter: compareText<Organization>((item) => item.name) },
    { title: "编码", dataIndex: "code", sorter: compareText<Organization>((item) => item.code) },
    { title: "负责人", sorter: compareText<Organization>((item) => data.people.find((person) => person.id === item.managerId)?.name), render: (_: unknown, item: Organization) => data.people.find((person) => person.id === item.managerId)?.name || "-" },
    { title: "状态", sorter: compareText<Organization>((item) => label(item.status)), render: (_: unknown, item: Organization) => <Tag color={item.status === "ACTIVE" ? "green" : "default"}>{label(item.status)}</Tag> },
    { title: "创建时间", width: 160, sorter: compareDate<Organization>((item) => item.createdAt), render: (_: unknown, item: Organization) => fmtDateTime(item.createdAt) },
    { title: "操作", width: 90, fixed: "right" as const, render: (_: unknown, item: Organization) => <TableActions><AntButton size="small" onClick={() => onEdit({ kind: "organization", item })}>编辑</AntButton></TableActions> }
  ];
  const positionColumns = [
    { title: "岗位名称", dataIndex: "name", sorter: compareText<Position>((item) => item.name) },
    { title: "编码", dataIndex: "code", sorter: compareText<Position>((item) => item.code) },
    { title: "状态", sorter: compareText<Position>((item) => (item.isActive ? "启用" : "停用")), render: (_: unknown, item: Position) => <Tag color={item.isActive ? "green" : "default"}>{item.isActive ? "启用" : "停用"}</Tag> },
    { title: "创建时间", width: 160, sorter: compareDate<Position>((item) => item.createdAt), render: (_: unknown, item: Position) => fmtDateTime(item.createdAt) },
    { title: "操作", width: 90, fixed: "right" as const, render: (_: unknown, item: Position) => <TableActions><AntButton size="small" onClick={() => onEdit({ kind: "position", item })}>编辑</AntButton></TableActions> }
  ];
  const requirementPriorityColumns = [
    { title: "编码", dataIndex: "code", sorter: compareText<any>((item) => item.code) },
    { title: "等级", dataIndex: "name", sorter: compareText<any>((item) => item.name) },
    { title: "基础分", dataIndex: "baseScore", sorter: compareNumber<any>((item) => item.baseScore) },
    { title: "缺陷系数", dataIndex: "defectWeight", sorter: compareNumber<any>((item) => item.defectWeight) },
    { title: "状态", render: (_: unknown, item: any) => <Tag color={item.isActive === false ? "default" : "green"}>{item.isActive === false ? "停用" : "启用"}</Tag> },
    { title: "创建时间", width: 160, sorter: compareDate<any>((item) => item.createdAt), render: (_: unknown, item: any) => fmtDateTime(item.createdAt) },
    { title: "操作", width: 90, fixed: "right" as const, render: (_: unknown, item: any) => <TableActions><AntButton size="small" onClick={() => onEdit({ kind: "requirementPriority", item })}>编辑</AntButton></TableActions> }
  ];
  const defectPriorityColumns = [
    { title: "编码", dataIndex: "code", sorter: compareText<any>((item) => item.code) },
    { title: "等级", dataIndex: "name", sorter: compareText<any>((item) => item.name) },
    { title: "线上", dataIndex: "onlineScore", sorter: compareNumber<any>((item) => item.onlineScore) },
    { title: "线下", dataIndex: "offlineScore", sorter: compareNumber<any>((item) => item.offlineScore) },
    { title: "状态", render: (_: unknown, item: any) => <Tag color={item.isActive === false ? "default" : "green"}>{item.isActive === false ? "停用" : "启用"}</Tag> },
    { title: "创建时间", width: 160, sorter: compareDate<any>((item) => item.createdAt), render: (_: unknown, item: any) => fmtDateTime(item.createdAt) },
    { title: "操作", width: 90, fixed: "right" as const, render: (_: unknown, item: any) => <TableActions><AntButton size="small" onClick={() => onEdit({ kind: "defectPriority", item })}>编辑</AntButton></TableActions> }
  ];
  const dictionaryColumns = [
    {
      title: "类型",
      sorter: compareText<any>((item) => dictionaryTypeMeta[item.type]?.name || item.type),
      render: (_: unknown, item: any) => (
        <Space direction="vertical" size={1}>
          <strong>{dictionaryTypeMeta[item.type]?.name || item.type}</strong>
          <span className="muted-line">{item.type}</span>
        </Space>
      )
    },
    { title: "编码", dataIndex: "code", sorter: compareText<any>((item) => item.code) },
    { title: "显示名称", dataIndex: "name", sorter: compareText<any>((item) => item.name) },
    { title: "使用位置", render: (_: unknown, item: any) => <span className="usage-cell">{dictionaryTypeUsage(item.type)}</span> },
    { title: "状态", render: (_: unknown, item: any) => <Tag color={item.isActive ? "green" : "default"}>{item.isActive ? "启用" : "停用"}</Tag> },
    { title: "排序", dataIndex: "sort", width: 80, sorter: compareNumber<any>((item) => item.sort) },
    { title: "创建时间", width: 160, sorter: compareDate<any>((item) => item.createdAt), render: (_: unknown, item: any) => fmtDateTime(item.createdAt) },
    { title: "操作", width: 90, fixed: "right" as const, render: (_: unknown, item: any) => <TableActions><AntButton size="small" onClick={() => onEdit({ kind: "dictionary", item })}>编辑</AntButton></TableActions> }
  ];
  return (
    <section className="page-stack">
      <div className="module-page-head admin-page-head">
        <div>
          <p className="page-kicker">系统配置</p>
          <h1>后台管理</h1>
          <p>维护组织人员、登录账号、字典数据和优先级分值规则。</p>
        </div>
        <div className="page-head-stats">
          <span>人员 <strong>{data.people.length}</strong></span>
          <span>组织 <strong>{data.organizations.length}</strong></span>
          <span>字典项 <strong>{data.dictionaries.length}</strong></span>
        </div>
        <AntButton type="primary" onClick={onNewPerson}><Plus size={16} /> 人员与账号</AntButton>
      </div>
      <div className="project-module-tabs">
        {adminSections.map(([key, text, count]) => (
          <button key={key} type="button" className={activeAdminSection === key ? "active" : ""} onClick={() => setActiveAdminSection(key)}>
            {text}<span>{count}</span>
          </button>
        ))}
      </div>
      {activeAdminSection === "people" ? (
        <Card className="enterprise-card" title="人员与登录账号">
          <Space size={8} wrap style={{ marginBottom: 14 }}>
            <TableSearchControl
              options={peopleSearchOptions}
              field={peopleSearchField}
              keyword={peopleKeyword}
              dateRange={peopleDateRange}
              onFieldChange={setPeopleSearchField}
              onKeywordChange={setPeopleKeyword}
              onDateRangeChange={setPeopleDateRange}
            />
            <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 160 }} placeholder="组织" value={peopleOrganizationFilter} options={peopleOrganizationOptions} onChange={setPeopleOrganizationFilter} />
            <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 160 }} placeholder="岗位" value={peoplePositionFilter} options={peoplePositionOptions} onChange={setPeoplePositionFilter} />
            <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 160 }} placeholder="人员状态" value={peopleStatusFilter} options={peopleStatusOptions} onChange={setPeopleStatusFilter} />
            <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 160 }} placeholder="账号状态" value={accountStatusFilter} options={accountStatusOptions} onChange={setAccountStatusFilter} />
            <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 160 }} placeholder="登录" value={allowLoginFilter} options={allowLoginOptions} onChange={setAllowLoginFilter} />
          </Space>
          <AntTable className="enterprise-table" rowKey="id" columns={peopleColumns} dataSource={filteredPeople} pagination={tablePagination(filteredPeople.length)} scroll={{ x: 1080 }} />
        </Card>
      ) : null}
      {activeAdminSection === "org" ? (
        <section className="config-grid">
          <Card className="enterprise-card" title="组织配置" extra={<AntButton onClick={() => onEdit({ kind: "organization" })}><Plus size={16} /> 组织</AntButton>}>
            <Space size={8} wrap style={{ marginBottom: 14 }}>
              <TableSearchControl
                options={organizationSearchOptions}
                field={organizationSearchField}
                keyword={organizationKeyword}
                dateRange={organizationDateRange}
                onFieldChange={setOrganizationSearchField}
                onKeywordChange={setOrganizationKeyword}
                onDateRangeChange={setOrganizationDateRange}
              />
              <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 160 }} placeholder="组织状态" value={organizationStatusFilter} options={organizationStatusOptions} onChange={setOrganizationStatusFilter} />
            </Space>
            <AntTable className="enterprise-table" rowKey="id" columns={organizationColumns} dataSource={filteredOrganizations} pagination={tablePagination(filteredOrganizations.length)} scroll={{ x: 760 }} />
          </Card>
          <Card className="enterprise-card" title="岗位配置" extra={<AntButton onClick={() => onEdit({ kind: "position" })}><Plus size={16} /> 岗位</AntButton>}>
            <Space size={8} wrap style={{ marginBottom: 14 }}>
              <TableSearchControl
                options={positionSearchOptions}
                field={positionSearchField}
                keyword={positionKeyword}
                dateRange={positionDateRange}
                onFieldChange={setPositionSearchField}
                onKeywordChange={setPositionKeyword}
                onDateRangeChange={setPositionDateRange}
              />
              <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 160 }} placeholder="岗位分类" value={positionCategoryFilter} options={positionCategoryOptions} onChange={setPositionCategoryFilter} />
              <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 160 }} placeholder="岗位状态" value={positionStatusFilter} options={positionStatusOptions} onChange={setPositionStatusFilter} />
            </Space>
            <AntTable className="enterprise-table" rowKey="id" columns={positionColumns} dataSource={filteredPositions} pagination={tablePagination(filteredPositions.length)} scroll={{ x: 680 }} />
          </Card>
        </section>
      ) : null}
      {activeAdminSection === "priority" ? (
        <section className="config-grid">
          <Card className="enterprise-card" title="需求优先级分值" extra={<span className="section-note">需求分 = 基础分 + 时效加分</span>}>
            <Space size={8} wrap style={{ marginBottom: 14 }}>
              <TableSearchControl
                options={prioritySearchOptions}
                field={prioritySearchField}
                keyword={priorityKeyword}
                dateRange={priorityDateRange}
                onFieldChange={setPrioritySearchField}
                onKeywordChange={setPriorityKeyword}
                onDateRangeChange={setPriorityDateRange}
              />
              <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 160 }} placeholder="状态" value={priorityStatusFilter} options={requirementPriorityStatusOptions} onChange={setPriorityStatusFilter} />
            </Space>
            <AntTable className="enterprise-table" rowKey="id" columns={requirementPriorityColumns} dataSource={filteredRequirementPriorities} pagination={tablePagination(filteredRequirementPriorities.length)} scroll={{ x: 840 }} />
          </Card>
          <Card className="enterprise-card" title="缺陷基础分值" extra={<span className="section-note">缺陷分 = 环境基础分 × 需求缺陷系数 + 时效加分</span>}>
            <Space size={8} wrap style={{ marginBottom: 14 }}>
              <TableSearchControl
                options={prioritySearchOptions}
                field={prioritySearchField}
                keyword={priorityKeyword}
                dateRange={priorityDateRange}
                onFieldChange={setPrioritySearchField}
                onKeywordChange={setPriorityKeyword}
                onDateRangeChange={setPriorityDateRange}
              />
              <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 160 }} placeholder="状态" value={priorityStatusFilter} options={defectPriorityStatusOptions} onChange={setPriorityStatusFilter} />
            </Space>
            <AntTable className="enterprise-table" rowKey="id" columns={defectPriorityColumns} dataSource={filteredDefectPriorities} pagination={tablePagination(filteredDefectPriorities.length)} scroll={{ x: 820 }} />
          </Card>
        </section>
      ) : null}
      {activeAdminSection === "dictionary" ? (
        <Card
          className="enterprise-card"
          title={
            <div>
              字典配置
              <p className="section-note">
                字典类型是系统配置分类；编码给系统识别，显示名称给页面展示。
                {activeDictionaryMeta ? ` 当前类型：${activeDictionaryMeta.name}，${activeDictionaryMeta.usage}` : " 选择具体类型可查看它在系统中的使用位置。"}
              </p>
            </div>
          }
          extra={
            <Space size={8} wrap>
              <AntSelect
                style={{ width: 180 }}
                value={dictionaryType}
                options={[{ value: "ALL", label: "全部类型" }, ...dictionaryTypes.map((type) => ({ value: type, label: dictionaryTypeLabel(type) }))]}
                onChange={setDictionaryType}
              />
              <AntButton onClick={() => onEdit({ kind: "dictionary" })}><Plus size={16} /> 字典</AntButton>
            </Space>
          }
        >
          <Space size={8} wrap style={{ marginBottom: 14 }}>
            <TableSearchControl
              options={dictionarySearchOptions}
              field={dictionarySearchField}
              keyword={dictionaryKeyword}
              dateRange={dictionaryDateRange}
              onFieldChange={setDictionarySearchField}
              onKeywordChange={setDictionaryKeyword}
              onDateRangeChange={setDictionaryDateRange}
            />
            <AntSelect mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 160 }} placeholder="状态" value={dictionaryStatusFilter} options={dictionaryStatusOptions} onChange={setDictionaryStatusFilter} />
          </Space>
          <AntTable className="enterprise-table" rowKey="id" columns={dictionaryColumns} dataSource={filteredDictionaries} pagination={tablePagination(filteredDictionaries.length)} scroll={{ x: 1160 }} />
        </Card>
      ) : null}
      {activeAdminSection === "logs" ? <RecentLogs logs={data.logs} /> : null}
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
              <Select searchable name="organizationId" label="所属组织" defaultValue={draftValue(draft, "organizationId", item.organizationId)} options={[["", "未指定"], ...data.organizations.map((org) => [String(org.id), `${org.name}（${org.code}）`] as [string, string])]} />
              <Select searchable name="primaryPositionCode" label="主岗位" defaultValue={draftValue(draft, "primaryPositionCode", item.primaryPosition?.code)} options={data.positions.filter((position) => position.isActive !== false).map((position) => [position.code, `${position.name}（${position.code}）`] as [string, string])} />
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
              <Select searchable name="parentId" label="上级组织" defaultValue={draftValue(draft, "parentId", item.parentId)} options={[["", "无上级"], ...data.organizations.filter((org) => org.id !== item.id).map((org) => [String(org.id), `${org.name}（${org.code}）`] as [string, string])]} />
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
              <Field name="offlineScore" label="线下基础分" type="number" required defaultValue={draftValue(draft, "offlineScore", item.offlineScore)} />
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
  title = "需求开发",
  showProjectColumn = true,
  toolbar,
  extra,
  tasks,
  onView,
  onEdit,
  onStart,
  onComplete,
  onStartTest,
  onPassTest,
  onClose,
  onNewDefect,
  canTest,
  isProjectClosed,
  currentPersonId,
  canCreateDefect: canCreateDefectByPosition
}: {
  title?: string;
  showProjectColumn?: boolean;
  toolbar?: ReactNode;
  extra?: ReactNode;
  tasks: DevTask[];
  onView?: (task: DevTask) => void;
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
  currentPersonId?: number;
  canCreateDefect?: boolean;
}) {
  const [searchField, setSearchField] = useState("title");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchDateRange, setSearchDateRange] = useState<DateRangeValue>(null);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const canPassTask = (task: DevTask) => !task.defects?.some((defect) => !["VERIFIED", "CLOSED"].includes(defect.status));
  const taskHasAssignee = (task: DevTask) => hasAssignedPerson(task);
  const taskHasTester = (task: DevTask) => hasAssignedTester(task);
  const canCreateDefect = (task: DevTask) => !isProjectClosed && taskHasAssignee(task) && ["TESTING", "TEST_PASSED"].includes(task.status);
  const canOperateTask = (task: DevTask) => isAssignedToPerson(task, currentPersonId);
  const canEditTaskSchedule = (task: DevTask) => TASK_OWNER_EDITABLE_STATUSES.includes(task.status);
  const defectButtonTitle = (task: DevTask) => {
    if (isProjectClosed) return "项目已结项，不能新增缺陷";
    if (!taskHasAssignee(task)) return "任务负责人为空，不能创建缺陷";
    if (task.status === "TEST_PASSED") return "创建缺陷后，任务会退回测试中";
    return canCreateDefect(task) ? "创建缺陷" : "只有测试中或测试通过的任务可以创建缺陷";
  };
  const typeOptions = countFilterOptions(
    mergeOptions(TASK_TYPE_OPTIONS, uniqueOptions(tasks, (task) => task.type)),
    tasks,
    (task) => task.type
  );
  const statusOptions = countFilterOptions(TASK_STATUS_OPTIONS, tasks, (task) => task.status);
  const searchOptions: Array<TableSearchOption<DevTask>> = [
    { value: "code", label: "编号", type: "text", reader: (task) => task.code },
    { value: "title", label: "名称", type: "text", reader: (task) => task.title },
    { value: "project", label: "项目", type: "text", reader: (task) => task.project?.name },
    { value: "requirement", label: "关联需求", type: "text", reader: (task) => task.requirement?.title },
    { value: "assignee", label: "负责人", type: "text", reader: (task) => task.assignee?.name },
    { value: "tester", label: "测试负责人", type: "text", reader: (task) => task.tester?.name },
    { value: "creator", label: "创建人", type: "text", reader: (task) => task.creator?.name },
    { value: "plannedStartDate", label: "计划开始", type: "date", reader: (task) => task.plannedStartDate },
    { value: "plannedFinishDate", label: "计划完成", type: "date", reader: (task) => task.plannedFinishDate },
    { value: "createdAt", label: "创建时间", type: "date", reader: (task) => task.createdAt }
  ];
  const filteredTasks = tasks.filter((task) =>
    matchSearchOption(task, searchField, searchKeyword, searchDateRange, searchOptions) &&
    inSelected(statusFilter, task.status) &&
    inSelected(typeFilter, task.type)
  );
  const columns = [
    {
      title: "任务",
      dataIndex: "title",
      width: 240,
      sorter: compareText<DevTask>((task) => task.title),
      render: (_: unknown, task: DevTask) => (
        <Space direction="vertical" size={1}>
          <strong>{task.title}</strong>
          <span className="muted-line">{task.code} · {label(task.type)}</span>
        </Space>
      )
    },
    ...(showProjectColumn ? [{ title: "项目", dataIndex: ["project", "name"], width: 170, sorter: compareText<DevTask>((task) => task.project?.name), render: (_: unknown, task: DevTask) => task.project?.name || "-" }] : []),
    { title: "需求", dataIndex: ["requirement", "title"], width: 190, sorter: compareText<DevTask>((task) => task.requirement?.title), render: (_: unknown, task: DevTask) => task.requirement?.title || "-" },
    { title: "负责人", width: 110, sorter: compareText<DevTask>((task) => task.assignee?.name), render: (_: unknown, task: DevTask) => task.assignee?.name || "-" },
    { title: "测试负责人", width: 120, sorter: compareText<DevTask>((task) => task.tester?.name), render: (_: unknown, task: DevTask) => task.tester?.name || "-" },
    { title: "状态", width: 110, sorter: compareText<DevTask>((task) => label(task.status)), render: (_: unknown, task: DevTask) => <Tag color={taskStatusColor(task.status)}>{label(task.status)}</Tag> },
    { title: "排期", width: 190, sorter: compareDate<DevTask>((task) => task.plannedFinishDate), render: (_: unknown, task: DevTask) => `${fmtDate(task.plannedStartDate)} - ${fmtDate(task.plannedFinishDate)}` },
    { title: "优先级分数", width: 120, dataIndex: "priorityScore", sorter: compareNumber<DevTask>((task) => task.priorityScore) },
    { title: "创建人", width: 110, sorter: compareText<DevTask>((task) => task.creator?.name), render: (_: unknown, task: DevTask) => task.creator?.name || "-" },
    { title: "创建时间", width: 160, sorter: compareDate<DevTask>((task) => task.createdAt), render: (_: unknown, task: DevTask) => fmtDateTime(task.createdAt) },
    {
      title: "操作",
      width: 210,
      fixed: "right" as const,
      render: (_: unknown, task: DevTask) => (
        <TableActions>
          {onView ? <AntButton size="small" onClick={() => onView(task)}>详情</AntButton> : null}
          {onEdit && canOperateTask(task) ? <AntButton size="small" disabled={!canEditTaskSchedule(task)} title={canEditTaskSchedule(task) ? "调整排期" : "只有待处理或处理中的任务可以调整排期"} onClick={() => onEdit(task)}>排期</AntButton> : null}
          {canCreateDefectByPosition && onNewDefect ? (
            <AntButton size="small" disabled={!canCreateDefect(task)} title={defectButtonTitle(task)} onClick={() => onNewDefect(task)}>
              缺陷
            </AntButton>
          ) : null}
          {onStart && canOperateTask(task) ? <AntButton size="small" type="primary" disabled={task.status !== "TODO"} title={task.status === "TODO" ? "开始处理" : "只有待处理任务可以开始处理"} onClick={() => onStart(task)}>开始处理</AntButton> : null}
          {onComplete && canOperateTask(task) ? <AntButton size="small" type="primary" disabled={task.status !== "DOING"} title={task.status === "DOING" ? "处理完成" : "只有处理中的任务可以处理完成"} onClick={() => onComplete(task)}>处理完成</AntButton> : null}
          {canTest && taskHasTester(task) && onStartTest ? <AntButton size="small" type="primary" disabled={task.status !== "TO_TEST"} title={task.status === "TO_TEST" ? "开始测试" : "只有待测试任务可以开始测试"} onClick={() => onStartTest(task)}>开始测试</AntButton> : null}
          {canTest && taskHasTester(task) && onPassTest ? (
            <AntButton size="small" type="primary" disabled={task.status !== "TESTING" || !canPassTask(task)} title={task.status !== "TESTING" ? "只有测试中的任务可以测试通过" : canPassTask(task) ? "测试通过" : "任务下仍有未验证或未关闭的缺陷"} onClick={() => onPassTest(task)}>
              测试通过
            </AntButton>
          ) : null}
          {onClose && canOperateTask(task) ? <AntButton size="small" disabled={!canEditTaskSchedule(task)} title={canEditTaskSchedule(task) ? "关闭任务" : "只有待处理或处理中的任务可以手动关闭"} onClick={() => onClose(task)}>关闭</AntButton> : null}
        </TableActions>
      )
    }
  ];
  return (
    <Card className="enterprise-card" title={title} extra={extra}>
      {toolbar}
      <Space size={8} wrap style={{ marginBottom: 14 }}>
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
          style={{ minWidth: 180 }}
          placeholder="任务状态"
          value={statusFilter}
          options={statusOptions}
          onChange={setStatusFilter}
        />
        <AntSelect
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          style={{ minWidth: 180 }}
          placeholder="任务类型"
          value={typeFilter}
          options={typeOptions}
          onChange={setTypeFilter}
        />
      </Space>
      <AntTable
        className="enterprise-table"
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={filteredTasks}
        pagination={tablePagination(filteredTasks.length)}
        scroll={{ x: showProjectColumn ? 1690 : 1520 }}
        locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无需求开发任务" /> }}
      />
    </Card>
  );
}

function DefectTable({
  title = "缺陷修复",
  defects,
  onView,
  onEdit,
  onStartFix,
  onComplete,
  canVerify,
  onVerify,
  onReject,
  onClose,
  onReopen,
  currentPersonId
}: {
  title?: string;
  defects: Defect[];
  onView?: (defect: Defect) => void;
  onEdit?: (defect: Defect) => void;
  onStartFix?: (defect: Defect) => void;
  onComplete?: (defect: Defect) => void;
  canVerify?: boolean;
  onVerify?: (defect: Defect) => void;
  onReject?: (defect: Defect) => void;
  onClose?: (defect: Defect) => void;
  onReopen?: (defect: Defect) => void;
  currentPersonId?: number;
}) {
  const [searchField, setSearchField] = useState("title");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchDateRange, setSearchDateRange] = useState<DateRangeValue>(null);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [levelFilter, setLevelFilter] = useState<string[]>([]);
  const [environmentFilter, setEnvironmentFilter] = useState<string[]>([]);
  const canStartFix = (defect: Defect) => defect.status === "TO_FIX";
  const canCompleteFix = (defect: Defect) => defect.status === "FIXING";
  const canEditDefectSchedule = (defect: Defect) => DEFECT_OWNER_EDITABLE_STATUSES.includes(defect.status);
  const canCloseDefect = (defect: Defect) => DEFECT_OWNER_EDITABLE_STATUSES.includes(defect.status);
  const canOperateDefect = (defect: Defect) => isAssignedToPerson(defect, currentPersonId);
  const canQualityOperateDefect = (defect: Defect) => Boolean(canVerify && hasAssignedTester(defect));
  const statusOptions = countFilterOptions(DEFECT_STATUS_OPTIONS, defects, (defect) => defect.status);
  const levelOptions = countFilterOptions(DEFECT_LEVEL_OPTIONS, defects, (defect) => defect.level);
  const environmentOptions = countFilterOptions(DEFECT_ENVIRONMENT_OPTIONS, defects, (defect) => defect.environment);
  const searchOptions: Array<TableSearchOption<Defect>> = [
    { value: "code", label: "编号", type: "text", reader: (defect) => defect.code },
    { value: "title", label: "名称", type: "text", reader: (defect) => defect.title },
    { value: "project", label: "项目", type: "text", reader: (defect) => defect.project?.name },
    { value: "requirement", label: "关联需求", type: "text", reader: (defect) => defect.task?.requirement?.title || defect.requirement?.title },
    { value: "task", label: "关联任务", type: "text", reader: (defect) => defect.task?.title },
    { value: "assignee", label: "负责人", type: "text", reader: (defect) => defect.assignee?.name },
    { value: "tester", label: "测试负责人", type: "text", reader: (defect) => defect.tester?.name },
    { value: "reporter", label: "创建人", type: "text", reader: (defect) => defect.reporter?.name },
    { value: "plannedStartDate", label: "计划开始", type: "date", reader: (defect) => defect.plannedStartDate || defect.plannedFixDate },
    { value: "plannedFinishDate", label: "计划完成", type: "date", reader: (defect) => defect.plannedFinishDate || defect.plannedFixDate },
    { value: "createdAt", label: "创建时间", type: "date", reader: (defect) => defect.createdAt }
  ];
  const filteredDefects = defects.filter((defect) =>
    matchSearchOption(defect, searchField, searchKeyword, searchDateRange, searchOptions) &&
    inSelected(statusFilter, defect.status) &&
    inSelected(levelFilter, defect.level) &&
    inSelected(environmentFilter, defect.environment)
  );
  const columns = [
    {
      title: "缺陷",
      dataIndex: "title",
      width: 240,
      sorter: compareText<Defect>((defect) => defect.title),
      render: (_: unknown, defect: Defect) => (
        <Space direction="vertical" size={1}>
          <strong>{defect.title}</strong>
          <span className="muted-line">{defect.code} · {defectLevelLabel(defect.level)}</span>
        </Space>
      )
    },
    { title: "项目", width: 170, sorter: compareText<Defect>((defect) => defect.project?.name), render: (_: unknown, defect: Defect) => defect.project?.name || "-" },
    { title: "关联需求", width: 180, sorter: compareText<Defect>((defect) => defect.task?.requirement?.title || defect.requirement?.title), render: (_: unknown, defect: Defect) => defect.task?.requirement?.title || defect.requirement?.title || "-" },
    { title: "关联任务", width: 180, sorter: compareText<Defect>((defect) => defect.task?.title), render: (_: unknown, defect: Defect) => defect.task?.title || "-" },
    { title: "负责人", width: 110, sorter: compareText<Defect>((defect) => defect.assignee?.name), render: (_: unknown, defect: Defect) => defect.assignee?.name || "-" },
    { title: "测试负责人", width: 120, sorter: compareText<Defect>((defect) => defect.tester?.name), render: (_: unknown, defect: Defect) => defect.tester?.name || "-" },
    { title: "状态", width: 110, sorter: compareText<Defect>((defect) => label(defect.status)), render: (_: unknown, defect: Defect) => <Tag color={defectStatusColor(defect.status)}>{label(defect.status)}</Tag> },
    { title: "排期", width: 190, sorter: compareDate<Defect>((defect) => defect.plannedFinishDate || defect.plannedFixDate), render: (_: unknown, defect: Defect) => `${fmtDate(defect.plannedStartDate || defect.plannedFixDate)} - ${fmtDate(defect.plannedFinishDate || defect.plannedFixDate)}` },
    { title: "环境", width: 90, sorter: compareText<Defect>((defect) => defectEnvironmentLabel(defect.environment)), render: (_: unknown, defect: Defect) => defectEnvironmentLabel(defect.environment) },
    { title: "优先级分数", width: 120, dataIndex: "priorityScore", sorter: compareNumber<Defect>((defect) => defect.priorityScore) },
    { title: "创建人", width: 110, sorter: compareText<Defect>((defect) => defect.reporter?.name), render: (_: unknown, defect: Defect) => defect.reporter?.name || "-" },
    { title: "创建时间", width: 160, sorter: compareDate<Defect>((defect) => defect.createdAt), render: (_: unknown, defect: Defect) => fmtDateTime(defect.createdAt) },
    {
      title: "操作",
      width: 210,
      fixed: "right" as const,
      render: (_: unknown, defect: Defect) => (
        <TableActions>
          {onView ? <AntButton size="small" onClick={() => onView(defect)}>查看</AntButton> : null}
          {onEdit && canOperateDefect(defect) ? <AntButton size="small" disabled={!canEditDefectSchedule(defect)} title={canEditDefectSchedule(defect) ? "调整排期" : "只有待修复或修复中的缺陷可以调整排期"} onClick={() => onEdit(defect)}>排期</AntButton> : null}
          {onStartFix && canOperateDefect(defect) ? <AntButton size="small" type="primary" disabled={!canStartFix(defect)} title={canStartFix(defect) ? "开始修复" : "只有待修复缺陷可以开始修复"} onClick={() => onStartFix(defect)}>开始修复</AntButton> : null}
          {onComplete && canOperateDefect(defect) ? <AntButton size="small" type="primary" disabled={!canCompleteFix(defect)} title={canCompleteFix(defect) ? "已修复" : "只有修复中的缺陷可以标记已修复"} onClick={() => onComplete(defect)}>已修复</AntButton> : null}
          {canQualityOperateDefect(defect) && onVerify ? <AntButton size="small" type="primary" disabled={defect.status !== "FIXED"} title={defect.status === "FIXED" ? "验证通过" : "只有已修复缺陷可以验证通过"} onClick={() => onVerify(defect)}>验证通过</AntButton> : null}
          {canQualityOperateDefect(defect) && onReject ? <AntButton size="small" disabled={defect.status !== "FIXED"} title={defect.status === "FIXED" ? "验证未通过" : "只有已修复缺陷可以验证未通过"} onClick={() => onReject(defect)}>验证未通过</AntButton> : null}
          {canQualityOperateDefect(defect) && onClose ? <AntButton size="small" disabled={!canCloseDefect(defect)} title={canCloseDefect(defect) ? "关闭缺陷" : "只有待修复或修复中的缺陷可以关闭"} onClick={() => onClose(defect)}>关闭</AntButton> : null}
          {canQualityOperateDefect(defect) && onReopen ? <AntButton size="small" disabled={defect.status !== "CLOSED"} title={defect.status === "CLOSED" ? "开启缺陷" : "只有已关闭缺陷可以开启"} onClick={() => onReopen(defect)}>开启</AntButton> : null}
        </TableActions>
      )
    }
  ];
  return (
    <Card className="enterprise-card" title={title}>
      <Space size={8} wrap style={{ marginBottom: 14 }}>
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
          style={{ minWidth: 180 }}
          placeholder="缺陷状态"
          value={statusFilter}
          options={statusOptions}
          onChange={setStatusFilter}
        />
        <AntSelect
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          style={{ minWidth: 180 }}
          placeholder="缺陷等级"
          value={levelFilter}
          options={levelOptions}
          onChange={setLevelFilter}
        />
        <AntSelect
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          style={{ minWidth: 180 }}
          placeholder="发现环境"
          value={environmentFilter}
          options={environmentOptions}
          onChange={setEnvironmentFilter}
        />
      </Space>
      <AntTable
        className="enterprise-table"
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={filteredDefects}
        pagination={tablePagination(filteredDefects.length)}
        scroll={{ x: 1890 }}
        locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无缺陷修复任务" /> }}
      />
    </Card>
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
                <TableActions>
                  {canReview(item) ? <button className="compact primary" onClick={() => onReview(item)}>评审</button> : null}
                  <button className="compact" disabled={!canCreateTask(item)} title={taskButtonTitle(item)} onClick={() => onNewTask(item)}>
                    <Plus size={15} /> 任务
                  </button>
                  {isProductManager && canOperateRequirement(item) ? <button className="compact" onClick={() => onRevision(item, "CHANGE")}>变更</button> : null}
                  {isProductManager && canOperateRequirement(item) ? <button className="compact" onClick={() => onRevision(item, "OPTIMIZATION")}>优化</button> : null}
                </TableActions>
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

function RequirementAcceptanceDialog({
  requirement,
  tasks,
  onClose,
  onSubmit
}: {
  requirement: Requirement | null;
  tasks: DevTask[];
  onClose: () => void;
  onSubmit: (requirement: Requirement, body: any) => Promise<boolean>;
}) {
  const draftKey = requirement ? `${FORM_DRAFT_PREFIX}:requirement-acceptance:${requirement.id}` : "";
  const draft = requirement ? readFormDraft(draftKey) : null;
  const draftRestored = hasDraftValues(draft);
  const [draftMessage, setDraftMessage] = useState("");
  const [draftStamp, setDraftStamp] = useState(0);
  useEffect(() => {
    setDraftMessage("");
  }, [draftKey]);
  if (!requirement) return null;
  const activeRequirement = requirement;
  const linkedTasks = tasks.filter((task) => task.requirement?.id === requirement.id);
  const hasUiTask = linkedTasks.some((task) => task.type === "UI");

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
    setDraftMessage("草稿已暂存，下次打开这个验收表单会自动带出。");
  }

  function discardDraft() {
    clearFormDraft(draftKey);
    setDraftMessage("草稿已清除。");
    setDraftStamp((value) => value + 1);
  }

  return (
    <AntModal
      className="enterprise-form-modal"
      title="需求验收完成"
      open={Boolean(requirement)}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnHidden
    >
      <form key={`${draftKey}:${draftStamp}`} className="drawer-form modal-form" onSubmit={submit}>
        <ReadonlyField name="requirementTitle" label="需求" value={requirement.title} displayValue={`${requirement.title}（${requirement.code}）`} />
        <div className="form-inline-grid">
          <DisplayField label="需求状态" value={label(requirement.status)} />
          <DisplayField label="关联任务" value={`${linkedTasks.length} 个`} />
          <DisplayField label="测试通过任务" value={`${linkedTasks.filter((task) => task.status === "TEST_PASSED").length} 个`} />
        </div>
        <Textarea name="pmAcceptanceConclusion" label="产品经理验收结论" required defaultValue={draftValue(draft, "pmAcceptanceConclusion", requirement.pmAcceptanceConclusion)} />
        <Textarea name="uiAcceptanceConclusion" label={hasUiTask ? "UI验收结论" : "UI验收结论（无 UI 任务可不填）"} required={hasUiTask} defaultValue={draftValue(draft, "uiAcceptanceConclusion", requirement.uiAcceptanceConclusion)} />
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
            <CheckCircle2 size={18} /> 验收完成
          </button>
        </div>
      </form>
    </AntModal>
  );
}

function TaskCompleteDialog({
  state,
  documentTypeOptions,
  onClose,
  onSubmit
}: {
  state: TaskCompleteState;
  documentTypeOptions: Array<[string, string]>;
  onClose: () => void;
  onSubmit: (task: DevTask, body: any, refreshTarget: RefreshTarget) => Promise<boolean>;
}) {
  const task = state?.task || null;
  const draftKey = task ? `${FORM_DRAFT_PREFIX}:task-complete:${task.id}` : "";
  const draft = task ? readFormDraft(draftKey) : null;
  const draftRestored = hasDraftValues(draft);
  const [draftMessage, setDraftMessage] = useState("");
  const [draftStamp, setDraftStamp] = useState(0);
  useEffect(() => {
    setDraftMessage("");
  }, [draftKey]);
  if (!task || !state) return null;
  const activeTask = task;
  const activeRefreshTarget = state.refreshTarget;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const completionInput = formElement.querySelector<HTMLInputElement>("input[name='completionNote']");
    if (!stripRichText(completionInput?.value || "")) {
      setDraftMessage("开发说明不能为空。");
      completionInput?.closest(".rich-editor-field")?.querySelector<HTMLElement>(".rich-editor")?.focus();
      return;
    }
    const form = new FormData(formElement);
    let body: Record<string, any>;
    try {
      body = await formDataToBody(form, {
        documentAttachmentFile: { urlKey: "documentAttachmentUrl", nameKey: "documentAttachmentFileName" }
      });
    } catch (err: any) {
      setDraftMessage(err.message || "附件读取失败");
      return;
    }
    Object.keys(body).forEach((key) => {
      if (key.endsWith("__required")) delete body[key];
    });
    const success = await onSubmit(activeTask, body, activeRefreshTarget);
    if (success) clearFormDraft(draftKey);
  }

  function saveDraft(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form) return;
    writeFormDraft(draftKey, form);
    setDraftMessage("草稿已暂存，下次打开这个开发完成表单会自动带出。");
  }

  function discardDraft() {
    clearFormDraft(draftKey);
    setDraftMessage("草稿已清除。");
    setDraftStamp((value) => value + 1);
  }

  return (
    <AntModal
      className="enterprise-form-modal"
      title="提交开发完成"
      open={Boolean(task)}
      onCancel={onClose}
      footer={null}
      width={820}
      destroyOnHidden
    >
      <form key={`${draftKey}:${draftStamp}`} className="drawer-form modal-form" onSubmit={submit}>
        <ReadonlyField name="taskTitle" label="开发任务" value={activeTask.title} displayValue={`${activeTask.title}（${activeTask.code}）`} />
        <div className="form-inline-grid">
          <DisplayField label="所属项目" value={activeTask.project?.name || "-"} />
          <DisplayField label="关联需求" value={activeTask.requirement?.title || "-"} />
          <DisplayField label="负责人" value={activeTask.assignee?.name || "-"} />
          <DisplayField label="优先级分数" value={activeTask.priorityScore} />
        </div>
        <RichTextEditor name="completionNote" label="开发说明" required defaultValue={draftValue(draft, "completionNote", activeTask.completionNote)} />
        <div className="form-section-box">
          <div>
            <strong>开发资料</strong>
            <span>可同步归档设计说明、接口文档、联调记录等资料，并关联到该开发任务。</span>
          </div>
          <Field name="documentName" label="资料名称" defaultValue={draftValue(draft, "documentName")} />
          <Select name="documentType" label="资料类型" options={documentTypeOptions} defaultValue={draftValue(draft, "documentType", "TECH")} />
          <RichTextEditor name="documentDescription" label="资料描述" defaultValue={draftValue(draft, "documentDescription")} />
          <FileField name="documentAttachmentFile" label="上传附件" />
        </div>
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
    </AntModal>
  );
}

function closeDetailOnBackdrop(event: MouseEvent<HTMLDivElement>, onClose: () => void) {
  if (event.target === event.currentTarget) onClose();
}

function RequirementDetailDialog({ requirement, tasks, defects, onClose }: { requirement: Requirement | null; tasks: DevTask[]; defects: Defect[]; onClose: () => void }) {
  if (!requirement) return null;
  const documents = requirement.documents || [];
  const linkedTasks = tasks.filter((task) => task.requirement?.id === requirement.id);
  const linkedDefects = defects.filter((defect) => defect.task?.requirement?.id === requirement.id || defect.requirement?.id === requirement.id);
  const taskColumns: ColumnsType<DevTask> = [
    { title: "任务", dataIndex: "title", render: (_: unknown, task: DevTask) => <Space direction="vertical" size={1}><strong>{task.title}</strong><span className="muted-line">{task.code} · {label(task.type)}</span></Space> },
    { title: "负责人", width: 110, render: (_: unknown, task: DevTask) => task.assignee?.name || "-" },
    { title: "状态", width: 110, render: (_: unknown, task: DevTask) => <Tag color={taskStatusColor(task.status)}>{label(task.status)}</Tag> },
    { title: "排期", width: 190, render: (_: unknown, task: DevTask) => `${fmtDate(task.plannedStartDate)} - ${fmtDate(task.plannedFinishDate)}` },
    { title: "优先级分数", width: 110, dataIndex: "priorityScore" }
  ];
  const defectColumns: ColumnsType<Defect> = [
    { title: "缺陷", dataIndex: "title", render: (_: unknown, defect: Defect) => <Space direction="vertical" size={1}><strong>{defect.title}</strong><span className="muted-line">{defect.code} · {defectLevelLabel(defect.level)}</span></Space> },
    { title: "关联任务", width: 160, render: (_: unknown, defect: Defect) => defect.task?.title || "-" },
    { title: "负责人", width: 110, render: (_: unknown, defect: Defect) => defect.assignee?.name || "-" },
    { title: "状态", width: 110, render: (_: unknown, defect: Defect) => <Tag color={defectStatusColor(defect.status)}>{label(defect.status)}</Tag> },
    { title: "优先级分数", width: 110, dataIndex: "priorityScore" }
  ];
  return (
    <div className="detail-drawer-backdrop" onMouseDown={(event) => closeDetailOnBackdrop(event, onClose)}>
      <aside className="detail-drawer-panel">
        <div className="section-title">
          <div>
            <h2>需求详情</h2>
            <span className="section-note">{requirement.code} · {requirement.title}</span>
          </div>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="defect-detail">
          <section>
            <h3>基础信息</h3>
            <div className="detail-grid">
              <DetailItem label="需求类型" value={label(requirement.type)} />
              <DetailItem label="需求性质" value={requirement.priorityLevel} />
              <DetailItem label="需求状态" value={label(requirement.status)} />
              <DetailItem label="上线状态" value={label(requirement.launchStatus || "TO_RELEASE")} />
              <DetailItem label="优先级分数" value={requirement.priorityScore} />
              <DetailItem label="所属项目" value={requirement.project?.name} />
              <DetailItem label="提交人" value={requirement.submitter?.name} />
              <DetailItem label="创建时间" value={fmtDateTime(requirement.createdAt)} />
              <DetailItem label="期望上线" value={fmtDate(requirement.expectedLaunchDate)} />
              <DetailItem label="任务数量" value={(requirement as any)._count?.tasks ?? "-"} />
              <DetailItem label="时效加分" value={requirement.timingBonus ?? 0} />
            </div>
          </section>
          <section>
            <h3>需求内容</h3>
            <DetailRich label="需求描述" value={requirement.description} />
            <DetailRich label="验收标准" value={requirement.acceptanceCriteria} />
            <DetailRich label="时效加分原因" value={requirement.timingBonusReason} />
          </section>
          <section>
            <h3>评审信息</h3>
            <div className="detail-grid">
              <DetailItem label="评审日期" value={fmtDate(requirement.reviewDate)} />
              <DetailItem label="评审结论" value={requirement.reviewConclusion ? label(requirement.reviewConclusion) : "-"} />
            </div>
            <DetailRich label="评审记录" value={requirement.reviewRecord} />
          </section>
          <section>
            <h3>验收信息</h3>
            <div className="detail-grid">
              <DetailItem label="产品经理验收人" value={requirement.pmAcceptor?.name} />
              <DetailItem label="产品经理验收时间" value={fmtDateTime(requirement.pmAcceptedAt)} />
              <DetailItem label="UI验收人" value={requirement.uiAcceptor?.name} />
              <DetailItem label="UI验收时间" value={fmtDateTime(requirement.uiAcceptedAt)} />
            </div>
            <DetailRich label="产品经理验收结论" value={requirement.pmAcceptanceConclusion} />
            <DetailRich label="UI验收结论" value={requirement.uiAcceptanceConclusion} />
          </section>
          <section>
            <h3>关联资料</h3>
            {documents.length ? (
              <div className="document-link-list">
                {documents.map((item) => {
                  const doc = item.document;
                  return (
                    <div key={doc.id} className="document-link-item">
                      <div>
                        <strong>{doc.name}</strong>
                        <span>{label(doc.type)}</span>
                      </div>
                      <RichTextDisplay value={doc.description} />
                      {doc.attachmentUrl ? <a href={doc.attachmentUrl} target="_blank" rel="noreferrer">打开附件</a> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState text="暂无关联资料" />
            )}
          </section>
          <section>
            <h3>关联事项</h3>
            <AntTabs
              className="detail-tabs"
              items={[
                {
                  key: "tasks",
                  label: `关联任务 ${linkedTasks.length}`,
                  children: (
                    <AntTable
                      className="enterprise-table"
                      rowKey="id"
                      size="small"
                      columns={taskColumns}
                      dataSource={linkedTasks}
                      pagination={linkedTasks.length > 5 ? { pageSize: 5, showSizeChanger: false } : false}
                      scroll={{ x: 760 }}
                      locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无关联任务" /> }}
                    />
                  )
                },
                {
                  key: "defects",
                  label: `关联缺陷 ${linkedDefects.length}`,
                  children: (
                    <AntTable
                      className="enterprise-table"
                      rowKey="id"
                      size="small"
                      columns={defectColumns}
                      dataSource={linkedDefects}
                      pagination={linkedDefects.length > 5 ? { pageSize: 5, showSizeChanger: false } : false}
                      scroll={{ x: 760 }}
                      locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无关联缺陷" /> }}
                    />
                  )
                }
              ]}
            />
          </section>
        </div>
      </aside>
    </div>
  );
}

function TaskDetailDialog({ task, onClose }: { task: DevTask | null; onClose: () => void }) {
  if (!task) return null;
  const documents = task.documents || [];
  const defects = task.defects || [];
  return (
    <div className="detail-drawer-backdrop" onMouseDown={(event) => closeDetailOnBackdrop(event, onClose)}>
      <aside className="detail-drawer-panel">
        <div className="section-title">
          <div>
            <h2>开发详情</h2>
            <span className="section-note">{task.code} · {task.title}</span>
          </div>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="defect-detail">
          <section>
            <h3>基础信息</h3>
            <div className="detail-grid">
              <DetailItem label="任务类型" value={label(task.type)} />
              <DetailItem label="任务状态" value={label(task.status)} />
              <DetailItem label="优先级分数" value={task.priorityScore} />
              <DetailItem label="所属项目" value={task.project?.name} />
              <DetailItem label="关联需求" value={task.requirement?.title} />
              <DetailItem label="负责人" value={task.assignee?.name} />
              <DetailItem label="测试负责人" value={task.tester?.name} />
              <DetailItem label="创建人" value={task.creator?.name} />
              <DetailItem label="创建时间" value={fmtDateTime(task.createdAt)} />
            </div>
          </section>
          <section>
            <h3>排期与执行</h3>
            <div className="detail-grid">
              <DetailItem label="计划开始时间" value={fmtDate(task.plannedStartDate)} />
              <DetailItem label="计划完成时间" value={fmtDate(task.plannedFinishDate)} />
              <DetailItem label="实际开始时间" value={fmtDateTime(task.actualStartDate)} />
              <DetailItem label="实际完成时间" value={fmtDateTime(task.actualFinishDate)} />
            </div>
            <DetailRich label="开发说明" value={task.completionNote} />
          </section>
          <section>
            <h3>关联资料</h3>
            {documents.length ? (
              <div className="document-link-list">
                {documents.map((item) => {
                  const doc = item.document;
                  return (
                    <div key={doc.id} className="document-link-item">
                      <div>
                        <strong>{doc.name}</strong>
                        <span>{label(doc.type)} · {doc.createdBy?.name || "未知归档人"} · {fmtDateTime(doc.createdAt)}</span>
                      </div>
                      <RichTextDisplay value={doc.description} />
                      {doc.attachmentUrl ? <a href={doc.attachmentUrl} target="_blank" rel="noreferrer">打开附件</a> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState text="暂无关联资料" />
            )}
          </section>
          <section>
            <h3>缺陷概况</h3>
            {defects.length ? (
              <div className="detail-simple-list">
                {defects.map((defect) => (
                  <div key={defect.id} className="detail-simple-item">
                    <strong>{defect.title}</strong>
                    <span>{defect.code} · {defectLevelLabel(defect.level)} · {label(defect.status)} · 分数 {defect.priorityScore}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="暂无缺陷记录" />
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function DefectDetailDialog({ defect, onClose }: { defect: Defect | null; onClose: () => void }) {
  if (!defect) return null;
  const requirement = defect.task?.requirement || defect.requirement;
  return (
    <div className="detail-drawer-backdrop" onMouseDown={(event) => closeDetailOnBackdrop(event, onClose)}>
      <aside className="detail-drawer-panel">
        <div className="section-title">
          <div>
            <h2>缺陷详情</h2>
            <span className="section-note">{defect.code} · {defect.title}</span>
          </div>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="defect-detail">
          <section>
            <h3>归属与状态</h3>
            <div className="detail-grid">
              <DetailItem label="缺陷等级" value={defectLevelLabel(defect.level)} />
              <DetailItem label="缺陷状态" value={label(defect.status)} />
              <DetailItem label="发现环境" value={defectEnvironmentLabel(defect.environment)} />
              <DetailItem label="优先级分数" value={defect.priorityScore} />
              <DetailItem label="所属项目" value={defect.project?.name} />
              <DetailItem label="关联需求" value={requirement?.title} />
              <DetailItem label="关联任务" value={defect.task?.title} />
              <DetailItem label="负责人" value={defect.assignee?.name} />
              <DetailItem label="测试负责人" value={defect.tester?.name} />
              <DetailItem label="提交人" value={defect.reporter?.name} />
              <DetailItem label="创建时间" value={fmtDateTime(defect.createdAt)} />
              <DetailItem label="发现版本" value={defect.version?.name} />
              <DetailItem label="发现时间" value={fmtDate(defect.foundAt || undefined)} />
            </div>
          </section>
          <section>
            <h3>排期与执行</h3>
            <div className="detail-grid">
              <DetailItem label="计划开始时间" value={fmtDate(defect.plannedStartDate || defect.plannedFixDate || undefined)} />
              <DetailItem label="计划完成时间" value={fmtDate(defect.plannedFinishDate || defect.plannedFixDate || undefined)} />
              <DetailItem label="实际开始修复时间" value={fmtDateTime(defect.actualStartDate || undefined)} />
              <DetailItem label="实际完成修复时间" value={fmtDateTime(defect.actualFixDate || undefined)} />
            </div>
          </section>
          <section>
            <h3>现象与影响</h3>
            <DetailItem label="发现入口" value={defect.entryPoint} />
            <DetailRich label="缺陷描述" value={defect.description} />
            <DetailRich label="影响范围" value={defect.impactScope} />
          </section>
          <section>
            <h3>复现与定位</h3>
            <DetailRich label="前置条件" value={defect.precondition} />
            <DetailRich label="复现步骤" value={defect.reproduceSteps} />
            <DetailRich label="实际结果" value={defect.actualResult} />
            <DetailRich label="期望结果" value={defect.expectedResult} />
          </section>
          <section>
            <h3>环境与附件</h3>
            <DetailRich label="设备/浏览器/客户端版本" value={defect.deviceInfo} />
            <DetailRich label="测试账号/样例数据" value={defect.testData} />
            <DetailRich label="附件链接" value={defect.attachmentUrl} />
          </section>
        </div>
      </aside>
    </div>
  );
}

function DetailItem({ label: text, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="detail-item">
      <span>{text}</span>
      <strong>{value === undefined || value === null || value === "" ? "-" : value}</strong>
    </div>
  );
}

function DetailRich({ label: text, value }: { label: string; value?: string | null }) {
  const content = value || "";
  return (
    <div className="detail-rich">
      <span>{text}</span>
      {stripRichText(content) ? <RichTextDisplay value={content} /> : <strong>-</strong>}
    </div>
  );
}

function personPrimaryPositionCode(person?: Person | null) {
  return person?.primaryPosition?.code || person?.positions?.find((item) => item.isPrimary)?.position.code || person?.positions?.[0]?.position.code || "";
}

function personPrimaryPositionName(person?: Person | null) {
  return person?.primaryPosition?.name || person?.positions?.find((item) => item.isPrimary)?.position.name || person?.positions?.[0]?.position.name || "";
}

function personHasPositionCode(person: Person | undefined | null, codes: string[]) {
  if (!person) return false;
  return Boolean(
    (person.primaryPosition?.code && codes.includes(person.primaryPosition.code)) ||
    person.positions?.some((item) => codes.includes(item.position.code))
  );
}

function defectEnvironmentLabel(environment?: string | null) {
  if (!environment) return "-";
  const value = environment.toUpperCase();
  if (value === "ONLINE") return "线上";
  if (value === "OFFLINE") return "线下";
  if (["TEST", "DEV", "GRAY"].includes(value)) return "线下";
  return environment;
}

function defectLevelLabel(level?: string | null) {
  const map: Record<string, string> = {
    L1: "阻塞",
    L2: "严重",
    L3: "一般",
    L4: "次要"
  };
  return level ? map[level] || label(level) : "-";
}

type FileFormMapping = Record<string, { urlKey: string; nameKey?: string }>;

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取附件失败"));
    reader.readAsDataURL(file);
  });
}

async function formDataToBody(form: FormData, fileMappings: FileFormMapping = {}) {
  const body: Record<string, any> = {};
  for (const [name, value] of form.entries()) {
    if (value instanceof File) {
      if (!value.name || value.size === 0) continue;
      if (value.size > 8 * 1024 * 1024) {
        throw new Error("单个附件不能超过 8MB");
      }
      const mapping = fileMappings[name];
      const fileUrl = await fileToDataUrl(value);
      body[mapping?.urlKey || name] = fileUrl;
      if (mapping?.nameKey) body[mapping.nameKey] = value.name;
      continue;
    }
    const existing = body[name];
    if (existing === undefined) {
      body[name] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      body[name] = [existing, value];
    }
  }
  return body;
}

function requirementStatusColor(status?: string | null) {
  const map: Record<string, string> = {
    TO_REVIEW: "orange",
    APPROVED: "green",
    REJECTED: "red",
    NEEDS_SUPPLEMENT: "gold",
    DEFERRED: "default",
    DEVELOPING: "blue",
    COMPLETED: "cyan",
    CHANGE: "purple",
    OPTIMIZATION: "purple",
    CANCELED: "default"
  };
  return status ? map[status] || "default" : "default";
}

function taskStatusColor(status?: string | null) {
  const map: Record<string, string> = {
    TODO: "default",
    DOING: "blue",
    TO_TEST: "gold",
    TESTING: "orange",
    TEST_PASSED: "green",
    CLOSED: "default"
  };
  return status ? map[status] || "default" : "default";
}

function defectStatusColor(status?: string | null) {
  const map: Record<string, string> = {
    TO_FIX: "red",
    FIXING: "orange",
    FIXED: "gold",
    VERIFIED: "green",
    CLOSED: "default",
    REOPENED: "purple"
  };
  return status ? map[status] || "default" : "default";
}

function priorityRank(score?: number | null, tasks: DevTask[] = [], defects: Defect[] = []) {
  if (score === undefined || score === null) return "-";
  const existingScores = [...tasks.map((task) => task.priorityScore || 0), ...defects.map((defect) => defect.priorityScore || 0)];
  const rank = existingScores.filter((itemScore) => itemScore > score).length + 1;
  return `第 ${rank} / ${existingScores.length + 1} 项`;
}

const DEFAULT_REQUIREMENT_BASE_SCORES: Record<string, number> = {
  P0: 40,
  P1: 30,
  P2: 20,
  P3: 10,
  P4: 0
};

const DEFAULT_REQUIREMENT_DEFECT_WEIGHTS: Record<string, number> = {
  P0: 1.2,
  P1: 1.15,
  P2: 1.1,
  P3: 1.03,
  P4: 1
};

const DEFAULT_DEFECT_SCORES: Record<string, { online: number; offline: number }> = {
  L1: { online: 60, offline: 40 },
  L2: { online: 45, offline: 30 },
  L3: { online: 25, offline: 15 },
  L4: { online: 10, offline: 5 }
};

const REVISION_BONUS: Record<string, Record<string, number>> = {
  CHANGE: { TO_RELEASE: 6, RELEASED: 15 },
  OPTIMIZATION: { TO_RELEASE: 3, RELEASED: 6 }
};

function numericInput(value?: string | number | null) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatScore(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function getRequirementBaseScore(priorityLevel: string, priorities: AdminData["requirementPriorities"]) {
  return priorities.find((item) => item.code === priorityLevel)?.baseScore ?? DEFAULT_REQUIREMENT_BASE_SCORES[priorityLevel] ?? 0;
}

function getRequirementDefectWeight(priorityLevel: string, priorities: AdminData["requirementPriorities"]) {
  return priorities.find((item) => item.code === priorityLevel)?.defectWeight ?? DEFAULT_REQUIREMENT_DEFECT_WEIGHTS[priorityLevel] ?? 1;
}

function getDefectBaseScore(level: string, environment: "ONLINE" | "OFFLINE", priorities: AdminData["defectPriorities"]) {
  const priority = priorities.find((item) => item.code === level);
  if (priority) return environment === "ONLINE" ? priority.onlineScore : priority.offlineScore;
  const fallback = DEFAULT_DEFECT_SCORES[level] || DEFAULT_DEFECT_SCORES.L3;
  return environment === "ONLINE" ? fallback.online : fallback.offline;
}

function PriorityScorePreview({ score, formula }: { score: number; formula: string }) {
  return (
    <div className="priority-preview">
      <span>优先级总分</span>
      <strong>{formatScore(score)}</strong>
      <p>{formula}</p>
    </div>
  );
}

function TimingBonusFields({
  value,
  onChange,
  defaultReason
}: {
  value: string;
  onChange: (value: string) => void;
  defaultReason?: string | number | null;
}) {
  return (
    <div className="timing-bonus-panel">
      <Field name="timingBonus" label="时效加分" type="number" value={value} onChange={onChange} />
      <Textarea name="timingBonusReason" label="加分原因" defaultValue={defaultReason} />
    </div>
  );
}

function VersionRequirementSelector({
  name,
  label: text,
  items,
  selectedIds,
  onChange
}: {
  name: string;
  label: string;
  items: Requirement[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [draftIds, setDraftIds] = useState<number[]>(selectedIds);
  const itemIds = new Set(items.map((item) => item.id));
  const safeSelectedIds = selectedIds.filter((id) => itemIds.has(id));
  const selectedItems = items.filter((item) => safeSelectedIds.includes(item.id));
  const filteredItems = items.filter((item) => {
    const textMatch = `${item.title} ${item.code} ${item.priorityLevel}`.toLowerCase().includes(query.trim().toLowerCase());
    return textMatch && inSelected(statusFilter, item.status);
  });
  const columns: ColumnsType<Requirement> = [
    {
      title: "需求",
      dataIndex: "title",
      sorter: compareText<Requirement>((item) => item.title),
      render: (_: unknown, item: Requirement) => (
        <Space direction="vertical" size={1}>
          <strong>{item.title}</strong>
          <span className="muted-line">{item.code} · {label(item.type)} · {item.priorityLevel}</span>
        </Space>
      )
    },
    { title: "需求状态", width: 120, sorter: compareText<Requirement>((item) => label(item.status)), render: (_: unknown, item: Requirement) => <Tag color={requirementStatusColor(item.status)}>{label(item.status)}</Tag> },
    { title: "上线状态", width: 110, sorter: compareText<Requirement>((item) => label(item.launchStatus || "TO_RELEASE")), render: (_: unknown, item: Requirement) => <Tag>{label(item.launchStatus || "TO_RELEASE")}</Tag> },
    { title: "优先级分数", width: 120, dataIndex: "priorityScore", sorter: compareNumber<Requirement>((item) => item.priorityScore) },
    { title: "期望上线", width: 120, sorter: compareDate<Requirement>((item) => item.expectedLaunchDate), render: (_: unknown, item: Requirement) => fmtDate(item.expectedLaunchDate) }
  ];

  function openSelector() {
    setDraftIds(safeSelectedIds);
    setOpen(true);
  }

  function confirmSelection() {
    onChange(draftIds.filter((id) => itemIds.has(id)));
    setOpen(false);
  }

  return (
    <div className="field version-scope-field">
      <span className="field-label">{text}</span>
      {safeSelectedIds.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
      <div className="version-scope-summary">
        <div>
          <strong>{safeSelectedIds.length ? `已选 ${safeSelectedIds.length} 个需求` : "未选择上线需求"}</strong>
          <span>仅可选择当前项目下已完成且待上线的需求</span>
        </div>
        <AntButton onClick={openSelector}>选择需求</AntButton>
      </div>
      {selectedItems.length ? (
        <div className="selected-chip-list">
          {selectedItems.slice(0, 4).map((item) => <Tag key={item.id} color="blue">{item.title}</Tag>)}
          {selectedItems.length > 4 ? <Tag>+{selectedItems.length - 4}</Tag> : null}
        </div>
      ) : null}
      <AntModal
        title="选择上线需求"
        open={open}
        width={980}
        onCancel={() => setOpen(false)}
        onOk={confirmSelection}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
      >
        <div className="selector-toolbar">
          <AntInput allowClear placeholder="搜索需求标题、编号、性质" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          <AntSelect
            mode="multiple"
            allowClear
            placeholder="需求状态"
            value={statusFilter}
            options={[{ value: "COMPLETED", label: "已完成" }]}
            onChange={setStatusFilter}
          />
          <span className="selector-rule">可选范围：已完成 + 待上线</span>
        </div>
        <AntTable
          className="enterprise-table"
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={filteredItems}
          rowSelection={{
            selectedRowKeys: draftIds,
            preserveSelectedRowKeys: true,
            onChange: (keys) => setDraftIds(keys.map(Number))
          }}
          pagination={{ pageSize: 8, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          scroll={{ x: 760 }}
          locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无可选需求" /> }}
          onRow={(record) => ({
            onClick: (event) => {
              const target = event.target as HTMLElement;
              if (target.closest(".ant-checkbox-wrapper")) return;
              setDraftIds((ids) => ids.includes(record.id) ? ids.filter((id) => id !== record.id) : [...ids, record.id]);
            }
          })}
        />
      </AntModal>
    </div>
  );
}

function VersionDefectSelector({
  name,
  label: text,
  items,
  selectedIds,
  onChange
}: {
  name: string;
  label: string;
  items: Defect[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [draftIds, setDraftIds] = useState<number[]>(selectedIds);
  const itemIds = new Set(items.map((item) => item.id));
  const safeSelectedIds = selectedIds.filter((id) => itemIds.has(id));
  const selectedItems = items.filter((item) => safeSelectedIds.includes(item.id));
  const filteredItems = items.filter((item) => {
    const textMatch = `${item.title} ${item.code} ${item.task?.title || ""} ${item.task?.requirement?.title || item.requirement?.title || ""}`.toLowerCase().includes(query.trim().toLowerCase());
    return textMatch && inSelected(statusFilter, item.status);
  });
  const columns: ColumnsType<Defect> = [
    {
      title: "缺陷",
      dataIndex: "title",
      sorter: compareText<Defect>((item) => item.title),
      render: (_: unknown, item: Defect) => (
        <Space direction="vertical" size={1}>
          <strong>{item.title}</strong>
          <span className="muted-line">{item.code} · {defectLevelLabel(item.level)}</span>
        </Space>
      )
    },
    { title: "状态", width: 110, sorter: compareText<Defect>((item) => label(item.status)), render: (_: unknown, item: Defect) => <Tag color={defectStatusColor(item.status)}>{label(item.status)}</Tag> },
    { title: "关联需求", width: 180, sorter: compareText<Defect>((item) => item.task?.requirement?.title || item.requirement?.title), render: (_: unknown, item: Defect) => item.task?.requirement?.title || item.requirement?.title || "-" },
    { title: "关联任务", width: 180, sorter: compareText<Defect>((item) => item.task?.title), render: (_: unknown, item: Defect) => item.task?.title || "-" },
    { title: "负责人", width: 110, sorter: compareText<Defect>((item) => item.assignee?.name), render: (_: unknown, item: Defect) => item.assignee?.name || "-" },
    { title: "优先级分数", width: 120, dataIndex: "priorityScore", sorter: compareNumber<Defect>((item) => item.priorityScore) }
  ];

  function openSelector() {
    setDraftIds(safeSelectedIds);
    setOpen(true);
  }

  function confirmSelection() {
    onChange(draftIds.filter((id) => itemIds.has(id)));
    setOpen(false);
  }

  return (
    <div className="field version-scope-field">
      <span className="field-label">{text}</span>
      {safeSelectedIds.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
      <div className="version-scope-summary">
        <div>
          <strong>{safeSelectedIds.length ? `已选 ${safeSelectedIds.length} 个缺陷` : "未选择修复缺陷"}</strong>
          <span>仅可选择当前项目下已验证或已关闭的缺陷</span>
        </div>
        <AntButton onClick={openSelector}>选择缺陷</AntButton>
      </div>
      {selectedItems.length ? (
        <div className="selected-chip-list">
          {selectedItems.slice(0, 4).map((item) => <Tag key={item.id} color="orange">{item.title}</Tag>)}
          {selectedItems.length > 4 ? <Tag>+{selectedItems.length - 4}</Tag> : null}
        </div>
      ) : null}
      <AntModal
        title="选择修复缺陷"
        open={open}
        width={1080}
        onCancel={() => setOpen(false)}
        onOk={confirmSelection}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
      >
        <div className="selector-toolbar">
          <AntInput allowClear placeholder="搜索缺陷标题、编号、关联任务、关联需求" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          <AntSelect
            mode="multiple"
            allowClear
            placeholder="缺陷状态"
            value={statusFilter}
            options={[{ value: "VERIFIED", label: "已验证" }, { value: "CLOSED", label: "已关闭" }]}
            onChange={setStatusFilter}
          />
          <span className="selector-rule">可选范围：已验证 / 已关闭</span>
        </div>
        <AntTable
          className="enterprise-table"
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={filteredItems}
          rowSelection={{
            selectedRowKeys: draftIds,
            preserveSelectedRowKeys: true,
            onChange: (keys) => setDraftIds(keys.map(Number))
          }}
          pagination={{ pageSize: 8, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          scroll={{ x: 920 }}
          locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无可选缺陷" /> }}
          onRow={(record) => ({
            onClick: (event) => {
              const target = event.target as HTMLElement;
              if (target.closest(".ant-checkbox-wrapper")) return;
              setDraftIds((ids) => ids.includes(record.id) ? ids.filter((id) => id !== record.id) : [...ids, record.id]);
            }
          })}
        />
      </AntModal>
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
  onSaveScheduleChanges,
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
  onSaveScheduleChanges: (changes: ScheduleChange[]) => Promise<boolean>;
  onSubmit: (kind: Exclude<DrawerKind, null>, body: any) => Promise<boolean>;
}) {
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
  const sourceRequirementForDraft = context.requirementId ? requirements.find((requirement) => requirement.id === context.requirementId) : undefined;
  const [draftMessage, setDraftMessage] = useState("");
  const [draftStamp, setDraftStamp] = useState(0);
  const [versionProjectId, setVersionProjectId] = useState("");
  const [versionRequirementIds, setVersionRequirementIds] = useState<number[]>([]);
  const [versionDefectIds, setVersionDefectIds] = useState<number[]>([]);
  const [taskAssigneeId, setTaskAssigneeId] = useState(String(currentPersonId || ""));
  const [taskTitle, setTaskTitle] = useState(String(draftValue(draft, "title", "") || ""));
  const [taskPlannedStartDate, setTaskPlannedStartDate] = useState(String(draftValue(draft, "plannedStartDate", todayDateInput()) || todayDateInput()));
  const [taskPlannedFinishDate, setTaskPlannedFinishDate] = useState(String(draftValue(draft, "plannedFinishDate", "") || ""));
  const [requirementPriorityLevel, setRequirementPriorityLevel] = useState(String(draftValue(draft, "priorityLevel", sourceRequirementForDraft?.priorityLevel || "P2") || "P2"));
  const [requirementTimingBonus, setRequirementTimingBonus] = useState(String(draftValue(draft, "timingBonus", "") ?? ""));
  const [requirementLaunchStatus, setRequirementLaunchStatus] = useState(String(draftValue(draft, "launchStatus", "TO_RELEASE") || "TO_RELEASE"));
  const [defectTaskId, setDefectTaskId] = useState(String(draftValue(draft, "taskId", context.taskId || "") || ""));
  const [defectTesterId, setDefectTesterId] = useState(String(draftValue(draft, "testerId", currentPersonId) || currentPersonId || ""));
  const [defectLevel, setDefectLevel] = useState(String(draftValue(draft, "level", "L3") || "L3"));
  const [defectTimingBonus, setDefectTimingBonus] = useState(String(draftValue(draft, "timingBonus", "") ?? ""));
  const [scheduleViewOpen, setScheduleViewOpen] = useState(false);
  const openProjectFallbackId = projects.find((project) => project.stage !== "CLOSED")?.id || "";
  useEffect(() => {
    setDraftMessage("");
  }, [draftKey]);
  useEffect(() => {
    if (kind === "version") {
      setVersionProjectId(String(draftValue(draft, "projectId", openProjectFallbackId) || ""));
      setVersionRequirementIds(draftArray(draft, "requirementIds").map(Number).filter(Boolean));
      setVersionDefectIds(draftArray(draft, "defectIds").map(Number).filter(Boolean));
    }
  }, [kind, draftKey, openProjectFallbackId]);
  useEffect(() => {
    if (kind === "task") {
      setTaskAssigneeId(String(draftValue(draft, "assigneeId", currentPersonId) || ""));
      setTaskTitle(String(draftValue(draft, "title", "") || ""));
      setTaskPlannedStartDate(String(draftValue(draft, "plannedStartDate", todayDateInput()) || todayDateInput()));
      setTaskPlannedFinishDate(String(draftValue(draft, "plannedFinishDate", "") || ""));
    }
  }, [kind, draftKey, currentPersonId]);
  useEffect(() => {
    if (kind === "requirement") {
      setRequirementPriorityLevel(String(draftValue(draft, "priorityLevel", sourceRequirementForDraft?.priorityLevel || "P2") || "P2"));
      setRequirementTimingBonus(String(draftValue(draft, "timingBonus", "") ?? ""));
      setRequirementLaunchStatus(String(draftValue(draft, "launchStatus", "TO_RELEASE") || "TO_RELEASE"));
    }
  }, [kind, draftKey, sourceRequirementForDraft?.priorityLevel]);
  useEffect(() => {
    if (kind === "defect") {
      setDefectTaskId(String(draftValue(draft, "taskId", context.taskId || "") || ""));
      setDefectTesterId(String(draftValue(draft, "testerId", currentPersonId) || currentPersonId || ""));
      setDefectLevel(String(draftValue(draft, "level", "L3") || "L3"));
      setDefectTimingBonus(String(draftValue(draft, "timingBonus", "") ?? ""));
    }
  }, [kind, draftKey, context.taskId]);
  useEffect(() => {
    if (kind !== "task") setScheduleViewOpen(false);
  }, [kind]);
  if (!activeKind) return null;
  const activeDrawerKind = activeKind;
  const selectedProject = context.projectId ? projects.find((project) => project.id === context.projectId) : null;
  const editingProject = context.editProjectId ? projects.find((project) => project.id === context.editProjectId) : null;
  const selectedTask = activeDrawerKind === "defect"
    ? tasks.find((task) => task.id === Number(defectTaskId))
    : context.taskId
      ? tasks.find((task) => task.id === context.taskId)
      : null;
  const selectedRequirement = context.requirementId
    ? requirements.find((requirement) => requirement.id === context.requirementId)
    : selectedTask?.requirement || null;
  const defectEnvironment = selectedRequirement?.launchStatus === "RELEASED" ? "ONLINE" : "OFFLINE";
  const contextProject = editingProject || selectedProject || selectedTask?.project || selectedRequirement?.project || (selectedRequirement?.projectId ? projects.find((project) => project.id === selectedRequirement.projectId) : null);
  const openProjects = projects.filter((project) => project.stage !== "CLOSED");
  const openProjectIds = new Set(openProjects.map((project) => project.id));
  const selectableProjects = activeDrawerKind === "document" ? projects : openProjects;
  const selectableTaskRequirements = requirements.filter((item) => openProjectIds.has(item.projectId) && ["APPROVED", "DEVELOPING"].includes(item.status));
  const selectableDefectTasks = tasks.filter((item) => {
    const projectId = item.project?.id || item.requirement?.projectId;
    return Boolean(projectId && openProjectIds.has(projectId) && hasAssignedPerson(item) && ["TESTING", "TEST_PASSED"].includes(item.status));
  });
  const selectedVersionProjectId = Number(versionProjectId || openProjectFallbackId || 0);
  const selectableVersionRequirements = requirements.filter((item) => item.projectId === selectedVersionProjectId && openProjectIds.has(item.projectId) && item.status === "COMPLETED" && (item.launchStatus || "TO_RELEASE") === "TO_RELEASE");
  const selectableVersionDefects = defects.filter((item) => {
    const projectId = item.project?.id || item.task?.project?.id || item.task?.requirement?.projectId;
    return Boolean(projectId && projectId === selectedVersionProjectId && openProjectIds.has(projectId) && ["VERIFIED", "CLOSED"].includes(item.status));
  });
  const productManagers = people.filter(isProductManagerPerson);
  const testPeople = people.filter((person) => personHasPositionCode(person, ["TEST"]));
  const qualityPeople = people.filter((person) => personHasPositionCode(person, QUALITY_POSITIONS));
  const defaultProjectOwnerId = editingProject?.ownerId || editingProject?.owner?.id || (isProductManagerPerson(currentPerson) ? currentPersonId : productManagers[0]?.id);
  const requirementTypeOptions = dictionaryOptions(dictionaries, "REQUIREMENT_TYPE", [["FEATURE", "功能需求"], ["PROCESS", "流程需求"], ["DATA", "数据需求"], ["REPORT", "报表需求"], ["UX", "体验优化"], ["NON_FUNCTIONAL", "非功能需求"]]);
  const requirementLaunchStatusOptions = dictionaryOptions(dictionaries, "REQUIREMENT_LAUNCH_STATUS", [["TO_RELEASE", "待上线"], ["RELEASED", "已上线"]]);
  const versionTypeOptions = dictionaryOptions(dictionaries, "VERSION_TYPE", [["NORMAL", "常规版本"], ["HOTFIX", "紧急修复"], ["GRAY", "灰度版本"]]);
  const documentTypeOptions = dictionaryOptions(dictionaries, "DOCUMENT_TYPE", [["BUSINESS", "业务资料"], ["TECH", "技术资料"], ["TEST", "测试资料"], ["RELEASE", "上线资料"]]);
  const taskAssigneeNumberId = Number(taskAssigneeId);
  const selectedTaskAssignee = people.find((person) => person.id === taskAssigneeNumberId);
  const taskTypeCode = personPrimaryPositionCode(selectedTaskAssignee) || "";
  const taskTypeName = selectedTaskAssignee ? personPrimaryPositionName(selectedTaskAssignee) || "负责人未配置岗位" : "请选择负责人";
  const assigneeTasks = tasks
    .filter((task) => (task.assigneeId ?? task.assignee?.id) === taskAssigneeNumberId)
    .sort((left, right) => (right.priorityScore || 0) - (left.priorityScore || 0));
  const assigneeDefects = defects
    .filter((defect) => (defect.assigneeId ?? defect.assignee?.id) === taskAssigneeNumberId)
    .sort((left, right) => (right.priorityScore || 0) - (left.priorityScore || 0));
  const selectedRequirementPriorityRank = priorityRank(selectedRequirement?.priorityScore, assigneeTasks, assigneeDefects);
  const requirementBaseScore = getRequirementBaseScore(requirementPriorityLevel, requirementPriorities);
  const requirementRevisionBonus = context.revisionMode ? REVISION_BONUS[context.revisionMode]?.[requirementLaunchStatus] ?? 0 : 0;
  const requirementTimingScore = numericInput(requirementTimingBonus);
  const requirementPreviewScore = requirementBaseScore + requirementRevisionBonus + requirementTimingScore;
  const requirementFormula = `需求优先级总分 = ${formatScore(requirementBaseScore)}（需求性质基础分） + ${formatScore(requirementRevisionBonus)}（变更/优化场景加分） + ${formatScore(requirementTimingScore)}（时效加分） = ${formatScore(requirementPreviewScore)}`;
  const defectBaseScore = getDefectBaseScore(defectLevel, defectEnvironment, defectPriorities);
  const defectRequirementWeight = getRequirementDefectWeight(selectedRequirement?.priorityLevel || "P4", requirementPriorities);
  const defectTimingScore = numericInput(defectTimingBonus);
  const defectPreviewScore = defectBaseScore * defectRequirementWeight + defectTimingScore;
  const defectFormula = `缺陷优先级总分 = ${formatScore(defectBaseScore)}（系统自动选择的缺陷基础分） × ${formatScore(defectRequirementWeight)}（关联需求缺陷系数） + ${formatScore(defectTimingScore)}（时效加分） = ${formatScore(defectPreviewScore)}`;
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
    let body: Record<string, any>;
    try {
      body = await formDataToBody(form, {
        attachmentFile: { urlKey: "attachmentUrl", nameKey: "attachmentFileName" },
        documentAttachmentFile: { urlKey: "documentAttachmentUrl", nameKey: "documentAttachmentFileName" }
      });
    } catch (err: any) {
      setDraftMessage(err.message || "附件读取失败");
      return;
    }
    const missingRequiredSelect = Object.keys(body).find((key) => {
      if (!key.endsWith("__required")) return false;
      const fieldName = key.slice(0, -"__required".length);
      return body[key] && !String(body[fieldName] ?? "").trim();
    });
    if (missingRequiredSelect) {
      setDraftMessage(`${body[missingRequiredSelect]}不能为空。`);
      return;
    }
    if (activeDrawerKind === "task") {
      if (!selectedTaskAssignee) {
        setDraftMessage("任务负责人必填。");
        return;
      }
      if (!taskTypeCode) {
        setDraftMessage("负责人未配置岗位，不能创建开发任务。请先在人员管理中维护岗位。");
        return;
      }
    }
    if (activeDrawerKind === "defect") {
      const inheritedAssigneeId = selectedTask?.assigneeId || selectedTask?.assignee?.id;
      if (!inheritedAssigneeId) {
        setDraftMessage("关联任务负责人为空，不能创建缺陷。请先为该任务指定负责人。");
        return;
      }
    }
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
    if (activeDrawerKind === "version") {
      setVersionProjectId(String(openProjectFallbackId || ""));
      setVersionRequirementIds([]);
      setVersionDefectIds([]);
    }
    if (activeDrawerKind === "task") {
      setTaskAssigneeId(String(currentPersonId || ""));
      setTaskTitle("");
      setTaskPlannedStartDate(todayDateInput());
      setTaskPlannedFinishDate("");
    }
    setDraftMessage("草稿已清除。");
    setDraftStamp((value) => value + 1);
  }

  function changeVersionProject(projectId: string) {
    setVersionProjectId(projectId);
    setVersionRequirementIds([]);
    setVersionDefectIds([]);
  }

  return (
    <>
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
                <Select name="launchStatus" label="上线状态" options={requirementLaunchStatusOptions} value={requirementLaunchStatus} onChange={setRequirementLaunchStatus} />
              ) : null}
              <Field name="title" label="需求标题" required defaultValue={draftValue(draft, "title")} />
              <Select name="type" label="需求类型" options={requirementTypeOptions} defaultValue={draftValue(draft, "type")} />
              <Select name="priorityLevel" label="需求性质" value={requirementPriorityLevel} onChange={setRequirementPriorityLevel} options={(requirementPriorities.length ? requirementPriorities.filter((item) => item.isActive !== false).map((item) => [item.code, item.name] as [string, string]) : [["P0", "P0"], ["P1", "P1"], ["P2", "P2"], ["P3", "P3"], ["P4", "P4"]])} />
              <TimingBonusFields value={requirementTimingBonus} onChange={setRequirementTimingBonus} defaultReason={draftValue(draft, "timingBonusReason")} />
              <PriorityScorePreview score={requirementPreviewScore} formula={requirementFormula} />
              <RichTextEditor name="description" label="需求描述" required defaultValue={draftValue(draft, "description")} />
              <RichTextEditor name="acceptanceCriteria" label="验收标准" required defaultValue={draftValue(draft, "acceptanceCriteria")} />
              <div className="form-section-box">
                <div>
                  <strong>关联资料</strong>
                  <span>可在创建需求时同步归档一份资料，并自动关联到该需求。</span>
                </div>
                <Field name="documentName" label="资料名称" defaultValue={draftValue(draft, "documentName")} />
                <Select name="documentType" label="资料类型" options={documentTypeOptions} defaultValue={draftValue(draft, "documentType", "BUSINESS")} />
                <RichTextEditor name="documentDescription" label="资料描述" defaultValue={draftValue(draft, "documentDescription")} />
                <FileField name="documentAttachmentFile" label="上传附件" />
              </div>
            </>
          ) : null}
          {activeDrawerKind === "task" ? (
            <>
              {selectedRequirement ? (
                <>
                  {contextProject ? <ReadonlyField name="projectId" label="所属项目" value={contextProject.id} displayValue={`${contextProject.name}（${contextProject.code}）`} /> : null}
                  <ReadonlyField name="requirementId" label="关联需求" value={selectedRequirement.id} displayValue={`${selectedRequirement.title}（${selectedRequirement.code}）`} />
                  <div className="form-inline-grid">
                    <DisplayField label="需求优先级分数" value={selectedRequirement.priorityScore} />
                    <DisplayField label="优先级排序" value={selectedRequirementPriorityRank} />
                  </div>
                </>
              ) : (
                <Select searchable name="requirementId" label="关联需求" options={selectableTaskRequirements.map((item) => [String(item.id), `${item.title}（${item.code}）`])} defaultValue={draftValue(draft, "requirementId")} />
              )}
              <Field name="title" label="任务标题" required value={taskTitle} onChange={setTaskTitle} />
              <Select searchable required name="assigneeId" label="负责人" options={people.map((person) => [String(person.id), `${person.name}${person.employeeNo ? `（${person.employeeNo}）` : ""}`])} value={taskAssigneeId} onChange={setTaskAssigneeId} />
              <Select searchable required name="testerId" label="测试负责人" options={[["", "请选择测试负责人"], ...testPeople.map((person) => [String(person.id), `${person.name}${person.employeeNo ? `（${person.employeeNo}）` : ""}`] as [string, string])]} defaultValue={draftValue(draft, "testerId")} />
              <ReadonlyField name="type" label="任务类型（由负责人岗位带出）" value={taskTypeCode} displayValue={taskTypeName} />
              <div className="schedule-action-row">
                <button type="button" onClick={() => setScheduleViewOpen(true)} disabled={!selectedTaskAssignee}>
                  <CalendarDays size={18} /> 查看排期情况
                </button>
                <span>{selectedTaskAssignee ? `查看${selectedTaskAssignee.name}全部开发任务和缺陷修复排期` : "请选择负责人后查看排期情况"}</span>
              </div>
              <Field name="plannedStartDate" label="计划开始时间" type="date" value={taskPlannedStartDate} onChange={setTaskPlannedStartDate} />
              <Field name="plannedFinishDate" label="计划完成时间" type="date" value={taskPlannedFinishDate} onChange={setTaskPlannedFinishDate} />
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
                <Select searchable name="taskId" label="关联任务" required value={defectTaskId} onChange={setDefectTaskId} options={[["", "请选择任务"], ...selectableDefectTasks.map((item) => [String(item.id), `${item.title}（${item.code}） / ${item.requirement?.title || "-"}`] as [string, string])]} />
              )}
              <Field name="title" label="缺陷标题" required defaultValue={draftValue(draft, "title")} />
              <Select searchable required name="testerId" label="测试负责人" value={defectTesterId} onChange={setDefectTesterId} options={qualityPeople.map((person) => [String(person.id), `${person.name}${person.employeeNo ? `（${person.employeeNo}）` : ""}`] as [string, string])} />
              <Select name="level" label="缺陷等级" value={defectLevel} onChange={setDefectLevel} options={(defectPriorities.length ? defectPriorities.filter((item) => item.isActive !== false).map((item) => [item.code, item.name] as [string, string]) : [["L1", "阻塞"], ["L2", "严重"], ["L3", "一般"], ["L4", "次要"]])} />
              <Field name="foundAt" label="发现时间" type="date" defaultValue={draftValue(draft, "foundAt", todayDateInput())} />
              <TimingBonusFields value={defectTimingBonus} onChange={setDefectTimingBonus} defaultReason={draftValue(draft, "timingBonusReason")} />
              <PriorityScorePreview score={defectPreviewScore} formula={defectFormula} />
              <Field name="entryPoint" label="发现入口/页面/接口" defaultValue={draftValue(draft, "entryPoint")} />
              <RichTextEditor name="description" label="缺陷描述" required defaultValue={draftValue(draft, "description")} />
              <Textarea name="impactScope" label="影响范围" defaultValue={draftValue(draft, "impactScope")} />
              <Textarea name="precondition" label="前置条件" defaultValue={draftValue(draft, "precondition")} />
              <Textarea name="reproduceSteps" label="复现步骤" defaultValue={draftValue(draft, "reproduceSteps")} />
              <Textarea name="actualResult" label="实际结果" defaultValue={draftValue(draft, "actualResult")} />
              <Textarea name="expectedResult" label="期望结果" defaultValue={draftValue(draft, "expectedResult")} />
              <Textarea name="deviceInfo" label="设备/浏览器/客户端版本" defaultValue={draftValue(draft, "deviceInfo")} />
              <Textarea name="testData" label="测试账号/样例数据" defaultValue={draftValue(draft, "testData")} />
              <Field name="attachmentUrl" label="附件链接" defaultValue={draftValue(draft, "attachmentUrl")} />
            </>
          ) : null}
          {activeDrawerKind === "version" ? (
            <>
              <Select searchable name="projectId" label="所属项目" options={selectableProjects.map((project) => [String(project.id), `${project.name}（${project.code}）`])} value={versionProjectId} onChange={changeVersionProject} />
              <Field name="name" label="版本名称" required defaultValue={draftValue(draft, "name")} />
              <Select name="type" label="版本类型" options={versionTypeOptions} defaultValue={draftValue(draft, "type")} />
              <Field name="plannedReleaseAt" label="计划发版时间" type="date" defaultValue={draftValue(draft, "plannedReleaseAt")} />
              <VersionRequirementSelector name="requirementIds" label="上线需求" items={selectableVersionRequirements} selectedIds={versionRequirementIds} onChange={setVersionRequirementIds} />
              <VersionDefectSelector name="defectIds" label="修复缺陷" items={selectableVersionDefects} selectedIds={versionDefectIds} onChange={setVersionDefectIds} />
            </>
          ) : null}
          {activeDrawerKind === "document" ? (
            <>
              {contextProject ? (
                <ReadonlyField name="projectId" label="所属项目" value={contextProject.id} displayValue={`${contextProject.name}（${contextProject.code}）`} />
              ) : (
                <ProjectSelect projects={projects} defaultValue={draftValue(draft, "projectId")} />
              )}
              <Field name="name" label="资料名称" required defaultValue={draftValue(draft, "name")} />
              <Select name="type" label="资料类型" options={documentTypeOptions} defaultValue={draftValue(draft, "type")} />
              <RichTextEditor name="description" label="资料描述" defaultValue={draftValue(draft, "description")} />
              <FileField name="attachmentFile" label="上传附件" />
            </>
          ) : null}
          {activeDrawerKind === "person" ? (
            <>
              <Field name="name" label="姓名" required defaultValue={draftValue(draft, "name")} />
              <Field name="employeeNo" label="员工编号（工号，非登录账号）" defaultValue={draftValue(draft, "employeeNo")} />
              <Field name="email" label="邮箱" defaultValue={draftValue(draft, "email")} />
              <Select searchable name="primaryPositionCode" label="岗位" options={positions.map((item) => [item.code, `${item.name}（${item.code}）`])} defaultValue={draftValue(draft, "primaryPositionCode")} />
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
      {activeDrawerKind === "task" && scheduleViewOpen ? (
        <AssigneeScheduleDialog
          assigneeId={selectedTaskAssignee?.id}
          currentPersonId={currentPersonId}
          assigneeName={selectedTaskAssignee?.name}
          tasks={assigneeTasks}
          defects={assigneeDefects}
          draftItem={{
            title: taskTitle || "当前新建任务",
            projectName: contextProject?.name || "-",
            sourceName: selectedRequirement?.title || "-",
            priorityScore: selectedRequirement?.priorityScore || 0,
            plannedStartDate: taskPlannedStartDate,
            plannedFinishDate: taskPlannedFinishDate
          }}
          onClose={() => setScheduleViewOpen(false)}
          onDraftScheduleChange={(plannedStartDate, plannedFinishDate) => {
            setTaskPlannedStartDate(plannedStartDate);
            setTaskPlannedFinishDate(plannedFinishDate);
          }}
          onSaveChanges={onSaveScheduleChanges}
        />
      ) : null}
    </>
  );
}
