import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { PrismaService } from "./prisma.service";
import { AuthGuard } from "./auth.guard";
import { AuthedRequest } from "./types";

@Controller("auth")
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("login")
  async login(@Body() body: any) {
    const account = await this.prisma.account.findUnique({
      where: { username: body.username },
      include: {
        person: {
          include: {
            primaryPosition: true,
            positions: { include: { position: true } }
          }
        }
      }
    });
    if (!account || !account.allowLogin || account.status !== "ACTIVE") {
      throw new UnauthorizedException("账号不可用");
    }
    const ok = await bcrypt.compare(body.password || "", account.passwordHash);
    if (!ok) {
      await this.prisma.account.update({
        where: { id: account.id },
        data: { failedLoginCount: { increment: 1 } }
      });
      throw new UnauthorizedException("账号或密码错误");
    }
    const positions = [
      account.person.primaryPosition?.code,
      ...account.person.positions.map((item) => item.position.code)
    ].filter(Boolean) as string[];
    const user = {
      accountId: account.id,
      personId: account.personId,
      username: account.username,
      positions: Array.from(new Set(positions)),
      primaryPosition: account.person.primaryPosition?.code || null
    };
    const token = jwt.sign(user, process.env.JWT_SECRET || "local-dev-secret", {
      expiresIn: body.rememberMe ? "30d" : "12h"
    });
    await this.prisma.account.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0 }
    });
    return { token, user, person: account.person };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  async me(@Req() req: AuthedRequest) {
    const account = await this.prisma.account.findUnique({
      where: { id: req.user.accountId },
      include: {
        person: {
          include: {
            primaryPosition: true,
            positions: { include: { position: true } }
          }
        }
      }
    });
    return { user: req.user, account };
  }
}
