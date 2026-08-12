# 测试环境部署说明

本文档用于后端同学将内部需求开发管理系统部署到测试环境，并导入组织、人员、账号和系统配置数据。

## 1. 部署内容

本仓库包含：

- 前端：`apps/web`
- 后端：`apps/api`
- Prisma 数据库模型与迁移：`apps/api/prisma`
- 测试环境基础系统数据：`deploy/system_data.sql`
- 系统数据导入/导出脚本：`scripts/import-system-data.ps1`、`scripts/export-system-data.ps1`

`deploy/system_data.sql` 只包含基础系统数据，不包含项目、需求、任务、缺陷、版本、资料等业务数据。

## 2. 环境要求

- Node.js 20+ 或 22+
- MySQL 8+
- npm
- 可选：PM2，用于后端进程守护
- 可选：Nginx，用于托管前端并转发 `/api`

## 3. 环境变量

测试环境需要配置 `.env`，不要直接使用本机 `.env`。

```env
DATABASE_URL="mysql://user:password@mysql-host:3306/demand_mgmt_test"
JWT_SECRET="replace-with-test-secret"
API_PORT=4000
WEB_PORT=5174
DOCUMENT_UPLOAD_DIR="/data/devms/uploads/project-documents"
```

说明：

- `DATABASE_URL` 指向测试库。
- `JWT_SECRET` 由测试环境自行生成，不要复用本地开发值。
- `DOCUMENT_UPLOAD_DIR` 是项目资料附件目录，需要持久化并允许后端读写。

## 4. 数据库准备

创建测试库和账号，字符集建议使用 `utf8mb4`：

```sql
CREATE DATABASE demand_mgmt_test DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'dms_test'@'%' IDENTIFIED BY 'replace-with-password';
GRANT ALL PRIVILEGES ON demand_mgmt_test.* TO 'dms_test'@'%';
FLUSH PRIVILEGES;
```

## 5. 拉代码并安装依赖

```bash
git clone ssh://git@gitlab.nebulawx.com:222/common/devms.git
cd devms
npm install
```

## 6. 执行数据库结构迁移

```bash
npm run db:generate
npm run db:deploy
```

`db:deploy` 对应 `prisma migrate deploy`，用于测试环境和生产环境。不要在测试环境执行 `npm run db:migrate`，该命令是本地开发迁移。

## 7. 导入基础系统数据

执行结构迁移后，再导入系统数据。注意：迁移脚本会预置部分字典和看板规则，不能直接裸导入 `deploy/system_data.sql`，否则可能产生主键或唯一键冲突。

推荐使用导入脚本。脚本默认会先清理系统基础表，再导入 `deploy/system_data.sql`：

```bash
npm run db:system:import -- -HostName mysql-host -Port 3306 -User user -Database demand_mgmt_test
```

如果后端部署环境不用 PowerShell，可以先执行清理 SQL，再导入基础数据：

```bash
mysql --default-character-set=utf8mb4 -h mysql-host -P 3306 -u user -p demand_mgmt_test < deploy/clear_system_data.sql
mysql --default-character-set=utf8mb4 -h mysql-host -P 3306 -u user -p demand_mgmt_test < deploy/system_data.sql
```

上述方式适用于新建测试库，或确认测试库中的系统基础数据可以被替换的场景。本次迁移不包含项目、需求、任务、缺陷、版本、资料等业务数据。

如果目标环境已经存在需要保留的业务数据，不要直接执行清理和导入，应改用按表、按唯一键的增量合并方案。

系统数据包括：

- `Organization`
- `Position`
- `Person`
- `PersonPosition`
- `Account`
- `Dictionary`
- `RequirementPriority`
- `DefectPriority`
- `BoardRuleConfig`

导入系统数据后不要再执行 `npm run db:seed`。`db:seed` 只用于本地空库快速初始化，和 `deploy/system_data.sql` 不是同一个用途。

## 8. 构建并启动后端

```bash
npm run build:api
npm --workspace apps/api run start
```

PM2 示例：

```bash
pm2 start apps/api/dist/main.js --name devms-api
pm2 save
```

## 9. 构建前端

```bash
npm run build:web
```

构建产物：

```text
apps/web/dist
```

推荐 Nginx 同域部署：

```text
http://test-domain/       -> apps/web/dist
http://test-domain/api/*  -> http://127.0.0.1:4000/api/*
```

## 10. 附件目录

创建并授权附件目录：

```bash
mkdir -p /data/devms/uploads/project-documents
```

确保运行后端的系统用户对该目录有读写权限。

如果后续需要迁移业务数据中的项目资料，除了数据库记录，还必须同步迁移该目录下的实际文件。

## 11. 重新导出系统数据

如果需要从当前环境重新生成 `deploy/system_data.sql`：

```bash
npm run db:system:export -- -HostName localhost -Port 3306 -User dms_app -Database demand_mgmt
```

脚本默认输出：

```text
deploy/system_data.sql
```

脚本会规范化表名大小写，避免 Linux MySQL 因表名大小写敏感导致导入失败。

## 12. 验收检查

部署完成后检查：

- 前端页面可以打开。
- 后端日志显示 `API listening on http://localhost:4000/api`。
- `/api/auth/login` 可以请求到后端。
- MySQL 中已存在组织、岗位、人员、账号和字典数据。
- 可以使用迁移过来的账号登录。
- 上传项目资料后，`DOCUMENT_UPLOAD_DIR` 下能看到文件。

如果前端页面打开但登录报错，优先检查：

- 后端服务是否启动。
- Nginx `/api` 是否转发到后端。
- `DATABASE_URL` 是否连接测试库。
- 测试库是否已经执行 `npm run db:deploy`。
- 基础系统数据是否已经导入。
