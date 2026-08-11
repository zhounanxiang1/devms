# 测试环境部署说明

本文档用于后端同学部署内部需求开发管理系统到测试环境，并导入基础系统数据。

## 1. 部署内容

本仓库包含：

- 前端：`apps/web`
- 后端：`apps/api`
- Prisma 数据库模型与迁移：`apps/api/prisma`
- 测试环境基础数据：`deploy/system_data.sql`

基础数据只包含系统配置、组织、岗位、人员和账号，不包含项目、需求、任务、缺陷、版本等业务数据。

## 2. 环境要求

- Node.js 20+ 或 22+
- MySQL 8+
- npm
- 可选：Nginx，用于托管前端并转发 `/api`

## 3. 环境变量

测试环境需要配置 `.env`，不要直接使用本机 `.env`。

示例：

```env
DATABASE_URL="mysql://user:password@mysql-host:3306/demand_mgmt_test"
JWT_SECRET="replace-with-test-secret"
API_PORT=4000
WEB_PORT=5174
```

建议后端同学在测试环境内自行生成 `JWT_SECRET`，不要复用本地开发值。

## 4. 后端部署

```bash
npm install
npm run build
npx prisma generate --schema apps/api/prisma/schema.prisma
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm --workspace apps/api run start
```

注意：测试环境请优先使用 `prisma migrate deploy`，不要使用本地开发用的 `prisma migrate dev`。

## 5. 前端部署

```bash
npm --workspace apps/web run build
```

前端构建产物：

```text
apps/web/dist
```

前端请求地址使用相对路径 `/api`，所以推荐测试环境通过 Nginx 做同域部署：

```text
http://test-domain/       -> apps/web/dist
http://test-domain/api/*  -> http://127.0.0.1:4000/api/*
```

## 6. 基础数据导入

先执行数据库迁移，确保表结构已经创建：

```bash
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

再导入基础数据：

```bash
mysql -h mysql-host -P 3306 -u user -p demand_mgmt_test < deploy/system_data.sql
```

`deploy/system_data.sql` 包含以下表的数据：

- `Organization`
- `Position`
- `Person`
- `PersonPosition`
- `Account`
- `Dictionary`
- `RequirementPriority`
- `DefectPriority`
- `BoardRuleConfig`

不包含以下业务数据：

- `Project`
- `ProjectMember`
- `ProjectDocument`
- `Requirement`
- `RequirementSupplement`
- `RequirementChange`
- `DevTask`
- `Defect`
- `ReleaseVersion`
- `VersionRequirement`
- `VersionDefect`
- `RequirementDocument`
- `TaskDocument`
- `VersionDocument`
- `ActivityLog`
- `CodeSequence`

账号表中的密码为哈希值，不是明文密码。导入后账号密码保持导出时的状态。

## 7. 验收检查

部署完成后检查：

```text
前端页面可以打开
/api/auth/login 可以请求到后端
MySQL 中基础表已有数据
可以用迁移过来的账号登录
```

如果前端页面打开但登录报错，优先检查：

- 后端服务是否启动
- Nginx `/api` 是否转发到后端
- `DATABASE_URL` 是否连接测试库
- 测试库是否已经执行 Prisma 迁移和基础数据导入
