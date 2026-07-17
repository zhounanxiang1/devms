export const statusLabels: Record<string, string> = {
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

export const positionLabels: Record<string, string> = {
  PRODUCT_MANAGER: "产品经理",
  UI: "UI",
  FRONTEND: "前端",
  BACKEND: "后端",
  DATA: "数据",
  TEST: "测试",
  OPS: "运维",
  BUSINESS: "业务"
};

export const projectStageLabels: Record<string, string> = {
  INITIATED: "已立项",
  RESEARCHING: "需求调研",
  SOLUTION_DESIGN: "方案设计",
  DEV_TEST: "系统开发与测试",
  ONLINE_OPS: "上线运维",
  CLOSED: "已结项"
};

export const dictionaryTypeMeta: Record<string, { name: string; usage: string }> = {
  PROJECT_STAGE: {
    name: "项目阶段",
    usage: "用于项目中心的阶段展示和编辑；新建项目默认已立项，不在新建表单中手动选择，项目创建后可在编辑项目时维护。"
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
