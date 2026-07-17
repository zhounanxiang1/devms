import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const dictionaries = [
  ["PROJECT_STAGE", "INITIATED", "已立项", 1],
  ["PROJECT_STAGE", "RESEARCHING", "需求调研", 2],
  ["PROJECT_STAGE", "SOLUTION_DESIGN", "方案设计", 3],
  ["PROJECT_STAGE", "DEV_TEST", "系统开发与测试", 4],
  ["PROJECT_STAGE", "ONLINE_OPS", "上线运维", 5],
  ["PROJECT_STAGE", "CLOSED", "已结项", 6],
  ["REQUIREMENT_STATUS", "TO_REVIEW", "待评审", 1],
  ["REQUIREMENT_STATUS", "APPROVED", "评审通过", 2],
  ["REQUIREMENT_STATUS", "REJECTED", "评审不通过", 3],
  ["REQUIREMENT_STATUS", "NEEDS_SUPPLEMENT", "待补充", 4],
  ["REQUIREMENT_STATUS", "DEFERRED", "暂缓", 5],
  ["REQUIREMENT_STATUS", "DEVELOPING", "开发中", 6],
  ["REQUIREMENT_STATUS", "COMPLETED", "已完成", 7],
  ["REQUIREMENT_STATUS", "CANCELED", "已取消", 8],
  ["REQUIREMENT_STATUS", "CHANGE", "需求变更", 9],
  ["REQUIREMENT_STATUS", "OPTIMIZATION", "需求优化", 10],
  ["REQUIREMENT_LAUNCH_STATUS", "TO_RELEASE", "待上线", 1],
  ["REQUIREMENT_LAUNCH_STATUS", "RELEASED", "已上线", 2],
  ["TASK_STATUS", "TODO", "待处理", 1],
  ["TASK_STATUS", "DOING", "处理中", 2],
  ["TASK_STATUS", "TO_TEST", "待测试", 3],
  ["TASK_STATUS", "TESTING", "测试中", 4],
  ["TASK_STATUS", "TEST_PASSED", "测试通过", 5],
  ["TASK_STATUS", "CLOSED", "已关闭", 6],
  ["DEFECT_STATUS", "TO_FIX", "待修复", 1],
  ["DEFECT_STATUS", "FIXING", "修复中", 2],
  ["DEFECT_STATUS", "FIXED", "已修复", 3],
  ["DEFECT_STATUS", "VERIFIED", "已验证", 4],
  ["DEFECT_STATUS", "CLOSED", "已关闭", 5],
  ["VERSION_STATUS", "PLANNING", "规划中", 1],
  ["VERSION_STATUS", "READY_TO_RELEASE", "待发布", 4],
  ["VERSION_STATUS", "RELEASED", "已发布", 5],
  ["VERSION_TYPE", "NORMAL", "常规版本", 1],
  ["VERSION_TYPE", "HOTFIX", "紧急修复", 2],
  ["REQUIREMENT_TYPE", "FEATURE", "功能需求", 1],
  ["REQUIREMENT_TYPE", "PROCESS", "流程需求", 2],
  ["REQUIREMENT_TYPE", "DATA", "数据需求", 3],
  ["REQUIREMENT_TYPE", "REPORT", "报表需求", 4],
  ["REQUIREMENT_TYPE", "UX", "体验优化", 5],
  ["TASK_TYPE", "UI", "UI设计", 1],
  ["TASK_TYPE", "FRONTEND", "前端开发", 2],
  ["TASK_TYPE", "BACKEND", "后端开发", 3],
  ["TASK_TYPE", "DATA", "数据开发", 4],
  ["TASK_TYPE", "TEST", "测试验证", 5],
  ["DOCUMENT_TYPE", "BUSINESS", "业务资料", 1],
  ["DOCUMENT_TYPE", "TECH", "技术资料", 2],
  ["DOCUMENT_TYPE", "TEST", "测试资料", 3],
  ["DOCUMENT_TYPE", "RELEASE", "上线资料", 4]
] as const;

const requirementPriorities = [
  ["P0", "P0 基本需求", "线上止损、资损、合规整改、重大限时核心活动", 40, 1.2, 1],
  ["P1", "P1 期望需求", "迭代主线、核心业务流程、团队 OKR 重点功能", 30, 1.15, 2],
  ["P2", "P2 兴奋需求", "次要功能迭代、普通用户体验优化", 20, 1.1, 3],
  ["P3", "P3 无差异需求", "后台小优化、边缘冷门功能、非刚需体验", 10, 1.03, 4],
  ["P4", "P4 长期规划", "调研规划、长期储备、可无限延后或无归属", 0, 1, 5]
] as const;

