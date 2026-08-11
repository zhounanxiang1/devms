import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  DefectStatus,
  EmploymentStatus,
  Prisma,
  ProjectStage,
  RequirementLaunchStatus,
  RequirementRevisionType,
  RequirementStatus,
  TaskStatus,
  VersionStatus
} from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "./prisma.service";
import { AuthUser } from "./types";
import { PRODUCT_MANAGER, requireAnyPosition, TEST } from "./authz";
import { businessDate, formatBusinessCode, formatTypedBusinessCode, pickDefined, toBool, toDate, toInt, toNullableInt } from "./utils";

const includePerson = {
  organization: true,
  primaryPosition: true,
  positions: { include: { position: true } }
} satisfies Prisma.PersonInclude;

const DEFAULT_INITIAL_PASSWORD = "123";

const REQUIREMENT_REVISION_BONUS: Record<RequirementRevisionType, Record<RequirementLaunchStatus, number>> = {
  [RequirementRevisionType.CHANGE]: {
    [RequirementLaunchStatus.TO_RELEASE]: 6,
    [RequirementLaunchStatus.RELEASED]: 15
  },
  [RequirementRevisionType.OPTIMIZATION]: {
    [RequirementLaunchStatus.TO_RELEASE]: 3,
    [RequirementLaunchStatus.RELEASED]: 6
  }
};

const REQUIREMENT_TYPE_CODE_MAP: Record<string, string> = {
  FEATURE: "FN",
  PROCESS: "PR",
  DATA: "DA",
  REPORT: "RP",
  UX: "UX",
  NON_FUNCTIONAL: "NF"
};
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  BUSINESS: "业务资料",
  TECH: "技术资料",
  TEST: "测试资料",
  RELEASE: "上线资料"
};

const QUALITY_POSITIONS = [PRODUCT_MANAGER, TEST];
const TASK_CREATOR_POSITIONS = [PRODUCT_MANAGER, "UI", "FRONTEND", "BACKEND", "DATA", "OPS"];
const TERMINAL_VERSION_STATUSES: VersionStatus[] = [VersionStatus.RELEASED, VersionStatus.ROLLED_BACK, VersionStatus.CANCELED];
const REQUIREMENT_SUPPLEMENT_ALLOWED_STATUSES: RequirementStatus[] = [
  RequirementStatus.TO_REVIEW,
  RequirementStatus.APPROVED,
  RequirementStatus.REJECTED,
  RequirementStatus.NEEDS_SUPPLEMENT,
  RequirementStatus.DEFERRED,
  RequirementStatus.DEVELOPING
];
const TASK_OWNER_EDITABLE_STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.DOING];
const DEFECT_OWNER_EDITABLE_STATUSES: DefectStatus[] = [DefectStatus.TO_FIX, DefectStatus.FIXING];
const DEFAULT_BOARD_RULE_CONFIG = {
  id: 1,
  dueSoonDays: 2,
  normalLoadLimit: 5,
  saturatedLoadLimit: 10,
  staleProjectDays: 7,
  highPriorityThreshold: 40,
  includeClosedItems: false
};

function normalizeDefectEnvironment(value?: unknown) {
  return String(value || "OFFLINE").toUpperCase() === "ONLINE" ? "ONLINE" : "OFFLINE";
}

