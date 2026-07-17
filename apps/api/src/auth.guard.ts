import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import { AuthUser } from "./types";

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) {
      throw new UnauthorizedException("请先登录");
    }
    try {
      request.user = jwt.verify(token, process.env.JWT_SECRET || "local-dev-secret") as AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
  }
}

