import {
  AccountStatus,
  DefectStatus,
  EmploymentStatus,
  PrismaClient,
  ProjectStage,
  RequirementLaunchStatus,
  RequirementRevisionType,
  RequirementStatus,
  TaskStatus,
  VersionStatus
} from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const requirementBaseScore: Record<string, number> = {
  P0: 40,
  P1: 30,
  P2: 20,
  P3: 10,
  P4: 0
};

const requirementDefectWeight: Record<string, number> = {
  P0: 1.2,
  P1: 1.15,
  P2: 1.1,
  P3: 1.03,
  P4: 1
};

const defectScore: Record<string, { online: number; offline: number }> = {
  L1: { online: 60, offline: 40 },
  L2: { online: 45, offline: 30 },
  L3: { online: 25, offline: 15 },
  L4: { online: 10, offline: 5 }
};

const revisionBonus: Record<RequirementRevisionType, Record<RequirementLaunchStatus, number>> = {
  [RequirementRevisionType.CHANGE]: {
    [RequirementLaunchStatus.TO_RELEASE]: 6,
    [RequirementLaunchStatus.RELEASED]: 15
  },
  [RequirementRevisionType.OPTIMIZATION]: {
    [RequirementLaunchStatus.TO_RELEASE]: 3,
    [RequirementLaunchStatus.RELEASED]: 8
  }
};

function day(offset: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

function rich(text: string) {
  return `<p>${text}</p>`;
}

function requirementScore(input: {
  priorityLevel: string;
  timingBonus?: number;
  revisionType?: RequirementRevisionType | null;
  launchStatus?: RequirementLaunchStatus | null;
}) {
  const bonus = input.revisionType
    ? revisionBonus[input.revisionType]?.[input.launchStatus || RequirementLaunchStatus.TO_RELEASE] || 0
    : 0;
  return (requirementBaseScore[input.priorityLevel] || 0) + bonus + (input.timingBonus || 0);
}

function taskActualDates(status: TaskStatus, plannedStartDate?: Date | null, plannedFinishDate?: Date | null) {
  if (status === TaskStatus.TODO) return {};
  if (status === TaskStatus.DOING) return { actualStartDate: plannedStartDate || day(-1) };
  if (status === TaskStatus.TO_TEST || status === TaskStatus.TESTING) {
    return { actualStartDate: plannedStartDate || day(-2), actualFinishDate: plannedFinishDate || day(0) };
  }
  return {
    actualStartDate: plannedStartDate || day(-4),
    actualFinishDate: plannedFinishDate || day(-1),
    completionNote: status === TaskStatus.CLOSED ? "演示数据：手动关闭" : "演示数据：测试通过"
  };
}

async function ensurePosition(code: string, name: string) {
  return prisma.position.upsert({
    where: { code },
    update: { name, isSystem: true, isActive: true },
    create: { code, name, isSystem: true, isActive: true }
  });
}

async function ensureOrganization(code: string, name: string, sort: number, parentId?: number) {
  return prisma.organization.upsert({
    where: { code },
    update: { name, sort, parentId, status: "ACTIVE" },
    create: { code, name, sort, parentId, status: "ACTIVE" }
  });
}

async function ensurePerson(input: {
  employeeNo: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  organizationId: number;
  positionId: number;
}) {
  const person = await prisma.person.upsert({
    where: { employeeNo: input.employeeNo },
    update: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      organizationId: input.organizationId,
      primaryPositionId: input.positionId,
      employmentStatus: EmploymentStatus.ACTIVE
    },
    create: {
      name: input.name,
      employeeNo: input.employeeNo,
      email: input.email,
      phone: input.phone,
      organizationId: input.organizationId,
      primaryPositionId: input.positionId,
      employmentStatus: EmploymentStatus.ACTIVE
    }
  });

  await prisma.personPosition.upsert({
    where: { personId_positionId: { personId: person.id, positionId: input.positionId } },
    update: { isPrimary: true, expiredAt: null },
    create: { personId: person.id, positionId: input.positionId, isPrimary: true }
  });

  const passwordHash = await bcrypt.hash("123", 10);
  await prisma.account.upsert({
    where: { username: input.username },
    update: {
      personId: person.id,
      passwordHash,
      initialPassword: true,
      status: AccountStatus.ACTIVE,
      allowLogin: true
    },
    create: {
      username: input.username,
      passwordHash,
      personId: person.id,
      initialPassword: true,
      status: AccountStatus.ACTIVE,
      allowLogin: true
    }
  });

  return person;
}

async function ensureProjectMember(projectId: number, personId: number, responsibility: string, isProjectOwner = false) {
  await prisma.projectMember.upsert({
    where: { projectId_personId: { projectId, personId } },
    update: { responsibility, isProjectOwner },
    create: { projectId, personId, responsibility, isProjectOwner }
  });
}

