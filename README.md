# 内部需求开发管理系统

内部需求开发管理系统第一版工程，包含：

- React + TypeScript 前端
- Node.js + NestJS 后端
- Prisma + MySQL 数据模型
- 账号密码登录
- 工作台、项目中心、执行中心、发布中心、后台管理

默认初始产品经理账号由数据库种子创建：

- 登录账号：`pm_admin`
- 初始密码：`123`

启动前需要配置 MySQL 连接信息，参考 `.env.example`。

## 本地启动

1. 安装依赖：

```bash
npm install
```

2. 复制环境变量：

```bash
copy .env.example .env
copy apps\api\.env.example apps\api\.env
```

3. 修改 `.env` 和 `apps/api/.env` 中的 `DATABASE_URL`。

4. 初始化数据库：

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

5. 启动系统：

```bash
npm run dev
```

前端默认地址：`http://localhost:5174`  
后端默认地址：`http://localhost:4000/api`

## 关键业务规则

- 登录后默认进入个人工作台。
- 工作台聚合需求开发任务和缺陷修复任务。
- 后台管理入口仅产品经理岗位可进入。
- 缺陷验证、需求测试通过、版本发布按岗位做按钮控制。
- 版本发布会拦截非待上线需求和未关闭缺陷。
- 需求、任务、缺陷、版本关键状态变更均记录处理日志。
