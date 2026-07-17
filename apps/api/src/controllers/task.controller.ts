import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { CoreService } from "../core.service";
import { AuthedRequest } from "../types";
import { toInt } from "../utils";

@Controller("tasks")
@UseGuards(AuthGuard)
export class TaskController {
  constructor(private readonly core: CoreService) {}

  @Get()
  list(@Query("projectId") projectId?: string) {
    return this.core.listTasks(toInt(projectId));
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.createTask(req.user, body);
  }

  @Patch(":id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.updateTask(req.user, toInt(id)!, body);
  }

  @Post(":id/start")
  start(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.core.startTask(req.user, toInt(id)!);
  }

  @Post(":id/complete")
  complete(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.completeTask(req.user, toInt(id)!, body);
  }

  @Post(":id/test-start")
  testStart(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.core.startTaskTest(req.user, toInt(id)!);
  }

  @Post(":id/test-pass")
  testPass(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.passTaskTest(req.user, toInt(id)!, body);
  }

  @Post(":id/close")
  close(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: any) {
    return this.core.closeTask(req.user, toInt(id)!, body);
  }
}
