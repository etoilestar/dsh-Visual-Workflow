# 通用 Workflow Runtime 输入、交接与验收

PR #9 基于最新 main，保留 PR #6–#8 的 Preset 权限隔离、NOT_RESUMABLE 有界重建、执行期 WF_BUSY、runId/attempt/childId/宿主 epoch 隔离。实现不依赖业务节点名称、CSV、模型或供应商，也不修改 DSH 官方代码。

## 模型与迁移

此前 flow 线负责调度，ctx 线提供上下文；运行入口主要传会话与图 ID。现在新增静态 `WorkflowDocument.runtime` v1 定义和节点 `data.execution.inputs/outputs/completion`，运行数据单独保存在 `RunSnapshot.runtimeInputs`。模板、服务、工作流资产保留静态定义和节点契约，运行输入不进入模板或 SYSTEM Prompt。资产库添加 nullable `runtime_json`，旧版本数据和 Active 指针不被重写。

缺省交接策略为 **explicit**，旧图不会被静默转换。工作台启动与恢复对话框可选择 explicit/auto/strict；策略、预算和输入版本冻结进快照。仅添加 flow 线不会改变旧图的数据语义。

- explicit：保留显式 ctx；声明的 input.source 或用户绑定也可传值。
- auto：增加确定的直接控制依赖输出；用户显式槽值优先。
- strict：采用同一依赖解析并拒绝未满足或不确定的必需输入；没有声明需求的普通文本节点仍然合法。

自动边只存在于解析结果，不写回图。多来源保留来源和输出名；无法唯一匹配所需类型时返回 WF_HANDOFF_AMBIGUOUS，不根据文件名或回复猜测。条件入线须通过 wf_run_node.selectedEdgeIds 指定已选条件线 ID，未选路径不能交接。proxy 规范化为主节点；协作组须按组和成员生命周期结算；循环消费自身旧结果必须明确上一 attempt。只有当前有效成功结果可交接，恢复时继承且未重跑的成功结果可保留。

## 静态契约与请求示例

工作流定义可通过现有模板导入或保存 API 配置；自由文本 inputSchema/outputSchema 仍是说明，不被解释为机器契约。

```json
{
  "runtime": {
    "version": 1,
    "handoffPolicy": "auto",
    "inputs": {"subject": {"kind": "text"}},
    "budget": {"parentCallLimit": 100, "nodeExecutionLimit": 20, "executionTimeoutMs": 600000}
  }
}
```

第一个角色节点的 data.execution：

```json
{
  "inputs": {"topic": {"kind": "text", "source": {"workflowInput": "subject"}}},
  "outputs": {"facts": {"kind": "json", "schema": {"type": "object", "required": ["total"], "properties": {"total": {"type": "number", "minimum": 0}}}}},
  "completion": "verified"
}
```

下游可声明 `inputs.data = {kind:"json", source:{nodeId:"first",output:"facts"}}`；不需要 File Node 或 ctx 线。多个文本/JSON 输出使用最终回复 JSON envelope `{"outputs":{"facts":{"total":42},"summary":"摘要"}}`；单个 JSON 输出也接受直接 JSON 对象，单个文本输出接受直接文本。禁止把工具调用中间回复当作结果。

启动/恢复的 runtimeInputs 示例：

```json
{
  "workflowInputs": {
    "subject": [{"kind":"text","value":"分析任务"}],
    "options": [{"kind":"json","value":{"limit":5}}],
    "document": [{"kind":"file","fileRef":{"source":"workspace","path":"input.txt"}}]
  },
  "nodeInputs": {
    "first": {"extra": [{"kind":"json","value":{"enabled":true}}]},
    "second": {"previous": [{"kind":"output","nodeId":"first","output":"facts"}]}
  },
  "parameters": {"locale":"zh"}
}
```

值保持类型，任务块中的 USER 调用描述保留 JSON 和来源，不把所有值存成字符串。每槽最多 32 项、最多 128 槽；输入/结构化输出最多 256 KiB。大内容使用文件引用。

