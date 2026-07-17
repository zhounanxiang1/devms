export const SYSTEM_CODES = {
  positions: {
    productManager: "PRODUCT_MANAGER",
    ui: "UI",
    frontend: "FRONTEND",
    backend: "BACKEND",
    data: "DATA",
    test: "TEST",
    ops: "OPS",
    business: "BUSINESS"
  },
  requirementStatus: {
    toReview: "TO_REVIEW",
    approved: "APPROVED",
    rejected: "REJECTED",
    needsSupplement: "NEEDS_SUPPLEMENT",
    deferred: "DEFERRED",
    developing: "DEVELOPING",
    testing: "TESTING",
    readyToRelease: "READY_TO_RELEASE",
    released: "RELEASED",
    completed: "COMPLETED",
    canceled: "CANCELED"
  },
  taskStatus: {
    todo: "TODO",
    doing: "DOING",
    done: "DONE",
    blocked: "BLOCKED",
    canceled: "CANCELED"
  },
  defectStatus: {
    toAssign: "TO_ASSIGN",
    doing: "DOING",
    toVerify: "TO_VERIFY",
    closed: "CLOSED",
    rejected: "REJECTED",
    deferred: "DEFERRED",
    reopened: "REOPENED"
  },
  versionStatus: {
    planning: "PLANNING",
    developing: "DEVELOPING",
    testing: "TESTING",
    readyToRelease: "READY_TO_RELEASE",
    released: "RELEASED",
    rolledBack: "ROLLED_BACK",
    canceled: "CANCELED"
  }
} as const;

export type DictOption = {
  code: string;
  name: string;
  color?: string;
  sort?: number;
};

