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
import { FormEvent, MouseEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { api, clearToken, getToken, patch, post, setToken } from "./api";
import { Account, AdminData, AuthState, Defect, DevTask, Organization, Person, Position, Project, ReleaseVersion, Requirement } from "./types";

type View = "workbench" | "projects" | "execution" | "release" | "admin";
type DrawerKind = "project" | "requirement" | "task" | "defect" | "version" | "document" | "person" | null;
type DrawerContext = { projectId?: number; requirementId?: number; taskId?: number; revisionMode?: "CHANGE" | "OPTIMIZATION" };
type AdminEditKind = "personAccount" | "organization" | "position" | "dictionary" | "requirementPriority" | "defectPriority";
type AdminEditState = { kind: AdminEditKind; item?: any } | null;
type FormDraft = Record<string, string | string[]>;

const statusLabels: Record<string, string> = {
  TO_REVIEW: "待评审",
  APPROVED: "评审通过",
  REJECTED: "评审不通过",
  NEEDS_SUPPLEMENT: "待补充",
  DEFERRED: "暂缓",
  DEVELOPING: "开发中",
  TESTING: "测试中",
  READY_TO_RELEASE: "待上线",
  RELEASED: "已上线",
  COMPLETED: "已完成",
  CANCELED: "已取消",
  CHANGE: "需求变更",
  OPTIMIZATION: "需求优化",
  TO_RELEASE: "待上线",
  TODO: "待处理",
  DOING: "处理中",
  TO_TEST: "待测试",
  TEST_PASSED: "测试通过",
  DONE: "已完成",
  BLOCKED: "已阻塞",
  TO_ASSIGN: "待分配",
  TO_FIX: "待修复",
  FIXING: "修复中",
  FIXED: "已修复",
  TO_VERIFY: "待验证",
  VERIFIED: "已验证",
  CLOSED: "已关闭",
  REOPENED: "重新打开",
  PLANNING: "规划中",
  ROLLED_BACK: "已回滚",
  ACTIVE: "启用",
  DISABLED: "停用",
  LOCKED: "锁定",
  LEFT: "离职"
};

const positionLabels: Record<string, string> = {
  PRODUCT_MANAGER: "产品经理",
  UI: "UI",
  FRONTEND: "前端",
  BACKEND: "后端",
  DATA: "数据",
  TEST: "测试",
  OPS: "运维",
  BUSINESS: "业务"
};

const dictionaryTypeMeta: Record<string, { name: string; usage: string }> = {
  PROJECT_STAGE: {
    name: "项目阶段",
    usage: "用于项目新建/编辑的当前阶段，以及项目中心的阶段展示。"
  },
  REQUIREMENT_STATUS: {
    name: "需求状态",
    usage: "用于需求评审、开发、完成、取消、变更、优化等主流程状态展示和流转。上线相关状态请维护“需求上线状态”。"
  },
  REQUIREMENT_LAUNCH_STATUS: {
    name: "需求上线状态",
    usage: "用于标记需求是否已随版本发布上线。它和需求主状态分开，主状态表示评审、开发完成、变更或优化，上线状态只表示待上线/已上线。"
  },
  REQUIREMENT_TYPE: {
    name: "需求类型",
    usage: "用于新建需求时选择功能、流程、数据、报表、体验优化等分类。"
  },
  TASK_STATUS: {
    name: "开发任务状态",
    usage: "用于开发任务列表、工作台待办、完成/阻塞等任务状态展示。"
  },
  TASK_TYPE: {
    name: "开发任务类型",
    usage: "用于拆解任务时选择 UI、前端、后端、数据、测试等工作类型。"
  },
  DEFECT_STATUS: {
    name: "缺陷状态",
    usage: "用于缺陷记录、缺陷修复待办、验证通过、版本发布拦截。"
  },
  VERSION_STATUS: {
    name: "版本状态",
    usage: "用于发布中心展示版本从规划、待发布到已发布/回滚的状态。"
  },
  VERSION_TYPE: {
    name: "版本类型",
    usage: "用于新建版本时选择常规版本、紧急修复、灰度版本等类型。"
  },
  DOCUMENT_TYPE: {
    name: "资料类型",
    usage: "用于项目资料归档时区分业务、技术、测试、上线资料。"
  }
};

function fmtDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("zh-CN");
}

function label(code?: string) {
  if (!code) return "-";
  return statusLabels[code] || positionLabels[code] || code;
}

function dictionaryTypeLabel(type: string) {
  const meta = dictionaryTypeMeta[type];
  return meta ? `${meta.name}（${type}）` : type;
}

