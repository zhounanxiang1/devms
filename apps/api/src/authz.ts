import { ForbiddenException } from "@nestjs/common";
import { AuthUser } from "./types";

export const PRODUCT_MANAGER = "PRODUCT_MANAGER";
export const TEST = "TEST";

export function hasAnyPosition(user: AuthUser, codes: string[]) {
  return codes.some((code) => user.positions.includes(code));
}

export function requireAnyPosition(user: AuthUser, codes: string[], message = "当前岗位无权执行该操作") {
  if (!hasAnyPosition(user, codes)) {
    throw new ForbiddenException(message);
  }
}

