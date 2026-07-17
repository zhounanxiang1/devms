import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { CoreService } from "../core.service";
import { AuthedRequest } from "../types";

@Controller("workbench")
@UseGuards(AuthGuard)
export class WorkbenchController {
  constructor(private readonly core: CoreService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.core.workbench(req.user);
  }
}