支持的 schema 子集：type、properties、required、additionalProperties、items、enum、minLength、minItems、minimum；拒绝未知验证关键字和不适用的类型规则，限制递归深度。它不是完整 JSON Schema 实现。

## 输入授权、界面与持久化

点击运行或恢复后选择输入目标、槽名、类型和值；恢复默认带回断点输入。支持文本、JSON、工作区明确路径、官方附件和上游命名结果引用，参数是 JSON 对象。未声明文件输入需求的普通节点不会被强制检查 CSV。文件可直接绑定角色节点，通用流程无需增加文件节点。

工作台“补充运行输入”仅为 pending 且 attempts=0 的节点提供绑定。输入错误预检保留 pending/0，允许用户补充后按原 retryLimit 调度；已运行、已失败或已完成的节点不能悄悄换输入。主节点与 proxy 使用同一锁。绑定带 runId、expectedRevision、nodeId，只提交该节点槽；版本冲突刷新版本和可绑定节点，保留草稿并要求用户检查后再次提交。

附件上传不等于输入绑定。工作台受控上传写入受管目录，随机前缀避免覆盖旧文件；上传只修改界面草稿，提交后才调用绑定 API。取消、卸载和切换会话/文档会关闭草稿；迟到上传或启动回复不写入新文档。已经提交到后端的运行意图不因切换界面被自动停止。

授权由宿主确定：

- workspace：解析明确路径，真实路径须在会话 cwd 内且可读；符号链接不能逃逸。
- managed：真实路径须在插件受管 data/files 内且可读。
- attachment：普通官方 user/message 文件块的 attachmentId/name/bytes 必须与当前会话公开引用匹配，再使用官方 fileHostPath；调用方提供的 path 不决定授权。
- output：仅指向当前有效已结算结果；文件必须是该结果的已验证产物，交接前重新检查签名。

DSH 0.1.6-alpha.2 的问答 answers 公开面不提供文件引用，不能据此授权文件；使用工作台专用受控上传/选择。未知宿主事件格式不会伪造引用。没有扫描附件目录、搜索 CSV、猜测路径或自动申请 sandbox 权限。

启动、恢复、绑定和派发前均校验文件访问；恢复保留合法绑定并重新授权。受管引用通过不代表子代理具有额外工具或 sandbox 权限。绑定先严格写盘再发布内存版本，派发与绑定互斥，异步校验后复核运行代际。其他节点同时结算时保留其最新状态。运行快照含用户输入、来源和 invocation，应按既有运行历史访问权限保护；日志仅记名称、阶段和代际，不记录完整文件内容或凭据。

API：runtimeInputOptions({sessionId,flowId}) 获取需求和可选官方文件；run/runResume 接收 runtimeInputs 与 handoffPolicy；runInputBind({sessionId,runId,nodeId,expectedRevision,inputs}) 的 inputs 是目标节点槽对象。省略 nodeId 的工作流级绑定只允许所有执行节点尚未派发。原 fileBindings API 保留。

## 执行、结果与失败收敛

真实调度顺序是依赖解析 → 输入解析 → 访问预检 → 构造完整 invocation/首次 USER 任务块 → 计入执行预算 → 启动子代理。组成员全部预检后才能派发。输入失败不增加 attempts/callCount，也不启动空子代理。执行中的有效 inflight child 返回 WF_BUSY；工具调用失败或未知存活状态不会解除此互斥。

NodeResult 保存 status(succeeded/failed/cancelled)、confirmation(turn/verified/unverified)、runId/nodeId/attempt/childId、命名 outputs 和 verified artifacts。文件声明要求实际文件存在，并具有相对于本 attempt 基线的新写入签名；预存在文件和“已保存”回复不能充当证明。产物含名字、路径、大小、签名及代际，交接后被改写会拒绝使用。

subagent/end 是回合结算，只有通过声明的硬契约才能确认结果。无硬契约的旧文本节点沿用回合成功，但 confirmation=turn；不会声称语义业务已验证。completion=semantic 明确返回 WF_OUTPUT_UNCONFIRMED，需外部业务验证，不能伪造确认。失败/取消结果 outputs/artifacts 为空；结算状态与结果同步发布后持久化。执行契约在派发时冻结，运行期间改图不改变该 attempt 的验证条件。

