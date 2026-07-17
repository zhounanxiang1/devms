import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { CoreService } from "../core.service";
import { AuthedRequest } from "../types";
import { toInt } from "../utils";

@Controller("requirements")
@UseGuards(AuthGuard)
export class RequirementController {
  constructor(private readonly core: CoreService) {}

  @Get()
  list(@Query("projectId") projectId?: string) {
    return this.core.listRequirements(toInt(projectId));
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.createRequirement(req.user, body);
  }

  @Patch(":id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.updateRequirement(req.user, toInt(id)!, body);
  }

  @Post(":id/review")
  review(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.reviewRequirement(req.user, toInt(id)!, body);
  }

  @Post(":id/changes")
  change(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.createRequirementChange(req.user, toInt(id)!, body);
  }

  @Post(":id/revision")
  revision(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.createRequirementRevision(req.user, toInt(id)!, body);
  }
}
