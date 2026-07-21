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
import { Avatar, Button as AntButton, Card, Descriptions, Dropdown as AntDropdown, Empty as AntEmpty, Input as AntInput, Menu as AntMenu, Modal as AntModal, Select as AntSelect, Space, Table as AntTable, Tag } from "antd";
import { FormEvent, MouseEvent, useEffect, useMemo, useState } from "react";
import { api, clearToken, getToken, patch, post, setToken } from "./api";
import { AssigneeScheduleDialog, ScheduleChange } from "./components/AssigneeScheduleDialog";
import { Badge, EmptyState, ListSection, Metric } from "./components/common";
import { DisplayField, Field, FileField, MultiSelect, PeopleSelect, ProjectSelect, ReadonlyField, Select, Textarea } from "./components/formControls";
import { ProjectLifecycleAction, ProjectLifecycleDialog } from "./components/ProjectLifecycleDialog";
import { RichTextDisplay, RichTextEditor } from "./components/RichText";
import { ScheduleDialog, ScheduleEditState } from "./components/ScheduleDialog";
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
  const [defectDetail, setDefectDetail] = useState<Defect | null>(null);
  const [requirementDetail, setRequirementDetail] = useState<Requirement | null>(null);
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);

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

  async function saveScheduleChanges(changes: ScheduleChange[]) {
    setBusy(true);
    setError("");
    try {
      const currentPersonId = auth?.user.personId;
      const hasForeignSchedule = changes.some((change) => {
        const item = change.kind === "task" ? tasks.find((task) => task.id === change.id) : defects.find((defect) => defect.id === change.id);
        return !currentPersonId || item?.assignee?.id !== currentPersonId;
      });
      if (hasForeignSchedule) {
        setError("只能调整自己的排期");
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
            onViewDefect={setDefectDetail}
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
          <ProjectManagement
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelect={setSelectedProjectId}
            detail={projectDetail}
            onNew={openDrawer}
            onStartDefectFix={(defect) => handleAction(() => post(`/defects/${defect.id}/start-fix`, {}), "project")}
            onViewDefect={setDefectDetail}
            onCompleteDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/fix-complete`, { fixNote: "项目中心完成修复" }), "project")}
            onVerifyDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/verify`, { verifyNote: "验证通过" }), "project")}
            onRejectDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reject`, { reason: "验证未通过" }), "project")}
            onCloseDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/close`, { reason: "手动关闭" }), "project")}
            onReopenDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reopen`, { reason: "重新开启" }), "project")}
            onReviewRequirement={setReviewTarget}
            onViewRequirement={setRequirementDetail}
            onProjectLifecycle={(project, action) => setProjectLifecycle({ project, action })}
            canTest={canTest}
            isProductManager={isProductManager}
            currentPersonId={auth.user.personId}
            versions={versions}
            canPublish={canPublish}
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
      <RequirementDetailDialog requirement={requirementDetail} onClose={() => setRequirementDetail(null)} />
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

function Workbench({
  data,
  positions,
  canCreateRequirement,
  requirementActionTitle,
  onNewRequirement,
  onEditTask,
  onEditDefect,
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
  isProductManager
}: {
  data: any;
  positions: string[];
  canCreateRequirement: boolean;
  requirementActionTitle?: string;
  onNewRequirement: () => void;
  onEditTask: (task: DevTask) => void;
  onEditDefect: (defect: Defect) => void;
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
      <div className="module-page-head workbench-page-head">
        <div>
          <p className="page-kicker">我的工作</p>
          <h1>工作台</h1>
          <p>{emphasis}</p>
        </div>
        {isProductManager ? (
          <AntButton type="primary" disabled={!canCreateRequirement} title={canCreateRequirement ? "新建需求" : requirementActionTitle} onClick={onNewRequirement}>
            <Plus size={16} /> 新建需求
          </AntButton>
        ) : null}
      </div>
      <div className="summary-band">
        <Metric label="需求开发" value={data?.summary?.developmentTasks || 0} />
        <Metric label="缺陷修复" value={data?.summary?.defectTasks || 0} />
        <Metric label="临期超期" value={data?.summary?.dueSoon || 0} tone="warn" />
        <div className="focus-line">按优先级分数和计划时间处理，排期变化会自动留痕。</div>
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

function ProjectManagement({
  projects,
  selectedProjectId,
  onSelect,
  detail,
  onNew,
  onStartDefectFix,
  onViewDefect,
  onCompleteDefect,
  onVerifyDefect,
  onRejectDefect,
  onCloseDefect,
  onReopenDefect,
  onReviewRequirement,
  onViewRequirement,
  onProjectLifecycle,
  canTest,
  isProductManager,
  currentPersonId,
  versions,
  canPublish,
  onPublish
}: {
  projects: Project[];
  selectedProjectId: number | null;
  onSelect: (id: number) => void;
  detail: any;
  onNew: (kind: DrawerKind, context?: DrawerContext) => void;
  onStartDefectFix: (defect: Defect) => void;
  onViewDefect: (defect: Defect) => void;
  onCompleteDefect: (defect: Defect) => void;
  onVerifyDefect: (defect: Defect) => void;
  onRejectDefect: (defect: Defect) => void;
  onCloseDefect: (defect: Defect) => void;
  onReopenDefect: (defect: Defect) => void;
  onReviewRequirement: (requirement: Requirement) => void;
  onViewRequirement: (requirement: Requirement) => void;
  onProjectLifecycle: (project: Project, action: ProjectLifecycleAction) => void;
  canTest: boolean;
  isProductManager: boolean;
  currentPersonId: number;
  versions: ReleaseVersion[];
  canPublish: boolean;
  onPublish: (version: ReleaseVersion) => void;
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [keyword, setKeyword] = useState("");
  const [requirementView, setRequirementView] = useState("ALL");
  const [defectView, setDefectView] = useState("ALL");
  const requirements = (detail?.requirements || []) as Requirement[];
  const tasks = (detail?.tasks || []) as DevTask[];
  const defects = (detail?.defects || []) as Defect[];
  const documents = (detail?.documents || []) as any[];
  const projectVersions = versions.filter((version) => version.project?.id === detail?.id || (version as any).projectId === detail?.id);
  const normalizedKeyword = keyword.trim().toLowerCase();
  const isProjectClosed = detail?.stage === "CLOSED";
  const canEditProject = isProductManager || detail?.owner?.id === currentPersonId || detail?.ownerId === currentPersonId;
  const openTasks = tasks.filter((task) => !["TEST_PASSED", "CLOSED"].includes(task.status));
  const openDefects = defects.filter((defect) => !["VERIFIED", "CLOSED"].includes(defect.status));
  const projectOptions = projects.map((project) => ({ value: project.id, label: project.name }));
  const matchesKeyword = (parts: Array<string | number | null | undefined>) => {
    if (!normalizedKeyword) return true;
    return parts.join(" ").toLowerCase().includes(normalizedKeyword);
  };
  const requirementViewOptions = [
    ["ALL", "全部需求", requirements.length],
    ["TO_REVIEW", "待评审", requirements.filter((item) => ["TO_REVIEW", "NEEDS_SUPPLEMENT"].includes(item.status)).length],
    ["APPROVED", "评审通过", requirements.filter((item) => item.status === "APPROVED").length],
    ["DEVELOPING", "开发中", requirements.filter((item) => item.status === "DEVELOPING").length],
    ["COMPLETED", "已完成", requirements.filter((item) => item.status === "COMPLETED").length],
    ["TO_RELEASE", "待上线", requirements.filter((item) => (item.launchStatus || "TO_RELEASE") === "TO_RELEASE").length],
    ["RELEASED", "已上线", requirements.filter((item) => item.launchStatus === "RELEASED").length],
    ["REVISION", "变更优化", requirements.filter((item) => ["CHANGE", "OPTIMIZATION"].includes(item.status) || item.revisionType).length]
  ] as const;
  const defectViewOptions = [
    ["ALL", "全部缺陷", defects.length],
    ["TO_FIX", "待修复", defects.filter((item) => item.status === "TO_FIX").length],
    ["FIXING", "修复中", defects.filter((item) => item.status === "FIXING").length],
    ["FIXED", "待验证", defects.filter((item) => item.status === "FIXED").length],
    ["VERIFIED", "已验证", defects.filter((item) => item.status === "VERIFIED").length],
    ["CLOSED", "已关闭", defects.filter((item) => item.status === "CLOSED").length],
    ["ONLINE", "线上缺陷", defects.filter((item) => item.environment === "ONLINE").length],
    ["SEVERE", "阻塞严重", defects.filter((item) => ["L1", "L2"].includes(item.level)).length]
  ] as const;
  const matchRequirementView = (requirement: Requirement) => {
    if (requirementView === "TO_REVIEW") return ["TO_REVIEW", "NEEDS_SUPPLEMENT"].includes(requirement.status);
    if (requirementView === "APPROVED") return requirement.status === "APPROVED";
    if (requirementView === "DEVELOPING") return requirement.status === "DEVELOPING";
    if (requirementView === "COMPLETED") return requirement.status === "COMPLETED";
    if (requirementView === "TO_RELEASE") return (requirement.launchStatus || "TO_RELEASE") === "TO_RELEASE";
    if (requirementView === "RELEASED") return requirement.launchStatus === "RELEASED";
    if (requirementView === "REVISION") return ["CHANGE", "OPTIMIZATION"].includes(requirement.status) || Boolean(requirement.revisionType);
    return true;
  };
  const matchDefectView = (defect: Defect) => {
    if (defectView === "ONLINE") return defect.environment === "ONLINE";
    if (defectView === "SEVERE") return ["L1", "L2"].includes(defect.level);
    if (defectView !== "ALL") return defect.status === defectView;
    return true;
  };
  const filteredRequirements = requirements.filter((requirement) =>
    matchRequirementView(requirement) &&
    matchesKeyword([requirement.title, requirement.code, requirement.type, requirement.priorityLevel, label(requirement.status), label(requirement.launchStatus || "TO_RELEASE")])
  );
  const filteredDefects = defects.filter((defect) =>
    matchDefectView(defect) &&
    matchesKeyword([defect.title, defect.code, defectLevelLabel(defect.level), label(defect.status), defect.assignee?.name, defect.task?.title, defect.task?.requirement?.title])
  );
  const canReviewRequirement = (requirement: Requirement) => isProductManager && ["TO_REVIEW", "NEEDS_SUPPLEMENT"].includes(requirement.status);
  const canOperateRequirement = (requirement: Requirement) => !["CHANGE", "OPTIMIZATION"].includes(requirement.status);
  const canCreateTask = (requirement: Requirement) => !isProjectClosed && ["APPROVED", "DEVELOPING"].includes(requirement.status);
  const projectTabs = [
    ["overview", "概览"],
    ["requirements", "需求"],
    ["defects", "缺陷"],
    ["versions", "版本"],
    ["documents", "资料"]
  ] as const;
  const requirementColumns = [
    {
      title: "需求",
      dataIndex: "title",
      render: (_: unknown, requirement: Requirement) => (
        <Space direction="vertical" size={1}>
          <strong>{requirement.title}</strong>
          <span className="muted-line">{requirement.code} · {label(requirement.type)} · {requirement.priorityLevel}</span>
        </Space>
      )
    },
    { title: "需求状态", width: 120, render: (_: unknown, requirement: Requirement) => <Tag color={requirementStatusColor(requirement.status)}>{label(requirement.status)}</Tag> },
    { title: "上线状态", width: 110, render: (_: unknown, requirement: Requirement) => <Tag>{label(requirement.launchStatus || "TO_RELEASE")}</Tag> },
    { title: "优先级分数", width: 120, dataIndex: "priorityScore" },
    { title: "期望上线", width: 120, render: (_: unknown, requirement: Requirement) => fmtDate(requirement.expectedLaunchDate) },
    { title: "任务", width: 90, render: (_: unknown, requirement: Requirement) => (requirement as any)._count?.tasks ?? tasks.filter((task) => task.requirement?.id === requirement.id).length },
    {
      title: "操作",
      width: 280,
      render: (_: unknown, requirement: Requirement) => (
        <Space size={6} wrap>
          {canReviewRequirement(requirement) ? <AntButton size="small" type="primary" onClick={() => onReviewRequirement(requirement)}>评审</AntButton> : null}
          <AntButton size="small" onClick={() => onViewRequirement(requirement)}>详情</AntButton>
          <AntButton size="small" disabled={!canCreateTask(requirement)} title={canCreateTask(requirement) ? "创建任务" : "评审通过或开发中才可以创建任务"} onClick={() => onNew("task", { projectId: requirement.projectId, requirementId: requirement.id })}>任务</AntButton>
          {isProductManager && canOperateRequirement(requirement) ? <AntButton size="small" onClick={() => onNew("requirement", { projectId: requirement.projectId, requirementId: requirement.id, revisionMode: "CHANGE" })}>变更</AntButton> : null}
          {isProductManager && canOperateRequirement(requirement) ? <AntButton size="small" onClick={() => onNew("requirement", { projectId: requirement.projectId, requirementId: requirement.id, revisionMode: "OPTIMIZATION" })}>优化</AntButton> : null}
        </Space>
      )
    }
  ];
  const versionColumns = [
    {
      title: "版本",
      render: (_: unknown, version: ReleaseVersion) => (
        <Space direction="vertical" size={1}>
          <strong>{version.name}</strong>
          <span className="muted-line">{version.code}</span>
        </Space>
      )
    },
    { title: "状态", width: 110, render: (_: unknown, version: ReleaseVersion) => <Tag color={version.status === "RELEASED" ? "green" : "blue"}>{label(version.status)}</Tag> },
    { title: "计划上线", width: 130, render: (_: unknown, version: ReleaseVersion) => fmtDate(version.plannedReleaseAt) },
    { title: "上线需求", width: 100, render: (_: unknown, version: ReleaseVersion) => version.requirements?.length || 0 },
    { title: "修复缺陷", width: 100, render: (_: unknown, version: ReleaseVersion) => version.defects?.length || 0 },
    { title: "操作", width: 120, render: (_: unknown, version: ReleaseVersion) => canPublish ? <AntButton size="small" type="primary" onClick={() => onPublish(version)}>发布</AntButton> : null }
  ];
  const documentColumns = [
    { title: "资料", render: (_: unknown, doc: any) => <Space direction="vertical" size={1}><strong>{doc.name}</strong><span className="muted-line">{doc.tags || doc.version || "-"}</span></Space> },
    { title: "类型", width: 110, render: (_: unknown, doc: any) => label(doc.type) },
    { title: "版本", width: 100, render: (_: unknown, doc: any) => doc.version || "-" },
    { title: "资料描述", render: (_: unknown, doc: any) => <RichTextDisplay value={doc.description} /> },
    { title: "附件", render: (_: unknown, doc: any) => doc.attachmentUrl ? <a href={doc.attachmentUrl} target="_blank" rel="noreferrer">打开附件</a> : "-" }
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
            <AntSelect className="antd-project-picker" value={selectedProjectId || undefined} options={projectOptions} onChange={onSelect} placeholder="选择项目" />
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
                {canEditProject && detail.stage === "INITIATED" ? <AntButton type="primary" icon={<Rocket size={16} />} onClick={() => onProjectLifecycle(detail, "start")}>启动项目</AntButton> : null}
                {canEditProject && !isProjectClosed ? <AntButton icon={<CheckCircle2 size={16} />} onClick={() => onProjectLifecycle(detail, "close")}>项目结项</AntButton> : null}
                {canEditProject && isProjectClosed ? <AntButton type="primary" icon={<Rocket size={16} />} onClick={() => onProjectLifecycle(detail, "reopen")}>重新打开</AntButton> : null}
                <AntButton type="primary" disabled={isProjectClosed} icon={<Plus size={16} />} onClick={() => onNew("requirement", { projectId: detail.id })}>需求</AntButton>
                {canPublish ? <AntButton disabled={isProjectClosed} icon={<Plus size={16} />} onClick={() => onNew("version", { projectId: detail.id })}>版本</AntButton> : null}
                <AntButton icon={<Plus size={16} />} onClick={() => onNew("document", { projectId: detail.id })}>资料</AntButton>
              </Space>
            </div>
            <Descriptions className="ant-project-descriptions" size="small" column={4} bordered>
              <Descriptions.Item label="当前状态">{projectStageLabel(detail.stage)}</Descriptions.Item>
              <Descriptions.Item label="项目负责人">{detail.owner?.name || "-"}</Descriptions.Item>
              <Descriptions.Item label="计划周期">{fmtDate(detail.plannedStartDate)} - {fmtDate(detail.plannedEndDate)}</Descriptions.Item>
              <Descriptions.Item label="期望上线">{fmtDate(detail.expectedLaunchDate)}</Descriptions.Item>
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
              <section className="project-info-grid ant-project-rich-grid">
                <div className="project-rich-block"><span>需求范围</span><RichTextDisplay value={detail.scope} /></div>
                <div className="project-rich-block"><span>项目背景</span><RichTextDisplay value={detail.background} /></div>
                <div className="project-rich-block"><span>项目目标</span><RichTextDisplay value={detail.goal} /></div>
                <div className="project-rich-block"><span>涉及系统</span><RichTextDisplay value={detail.relatedSystems} /></div>
              </section>
            </>
          ) : null}

          {activeTab === "requirements" ? (
            <Card className="enterprise-card" title="需求" extra={<AntButton type="primary" disabled={isProjectClosed} onClick={() => onNew("requirement", { projectId: detail.id })}><Plus size={16} /> 需求</AntButton>}>
              <div className="work-view-toolbar">
                <div className="view-strip">
                  {requirementViewOptions.map(([key, text, count]) => (
                    <button key={key} type="button" className={requirementView === key ? "active" : ""} onClick={() => setRequirementView(key)}>
                      {text}<span>{count}</span>
                    </button>
                  ))}
                </div>
                <AntInput.Search allowClear placeholder="搜索需求编号、标题、类型、状态" value={keyword} onChange={(event) => setKeyword(event.currentTarget.value)} />
              </div>
              <AntTable
                className="enterprise-table"
                rowKey="id"
                columns={requirementColumns}
                dataSource={filteredRequirements}
                pagination={filteredRequirements.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
                scroll={{ x: 1020 }}
                locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无需求" /> }}
              />
            </Card>
          ) : null}

          {activeTab === "defects" ? (
            <Card className="enterprise-card" title="缺陷" extra={<span className="section-note">缺陷从任务创建，这里统一查询和处理</span>}>
              <div className="work-view-toolbar">
                <div className="view-strip">
                  {defectViewOptions.map(([key, text, count]) => (
                    <button key={key} type="button" className={defectView === key ? "active" : ""} onClick={() => setDefectView(key)}>
                      {text}<span>{count}</span>
                    </button>
                  ))}
                </div>
                <AntInput.Search allowClear placeholder="搜索缺陷编号、标题、任务、负责人" value={keyword} onChange={(event) => setKeyword(event.currentTarget.value)} />
              </div>
              <DefectTable
                defects={filteredDefects}
                onView={onViewDefect}
                onStartFix={onStartDefectFix}
                onComplete={onCompleteDefect}
                canVerify={canTest}
                onVerify={onVerifyDefect}
                onReject={onRejectDefect}
                onClose={onCloseDefect}
                onReopen={onReopenDefect}
              />
            </Card>
          ) : null}

          {activeTab === "versions" ? (
            <Card className="enterprise-card" title="版本" extra={<AntButton type="primary" disabled={isProjectClosed} onClick={() => onNew("version", { projectId: detail.id })}><Plus size={16} /> 版本</AntButton>}>
              <AntTable
                className="enterprise-table"
                rowKey="id"
                columns={versionColumns}
                dataSource={projectVersions}
                pagination={projectVersions.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
                scroll={{ x: 760 }}
                locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无版本" /> }}
              />
            </Card>
          ) : null}

          {activeTab === "documents" ? (
            <Card className="enterprise-card" title="资料" extra={<AntButton type="primary" onClick={() => onNew("document", { projectId: detail.id })}><Plus size={16} /> 资料</AntButton>}>
              <AntTable
                className="enterprise-table"
                rowKey="id"
                columns={documentColumns}
                dataSource={documents}
                pagination={documents.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
                scroll={{ x: 860 }}
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
  const canCreateDefect = (task: DevTask) => !isProjectClosed && ["TESTING", "TEST_PASSED"].includes(task.status);
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
    return Array.from(new Set(source.map((item: any) => item.status).filter(Boolean)));
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
  const statusSelectOptions = [{ value: "ALL", label: "全部状态" }, ...statusOptions.map((status) => ({ value: status, label: label(status) }))];
  const assigneeSelectOptions = [{ value: "ALL", label: "全部负责人" }, ...assigneeOptions.map(([value, text]) => ({ value, label: text }))];

  return (
    <section className="page-stack project-page ant-project-page">
      <Card
        title="项目总览"
        extra={<AntSelect className="antd-project-picker" value={selectedProjectId || undefined} options={projectOptions} onChange={onSelect} placeholder="选择项目" />}
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
            </Descriptions>
            <div className="project-info-grid ant-project-rich-grid">
              <div className="project-rich-block">
                <span>需求范围</span>
                <RichTextDisplay value={detail.scope} />
              </div>
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
            <AntSelect value={assigneeFilter} options={assigneeSelectOptions} onChange={setAssigneeFilter} />
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
                        {activeRequirementGroup.tasks.length ? activeRequirementGroup.tasks.map((task) => (
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
                              <AntButton size="small" disabled={!canCreateDefect(task)} onClick={() => onNew("defect", { projectId: task.project?.id || task.requirement?.projectId, requirementId: task.requirement?.id, taskId: task.id })}>创建缺陷</AntButton>
                              {task.status === "TODO" ? <AntButton size="small" type="primary" onClick={() => onStartTask(task)}>开始处理</AntButton> : null}
                              {task.status === "DOING" ? <AntButton size="small" type="primary" onClick={() => onCompleteTask(task)}>处理完成</AntButton> : null}
                              {canTest && task.status === "TO_TEST" ? <AntButton size="small" type="primary" onClick={() => onStartTaskTest(task)}>开始测试</AntButton> : null}
                              {canTest && task.status === "TESTING" ? <AntButton size="small" type="primary" disabled={!canPassTask(task)} onClick={() => onPassTaskTest(task)}>测试通过</AntButton> : null}
                              {isProductManager && !["TEST_PASSED", "CLOSED"].includes(task.status) ? <AntButton size="small" onClick={() => onCloseTask(task)}>关闭任务</AntButton> : null}
                            </div>
                            <div className="defect-inline-list">
                              {task.childDefects.length ? task.childDefects.map((defect) => (
                                <div className="defect-inline-item" key={defect.id}>
                                  <div>
                                    <strong>{defect.title}</strong>
                                    <span>{defect.code} · {defectLevelLabel(defect.level)} · {defectEnvironmentLabel(defect.environment)}</span>
                                  </div>
                                  <Space size={6} wrap>
                                    <Tag color={defectStatusColor(defect.status)}>{label(defect.status)}</Tag>
                                    <Tag>分数 {defect.priorityScore}</Tag>
                                    <AntButton size="small" onClick={() => onViewDefect(defect)}>查看</AntButton>
                                    {defect.status === "TO_FIX" ? <AntButton size="small" type="primary" onClick={() => onStartDefectFix(defect)}>开始修复</AntButton> : null}
                                    {defect.status === "FIXING" ? <AntButton size="small" type="primary" onClick={() => onCompleteDefect(defect)}>已修复</AntButton> : null}
                                    {canTest && defect.status === "FIXED" ? <AntButton size="small" type="primary" onClick={() => onVerifyDefect(defect)}>验证通过</AntButton> : null}
                                    {canTest && defect.status === "FIXED" ? <AntButton size="small" onClick={() => onRejectDefect(defect)}>验证未通过</AntButton> : null}
                                    {canTest && defect.status === "TO_FIX" ? <AntButton size="small" onClick={() => onCloseDefect(defect)}>关闭</AntButton> : null}
                                    {canTest && defect.status === "CLOSED" ? <AntButton size="small" onClick={() => onReopenDefect(defect)}>开启</AntButton> : null}
                                  </Space>
                                </div>
                              )) : (
                                <div className="defect-inline-empty">该任务暂无缺陷</div>
                              )}
                            </div>
                          </div>
                        )) : (
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
    { title: "计划上线", width: 140, render: (_: unknown, version: ReleaseVersion) => fmtDate(version.plannedReleaseAt) },
    { title: "上线需求", width: 100, render: (_: unknown, version: ReleaseVersion) => version.requirements?.length || 0 },
    { title: "修复缺陷", width: 100, render: (_: unknown, version: ReleaseVersion) => version.defects?.length || 0 },
    {
      title: "操作",
      width: 120,
      render: (_: unknown, version: ReleaseVersion) => canPublish ? (
        <AntButton size="small" type="primary" onClick={() => onPublish(version)}>
          <PackageCheck size={15} /> 发布
        </AntButton>
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
  if (!data) return <EmptyState text="后台数据加载中" />;
  const accountByPerson = new Map(data.accounts.map((account) => [account.person.id, account]));
  const dictionaryTypes = Array.from(new Set(data.dictionaries.map((item) => item.type))).sort();
  const dictionaries = dictionaryType === "ALL" ? data.dictionaries : data.dictionaries.filter((item) => item.type === dictionaryType);
  const activeDictionaryMeta = dictionaryType === "ALL" ? null : dictionaryTypeMeta[dictionaryType];
  const adminSections = [
    ["people", "人员账号", data.people.length],
    ["org", "组织岗位", data.organizations.length + data.positions.length],
    ["dictionary", "字典配置", data.dictionaries.length],
    ["priority", "优先级规则", data.requirementPriorities.length + data.defectPriorities.length],
    ["logs", "处理记录", data.logs.length]
  ] as const;
  const peopleColumns = [
    { title: "姓名", dataIndex: "name" },
    { title: "员工编号", render: (_: unknown, person: Person) => person.employeeNo || "-" },
    { title: "组织", render: (_: unknown, person: Person) => person.organization?.name || "-" },
    { title: "岗位", render: (_: unknown, person: Person) => person.primaryPosition?.name || "-" },
    { title: "登录账号", render: (_: unknown, person: Person) => accountByPerson.get(person.id)?.username || "-" },
    { title: "账号状态", render: (_: unknown, person: Person) => {
      const account = accountByPerson.get(person.id);
      return <Tag color={account?.status === "ACTIVE" ? "green" : "default"}>{account ? label(account.status) : "未开通"}</Tag>;
    } },
    { title: "登录", render: (_: unknown, person: Person) => {
      const account = accountByPerson.get(person.id);
      return account ? (account.allowLogin ? "允许" : "禁止") : "-";
    } },
    { title: "操作", width: 100, render: (_: unknown, person: Person) => <AntButton size="small" onClick={() => onEdit({ kind: "personAccount", item: { ...person, account: accountByPerson.get(person.id) } })}>编辑</AntButton> }
  ];
  const organizationColumns = [
    { title: "组织名称", dataIndex: "name" },
    { title: "编码", dataIndex: "code" },
    { title: "负责人", render: (_: unknown, item: Organization) => data.people.find((person) => person.id === item.managerId)?.name || "-" },
    { title: "状态", render: (_: unknown, item: Organization) => <Tag color={item.status === "ACTIVE" ? "green" : "default"}>{label(item.status)}</Tag> },
    { title: "操作", width: 90, render: (_: unknown, item: Organization) => <AntButton size="small" onClick={() => onEdit({ kind: "organization", item })}>编辑</AntButton> }
  ];
  const positionColumns = [
    { title: "岗位名称", dataIndex: "name" },
    { title: "编码", dataIndex: "code" },
    { title: "状态", render: (_: unknown, item: Position) => <Tag color={item.isActive ? "green" : "default"}>{item.isActive ? "启用" : "停用"}</Tag> },
    { title: "操作", width: 90, render: (_: unknown, item: Position) => <AntButton size="small" onClick={() => onEdit({ kind: "position", item })}>编辑</AntButton> }
  ];
  const requirementPriorityColumns = [
    { title: "等级", dataIndex: "name" },
    { title: "基础分", dataIndex: "baseScore" },
    { title: "缺陷系数", dataIndex: "defectWeight" },
    { title: "状态", render: (_: unknown, item: any) => <Tag color={item.isActive === false ? "default" : "green"}>{item.isActive === false ? "停用" : "启用"}</Tag> },
    { title: "操作", width: 90, render: (_: unknown, item: any) => <AntButton size="small" onClick={() => onEdit({ kind: "requirementPriority", item })}>编辑</AntButton> }
  ];
  const defectPriorityColumns = [
    { title: "等级", dataIndex: "name" },
    { title: "线上", dataIndex: "onlineScore" },
    { title: "线下", dataIndex: "offlineScore" },
    { title: "状态", render: (_: unknown, item: any) => <Tag color={item.isActive === false ? "default" : "green"}>{item.isActive === false ? "停用" : "启用"}</Tag> },
    { title: "操作", width: 90, render: (_: unknown, item: any) => <AntButton size="small" onClick={() => onEdit({ kind: "defectPriority", item })}>编辑</AntButton> }
  ];
  const dictionaryColumns = [
    {
      title: "类型",
      render: (_: unknown, item: any) => (
        <Space direction="vertical" size={1}>
          <strong>{dictionaryTypeMeta[item.type]?.name || item.type}</strong>
          <span className="muted-line">{item.type}</span>
        </Space>
      )
    },
    { title: "编码", dataIndex: "code" },
    { title: "显示名称", dataIndex: "name" },
    { title: "使用位置", render: (_: unknown, item: any) => <span className="usage-cell">{dictionaryTypeUsage(item.type)}</span> },
    { title: "状态", render: (_: unknown, item: any) => <Tag color={item.isActive ? "green" : "default"}>{item.isActive ? "启用" : "停用"}</Tag> },
    { title: "排序", dataIndex: "sort", width: 80 },
    { title: "操作", width: 90, render: (_: unknown, item: any) => <AntButton size="small" onClick={() => onEdit({ kind: "dictionary", item })}>编辑</AntButton> }
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
          <AntTable className="enterprise-table" rowKey="id" columns={peopleColumns} dataSource={data.people} pagination={data.people.length > 8 ? { pageSize: 8, showSizeChanger: false } : false} scroll={{ x: 920 }} />
        </Card>
      ) : null}
      {activeAdminSection === "org" ? (
        <section className="config-grid">
          <Card className="enterprise-card" title="组织配置" extra={<AntButton onClick={() => onEdit({ kind: "organization" })}><Plus size={16} /> 组织</AntButton>}>
            <AntTable className="enterprise-table" rowKey="id" columns={organizationColumns} dataSource={data.organizations} pagination={false} />
          </Card>
          <Card className="enterprise-card" title="岗位配置" extra={<AntButton onClick={() => onEdit({ kind: "position" })}><Plus size={16} /> 岗位</AntButton>}>
            <AntTable className="enterprise-table" rowKey="id" columns={positionColumns} dataSource={data.positions} pagination={false} />
          </Card>
        </section>
      ) : null}
      {activeAdminSection === "priority" ? (
        <section className="config-grid">
          <Card className="enterprise-card" title="需求优先级分值" extra={<span className="section-note">需求分 = 基础分 + 时效加分</span>}>
            <AntTable className="enterprise-table" rowKey="id" columns={requirementPriorityColumns} dataSource={data.requirementPriorities} pagination={false} />
          </Card>
          <Card className="enterprise-card" title="缺陷基础分值" extra={<span className="section-note">缺陷分 = 环境基础分 × 需求缺陷系数 + 时效加分</span>}>
            <AntTable className="enterprise-table" rowKey="id" columns={defectPriorityColumns} dataSource={data.defectPriorities} pagination={false} />
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
              <label className="inline-filter">
                类型
                <select value={dictionaryType} onChange={(event) => setDictionaryType(event.currentTarget.value)}>
                  <option value="ALL">全部</option>
                  {dictionaryTypes.map((type) => (
                    <option key={type} value={type}>{dictionaryTypeLabel(type)}</option>
                  ))}
                </select>
              </label>
              <AntButton onClick={() => onEdit({ kind: "dictionary" })}><Plus size={16} /> 字典</AntButton>
            </Space>
          }
        >
          <AntTable className="enterprise-table" rowKey="id" columns={dictionaryColumns} dataSource={dictionaries} pagination={dictionaries.length > 10 ? { pageSize: 10, showSizeChanger: false } : false} scroll={{ x: 980 }} />
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
  const canCreateDefect = (task: DevTask) => !isProjectClosed && ["TESTING", "TEST_PASSED"].includes(task.status);
  const defectButtonTitle = (task: DevTask) => {
    if (isProjectClosed) return "项目已结项，不能新增缺陷";
    if (task.status === "TEST_PASSED") return "创建缺陷后，任务会退回测试中";
    return canCreateDefect(task) ? "创建缺陷" : "只有测试中或测试通过的任务可以创建缺陷";
  };
  const columns = [
    {
      title: "任务",
      dataIndex: "title",
      width: 240,
      render: (_: unknown, task: DevTask) => (
        <Space direction="vertical" size={1}>
          <strong>{task.title}</strong>
          <span className="muted-line">{task.code} · {label(task.type)}</span>
        </Space>
      )
    },
    { title: "项目", dataIndex: ["project", "name"], width: 170, render: (_: unknown, task: DevTask) => task.project?.name || "-" },
    { title: "需求", dataIndex: ["requirement", "title"], width: 190, render: (_: unknown, task: DevTask) => task.requirement?.title || "-" },
    { title: "负责人", width: 110, render: (_: unknown, task: DevTask) => task.assignee?.name || "-" },
    { title: "状态", width: 110, render: (_: unknown, task: DevTask) => <Tag color={taskStatusColor(task.status)}>{label(task.status)}</Tag> },
    { title: "排期", width: 190, render: (_: unknown, task: DevTask) => `${fmtDate(task.plannedStartDate)} - ${fmtDate(task.plannedFinishDate)}` },
    { title: "优先级分数", width: 120, dataIndex: "priorityScore" },
    {
      title: "操作",
      width: 280,
      render: (_: unknown, task: DevTask) => (
        <Space size={6} wrap>
          {onEdit ? <AntButton size="small" onClick={() => onEdit(task)}>排期</AntButton> : null}
          {onNewDefect ? (
            <AntButton size="small" disabled={!canCreateDefect(task)} title={defectButtonTitle(task)} onClick={() => onNewDefect(task)}>
              缺陷
            </AntButton>
          ) : null}
          {onStart && task.status === "TODO" ? <AntButton size="small" type="primary" onClick={() => onStart(task)}>开始处理</AntButton> : null}
          {onComplete && task.status === "DOING" ? <AntButton size="small" type="primary" onClick={() => onComplete(task)}>处理完成</AntButton> : null}
          {canTest && onStartTest && task.status === "TO_TEST" ? <AntButton size="small" type="primary" onClick={() => onStartTest(task)}>开始测试</AntButton> : null}
          {canTest && onPassTest && task.status === "TESTING" ? (
            <AntButton size="small" type="primary" disabled={!canPassTask(task)} title={canPassTask(task) ? "测试通过" : "任务下仍有未验证或未关闭的缺陷"} onClick={() => onPassTest(task)}>
              测试通过
            </AntButton>
          ) : null}
          {isProductManager && onClose && !["TEST_PASSED", "CLOSED"].includes(task.status) ? <AntButton size="small" onClick={() => onClose(task)}>关闭</AntButton> : null}
        </Space>
      )
    }
  ];
  return (
    <Card className="enterprise-card" title="需求开发">
      <AntTable
        className="enterprise-table"
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={tasks}
        pagination={tasks.length > 8 ? { pageSize: 8, showSizeChanger: false } : false}
        scroll={{ x: 1410 }}
        rowClassName={(task) => (isDue(task.plannedFinishDate) ? "due-row" : "")}
        locale={{ emptyText: <AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="暂无需求开发任务" /> }}
      />
    </Card>
  );
}

function DefectTable({
  defects,
  onView,
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
  onView?: (defect: Defect) => void;
  onEdit?: (defect: Defect) => void;
  onStartFix?: (defect: Defect) => void;
  onComplete?: (defect: Defect) => void;
  canVerify?: boolean;
  onVerify?: (defect: Defect) => void;
  onReject?: (defect: Defect) => void;
  onClose?: (defect: Defect) => void;
  onReopen?: (defect: Defect) => void;
}) {
  const canStartFix = (defect: Defect) => defect.status === "TO_FIX";
  const canCompleteFix = (defect: Defect) => defect.status === "FIXING";
  const canCloseDefect = (defect: Defect) => defect.status === "TO_FIX";
  const columns = [
    {
      title: "缺陷",
      dataIndex: "title",
      width: 240,
      render: (_: unknown, defect: Defect) => (
        <Space direction="vertical" size={1}>
          <strong>{defect.title}</strong>
          <span className="muted-line">{defect.code} · {defectLevelLabel(defect.level)}</span>
        </Space>
      )
    },
    { title: "项目", width: 170, render: (_: unknown, defect: Defect) => defect.project?.name || "-" },
    { title: "关联任务/需求", width: 220, render: (_: unknown, defect: Defect) => `${defect.task?.title || "-"} / ${defect.task?.requirement?.title || defect.requirement?.title || "-"}` },
    { title: "负责人", width: 110, render: (_: unknown, defect: Defect) => defect.assignee?.name || "-" },
    { title: "状态", width: 110, render: (_: unknown, defect: Defect) => <Tag color={defectStatusColor(defect.status)}>{label(defect.status)}</Tag> },
    { title: "排期", width: 190, render: (_: unknown, defect: Defect) => `${fmtDate(defect.plannedStartDate || defect.plannedFixDate)} - ${fmtDate(defect.plannedFinishDate || defect.plannedFixDate)}` },
    { title: "环境", width: 90, render: (_: unknown, defect: Defect) => defectEnvironmentLabel(defect.environment) },
    { title: "优先级分数", width: 120, dataIndex: "priorityScore" },
    {
      title: "操作",
      width: 280,
      render: (_: unknown, defect: Defect) => (
        <Space size={6} wrap>
          {onView ? <AntButton size="small" onClick={() => onView(defect)}>查看</AntButton> : null}
          {onEdit ? <AntButton size="small" onClick={() => onEdit(defect)}>排期</AntButton> : null}
          {onStartFix && canStartFix(defect) ? <AntButton size="small" type="primary" onClick={() => onStartFix(defect)}>开始修复</AntButton> : null}
          {onComplete && canCompleteFix(defect) ? <AntButton size="small" type="primary" onClick={() => onComplete(defect)}>已修复</AntButton> : null}
          {canVerify && onVerify && defect.status === "FIXED" ? <AntButton size="small" type="primary" onClick={() => onVerify(defect)}>验证通过</AntButton> : null}
          {canVerify && onReject && defect.status === "FIXED" ? <AntButton size="small" onClick={() => onReject(defect)}>验证未通过</AntButton> : null}
          {canVerify && onClose && canCloseDefect(defect) ? <AntButton size="small" onClick={() => onClose(defect)}>关闭</AntButton> : null}
          {canVerify && onReopen && defect.status === "CLOSED" ? <AntButton size="small" onClick={() => onReopen(defect)}>开启</AntButton> : null}
        </Space>
      )
    }
  ];
  return (
    <Card className="enterprise-card" title="缺陷修复">
      <AntTable
        className="enterprise-table"
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={defects}
        pagination={defects.length > 8 ? { pageSize: 8, showSizeChanger: false } : false}
        scroll={{ x: 1520 }}
        rowClassName={(defect) => (isDue(defect.plannedFinishDate || defect.plannedFixDate) ? "due-row" : "")}
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

function RequirementDetailDialog({ requirement, onClose }: { requirement: Requirement | null; onClose: () => void }) {
  if (!requirement) return null;
  const documents = requirement.documents || [];
  return (
    <div className="drawer-backdrop">
      <aside className="drawer detail-dialog">
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
        </div>
      </aside>
    </div>
  );
}

function DefectDetailDialog({ defect, onClose }: { defect: Defect | null; onClose: () => void }) {
  if (!defect) return null;
  const requirement = defect.task?.requirement || defect.requirement;
  return (
    <div className="drawer-backdrop">
      <aside className="drawer detail-dialog">
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
              <DetailItem label="提交人" value={defect.reporter?.name} />
              <DetailItem label="发现版本" value={defect.version?.name} />
              <DetailItem label="发现时间" value={fmtDate(defect.foundAt || undefined)} />
              <DetailItem label="实际修复时间" value={fmtDate(defect.actualFixDate || undefined)} />
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
            <DetailItem label="计划修复排期" value={`${fmtDate(defect.plannedStartDate || defect.plannedFixDate || undefined)} - ${fmtDate(defect.plannedFinishDate || defect.plannedFixDate || undefined)}`} />
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
  const sourceRequirementForDraft = context.requirementId ? requirements.find((requirement) => requirement.id === context.requirementId) : undefined;
  const [draftMessage, setDraftMessage] = useState("");
  const [draftStamp, setDraftStamp] = useState(0);
  const [versionProjectId, setVersionProjectId] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState(String(currentPersonId || ""));
  const [requirementPriorityLevel, setRequirementPriorityLevel] = useState(String(draftValue(draft, "priorityLevel", sourceRequirementForDraft?.priorityLevel || "P2") || "P2"));
  const [requirementTimingBonus, setRequirementTimingBonus] = useState(String(draftValue(draft, "timingBonus", "") ?? ""));
  const [requirementLaunchStatus, setRequirementLaunchStatus] = useState(String(draftValue(draft, "launchStatus", "TO_RELEASE") || "TO_RELEASE"));
  const [defectTaskId, setDefectTaskId] = useState(String(draftValue(draft, "taskId", context.taskId || "") || ""));
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
    }
  }, [kind, draftKey, openProjectFallbackId]);
  useEffect(() => {
    if (kind === "task") {
      setTaskAssigneeId(String(draftValue(draft, "assigneeId", currentPersonId) || ""));
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
    return Boolean(projectId && openProjectIds.has(projectId) && ["TESTING", "TEST_PASSED"].includes(item.status));
  });
  const selectedVersionProjectId = Number(versionProjectId || openProjectFallbackId || 0);
  const selectableVersionRequirements = requirements.filter((item) => item.projectId === selectedVersionProjectId && openProjectIds.has(item.projectId) && item.status === "COMPLETED" && (item.launchStatus || "TO_RELEASE") === "TO_RELEASE");
  const selectableVersionDefects = defects.filter((item) => {
    const projectId = item.project?.id || item.task?.project?.id || item.task?.requirement?.projectId;
    return Boolean(projectId && projectId === selectedVersionProjectId && openProjectIds.has(projectId) && ["VERIFIED", "CLOSED"].includes(item.status));
  });
  const productManagers = people.filter(isProductManagerPerson);
  const defaultProjectOwnerId = editingProject?.ownerId || editingProject?.owner?.id || (isProductManagerPerson(currentPerson) ? currentPersonId : productManagers[0]?.id);
  const requirementTypeOptions = dictionaryOptions(dictionaries, "REQUIREMENT_TYPE", [["FEATURE", "功能需求"], ["PROCESS", "流程需求"], ["DATA", "数据需求"], ["REPORT", "报表需求"], ["UX", "体验优化"], ["NON_FUNCTIONAL", "非功能需求"]]);
  const requirementLaunchStatusOptions = dictionaryOptions(dictionaries, "REQUIREMENT_LAUNCH_STATUS", [["TO_RELEASE", "待上线"], ["RELEASED", "已上线"]]);
  const versionTypeOptions = dictionaryOptions(dictionaries, "VERSION_TYPE", [["NORMAL", "常规版本"], ["HOTFIX", "紧急修复"], ["GRAY", "灰度版本"]]);
  const documentTypeOptions = dictionaryOptions(dictionaries, "DOCUMENT_TYPE", [["BUSINESS", "业务资料"], ["TECH", "技术资料"], ["TEST", "测试资料"], ["RELEASE", "上线资料"]]);
  const taskAssigneeNumberId = Number(taskAssigneeId);
  const selectedTaskAssignee = people.find((person) => person.id === taskAssigneeNumberId);
  const taskTypeCode = personPrimaryPositionCode(selectedTaskAssignee) || currentPositionCode;
  const taskTypeName = personPrimaryPositionName(selectedTaskAssignee) || positions.find((position) => position.code === taskTypeCode)?.name || label(taskTypeCode);
  const assigneeTasks = tasks
    .filter((task) => task.assignee?.id === taskAssigneeNumberId)
    .sort((left, right) => (right.priorityScore || 0) - (left.priorityScore || 0));
  const assigneeDefects = defects
    .filter((defect) => defect.assignee?.id === taskAssigneeNumberId)
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
                <Select name="requirementId" label="关联需求" options={selectableTaskRequirements.map((item) => [String(item.id), item.title])} defaultValue={draftValue(draft, "requirementId")} />
              )}
              <Field name="title" label="任务标题" required defaultValue={draftValue(draft, "title")} />
              <Select name="assigneeId" label="负责人" options={people.map((person) => [String(person.id), person.name])} value={taskAssigneeId} onChange={setTaskAssigneeId} />
              <ReadonlyField name="type" label="任务类型（由负责人岗位带出）" value={taskTypeCode} displayValue={taskTypeName} />
              <div className="schedule-action-row">
                <button type="button" onClick={() => setScheduleViewOpen(true)} disabled={!selectedTaskAssignee}>
                  <CalendarDays size={18} /> 查看排期情况
                </button>
                <span>{selectedTaskAssignee ? `查看${selectedTaskAssignee.name}全部开发任务和缺陷修复排期` : "请选择负责人后查看排期情况"}</span>
              </div>
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
                <Select name="taskId" label="关联任务" required value={defectTaskId} onChange={setDefectTaskId} options={[["", "请选择任务"], ...selectableDefectTasks.map((item) => [String(item.id), `${item.title} / ${item.requirement?.title || "-"}`] as [string, string])]} />
              )}
              <Field name="title" label="缺陷标题" required defaultValue={draftValue(draft, "title")} />
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
      {activeDrawerKind === "task" && scheduleViewOpen ? (
        <AssigneeScheduleDialog
          assigneeId={selectedTaskAssignee?.id}
          currentPersonId={currentPersonId}
          assigneeName={selectedTaskAssignee?.name}
          tasks={assigneeTasks}
          defects={assigneeDefects}
          onClose={() => setScheduleViewOpen(false)}
          onSaveChanges={onSaveScheduleChanges}
        />
      ) : null}
    </>
  );
}
