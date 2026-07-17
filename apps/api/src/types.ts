import { Request } from "express";

export type AuthUser = {
  accountId: number;
  personId: number;
  username: string;
  positions: string[];
  primaryPosition?: string | null;
};

export type AuthedRequest = Request & {
  user: AuthUser;
};