const defectPriorities = [
  ["L1", "1级 致命", "系统崩溃、核心流程完全不可用、资损、高危安全漏洞、大面积用户故障", 60, 40, 1],
  ["L2", "2级 严重", "核心流程局部报错、高频操作异常、少量资损、关键数据错乱", 45, 30, 2],
  ["L3", "3级 一般", "功能可正常使用，次要流程偶发异常，无直接业务损失", 25, 15, 3],
  ["L4", "4级 轻微", "UI样式、文案、图标、交互细节瑕疵，无任何业务影响", 10, 5, 4]
] as const;

async function main() {
  const org = await prisma.organization.upsert({
    where: { code: "ROOT" },
    update: {},
    create: { code: "ROOT", name: "默认组织", sort: 1 }
  });

  const positions = [
    ["PRODUCT_MANAGER", "产品经理"],
    ["UI", "UI"],
    ["FRONTEND", "前端"],
    ["BACKEND", "后端"],
    ["DATA", "数据"],
    ["TEST", "测试"],
    ["OPS", "运维"],
    ["BUSINESS", "业务"]
  ] as const;

  for (const [code, name] of positions) {
    await prisma.position.upsert({
      where: { code },
      update: { name, isSystem: true, isActive: true },
      create: { code, name, isSystem: true, isActive: true }
    });
  }

  await prisma.dictionary.deleteMany({
    where: {
      OR: [
        { type: "REQUIREMENT_STATUS", code: { in: ["TESTING", "READY_TO_RELEASE", "RELEASED"] } },
        { type: "TASK_STATUS", code: { in: ["DONE", "BLOCKED", "CANCELED"] } },
        { type: "DEFECT_STATUS", code: { in: ["TO_ASSIGN", "DOING", "TO_VERIFY", "REOPENED", "REJECTED", "DEFERRED"] } }
      ]
    }
  });

  for (const [type, code, name, sort] of dictionaries) {
    await prisma.dictionary.upsert({
      where: { type_code: { type, code } },
      update: { name, sort, isSystem: true, isActive: true },
      create: { type, code, name, sort, isSystem: true, isActive: true }
    });
  }

  for (const [code, name, description, baseScore, defectWeight, sort] of requirementPriorities) {
    await prisma.requirementPriority.upsert({
      where: { code },
      update: { name, description, baseScore, defectWeight, sort, isActive: true },
      create: { code, name, description, baseScore, defectWeight, sort, isActive: true }
    });
  }

  for (const [code, name, description, onlineScore, offlineScore, sort] of defectPriorities) {
    await prisma.defectPriority.upsert({
      where: { code },
      update: { name, description, onlineScore, offlineScore, sort, isActive: true },
      create: { code, name, description, onlineScore, offlineScore, sort, isActive: true }
    });
  }

  const productPosition = await prisma.position.findUniqueOrThrow({
    where: { code: "PRODUCT_MANAGER" }
  });

  const person = await prisma.person.upsert({
    where: { employeeNo: "PM001" },
    update: {
      name: "初始产品经理",
      organizationId: org.id,
      primaryPositionId: productPosition.id,
      employmentStatus: "ACTIVE"
    },
    create: {
      name: "初始产品经理",
      employeeNo: "PM001",
      email: "pm_admin@example.local",
      organizationId: org.id,
      primaryPositionId: productPosition.id,
      employmentStatus: "ACTIVE"
    }
  });

  await prisma.personPosition.upsert({
    where: { personId_positionId: { personId: person.id, positionId: productPosition.id } },
    update: { isPrimary: true },
    create: { personId: person.id, positionId: productPosition.id, isPrimary: true }
  });

  const passwordHash = await bcrypt.hash("123", 10);
  await prisma.account.upsert({
    where: { username: "pm_admin" },
    update: {
      personId: person.id,
      status: "ACTIVE",
      allowLogin: true,
      passwordHash
    },
    create: {
      username: "pm_admin",
      passwordHash,
      personId: person.id,
      status: "ACTIVE",
      allowLogin: true,
      initialPassword: true
    }
  });
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
