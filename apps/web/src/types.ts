export type Person = {
  id: number;
  name: string;
  employeeNo?: string;
  phone?: string;
  email?: string;
  organizationId?: number;
  organization?: Organization;
  employmentStatus?: string;
  primaryPosition?: { code: string; name: string };
  positions?: { isPrimary?: boolean; position: { code: string; name: string } }[];
  createdAt?: string;
  updatedAt?: string;
};

export type Organization = {
  id: number;
  name: string;
  code: string;
  parentId?: number | null;
  managerId?: number | null;
  status: string;
  sort: number;
  createdAt?: string;
  updatedAt?: string;
};

export type Position = {
  id: number;
  code: string;
  name: string;
  category?: string | null;
  description?: string | null;
  isSystem?: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type Account = {
  id: number;
  username: string;
  status: string;
  allowLogin: boolean;
  personId: number;
  person: Person;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AuthState = {
  user: {
    accountId: number;
    personId: number;
    username: string;
    positions: string[];
    primaryPosition?: string | null;
  };
  person?: Person;
};

export type Project = {
  id: number;
  code: string;
  name: string;
  scope: string;
  stage: string;
  owner?: Person;
  ownerId?: number;
  plannedStartDate?: string;
  plannedEndDate?: string;
  expectedLaunchDate?: string;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  background?: string | null;
  goal?: string | null;
  relatedSystems?: string | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: Record<string, number>;
};

export type ProjectDocument = {
  id: number;
  name: string;
  type: string;
  description?: string | null;
  linkUrl?: string | null;
  attachmentUrl?: string | null;
  version?: string | null;
  project?: Project;
  createdBy?: Person;
  requirements?: { requirement: Requirement }[];
  tasks?: { task: DevTask }[];
  createdAt?: string;
  updatedAt?: string;
};

export type Requirement = {
  id: number;
  code: string;
  title: string;
  projectId: number;
  project?: Project;
  type: string;
  status: string;
  launchStatus?: string;
  revisionType?: string;
  priorityLevel: string;
  priorityScore: number;
  timingBonus?: number;
  timingBonusReason?: string | null;
  owner?: Person;
  submitter?: Person;
  expectedLaunchDate?: string;
  description?: string;
  acceptanceCriteria?: string;
  reviewDate?: string;
  reviewConclusion?: string;
  reviewRecord?: string;
  pmAcceptanceConclusion?: string | null;
  pmAcceptedAt?: string | null;
  pmAcceptor?: Person;
  uiAcceptanceConclusion?: string | null;
  uiAcceptedAt?: string | null;
  uiAcceptor?: Person;
  documents?: { document: ProjectDocument }[];
  createdAt?: string;
  updatedAt?: string;
};

export type DevTask = {
  id: number;
  code: string;
  title: string;
  type: string;
  status: string;
  priorityScore: number;
  assigneeId?: number | null;
  plannedStartDate?: string;
  plannedFinishDate?: string;
  actualStartDate?: string;
  actualFinishDate?: string;
  completionNote?: string | null;
  testerId?: number | null;
  project?: Project;
  requirement?: Requirement;
  assignee?: Person;
  tester?: Person;
  creator?: Person;
  defects?: Defect[];
  documents?: { document: ProjectDocument }[];
  createdAt?: string;
  updatedAt?: string;
};

export type Defect = {
  id: number;
  code: string;
  title: string;
  level: string;
  status: string;
  environment: string;
  priorityScore: number;
  assigneeId?: number | null;
  foundAt?: string;
  testerId?: number | null;
  entryPoint?: string | null;
  impactScope?: string | null;
  precondition?: string | null;
  description?: string | null;
  reproduceSteps?: string | null;
  actualResult?: string | null;
  expectedResult?: string | null;
  deviceInfo?: string | null;
  testData?: string | null;
  attachmentUrl?: string | null;
  actualStartDate?: string | null;
  actualFixDate?: string | null;
  timingBonus?: number;
  timingBonusReason?: string | null;
  plannedStartDate?: string;
  plannedFinishDate?: string;
  plannedFixDate?: string;
  project?: Project;
  taskId?: number;
  task?: DevTask;
  requirement?: Requirement;
  assignee?: Person;
  tester?: Person;
  reporter?: Person;
  version?: ReleaseVersion;
  createdAt?: string;
  updatedAt?: string;
};

export type ReleaseVersion = {
  id: number;
  code: string;
  name: string;
  status: string;
  type: string;
  plannedReleaseAt?: string;
  actualReleaseAt?: string | null;
  project?: Project;
  releaseOwner?: Person;
  creator?: Person;
  requirements?: { requirement: Requirement }[];
  defects?: { defect: Defect }[];
  createdAt?: string;
  updatedAt?: string;
};

export type ActivityLog = {
  id: number;
  summary: string;
  entityType: string;
  entityId?: number | null;
  projectId?: number | null;
  requirementId?: number | null;
  taskId?: number | null;
  defectId?: number | null;
  versionId?: number | null;
  action?: string;
  createdAt: string;
  actor?: Person;
  project?: Project | null;
  requirement?: Requirement | null;
  task?: DevTask | null;
  defect?: Defect | null;
  version?: ReleaseVersion | null;
};

export type AdminData = {
  positions: Position[];
  organizations: Organization[];
  people: Person[];
  accounts: Account[];
  dictionaries: Array<{ id: number; type: string; code: string; name: string; description?: string | null; isSystem?: boolean; isActive: boolean; sort?: number }>;
  requirementPriorities: Array<{ id: number; code: string; name: string; description?: string | null; baseScore: number; defectWeight: number; isActive?: boolean; sort?: number }>;
  defectPriorities: Array<{ id: number; code: string; name: string; description?: string | null; onlineScore: number; offlineScore: number; isActive?: boolean; sort?: number }>;
  logs: ActivityLog[];
};