function dictionaryTypeUsage(type: string) {
  return dictionaryTypeMeta[type]?.usage || "自定义字典类型。用于系统配置项扩展，具体使用位置需结合业务页面确认。";
}

function toDateInput(value?: string | null) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function isDue(value?: string) {
  if (!value) return false;
  return new Date(value).getTime() - Date.now() < 1000 * 60 * 60 * 24 * 2;
}

function dictionaryOptions(
  dictionaries: AdminData["dictionaries"],
  type: string,
  fallback: Array<[string, string]>
) {
  const options = dictionaries
    .filter((item) => item.type === type && item.isActive)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((item) => [item.code, item.name] as [string, string]);
  return options.length ? options : fallback;
}

const FORM_DRAFT_PREFIX = "dms_form_draft";

function readFormDraft(key: string): FormDraft | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = "values" in parsed ? (parsed as { values?: unknown }).values : parsed;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    return candidate as FormDraft;
  } catch {
    return null;
  }
}

function writeFormDraft(key: string, form: HTMLFormElement) {
  const values: FormDraft = {};
  const passwordFields = new Set(
    Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"]')).map((input) => input.name).filter(Boolean)
  );
  new FormData(form).forEach((value, name) => {
    if (passwordFields.has(name) || typeof value !== "string") return;
    const existing = values[name];
    if (existing === undefined) {
      values[name] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      values[name] = [existing, value];
    }
  });
  window.localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), values }));
}

function clearFormDraft(key: string) {
  if (key) window.localStorage.removeItem(key);
}

