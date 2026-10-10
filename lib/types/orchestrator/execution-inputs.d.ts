import type { RoleNode, WorkflowDocument } from '../shared/graph-model.js';
import type { RunSnapshot } from '../shared/types.js';
export declare function executionOf(node: RoleNode): import("../shared/graph-model.js").NodeExecutionContract;
export declare function absoluteInputPath(path: string, cwd?: string): string;
/** 运行绑定独立于图文档；未完成消费者需要的文件才参与启动/恢复预检。 */
export declare function prepareRunInputs(flow: WorkflowDocument, snapshot: RunSnapshot, raw?: unknown, managedRoot?: string, authorizedFiles?: readonly string[]): Promise<void>;
export declare function preflightNodeInputs(flow: WorkflowDocument, node: RoleNode, snapshot: RunSnapshot, managedRoot?: string, authorizedFiles?: readonly string[]): Promise<void>;
/** 完成事件的产物检查只认文件系统事实，不根据最终回复中的路径判成功。 */
export declare function verifyNodeArtifacts(node: RoleNode, snapshot: RunSnapshot, now: number): Promise<void>;
