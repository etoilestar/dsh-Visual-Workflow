# 运行可靠性修复与验收记录

PR [#6](https://github.com/etoilestar/dsh-Visual-Workflow/pull/6) 保留第一轮 A `f618357`、B `8909b2a`、C `487192b`。第二轮以原 PR HEAD `4007d9c7ced9edd2d2ff57884ce441f777d76921` 为基线，在原分支 `codex-runtime-reliability-fixes` 继续提交：A `c8d3cff`、B `cb6cf09`、C 为本报告所在的回归文档提交，完整 SHA 见 PR 提交列表和交付回复。不新建 PR，不自动合并；未修改官方 DSH 核心、依赖声明或锁文件。第二轮逐文件行数和审查报告见第 8 节。

代码、完整回归、官方工具 Scope 检查和插件 HTTP 检查已完成。真实模型驱动的五节点销售流程尚未执行：环境没有可用的 provider/model 与凭据配置名称。确定性销售测试使用测试替身执行节点，不能替代这项验收。

## 1. 根因与证据边界

| 发现 | 证据与处理 |
|---|---|
| 父代理工具目录不等于子代理可限制的继承工具集合 | 官方 `tools.restrict` 对未知继承工具抛错；自身注册工具不受该继承过滤器约束。改为创建窗口中的实际子 Scope 校验，先装执行 guard，再探测继承名单；自身获准工具走 guard，父代理专属工具始终拒绝。 |
| `subagent` 可能只存在于父 Scope | 在实际子 Scope 缺失时不将其送入 restrict；其他明确请求但缺失的工具拒绝启动。官方运行时检查复现该作用域差异并验证可调用与拒绝调用。 |
| 空名单与未配置名单不能混用 | 显式 `[]` 保持拒绝业务工具；未配置限制保留继承语义，仍禁止父代理专属工具。空名单随持久化会话事件恢复；第二轮权限安装失败释放已装贡献并让创建失败，未装配成功不能发布或派发。 |
| 子代理创建事件中的权限错误必须回传 | 官方创建事件串行等待监听器。Host 现在等待必要的权限安装，不再将该错误作为可忽略的贡献装配错误。没有 guard 或无法解析 Preset 时明确失败。 |
| 恢复起点依赖数组顺序 | 原先可选中 `start`。现在按拓扑和检查点推导业务调度前沿，并分别保存暂停检查点与 `resumeNodeIds`；完成节点继承完整输出和回合记录。 |
| 创建失败缺少轨迹、结构化异常变成 `[object Object]` | 启动前落盘尝试记录，失败保存 phase/code/message/retryable；错误提取支持结构化 message/error/code。终止来源区分父代理错误、主动收尾、用户停止、空闲超时等。 |
| 父代理读过文件不能证明子代理有输入 | 新增运行期文件绑定及实际工作目录解析；只通过明确 ctx 或工作区契约交接。文件读权限和声明产物由文件系统核验。 |
| 复盘可能忽略执行事实 | 复盘注入快照事实：运行状态、摘要、完成/失败/跳过节点与错误码；推理须与事实分开，无经验时直接结束。 |
| 首轮请求可能早于 child 登记 | 仅缓存本插件正在装配的 child 路由，登记时写入对应尝试；处置时回收，实际请求路由可覆盖配置值。 |

对原故障分别作以下判断：

- `run-mv0cdav5-n9bj28` 因空闲超时停止；`load_data` 失败两次，但父代理之后仍完成回合。第二轮使用公开 Agent.status 修复父活动漏判。原两次节点失败的完整底层异常仍未取得，不能证明权限异常是唯一原因。
- 用户补充证实 `run-mv0qd0me-p6nya1` 与首次共用 session-53b07d54-0282-4034-ad96-d8d1ee0a6f4d：turn/end seq=166，kind=error，code=CONTEXT_WINDOW_EXCEEDED，message=400 status code (no body)，业务节点均 attempts=0。第二轮保留真实错误并给出官方 token meter/compaction 检查说明。恢复前沿选错 start 也是缺陷，不能据此认定窗口错误的根因；当时实际模型、窗口及压缩状态仍需部署证据。
- 修复不回填不存在的历史证据。新运行应使用新增诊断字段定位具体失败阶段。

## 2. 第一轮逐文件修改（历史记录）

以下路径相对仓库根目录；`lib/` 与声明文件同步由构建生成。

| 文件 | 修改 |
|---|---|
| `src/host/agent/child-tool-filter.ts` | 实际 Scope 安装、继承/自身工具区分、先 guard 后 restrict、空名单与持久化恢复、失败关闭权限。 |
| `src/host/agent/runner.ts` | Preset/Combo 候选解析、创建窗口策略、必需工具校验、禁止 fork 历史兜底、关联权限日志。 |
| `src/host/agent/group-runner.ts` | Team 使用相同权限策略；逐成员开始/已创建回调，保留部分创建失败轨迹。 |
| `src/host/visual-workflow-host.ts` | 等待权限安装；会话装配事件持久化；实际 cwd 注入；请求路由观察及 pending child 清理。 |
| `src/host/shared/graph-model.ts` | 可选机器执行契约 `execution`。 |
| `src/host/shared/run-types.ts` | 可选失败、逐次尝试、终止来源、实际路由、输入绑定及产物字段。 |
| `src/host/shared/types.ts` | 重导出新增纯类型。 |
| `src/host/graph/execution-contract.ts` | 纯形状检查与规范化，不将自然语言 schema 变成强制协议。 |
| `src/host/graph/index.ts` | 导出执行契约解析。 |
| `src/host/graph/invariants-rules-nodes.ts` | 规划期未绑定文件 Warning、输入交接提示和非法契约错误。 |
| `src/host/graph/invariants-types.ts` | 增加相关校验码。 |
| `src/host/api/routes.ts` | 将可操作的输入错误映射为 HTTP 客户端错误。 |
| `src/host/api/runs.ts` | `run/runResume` 接受可选 `fileBindings`，保留既有端点与响应格式。 |
| `src/host/orchestrator/errors.ts` | 保留结构化异常可读消息。 |
| `src/host/orchestrator/execution-inputs.ts` | 实际文件、工作目录、ctx、必需文件、输出目录及产物检查。 |
| `src/host/orchestrator/graph-facts.ts` | 将已绑定文件解析为实际绝对引用。 |
| `src/host/orchestrator/task-blocks.ts` | 传入运行工作目录、文件绑定与执行要求。 |
| `src/host/orchestrator/run-entry.ts` | 新增终止参数与运行输入选项。 |
| `src/host/orchestrator/seams.ts` | cwd 依赖、启动诊断元数据、Team 逐成员回调。 |
| `src/host/orchestrator/resume.ts` | 拓扑前沿、完整检查点继承、暂停检查点分离。 |
| `src/host/orchestrator/directive.ts` | 将恢复前沿和检查点传入父代理指令。 |
| `src/host/orchestrator/runtime-base.ts` | 实际请求路由写入与创建竞态缓存。 |
| `src/host/orchestrator/runtime-launch.ts` | 启动/恢复输入预检、绑定持久化与恢复日志。 |
| `src/host/orchestrator/runtime-execute.ts` | 创建前持久化、逐尝试错误、Team 部分失败、主动终止来源；声明契约失败不能被父代理成功宣称覆盖。 |
| `src/host/orchestrator/runtime-observe.ts` | 真正 stopReason、声明产物检查、失败输出保持失败；日志使用真实失败码。 |
| `src/host/orchestrator/runtime-lifecycle.ts` | 父/子错误记录、明确终止来源、路由缓存释放。 |
| `src/host/orchestrator/watchdog.ts` | 空闲停止标明来源，保留既有触发语义。 |
| `src/host/orchestrator/snapshot.ts` | 逐次尝试、实际 child/route、失败脱敏及重试清理。 |
| `src/host/orchestrator/runtime-reflection.ts` | 从真实快照提取复盘事实。 |
| `src/host/prompts/orchestration.ts` | 恢复时区分暂停检查点和下一业务节点，无剩余业务时核查完成条件。 |
| `src/host/prompts/node-task.ts` | 注入可用文件引用、工作区与声明产物；不声称已读取文件。 |
| `src/host/prompts/reflection.ts` | 事实/推理区分，无经验直接结束，有 1～8 条时提交人工确认。 |
| `src/host/tools/wf-graph-patch/tool.ts` | 说明可选执行契约和运行期绑定，保留责任局部修图。 |
| `src/client/components/run-history/RunHistory.tsx` | 显示失败阶段、错误码、尝试、实际路由和终止来源。 |
| `src/client/i18n.ts` | 对应中文/英文诊断标签。 |
| `scripts/dsh-scope-smoke.mjs` | 可复跑的官方工具 Scope 检查，外部加载官方包，不增加项目运行依赖。 |
| `scripts/dsh-http-smoke.mjs` | 实际服务认证和两个插件接口检查，不输出凭据。 |
| `scripts/run-sales-live.mjs` | 准备/运行真实销售验收，新会话与实例、实际路由和文件断言、超时只停止自身测试运行。 |
| `tests/fixtures/sales_workflow_test.csv` | 保存用户提供的 11 条原始数据，包括重复行和两处空值。 |
| `docs/runtime-reliability.md` | 交付记录及部署验收步骤。 |

没有修改 `wf-experience` 入库机制：工具原本已限制 1～8 条并支持人工零选正常返回，调整与之冲突的 Prompt。构建同时补齐基线 PR #5 已存在源码的 importer 产物，没有重写 Dify 导入逻辑。

## 3. 回归测试

| 文件 | 新增或修复验证 |
|---|---|
| `tests/host/agent/child-tool-filter.test.ts` | 实际权限语义、空/未配置、继承/自身工具、缺 guard、失败不扩大权限、冷恢复。 |
| `tests/host/agent/runner.test.ts` | Preset/Combo/必需工具、创建策略、上下文隔离和错误契约。 |
| `tests/host/agent/group-runner.test.ts` | Team 创建采用共同策略及成员回调。 |
| `tests/host/orchestrator/resume.test.ts` | 调整原先按数组选择的断言，验证可执行前沿。 |
| `tests/host/orchestrator/runtime-execute.test.ts` | 更新真实失败快照及尝试记录断言。 |
| `tests/host/orchestrator/reliability.test.ts` | 启动异常、异常结算、零次业务父错误、拓扑/DAG/pause/Group/Proxy 恢复、首请求路由竞态、Team 部分创建失败。 |
| `tests/host/orchestrator/execution-inputs.test.ts` | 未绑定/不存在/无 cwd 文件、绝对引用、不修改图、ctx 检查、真实产物、父代理不能掩盖失败、产物错误日志。 |
| `tests/host/orchestrator/fixtures/harness.ts` | 真实 FlowStore 的测试装配增加 cwd/logger 依赖。 |
| `tests/host/graph/invariants.test.ts` | 规划 Warning、契约错误、输入来源与已有责任检查并存。 |
| `tests/host/prompts/reflection.test.ts` | 零经验不调用工具，事实摘要与推理分离。 |
| `tests/integration/host-assembly.test.ts` | 权限失败回传、首轮装配与冷恢复，柔性贡献仍保留容错。 |
| `tests/integration/sales-workflow.test.ts` | 测试替身 runner + 真实 CSV/中间文件/ctx/持久化/报告/五节点结算与运行锁释放。 |
| `tests/client/components/run-history/RunHistory.test.tsx` | 中英文失败/路由/尝试显示和旧快照兼容。 |
| `tests/contract/package-contract.test.ts` | 基线版本断言 `0.1.0` 与实际包 `0.10.0` 不一致；同步真实包版本，保留产物契约。 |
| `tests/host/service/manager.test.ts` | 可执行文件断言区分 Windows `dsh.cmd` 与 Linux `dsh`。 |
| `tests/host/storage/atomic.test.ts` | 孤儿临时文件用已退出 PID；Linux PID 1 仍存活，不能作为孤儿证据。活跃写入保护不变。 |

T01～T05 对应 agent 权限、runner 和 reliability；T06～T08 对应 resume/reliability；T09～T11 对应 execution-inputs/sales-workflow；T12 对应零次业务父错误；T13 对应 reflection Prompt；T14 由既有 `tests/host/tools/wf-experience/tool.test.ts` 覆盖候选卡片、人工零选和入库；T15 由既有 runtime-service、Team 与 group-runner 测试覆盖。真实外部模型下的 T01/T15 尚未验收。

PR #3 的职责覆盖、重复职责、局部图修复和 PR #5 的 Dify parser/importer 测试均在完整回归中通过。数据库、MCP、服务模式和旧历史兼容采用仓库现有自动化回归；未接入外部真实数据库、MCP 服务或远程 Agent provider。

## 4. 实际执行结果

环境：Node.js 24.19.0、pnpm 11.19.0；独立安装官方 `@deepseek-ai/dsh@0.2.0-rc.2`。所有命令均设置 `pnpm_config_verify_deps_before_run=false`，完整回归设置 `VITEST_MAX_WORKERS=3`。

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过。 |
| `pnpm test --maxWorkers=3` | 第二轮最终 192 文件、2168 测试通过。 |
| `pnpm build` | 通过，Host/Client/声明产物生成。 |
| `pnpm client-smoke` | 通过。 |
| `pnpm check` | 第二轮再次完整通过：类型检查、192 文件/2168 测试、构建与 client-smoke。A、B 提交分别通过 2152、2162 项完整检查。 |
| 环境安装脚本 | 外部依赖安装、隔离构建、client-smoke、官方插件 link 实际通过。 |
| 官方 Scope 脚本 | 第二轮 15 次真实工具执行、2 个恢复钩子返回结果和同一父 Scope 的 2 次模型路由更新通过；未执行模型或真实压缩。 |
| 重启后的 DSH HTTP | 启动认证 303，`toolCombos`、`activeRuns` 均 HTTP 200 且 `ok=true`。 |
| 真实服务准备销售实例 | `createSession`、`putWorkflow` 成功，未启动模型运行。 |
| 真实服务拒绝缺失 CSV | `run` 返回 HTTP 422、`WF_INPUT_FILE_UNAVAILABLE`，未启动模型运行。 |
| 第二轮真实服务拒绝越权文件 | `run` 返回 HTTP 403、`WF_INPUT_FILE_UNAUTHORIZED`，activeRuns=0；未启动模型运行。 |
| 销售确定性集成 | 五个节点均 ok、每个一次尝试、真实中间文件和报告核验、Run completed、锁释放。 |
| 真实模型销售端到端 | **未运行**：缺 provider/model 和可用凭据配置名称；脚本在缺少配置时拒绝启动。 |

CSV 结果：11 条记录、1 条完全重复、2 个空单元格、9 条有效记录；总额 15900，平均 1766.67，最大 S001/6000，最小 S010/200。确定性测试的文件位于测试临时目录，完成后清理；它不是部署工作区的真实模型报告。

第二轮日志位于 `/tmp/round2-final-typecheck.log`、`round2-final-test.log`、`round2-final-build.log`、`round2-final-client-smoke.log`、`round2-final-check.log`；Scope/HTTP 结果位于同目录 `round2-final-scope.json`、`round2-final-http.json`。原仓库锁文件的 yaml 缺 resolution；安装仅在外部副本修复，仓库锁文件保持原样。

## 5. API 兼容性与剩余限制

第二轮兼容性收敛：运行期绑定及显式 `requiredFiles` 只接纳实际会话工作区、插件 `data/files` 受管目录和该会话用户消息中的官方已接纳附件。外部附件由公开 `ctx.attachments.fileHostPath(ref)` 解析，路径文字或调用方传入的布尔授权不授予权限；`realpath` 防止软链接越界。Docker 挂载应使用实际会话 cwd；已有 `managedPath` 仍相对插件数据目录。文件授权在节点派发前重新核验。

显式 `outputFiles` 必须在工作区内，本次尝试开始时记录文件签名，在结算时检查本次写入证据。未变化的旧文件返回 `WF_OUTPUT_FILE_STALE`；不存在返回 `WF_OUTPUT_FILE_MISSING`。签名只证明文件变化，不能证明内容正确或排除同一工作区其他进程的并发写入。未声明文件产物的旧节点不增加文件要求。

独立节点优先使用 `spawn`，其他现有隔离 provider 保持可选。fork-only 环境返回 `WF_ISOLATED_PROVIDER_UNAVAILABLE`，应在实际 DSH profile 启用 `@deepseek-ai/dsh-subagent-spawn-in-process`，或安装支持隔离的 provider；不使用继承全部父历史的 fork 兜底。Team 无隔离 provider 时沿既有逐节点路径得到相同错误。

- 已实测官方 0.2.0-rc.2 的公开 `tools.get/schemas/restrict/guard` 和 Scope 接口；Host 通过服务能力探测适配，不依赖私有 `tools.view`。未宣称覆盖全部历史 DSH 版本。缺少必要 guard、Preset 解析或独立子代理 provider 时明确失败；仅有 fork 时不以父历史作为兜底。
- `execution`、诊断及文件绑定字段均可选，旧模板和快照可读取；自然语言 `inputSchema/outputSchema` 保持柔性。未声明强制 ctx 的旧图保持原来的可选上下文语义；`flow` 仍只负责执行顺序，`db-in` 仍决定数据库能力。
- `run/runResume` 新增可选 `fileBindings: {文件节点id: [路径]}`。HTTP 请求保持 `{args: ...}`，成功结果保持 `{ok:true,value:...}`。绑定按本次运行持久化；续跑可继承或重新绑定，不改写原实例。
- 受管文件的 `data/files/...` 相对插件数据根目录；运行期相对路径依赖实际会话 cwd，不回退到 Host 进程 cwd。文件系统检查证明可访问，不能证明模型已阅读。远程 ACP 等独立文件系统必须自行挂载/传输同一输入，目前未验证。
- 第二轮声明产物检查核验本次尝试开始前的元数据和内容签名，原样旧文件不能替代本次写入。签名不自动证明内容正确、模型实际阅读过或排除同工作区其他进程的并发写入；销售脚本另核验统计内容。
- 第二轮通用成功判定不再依赖 execution：无条件必需路径及实际已选条件路径上的失败不能被 wf_finish(completed) 掩盖。运行中节点、已完成业务节点的必需前驱未完成时拒绝成功收尾；合法失败恢复分支、未选分支及提前终止保留。
- 新增日志只记录关联字段和脱敏错误，不打印文件全文或凭据。原异常文字可能丢失或无法解析；不会据此编造模型错误的具体原因。provider/model 配置值与首请求后的实际值通过请求路由记录区分。
- 2168 项是第二轮最终完整回归结果；未采集新增代码覆盖率百分比，不能据数量声明达到 80%。外部模型、远程 provider、数据库及 MCP 服务仍需对应部署验收。
- 完整测试日志包含缺失 source map 的诊断，类型检查、测试及构建仍通过；本次没有修复调试映射问题。
- 所有经验仍须多选卡片人工确认；零经验直接结束，零选择正常返回零入库。验收脚本不会自动批准经验。

## 6. Docker Compose 中的操作步骤

先选择实际 DSH 服务名及容器内仓库路径。以下变量均为普通配置名/路径，不是密钥；示例值需与部署一致。先确认仓库内已包含 A/B/C 提交。

```bash
docker compose ps
task_service=dsh
task_repo=/app/dsh-Visual-Workflow
docker compose exec "$task_service" node --version
docker compose exec "$task_service" pnpm --version
docker compose exec "$task_service" dsh --version
docker compose exec -w "$task_repo" -e pnpm_config_verify_deps_before_run=false -e VITEST_MAX_WORKERS=3 "$task_service" pnpm check
docker compose exec "$task_service" dsh plugin --profile web add "link:$task_repo"
```

依赖应使用部署现有安装步骤；如果遇到基线锁文件缺 resolution，参考云环境安装脚本在外部副本修复，不重新生成仓库锁文件。将插件挂载到实际运行的 profile；服务模式沿用既有 serve profile/启动命令。重新加载插件需按该部署方式重启服务，先确认没有需要保留的活动运行，再使用 `docker compose restart "$task_service"`。本次没有实际 Docker daemon，以下部署步骤未在真实 Compose 中执行。

核验 Web 服务端口与容器内日志位置后，运行 HTTP 检查：

```bash
task_base_url=http://127.0.0.1:3081
task_web_log=/var/log/dsh-web.log
docker compose exec -w "$task_repo" -e DSH_BASE_URL="$task_base_url" -e DSH_WEB_LOG="$task_web_log" "$task_service" node scripts/dsh-http-smoke.mjs
```

`DSH_WEB_LOG` 适用于日志包含当前服务生成的登录 token 的部署；该路径必须是容器内可读的实际日志文件。脚本内部认证，不打印 token。使用其他身份认证方式的部署需要接入该部署的认证机制，不能据匿名页面 HTTP 200 宣称插件接口通过。

通过 DSH 设置配置一个可用 provider/model 和凭据。下面只填写已配置的 provider/model 名称；凭据继续由 DSH 设置或部署的安全环境配置提供。将仓库 CSV 与输出工作区挂载到同一个实际执行容器，使用新的工作区：

```bash
task_provider=已配置的provider名称
task_model=已配置的model名称
task_workspace=/workspace/sales-acceptance-20261009
docker compose exec -w "$task_repo" \
  -e DSH_BASE_URL="$task_base_url" -e DSH_WEB_LOG="$task_web_log" \
  -e DSH_TEST_PROVIDER="$task_provider" -e DSH_TEST_MODEL="$task_model" \
  -e DSH_TEST_WORKSPACE="$task_workspace" \
  -e SALES_CSV="$task_repo/tests/fixtures/sales_workflow_test.csv" \
  "$task_service" node scripts/run-sales-live.mjs
```

脚本将 CSV 复制到该执行工作区，创建新会话和工作流实例，串行 flow 调度五节点，文件节点绑定 CSV，显式 ctx 交接每个中间产物。默认等待 10 分钟，可用 `DSH_TEST_TIMEOUT_MS` 调整；超时只停止它创建的运行。需要先审阅实例时，加 `--prepare-only`；该模式不请求模型，也不构成端到端通过。

完成后验证真正的输出文件，而非只看父代理回复：

```bash
docker compose exec "$task_service" test -s "$task_workspace/output/final_report.md"
docker compose exec "$task_service" cat "$task_workspace/output/stats.json"
docker compose exec "$task_service" cat "$task_workspace/output/final_report.md"
docker compose exec "$task_service" cat "$task_workspace/live-run.json"
```

预期 Run 为 completed；五个业务节点都为 ok，均有真实 childId、attempt、实际 provider/model 和已核验 artifacts；统计与本记录第 4 节一致。失败时先读 `termination`、`parentErrors`、节点 `failure/attemptHistory/stopReason`，按 runId 关联权限、创建、请求、结算和终止日志，分别定位父代理与子代理。

恢复验证应另用专用测试实例：停止或制造 `load_data` 失败后调用既有 `runResume`，必要时传新 `fileBindings`；检查 `resumeNodeIds` 含真正就绪的业务节点、成功输出保留，父代理不会调度 `start`。暂停恢复验证检查 `checkpointNodeId` 的暂停门语义。不得用原始历史缺失字段反推未记录的底层异常。

## 7. 云环境配置

安装脚本和启动说明保存在环境配置草稿中，隔离安装路径为 `/workspace/.cloud-env`。脚本已实际安装、构建、link；启动说明对应本次真实成功的服务启动和检查。没有新增凭据要求或扩大现有网络访问域。

草稿保存不等于配置发布；需要在环境设置中审阅、保存并发布。远端 main 在修复合并前不包含这些更改；新建环境需选择含修复的分支或保留当前工作区快照。本次未验证新建环境的代码恢复结果，不能以环境安装成功替代代码版本复现验收。

## 8. 第二轮增量审查报告

### 已确认修复与新增配置

首建、重发布、冷恢复统一安装一次权限策略；重发布先释放旧贡献，中途错误及会话装配事件写入失败均释放贡献并中止创建。测试区分权限 guard 与独立 ReAct guard，不将总 guard 数误当权限贡献数。工具类型通过同一实际 agent key 的 get/restrict/get 区分；临时空继承限制在 finally 释放，不读私有 tools.view，不匹配异常文字。

Watchdog 使用公开父 Agent.status，保护模型、工具及压缩活动；子代理活动仍独立检测。父错误在最终 turn/end 且父代理已 idle 后优先处理。真正空闲仍按默认 30 分钟停止；可选 runExecutionTimeoutMs 默认两小时、0 关闭，独立记录 execution_timeout。暂停不参加扫描，恢复按新 Run 开始计时；保留 aborted 与用户明确 stop 的区别。

纯编排恢复不再重复目标、整图、责任及历史记录，改用稳定事实文件引用和当前调度前沿/预算；混合模式的必要父任务保留。继续复用原 Session，不偷偷丢弃历史或改大 contextWindow。模型选择贡献只参与 system-prompt/assemble 和 agent/request，不拦截官方 agent/pre-step 或 agent/request-error；官方 Scope 检查验证这两个恢复钩子的返回结果能通过父贡献，但没有执行真实模型压缩。

没有普遍新增强制配置：execution、文件输入/输出和 ctx 仍可选，自然语言 schema 保持柔性。显式 outputFiles 需要实际会话 cwd 及本次写入证据；fork-only 环境需要启用隔离 provider。新增执行时限有默认值，部署应按业务时长审阅两小时保护或设为 0。Docker 挂载用实际 cwd，受管 data/files 相对插件 dataDir；普通绝对路径不能自行授权宿主机外部文件。

### 源文件与实际行数

相对本轮基线 4007d9c：**20 个 Host 源文件，新增 266 行、删除 85 行**。下列为缺陷修复及必要可选契约扩展；脚本、测试和生成文件不计入源码行数。未修改 Client 源码。

| 文件（src/host/ 下） | + / - | 原因、旧接口影响 |
|---|---:|---|
| agent/agents-host.ts | 25 / 0 | 官方用户附件引用读取；新增内部能力。 |
| agent/child-tool-filter.ts | 28 / 27 | 单策略和失败清理；保留 undefined / [] 区别。 |
| agent/group-runner.ts | 1 / 1 | Team 隔离 provider 的稳定可操作错误。 |
| agent/runner.ts | 1 / 1 | fork-only 明确启用 spawn 的办法。 |
| api/routes.ts | 1 / 0 | 未授权文件映射 403，端点/包格式不变。 |
| config.ts | 5 / 1 | 可选执行时限及唯一默认值。 |
| orchestrator/directive.ts | 2 / 1 | 精简纯编排恢复注入。 |
| orchestrator/execution-file-access.ts | 69 / 0 | 本模块内路径授权与签名，无新上传/沙箱服务。 |
| orchestrator/execution-inputs.ts | 20 / 20 | 授权预检及逐尝试产物基线，仅严格校验显式要求。 |
| orchestrator/run-entry.ts | 2 / 0 | 可选官方附件能力注入，不能通过 fileBindings 自行授权。 |
| orchestrator/runtime-base.ts | 9 / 0 | 公开父状态与独立执行时限。 |
| orchestrator/runtime-execute.ts | 33 / 7 | 旧图通用成功判定及派发前授权重检。 |
| orchestrator/runtime-launch.ts | 2 / 2 | 首次/恢复共用授权预检。 |
| orchestrator/runtime-lifecycle.ts | 4 / 2 | 原始窗口错误及官方恢复检查说明。 |
| orchestrator/seams.ts | 1 / 0 | 可选执行时限配置缝。 |
| orchestrator/watchdog.ts | 22 / 7 | 父活动保护、真空闲、父错误及执行超时。 |
| prompts/index.ts | 1 / 0 | 恢复构建器导出。 |
| prompts/orchestration.ts | 17 / 1 | 精简恢复并保留必要调度契约。 |
| shared/run-types.ts | 3 / 1 | execution_timeout 和可选输出基线；旧快照可读。 |
| visual-workflow-host.ts | 20 / 14 | 单入口装配、失败清理与能力注入。 |

lib 均由源码构建，产物随 A、B 同步以支持独立审查；最终连续两次构建的 **502 个已跟踪 lib 文件哈希全部一致**。相对本轮基线的 src/host/importer 和 lib/importer 都零变更。第一轮补齐的是主线已有 Dify 源码的缺失生成文件，没有改写导入行为。

### 通用兼容矩阵

| 场景 | 实际回归与边界 |
|---|---|
| 纯文本/空输出/工具副作用 | 新 execution-inputs 参数化测试：无/空 execution 可正常完成；schema 原样保留，无实体文件要求。 |
| 共享工作区 | 新 workspace + requiredFiles 无 ctx 连线通过。 |
| DAG/旧模板无 execution | 原 reliability/resume 及新必需失败、已选条件路径失败、前驱未完成、未选分支/失败恢复/提前终止测试通过。 |
| CSV | 原真实文件处理 Fixture 和五节点确定性回归保留，通过。 |
| 文件节点多文件 | 新 managedPath + files[] 解析和去重通过；无 cwd 的合法受管文件可用。 |
| MCP/PTC/Combo/Preset | 原权限、runner、tools-view 用例及官方 MCP/Preset Scope 检查通过；外部 MCP 未接入。 |
| 数据库 | 原 db-in 权限、wf-db-query 和索引测试通过，无强制 ctx 文件要求；外部数据库未接入。 |
| Team | 原成员权限/状态/部分失败测试通过；fork-only 明确报错，真实模型 Team 待部署。 |
| Mode2 | 原 runtime-service、服务管理及 workflow-e2e 阻塞/完成/用户隔离测试通过；外部模型服务待部署。 |
| 暂停/恢复 | 原拓扑前沿、pause、成功检查点不重跑及新精简恢复指令通过。 |
| 上下文超限 | 新零业务尝试测试保留原 code/message/parent_error；历史压缩根因待部署。 |
| 父长请求/子忙/真空闲/用户停止 | Watchdog 明确区分 idle_timeout、parent_error、execution_timeout、user_stop；原取消/暂停语义保留。 |
| 旧产物/越界路径 | 新原样旧文件失败、重生成成功、绝对/../ /软链接拒绝、附件授权重检及结算前目录软链接替换拒绝。 |
| Dify/责任图谱 | 原 parser/importer、覆盖/重复/局部修图回归通过，无相关源码/产物变更。 |

旧测试变更原因：finish 用例先真实结算正在执行的 child；“终态后忽略迟到事件”用例改用明确 failed 收尾，保留原目的；Team 工具替身按公开 get/restrict 实际过滤继承面。另一个既有 FlowStore 排序测试初次全量运行因两次写入同毫秒失败；保存会覆盖传入 updatedAt，改为仅控制 Date，保证第二次保存较晚，保留全部原排序/会话断言，不改变产品存储行为。

### 部署只读诊断与剩余验收

Node.js 24+ 支持普通 JSONL 和官方 Zstd 日志：

```bash
node scripts/dsh-context-diagnostics.mjs \
  --session /实际路径/session.v4.jsonl.zstd \
  --inventory /实际路径/pluginInventory.list.json \
  --runtime-log /实际路径/dsh-web.log
```

inventory/runtime-log 可省略；缺证据显示 unknown。inventory 使用 DSH 官方插件管理界面的只读 pluginInventory.list 快照，含 entries / agentPresets / enabled / fiberPhase，保存为 JSON；脚本读取会话头 agentPreset，或用 --preset 实际presetId 指定，不以其他 preset 活跃插件证明本会话加载。当前 inventory 不能证明历史故障时状态。

脚本列出实际 request/context 的 provider/model/contextWindow，以及 compaction/start、summary、summary-error、end、turn/end 的阶段和有限错误信息，不输出用户正文、摘要正文或 rawOutput。官方 0.2.0-rc.2 的 compaction/summary-error 是恢复瀑布钩子，不保证成为持久化会话事件，因此另提取官方压缩失败警告。没有 start 仅表示所给日志未观测到，需要核对日志完整性。

本环境读取实际“已准备但未推理”的 Zstd 会话成功，路由、窗口、加载状态如实 unknown；确定性 Zstd 样本另验证窗口、压缩阶段及最终错误、内容不泄露、原文件字节/mtime 不变。该样本不能作为历史部署证据。

真实模型 E2E 分别报告：**已执行并通过：无；已执行但模型失败：无；当前无法执行：销售五节点、历史同会话压缩恢复和远程 provider**。live 脚本因缺 provider/model 被配置检查拒绝，没有发模型请求。准备实例及 HTTP 预检通过不等于模型 E2E。

合并前人工执行：在实际 Docker/profile 更新并重建/link 此分支；妥善处理活动运行后重启；获取故障父 Session 的实际模型/窗口、父 preset active 插件、压缩进展/警告/重试和最终错误；配置现有安全凭据后执行第 6 节真实销售脚本并检查内容；另外在原 Session 验证长请求、暂停/失败恢复和成功节点不重跑，并实测 MCP、数据库、Team、Mode2。审阅两小时执行保护和实际工作区挂载；fork-only 启用隔离 provider；经验仍由原有卡片人工确认，不自动批准。本环境没有 Docker daemon，上述 Compose 和模型场景均待部署。