function draftValue(draft: FormDraft | null, name: string, fallback?: string | number | null) {
  const value = draft?.[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? fallback ?? "";
}

function draftArray(draft: FormDraft | null, name: string) {
  const value = draft?.[name];
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function hasDraftValues(draft: FormDraft | null) {
  return Boolean(draft && Object.keys(draft).length);
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
  const [adminEdit, setAdminEdit] = useState<AdminEditState>(null);

  const isProductManager = auth?.user.positions.includes("PRODUCT_MANAGER") || false;
  const canPublish = auth?.user.positions.some((item) => item === "PRODUCT_MANAGER" || item === "TEST") || false;
  const canTest = canPublish;
  const availablePeople = admin?.people || (auth?.person ? [auth.person] : []);
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
    const [wb, ps, reqs, ts, bugs, vers] = await Promise.all([
      api<any>("/workbench"),
      api<Project[]>("/projects"),
      api<Requirement[]>("/requirements"),
      api<DevTask[]>("/tasks"),
      api<Defect[]>("/defects"),
      api<ReleaseVersion[]>("/versions")
    ]);
    setWorkbench(wb);
    setProjects(ps);
    setRequirements(reqs);
    setTasks(ts);
    setDefects(bugs);
    setVersions(vers);
    if (!selectedProjectId && ps[0]) setSelectedProjectId(ps[0].id);
    if (isProductManager) {
      try {
        setAdmin(await api<AdminData>("/admin/bootstrap"));
      } catch {
        setAdmin(null);
      }
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

  async function handleAction(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await loadAll();
      if (selectedProjectId) {
        setProjectDetail(await api<any>(`/projects/${selectedProjectId}`));
      }
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
          <QuickActions openDrawer={openDrawer} isProductManager={isProductManager} canPublish={canPublish} hasProjects={projects.length > 0} />
        </header>

        {error ? <pre className="error">{error}</pre> : null}

        {view === "workbench" ? (
          <Workbench
            data={workbench}
            positions={auth.user.positions}
            onEditTask={(task) => setDrawerForSchedule("task", task)}
            onEditDefect={(defect) => setDrawerForSchedule("defect", defect)}
            onStartTask={(task) => handleAction(() => post(`/tasks/${task.id}/start`, {}))}
            onCompleteTask={(task) => handleAction(() => post(`/tasks/${task.id}/complete`, { completionNote: "工作台处理完成" }))}
            onStartTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-start`, {}))}
            onPassTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-pass`, { note: "工作台测试通过" }))}
            onCloseTask={(task) => handleAction(() => post(`/tasks/${task.id}/close`, { note: "工作台手动关闭" }))}
            onStartDefectFix={(defect) => handleAction(() => post(`/defects/${defect.id}/start-fix`, {}))}
            onCompleteDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/fix-complete`, { fixNote: "工作台完成修复" }))}
            canVerify={canTest}
            onVerifyDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/verify`, { verifyNote: "验证通过" }))}
            onRejectDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reject`, { reason: "验证未通过" }))}
            onCloseDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/close`, { reason: "手动关闭" }))}
            onReopenDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reopen`, { reason: "重新开启" }))}
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
            onStartTask={(task) => handleAction(() => post(`/tasks/${task.id}/start`, {}))}
            onCompleteTask={(task) => handleAction(() => post(`/tasks/${task.id}/complete`, { completionNote: "项目中心处理完成" }))}
            onStartTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-start`, {}))}
            onPassTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-pass`, { note: "项目中心测试通过" }))}
            onCloseTask={(task) => handleAction(() => post(`/tasks/${task.id}/close`, { note: "项目中心手动关闭" }))}
            onStartDefectFix={(defect) => handleAction(() => post(`/defects/${defect.id}/start-fix`, {}))}
            onCompleteDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/fix-complete`, { fixNote: "项目中心完成修复" }))}
            onVerifyDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/verify`, { verifyNote: "验证通过" }))}
            onRejectDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reject`, { reason: "验证未通过" }))}
            onCloseDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/close`, { reason: "手动关闭" }))}
            onReopenDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reopen`, { reason: "重新开启" }))}
            canTest={canTest}
            isProductManager={isProductManager}
          />
        ) : null}

        {view === "execution" ? (
          <ExecutionCenter
            tasks={tasks}
            defects={defects}
            onStartTask={(task) => handleAction(() => post(`/tasks/${task.id}/start`, {}))}
            onCompleteTask={(task) => handleAction(() => post(`/tasks/${task.id}/complete`, { completionNote: "执行中心处理完成" }))}
            onStartTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-start`, {}))}
            onPassTaskTest={(task) => handleAction(() => post(`/tasks/${task.id}/test-pass`, { note: "执行中心测试通过" }))}
            onCloseTask={(task) => handleAction(() => post(`/tasks/${task.id}/close`, { note: "执行中心手动关闭" }))}
            onStartDefectFix={(defect) => handleAction(() => post(`/defects/${defect.id}/start-fix`, {}))}
            onCompleteDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/fix-complete`, { fixNote: "执行中心完成修复" }))}
            canVerify={canTest}
            onVerifyDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/verify`, { verifyNote: "验证通过" }))}
            onRejectDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reject`, { reason: "验证未通过" }))}
            onCloseDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/close`, { reason: "手动关闭" }))}
            onReopenDefect={(defect) => handleAction(() => post(`/defects/${defect.id}/reopen`, { reason: "重新开启" }))}
            isProductManager={isProductManager}
          />
        ) : null}

        {view === "release" ? (
          <ReleaseCenter versions={versions} canPublish={canPublish} onPublish={(version) => handleAction(() => post(`/versions/${version.id}/publish`, { releaseConclusion: "成功" }))} />
        ) : null}

        {view === "admin" && isProductManager ? (
          <AdminCenter
            data={admin}
            onNewPerson={() => setAdminEdit({ kind: "personAccount" })}
            onEdit={setAdminEdit}
            onAdminPost={(path, body) => handleAction(() => post(path, body))}
          />
        ) : null}
      </main>

      <AdminEditDialog
        state={adminEdit}
        data={admin}
        onClose={() => setAdminEdit(null)}
        onSubmit={async (path, body) => {
          const success = await handleAction(() => post(path, body));
          if (success) setAdminEdit(null);
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
          if (kind === "requirement" && drawerContext.requirementId && drawerContext.revisionMode) {
            return handleAction(() => post(`/requirements/${drawerContext.requirementId}/revision`, { ...body, mode: drawerContext.revisionMode }));
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
          return handleAction(() => post(map[kind], body));
        }}
      />
    </div>
  );

  function setDrawerForSchedule(type: "task" | "defect", item: DevTask | Defect) {
    const date = window.prompt("计划完成时间，格式 YYYY-MM-DD", type === "task" ? (item as DevTask).plannedFinishDate?.slice(0, 10) || "" : (item as Defect).plannedFixDate?.slice(0, 10) || "");
    if (date === null) return;
    if (type === "task") {
      void handleAction(() => patch(`/tasks/${item.id}`, { plannedFinishDate: date }));
    } else {
      void handleAction(() => patch(`/defects/${item.id}`, { plannedFixDate: date }));
    }
  }
}

function QuickActions({
  openDrawer,
  isProductManager,
  canPublish,
  hasProjects
}: {
  openDrawer: (kind: DrawerKind, context?: DrawerContext) => void;
  isProductManager: boolean;
  canPublish: boolean;
  hasProjects: boolean;
}) {
  const projectRequiredTitle = hasProjects ? undefined : "请先新建项目";
  return (
    <div className="actions">
      {isProductManager ? (
        <>
          <button onClick={() => openDrawer("project")} title="新建项目">
            <Plus size={17} /> 新建项目
          </button>
          <button onClick={() => openDrawer("requirement")} title={projectRequiredTitle || "新建需求"} disabled={!hasProjects}>
            <ClipboardList size={17} /> 新建需求
          </button>
        </>
      ) : null}
      <button onClick={() => openDrawer("document")} title={projectRequiredTitle || "新增资料"} disabled={!hasProjects}>
        <Archive size={17} /> 新增资料
      </button>
      {canPublish ? (
        <button onClick={() => openDrawer("version")} title={projectRequiredTitle || "新建版本"} disabled={!hasProjects}>
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
  canTest,
  isProductManager
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
  canTest: boolean;
  isProductManager: boolean;
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
          <div className="project-summary">
            <div>
              <p className="eyebrow">{label(detail.stage)}</p>
              <h2>{detail.name}</h2>
              <p>{detail.scope}</p>
            </div>
            <div className="project-meta-grid">
              <span>项目编号<strong>{detail.code}</strong></span>
              <span>计划周期<strong>{fmtDate(detail.plannedStartDate)} - {fmtDate(detail.plannedEndDate)}</strong></span>
              <span>期望上线<strong>{fmtDate(detail.expectedLaunchDate)}</strong></span>
              <span>项目负责人<strong>{detail.owner?.name || "-"}</strong></span>
            </div>
            <div className="actions">
              <button onClick={() => onNew("requirement", { projectId: detail.id })}>
                <Plus size={17} /> 需求
              </button>
              <button onClick={() => onNew("document", { projectId: detail.id })}>
                <Plus size={17} /> 资料
              </button>
            </div>
          </div>
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
              isProductManager={isProductManager}
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
  isProductManager
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
            <th>分数</th>
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
                {onNewDefect ? <button className="compact" onClick={() => onNewDefect(task)}><Plus size={15} /> 缺陷</button> : null}
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
            <th>分数</th>
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
  isProductManager
}: {
  requirements: Requirement[];
  project?: Project | null;
  onNewTask: (requirement: Requirement) => void;
  onRevision: (requirement: Requirement, revisionMode: "CHANGE" | "OPTIMIZATION") => void;
  isProductManager?: boolean;
}) {
  const canOperateRequirement = (requirement: Requirement) => !["CHANGE", "OPTIMIZATION"].includes(requirement.status);
  const canCreateTask = (requirement: Requirement) => ["APPROVED", "DEVELOPING"].includes(requirement.status);
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
            <th>分数</th>
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
                <button className="compact" disabled={!canCreateTask(item)} title={canCreateTask(item) ? "创建任务" : "评审通过或开发中才可以创建任务"} onClick={() => onNewTask(item)}>
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
  people: Array<{ id: number; name: string }>;
  positions: Array<{ code: string; name: string; isActive?: boolean }>;
  dictionaries: AdminData["dictionaries"];
  requirementPriorities: AdminData["requirementPriorities"];
  defectPriorities: AdminData["defectPriorities"];
  onSubmit: (kind: Exclude<DrawerKind, null>, body: any) => Promise<boolean>;
}) {
  const activeKind = kind;
  const draftScope = context.taskId
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
  useEffect(() => {
    setDraftMessage("");
  }, [draftKey]);
  if (!activeKind) return null;
  const activeDrawerKind = activeKind;
  const selectedProject = context.projectId ? projects.find((project) => project.id === context.projectId) : null;
  const selectedTask = context.taskId ? tasks.find((task) => task.id === context.taskId) : null;
  const selectedRequirement = context.requirementId
    ? requirements.find((requirement) => requirement.id === context.requirementId)
    : selectedTask?.requirement || null;
  const contextProject = selectedProject || selectedTask?.project || selectedRequirement?.project || (selectedRequirement?.projectId ? projects.find((project) => project.id === selectedRequirement.projectId) : null);
  const currentPositionCode = currentUser.primaryPosition || currentUser.positions[0] || "";
  const currentPersonId = currentPerson?.id || currentUser.personId;
  const projectStageOptions = dictionaryOptions(dictionaries, "PROJECT_STAGE", [
    ["INITIATED", "已立项"],
    ["RESEARCHING", "需求调研"],
    ["SOLUTION_DESIGN", "方案设计"],
    ["DEV_TEST", "系统开发与测试"],
    ["ONLINE_OPS", "上线运维"],
    ["CLOSED", "已结项"]
  ]);
  const requirementTypeOptions = dictionaryOptions(dictionaries, "REQUIREMENT_TYPE", [["FEATURE", "功能需求"], ["PROCESS", "流程需求"], ["DATA", "数据需求"], ["REPORT", "报表需求"], ["UX", "体验优化"]]);
  const requirementLaunchStatusOptions = dictionaryOptions(dictionaries, "REQUIREMENT_LAUNCH_STATUS", [["TO_RELEASE", "待上线"], ["RELEASED", "已上线"]]);
  const taskTypeOptions = positions.length ? positions.filter((item) => item.isActive !== false).map((item) => [item.code, item.name] as [string, string]) : dictionaryOptions(dictionaries, "TASK_TYPE", [["UI", "UI设计"], ["FRONTEND", "前端开发"], ["BACKEND", "后端开发"], ["DATA", "数据开发"], ["TEST", "测试验证"]]);
  const versionTypeOptions = dictionaryOptions(dictionaries, "VERSION_TYPE", [["NORMAL", "常规版本"], ["HOTFIX", "紧急修复"], ["GRAY", "灰度版本"]]);
  const documentTypeOptions = dictionaryOptions(dictionaries, "DOCUMENT_TYPE", [["BUSINESS", "业务资料"], ["TECH", "技术资料"], ["TEST", "测试资料"], ["RELEASE", "上线资料"]]);
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
    const form = new FormData(event.currentTarget);
    const body: Record<string, any> = Object.fromEntries(form.entries());
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
    setDraftMessage("草稿已清除。");
    setDraftStamp((value) => value + 1);
  }

  return (
    <div className="drawer-backdrop">
      <aside className="drawer">
        <div className="section-title">
          <h2>{activeDrawerKind === "requirement" && context.revisionMode ? (context.revisionMode === "OPTIMIZATION" ? "需求优化" : "需求变更") : titles[activeDrawerKind]}</h2>
          <button className="ghost" onClick={onClose}>关闭</button>
        </div>
        <form key={`${draftKey}:${draftStamp}`} className="drawer-form" onSubmit={submit}>
          {activeDrawerKind === "project" ? (
            <>
              <Field name="name" label="项目名称" required defaultValue={draftValue(draft, "name")} />
              <Textarea name="scope" label="需求范围" required defaultValue={draftValue(draft, "scope")} />
              <Field name="plannedStartDate" label="计划开始时间" type="date" defaultValue={draftValue(draft, "plannedStartDate")} />
              <Field name="plannedEndDate" label="计划结束时间" type="date" defaultValue={draftValue(draft, "plannedEndDate")} />
              <Field name="expectedLaunchDate" label="期望上线时间" type="date" defaultValue={draftValue(draft, "expectedLaunchDate")} />
              <Select name="stage" label="当前阶段" options={projectStageOptions} defaultValue={draftValue(draft, "stage", "INITIATED")} />
              <PeopleSelect name="ownerId" label="项目负责人" people={people} defaultValue={draftValue(draft, "ownerId")} />
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
                <ProjectSelect projects={projects} defaultValue={draftValue(draft, "projectId")} />
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
                </>
              ) : (
                <Select name="requirementId" label="关联需求" options={requirements.map((item) => [String(item.id), item.title])} defaultValue={draftValue(draft, "requirementId")} />
              )}
              <Field name="title" label="任务标题" required defaultValue={draftValue(draft, "title")} />
              <Select name="type" label="任务类型（按岗位带出）" options={taskTypeOptions} defaultValue={draftValue(draft, "type", currentPositionCode)} />
              <PeopleSelect name="assigneeId" label="负责人" people={people} defaultValue={draftValue(draft, "assigneeId", currentPersonId)} />
              <Field name="plannedStartDate" label="计划开始时间" type="date" defaultValue={draftValue(draft, "plannedStartDate")} />
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
                <Select name="taskId" label="关联任务" required defaultValue={draftValue(draft, "taskId")} options={tasks.map((item) => [String(item.id), `${item.title} / ${item.requirement?.title || "-"}`])} />
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
              <ProjectSelect projects={projects} defaultValue={draftValue(draft, "projectId")} />
              <Field name="name" label="版本名称" required defaultValue={draftValue(draft, "name")} />
              <Select name="type" label="版本类型" options={versionTypeOptions} defaultValue={draftValue(draft, "type")} />
              <Field name="plannedReleaseAt" label="计划上线时间" type="date" defaultValue={draftValue(draft, "plannedReleaseAt")} />
              <MultiSelect name="requirementIds" label="上线需求" options={requirements.filter((item) => item.status === "COMPLETED" && (item.launchStatus || "TO_RELEASE") === "TO_RELEASE").map((item) => [String(item.id), item.title])} defaultValue={draftArray(draft, "requirementIds")} />
              <MultiSelect name="defectIds" label="修复缺陷" options={defects.map((item) => [String(item.id), item.title])} defaultValue={draftArray(draft, "defectIds")} />
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

function ProjectSelect({ projects, defaultValue }: { projects: Project[]; defaultValue?: string | number | null }) {
  return <Select name="projectId" label="所属项目" defaultValue={defaultValue} options={projects.map((project) => [String(project.id), project.name])} />;
}

function PeopleSelect({ name, label: text, people, defaultValue }: { name: string; label: string; people: Array<{ id: number; name: string }>; defaultValue?: string | number | null }) {
  return <Select name={name} label={text} defaultValue={defaultValue} options={[["", "未指定"], ...people.map((person) => [String(person.id), person.name] as [string, string])]} />;
}

function Field({
  name,
  label: text,
  type = "text",
  required,
  defaultValue,
  value,
  disabled,
  onChange
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number | null;
  value?: string | number | null;
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  const inputProps = value === undefined ? { defaultValue: defaultValue ?? "" } : { value: value ?? "" };
  return (
    <label className={required ? "field required" : "field"}>
      <span className="field-label">{text}{required ? <span className="required-mark">必填</span> : null}</span>
      <input name={name} type={type} required={required} disabled={disabled} onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined} {...inputProps} />
    </label>
  );
}

function Textarea({ name, label: text, required, defaultValue }: { name: string; label: string; required?: boolean; defaultValue?: string | number | null }) {
  return (
    <label className={required ? "field required" : "field"}>
      <span className="field-label">{text}{required ? <span className="required-mark">必填</span> : null}</span>
      <textarea name={name} required={required} defaultValue={defaultValue ?? ""} />
    </label>
  );
}

function Select({
  name,
  label: text,
  options,
  defaultValue,
  value,
  disabled,
  required,
  onChange
}: {
  name: string;
  label: string;
  options: Array<[string, string]>;
  defaultValue?: string | number | null;
  value?: string | number | null;
  disabled?: boolean;
  required?: boolean;
  onChange?: (value: string) => void;
}) {
  const selectProps = value === undefined ? { defaultValue: defaultValue ?? "" } : { value: value ?? "" };
  return (
    <label className={required ? "field required" : "field"}>
      <span className="field-label">{text}{required ? <span className="required-mark">必填</span> : null}</span>
      <select name={name} disabled={disabled} required={required} onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined} {...selectProps}>
        {options.map(([value, name]) => (
          <option key={`${value}-${name}`} value={value}>{name}</option>
        ))}
      </select>
    </label>
  );
}

function MultiSelect({ name, label: text, options, defaultValue }: { name: string; label: string; options: Array<[string, string]>; defaultValue?: string[] }) {
  return (
    <label className="field">
      <span className="field-label">{text}</span>
      <select name={name} multiple size={Math.min(6, Math.max(3, options.length))} defaultValue={defaultValue || []}>
        {options.map(([value, name]) => (
          <option key={`${value}-${name}`} value={value}>{name}</option>
        ))}
      </select>
    </label>
  );
}

function ReadonlyField({ name, label: text, value, displayValue }: { name: string; label: string; value?: string | number | null; displayValue?: string | number | null }) {
  return (
    <label className="field readonly-field">
      <span className="field-label">{text}</span>
      <input value={displayValue ?? value ?? "-"} readOnly aria-readonly="true" />
      <input type="hidden" name={name} value={value ?? ""} />
    </label>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className={`metric ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({ value }: { value: string }) {
  return <span className="badge">{value}</span>;
}

function ListSection<T>({ title, items, render }: { title: string; items: T[]; render: (item: T) => ReactNode }) {
  return (
    <section className="list-section">
      <div className="section-title">
        <h2>{title}</h2>
      </div>
      <div className="list-stack">
        {items?.length ? items.map((item, index) => <div key={index}>{render(item)}</div>) : <EmptyState text="暂无数据" />}
      </div>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
