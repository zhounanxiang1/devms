import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  DefectStatus,
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
import { code, pickDefined, toBool, toDate, toInt, toNullableInt } from "./utils";

const includePerson = {
  organization: true,
  primaryPosition: true,
  positions: { include: { position: true } }
} satisfies Prisma.PersonInclude;

const DEFAULT_INITIAL_PASSWORD = "123";

const PROJECT_STAGE_RANK: Record<ProjectStage, number> = {
  [ProjectStage.INITIATED]: 1,
  [ProjectStage.RESEARCHING]: 2,
  [ProjectStage.SOLUTION_DESIGN]: 3,
  [ProjectStage.DEV_TEST]: 4,
  [ProjectStage.ONLINE_OPS]: 5,
  [ProjectStage.CLOSED]: 6
};

const REQUIREMENT_REVISION_BONUS: Record<RequirementRevisionType, Record<RequirementLaunchStatus, number>> = {
  [RequirementRevisionType.CHANGE]: {
    [RequirementLaunchStatus.TO_RELEASE]: 6,
    [RequirementLaunchStatus.RELEASED]: 15
  },
  [RequirementRevisionType.OPTIMIZATION]: {
    [RequirementLaunchStatus.TO_RELEASE]: 3,
    [RequirementLaunchStatus.RELEASED]: 8
  }
};

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

