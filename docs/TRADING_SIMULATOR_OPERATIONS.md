# 历史交易模拟器维护与部署手册

本文面向维护者，说明历史交易练习模拟器的代码边界、本机维护、生产部署、升级、备份和故障处理。设计背景见 [TRADING_SIMULATOR_DESIGN.md](./TRADING_SIMULATOR_DESIGN.md)，任务边界见 [TRADING_SIMULATOR_IMPLEMENTATION.md](./TRADING_SIMULATOR_IMPLEMENTATION.md)。

## 1. 当前运行边界

模拟器是单机、单进程、无认证的 MVP，适合个人练习或可信内网使用，不应直接暴露到公网。

- API：Fastify，默认监听 `127.0.0.1:3001`。
- Web：React + Vite；开发端口为 `5173`，生产环境构建为静态文件。
- 状态库：`var/simulator/simulator.db`，与现有股票数据库隔离。
- 审计导出：`var/simulator/exports/<sessionId>.json`。
- 行情输入：只读复用 `data/universe/`、`data/pool/`、`data/kline/daily/` 和 `data/kline/yearly/`。
- 当前数据模式：`legacy_approximate`，使用已有前复权价格和近似市场规则。

重要限制：活动会话对象和匿名映射当前保存在 API 进程内存中。SQLite 会保存核心记录，但服务重启后尚未实现活动会话的完整运行时重建。因此升级前应结束或导出活动会话；不要把“数据库文件存在”等同于“活动会话可无缝续跑”。精确历史数据和完整恢复能力属于后续维护项。

## 2. 代码与责任边界

```text
web/simulator/                         React 页面、组件、图表和 API 客户端
src/simulator/adapters/http/           Fastify 路由、错误映射、匿名 DTO
src/simulator/application/             会话编排、订单、报告、运行时服务
src/simulator/core/                    会话、时钟、账户、持仓、订单领域对象
src/simulator/mechanisms/              费用、滑点、撮合和 A 股限制机制
src/simulator/selection/               候选流水线、别名和白名单 DTO
src/simulator/adapters/ledger/         现有 Universe/K 线只读适配器
src/simulator/adapters/sqlite/         迁移和仓储
src/signals/                           默认候选信号与 BOLL
tests/simulator-*.test.js              服务端单元、集成和匿名审计测试
tests/e2e/                              浏览器业务与响应式验收
```

维护时遵循以下依赖方向：

```text
HTTP / SQLite / Ledger adapters
             ↓
       Application
             ↓
     Core + Mechanisms
```

核心领域层不得反向依赖 HTTP、SQLite 或行情文件。候选策略只负责产生证据，匿名 DTO 负责对外字段，二者不要混在同一模块中。

## 3. 环境要求

- Linux 或 macOS。
- Node.js 22 及兼容 npm。
- Git。
- `better-sqlite3` 安装所需的预编译包，或本机 C/C++ 构建工具链。
- 运行 E2E 时需要 Chromium；应用生产运行不需要浏览器。
- 推荐使用 Nginx、Caddy 或其他反向代理提供静态文件和 TLS。

初始化：

```bash
git clone <repository-url> /opt/x
cd /opt/x
npm ci
bin/x doctor
npm run check
```

生产安装应优先使用锁文件和 `npm ci`，避免无意升级依赖。

## 4. 数据准备与预检

部署前先确认目标历史区间存在 Universe 和交易日：

```bash
bin/x simulator check \
  --start-date 20260701 \
  --end-date 20260731 \
  --json
```

重点检查：

- `universeCount` 大于 0。
- `tradingDateCount` 至少为 2。
- `universeSource` 是否符合预期。
- `qualityIssues` 是否仅包含已知近似项。

进一步校验 K 线文件：

```bash
bin/x kline validate data/kline --period daily --json
bin/x kline validate data/kline --period yearly --json
```

模拟器读取行情时会执行 `date <= asOfDate` 截断。不要手工修改 `data/kline/` 下的生成文件；缺数应使用仓库既有抓取流程补齐，并将代码变更和大批量生成数据分开提交。

## 5. 开发环境启动

同时启动 API 和 Vite：

```bash
bin/x simulator start
```

等价命令：

```bash
npm run dev:simulator
```

访问 `http://127.0.0.1:5173`。Vite 将 `/api` 转发到 `http://127.0.0.1:3001`。

也可以分别启动：

```bash
SIMULATOR_HOST=127.0.0.1 SIMULATOR_PORT=3001 npm run start:simulator
npm run dev --workspace web/simulator
```

健康检查：

```bash
curl --fail http://127.0.0.1:3001/health
# {"ok":true}
```

## 6. 生产构建

```bash
cd /opt/x
npm ci
npm run check
npm test
npm run test:web
npm run build:web
```

构建输出位于 `web/simulator/dist/`。该目录是部署产物，不是业务源代码；生产节点可直接由 Nginx 提供。

API 进程启动命令：