失败记录保存 phase/code/retryable/nodeId/attempt；恢复保留历史错误和新代际。明确不可重试的错误不由运行时自动重试；父代理可在合法预算内显式决定重新执行。NOT_RESUMABLE 仍仅在旧子代理明确不可恢复时，有界重建一次；取消、暂停、权限或沙箱错误不能触发权限升级或无沙箱重建。

纯编排父代理通过公开 tools.guard、tools/pre-execute、tools/result 边界受约束（含 PTC 子调用）。只能使用编排工具、受控交互、只读编排定义；不能 Bash/Glob/send_message/业务 write、改 systemPrompt 注入输入或通过图补丁填文件数据。合法 hybrid 父代理和普通子代理保留原权限；新边界不能 force-allow 官方拒绝。

usage.parentCalls 与 usage.nodeExecutions 分开记账，后者统计实际子代理执行次数。调用失败预算、连续同工具同错误次数（缺省 5）、执行时间和 Token 可配置。Token 只读取公开 assistant usage.totalTokens，不以字符估算，不重复加缓存或推理 Token；缺失完整计数时 tokenAccounting=unavailable，若配置硬 Token 预算则安全失败 WF_TOKEN_ACCOUNTING_UNAVAILABLE。取消、超时、重复失败、预算耗尽和显式失败收尾会中断子代理、解除等待、保存终态并释放运行锁。取消接口不可用会告警，不能声称停止了宿主模型请求。

时间/Token 是协作式预算：工具/调度入口和 watchdog 检查，计量以宿主已报告 usage 为准，单次模型请求可能先消耗超过剩余预算；并非供应商侧硬 Token 上限。恢复累计消费不重置预算。

## 主要诊断

| 错误码 | 意义与处理 |
| --- | --- |
| WF_INPUT_REQUIRED / WF_RUNTIME_INPUT_INVALID | 输入缺失/格式错误；按 details.field 补充，不启动 child |
| WF_INPUT_PATH_UNRESOLVED / WF_INPUT_FILE_UNAUTHORIZED | cwd 不可用或路径/附件未授权；使用明确合法绑定 |
| WF_INPUT_REVISION_CONFLICT / WF_INPUT_STATE_CONFLICT | 版本变更或节点已派发；刷新检查，禁止覆盖运行中输入 |
| WF_DEPENDENCY_UNSATISFIED / WF_HANDOFF_AMBIGUOUS | 上游未有效结算或来源不唯一；等待或明确 source/selectedEdgeIds |
| WF_OUTPUT_INVALID / WF_OUTPUT_UNCONFIRMED | 结构/必需结果无效或语义未确认；不能向下游交接成功 |
| WF_OUTPUT_FILE_MISSING / WF_OUTPUT_FILE_STALE | 文件缺失、没有本次写入证据或交接后改写 |
| WF_BUSY / WF_CANCELLED | 当前执行未结算/代际已取消；不重复派发 |
| NOT_RESUMABLE / WF_CHILD_START_FAILED | 原有安全重建不能完成；保留宿主原诊断 |
| WF_PARENT_TOOL_DENIED | 纯编排父代理越过工具/输入边界 |
| WF_BAD_ARGS | 工具参数错误；具体字段诊断保留在响应 |
| WF_GLOBAL_LIMIT / WF_NODE_EXECUTION_LIMIT / WF_PARENT_CALL_LIMIT | 对应预算耗尽，终止并释放锁 |
| WF_REPEATED_FAILURE / WF_EXECUTION_TIMEOUT | 持续同类错误或执行超时，自动收敛 |
| WF_TOKEN_ACCOUNTING_UNAVAILABLE / WF_TOKEN_LIMIT | 无法可靠计量或达到 Token 上限，安全终止 |

trace 记录 run_started、input_requested、input_bound、input_validated、dependency_resolved、handoff_prepared、node_dispatched、child_started、child_settled、output_verified、node_completed、run_completed/run_failed。适用时包含节点、attempt、childId、inputRevision 和输入名称。invocation 可回答实际输入与来源；日志不包含完整用户输入。

