import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { CoreService } from "../core.service";
import { AuthedRequest } from "../types";
import { toInt } from "../utils";

@Controller("projects")
@UseGuards(AuthGuard)
export class ProjectController {
  constructor(private readonly core: CoreService) {}

  @Get()
  list() {
    return this.core.listProjects();
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.createProject(req.user, body);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.core.projectDetail(toInt(id)!);
  }

  @Patch(":id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.updateProject(req.user, toInt(id)!, body);
  }

  @Post(":id/close")
  close(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.closeProject(req.user, toInt(id)!, body);
  }

  @Post(":id/start")
  start(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.startProject(req.user, toInt(id)!, body);
  }

  @Post(":id/reopen")
  reopen(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.reopenProject(req.user, toInt(id)!, body);
  }
}