async function main() {
  const root = await ensureOrganization("ROOT", "默认组织", 1);
  const orgs = {
    product: await ensureOrganization("DEMO_PRODUCT", "产品与项目管理部", 10, root.id),
    tech: await ensureOrganization("DEMO_TECH", "研发中心", 20, root.id),
    qa: await ensureOrganization("DEMO_QA", "质量保障部", 30, root.id),
    ops: await ensureOrganization("DEMO_OPS", "运维数据部", 40, root.id)
  };

  const positions = {
    PRODUCT_MANAGER: await ensurePosition("PRODUCT_MANAGER", "产品经理"),
    UI: await ensurePosition("UI", "UI"),
    FRONTEND: await ensurePosition("FRONTEND", "前端"),
    BACKEND: await ensurePosition("BACKEND", "后端"),
    DATA: await ensurePosition("DATA", "数据"),
    TEST: await ensurePosition("TEST", "测试"),
    OPS: await ensurePosition("OPS", "运维"),
    BUSINESS: await ensurePosition("BUSINESS", "业务")
  };

  const people = {
    pm: await ensurePerson({
      employeeNo: "DEMO_PM_001",
      name: "刘娜",
      username: "demo_pm",
      email: "demo_pm@example.local",
      phone: "13800010001",
      organizationId: orgs.product.id,
      positionId: positions.PRODUCT_MANAGER.id
    }),
    ui: await ensurePerson({
      employeeNo: "DEMO_UI_001",
      name: "陈妍",
      username: "demo_ui",
      email: "demo_ui@example.local",
      phone: "13800010002",
      organizationId: orgs.tech.id,
      positionId: positions.UI.id
    }),
    fe1: await ensurePerson({
      employeeNo: "DEMO_FE_001",
      name: "王启",
      username: "demo_fe",
      email: "demo_fe@example.local",
      phone: "13800010003",
      organizationId: orgs.tech.id,
      positionId: positions.FRONTEND.id
    }),
    fe2: await ensurePerson({
      employeeNo: "DEMO_FE_002",
      name: "林昊",
      username: "demo_fe2",
      email: "demo_fe2@example.local",
      phone: "13800010004",
      organizationId: orgs.tech.id,
      positionId: positions.FRONTEND.id
    }),
    be1: await ensurePerson({
      employeeNo: "DEMO_BE_001",
      name: "赵睿",
      username: "demo_be",
      email: "demo_be@example.local",
      phone: "13800010005",
      organizationId: orgs.tech.id,
      positionId: positions.BACKEND.id
    }),
    be2: await ensurePerson({
      employeeNo: "DEMO_BE_002",
      name: "胡嘉",
      username: "demo_be2",
      email: "demo_be2@example.local",
      phone: "13800010006",
      organizationId: orgs.tech.id,
      positionId: positions.BACKEND.id
    }),
    data: await ensurePerson({
      employeeNo: "DEMO_DATA_001",
      name: "孙澄",
      username: "demo_data",
      email: "demo_data@example.local",
      phone: "13800010007",
      organizationId: orgs.ops.id,
      positionId: positions.DATA.id
    }),
    test: await ensurePerson({
      employeeNo: "DEMO_TEST_001",
      name: "周晴",
      username: "demo_test",
      email: "demo_test@example.local",
      phone: "13800010008",
      organizationId: orgs.qa.id,
      positionId: positions.TEST.id
    }),
    ops: await ensurePerson({
      employeeNo: "DEMO_OPS_001",
      name: "马骁",
      username: "demo_ops",
      email: "demo_ops@example.local",
      phone: "13800010009",
      organizationId: orgs.ops.id,
      positionId: positions.OPS.id
    })
  };

  const projectSpecs = [
    {
      code: "PROJ-DEMO-CRM",
      name: "客户运营中台二期",
      scope: "客户标签、活动审批、画像详情和触达效果闭环。",
      stage: ProjectStage.DEV_TEST,
      start: -18,
      end: 28,
      launch: 35,
      background: "运营侧需要把客户分层、活动配置、审批与效果追踪沉淀到统一中台。",
      goal: "提升活动配置效率，降低人工审批成本，支撑精细化运营。",
      systems: "客户运营中台、消息中心、审批流、数据集市"
    },
    {
      code: "PROJ-DEMO-APP",
      name: "移动端会员体验优化",
      scope: "会员权益、积分明细、个人中心和移动端性能体验。",
      stage: ProjectStage.DEV_TEST,
      start: -10,
      end: 24,
      launch: 30,
      background: "移动端会员入口投诉量较高，权益领取和积分查询路径需要集中优化。",
      goal: "降低会员权益领取失败率，提升个人中心关键入口转化。",
      systems: "会员 APP、小程序、权益中心、积分服务"
    },
    {
      code: "PROJ-DEMO-DATA",
      name: "经营分析看板升级",
      scope: "经营日报、销售漏斗、指标口径和门店维度分析。",
      stage: ProjectStage.SOLUTION_DESIGN,
      start: -4,
      end: 40,
      launch: 48,
      background: "当前经营报表分散在多个系统，管理层无法快速定位指标波动原因。",
      goal: "统一核心指标口径，形成可下钻、可订阅、可追踪的数据看板。",
      systems: "BI 平台、数据仓库、门店系统、CRM"
    },
    {
      code: "PROJ-DEMO-RISK",
      name: "风控策略配置平台",
      scope: "策略灰度、规则命中明细、回滚机制和审计追踪。",
      stage: ProjectStage.ONLINE_OPS,
      start: -30,
      end: 12,
      launch: 16,
      background: "风控策略发布依赖人工脚本，灰度、回滚和审计能力不足。",
      goal: "策略变更可配置、可灰度、可回滚，支持命中明细追溯。",
      systems: "风控平台、规则引擎、审计中心、监控平台"
    }
  ];

  const projects: Record<string, Awaited<ReturnType<typeof prisma.project.upsert>>> = {};
  for (const spec of projectSpecs) {
    projects[spec.code] = await prisma.project.upsert({
      where: { code: spec.code },
      update: {
        name: spec.name,
        ownerId: people.pm.id,
        scope: rich(spec.scope),
        plannedStartDate: day(spec.start),
        plannedEndDate: day(spec.end),
        expectedLaunchDate: day(spec.launch),
        stage: spec.stage,
        background: rich(spec.background),
        goal: rich(spec.goal),
        relatedSystems: rich(spec.systems),
        isArchived: false
      },
      create: {
        code: spec.code,
        name: spec.name,
        ownerId: people.pm.id,
        scope: rich(spec.scope),
        plannedStartDate: day(spec.start),
        plannedEndDate: day(spec.end),
        expectedLaunchDate: day(spec.launch),
        stage: spec.stage,
        background: rich(spec.background),
        goal: rich(spec.goal),
        relatedSystems: rich(spec.systems)
      }
    });

    await ensureProjectMember(projects[spec.code].id, people.pm.id, "项目负责人", true);
    await ensureProjectMember(projects[spec.code].id, people.ui.id, "体验设计");
    await ensureProjectMember(projects[spec.code].id, people.fe1.id, "前端开发");
    await ensureProjectMember(projects[spec.code].id, people.be1.id, "后端开发");
    await ensureProjectMember(projects[spec.code].id, people.test.id, "测试验证");
  }
  await ensureProjectMember(projects["PROJ-DEMO-DATA"].id, people.data.id, "数据开发");
  await ensureProjectMember(projects["PROJ-DEMO-RISK"].id, people.ops.id, "运维发布");

  const requirementSpecs: Array<{
    code: string;
    title: string;
    projectCode: string;
    type: string;
    status: RequirementStatus;
    launchStatus: RequirementLaunchStatus;
    priorityLevel: string;
    timingBonus?: number;
    revisionType?: RequirementRevisionType | null;
    sourceCode?: string;
    ownerKey?: keyof typeof people;
    expectedOffset?: number;
    description: string;
    acceptance: string;
  }> = [
    {
      code: "REQ-DEMO-CRM-001",
      title: "客户标签圈选规则升级",
      projectCode: "PROJ-DEMO-CRM",
      type: "FEATURE",
      status: RequirementStatus.DEVELOPING,
      launchStatus: RequirementLaunchStatus.TO_RELEASE,
      priorityLevel: "P1",
      timingBonus: 2,
      ownerKey: "pm",
      expectedOffset: 22,
      description: "运营可组合客户属性、消费行为和活动触达数据生成动态人群包。",
      acceptance: "支持保存规则模板，圈选结果可预估人数并同步到消息中心。"
    },
    {
      code: "REQ-DEMO-CRM-002",
      title: "营销活动审批链路补强",
      projectCode: "PROJ-DEMO-CRM",
      type: "PROCESS",
      status: RequirementStatus.COMPLETED,
      launchStatus: RequirementLaunchStatus.TO_RELEASE,
      priorityLevel: "P0",
      timingBonus: 5,
      ownerKey: "pm",
      expectedOffset: 10,
      description: "活动上线前必须按金额、客群和渠道自动匹配审批节点。",
      acceptance: "审批流可回退、可加签，审批通过后才允许进入待上线版本。"
    },
    {
      code: "REQ-DEMO-CRM-003",
      title: "触达效果复盘报表",
      projectCode: "PROJ-DEMO-CRM",
      type: "REPORT",
      status: RequirementStatus.TO_REVIEW,
      launchStatus: RequirementLaunchStatus.TO_RELEASE,
      priorityLevel: "P2",
      ownerKey: "pm",
      expectedOffset: 35,
      description: "活动结束后展示触达、打开、转化、成交和复购情况。",
      acceptance: "支持按活动、渠道、人群包筛选，并导出复盘明细。"
    },
    {
      code: "REQ-DEMO-CRM-004",
      title: "客户画像详情加载优化（原方案）",
      projectCode: "PROJ-DEMO-CRM",
      type: "UX",
      status: RequirementStatus.OPTIMIZATION,
      launchStatus: RequirementLaunchStatus.RELEASED,
      priorityLevel: "P2",
      timingBonus: 4,
      ownerKey: "pm",
      expectedOffset: -5,
      description: "原画像详情页加载慢，已作为优化终态保留。",
      acceptance: "保留原需求记录，不再允许继续拆任务。"
    },
    {
      code: "REQ-DEMO-CRM-004-OPT",
      title: "客户画像详情分屏加载优化",
      projectCode: "PROJ-DEMO-CRM",
      type: "UX",
      status: RequirementStatus.TO_REVIEW,
      launchStatus: RequirementLaunchStatus.RELEASED,
      priorityLevel: "P1",
      timingBonus: 6,
      revisionType: RequirementRevisionType.OPTIMIZATION,
      sourceCode: "REQ-DEMO-CRM-004",
      ownerKey: "pm",
      expectedOffset: 9,
      description: "已上线画像详情页需增加分屏加载和慢接口降级。",
      acceptance: "首屏 2 秒内可用，慢接口不阻塞主信息展示。"
    },
    {
      code: "REQ-DEMO-APP-001",
      title: "会员权益领取链路稳定性治理",
      projectCode: "PROJ-DEMO-APP",
      type: "FEATURE",
      status: RequirementStatus.DEVELOPING,
      launchStatus: RequirementLaunchStatus.TO_RELEASE,
      priorityLevel: "P0",
      timingBonus: 8,
      ownerKey: "pm",
      expectedOffset: 14,
      description: "会员权益领取失败率偏高，需要治理接口超时、库存扣减和重复领取问题。",
      acceptance: "高峰期领取成功率不低于 99.5%，重复领取可幂等处理。"
    },
    {
      code: "REQ-DEMO-APP-002",
      title: "积分明细筛选体验优化",
      projectCode: "PROJ-DEMO-APP",
      type: "UX",
      status: RequirementStatus.APPROVED,
      launchStatus: RequirementLaunchStatus.TO_RELEASE,
      priorityLevel: "P2",
      ownerKey: "pm",
      expectedOffset: 28,
      description: "用户可以按来源、时间、积分变动类型筛选积分明细。",
      acceptance: "筛选条件支持组合查询，返回结果分页稳定。"
    },
    {
      code: "REQ-DEMO-APP-003",
      title: "个人中心文案统一",
      projectCode: "PROJ-DEMO-APP",
      type: "UX",
      status: RequirementStatus.COMPLETED,
      launchStatus: RequirementLaunchStatus.RELEASED,
      priorityLevel: "P3",
      ownerKey: "pm",
      expectedOffset: -3,
      description: "统一个人中心权益、积分、优惠券相关文案。",
      acceptance: "全端文案与运营规范一致，已随 2.7.0 发布。"
    },
    {
      code: "REQ-DEMO-DATA-001",
      title: "经营日报指标口径统一",
      projectCode: "PROJ-DEMO-DATA",
      type: "DATA",
      status: RequirementStatus.APPROVED,
      launchStatus: RequirementLaunchStatus.TO_RELEASE,
      priorityLevel: "P1",
      timingBonus: 1,
      ownerKey: "pm",
      expectedOffset: 32,
      description: "统一 GMV、净销售额、退款率、客单价等经营指标口径。",
      acceptance: "指标口径文档归档，日报与 BI 看板计算结果一致。"
    },
    {
      code: "REQ-DEMO-DATA-002",
      title: "门店销售漏斗看板",
      projectCode: "PROJ-DEMO-DATA",
      type: "REPORT",
      status: RequirementStatus.DEVELOPING,
      launchStatus: RequirementLaunchStatus.TO_RELEASE,
      priorityLevel: "P2",
      timingBonus: 3,
      ownerKey: "pm",
      expectedOffset: 38,
      description: "按门店、区域和渠道展示曝光、进店、咨询、下单、成交漏斗。",
      acceptance: "支持按日期和区域筛选，数据每日自动更新。"
    },
    {
      code: "REQ-DEMO-DATA-003",
      title: "长期销量预测模型调研",
      projectCode: "PROJ-DEMO-DATA",
      type: "DATA",
      status: RequirementStatus.DEFERRED,
      launchStatus: RequirementLaunchStatus.TO_RELEASE,
      priorityLevel: "P4",
      ownerKey: "pm",
      expectedOffset: 90,
      description: "调研季度销量预测模型的特征、算法和历史数据质量。",
      acceptance: "输出调研报告即可，暂不进入开发。"
    },
    {
      code: "REQ-DEMO-RISK-001",
      title: "策略灰度开关与回滚机制",
      projectCode: "PROJ-DEMO-RISK",
      type: "FEATURE",
      status: RequirementStatus.COMPLETED,
      launchStatus: RequirementLaunchStatus.TO_RELEASE,
      priorityLevel: "P0",
      timingBonus: 4,
      ownerKey: "pm",
      expectedOffset: 5,
      description: "策略上线支持按渠道、地区和用户比例灰度，异常可一键回滚。",
      acceptance: "灰度配置实时生效，回滚操作有审计记录。"
    },
    {
      code: "REQ-DEMO-RISK-002",
      title: "规则命中明细追踪",
      projectCode: "PROJ-DEMO-RISK",
      type: "DATA",
      status: RequirementStatus.DEVELOPING,
      launchStatus: RequirementLaunchStatus.TO_RELEASE,
      priorityLevel: "P1",
      timingBonus: 2,
      ownerKey: "pm",
      expectedOffset: 18,
      description: "风控规则命中后记录规则版本、命中原因、请求入参和处置结果。",
      acceptance: "支持按订单号、用户号、规则 ID 查询命中明细。"
    }
  ];

  const requirements: Record<string, Awaited<ReturnType<typeof prisma.requirement.upsert>>> = {};
  for (const spec of requirementSpecs) {
    const source = spec.sourceCode ? requirements[spec.sourceCode] || await prisma.requirement.findUnique({ where: { code: spec.sourceCode } }) : null;
    const score = requirementScore({
      priorityLevel: spec.priorityLevel,
      timingBonus: spec.timingBonus,
      revisionType: spec.revisionType,
      launchStatus: spec.launchStatus
    });
    requirements[spec.code] = await prisma.requirement.upsert({
      where: { code: spec.code },
      update: {
        title: spec.title,
        projectId: projects[spec.projectCode].id,
        type: spec.type,
        status: spec.status,
        launchStatus: spec.launchStatus,
        revisionType: spec.revisionType || null,
        optimizationSourceId: source?.id || null,
        priorityLevel: spec.priorityLevel,
        description: rich(spec.description),
        acceptanceCriteria: rich(spec.acceptance),
        expectedLaunchDate: spec.expectedOffset === undefined ? null : day(spec.expectedOffset),
        reviewDate: spec.status === RequirementStatus.TO_REVIEW ? null : day(-8),
        reviewConclusion: spec.status === RequirementStatus.APPROVED || spec.status === RequirementStatus.DEVELOPING || spec.status === RequirementStatus.COMPLETED ? "PASS" : null,
        reviewRecord: spec.status === RequirementStatus.TO_REVIEW ? null : "演示数据：评审结论已记录。",
        timingBonus: spec.timingBonus || 0,
        timingBonusReason: spec.timingBonus ? "演示数据：业务窗口期临近" : null,
        priorityScore: score,
        ownerId: people[spec.ownerKey || "pm"].id,
        submitterId: people.pm.id
      },
      create: {
        code: spec.code,
        title: spec.title,
        projectId: projects[spec.projectCode].id,
        type: spec.type,
        status: spec.status,
        launchStatus: spec.launchStatus,
        revisionType: spec.revisionType || null,
        optimizationSourceId: source?.id || null,
        priorityLevel: spec.priorityLevel,
        description: rich(spec.description),
        acceptanceCriteria: rich(spec.acceptance),
        expectedLaunchDate: spec.expectedOffset === undefined ? null : day(spec.expectedOffset),
        reviewDate: spec.status === RequirementStatus.TO_REVIEW ? null : day(-8),
        reviewConclusion: spec.status === RequirementStatus.APPROVED || spec.status === RequirementStatus.DEVELOPING || spec.status === RequirementStatus.COMPLETED ? "PASS" : null,
        reviewRecord: spec.status === RequirementStatus.TO_REVIEW ? null : "演示数据：评审结论已记录。",
        timingBonus: spec.timingBonus || 0,
        timingBonusReason: spec.timingBonus ? "演示数据：业务窗口期临近" : null,
        priorityScore: score,
        ownerId: people[spec.ownerKey || "pm"].id,
        submitterId: people.pm.id
      }
    });
  }

  const taskSpecs: Array<{
    code: string;
    title: string;
    requirementCode: string;
    assigneeKey: keyof typeof people;
    status: TaskStatus;
    start?: number | null;
    finish?: number | null;
  }> = [
    { code: "TASK-DEMO-CRM-001-FE", title: "标签规则编辑器前端开发", requirementCode: "REQ-DEMO-CRM-001", assigneeKey: "fe1", status: TaskStatus.DOING, start: -2, finish: 4 },
    { code: "TASK-DEMO-CRM-001-BE", title: "人群圈选服务接口改造", requirementCode: "REQ-DEMO-CRM-001", assigneeKey: "be1", status: TaskStatus.TODO, start: 1, finish: 7 },
    { code: "TASK-DEMO-CRM-001-DATA", title: "标签数据宽表补充", requirementCode: "REQ-DEMO-CRM-001", assigneeKey: "data", status: TaskStatus.DOING, start: -3, finish: 3 },
    { code: "TASK-DEMO-CRM-001-UI", title: "圈选规则交互稿调整", requirementCode: "REQ-DEMO-CRM-001", assigneeKey: "ui", status: TaskStatus.TO_TEST, start: -6, finish: -1 },
    { code: "TASK-DEMO-CRM-002-FE", title: "审批节点配置页面", requirementCode: "REQ-DEMO-CRM-002", assigneeKey: "fe2", status: TaskStatus.TEST_PASSED, start: -13, finish: -7 },
    { code: "TASK-DEMO-CRM-002-BE", title: "审批流规则引擎适配", requirementCode: "REQ-DEMO-CRM-002", assigneeKey: "be2", status: TaskStatus.TEST_PASSED, start: -12, finish: -5 },
    { code: "TASK-DEMO-CRM-002-TEST", title: "审批链路回归测试", requirementCode: "REQ-DEMO-CRM-002", assigneeKey: "test", status: TaskStatus.TEST_PASSED, start: -5, finish: -2 },
    { code: "TASK-DEMO-APP-001-FE", title: "权益领取页状态补偿", requirementCode: "REQ-DEMO-APP-001", assigneeKey: "fe1", status: TaskStatus.DOING, start: -1, finish: 5 },
    { code: "TASK-DEMO-APP-001-BE", title: "领取接口幂等与库存锁", requirementCode: "REQ-DEMO-APP-001", assigneeKey: "be1", status: TaskStatus.DOING, start: -2, finish: 6 },
    { code: "TASK-DEMO-APP-001-TEST", title: "权益领取压测与回归", requirementCode: "REQ-DEMO-APP-001", assigneeKey: "test", status: TaskStatus.TODO, start: 4, finish: 9 },
    { code: "TASK-DEMO-APP-002-UI", title: "积分明细筛选交互稿", requirementCode: "REQ-DEMO-APP-002", assigneeKey: "ui", status: TaskStatus.TODO, start: 2, finish: 5 },
    { code: "TASK-DEMO-APP-003-FE", title: "个人中心文案替换", requirementCode: "REQ-DEMO-APP-003", assigneeKey: "fe2", status: TaskStatus.TEST_PASSED, start: -9, finish: -8 },
    { code: "TASK-DEMO-DATA-002-DATA", title: "销售漏斗指标加工", requirementCode: "REQ-DEMO-DATA-002", assigneeKey: "data", status: TaskStatus.DOING, start: 0, finish: 8 },
    { code: "TASK-DEMO-DATA-002-BE", title: "看板查询接口开发", requirementCode: "REQ-DEMO-DATA-002", assigneeKey: "be1", status: TaskStatus.TODO, start: 5, finish: 12 },
    { code: "TASK-DEMO-DATA-002-FE", title: "漏斗看板前端开发", requirementCode: "REQ-DEMO-DATA-002", assigneeKey: "fe1", status: TaskStatus.TODO, start: 8, finish: 15 },
    { code: "TASK-DEMO-DATA-002-UNSCHEDULED", title: "历史数据回填脚本", requirementCode: "REQ-DEMO-DATA-002", assigneeKey: "data", status: TaskStatus.TODO, start: null, finish: null },
    { code: "TASK-DEMO-RISK-001-BE", title: "策略灰度配置服务", requirementCode: "REQ-DEMO-RISK-001", assigneeKey: "be2", status: TaskStatus.TEST_PASSED, start: -15, finish: -8 },
    { code: "TASK-DEMO-RISK-001-OPS", title: "回滚脚本与监控接入", requirementCode: "REQ-DEMO-RISK-001", assigneeKey: "ops", status: TaskStatus.TEST_PASSED, start: -8, finish: -4 },
    { code: "TASK-DEMO-RISK-002-BE", title: "规则命中明细落库", requirementCode: "REQ-DEMO-RISK-002", assigneeKey: "be2", status: TaskStatus.DOING, start: -1, finish: 6 },
    { code: "TASK-DEMO-RISK-002-DATA", title: "命中明细查询索引优化", requirementCode: "REQ-DEMO-RISK-002", assigneeKey: "data", status: TaskStatus.TODO, start: 7, finish: 13 },
    { code: "TASK-DEMO-RISK-002-TEST", title: "风控规则回放测试", requirementCode: "REQ-DEMO-RISK-002", assigneeKey: "test", status: TaskStatus.TO_TEST, start: -4, finish: 2 }
  ];

  const tasks: Record<string, Awaited<ReturnType<typeof prisma.devTask.upsert>>> = {};
  for (const spec of taskSpecs) {
    const requirement = requirements[spec.requirementCode];
    const plannedStartDate = spec.start === undefined ? day(0) : spec.start === null ? null : day(spec.start);
    const plannedFinishDate = spec.finish === undefined ? null : spec.finish === null ? null : day(spec.finish);
    tasks[spec.code] = await prisma.devTask.upsert({
      where: { code: spec.code },
      update: {
        title: spec.title,
        projectId: requirement.projectId,
        requirementId: requirement.id,
        type: people[spec.assigneeKey].primaryPositionId === positions.UI.id ? "UI" : people[spec.assigneeKey].primaryPositionId === positions.BACKEND.id ? "BACKEND" : people[spec.assigneeKey].primaryPositionId === positions.DATA.id ? "DATA" : people[spec.assigneeKey].primaryPositionId === positions.TEST.id ? "TEST" : people[spec.assigneeKey].primaryPositionId === positions.OPS.id ? "OPS" : "FRONTEND",
        status: spec.status,
        assigneeId: people[spec.assigneeKey].id,
        plannedStartDate,
        plannedFinishDate,
        priorityScore: requirement.priorityScore,
        ...taskActualDates(spec.status, plannedStartDate, plannedFinishDate)
      },
      create: {
        code: spec.code,
        title: spec.title,
        projectId: requirement.projectId,
        requirementId: requirement.id,
        type: people[spec.assigneeKey].primaryPositionId === positions.UI.id ? "UI" : people[spec.assigneeKey].primaryPositionId === positions.BACKEND.id ? "BACKEND" : people[spec.assigneeKey].primaryPositionId === positions.DATA.id ? "DATA" : people[spec.assigneeKey].primaryPositionId === positions.TEST.id ? "TEST" : people[spec.assigneeKey].primaryPositionId === positions.OPS.id ? "OPS" : "FRONTEND",
        status: spec.status,
        assigneeId: people[spec.assigneeKey].id,
        plannedStartDate,
        plannedFinishDate,
        priorityScore: requirement.priorityScore,
        ...taskActualDates(spec.status, plannedStartDate, plannedFinishDate)
      }
    });
  }

  const defectSpecs: Array<{
    code: string;
    title: string;
    taskCode: string;
    assigneeKey: keyof typeof people;
    reporterKey: keyof typeof people;
    level: string;
    environment: string;
    status: DefectStatus;
    planned?: number | null;
    timingBonus?: number;
    description: string;
  }> = [
    { code: "BUG-DEMO-CRM-001", title: "标签组合条件切换后预估人数未刷新", taskCode: "TASK-DEMO-CRM-001-FE", assigneeKey: "fe1", reporterKey: "test", level: "L3", environment: "TEST", status: DefectStatus.FIXING, planned: 2, description: "切换标签条件后，预估人数仍展示上一次结果。" },
    { code: "BUG-DEMO-CRM-002", title: "审批加签后节点顺序异常", taskCode: "TASK-DEMO-CRM-002-BE", assigneeKey: "be2", reporterKey: "test", level: "L2", environment: "TEST", status: DefectStatus.VERIFIED, planned: -4, description: "加签后审批节点顺序偶发错乱，已验证通过。" },
    { code: "BUG-DEMO-CRM-003", title: "审批列表返回按钮样式错位", taskCode: "TASK-DEMO-CRM-002-FE", assigneeKey: "fe2", reporterKey: "test", level: "L4", environment: "TEST", status: DefectStatus.CLOSED, planned: -6, description: "样式问题，已关闭。" },
    { code: "BUG-DEMO-APP-001", title: "线上权益领取偶发重复扣减", taskCode: "TASK-DEMO-APP-001-BE", assigneeKey: "be1", reporterKey: "test", level: "L1", environment: "ONLINE", status: DefectStatus.TO_FIX, planned: 1, timingBonus: 6, description: "用户重复点击领取时，库存扣减存在并发问题。" },
    { code: "BUG-DEMO-APP-002", title: "权益领取成功弹窗未关闭", taskCode: "TASK-DEMO-APP-001-FE", assigneeKey: "fe1", reporterKey: "test", level: "L3", environment: "TEST", status: DefectStatus.FIXED, planned: 0, description: "点击返回后弹窗仍停留在页面上。" },
    { code: "BUG-DEMO-APP-003", title: "积分筛选默认时间为空", taskCode: "TASK-DEMO-APP-002-UI", assigneeKey: "ui", reporterKey: "test", level: "L4", environment: "TEST", status: DefectStatus.TO_FIX, planned: null, description: "未设置默认筛选时间，作为未排期缺陷展示。" },
    { code: "BUG-DEMO-DATA-001", title: "漏斗看板区域汇总数不一致", taskCode: "TASK-DEMO-DATA-002-DATA", assigneeKey: "data", reporterKey: "test", level: "L2", environment: "TEST", status: DefectStatus.FIXING, planned: 6, description: "区域汇总和门店明细合计存在口径差异。" },
    { code: "BUG-DEMO-DATA-002", title: "看板查询接口分页总数错误", taskCode: "TASK-DEMO-DATA-002-BE", assigneeKey: "be1", reporterKey: "test", level: "L3", environment: "TEST", status: DefectStatus.TO_FIX, planned: 9, description: "分页 total 返回当前页数量。" },
    { code: "BUG-DEMO-RISK-001", title: "灰度比例 0% 时仍命中部分用户", taskCode: "TASK-DEMO-RISK-001-BE", assigneeKey: "be2", reporterKey: "test", level: "L2", environment: "GRAY", status: DefectStatus.VERIFIED, planned: -6, description: "灰度比例边界值问题，已验证。" },
    { code: "BUG-DEMO-RISK-002", title: "命中明细查询条件未带规则版本", taskCode: "TASK-DEMO-RISK-002-BE", assigneeKey: "be2", reporterKey: "test", level: "L2", environment: "TEST", status: DefectStatus.FIXING, planned: 4, description: "查询明细时缺少规则版本过滤，导致展示混淆。" },
    { code: "BUG-DEMO-RISK-003", title: "规则回放测试报告导出失败", taskCode: "TASK-DEMO-RISK-002-TEST", assigneeKey: "test", reporterKey: "test", level: "L3", environment: "TEST", status: DefectStatus.FIXED, planned: 2, description: "测试报告导出接口返回 500。" }
  ];

  const defects: Record<string, Awaited<ReturnType<typeof prisma.defect.upsert>>> = {};
  for (const spec of defectSpecs) {
    const task = tasks[spec.taskCode];
    const requirement = requirements[task.requirementId === undefined ? "" : Object.keys(requirements).find((key) => requirements[key].id === task.requirementId) || ""];
    const priorityLevel = requirement?.priorityLevel || "P4";
    const base = String(spec.environment).toUpperCase() === "ONLINE" ? defectScore[spec.level].online : defectScore[spec.level].offline;
    const priorityScore = base * (requirementDefectWeight[priorityLevel] || 1) + (spec.timingBonus || 0);
    defects[spec.code] = await prisma.defect.upsert({
      where: { code: spec.code },
      update: {
        title: spec.title,
        projectId: task.projectId,
        taskId: task.id,
        level: spec.level,
        status: spec.status,
        assigneeId: people[spec.assigneeKey].id,
        reporterId: people[spec.reporterKey].id,
        description: rich(spec.description),
        reproduceSteps: "演示数据：按测试用例复现。",
        actualResult: spec.status === DefectStatus.CLOSED ? "演示数据：关闭处理。" : undefined,
        expectedResult: spec.status === DefectStatus.VERIFIED ? "演示数据：验证通过。" : undefined,
        environment: spec.environment,
        plannedFixDate: spec.planned === undefined ? null : spec.planned === null ? null : day(spec.planned),
        actualFixDate: spec.status === DefectStatus.FIXED || spec.status === DefectStatus.VERIFIED || spec.status === DefectStatus.CLOSED ? day(-1) : null,
        timingBonus: spec.timingBonus || 0,
        timingBonusReason: spec.timingBonus ? "演示数据：线上紧急缺陷" : null,
        priorityScore
      },
      create: {
        code: spec.code,
        title: spec.title,
        projectId: task.projectId,
        taskId: task.id,
        level: spec.level,
        status: spec.status,
        assigneeId: people[spec.assigneeKey].id,
        reporterId: people[spec.reporterKey].id,
        description: rich(spec.description),
        reproduceSteps: "演示数据：按测试用例复现。",
        actualResult: spec.status === DefectStatus.CLOSED ? "演示数据：关闭处理。" : undefined,
        expectedResult: spec.status === DefectStatus.VERIFIED ? "演示数据：验证通过。" : undefined,
        environment: spec.environment,
        plannedFixDate: spec.planned === undefined ? null : spec.planned === null ? null : day(spec.planned),
        actualFixDate: spec.status === DefectStatus.FIXED || spec.status === DefectStatus.VERIFIED || spec.status === DefectStatus.CLOSED ? day(-1) : null,
        timingBonus: spec.timingBonus || 0,
        timingBonusReason: spec.timingBonus ? "演示数据：线上紧急缺陷" : null,
        priorityScore
      }
    });
  }

  const documentNames = [
    "客户运营中台 PRD",
    "客户标签规则技术方案",
    "会员权益测试用例",
    "经营指标口径说明",
    "风控策略发布手册"
  ];
  await prisma.projectDocument.deleteMany({ where: { name: { in: documentNames } } });
  await prisma.projectDocument.createMany({
    data: [
      { projectId: projects["PROJ-DEMO-CRM"].id, name: "客户运营中台 PRD", type: "BUSINESS", linkUrl: "https://demo.local/docs/crm-prd", description: "演示数据：业务 PRD 链接", createdById: people.pm.id },
      { projectId: projects["PROJ-DEMO-CRM"].id, name: "客户标签规则技术方案", type: "TECH", linkUrl: "https://demo.local/docs/tag-tech", description: "演示数据：技术方案链接", createdById: people.be1.id },
      { projectId: projects["PROJ-DEMO-APP"].id, name: "会员权益测试用例", type: "TEST", linkUrl: "https://demo.local/docs/member-testcase", description: "演示数据：测试用例链接", createdById: people.test.id },
      { projectId: projects["PROJ-DEMO-DATA"].id, name: "经营指标口径说明", type: "BUSINESS", linkUrl: "https://demo.local/docs/metric-dict", description: "演示数据：指标口径链接", createdById: people.data.id },
      { projectId: projects["PROJ-DEMO-RISK"].id, name: "风控策略发布手册", type: "RELEASE", linkUrl: "https://demo.local/docs/risk-release", description: "演示数据：发布手册链接", createdById: people.ops.id }
    ]
  });

  const versionSpecs = [
    {
      code: "VER-DEMO-CRM-1.3.0",
      name: "客户运营中台 1.3.0",
      projectCode: "PROJ-DEMO-CRM",
      type: "NORMAL",
      status: VersionStatus.READY_TO_RELEASE,
      planned: 10,
      requirementCodes: ["REQ-DEMO-CRM-002"],
      defectCodes: ["BUG-DEMO-CRM-002", "BUG-DEMO-CRM-003"]
    },
    {
      code: "VER-DEMO-APP-2.7.0",
      name: "移动端会员体验 2.7.0",
      projectCode: "PROJ-DEMO-APP",
      type: "NORMAL",
      status: VersionStatus.RELEASED,
      planned: -3,
      requirementCodes: ["REQ-DEMO-APP-003"],
      defectCodes: []
    },
    {
      code: "VER-DEMO-RISK-1.1.0",
      name: "风控策略配置 1.1.0",
      projectCode: "PROJ-DEMO-RISK",
      type: "NORMAL",
      status: VersionStatus.READY_TO_RELEASE,
      planned: 5,
      requirementCodes: ["REQ-DEMO-RISK-001"],
      defectCodes: ["BUG-DEMO-RISK-001"]
    }
  ];

  for (const spec of versionSpecs) {
    const project = projects[spec.projectCode];
    const version = await prisma.releaseVersion.upsert({
      where: { projectId_code: { projectId: project.id, code: spec.code } },
      update: {
        name: spec.name,
        type: spec.type,
        status: spec.status,
        plannedReleaseAt: day(spec.planned),
        actualReleaseAt: spec.status === VersionStatus.RELEASED ? day(-3) : null,
        releaseOwnerId: people.test.id,
        releaseNote: "演示数据：版本范围用于测试发布中心。",
        riskNote: "演示数据：关注发布窗口和回滚预案。",
        rollbackPlan: "演示数据：异常时回滚上一版本配置。"
      },
      create: {
        code: spec.code,
        name: spec.name,
        projectId: project.id,
        type: spec.type,
        status: spec.status,
        plannedReleaseAt: day(spec.planned),
        actualReleaseAt: spec.status === VersionStatus.RELEASED ? day(-3) : null,
        releaseOwnerId: people.test.id,
        releaseNote: "演示数据：版本范围用于测试发布中心。",
        riskNote: "演示数据：关注发布窗口和回滚预案。",
        rollbackPlan: "演示数据：异常时回滚上一版本配置。"
      }
    });
    await prisma.versionRequirement.deleteMany({ where: { versionId: version.id } });
    await prisma.versionDefect.deleteMany({ where: { versionId: version.id } });
    await prisma.versionRequirement.createMany({
      data: spec.requirementCodes.map((requirementCode) => ({ versionId: version.id, requirementId: requirements[requirementCode].id })),
      skipDuplicates: true
    });
    await prisma.versionDefect.createMany({
      data: spec.defectCodes.map((defectCode) => ({ versionId: version.id, defectId: defects[defectCode].id })),
      skipDuplicates: true
    });
  }

  const counts = await Promise.all([
    prisma.project.count({ where: { code: { startsWith: "PROJ-DEMO-" } } }),
    prisma.requirement.count({ where: { code: { startsWith: "REQ-DEMO-" } } }),
    prisma.devTask.count({ where: { code: { startsWith: "TASK-DEMO-" } } }),
    prisma.defect.count({ where: { code: { startsWith: "BUG-DEMO-" } } }),
    prisma.releaseVersion.count({ where: { code: { startsWith: "VER-DEMO-" } } }),
    prisma.person.count({ where: { employeeNo: { startsWith: "DEMO_" } } })
  ]);

  console.log(`演示数据已准备：项目 ${counts[0]} 个，需求 ${counts[1]} 条，任务 ${counts[2]} 条，缺陷 ${counts[3]} 条，版本 ${counts[4]} 个，人员 ${counts[5]} 人。`);
  console.log("演示账号：demo_pm / demo_ui / demo_fe / demo_be / demo_data / demo_test / demo_ops，密码均为 123。");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
