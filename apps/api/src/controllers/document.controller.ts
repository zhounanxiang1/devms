import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, renameSync } from "fs";
import path from "path";
import { Response } from "express";
import { AuthGuard } from "../auth.guard";
import { CoreService } from "../core.service";
import { AuthedRequest } from "../types";
import { toInt } from "../utils";

const DOCUMENT_UPLOAD_DIR = path.join(process.cwd(), "uploads", "project-documents");
const DOCUMENT_UPLOAD_LIMIT = 50 * 1024 * 1024;

mkdirSync(DOCUMENT_UPLOAD_DIR, { recursive: true });

type UploadedDocumentFile = {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
};

function buildStoredFileName(originalName: string) {
  const parsed = path.parse(originalName || "attachment");
  const safeBase = parsed.name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "attachment";
  const safeExt = parsed.ext.toLowerCase().replace(/[^.\w]/g, "");
  return `${Date.now()}-${randomUUID()}-${safeBase}${safeExt}`;
}

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

  @Post("upload")
  @UseInterceptors(FileInterceptor("file", { dest: DOCUMENT_UPLOAD_DIR, limits: { fileSize: DOCUMENT_UPLOAD_LIMIT } }))
  upload(@UploadedFile() file?: UploadedDocumentFile) {
    if (!file) {
      throw new BadRequestException("请选择要上传的附件。");
    }
    const storedFileName = buildStoredFileName(file.originalname);
    renameSync(file.path, path.join(DOCUMENT_UPLOAD_DIR, storedFileName));
    return {
      url: `/api/documents/files/${encodeURIComponent(storedFileName)}`,
      fileName: file.originalname,
      size: file.size,
      mimeType: file.mimetype
    };
  }

  @Get("files/:fileName")
  download(@Param("fileName") fileName: string, @Res() res: Response) {
    const safeFileName = path.basename(fileName);
    if (safeFileName !== fileName) {
      throw new NotFoundException("附件不存在。");
    }
    const filePath = path.join(DOCUMENT_UPLOAD_DIR, safeFileName);
    if (!existsSync(filePath)) {
      throw new NotFoundException("附件不存在。");
    }
    return res.sendFile(safeFileName, { root: DOCUMENT_UPLOAD_DIR });
  }
}