```bash
SIMULATOR_HOST=127.0.0.1 \
SIMULATOR_PORT=3001 \
NODE_ENV=production \
npm run start:simulator
```

当前有效环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SIMULATOR_HOST` | `127.0.0.1` | Fastify 监听地址 |
| `SIMULATOR_PORT` | `3001` | Fastify 监听端口 |
| `SIMULATOR_SLOW_REQUEST_MS` | `300` | 慢接口告警阈值（毫秒）；所有接口仍记录总耗时 |
| `NODE_ENV` | 未设置 | 生产环境建议设为 `production` |

数据库和导出目录目前按仓库工作目录解析，因此 systemd 的 `WorkingDirectory` 必须指向仓库根目录。

## 7. systemd 示例

创建专用用户并赋予最小权限：

```bash
sudo useradd --system --home /opt/x --shell /usr/sbin/nologin x-simulator
sudo mkdir -p /opt/x/var/simulator/exports
sudo chown -R x-simulator:x-simulator /opt/x/var
```

行情和应用代码只需读取权限；`var/simulator/` 需要写权限。

`/etc/systemd/system/x-simulator.service`：

```ini
[Unit]
Description=X Historical Trading Simulator API
After=network.target

[Service]
Type=simple
User=x-simulator
Group=x-simulator
WorkingDirectory=/opt/x
Environment=NODE_ENV=production
Environment=SIMULATOR_HOST=127.0.0.1
Environment=SIMULATOR_PORT=3001
ExecStart=/usr/bin/npm run start:simulator
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now x-simulator
sudo systemctl status x-simulator
journalctl -u x-simulator -f
```

确认 `/usr/bin/npm` 与服务器实际路径一致；使用 nvm 时，systemd 不会自动加载交互式 shell，应改为 Node/npm 的绝对路径。

## 8. Nginx 示例

以下配置让 Web 与 API 保持同源，避免额外开启 CORS：

```nginx
server {
    listen 80;
    server_name simulator.example.internal;

    root /opt/x/web/simulator/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 120s;
    }

    location = /health {
        proxy_pass http://127.0.0.1:3001/health;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

生产环境应在外层增加 TLS 和访问控制。由于当前没有用户认证，推荐仅允许 VPN、Cloudflare Access、内网 IP 白名单或本机访问。不要仅依赖候选匿名化作为访问控制。

## 9. SQLite 迁移、备份与恢复

服务启动时自动运行 `src/simulator/adapters/sqlite/migrations/` 下尚未应用的递增迁移，并在 `schema_migrations` 记录版本。

新增迁移规则：

1. 新建下一个递增编号文件，不修改已经发布的迁移。
2. 迁移必须能在空库和上一个版本的库上执行。
3. 为唯一约束、状态枚举和常用查询补测试。
4. 先备份生产数据库，再部署代码。

在线备份优先使用 SQLite CLI 的一致性备份：

```bash
mkdir -p /var/backups/x-simulator
sqlite3 /opt/x/var/simulator/simulator.db \
  ".backup '/var/backups/x-simulator/simulator-$(date +%Y%m%d-%H%M%S).db'"
```

如果没有 SQLite CLI，应先停止 API，再复制数据库及导出目录：

```bash
sudo systemctl stop x-simulator
cp /opt/x/var/simulator/simulator.db /var/backups/x-simulator/simulator.db
cp -a /opt/x/var/simulator/exports /var/backups/x-simulator/
sudo systemctl start x-simulator
```

恢复步骤：

1. 停止 API。
2. 备份当前故障库。
3. 将目标备份复制回 `var/simulator/simulator.db`。
4. 校验文件属主和权限。
5. 启动 API，让代码执行必要的后续迁移。
6. 检查 `/health`、启动日志和 `schema_migrations`。

因为活动会话尚不能在重启后完整恢复，恢复数据库主要用于保留持久化记录和审计；部署窗口前仍应完成或导出正在练习的会话。

## 10. 发布与回滚流程

推荐发布顺序：

```bash
git fetch --all --prune
git checkout <release-commit>
npm ci
bin/x simulator check --start-date 20260701 --end-date 20260731 --json
npm run check
npm test
npm run test:web
npm run build:web
npm run test:e2e
```

然后：

1. 通知使用者结束或导出活动会话。
2. 备份 SQLite 和导出目录。
3. 重启 API。
4. 原子切换静态目录或部署新的 `dist/`。
5. 检查 `/health`，创建一个短测试会话并确认候选、图表、订单和推进。
6. 观察日志和错误率。

代码回滚：切回上一个已验证提交，重新执行 `npm ci` 和 `npm run build:web`，再重启服务。数据库回滚不能只靠切换代码；如果新版本执行了不向后兼容的迁移，应停止服务并恢复部署前备份。

## 11. 日常维护检查表

每日或每次数据更新后：

- `/health` 返回 200。
- `bin/x simulator check` 的 Universe 和交易日数量合理。
- `bin/x kline validate` 未出现新增损坏文件。
- `var/simulator/` 可写，磁盘空间充足。
- API 日志没有持续的 `data_gate_failed`、`invalid_kline_file` 或 SQLite 异常。
- `slow_api_request` 没有持续出现，`operation_timing` 的阶段耗时符合数据规模。

接口会为每次请求输出 `api_timing`，字段包含方法、路由、状态码和总耗时。
超过 `SIMULATOR_SLOW_REQUEST_MS` 时额外输出 `slow_api_request`。自选与交易日推进
还会输出 `operation_timing`：`list_watchlist` 包含自选数量和 SQLite 读取耗时，
`advance_account` 包含推进、刷新自选和候选数量。日志不包含股票真实身份。

定位推进卡顿时可直接筛选：

```bash
journalctl -u x-simulator --since "10 minutes ago" --no-pager \
  | grep -E 'api_timing|operation_timing|slow_api_request'
```

行情仓库使用带文件修改检测的 256 项进程内 LRU 缓存。首次读取大量自选仍会受
JSON 读取影响，后续请求应明显更快；数据文件变更后会自动失效，无需手工清缓存。

每次代码发布：

- `npm run check`。
- `npm test`。
- `npm run test:web`。
- `npm run build:web`。
- `npm run test:e2e`。
- 匿名 API 测试和未来数据截断测试仍通过。
- 备份数据库。

## 12. 常见故障

### API 无法启动

检查：

```bash
node --version
npm ls better-sqlite3 fastify
ss -lntp | grep 3001
journalctl -u x-simulator -n 200 --no-pager
```

常见原因是 Node 版本不匹配、原生模块未安装、端口占用、工作目录错误或 `var/simulator/` 无写权限。

### 页面能打开但 API 请求失败

- 检查浏览器请求是否指向同源 `/api`。
- 检查 Nginx `proxy_pass` 是否保留 `/api/`。
- 直接请求 `curl http://127.0.0.1:3001/health`。
- 开发环境确认 Vite 代理目标是 `127.0.0.1:3001`。

### 候选池为空

- 运行 `bin/x simulator check`。
- 确认目标日期存在日线、年线和 Universe。
- 检查是否有4个连续完整年度收盘点，从而验证最近3次年度收盘变化均为下降。
- 检查本年度此前是否已经发生过收盘突破。
- 克隆会话修改日期或筛选配置，不要修改已冻结会话。

### 推进后订单失效

检查订单的 `rejectionReason`。常见原因：D+1 停牌、缺少有效开盘价、涨停开盘买入、跌停开盘卖出、现金不足或可卖数量不足。当前规则为近似规则，应结合报告中的 `legacy_approximate` 标记理解结果。

### 返回 409

`session_version_conflict` 表示客户端版本已过期，应重新读取会话，不要盲目重放写请求。`invalid_session_state` 或 `decision_locked` 表示操作与当前 waiting/running 状态不匹配。

### SQLite 锁或损坏

- 确认只有一个 API 进程写同一数据库。
- 停止服务后备份故障文件。
- 使用 `PRAGMA integrity_check;` 检查。
- 不要在运行时通过网络文件系统共享 SQLite 文件。
- 损坏时从一致性备份恢复，不要手工编辑数据库页。

## 13. 扩展维护指南

新增候选策略：在 `src/signals/signals/` 实现信号和证据，注册到 signal registry，再由 selection pipeline 调用；不得把股票名称或代码加入匿名 DTO。

新增交易机制：在 `src/simulator/mechanisms/` 实现纯机制，并通过配置注入 application 层。费用、滑点和市场规则不要硬编码到页面。

新增 API 字段：先修改服务端白名单 DTO和匿名泄漏测试，再修改 Web 客户端。任何真实 `code`、`market`、名称或可反推组合键都不得在揭晓前进入响应、错误、日志或导出。

新增数据库字段：只追加迁移，并同时验证空库初始化、旧库升级和事务回滚。

新增页面：保持移动优先、可键盘操作、触摸目标不小于 44px，并在 Playwright 四种目标尺寸中验收。

## 14. 安全与数据隐私

- 当前无登录、授权、限流和 CSRF 防护，不允许直接公网开放。
- API 应绑定回环地址，由受控反向代理暴露。
- SQLite、导出 JSON 和日志可能包含练习记录，按敏感用户数据管理。
- 未揭晓 API 必须保持匿名；揭晓后的报告可能包含真实证券身份。
- 不要把数据库、导出文件、日志、`.env` 或本地配置提交到 Git。
- 不要在错误消息或应用日志中记录候选真实证券映射。

## 15. 发布验收命令

```bash
bin/x doctor
bin/x simulator check --start-date 20260701 --end-date 20260731 --json
npm run check
npm test
npm run test:web
npm run build:web
npm run test:e2e
curl --fail http://127.0.0.1:3001/health
```

最后一条需要 API 已启动。浏览器测试默认使用 Playwright Chromium；若本机没有浏览器，先执行 `npx playwright install chromium`，或设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向可用的 Chromium。