function requirementTypeCode(value?: unknown) {
  const normalized = String(value || "FEATURE").trim().toUpperCase();
  if (REQUIREMENT_TYPE_CODE_MAP[normalized]) return REQUIREMENT_TYPE_CODE_MAP[normalized];
  const compact = normalized.replace(/[^A-Z0-9]/g, "");
  if (compact.length >= 2) return compact.slice(0, 2);
  if (compact.length === 1) return `${compact}X`;
  return "OT";
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toNonNegativeNumber(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function richTextPlain(value: unknown) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

@Injectable()
export class CoreService {
  constructor(private readonly prisma: PrismaService) {}

  private async nextBusinessCode(prefix: string) {
    const bizDate = businessDate();
    const sequence = await this.prisma.codeSequence.upsert({
      where: { prefix_bizDate: { prefix, bizDate } },
      create: { prefix, bizDate, currentValue: 1 },
      update: { currentValue: { increment: 1 } },
      select: { currentValue: true }
    });
    return formatBusinessCode(prefix, bizDate, sequence.currentValue);
  }

  private async nextTypedBusinessCode(prefix: string, typeCode: string) {
    const bizDate = businessDate();
    const sequencePrefix = `${prefix}-${typeCode}`;
    const sequence = await this.prisma.codeSequence.upsert({
      where: { prefix_bizDate: { prefix: sequencePrefix, bizDate } },
      create: { prefix: sequencePrefix, bizDate, currentValue: 1 },
      update: { currentValue: { increment: 1 } },
      select: { currentValue: true }
    });
    return formatTypedBusinessCode(prefix, bizDate, typeCode, sequence.currentValue);
  }

  private async nextRequirementCode(type: string) {
    return this.nextTypedBusinessCode("REQ", requirementTypeCode(type));
  }

  async log(input: {
    user?: AuthUser;
    entityType: string;
    entityId?: number;
    action: string;
    summary: string;
    projectId?: number;
    requirementId?: number;
    taskId?: number;
    defectId?: number;
    versionId?: number;
    beforeJson?: unknown;
    afterJson?: unknown;
  }) {
    await this.prisma.activityLog.create({
      data: {
        actorId: input.user?.personId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        summary: input.summary,
        projectId: input.projectId,
        requirementId: input.requirementId,
        taskId: input.taskId,
        defectId: input.defectId,
        versionId: input.versionId,
        beforeJson: input.beforeJson as Prisma.InputJsonValue,
        afterJson: input.afterJson as Prisma.InputJsonValue
      }
    });
  }

  async getPersonForAccount(accountId: number) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: {
        person: { include: includePerson }
      }
    });
    if (!account) throw new NotFoundException("账号不存在");
    return account;
  }

  async workbench(user: AuthUser) {
    const [tasks, defects] = await Promise.all([
      this.prisma.devTask.findMany({
        where: {
          OR: [{ assigneeId: user.personId }, { testerId: user.personId }]
        },
        include: {
          project: true,
          requirement: true,
          assignee: true,
          tester: true,
          creator: true,
          defects: true,
          documents: { include: { document: { include: { createdBy: true } } } }
        },
        orderBy: [{ priorityScore: "desc" }, { plannedFinishDate: "asc" }]
      }),
      this.prisma.defect.findMany({
        where: {
          OR: [{ assigneeId: user.personId }, { testerId: user.personId }]
        },
        include: { project: true, task: { include: { requirement: true } }, assignee: true, tester: true, reporter: true, version: true },
        orderBy: [{ priorityScore: "desc" }, { plannedFinishDate: "asc" }, { plannedFixDate: "asc" }]
      })
    ]);
    const now = Date.now();
    const isDue = (date?: Date | null) => date ? date.getTime() - now < 1000 * 60 * 60 * 24 * 2 : false;
    return {
      user,
      summary: {
        developmentTasks: tasks.length,
        defectTasks: defects.length,
        dueSoon: tasks.filter((task) => isDue(task.plannedFinishDate)).length + defects.filter((defect) => isDue(defect.plannedFinishDate || defect.plannedFixDate)).length
      },
      developmentTasks: tasks,
      defectTasks: defects
    };
  }

  canVerify(user: AuthUser) {
    return user.positions.includes(PRODUCT_MANAGER) || user.positions.includes(TEST);
  }

  private async ensureProductManagerOwner(ownerId?: number | null) {
    if (!ownerId) throw new BadRequestException("项目负责人必填");
    const owner = await this.prisma.person.findUnique({
      where: { id: ownerId },
      include: includePerson
    });
    const ownerPositions = new Set([
      owner?.primaryPosition?.code,
      ...(owner?.positions.map((item) => item.position.code) || [])
    ].filter(Boolean));
    if (!owner || !ownerPositions.has(PRODUCT_MANAGER)) {
      throw new BadRequestException("项目负责人只能选择产品经理岗位人员");
    }
    return ownerId;
  }

  private canManageProject(user: AuthUser, project: { ownerId?: number | null }) {
    return project.ownerId === user.personId || user.positions.includes(PRODUCT_MANAGER);
  }

  private requireProjectManager(user: AuthUser, project: { ownerId?: number | null }) {
    if (!this.canManageProject(user, project)) {
      throw new ForbiddenException("只有产品经理或项目负责人可以操作项目");
    }
  }

  private requireAssignee(user: AuthUser, item: { assigneeId?: number | null }, message: string) {
    if (!item.assigneeId) {
      throw new ForbiddenException("负责人为空，不能执行该操作");
    }
    if (item.assigneeId !== user.personId) {
      throw new ForbiddenException(message);
    }
  }

  private requirePersonId(value: unknown, message: string) {
    const id = toInt(value as string | number | undefined | null);
    if (!id) throw new BadRequestException(message);
    return id;
  }

  private hasTaskScheduleChange(body: any) {
    return body.plannedStartDate !== undefined || body.plannedFinishDate !== undefined;
  }

  private hasDefectScheduleChange(body: any) {
    return body.plannedStartDate !== undefined || body.plannedFinishDate !== undefined || body.plannedFixDate !== undefined;
  }

  private async assertProjectOpen(projectId: number, action: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, stage: true } });
    if (!project) throw new NotFoundException("项目不存在");
    if (project.stage === ProjectStage.CLOSED) {
      throw new BadRequestException(`项目已结项，不能${action}`);
    }
    return project;
  }

  private dateOnly(value?: Date | null) {
    if (!value) return undefined;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  private assertScheduleWithinProjectPlan(
    project: { plannedStartDate?: Date | null; plannedEndDate?: Date | null; name?: string | null },
    plannedStartDate?: Date | null,
    plannedFinishDate?: Date | null
  ) {
    const start = this.dateOnly(plannedStartDate);
    const finish = this.dateOnly(plannedFinishDate);
    if (!start && !finish) return;
    const projectStart = this.dateOnly(project.plannedStartDate);
    const projectEnd = this.dateOnly(project.plannedEndDate);
    if (projectStart && projectEnd && projectStart.getTime() > projectEnd.getTime()) {
      throw new BadRequestException("项目计划周期异常，计划开始时间不能晚于计划结束时间");
    }
    if (start && finish && start.getTime() > finish.getTime()) {
      throw new BadRequestException("计划开始时间不能晚于计划完成时间");
    }
    if (projectStart && [start, finish].some((date) => date && date.getTime() < projectStart.getTime())) {
      throw new BadRequestException("开发排期不能早于项目计划开始时间");
    }
    if (projectEnd && [start, finish].some((date) => date && date.getTime() > projectEnd.getTime())) {
      throw new BadRequestException("开发排期不能晚于项目计划结束时间");
    }
  }

  private async setProjectStage(user: AuthUser, projectId: number, targetStage: ProjectStage, summary: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.stage === ProjectStage.CLOSED) return;
    if (project.stage === targetStage) return;
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { stage: targetStage }
    });
    await this.log({
      user,
      entityType: "PROJECT",
      entityId: projectId,
      projectId,
      action: "STAGE_CHANGE",
      summary,
      beforeJson: project,
      afterJson: updated
    });
  }

  private toNumberIds(values: unknown) {
    if (values === undefined || values === null || values === "") return [];
    const source = Array.isArray(values) ? values : [values];
    return Array.from(new Set(source.map(Number).filter(Number.isFinite)));
  }

  private async assertProjectDocuments(
    tx: Prisma.TransactionClient,
    projectId: number,
    documentIds: number[],
    allowedTypes: string[],
    actionLabel: string
  ) {
    if (!documentIds.length) return [];
    const documents = await tx.projectDocument.findMany({
      where: { id: { in: documentIds } },
      select: { id: true, name: true, projectId: true, type: true }
    });
    const foundIds = new Set(documents.map((document) => document.id));
    const invalidDocuments = [
      ...documentIds.filter((documentId) => !foundIds.has(documentId)).map((documentId) => ({ id: documentId, name: "资料不存在" })),
      ...documents.filter((document) => document.projectId !== projectId || !allowedTypes.includes(document.type))
    ];
    if (invalidDocuments.length) {
      const allowedTypeText = allowedTypes.map((type) => DOCUMENT_TYPE_LABELS[type] || type).join("、");
      throw new BadRequestException({
        message: `${actionLabel}只能关联当前项目下的${allowedTypeText}`,
        invalidDocuments
      });
    }
    return documents;
  }

  private async linkExistingRequirementDocuments(
    tx: Prisma.TransactionClient,
    requirement: { id: number; projectId: number },
    body: any
  ) {
    const documents = await this.assertProjectDocuments(tx, requirement.projectId, this.toNumberIds(body.documentIds), ["BUSINESS"], "需求");
    if (!documents.length) return [];
    await tx.requirementDocument.createMany({
      data: documents.map((document) => ({
        requirementId: requirement.id,
        documentId: document.id
      })),
      skipDuplicates: true
    });
    return documents;
  }

  private async linkExistingTaskDocuments(
    tx: Prisma.TransactionClient,
    task: { id: number; projectId: number },
    body: any
  ) {
    const documents = await this.assertProjectDocuments(tx, task.projectId, this.toNumberIds(body.documentIds), ["TECH"], "开发任务");
    if (!documents.length) return [];
    await tx.taskDocument.createMany({
      data: documents.map((document) => ({
        taskId: task.id,
        documentId: document.id
      })),
      skipDuplicates: true
    });
    return documents;
  }

  private async assertVersionScope(projectId: number, requirementIds: number[], defectIds: number[]) {
    const [selectedRequirements, selectedDefects] = await Promise.all([
      requirementIds.length
        ? this.prisma.requirement.findMany({
            where: { id: { in: requirementIds } },
            select: { id: true, title: true, projectId: true, status: true, launchStatus: true }
          })
        : [],
      defectIds.length
        ? this.prisma.defect.findMany({
            where: { id: { in: defectIds } },
            select: { id: true, title: true, projectId: true, status: true }
          })
        : []
    ]);
    const selectedRequirementIds = new Set(selectedRequirements.map((item) => item.id));
    const selectedDefectIds = new Set(selectedDefects.map((item) => item.id));
    const missingRequirements = requirementIds.filter((id) => !selectedRequirementIds.has(id)).map((id) => ({ id, title: "需求不存在" }));
    const missingDefects = defectIds.filter((id) => !selectedDefectIds.has(id)).map((id) => ({ id, title: "缺陷不存在" }));
    const invalidRequirements = [
      ...missingRequirements,
      ...selectedRequirements.filter(
        (item) => item.projectId !== projectId || item.status !== RequirementStatus.COMPLETED || item.launchStatus !== RequirementLaunchStatus.TO_RELEASE
      )
    ];
    const invalidDefects = [
      ...missingDefects,
      ...selectedDefects.filter((item) => item.projectId !== projectId || (item.status !== DefectStatus.VERIFIED && item.status !== DefectStatus.CLOSED))
    ];
    if (invalidRequirements.length || invalidDefects.length) {
      throw new BadRequestException({
        message: "版本范围只能选择当前项目下已完成且待上线的需求，以及已验证或已关闭的缺陷",
        invalidRequirements,
        invalidDefects
      });
    }
  }

  private async taskTypeForAssignee(assigneeId: number) {
    const assignee = await this.prisma.person.findUnique({
      where: { id: assigneeId },
      include: includePerson
    });
    if (!assignee) throw new NotFoundException("负责人不存在");
    const taskType = assignee.primaryPosition?.code || assignee.positions.find((item) => item.isPrimary)?.position.code || assignee.positions[0]?.position.code;
    if (!taskType) throw new BadRequestException("负责人未配置岗位，无法自动带出任务类型");
    return taskType;
  }

  private personHasPosition(person: { primaryPosition?: { code: string } | null; positions?: Array<{ position: { code: string } }> }, allowed: string[]) {
    return Boolean(
      (person.primaryPosition?.code && allowed.includes(person.primaryPosition.code)) ||
      person.positions?.some((item) => allowed.includes(item.position.code))
    );
  }

  private async ensureTester(testerId?: number | null) {
    if (!testerId) return undefined;
    const tester = await this.prisma.person.findUnique({ where: { id: testerId }, include: includePerson });
    if (!tester) throw new NotFoundException("测试负责人不存在");
    if (!this.personHasPosition(tester, [TEST])) {
      throw new BadRequestException("开发任务的测试负责人只能选择测试岗位人员");
    }
    return testerId;
  }

  private async ensureQualityOwner(testerId?: number | null) {
    if (!testerId) return undefined;
    const tester = await this.prisma.person.findUnique({ where: { id: testerId }, include: includePerson });
    if (!tester) throw new NotFoundException("测试负责人不存在");
    if (!this.personHasPosition(tester, QUALITY_POSITIONS)) {
      throw new BadRequestException("缺陷测试负责人只能选择产品经理或测试岗位人员");
    }
    return testerId;
  }

  private requireAssignedTester(item: { testerId?: number | null }, message: string) {
    if (!item.testerId) {
      throw new ForbiddenException(message);
    }
    return item.testerId;
  }

  async calculateRequirementScore(
    priorityLevel: string,
    timingBonus = 0,
    context?: { revisionType?: RequirementRevisionType | null; launchStatus?: RequirementLaunchStatus | null }
  ) {
    const priority = await this.prisma.requirementPriority.findUnique({ where: { code: priorityLevel || "P4" } });
    const revisionBonus = context?.revisionType
      ? REQUIREMENT_REVISION_BONUS[context.revisionType]?.[context.launchStatus || RequirementLaunchStatus.TO_RELEASE] ?? 0
      : 0;
    return (priority?.baseScore ?? 0) + revisionBonus + Number(timingBonus || 0);
  }

  async calculateDefectScore(input: { level: string; environment?: string; taskId?: number | null; timingBonus?: number }) {
    const defectPriority = await this.prisma.defectPriority.findUnique({ where: { code: input.level } });
    const isOnline = String(input.environment || "").toUpperCase() === "ONLINE";
    const base = isOnline ? defectPriority?.onlineScore ?? 0 : defectPriority?.offlineScore ?? 0;
    let requirementLevel = "P4";
    if (input.taskId) {
      const task = await this.prisma.devTask.findUnique({ where: { id: input.taskId }, include: { requirement: true } });
      requirementLevel = task?.requirement?.priorityLevel || "P4";
    }
    const requirementPriority = await this.prisma.requirementPriority.findUnique({ where: { code: requirementLevel } });
    return base * (requirementPriority?.defectWeight ?? 1) + Number(input.timingBonus || 0);
  }

  async listProjects() {
    return this.prisma.project.findMany({
      include: { owner: true, _count: { select: { requirements: true, tasks: true, defects: true, versions: true } } },
      orderBy: { updatedAt: "desc" }
    });
  }

  async createProject(user: AuthUser, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以创建项目");
    const ownerId = await this.ensureProductManagerOwner(toInt(body.ownerId));
    const projectCode = await this.nextBusinessCode("PROJ");
    const project = await this.prisma.project.create({
      data: {
        code: projectCode,
        name: body.name,
        ownerId,
        scope: body.scope || "",
        plannedStartDate: toDate(body.plannedStartDate) || startOfToday(),
        plannedEndDate: toDate(body.plannedEndDate),
        expectedLaunchDate: toDate(body.expectedLaunchDate),
        stage: "INITIATED",
        background: body.background,
        goal: body.goal,
        relatedSystems: body.relatedSystems
      }
    });
    if (project.ownerId) {
      await this.prisma.projectMember.upsert({
        where: { projectId_personId: { projectId: project.id, personId: project.ownerId } },
        update: { isProjectOwner: true, responsibility: "项目负责人" },
        create: { projectId: project.id, personId: project.ownerId, isProjectOwner: true, responsibility: "项目负责人" }
      });
    }
    await this.log({ user, entityType: "PROJECT", entityId: project.id, projectId: project.id, action: "CREATE", summary: `创建项目：${project.name}` });
    return project;
  }

  async projectDetail(id: number) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        owner: true,
        members: { include: { person: { include: includePerson } } },
        documents: { include: { createdBy: true, requirements: { include: { requirement: true } }, tasks: { include: { task: true } } } },
        requirements: {
          include: {
            project: true,
            submitter: true,
            pmAcceptor: true,
            uiAcceptor: true,
            supplements: { include: { createdBy: true }, orderBy: { createdAt: "desc" } },
            documents: { include: { document: { include: { createdBy: true } } } },
            _count: { select: { tasks: true, changes: true, documents: true } }
          },
          orderBy: { updatedAt: "desc" }
        },
        tasks: {
          include: {
            assignee: true,
            tester: true,
            creator: true,
            requirement: true,
            defects: true,
            documents: { include: { document: { include: { createdBy: true } } } }
          },
          orderBy: { updatedAt: "desc" }
        },
        defects: { include: { assignee: true, tester: true, reporter: true, version: true, task: { include: { requirement: true } } }, orderBy: { updatedAt: "desc" } },
        versions: { include: { releaseOwner: true, creator: true }, orderBy: { updatedAt: "desc" } },
        logs: { include: { actor: true }, orderBy: { createdAt: "desc" }, take: 30 }
      }
    });
    if (!project) throw new NotFoundException("项目不存在");
    return project;
  }

  async updateProject(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.project.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("项目不存在");
    this.requireProjectManager(user, before);
    if (body.stage && body.stage !== before.stage) {
      throw new BadRequestException("项目阶段由启动、发布、结项和重新打开等专门操作维护，不能在普通编辑中修改");
    }
    const ownerId = body.ownerId === undefined ? undefined : await this.ensureProductManagerOwner(toInt(body.ownerId));
    const project = await this.prisma.project.update({
      where: { id },
      data: pickDefined({
        name: body.name,
        ownerId,
        scope: body.scope,
        plannedStartDate: toDate(body.plannedStartDate),
        plannedEndDate: toDate(body.plannedEndDate),
        expectedLaunchDate: toDate(body.expectedLaunchDate),
        background: body.background,
        goal: body.goal,
        relatedSystems: body.relatedSystems
      })
    });
    if (ownerId) {
      if (before.ownerId && before.ownerId !== ownerId) {
        await this.prisma.projectMember.updateMany({
          where: { projectId: id, personId: before.ownerId },
          data: { isProjectOwner: false }
        });
      }
      await this.prisma.projectMember.upsert({
        where: { projectId_personId: { projectId: project.id, personId: ownerId } },
        update: { isProjectOwner: true, responsibility: "项目负责人" },
        create: { projectId: project.id, personId: ownerId, isProjectOwner: true, responsibility: "项目负责人" }
      });
    }
    await this.log({ user, entityType: "PROJECT", entityId: project.id, projectId: project.id, action: "UPDATE", summary: `更新项目：${project.name}`, beforeJson: before, afterJson: project });
    return project;
  }

  async closeProject(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.project.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("项目不存在");
    this.requireProjectManager(user, before);
    if (before.stage === ProjectStage.CLOSED) return before;
    const project = await this.prisma.project.update({
      where: { id },
      data: {
        stage: ProjectStage.CLOSED,
        actualEndDate: before.actualEndDate || new Date()
      }
    });
    await this.log({
      user,
      entityType: "PROJECT",
      entityId: id,
      projectId: id,
      action: "CLOSE",
      summary: body.reason ? `项目结项：${body.reason}` : `项目结项：${project.name}`,
      beforeJson: before,
      afterJson: project
    });
    return project;
  }

  async startProject(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.project.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("项目不存在");
    this.requireProjectManager(user, before);
    if (before.stage === ProjectStage.CLOSED) {
      throw new BadRequestException("项目已结项，请先重新打开");
    }
    if (before.stage !== ProjectStage.INITIATED) return before;
    const project = await this.prisma.project.update({
      where: { id },
      data: {
        stage: ProjectStage.IN_PROGRESS,
        actualStartDate: before.actualStartDate || new Date()
      }
    });
    await this.log({
      user,
      entityType: "PROJECT",
      entityId: id,
      projectId: id,
      action: "START",
      summary: body.reason ? `启动项目：${body.reason}` : `启动项目：${project.name}`,
      beforeJson: before,
      afterJson: project
    });
    return project;
  }

  async reopenProject(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.project.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("项目不存在");
    this.requireProjectManager(user, before);
    if (before.stage !== ProjectStage.CLOSED) return before;
    const targetStage = body.stage === ProjectStage.IN_PROGRESS ? ProjectStage.IN_PROGRESS : ProjectStage.ONLINE_OPS;
    const project = await this.prisma.project.update({
      where: { id },
      data: {
        stage: targetStage,
        actualEndDate: null
      }
    });
    await this.log({
      user,
      entityType: "PROJECT",
      entityId: id,
      projectId: id,
      action: "REOPEN",
      summary: body.reason ? `重新打开项目：${body.reason}` : `重新打开项目：${project.name}`,
      beforeJson: before,
      afterJson: project
    });
    return project;
  }

  async listRequirements(projectId?: number) {
    return this.prisma.requirement.findMany({
      where: projectId ? { projectId } : {},
      include: {
        project: true,
        owner: true,
        submitter: true,
        pmAcceptor: true,
        uiAcceptor: true,
        supplements: { include: { createdBy: true }, orderBy: { createdAt: "desc" } },
        documents: { include: { document: { include: { createdBy: true } } } },
        _count: { select: { tasks: true, changes: true, documents: true } }
      },
      orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }]
    });
  }

  async createRequirement(user: AuthUser, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以创建需求");
    await this.assertProjectOpen(Number(body.projectId), "新增需求");
    const type = body.type || "FEATURE";
    const priorityScore = await this.calculateRequirementScore(body.priorityLevel || "P2", body.timingBonus);
    const requirementCode = await this.nextRequirementCode(type);
    const requirement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.requirement.create({
        data: {
          code: requirementCode,
          title: body.title,
          projectId: Number(body.projectId),
          type,
          priorityLevel: body.priorityLevel || "P2",
          source: body.source,
          description: body.description || "",
          acceptanceCriteria: body.acceptanceCriteria || "",
          expectedLaunchDate: toDate(body.expectedLaunchDate),
          timingBonus: Number(body.timingBonus || 0),
          timingBonusReason: body.timingBonusReason,
          priorityScore,
          ownerId: toInt(body.ownerId),
          submitterId: user.personId
        }
      });
      await this.linkExistingRequirementDocuments(tx, created, body);
      return created;
    });
    await this.log({ user, entityType: "REQUIREMENT", entityId: requirement.id, projectId: requirement.projectId, requirementId: requirement.id, action: "CREATE", summary: `创建需求：${requirement.title}` });
    return requirement;
  }

  async updateRequirement(user: AuthUser, id: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以编辑需求");
    const before = await this.prisma.requirement.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("需求不存在");
    const priorityLevel = body.priorityLevel ?? before.priorityLevel;
    const timingBonus = body.timingBonus ?? before.timingBonus;
    const priorityScore = await this.calculateRequirementScore(priorityLevel, timingBonus, {
      revisionType: before.revisionType,
      launchStatus: before.launchStatus
    });
    const requirement = await this.prisma.requirement.update({
      where: { id },
      data: pickDefined({
        title: body.title,
        type: body.type,
        priorityLevel,
        source: body.source,
        description: body.description,
        acceptanceCriteria: body.acceptanceCriteria,
        expectedLaunchDate: toDate(body.expectedLaunchDate),
        timingBonus: body.timingBonus === undefined ? undefined : Number(body.timingBonus),
        timingBonusReason: body.timingBonusReason,
        priorityScore,
        ownerId: toInt(body.ownerId)
      })
    });
    await this.recalculateDefectsForRequirement(id);
    await this.log({ user, entityType: "REQUIREMENT", entityId: id, projectId: requirement.projectId, requirementId: id, action: "UPDATE", summary: `更新需求：${requirement.title}`, beforeJson: before, afterJson: requirement });
    return requirement;
  }

  async reviewRequirement(user: AuthUser, id: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以填写需求评审结果");
    const before = await this.prisma.requirement.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("需求不存在");
    if (before.status !== RequirementStatus.TO_REVIEW && before.status !== RequirementStatus.NEEDS_SUPPLEMENT) {
      throw new BadRequestException("只有待评审或待补充的需求可以填写评审结果");
    }
    const map: Record<string, RequirementStatus> = {
      PASS: RequirementStatus.APPROVED,
      REJECT: RequirementStatus.REJECTED,
      SUPPLEMENT: RequirementStatus.NEEDS_SUPPLEMENT,
      DEFER: RequirementStatus.DEFERRED,
      CANCEL: RequirementStatus.CANCELED
    };
    const status = map[body.conclusion];
    if (!status) throw new BadRequestException("评审结论无效");
    const requirement = await this.prisma.requirement.update({
      where: { id },
      data: {
        status,
        reviewConclusion: body.conclusion,
        reviewRecord: body.reviewRecord,
        reviewDate: toDate(body.reviewDate) || new Date()
      }
    });
    await this.log({ user, entityType: "REQUIREMENT", entityId: id, projectId: requirement.projectId, requirementId: id, action: "REVIEW", summary: `填写评审结论：${body.conclusion}`, beforeJson: before, afterJson: requirement });
    return requirement;
  }

  async supplementRequirement(user: AuthUser, id: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以补充需求说明");
    const requirement = await this.prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new NotFoundException("需求不存在");
    if (!REQUIREMENT_SUPPLEMENT_ALLOWED_STATUSES.includes(requirement.status)) {
      throw new BadRequestException("只有已完成之前的需求状态可以补充需求说明");
    }
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();
    if (!title) throw new BadRequestException("补充标题必填");
    if (!richTextPlain(content)) throw new BadRequestException("补充内容必填");
    const supplement = await this.prisma.requirementSupplement.create({
      data: {
        requirementId: requirement.id,
        type: body.type || "DETAIL",
        title,
        reason: body.reason,
        content,
        impactScope: body.impactScope,
        createdById: user.personId
      },
      include: { createdBy: true }
    });
    await this.log({
      user,
      entityType: "REQUIREMENT_SUPPLEMENT",
      entityId: supplement.id,
      projectId: requirement.projectId,
      requirementId: requirement.id,
      action: "CREATE",
      summary: `补充需求说明：${title}`,
      afterJson: supplement
    });
    return supplement;
  }

  async acceptRequirement(user: AuthUser, id: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以完成需求验收");
    const before = await this.prisma.requirement.findUnique({
      where: { id },
      include: { tasks: true }
    });
    if (!before) throw new NotFoundException("需求不存在");
    if (before.status !== RequirementStatus.DEVELOPING) {
      throw new BadRequestException("只有开发中的需求可以验收完成");
    }
    if (!before.tasks.length) {
      throw new BadRequestException("需求尚未创建开发任务，不能验收完成");
    }
    const unfinishedTasks = before.tasks.filter((task) => task.status !== TaskStatus.TEST_PASSED);
    if (unfinishedTasks.length) {
      throw new BadRequestException({
        message: "需求下仍有未测试通过的任务，不能验收完成",
        unfinishedTasks: unfinishedTasks.map((task) => ({ id: task.id, title: task.title, status: task.status }))
      });
    }
    const pmConclusion = String(body.pmAcceptanceConclusion || "").trim();
    if (!pmConclusion) throw new BadRequestException("产品经理验收结论必填");
    const uiConclusion = String(body.uiAcceptanceConclusion || "").trim();
    const hasUiTask = before.tasks.some((task) => task.type === "UI");
    if (hasUiTask && !uiConclusion) throw new BadRequestException("存在 UI 任务时，UI 验收结论必填");
    const now = new Date();
    const requirement = await this.prisma.requirement.update({
      where: { id },
      data: {
        status: RequirementStatus.COMPLETED,
        pmAcceptanceConclusion: pmConclusion,
        pmAcceptedAt: now,
        pmAcceptorId: user.personId,
        uiAcceptanceConclusion: uiConclusion || undefined,
        uiAcceptedAt: uiConclusion ? now : undefined,
        uiAcceptorId: uiConclusion ? user.personId : undefined
      }
    });
    await this.log({ user, entityType: "REQUIREMENT", entityId: id, projectId: requirement.projectId, requirementId: id, action: "ACCEPT", summary: `需求验收完成：${requirement.title}`, beforeJson: before, afterJson: requirement });
    return requirement;
  }

  async createRequirementChange(user: AuthUser, requirementId: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以创建需求变更记录");
    const requirement = await this.prisma.requirement.findUnique({ where: { id: requirementId } });
    if (!requirement) throw new NotFoundException("需求不存在");
    const changeCode = await this.nextBusinessCode("CHG");
    const change = await this.prisma.requirementChange.create({
      data: {
        code: changeCode,
        title: body.title,
        projectId: requirement.projectId,
        requirementId,
        type: body.type,
        reason: body.reason || "",
        beforeContent: body.beforeContent || "",
        afterContent: body.afterContent || "",
        impactScope: body.impactScope || "",
        impactDescription: body.impactDescription,
        handlingMethod: body.handlingMethod || "CHANGE_IN_REQUIREMENT",
        reviewDate: toDate(body.reviewDate),
        reviewConclusion: body.reviewConclusion,
        linkedRequirementId: toInt(body.linkedRequirementId),
        proposerId: user.personId,
        ownerId: toInt(body.ownerId)
      }
    });
    await this.log({ user, entityType: "REQUIREMENT_CHANGE", entityId: change.id, projectId: requirement.projectId, requirementId, action: "CREATE", summary: `创建需求变更：${change.title}` });
    return change;
  }

  async createRequirementRevision(user: AuthUser, requirementId: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以发起需求变更或需求优化");
    const mode = body.mode === "OPTIMIZATION" ? RequirementStatus.OPTIMIZATION : RequirementStatus.CHANGE;
    const revisionType = body.mode === "OPTIMIZATION" ? RequirementRevisionType.OPTIMIZATION : RequirementRevisionType.CHANGE;
    const original = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
      include: { tasks: true }
    });
    if (!original) throw new NotFoundException("需求不存在");
    if (original.status === RequirementStatus.CHANGE || original.status === RequirementStatus.OPTIMIZATION) {
      throw new BadRequestException("需求已处于变更或优化终态，不能继续操作");
    }
    await this.assertProjectOpen(original.projectId, "创建需求变更或需求优化");

    const launchStatus = body.launchStatus === RequirementLaunchStatus.RELEASED ? RequirementLaunchStatus.RELEASED : RequirementLaunchStatus.TO_RELEASE;
    const priorityScore = await this.calculateRequirementScore(body.priorityLevel || original.priorityLevel || "P2", body.timingBonus, {
      revisionType,
      launchStatus
    });
    const nextType = body.type || original.type || "FEATURE";
    const nextRequirementCode = await this.nextRequirementCode(nextType);
    const taskIds = original.tasks.map((task) => task.id);
    const nextRequirement = await this.prisma.$transaction(async (tx) => {
      await tx.requirement.update({
        where: { id: original.id },
        data: { status: mode }
      });
      await tx.devTask.updateMany({
        where: { requirementId: original.id, status: { not: TaskStatus.CLOSED } },
        data: { status: TaskStatus.CLOSED, completionNote: body.reason || body.description || undefined }
      });
      if (taskIds.length) {
        await tx.defect.updateMany({
          where: { taskId: { in: taskIds }, status: { not: DefectStatus.CLOSED } },
          data: { status: DefectStatus.CLOSED }
        });
      }
      const created = await tx.requirement.create({
        data: {
          code: nextRequirementCode,
          title: body.title,
          projectId: original.projectId,
          type: nextType,
          status: RequirementStatus.TO_REVIEW,
          launchStatus,
          revisionType,
          priorityLevel: body.priorityLevel || original.priorityLevel || "P2",
          source: body.source,
          description: body.description || "",
          acceptanceCriteria: body.acceptanceCriteria || "",
          expectedLaunchDate: toDate(body.expectedLaunchDate),
          timingBonus: Number(body.timingBonus || 0),
          timingBonusReason: body.timingBonusReason,
          priorityScore,
          submitterId: user.personId,
          optimizationSourceId: original.id
        }
      });
      await this.linkExistingRequirementDocuments(tx, created, body);
      return created;
    });

    await this.log({
      user,
      entityType: "REQUIREMENT",
      entityId: original.id,
      projectId: original.projectId,
      requirementId: original.id,
      action: mode === RequirementStatus.OPTIMIZATION ? "OPTIMIZATION" : "CHANGE",
      summary: `需求${mode === RequirementStatus.OPTIMIZATION ? "优化" : "变更"}：${original.title}`
    });
    await this.log({
      user,
      entityType: "REQUIREMENT",
      entityId: nextRequirement.id,
      projectId: nextRequirement.projectId,
      requirementId: nextRequirement.id,
      action: "CREATE_FROM_REVISION",
      summary: `基于原需求创建新需求：${nextRequirement.title}`
    });
    return nextRequirement;
  }

  async listTasks(projectId?: number) {
    return this.prisma.devTask.findMany({
      where: projectId ? { projectId } : {},
      include: {
        project: true,
        requirement: true,
        assignee: true,
        tester: true,
        creator: true,
        defects: true,
        documents: { include: { document: { include: { createdBy: true } } } }
      },
      orderBy: [{ priorityScore: "desc" }, { plannedFinishDate: "asc" }]
    });
  }

  async createTask(user: AuthUser, body: any) {
    requireAnyPosition(user, TASK_CREATOR_POSITIONS, "当前岗位不能创建开发任务");
    const requirement = await this.prisma.requirement.findUnique({ where: { id: Number(body.requirementId) }, include: { project: true } });
    if (requirement && requirement.status !== RequirementStatus.APPROVED && requirement.status !== RequirementStatus.DEVELOPING) {
      throw new BadRequestException("只有评审通过或开发中的需求可以创建任务");
    }
    if (!requirement) throw new NotFoundException("需求不存在");
    await this.assertProjectOpen(requirement.projectId, "新增开发任务");
    const assigneeId = this.requirePersonId(body.assigneeId, "任务负责人必填");
    const testerId = await this.ensureTester(this.requirePersonId(body.testerId, "任务测试负责人必填"));
    const taskType = await this.taskTypeForAssignee(assigneeId);
    const taskCode = await this.nextBusinessCode("TASK");
    const plannedStartDate = toDate(body.plannedStartDate) || startOfToday();
    const plannedFinishDate = toDate(body.plannedFinishDate);
    this.assertScheduleWithinProjectPlan(requirement.project, plannedStartDate, plannedFinishDate);
    const task = await this.prisma.devTask.create({
      data: {
        code: taskCode,
        title: body.title,
        projectId: requirement.projectId,
        requirementId: requirement.id,
        type: taskType,
        status: TaskStatus.TODO,
        assigneeId,
        testerId,
        createdById: user.personId,
        plannedStartDate,
        plannedFinishDate,
        priorityScore: requirement.priorityScore
      }
    });
    if (requirement.status === RequirementStatus.APPROVED) {
      await this.prisma.requirement.update({ where: { id: requirement.id }, data: { status: RequirementStatus.DEVELOPING } });
    }
    await this.log({ user, entityType: "TASK", entityId: task.id, projectId: task.projectId, requirementId: task.requirementId, taskId: task.id, action: "CREATE", summary: `创建开发任务：${task.title}` });
    return task;
  }

  async updateTask(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.devTask.findUnique({ where: { id }, include: { project: true } });
    if (!before) throw new NotFoundException("任务不存在");
    this.requireAssignee(user, before, "只能维护自己负责的开发任务");
    if (this.hasTaskScheduleChange(body) && !TASK_OWNER_EDITABLE_STATUSES.includes(before.status)) {
      throw new BadRequestException("只有待处理或处理中的任务可以调整排期");
    }
    const plannedStartDate = body.plannedStartDate === undefined ? before.plannedStartDate : toDate(body.plannedStartDate);
    const plannedFinishDate = body.plannedFinishDate === undefined ? before.plannedFinishDate : toDate(body.plannedFinishDate);
    if (this.hasTaskScheduleChange(body)) {
      this.assertScheduleWithinProjectPlan(before.project, plannedStartDate, plannedFinishDate);
    }
    const assigneeId = body.assigneeId === undefined ? undefined : this.requirePersonId(body.assigneeId, "任务负责人必填");
    const testerId = body.testerId === undefined ? undefined : await this.ensureTester(this.requirePersonId(body.testerId, "任务测试负责人必填"));
    const taskType = assigneeId === undefined ? undefined : await this.taskTypeForAssignee(assigneeId);
    const task = await this.prisma.devTask.update({
      where: { id },
      data: pickDefined({
        title: body.title,
        type: taskType,
        status: body.status,
        assigneeId,
        testerId,
        plannedStartDate: body.plannedStartDate === undefined ? undefined : plannedStartDate,
        plannedFinishDate: body.plannedFinishDate === undefined ? undefined : plannedFinishDate,
        blockedReason: body.blockedReason
      })
    });
    await this.log({ user, entityType: "TASK", entityId: id, projectId: task.projectId, requirementId: task.requirementId, taskId: id, action: "UPDATE", summary: `更新任务：${task.title}`, beforeJson: before, afterJson: task });
    return task;
  }

  async startTask(user: AuthUser, id: number) {
    const before = await this.prisma.devTask.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("任务不存在");
    this.requireAssignee(user, before, "只有任务负责人可以开始处理");
    if (before.status !== TaskStatus.TODO) throw new BadRequestException("只有待处理任务可以开始处理");
    const task = await this.prisma.devTask.update({
      where: { id },
      data: { status: TaskStatus.DOING, actualStartDate: before.actualStartDate || new Date() }
    });
    await this.log({ user, entityType: "TASK", entityId: id, projectId: task.projectId, requirementId: task.requirementId, taskId: id, action: "START", summary: `开始处理任务：${task.title}` });
    return task;
  }

  async completeTask(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.devTask.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("任务不存在");
    this.requireAssignee(user, before, "只有任务负责人可以处理完成");
    if (before.status !== TaskStatus.DOING) throw new BadRequestException("只有处理中的任务可以提交测试");
    const task = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.devTask.update({
        where: { id },
        data: {
          status: TaskStatus.TO_TEST,
          actualFinishDate: new Date(),
          completionNote: body.completionNote
        }
      });
      await this.linkExistingTaskDocuments(tx, updated, body);
      return updated;
    });
    await this.log({ user, entityType: "TASK", entityId: id, projectId: task.projectId, requirementId: task.requirementId, taskId: id, action: "COMPLETE", summary: `任务提交测试：${task.title}` });
    return task;
  }

  async startTaskTest(user: AuthUser, id: number) {
    requireAnyPosition(user, [PRODUCT_MANAGER, TEST], "只有产品经理或测试可以开始测试任务");
    const before = await this.prisma.devTask.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("任务不存在");
    this.requireAssignedTester(before, "任务测试负责人为空，不能开始测试");
    if (before.status !== TaskStatus.TO_TEST) throw new BadRequestException("只有待测试任务可以开始测试");
    const task = await this.prisma.devTask.update({
      where: { id },
      data: { status: TaskStatus.TESTING }
    });
    await this.log({ user, entityType: "TASK", entityId: id, projectId: task.projectId, requirementId: task.requirementId, taskId: id, action: "START_TEST", summary: `开始测试任务：${task.title}` });
    return task;
  }

  async passTaskTest(user: AuthUser, id: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER, TEST], "只有产品经理或测试可以确认任务测试通过");
    const before = await this.prisma.devTask.findUnique({ where: { id }, include: { defects: true } });
    if (!before) throw new NotFoundException("任务不存在");
    this.requireAssignedTester(before, "任务测试负责人为空，不能确认测试通过");
    if (before.status !== TaskStatus.TESTING) throw new BadRequestException("只有测试中的任务可以测试通过");
    const blockingDefects = before.defects.filter((defect) => defect.status !== DefectStatus.VERIFIED && defect.status !== DefectStatus.CLOSED);
    if (blockingDefects.length) {
      throw new BadRequestException({
        message: "任务下仍有未验证或未关闭的缺陷，不能测试通过",
        blockingDefects: blockingDefects.map((defect) => ({ id: defect.id, title: defect.title, status: defect.status }))
      });
    }
    const task = await this.prisma.devTask.update({
      where: { id },
      data: { status: TaskStatus.TEST_PASSED, completionNote: body.note || before.completionNote }
    });
    await this.log({ user, entityType: "TASK", entityId: id, projectId: task.projectId, requirementId: task.requirementId, taskId: id, action: "TEST_PASS", summary: `任务测试通过：${task.title}` });
    return task;
  }

  async closeTask(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.devTask.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("任务不存在");
    this.requireAssignee(user, before, "只有任务负责人可以手动关闭任务");
    if (!TASK_OWNER_EDITABLE_STATUSES.includes(before.status)) {
      throw new BadRequestException("只有待处理或处理中的任务可以手动关闭");
    }
    const task = await this.prisma.devTask.update({
      where: { id },
      data: { status: TaskStatus.CLOSED, completionNote: body.note || before.completionNote }
    });
    await this.log({ user, entityType: "TASK", entityId: id, projectId: task.projectId, requirementId: task.requirementId, taskId: id, action: "CLOSE", summary: `关闭任务：${task.title}` });
    return task;
  }

  async listDefects(projectId?: number) {
    return this.prisma.defect.findMany({
      where: projectId ? { projectId } : {},
      include: { project: true, task: { include: { requirement: true } }, assignee: true, tester: true, reporter: true, version: true },
      orderBy: [{ priorityScore: "desc" }, { plannedFinishDate: "asc" }, { plannedFixDate: "asc" }]
    });
  }

  async createDefect(user: AuthUser, body: any) {
    requireAnyPosition(user, QUALITY_POSITIONS, "只有产品经理或测试可以创建缺陷");
    const task = await this.prisma.devTask.findUnique({ where: { id: Number(body.taskId) }, include: { requirement: true } });
    if (!task) throw new NotFoundException("任务不存在");
    await this.assertProjectOpen(task.projectId, "新增缺陷");
    if (task.status !== TaskStatus.TESTING && task.status !== TaskStatus.TEST_PASSED) {
      throw new BadRequestException("只有测试中或测试通过的任务可以创建缺陷");
    }
    if (!task.assigneeId) {
      throw new BadRequestException("关联任务负责人为空，不能创建缺陷");
    }
    const environment = task.requirement?.launchStatus === RequirementLaunchStatus.RELEASED ? "ONLINE" : "OFFLINE";
    const testerId = await this.ensureQualityOwner(this.requirePersonId(body.testerId, "缺陷测试负责人必填"));
    const priorityScore = await this.calculateDefectScore({
      level: body.level || "L3",
      environment,
      taskId: task.id,
      timingBonus: Number(body.timingBonus || 0)
    });
    const defectCode = await this.nextBusinessCode("BUG");
    const defect = await this.prisma.defect.create({
      data: {
        code: defectCode,
        title: body.title,
        projectId: task.projectId,
        taskId: task.id,
        versionId: toInt(body.versionId),
        level: body.level || "L3",
        status: DefectStatus.TO_FIX,
        assigneeId: task.assigneeId,
        testerId,
        reporterId: user.personId,
        foundAt: toDate(body.foundAt) || new Date(),
        entryPoint: body.entryPoint,
        impactScope: body.impactScope,
        precondition: body.precondition,
        description: body.description || "",
        reproduceSteps: body.reproduceSteps,
        actualResult: body.actualResult,
        expectedResult: body.expectedResult,
        deviceInfo: body.deviceInfo,
        testData: body.testData,
        environment,
        attachmentUrl: body.attachmentUrl,
        timingBonus: Number(body.timingBonus || 0),
        timingBonusReason: body.timingBonusReason,
        priorityScore
      }
    });
    await this.log({ user, entityType: "DEFECT", entityId: defect.id, projectId: defect.projectId, requirementId: task.requirementId, taskId: task.id, defectId: defect.id, action: "CREATE", summary: `创建缺陷：${defect.title}` });
    if (task.status === TaskStatus.TEST_PASSED && environment !== "ONLINE") {
      const updatedTask = await this.prisma.devTask.update({
        where: { id: task.id },
        data: { status: TaskStatus.TESTING }
      });
      await this.log({ user, entityType: "TASK", entityId: task.id, projectId: task.projectId, requirementId: task.requirementId, taskId: task.id, defectId: defect.id, action: "REOPEN_TEST", summary: `测试通过任务新增缺陷，任务退回测试中：${task.title}`, beforeJson: task, afterJson: updatedTask });
      if (task.requirement?.status === RequirementStatus.COMPLETED) {
        const requirement = await this.prisma.requirement.update({
          where: { id: task.requirementId },
          data: { status: RequirementStatus.DEVELOPING }
        });
        await this.log({ user, entityType: "REQUIREMENT", entityId: task.requirementId, projectId: task.projectId, requirementId: task.requirementId, taskId: task.id, defectId: defect.id, action: "REOPEN_DEVELOPMENT", summary: "测试通过任务新增缺陷，需求退回开发中", beforeJson: task.requirement, afterJson: requirement });
      }
    }
    return defect;
  }

  async updateDefect(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.defect.findUnique({ where: { id }, include: { project: true } });
    if (!before) throw new NotFoundException("缺陷不存在");
    this.requireAssignee(user, before, "只能维护自己负责修复的缺陷");
    if (this.hasDefectScheduleChange(body) && !DEFECT_OWNER_EDITABLE_STATUSES.includes(before.status)) {
      throw new BadRequestException("只有待修复或修复中的缺陷可以调整排期");
    }
    const assigneeId = body.assigneeId === undefined ? before.assigneeId : this.requirePersonId(body.assigneeId, "缺陷修复负责人必填");
    const testerId = body.testerId === undefined ? undefined : await this.ensureQualityOwner(this.requirePersonId(body.testerId, "缺陷测试负责人必填"));
    const taskId = body.taskId === undefined ? before.taskId : Number(body.taskId);
    const task = await this.prisma.devTask.findUnique({ where: { id: taskId }, include: { requirement: true, project: true } });
    if (!task) throw new NotFoundException("任务不存在");
    const plannedStartDate = body.plannedStartDate === undefined ? before.plannedStartDate || before.plannedFixDate : toDate(body.plannedStartDate);
    const plannedFinishDate =
      body.plannedFinishDate === undefined && body.plannedFixDate === undefined
        ? before.plannedFinishDate || before.plannedFixDate
        : toDate(body.plannedFinishDate) || toDate(body.plannedFixDate);
    if (this.hasDefectScheduleChange(body)) {
      this.assertScheduleWithinProjectPlan(task.project || before.project, plannedStartDate, plannedFinishDate);
    }
    const environment = body.environment === undefined ? undefined : normalizeDefectEnvironment(body.environment);
    if (environment === "ONLINE" && task.requirement?.launchStatus !== RequirementLaunchStatus.RELEASED) {
      throw new BadRequestException("只有已上线需求才能登记线上缺陷");
    }
    const priorityScore = await this.calculateDefectScore({
      level: body.level ?? before.level,
      environment: environment ?? before.environment,
      taskId,
      timingBonus: body.timingBonus ?? before.timingBonus
    });
    const defect = await this.prisma.defect.update({
      where: { id },
      data: pickDefined({
        title: body.title,
        taskId: body.taskId === undefined ? undefined : task.id,
        projectId: body.taskId === undefined ? undefined : task.projectId,
        versionId: body.versionId === undefined ? undefined : toInt(body.versionId),
        level: body.level,
        status: body.status,
        assigneeId,
        testerId,
        foundAt: toDate(body.foundAt),
        entryPoint: body.entryPoint,
        impactScope: body.impactScope,
        precondition: body.precondition,
        description: body.description,
        reproduceSteps: body.reproduceSteps,
        actualResult: body.actualResult,
        expectedResult: body.expectedResult,
        deviceInfo: body.deviceInfo,
        testData: body.testData,
        environment,
        attachmentUrl: body.attachmentUrl,
        plannedStartDate: body.plannedStartDate === undefined ? undefined : plannedStartDate,
        plannedFinishDate: body.plannedFinishDate === undefined && body.plannedFixDate === undefined ? undefined : plannedFinishDate,
        plannedFixDate: body.plannedFinishDate === undefined && body.plannedFixDate === undefined ? undefined : plannedFinishDate,
        timingBonus: body.timingBonus === undefined ? undefined : Number(body.timingBonus),
        timingBonusReason: body.timingBonusReason,
        priorityScore
      })
    });
    await this.log({ user, entityType: "DEFECT", entityId: id, projectId: defect.projectId, requirementId: task.requirementId, taskId: task.id, defectId: id, action: "UPDATE", summary: `更新缺陷：${defect.title}`, beforeJson: before, afterJson: defect });
    return defect;
  }

  async startDefectFix(user: AuthUser, id: number) {
    const before = await this.prisma.defect.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("缺陷不存在");
    this.requireAssignee(user, before, "只有缺陷负责人可以开始修复");
    if (before.status !== DefectStatus.TO_FIX) throw new BadRequestException("只有待修复缺陷可以开始修复");
    const defect = await this.prisma.defect.update({
      where: { id },
      data: { status: DefectStatus.FIXING, actualStartDate: before.actualStartDate || new Date() }
    });
    await this.log({ user, entityType: "DEFECT", entityId: id, projectId: defect.projectId, taskId: defect.taskId, defectId: id, action: "START_FIX", summary: `开始修复缺陷：${defect.title}` });
    return defect;
  }

  async completeDefectFix(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.defect.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("缺陷不存在");
    this.requireAssignee(user, before, "只有缺陷负责人可以标记已修复");
    if (before.status !== DefectStatus.FIXING) throw new BadRequestException("只有修复中的缺陷可以标记已修复");
    const defect = await this.prisma.defect.update({
      where: { id },
      data: {
        status: DefectStatus.FIXED,
        actualStartDate: before.actualStartDate || new Date(),
        actualFixDate: new Date(),
        actualResult: body.fixNote ? `${body.fixNote}` : undefined
      }
    });
    await this.log({ user, entityType: "DEFECT", entityId: id, projectId: defect.projectId, taskId: defect.taskId, defectId: id, action: "FIX_COMPLETE", summary: `缺陷已修复：${defect.title}` });
    return defect;
  }

  async verifyDefect(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.defect.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("缺陷不存在");
    if (before.status !== DefectStatus.FIXED) throw new BadRequestException("只有已修复的缺陷可以验证");
    requireAnyPosition(user, [PRODUCT_MANAGER, TEST], "只有产品经理或测试可以验证缺陷");
    this.requireAssignedTester(before, "缺陷测试负责人为空，不能验证缺陷");
    const defect = await this.prisma.defect.update({
      where: { id },
      data: { status: DefectStatus.VERIFIED, expectedResult: body.verifyNote ? `${body.verifyNote}` : undefined }
    });
    await this.log({ user, entityType: "DEFECT", entityId: id, projectId: defect.projectId, taskId: defect.taskId, defectId: id, action: "VERIFY", summary: `缺陷验证通过：${defect.title}` });
    return defect;
  }

  async rejectDefect(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.defect.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("缺陷不存在");
    if (before.status !== DefectStatus.FIXED) throw new BadRequestException("只有已修复的缺陷可以验证未通过");
    requireAnyPosition(user, [PRODUCT_MANAGER, TEST], "只有产品经理或测试可以验证缺陷");
    this.requireAssignedTester(before, "缺陷测试负责人为空，不能验证缺陷");
    const defect = await this.prisma.defect.update({
      where: { id },
      data: { status: DefectStatus.FIXING, actualResult: body.reason ? `${body.reason}` : undefined }
    });
    await this.log({ user, entityType: "DEFECT", entityId: id, projectId: defect.projectId, taskId: defect.taskId, defectId: id, action: "VERIFY_REJECT", summary: `缺陷验证未通过：${defect.title}` });
    return defect;
  }

  async closeDefect(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.defect.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("缺陷不存在");
    if (!DEFECT_OWNER_EDITABLE_STATUSES.includes(before.status)) throw new BadRequestException("只有待修复或修复中的缺陷可以关闭");
    requireAnyPosition(user, [PRODUCT_MANAGER, TEST], "只有产品经理或测试可以关闭缺陷");
    this.requireAssignedTester(before, "缺陷测试负责人为空，不能关闭缺陷");
    const defect = await this.prisma.defect.update({
      where: { id },
      data: { status: DefectStatus.CLOSED, actualResult: body.reason ? `${body.reason}` : undefined }
    });
    await this.log({ user, entityType: "DEFECT", entityId: id, projectId: defect.projectId, taskId: defect.taskId, defectId: id, action: "CLOSE", summary: `关闭缺陷：${defect.title}` });
    return defect;
  }

  async reopenDefect(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.defect.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("缺陷不存在");
    if (before.status !== DefectStatus.CLOSED) throw new BadRequestException("只有已关闭的缺陷可以开启");
    requireAnyPosition(user, [PRODUCT_MANAGER, TEST], "只有产品经理或测试可以重新打开缺陷");
    this.requireAssignedTester(before, "缺陷测试负责人为空，不能重新打开缺陷");
    const defect = await this.prisma.defect.update({
      where: { id },
      data: { status: DefectStatus.TO_FIX, actualResult: body.reason ? `${body.reason}` : undefined }
    });
    await this.log({ user, entityType: "DEFECT", entityId: id, projectId: defect.projectId, taskId: defect.taskId, defectId: id, action: "REOPEN", summary: `开启缺陷：${defect.title}` });
    return defect;
  }

  async listVersions(projectId?: number) {
    return this.prisma.releaseVersion.findMany({
      where: projectId ? { projectId } : {},
      include: {
        project: true,
        releaseOwner: true,
        creator: true,
        requirements: { include: { requirement: true } },
        defects: { include: { defect: true } }
      },
      orderBy: { updatedAt: "desc" }
    });
  }

  async createVersion(user: AuthUser, body: any) {
    requireAnyPosition(user, QUALITY_POSITIONS, "只有产品经理或测试可以创建版本");
    const projectId = Number(body.projectId);
    const requirementIds = this.toNumberIds(body.requirementIds);
    const defectIds = this.toNumberIds(body.defectIds);
    await this.assertProjectOpen(projectId, "新增版本");
    await this.assertVersionScope(projectId, requirementIds, defectIds);
    const versionCode = await this.nextBusinessCode("VER");
    const version = await this.prisma.releaseVersion.create({
      data: {
        code: versionCode,
        name: body.name,
        projectId,
        type: body.type || "NORMAL",
        status: body.status || VersionStatus.PLANNING,
        plannedReleaseAt: toDate(body.plannedReleaseAt),
        releaseNote: body.releaseNote,
        releaseOwnerId: toInt(body.releaseOwnerId),
        createdById: user.personId,
        riskNote: body.riskNote,
        rollbackPlan: body.rollbackPlan,
        requirements: {
          create: requirementIds.map((requirementId) => ({ requirementId }))
        },
        defects: {
          create: defectIds.map((defectId) => ({ defectId }))
        }
      },
      include: { requirements: true, defects: true }
    });
    await this.log({ user, entityType: "VERSION", entityId: version.id, projectId: version.projectId, versionId: version.id, action: "CREATE", summary: `创建版本：${version.name}` });
    return version;
  }

  async updateVersion(user: AuthUser, id: number, body: any) {
    requireAnyPosition(user, QUALITY_POSITIONS, "只有产品经理或测试可以编辑版本");
    const before = await this.prisma.releaseVersion.findUnique({ where: { id }, include: { requirements: true, defects: true } });
    if (!before) throw new NotFoundException("版本不存在");
    const requirementIds = Array.isArray(body.requirementIds) ? this.toNumberIds(body.requirementIds) : undefined;
    const defectIds = Array.isArray(body.defectIds) ? this.toNumberIds(body.defectIds) : undefined;
    await this.assertVersionScope(before.projectId, requirementIds || [], defectIds || []);
    const version = await this.prisma.$transaction(async (tx) => {
      await tx.releaseVersion.update({
        where: { id },
        data: pickDefined({
          name: body.name,
          type: body.type,
          status: body.status,
          plannedReleaseAt: toDate(body.plannedReleaseAt),
          releaseNote: body.releaseNote,
          releaseOwnerId: toInt(body.releaseOwnerId),
          riskNote: body.riskNote,
          rollbackPlan: body.rollbackPlan
        })
      });
      if (requirementIds) {
        await tx.versionRequirement.deleteMany({ where: { versionId: id } });
        await tx.versionRequirement.createMany({
          data: requirementIds.map((requirementId) => ({ versionId: id, requirementId })),
          skipDuplicates: true
        });
      }
      if (defectIds) {
        await tx.versionDefect.deleteMany({ where: { versionId: id } });
        await tx.versionDefect.createMany({
          data: defectIds.map((defectId) => ({ versionId: id, defectId })),
          skipDuplicates: true
        });
      }
      return tx.releaseVersion.findUniqueOrThrow({
        where: { id },
        include: { requirements: { include: { requirement: true } }, defects: { include: { defect: true } } }
      });
    });
    await this.log({ user, entityType: "VERSION", entityId: id, projectId: version.projectId, versionId: id, action: "UPDATE", summary: `更新版本：${version.name}`, beforeJson: before, afterJson: version });
    return version;
  }

  async publishVersion(user: AuthUser, id: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER, TEST], "只有产品经理或测试可以发布版本");
    const version = await this.prisma.releaseVersion.findUnique({
      where: { id },
      include: { requirements: { include: { requirement: true } }, defects: { include: { defect: true } } }
    });
    if (!version) throw new NotFoundException("版本不存在");
    if (TERMINAL_VERSION_STATUSES.includes(version.status)) {
      throw new BadRequestException("版本已发布、已回滚或已取消，不能重复发布");
    }
    await this.assertProjectOpen(version.projectId, "发布版本");
    const invalidRequirements = version.requirements.filter(
      (item) => item.requirement.status !== RequirementStatus.COMPLETED || item.requirement.launchStatus !== RequirementLaunchStatus.TO_RELEASE
    );
    const invalidDefects = version.defects.filter(
      (item) => item.defect.status !== DefectStatus.VERIFIED && item.defect.status !== DefectStatus.CLOSED
    );
    if (invalidRequirements.length || invalidDefects.length) {
      throw new BadRequestException({
        message: "发布检查未通过",
        invalidRequirements: invalidRequirements.map((item) => ({ id: item.requirement.id, title: item.requirement.title, status: item.requirement.status })),
        invalidDefects: invalidDefects.map((item) => ({ id: item.defect.id, title: item.defect.title, status: item.defect.status })),
      });
    }
    const snapshot = {
      requirements: version.requirements.map((item) => item.requirement),
      defects: version.defects.map((item) => item.defect),
      publishedBy: user.personId,
      publishedAt: new Date().toISOString()
    };
    const published = await this.prisma.$transaction(async (tx) => {
      await tx.releaseVersion.update({
        where: { id },
        data: {
          status: VersionStatus.RELEASED,
          actualReleaseAt: new Date(),
          releaseConclusion: body.releaseConclusion || "成功",
          snapshotJson: snapshot as Prisma.InputJsonValue
        }
      });
      await tx.requirement.updateMany({
        where: { id: { in: version.requirements.map((item) => item.requirementId) } },
        data: { launchStatus: RequirementLaunchStatus.RELEASED, actualLaunchDate: new Date() }
      });
      return tx.releaseVersion.findUniqueOrThrow({ where: { id } });
    });
    await this.setProjectStage(user, version.projectId, ProjectStage.ONLINE_OPS, "版本发布成功后，项目进入上线运维");
    await this.log({ user, entityType: "VERSION", entityId: id, projectId: version.projectId, versionId: id, action: "PUBLISH", summary: `发布版本：${version.name}`, afterJson: snapshot });
    return published;
  }

  async listDocuments(projectId?: number) {
    return this.prisma.projectDocument.findMany({
      where: projectId ? { projectId } : {},
      include: { project: true, createdBy: true, requirements: { include: { requirement: true } }, tasks: { include: { task: true } } },
      orderBy: { updatedAt: "desc" }
    });
  }

  async createDocument(user: AuthUser, body: any) {
    const requirementIds = this.toNumberIds(body.requirementIds);
    const document = await this.prisma.projectDocument.create({
      data: {
        projectId: Number(body.projectId),
        name: body.name,
        type: body.type || "BUSINESS",
        linkUrl: body.linkUrl,
        attachmentUrl: body.attachmentUrl,
        version: body.version,
        description: body.description,
        tags: body.tags,
        createdById: user.personId,
        requirements: requirementIds.length
          ? {
              create: requirementIds.map((requirementId) => ({ requirementId }))
            }
          : undefined
      }
    });
    await this.log({ user, entityType: "DOCUMENT", entityId: document.id, projectId: document.projectId, action: "CREATE", summary: `新增资料：${document.name}` });
    return document;
  }

  async boardRuleConfig() {
    return this.prisma.boardRuleConfig.upsert({
      where: { id: DEFAULT_BOARD_RULE_CONFIG.id },
      create: DEFAULT_BOARD_RULE_CONFIG,
      update: {}
    });
  }

  async adminBootstrap() {
    const [positions, organizations, people, accounts, dictionaries, requirementPriorities, defectPriorities, boardRuleConfig, logs] = await Promise.all([
      this.prisma.position.findMany({ orderBy: { id: "asc" } }),
      this.prisma.organization.findMany({ orderBy: [{ parentId: "asc" }, { sort: "asc" }] }),
      this.prisma.person.findMany({ include: includePerson, orderBy: { id: "asc" } }),
      this.prisma.account.findMany({
        select: {
          id: true,
          username: true,
          personId: true,
          status: true,
          allowLogin: true,
          initialPassword: true,
          passwordUpdatedAt: true,
          lastLoginAt: true,
          failedLoginCount: true,
          note: true,
          createdAt: true,
          updatedAt: true,
          person: { include: includePerson }
        },
        orderBy: { id: "asc" }
      }),
      this.prisma.dictionary.findMany({ orderBy: [{ type: "asc" }, { sort: "asc" }] }),
      this.prisma.requirementPriority.findMany({ orderBy: { sort: "asc" } }),
      this.prisma.defectPriority.findMany({ orderBy: { sort: "asc" } }),
      this.boardRuleConfig(),
      this.prisma.activityLog.findMany({ include: { actor: true }, take: 50, orderBy: { createdAt: "desc" } })
    ]);
    return { positions, organizations, people, accounts, dictionaries, requirementPriorities, defectPriorities, boardRuleConfig, logs };
  }

  async listAssignablePeople() {
    return this.prisma.person.findMany({
      where: { employmentStatus: EmploymentStatus.ACTIVE },
      include: includePerson,
      orderBy: { id: "asc" }
    });
  }

  async upsertPerson(user: AuthUser, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以维护人员");
    const position = body.primaryPositionCode
      ? await this.prisma.position.findUnique({ where: { code: body.primaryPositionCode } })
      : undefined;
    const person = body.id
      ? await this.prisma.person.update({
          where: { id: Number(body.id) },
          data: pickDefined({
            name: body.name,
            employeeNo: body.employeeNo,
            phone: body.phone,
            email: body.email,
            organizationId: body.organizationId === undefined ? undefined : toNullableInt(body.organizationId),
            primaryPositionId: position?.id,
            employmentStatus: body.employmentStatus
          })
        })
      : await this.prisma.person.create({
          data: {
            name: body.name,
            employeeNo: body.employeeNo,
            phone: body.phone,
            email: body.email,
            organizationId: toNullableInt(body.organizationId),
            primaryPositionId: position?.id,
            employmentStatus: body.employmentStatus || "ACTIVE"
          }
        });
    if (position) {
      await this.prisma.$transaction([
        this.prisma.personPosition.updateMany({ where: { personId: person.id, isPrimary: true }, data: { isPrimary: false } }),
        this.prisma.personPosition.upsert({
          where: { personId_positionId: { personId: person.id, positionId: position.id } },
          update: { isPrimary: true, expiredAt: null },
          create: { personId: person.id, positionId: position.id, isPrimary: true }
        })
      ]);
    }
    await this.log({ user, entityType: "PERSON", entityId: person.id, action: body.id ? "UPDATE" : "CREATE", summary: `${body.id ? "更新" : "创建"}人员：${person.name}` });
    return person;
  }

  async upsertPersonAccount(user: AuthUser, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以维护人员与账号");
    const person = await this.upsertPerson(user, body);
    const accountId = toInt(body.accountId);
    const username = typeof body.username === "string" ? body.username.trim() : body.username;
    let account = null;

    if (accountId || username) {
      account = await this.upsertAccount(user, {
        id: accountId,
        personId: person.id,
        username: username || undefined,
        password: body.password,
        status: body.accountStatus || "ACTIVE",
        allowLogin: body.allowLogin,
        note: body.accountNote
      });
    }

    const savedPerson = await this.prisma.person.findUniqueOrThrow({
      where: { id: person.id },
      include: includePerson
    });
    return { person: savedPerson, account };
  }

  async upsertOrganization(user: AuthUser, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以维护组织");
    const organizationCode = body.id ? undefined : body.code || await this.nextBusinessCode("ORG");
    const organization = body.id
      ? await this.prisma.organization.update({
          where: { id: Number(body.id) },
          data: pickDefined({
            name: body.name,
            code: body.code,
            parentId: body.parentId === undefined ? undefined : toNullableInt(body.parentId),
            managerId: body.managerId === undefined ? undefined : toNullableInt(body.managerId),
            status: body.status,
            sort: body.sort === undefined ? undefined : Number(body.sort)
          })
        })
      : await this.prisma.organization.create({
          data: {
            name: body.name,
            code: organizationCode,
            parentId: toNullableInt(body.parentId),
            managerId: toNullableInt(body.managerId),
            status: body.status || "ACTIVE",
            sort: Number(body.sort || 0)
          }
        });
    await this.log({ user, entityType: "ORGANIZATION", entityId: organization.id, action: body.id ? "UPDATE" : "CREATE", summary: `${body.id ? "更新" : "创建"}组织：${organization.name}` });
    return organization;
  }

  async upsertPosition(user: AuthUser, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以维护岗位");
    let existing: Awaited<ReturnType<typeof this.prisma.position.findUnique>> | null = null;
    if (body.id) {
      existing = await this.prisma.position.findUnique({ where: { id: Number(body.id) } });
      if (existing?.isSystem && body.code && body.code !== existing.code) {
        throw new BadRequestException("内置岗位编码不允许修改");
      }
    }
    const positionCode = body.id ? undefined : body.code || await this.nextBusinessCode("POS");
    const position = body.id
      ? await this.prisma.position.update({
          where: { id: Number(body.id) },
          data: pickDefined({
            name: body.name,
            code: existing?.isSystem ? undefined : body.code,
            category: body.category,
            description: body.description,
            isActive: toBool(body.isActive)
          })
        })
      : await this.prisma.position.create({
          data: {
            name: body.name,
            code: positionCode,
            category: body.category,
            description: body.description,
            isSystem: false,
            isActive: toBool(body.isActive) ?? true
          }
        });
    await this.log({ user, entityType: "POSITION", entityId: position.id, action: body.id ? "UPDATE" : "CREATE", summary: `${body.id ? "更新" : "创建"}岗位：${position.name}` });
    return position;
  }

  async upsertAccount(user: AuthUser, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以维护账号");
    const passwordHash = body.password ? await bcrypt.hash(String(body.password), 10) : undefined;
    const account = body.id
      ? await this.prisma.account.update({
          where: { id: Number(body.id) },
          data: pickDefined({
            username: body.username,
            personId: toInt(body.personId),
            passwordHash,
            status: body.status,
            allowLogin: toBool(body.allowLogin),
            initialPassword: passwordHash ? true : undefined,
            passwordUpdatedAt: passwordHash ? new Date() : undefined,
            note: body.note
          })
        })
      : await this.prisma.account.create({
          data: {
            username: body.username,
            personId: Number(body.personId),
            passwordHash: passwordHash || (await bcrypt.hash(DEFAULT_INITIAL_PASSWORD, 10)),
            status: body.status || "ACTIVE",
            allowLogin: toBool(body.allowLogin) ?? true,
            initialPassword: true,
            note: body.note
          }
        });
    await this.log({ user, entityType: "ACCOUNT", entityId: account.id, action: body.id ? "UPDATE" : "CREATE", summary: `${body.id ? "更新" : "创建"}账号：${account.username}` });
    const { passwordHash: hiddenPasswordHash, ...safeAccount } = account;
    void hiddenPasswordHash;
    return safeAccount;
  }

  async upsertDictionary(user: AuthUser, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以维护字典");
    let existing: Awaited<ReturnType<typeof this.prisma.dictionary.findUnique>> | null = null;
    if (body.id) {
      existing = await this.prisma.dictionary.findUnique({ where: { id: Number(body.id) } });
      if (existing?.isSystem && ((body.code && body.code !== existing.code) || (body.type && body.type !== existing.type))) {
        throw new BadRequestException("内置字典类型和编码不允许修改");
      }
    }
    const dictionary = body.id
      ? await this.prisma.dictionary.update({
          where: { id: Number(body.id) },
          data: pickDefined({
            type: existing?.isSystem ? undefined : body.type,
            code: existing?.isSystem ? undefined : body.code,
            name: body.name,
            description: body.description,
            isActive: toBool(body.isActive),
            sort: body.sort === undefined ? undefined : Number(body.sort)
          })
        })
      : await this.prisma.dictionary.create({
          data: {
            type: body.type,
            code: body.code,
            name: body.name,
            description: body.description,
            isSystem: false,
            isActive: toBool(body.isActive) ?? true,
            sort: Number(body.sort || 0)
          }
        });
    await this.log({ user, entityType: "DICTIONARY", entityId: dictionary.id, action: body.id ? "UPDATE" : "CREATE", summary: `${body.id ? "更新" : "创建"}字典：${dictionary.type}/${dictionary.name}` });
    return dictionary;
  }

  async updateRequirementPriority(user: AuthUser, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以维护优先级分值");
    const priority = await this.prisma.requirementPriority.update({
      where: { code: body.code },
      data: pickDefined({
        name: body.name,
        description: body.description,
        baseScore: body.baseScore === undefined ? undefined : Number(body.baseScore),
        defectWeight: body.defectWeight === undefined ? undefined : Number(body.defectWeight),
        isActive: toBool(body.isActive),
        sort: body.sort === undefined ? undefined : Number(body.sort)
      })
    });
    await this.log({ user, entityType: "PRIORITY", entityId: priority.id, action: "UPDATE", summary: `更新需求优先级：${priority.name}` });
    return priority;
  }

  async updateDefectPriority(user: AuthUser, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以维护缺陷分值");
    const priority = await this.prisma.defectPriority.update({
      where: { code: body.code },
      data: pickDefined({
        name: body.name,
        description: body.description,
        onlineScore: body.onlineScore === undefined ? undefined : Number(body.onlineScore),
        offlineScore: body.offlineScore === undefined ? undefined : Number(body.offlineScore),
        isActive: toBool(body.isActive),
        sort: body.sort === undefined ? undefined : Number(body.sort)
      })
    });
    await this.log({ user, entityType: "PRIORITY", entityId: priority.id, action: "UPDATE", summary: `更新缺陷分值：${priority.name}` });
    return priority;
  }

  async updateBoardRuleConfig(user: AuthUser, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以维护看板规则");
    const config = await this.prisma.boardRuleConfig.upsert({
      where: { id: DEFAULT_BOARD_RULE_CONFIG.id },
      create: {
        id: DEFAULT_BOARD_RULE_CONFIG.id,
        dueSoonDays: Math.round(toNonNegativeNumber(body.dueSoonDays, DEFAULT_BOARD_RULE_CONFIG.dueSoonDays)),
        normalLoadLimit: Math.round(toNonNegativeNumber(body.normalLoadLimit, DEFAULT_BOARD_RULE_CONFIG.normalLoadLimit)),
        saturatedLoadLimit: Math.round(toNonNegativeNumber(body.saturatedLoadLimit, DEFAULT_BOARD_RULE_CONFIG.saturatedLoadLimit)),
        staleProjectDays: Math.round(toNonNegativeNumber(body.staleProjectDays, DEFAULT_BOARD_RULE_CONFIG.staleProjectDays)),
        highPriorityThreshold: toNonNegativeNumber(body.highPriorityThreshold, DEFAULT_BOARD_RULE_CONFIG.highPriorityThreshold),
        includeClosedItems: toBool(body.includeClosedItems) ?? DEFAULT_BOARD_RULE_CONFIG.includeClosedItems
      },
      update: {
        dueSoonDays: Math.round(toNonNegativeNumber(body.dueSoonDays, DEFAULT_BOARD_RULE_CONFIG.dueSoonDays)),
        normalLoadLimit: Math.round(toNonNegativeNumber(body.normalLoadLimit, DEFAULT_BOARD_RULE_CONFIG.normalLoadLimit)),
        saturatedLoadLimit: Math.round(toNonNegativeNumber(body.saturatedLoadLimit, DEFAULT_BOARD_RULE_CONFIG.saturatedLoadLimit)),
        staleProjectDays: Math.round(toNonNegativeNumber(body.staleProjectDays, DEFAULT_BOARD_RULE_CONFIG.staleProjectDays)),
        highPriorityThreshold: toNonNegativeNumber(body.highPriorityThreshold, DEFAULT_BOARD_RULE_CONFIG.highPriorityThreshold),
        includeClosedItems: toBool(body.includeClosedItems) ?? DEFAULT_BOARD_RULE_CONFIG.includeClosedItems
      }
    });
    await this.log({ user, entityType: "BOARD_RULE_CONFIG", entityId: config.id, action: "UPDATE", summary: "更新看板规则配置" });
    return config;
  }

  async recalculateDefectsForRequirement(requirementId: number) {
    const defects = await this.prisma.defect.findMany({ where: { task: { requirementId } } });
    await Promise.all(
      defects.map(async (defect) => {
        const priorityScore = await this.calculateDefectScore({
          level: defect.level,
          environment: defect.environment,
          taskId: defect.taskId,
          timingBonus: defect.timingBonus
        });
        await this.prisma.defect.update({ where: { id: defect.id }, data: { priorityScore } });
      })
    );
  }
}
