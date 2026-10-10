# PR #9 逐文件修改索引

A–D 分阶段提交运行时，E 接入工作台与验收。以下相对路径均在本仓库。lib 是构建生成物，与对应源码同步，不含手工改动。

| 文件 | 修改 |
| --- | --- |
| `docs/node-recovery.md` | 区分既有销售 ctx 验收与通用运行输入 |
| `docs/runtime-inputs-files.md` | 逐文件变更索引 |
| `docs/runtime-inputs.md` | 设计、迁移、授权、契约、错误与现场命令 |
| `scripts/run-sales-live.mjs` | 可配置 file-node/runtime 模式、交接策略和现场模型验收 |
| `src/client/components/runtime-inputs-dialog.tsx` | props 驱动的类型化输入交互 |
| `src/client/hooks/use-runtime-inputs.ts` | 运行/恢复/待派发输入草稿、上传、冲突与生命周期 |
| `src/client/hooks/useDocumentActions.ts` | 模板/资产实例化与另存保留静态定义 |
| `src/client/hooks/useEditorActions.ts` | 资产态保存传递静态 runtime |
| `src/client/hooks/useRunActions.ts` | 历史恢复前输入选择及响应归属保护 |
| `src/client/hooks/useRunControl.ts` | 启动前配置及迟到启动/停止响应归属保护 |
| `src/client/hooks/useServiceControl.ts` | 模板服务实例化保留静态定义 |
| `src/client/hooks/useWorkflows.ts` | 模板实例化保留静态定义 |
| `src/client/i18n.ts` | 中英文输入交互与冲突词典 |
| `src/client/lib/remote.ts` | 网络失败保留结构化字段诊断 |
| `src/client/lib/runtime-input-form.ts` | 纯输入表单值与必需槽解析 |
| `src/client/studio/Studio.tsx` | 输入 hook、对话框和运行中补充入口装配 |
| `src/client/styles/overlays.ts` | 集中输入交互样式，复用设计 token |
| `src/host/agent/agents-host.ts` | 公开附件引用、取消与 authoritative Token 计量适配 |
| `src/host/agent/token-accounting.ts` | 纯函数计量官方会话 usage，明确未知计数 |
| `src/host/api/assets.ts` | 资产晋升、保存时传递并校验静态 runtime |
| `src/host/api/boundary.ts` | 最小输入与静态契约能力缝 |
| `src/host/api/routes.ts` | 输入 API 路由和安全字段诊断响应 |
| `src/host/api/runs.ts` | 启动/恢复参数及需求、受控绑定薄端点 |
| `src/host/api/workflows.ts` | 模板更新传播静态 runtime |
| `src/host/assets/index.ts` | 资产输入校验与事务登记 runtime |
| `src/host/assets/schema.ts` | nullable runtime_json 的幂等旧库迁移 |
| `src/host/assets/workflow-assets.ts` | 静态定义/节点执行契约的存储、比较与版本重建 |
| `src/host/events.d.ts` | 公开工具事件最小消费声明 |
| `src/host/graph/execution-contract.ts` | 输入、命名输出与完成契约的纯形状检查 |
| `src/host/graph/index.ts` | 公开纯契约解析入口 |
| `src/host/graph/runtime-contract.ts` | v1 输入需求、schema 子集与预算校验 |
| `src/host/orchestrator/dependency-resolution.ts` | 统一控制/数据解析、条件选择、代际与歧义诊断 |
| `src/host/orchestrator/execution-inputs.ts` | 类型化文件预检、命名产物基线/签名验证 |
| `src/host/orchestrator/graph-facts.ts` | 上下文事实使用统一依赖结果 |
| `src/host/orchestrator/node-results.ts` | 文本/JSON/schema 验证与成功/失败/取消结果 |
| `src/host/orchestrator/resume.ts` | 复制合法输入、策略、预算、错误与消费历史 |
| `src/host/orchestrator/run-entry.ts` | 输入绑定/结算/终止并发窗口及预算计量字段 |
| `src/host/orchestrator/runtime-base.ts` | 类型化 hybrid 输入/输出验证与 trace 维护 |
| `src/host/orchestrator/runtime-execute.ts` | 首次输入预检、预算、组/proxy 互斥与失败收尾 |
| `src/host/orchestrator/runtime-governance.ts` | 公开父工具治理、有限失败和安全预算终止 |
| `src/host/orchestrator/runtime-input-manager.ts` | 授权、需求发现、严格持久化与版本绑定 |
| `src/host/orchestrator/runtime-inputs.ts` | 类型化值/引用/参数归一化与授权 |
| `src/host/orchestrator/runtime-launch.ts` | 启动/恢复输入验证与锁登记前的完整预检 |
| `src/host/orchestrator/runtime-lifecycle.ts` | 取消/失败结果、幂等安全终止与资源释放 |
| `src/host/orchestrator/runtime-observe.ts` | 冻结契约验证、取消/迟到事件防护、原子结算 |
| `src/host/orchestrator/runtime.ts` | 接入输入管理与治理继承层 |
| `src/host/orchestrator/seams.ts` | 模型调用输入、官方引用与消费计量能力缝 |
| `src/host/orchestrator/task-blocks.ts` | 首次 USER 任务包含完整 typed invocation/契约 |
| `src/host/orchestrator/watchdog.ts` | 时间/Token 预算与未知子代理存活保护 |
| `src/host/prompts/orchestration.ts` | 去除业务特化，说明通用输入/交接/收尾规则 |
| `src/host/shared/asset-types.ts` | 工作流资产静态 runtime 类型 |
| `src/host/shared/graph-model.ts` | 可选 v1 静态 runtime 和节点输入/输出契约 |
| `src/host/shared/protocol.ts` | 输入需求与绑定共享端点名 |
| `src/host/shared/run-types.ts` | 运行快照、节点结果、错误代际和消费计量 |
| `src/host/shared/runtime-types.ts` | RuntimeInputs、NodeInvocation/Result、schema/budget/trace 纯类型 |
| `src/host/shared/service-types.ts` | 服务静态 runtime 类型 |
| `src/host/storage/flow-store.ts` | 服务保存往返静态 runtime |
| `src/host/storage/service-view.ts` | 服务到工作流视图保留 runtime |
| `src/host/tools/index.ts` | 公开管线边界导出 |
| `src/host/tools/infrastructure/parent-tool-boundary.ts` | 公开 guard/pre-execute/result 管线装配与清理 |
| `src/host/tools/infrastructure/workflow-tool-error.ts` | 真实模型工具回复保留 WF code/字段诊断 |
| `src/host/tools/wf-finish/tool.ts` | selectedEdgeIds 共享参数及稳定 WF code/字段诊断的真实工具回复 |
| `src/host/tools/wf-run-node-wait/tool.ts` | selectedEdgeIds 共享参数及稳定 WF code/字段诊断的真实工具回复 |
| `src/host/tools/wf-run-node/tool.ts` | selectedEdgeIds 共享参数及稳定 WF code/字段诊断的真实工具回复 |
| `src/host/visual-workflow-host.ts` | 输入/授权能力及父工具边界生命周期装配 |
| `tests/client/hooks/use-runtime-inputs.test.tsx` | 真实行为回归：use-runtime-inputs |
| `tests/client/lib/remote.test.ts` | 真实行为回归：remote |
| `tests/client/lib/runtime-input-form.test.ts` | 真实行为回归：runtime-input-form |
| `tests/client/studio/Studio.test.tsx` | 真实行为回归：Studio |
| `tests/host/agent/token-accounting.test.ts` | 真实行为回归：token-accounting |
| `tests/host/assets/db.test.ts` | 真实行为回归：db |
| `tests/host/assets/workflow-assets.test.ts` | 真实行为回归：workflow-assets |
| `tests/host/graph/runtime-contract.test.ts` | 真实行为回归：runtime-contract |
| `tests/host/orchestrator/dependency-resolution.test.ts` | 真实行为回归：dependency-resolution |
| `tests/host/orchestrator/execution-inputs.test.ts` | 真实行为回归：execution-inputs |
| `tests/host/orchestrator/fixtures/harness.ts` | 共享最小受控测试基础设施，新增输入 invocation/计量缝 |
| `tests/host/orchestrator/node-results.test.ts` | 真实行为回归：node-results |
| `tests/host/orchestrator/runtime-contract-dispatch.test.ts` | 真实行为回归：runtime-contract-dispatch |
| `tests/host/orchestrator/runtime-execute.test.ts` | 真实行为回归：runtime-execute |
| `tests/host/orchestrator/runtime-governance.test.ts` | 真实行为回归：runtime-governance |
| `tests/host/orchestrator/runtime-input-manager.test.ts` | 真实行为回归：runtime-input-manager |
| `tests/host/orchestrator/runtime-inputs.test.ts` | 真实行为回归：runtime-inputs |
| `tests/host/orchestrator/runtime-lifecycle.test.ts` | 真实行为回归：runtime-lifecycle |
| `tests/host/orchestrator/watchdog.test.ts` | 真实行为回归：watchdog |
| `tests/host/tools/infrastructure/parent-tool-boundary.test.ts` | 真实行为回归：parent-tool-boundary |
| `tests/host/tools/infrastructure/workflow-tool-error.test.ts` | 真实行为回归：workflow-tool-error |
| `tests/host/tools/wf-run-node-wait/tool.test.ts` | 真实行为回归：tool |
| `tests/host/tools/wf-run-node/tool.test.ts` | 真实行为回归：tool |
| `tests/integration/node-recovery.test.ts` | 真实行为回归：node-recovery |
| `tests/integration/run-sales-live.test.ts` | 真实行为回归：run-sales-live |

生成文件：`lib/*.js`、相应 sourcemap、`lib/types/**` 由 `pnpm build` 同步；完整生成文件列表见 PR Files changed。未修改依赖声明、锁文件或官方 DSH 源码。

测试结果与覆盖范围见 PR 描述及 [runtime-inputs.md](runtime-inputs.md)；真实模型验收明确为 NOT RUN。
