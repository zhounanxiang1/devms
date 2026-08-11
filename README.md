# 内部需求开发管理系统

内部需求开发管理系统用于管理项目、需求、开发任务、缺陷、版本、资料、组织人员和后台配置。系统是企业内部中后台应用，前端使用 React + TypeScript + Vite + Ant Design，后端使用 Node.js + NestJS + Prisma + MySQL。

## 目录结构

```text
apps/web                 前端应用
apps/api                 后端服务
apps/api/prisma          Prisma schema、迁移和初始化脚本
packages/shared          前后端共享类型
deploy/system_data.sql   测试环境基础系统数据
scripts                  本地辅助脚本
```

## 环境要求

- Node.js 20+ 或 22+
- npm
- MySQL 8+
- 可选：Nginx，用于托管前端并反向代理 `/api`
- 可选：PM2，用于后端进程守护

## 环境变量

复制环境变量样例后修改数据库连接和密钥：

```bash
copy .env.example .env
copy apps\api\.env.example apps\api\.env
```

Linux/macOS：

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

关键配置：

```env
DATABASE_URL="mysql://user:password@mysql-host:3306/demand_mgmt_test"
JWT_SECRET="replace-with-test-secret"
API_PORT=4000
WEB_PORT=5174
DOCUMENT_UPLOAD_DIR="/data/devms/uploads/project-documents"
```

`DOCUMENT_UPLOAD_DIR` 是项目资料附件目录，测试环境建议配置为持久化目录，并保证后端进程有读写权限。

## 本地启动

```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

默认地址：

```text
前端：http://localhost:5174
后端：http://localhost:4000/api
```

默认初始化账号由 `db:seed` 创建：

```text
账号：pm_admin
密码：123
岗位：产品经理
```

## 测试环境后端部署

后端同学从远程仓库拉代码后，按以下顺序操作。

```bash
git clone https://github.com/zhounanxiang1/devms.git
cd devms
npm install
npm run db:generate
npm run db:deploy
```

`db:deploy` 使用的是 `prisma migrate deploy`，适合测试环境和后续部署；不要在测试环境使用 `npm run db:migrate`，那是本地开发用的 `prisma migrate dev`。

数据库结构迁移完成后，导入基础系统数据：

```bash
mysql --default-character-set=utf8mb4 -h mysql-host -P 3306 -u user -p demand_mgmt_test < deploy/system_data.sql
```

Windows 环境也可以使用仓库脚本：

```bash
npm run db:system:import -- -HostName mysql-host -Port 3306 -User user -Database demand_mgmt_test
```

基础系统数据包括：

- 组织：`Organization`
- 岗位：`Position`
- 人员：`Person`
- 人员岗位关系：`PersonPosition`
- 登录账号：`Account`
- 字典配置：`Dictionary`
- 需求优先级配置：`RequirementPriority`
- 缺陷优先级配置：`DefectPriority`
- 看板规则配置：`BoardRuleConfig`
- 编号流水：`CodeSequence`

注意：如果使用 `deploy/system_data.sql` 导入当前系统数据，就不要再执行 `npm run db:seed`，避免重复初始化默认账号和配置。`db:seed` 只用于空库本地快速初始化。

构建并启动后端：

```bash
npm run build:api
npm --workspace apps/api run start
```

PM2 示例：

```bash
pm2 start apps/api/dist/main.js --name devms-api
pm2 save
```

## 前端构建部署

```bash
npm run build:web
```

前端构建产物位于：

```text
apps/web/dist
```

推荐测试环境通过 Nginx 做同域部署：

```text
http://test-domain/       -> apps/web/dist
http://test-domain/api/*  -> http://127.0.0.1:4000/api/*
```

## 系统数据导出

如果需要从当前环境重新导出组织、人员、账号和系统配置数据：

```bash
npm run db:system:export -- -HostName localhost -Port 3306 -User dms_app -Database demand_mgmt
```

默认输出到：

```text
deploy/system_data.sql
```

导出脚本会将表名规范成 Prisma 迁移使用的大小写，避免 Linux MySQL 测试环境因为大小写敏感导致导入失败。

## 附件迁移

数据库只记录附件访问路径，真实文件在 `DOCUMENT_UPLOAD_DIR` 目录下。迁移项目资料时，需要同时迁移附件目录，例如：

```text
/data/devms/uploads/project-documents
```

如果只导入系统基础数据、不迁移项目和项目资料，则附件目录可以为空，但目录必须存在且后端进程可写。

## 常用脚本

```bash
npm run dev             # 本地同时启动前后端
npm run dev:web         # 本地启动前端
npm run dev:api         # 本地启动后端
npm run build           # 构建 shared、api、web
npm run build:api       # 构建后端
npm run build:web       # 构建前端
npm run db:generate     # 生成 Prisma Client
npm run db:migrate      # 本地开发迁移
npm run db:deploy       # 测试/生产环境迁移
npm run db:seed         # 本地空库初始化
npm run db:system:export
npm run db:system:import
```

## 部署检查

部署完成后检查：

- 后端日志显示 `API listening on http://localhost:4000/api`
- `/api/auth/login` 可以访问
- 测试库中已有组织、岗位、人员、账号和字典配置
- 可以使用迁移过来的账号登录
- 项目资料上传后，`DOCUMENT_UPLOAD_DIR` 下能看到文件

如果登录失败，优先检查 `DATABASE_URL`、`JWT_SECRET`、数据库是否执行了 `db:deploy`、系统数据是否已导入、Nginx `/api` 是否正确转发。