@Injectable()
export class CoreService {
  constructor(private readonly prisma: PrismaService) {}

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
    const [tasks, defects, projects, logs] = await Promise.all([
      this.prisma.devTask.findMany({
        where: {
          assigneeId: user.personId,
          status: { in: [TaskStatus.TODO, TaskStatus.DOING, TaskStatus.TO_TEST, TaskStatus.TESTING] }
        },
        include: { project: true, requirement: true, assignee: true, defects: true },
        orderBy: [{ priorityScore: "desc" }, { plannedFinishDate: "asc" }]
      }),
      this.prisma.defect.findMany({
        where: {
          OR: [
            { assigneeId: user.personId, status: { in: [DefectStatus.TO_FIX, DefectStatus.FIXING] } },
            { status: DefectStatus.FIXED, ...(this.canVerify(user) ? {} : { assigneeId: user.personId }) }
          ]
        },
        include: { project: true, task: { include: { requirement: true } }, assignee: true },
        orderBy: [{ priorityScore: "desc" }, { plannedFixDate: "asc" }]
      }),
      this.prisma.project.findMany({
        where: {
          OR: [{ ownerId: user.personId }, { members: { some: { personId: user.personId, leftAt: null } } }]
        },
        take: 8,
        orderBy: { updatedAt: "desc" }
      }),
      this.prisma.activityLog.findMany({
        where: { actorId: user.personId },
        take: 10,
        orderBy: { createdAt: "desc" }
      })
    ]);
    const now = Date.now();
    const isDue = (date?: Date | null) => date ? date.getTime() - now < 1000 * 60 * 60 * 24 * 2 : false;
    return {
      user,
      summary: {
        developmentTasks: tasks.length,
        defectTasks: defects.length,
        dueSoon: tasks.filter((task) => isDue(task.plannedFinishDate)).length + defects.filter((defect) => isDue(defect.plannedFixDate)).length
      },
      developmentTasks: tasks,
      defectTasks: defects,
      projects,
      recentLogs: logs
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

  private async assertProjectOpen(projectId: number, action: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, stage: true } });
    if (!project) throw new NotFoundException("项目不存在");
    if (project.stage === ProjectStage.CLOSED) {
      throw new BadRequestException(`项目已结项，不能${action}`);
    }
    return project;
  }

  private async advanceProjectStage(user: AuthUser, projectId: number, targetStage: ProjectStage, summary: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.stage === ProjectStage.CLOSED) return;
    if (PROJECT_STAGE_RANK[project.stage] >= PROJECT_STAGE_RANK[targetStage]) return;
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { stage: targetStage }
    });
    await this.log({
      user,
      entityType: "PROJECT",
      entityId: projectId,
      projectId,
      action: "STAGE_AUTO_ADVANCE",
      summary,
      beforeJson: project,
      afterJson: updated
    });
  }

  private toNumberIds(values: unknown) {
    return Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
  }

  private async assertVersionScope(projectId: number, requirementIds: number[], defectIds: number[]) {
    const [invalidRequirements, invalidDefects] = await Promise.all([
      requirementIds.length
        ? this.prisma.requirement.findMany({
            where: { id: { in: requirementIds }, projectId: { not: projectId } },
            select: { id: true, title: true, projectId: true }
          })
        : [],
      defectIds.length
        ? this.prisma.defect.findMany({
            where: { id: { in: defectIds }, projectId: { not: projectId } },
            select: { id: true, title: true, projectId: true }
          })
        : []
    ]);
    if (invalidRequirements.length || invalidDefects.length) {
      throw new BadRequestException({
        message: "版本范围只能选择当前项目下的需求和缺陷",
        invalidRequirements,
        invalidDefects
      });
    }
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
    const project = await this.prisma.project.create({
      data: {
        code: body.code || code("PROJ"),
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
        documents: true,
        requirements: { include: { _count: { select: { tasks: true, changes: true } } }, orderBy: { updatedAt: "desc" } },
        tasks: { include: { assignee: true, requirement: true, defects: true }, orderBy: { updatedAt: "desc" } },
        defects: { include: { assignee: true, task: { include: { requirement: true } } }, orderBy: { updatedAt: "desc" } },
        versions: { orderBy: { updatedAt: "desc" } },
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
      throw new BadRequestException("项目阶段由系统按关键事件自动流转，结项或重新打开请使用专门操作");
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
      data: { stage: ProjectStage.CLOSED }
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

  async reopenProject(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.project.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("项目不存在");
    this.requireProjectManager(user, before);
    if (before.stage !== ProjectStage.CLOSED) return before;
    const project = await this.prisma.project.update({
      where: { id },
      data: { stage: ProjectStage.ONLINE_OPS }
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
      include: { project: true, owner: true, submitter: true, _count: { select: { tasks: true, changes: true } } },
      orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }]
    });
  }

  async createRequirement(user: AuthUser, body: any) {
    await this.assertProjectOpen(Number(body.projectId), "新增需求");
    const priorityScore = await this.calculateRequirementScore(body.priorityLevel || "P2", body.timingBonus);
    const requirement = await this.prisma.requirement.create({
      data: {
        code: body.code || code("REQ"),
        title: body.title,
        projectId: Number(body.projectId),
        type: body.type || "FEATURE",
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
    await this.advanceProjectStage(user, requirement.projectId, ProjectStage.RESEARCHING, "创建需求后，项目进入需求调研");
    await this.log({ user, entityType: "REQUIREMENT", entityId: requirement.id, projectId: requirement.projectId, requirementId: requirement.id, action: "CREATE", summary: `创建需求：${requirement.title}` });
    return requirement;
  }

  async updateRequirement(user: AuthUser, id: number, body: any) {
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
    if (status === RequirementStatus.APPROVED) {
      await this.advanceProjectStage(user, requirement.projectId, ProjectStage.SOLUTION_DESIGN, "需求评审通过后，项目进入方案设计");
    }
    await this.log({ user, entityType: "REQUIREMENT", entityId: id, projectId: requirement.projectId, requirementId: id, action: "REVIEW", summary: `填写评审结论：${body.conclusion}`, beforeJson: before, afterJson: requirement });
    return requirement;
  }

  async createRequirementChange(user: AuthUser, requirementId: number, body: any) {
    const requirement = await this.prisma.requirement.findUnique({ where: { id: requirementId } });
    if (!requirement) throw new NotFoundException("需求不存在");
    const change = await this.prisma.requirementChange.create({
      data: {
        code: body.code || code("CHG"),
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
      return tx.requirement.create({
        data: {
          code: body.code || code("REQ"),
          title: body.title,
          projectId: original.projectId,
          type: body.type || original.type || "FEATURE",
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
      include: { project: true, requirement: true, assignee: true, defects: true },
      orderBy: [{ priorityScore: "desc" }, { plannedFinishDate: "asc" }]
    });
  }

  async createTask(user: AuthUser, body: any) {
    const requirement = await this.prisma.requirement.findUnique({ where: { id: Number(body.requirementId) } });
    if (requirement && requirement.status !== RequirementStatus.APPROVED && requirement.status !== RequirementStatus.DEVELOPING) {
      throw new BadRequestException("只有评审通过或开发中的需求可以创建任务");
    }
    if (!requirement) throw new NotFoundException("需求不存在");
    await this.assertProjectOpen(requirement.projectId, "新增开发任务");
    const task = await this.prisma.devTask.create({
      data: {
        code: body.code || code("TASK"),
        title: body.title,
        projectId: requirement.projectId,
        requirementId: requirement.id,
        type: body.type || "BACKEND",
        status: TaskStatus.TODO,
        assigneeId: toInt(body.assigneeId),
        plannedStartDate: toDate(body.plannedStartDate),
        plannedFinishDate: toDate(body.plannedFinishDate),
        priorityScore: requirement.priorityScore
      }
    });
    if (requirement.status === RequirementStatus.APPROVED) {
      await this.prisma.requirement.update({ where: { id: requirement.id }, data: { status: RequirementStatus.DEVELOPING } });
    }
    await this.advanceProjectStage(user, task.projectId, ProjectStage.DEV_TEST, "创建开发任务后，项目进入系统开发与测试");
    await this.log({ user, entityType: "TASK", entityId: task.id, projectId: task.projectId, requirementId: task.requirementId, taskId: task.id, action: "CREATE", summary: `创建开发任务：${task.title}` });
    return task;
  }

  async updateTask(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.devTask.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("任务不存在");
    const task = await this.prisma.devTask.update({
      where: { id },
      data: pickDefined({
        title: body.title,
        type: body.type,
        status: body.status,
        assigneeId: toInt(body.assigneeId),
        plannedStartDate: toDate(body.plannedStartDate),
        plannedFinishDate: toDate(body.plannedFinishDate),
        blockedReason: body.blockedReason
      })
    });
    await this.log({ user, entityType: "TASK", entityId: id, projectId: task.projectId, requirementId: task.requirementId, taskId: id, action: "UPDATE", summary: `更新任务：${task.title}`, beforeJson: before, afterJson: task });
    return task;
  }

  async startTask(user: AuthUser, id: number) {
    const before = await this.prisma.devTask.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("任务不存在");
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
    if (before.status !== TaskStatus.DOING) throw new BadRequestException("只有处理中的任务可以提交测试");
    const task = await this.prisma.devTask.update({
      where: { id },
      data: {
        status: TaskStatus.TO_TEST,
        actualFinishDate: new Date(),
        completionNote: body.completionNote
      }
    });
    await this.log({ user, entityType: "TASK", entityId: id, projectId: task.projectId, requirementId: task.requirementId, taskId: id, action: "COMPLETE", summary: `任务提交测试：${task.title}` });
    return task;
  }

  async startTaskTest(user: AuthUser, id: number) {
    requireAnyPosition(user, [PRODUCT_MANAGER, TEST], "只有产品经理或测试可以开始测试任务");
    const before = await this.prisma.devTask.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("任务不存在");
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
    const remaining = await this.prisma.devTask.count({
      where: {
        requirementId: task.requirementId,
        status: { not: TaskStatus.TEST_PASSED }
      }
    });
    if (remaining === 0) {
      await this.prisma.requirement.update({ where: { id: task.requirementId }, data: { status: RequirementStatus.COMPLETED } });
      await this.log({ user, entityType: "REQUIREMENT", entityId: task.requirementId, projectId: task.projectId, requirementId: task.requirementId, action: "AUTO_COMPLETED", summary: "全部任务测试通过，需求进入已完成" });
    }
    await this.log({ user, entityType: "TASK", entityId: id, projectId: task.projectId, requirementId: task.requirementId, taskId: id, action: "TEST_PASS", summary: `任务测试通过：${task.title}` });
    return task;
  }

  async closeTask(user: AuthUser, id: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER], "只有产品经理可以手动关闭任务");
    const before = await this.prisma.devTask.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("任务不存在");
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
      include: { project: true, task: { include: { requirement: true } }, assignee: true, reporter: true },
      orderBy: [{ priorityScore: "desc" }, { plannedFixDate: "asc" }]
    });
  }

  async createDefect(user: AuthUser, body: any) {
    const task = await this.prisma.devTask.findUnique({ where: { id: Number(body.taskId) }, include: { requirement: true } });
    if (!task) throw new NotFoundException("任务不存在");
    await this.assertProjectOpen(task.projectId, "新增缺陷");
    const priorityScore = await this.calculateDefectScore({
      level: body.level || "L3",
      environment: body.environment || "TEST",
      taskId: task.id,
      timingBonus: Number(body.timingBonus || 0)
    });
    const assigneeId = toInt(body.assigneeId);
    const defect = await this.prisma.defect.create({
      data: {
        code: body.code || code("BUG"),
        title: body.title,
        projectId: task.projectId,
        taskId: task.id,
        versionId: toInt(body.versionId),
        level: body.level || "L3",
        status: DefectStatus.TO_FIX,
        assigneeId,
        reporterId: user.personId,
        description: body.description || "",
        reproduceSteps: body.reproduceSteps,
        actualResult: body.actualResult,
        expectedResult: body.expectedResult,
        environment: body.environment || "TEST",
        attachmentUrl: body.attachmentUrl,
        plannedFixDate: toDate(body.plannedFixDate),
        timingBonus: Number(body.timingBonus || 0),
        timingBonusReason: body.timingBonusReason,
        priorityScore
      }
    });
    await this.log({ user, entityType: "DEFECT", entityId: defect.id, projectId: defect.projectId, requirementId: task.requirementId, taskId: task.id, defectId: defect.id, action: "CREATE", summary: `创建缺陷：${defect.title}` });
    return defect;
  }

  async updateDefect(user: AuthUser, id: number, body: any) {
    const before = await this.prisma.defect.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("缺陷不存在");
    const assigneeId = body.assigneeId === undefined ? before.assigneeId : toInt(body.assigneeId);
    const taskId = body.taskId === undefined ? before.taskId : Number(body.taskId);
    const task = await this.prisma.devTask.findUnique({ where: { id: taskId }, include: { requirement: true } });
    if (!task) throw new NotFoundException("任务不存在");
    const priorityScore = await this.calculateDefectScore({
      level: body.level ?? before.level,
      environment: body.environment ?? before.environment,
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
        description: body.description,
        reproduceSteps: body.reproduceSteps,
        actualResult: body.actualResult,
        expectedResult: body.expectedResult,
        environment: body.environment,
        attachmentUrl: body.attachmentUrl,
        plannedFixDate: toDate(body.plannedFixDate),
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
    if (before.status !== DefectStatus.TO_FIX) throw new BadRequestException("只有待修复缺陷可以开始修复");
    const defect = await this.prisma.defect.update({
      where: { id },
      data: { status: DefectStatus.FIXING }
    });
    await this.log({ user, entityType: "DEFECT", entityId: id, projectId: defect.projectId, taskId: defect.taskId, defectId: id, action: "START_FIX", summary: `开始修复缺陷：${defect.title}` });
    return defect;
  }

  async completeDefectFix(user: AuthUser, id: number, body: any) {
    const defect = await this.prisma.defect.update({
      where: { id },
      data: {
        status: DefectStatus.FIXED,
        actualFixDate: new Date(),
        actualResult: body.fixNote ? `${body.fixNote}` : undefined
      }
    });
    await this.log({ user, entityType: "DEFECT", entityId: id, projectId: defect.projectId, taskId: defect.taskId, defectId: id, action: "FIX_COMPLETE", summary: `缺陷已修复：${defect.title}` });
    return defect;
  }

  async verifyDefect(user: AuthUser, id: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER, TEST], "只有产品经理或测试可以验证缺陷");
    const defect = await this.prisma.defect.update({
      where: { id },
      data: { status: DefectStatus.VERIFIED, expectedResult: body.verifyNote ? `${body.verifyNote}` : undefined }
    });
    await this.log({ user, entityType: "DEFECT", entityId: id, projectId: defect.projectId, taskId: defect.taskId, defectId: id, action: "VERIFY", summary: `缺陷验证通过：${defect.title}` });
    return defect;
  }

  async rejectDefect(user: AuthUser, id: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER, TEST], "只有产品经理或测试可以验证缺陷");
    const defect = await this.prisma.defect.update({
      where: { id },
      data: { status: DefectStatus.FIXING, actualResult: body.reason ? `${body.reason}` : undefined }
    });
    await this.log({ user, entityType: "DEFECT", entityId: id, projectId: defect.projectId, taskId: defect.taskId, defectId: id, action: "VERIFY_REJECT", summary: `缺陷验证未通过：${defect.title}` });
    return defect;
  }

  async closeDefect(user: AuthUser, id: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER, TEST], "只有产品经理或测试可以关闭缺陷");
    const defect = await this.prisma.defect.update({
      where: { id },
      data: { status: DefectStatus.CLOSED, actualResult: body.reason ? `${body.reason}` : undefined }
    });
    await this.log({ user, entityType: "DEFECT", entityId: id, projectId: defect.projectId, taskId: defect.taskId, defectId: id, action: "CLOSE", summary: `关闭缺陷：${defect.title}` });
    return defect;
  }

  async reopenDefect(user: AuthUser, id: number, body: any) {
    requireAnyPosition(user, [PRODUCT_MANAGER, TEST], "只有产品经理或测试可以重新打开缺陷");
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
        requirements: { include: { requirement: true } },
        defects: { include: { defect: true } }
      },
      orderBy: { updatedAt: "desc" }
    });
  }

  async createVersion(user: AuthUser, body: any) {
    const projectId = Number(body.projectId);
    const requirementIds = this.toNumberIds(body.requirementIds);
    const defectIds = this.toNumberIds(body.defectIds);
    await this.assertProjectOpen(projectId, "新增版本");
    await this.assertVersionScope(projectId, requirementIds, defectIds);
    const version = await this.prisma.releaseVersion.create({
      data: {
        code: body.code || code("VER"),
        name: body.name,
        projectId,
        type: body.type || "NORMAL",
        status: body.status || VersionStatus.PLANNING,
        plannedReleaseAt: toDate(body.plannedReleaseAt),
        releaseNote: body.releaseNote,
        releaseOwnerId: toInt(body.releaseOwnerId),
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
    await this.advanceProjectStage(user, version.projectId, ProjectStage.ONLINE_OPS, "版本发布成功后，项目进入上线运维");
    await this.log({ user, entityType: "VERSION", entityId: id, projectId: version.projectId, versionId: id, action: "PUBLISH", summary: `发布版本：${version.name}`, afterJson: snapshot });
    return published;
  }

  async listDocuments(projectId?: number) {
    return this.prisma.projectDocument.findMany({
      where: projectId ? { projectId } : {},
      include: { project: true, createdBy: true },
      orderBy: { updatedAt: "desc" }
    });
  }

  async createDocument(user: AuthUser, body: any) {
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
        createdById: user.personId
      }
    });
    await this.log({ user, entityType: "DOCUMENT", entityId: document.id, projectId: document.projectId, action: "CREATE", summary: `新增资料：${document.name}` });
    return document;
  }

  async adminBootstrap() {
    const [positions, organizations, people, accounts, dictionaries, requirementPriorities, defectPriorities, logs] = await Promise.all([
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
      this.prisma.activityLog.findMany({ include: { actor: true }, take: 50, orderBy: { createdAt: "desc" } })
    ]);
    return { positions, organizations, people, accounts, dictionaries, requirementPriorities, defectPriorities, logs };
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
            code: body.code || code("ORG"),
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
            code: body.code || code("POS"),
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
