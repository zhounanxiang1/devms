import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { CoreService } from "../core.service";
import { AuthedRequest } from "../types";
import { toInt } from "../utils";

@Controller("versions")
@UseGuards(AuthGuard)
export class VersionController {
  constructor(private readonly core: CoreService) {}

  @Get()
  list(@Query("projectId") projectId?: string) {
    return this.core.listVersions(toInt(projectId));
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.createVersion(req.user, body);
  }

  @Patch(":id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.updateVersion(req.user, toInt(id)!, body);
  }

  @Post(":id/publish")
  publish(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.publishVersion(req.user, toInt(id)!, body);
  }
}