## 验证与现场命令

云环境使用 Node.js 22、隔离安装的官方 DSH 包和受控 DSH 传输。单元/集成测试覆盖文本/JSON/文件、普通无 File Node 工作流、串行/多源/条件/命名产物/proxy/组/循环、首次任务预检、输出失败、代际迟到、权限隔离、正常复用和 NOT_RESUMABLE、WF_BUSY、预算/取消及工作台生命周期。真实 RuntimeExecute 与 NodeAgentRunner 协作，未全量 Mock 内部模块。

```bash
pnpm check
pnpm build
DSH_RUNTIME_PACKAGE='/实际官方安装/@deepseek-ai/dsh/package.json' node scripts/dsh-scope-smoke.mjs
```

官方 Scope smoke 分别运行 0.1.6-alpha.2 standingKeyFor() 和 0.2.0-rc.2 acquireScope()，包含公开 Registry/Loader、允许/拒绝工具执行、生命周期、模型配置和恢复钩子；受控 Preset 不代表 shipped standard + 模型 E2E。

真实 Docker 五节点模型 E2E：**NOT RUN**。现场 provider 名称未确认，内部模型和本地 Docker 网络不可从云环境访问。以下在 DSH 容器内或共享其工作区文件系统的机器上执行，模型凭据继续保存在现场 DSH 设置中：

```bash
export DSH_BASE_URL='实际 DSH Web 端点'
export DSH_TEST_PROVIDER='现场确认的准确 provider 标识'
export DSH_TEST_MODEL='qwen3:30b-instruct'
export DSH_TEST_WORKSPACE='/实际挂载工作区/全新的验收目录'
export SALES_CSV='/完整仓库/tests/fixtures/sales_workflow_test.csv'
# 仅在现场需要从 Web 日志读取登录 token 时配置；脚本不输出 token。
export DSH_WEB_LOG='/实际 DSH Web 日志'
node scripts/run-sales-live.mjs --prepare-only
node scripts/run-sales-live.mjs
```

默认 file-node/explicit 复验原有 ctx 工作流。再使用另一全新验收目录测试本次通用输入与命名产物交接：

```bash
export DSH_TEST_WORKSPACE='/实际挂载工作区/另一全新验收目录'
export DSH_TEST_INPUT_MODE=runtime
export DSH_TEST_HANDOFF_POLICY=auto
node scripts/run-sales-live.mjs --prepare-only
node scripts/run-sales-live.mjs
```

runtime 模式不创建 File Node 或 ctx 连线，CSV 使用类型化 workspace 引用，五个命名文件产物通过 source 契约交接。脚本核对真实 child、路由、attempt、节点状态、中间文件及最终报告。prepare-only 只准备配置，不启动模型，也不代表 E2E 通过。期望原始 11 条、重复 1 条、空单元格 2 个、有效 9 条、总额 15900、平均 1766.67。地址和 provider 均由现场环境变量指定，不假设 ollama/openai 或 host.docker.internal。

现场还需检查旧版实际附件上传/问答、官方 shipped standard、Docker sandbox 文件可见性、混合模式和真实长运行 usage。缺少公开文件引用时使用工作台受控上传；不得为验收放宽权限。

实际云环境验收记录：`pnpm check` 完整通过（206 文件、2375 测试），独立 `pnpm build` 通过。新增可测试业务模块覆盖率：53 文件、807 定向测试通过，行覆盖率 97.23%、分支 82.66%；覆盖范围是新增输入/依赖/结果/治理/Token/工具边界/表单与 hook 模块，不将此数字当作全仓覆盖率。官方双版本 Scope smoke 各完成 6 次 Preset 读取、15 次实际工具执行、2 个恢复钩子及 2 次模型路由更新。隔离 DSH Web 真实 HTTP smoke 通过（toolCombos、activeRuns HTTP 200），不含模型调用。Docker 五节点模型 E2E 为 **NOT RUN**。

逐文件清单见 [runtime-inputs-files.md](runtime-inputs-files.md)。A–E 分阶段提交；构建产物随源码提交。
