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
};

export type Organization = {
  id: number;
  name: string;
  code: string;
  parentId?: number | null;
  managerId?: number | null;
  status: string;
  sort: number;
};

export type Position = {
  id: number;
  code: string;
  name: string;
  category?: string | null;
  description?: string | null;
  isSystem?: boolean;
  isActive: boolean;
};

export type Account = {
  id: number;
  username: string;
  status: string;
  allowLogin: boolean;
  personId: number;
  person: Person;
  note?: string | null;
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
  background?: string | null;
  goal?: string | null;
  relatedSystems?: string | null;
  _count?: Record<string, number>;
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
  owner?: Person;
  expectedLaunchDate?: string;
  description?: string;
  reviewDate?: string;
  reviewConclusion?: string;
  reviewRecord?: string;
};

export type DevTask = {
  id: number;
  code: string;
  title: string;
  type: string;
  status: string;
  priorityScore: number;
  plannedStartDate?: string;
  plannedFinishDate?: string;
  project?: Project;
  requirement?: Requirement;
  assignee?: Person;
  defects?: Defect[];
};

export type Defect = {
  id: number;
  code: string;
  title: string;
  level: string;
  status: string;
  environment: string;
  priorityScore: number;
  plannedFixDate?: string;
  project?: Project;
  taskId?: number;
  task?: DevTask;
  requirement?: Requirement;
  assignee?: Person;
};

export type ReleaseVersion = {
  id: number;
  code: string;
  name: string;
  status: string;
  type: string;
  plannedReleaseAt?: string;
  project?: Project;
  requirements?: { requirement: Requirement }[];
  defects?: { defect: Defect }[];
};

export type AdminData = {
  positions: Position[];
  organizations: Organization[];
  people: Person[];
  accounts: Account[];
  dictionaries: Array<{ id: number; type: string; code: string; name: string; description?: string | null; isSystem?: boolean; isActive: boolean; sort?: number }>;
  requirementPriorities: Array<{ id: number; code: string; name: string; description?: string | null; baseScore: number; defectWeight: number; isActive?: boolean; sort?: number }>;
  defectPriorities: Array<{ id: number; code: string; name: string; description?: string | null; onlineScore: number; offlineScore: number; isActive?: boolean; sort?: number }>;
  logs: Array<{ id: number; summary: string; createdAt: string; actor?: Person }>;
};
