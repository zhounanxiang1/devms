import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { PRODUCT_MANAGER, requireAnyPosition } from "../authz";
import { CoreService } from "../core.service";
import { AuthedRequest } from "../types";

@Controller("admin")
@UseGuards(AuthGuard)
export class AdminController {
  constructor(private readonly core: CoreService) {}

  @Get("bootstrap")
  bootstrap(@Req() req: AuthedRequest) {
    requireAnyPosition(req.user, [PRODUCT_MANAGER], "只有产品经理可以进入后台管理");
    return this.core.adminBootstrap();
  }

  @Post("people")
  upsertPerson(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.upsertPerson(req.user, body);
  }

  @Post("person-account")
  upsertPersonAccount(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.upsertPersonAccount(req.user, body);
  }

  @Post("organizations")
  upsertOrganization(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.upsertOrganization(req.user, body);
  }

  @Post("positions")
  upsertPosition(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.upsertPosition(req.user, body);
  }

  @Post("accounts")
  upsertAccount(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.upsertAccount(req.user, body);
  }

  @Post("dictionaries")
  upsertDictionary(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.upsertDictionary(req.user, body);
  }

  @Post("requirement-priorities")
  updateRequirementPriority(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.updateRequirementPriority(req.user, body);
  }

  @Post("defect-priorities")
  updateDefectPriority(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.updateDefectPriority(req.user, body);
  }
}
