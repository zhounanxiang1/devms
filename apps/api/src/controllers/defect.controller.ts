import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { CoreService } from "../core.service";
import { AuthedRequest } from "../types";
import { toInt } from "../utils";

@Controller("defects")
@UseGuards(AuthGuard)
export class DefectController {
  constructor(private readonly core: CoreService) {}

  @Get()
  list(@Query("projectId") projectId?: string) {
    return this.core.listDefects(toInt(projectId));
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.createDefect(req.user, body);
  }

  @Patch(":id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.updateDefect(req.user, toInt(id)!, body);
  }

  @Post(":id/start-fix")
  startFix(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.core.startDefectFix(req.user, toInt(id)!);
  }

  @Post(":id/fix-complete")
  fixComplete(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.completeDefectFix(req.user, toInt(id)!, body);
  }

  @Post(":id/verify")
  verify(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.verifyDefect(req.user, toInt(id)!, body);
  }

  @Post(":id/reject")
  reject(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.rejectDefect(req.user, toInt(id)!, body);
  }

  @Post(":id/close")
  close(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.closeDefect(req.user, toInt(id)!, body);
  }

  @Post(":id/reopen")
  reopen(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.reopenDefect(req.user, toInt(id)!, body);
  }
}
