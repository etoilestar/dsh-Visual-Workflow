# Dify 工作流导入

1.4.0 支持从工作台顶部「导入」按钮选择 Dify 导出的 `.yml` / `.yaml` 文件。导入先创建全局工作流模板；用户从模板创建实例、核对模型并填写运行输入后，可以直接运行兼容子集。格式识别同时使用文件扩展名和解析后的 `workflow.graph`，不依赖 YAML 的具体排版。

## 页面迁移 Dify 插件包

安装 `dsh-dify-migrator` 0.4.0 并确保 `dsh-dify-migrator` 位于 Host 的 `PATH` 后，点击工作台顶部“迁移 Dify 插件”：

- 可一次多选多个 `.difypkg`；
- 可上传一个包含多个 `.difypkg` 的 `.zip`；
- Host 在后台以固定参数完成扫描、转换和安装，不执行用户提供的命令；
- 完成后自动刷新统一 DSH 工具和模型目录，无需逐节点重新绑定；
- 不受支持的能力、重复包和失败包保留在迁移汇总中，不会伪装成安装成功。

默认命令可通过 Host 配置 `difyMigratorCommand` 改为迁移器的绝对路径。单个页面上传文件限制为 40MB；需要迁移更大的可信包时，仍可使用迁移器 CLI 直接安装到同一 `dataDir`。

## 使用步骤

1. 批量导出需要的 Dify Tool 或 Xinference Model Provider `.difypkg`，在工作台点击“迁移 Dify 插件”，多选包或上传批量 ZIP；也可以使用 `dsh-dify-migrator convert ... --install <DSH-data-dir>` 从命令行安装。
2. 导入 Dify YAML，打开新生成的工作流模板并查看兼容状态。Tool 节点按 `author/plugin/tool` 自动绑定；`langgenius/xinference/xinference` 等 Xinference provider 自动映射到迁移后的原生 DSH 模型路由。
3. 对 `review-required` 模板核对每个 LLM/Agent 的 provider 与 model，并确认目标 Host 已配置 Xinference 凭据；其他模型提供商仍需重新选择。
4. 从模板创建工作流实例；导入来源和兼容报告会随实例保留。
5. 点击“配置并运行”，填写由 Dify Start 变量转换出的工作流输入；同一个变量只需填写一次，会自动分发给所有引用节点和工具参数。
6. Runtime 以确定性 DAG 顺序执行节点；运行完成后，历史摘要按导入的 Answer/End 输出绑定返回结果。

`blocked` 模板可以查看和编辑，但运行前会由 Host 护栏拒绝，不会把占位 Agent 当作已适配能力执行。

## 转换边界

- `start`、`answer/end` 转换为原生启动和结束节点。
- `llm`、`agent` 转换为 Harness Agent 节点，保留模型身份、Prompt 和职责信息；Xinference provider 转换为 `dsh_model__author__plugin__xinference` 原生路由，支持文本对话、SSE 流式输出和工具调用；Start 引用转换为运行输入，上游 Agent 引用转换为显式上下文依赖。
- 单一引用 `answer` 与由命名 `node.port` 选择器组成的 `end` 会保存为原生受控输出绑定；不执行任意表达式。
- `tool` 转换为原生 DSH `ToolNode`。工具参数中的 `{{#node.port#}}` 由 Runtime 受控解析，实际执行走统一 DSH 工具注册表；Dify worker 只存在于迁移包内部，不建立第二套用户可见插件目录。
- 知识检索、HTTP、代码、模板转换、条件、循环、迭代和未知节点仍会保留为可见占位，兼容状态为 `blocked`，不能直接运行。
- Dify Flow 连线转换为原生 Flow 连线；固定图使用 `executionMode: dag`，不再由父模型临场猜测执行顺序。

转换器不会声称两种平台的节点具有天然等价语义。v1.4 的可运行范围为 Start、LLM/Agent、已安装的 Dify Tool、Xinference 迁移包，以及受控 Answer/End 输出绑定。Xinference LLM 进入 DSH 官方模型路由；text-embedding 接入 Visual 的向量索引引擎；rerank、speech2text 和 TTS 由 `VisualWorkflowHost.migratedModels` 提供有界、可取消的调用能力。视觉输入和其他模型提供商仍等待专用适配器。

## 安全规则

- API Key、Authorization、Cookie、密码、Token 和 Dify credential 引用在解析阶段移除。
- 兼容报告只保存依赖身份，不保存密钥。
- 外部模型、知识库和 HTTP 目标不会自动启用。工具凭据不会从 Dify 复制，按迁移包 id 写入 Host 私有的 `<dataDir>/migrated-tool-credentials.json`；Xinference 凭据写入 `<dataDir>/migrated-model-credentials.json`。修改后重载 Host，这些文件不得提交到仓库。

Xinference 凭据示例：

```json
{
  "dsh_dify__langgenius__xinference": {
    "server_url": "http://127.0.0.1:9997",
    "api_key": "按需填写",
    "invoke_timeout": "60",
    "models": {
      "llm": { "model_uid": "qwen-chat" },
      "text-embedding": { "model_uid": "bge-m3" },
      "rerank": { "model_uid": "bge-reranker-v2-m3" },
      "speech2text": { "model_uid": "whisper-large-v3" },
      "tts": { "model_uid": "CosyVoice-300M" }
    }
  }
}
```

`server_url` 填 Xinference 服务根地址，不要附加 `/v1`。不同类型必须配置各自真实部署的 `model_uid`，共享根级 `server_url`、`api_key` 与超时。旧版根级 `model_uid` 仍作为 LLM 配置读取。适配器分别调用 `/v1/chat/completions`、`/v1/embeddings`、`/v1/rerank`、`/v1/audio/transcriptions` 与 `/v1/audio/speech`。

## 身份与安装目录

- Dify 包 `author/plugin` 转换为 DSH 包 `dsh_dify__author__plugin`。
- Dify 工具 `tool` 转换为 DSH 工具 `dsh_migrated__author__plugin__tool`。
- Dify Xinference provider 转换为 DSH provider `dsh_model__author__plugin__xinference`。
- Tool 安装目录为 `<dataDir>/migrated-tools/<package-id>@<version>`；Model 安装目录为 `<dataDir>/migrated-models/<package-id>@<version>`。
- DSL 导入与包转换使用同一规范化算法，因此安装包存在时自动绑定；Tool 不存在时运行前返回 `WF_TOOL_NOT_INSTALLED`，模型 provider 未注册或未配置时由 DSH 模型目录/路由明确拒绝，不会悄悄改用占位实现。

## 兼容状态

| 状态 | 含义 | 后续动作 |
|---|---|---|
| `ready` | 未发现结构或适配问题 | 打开模板复核后创建实例 |
| `review-required` | 存在非阻断兼容问题 | 核对/重绑模型并核对节点 Prompt、输入 |
| `blocked` | 存在不支持节点或图错误 | 完成适配或修改拓扑后再运行 |

模板的 `sourceImport` 字段保存来源版本、问题清单和依赖清单，后续可用于旧工作流优化与差异评估。
