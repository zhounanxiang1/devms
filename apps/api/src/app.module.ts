import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "./prisma.service";
import { AuthGuard } from "./auth.guard";
import { AuthController } from "./auth.controller";
import { AdminController } from "./controllers/admin.controller";
import { WorkbenchController } from "./controllers/workbench.controller";
import { ProjectController } from "./controllers/project.controller";
import { RequirementController } from "./controllers/requirement.controller";
import { TaskController } from "./controllers/task.controller";
import { DefectController } from "./controllers/defect.controller";
import { VersionController } from "./controllers/version.controller";
import { DocumentController } from "./controllers/document.controller";
import { CoreService } from "./core.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"]
    })
  ],
  controllers: [
    AuthController,
    AdminController,
    WorkbenchController,
    ProjectController,
    RequirementController,
    TaskController,
    DefectController,
    VersionController,
    DocumentController
  ],
  providers: [PrismaService, AuthGuard, CoreService]
})
export class AppModule {}

