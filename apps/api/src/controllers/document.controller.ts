import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { CoreService } from "../core.service";
import { AuthedRequest } from "../types";
import { toInt } from "../utils";

@Controller("documents")
@UseGuards(AuthGuard)
export class DocumentController {
  constructor(private readonly core: CoreService) {}

  @Get()
  list(@Query("projectId") projectId?: string) {
    return this.core.listDocuments(toInt(projectId));
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: any) {
    return this.core.createDocument(req.user, body);
  }
}

