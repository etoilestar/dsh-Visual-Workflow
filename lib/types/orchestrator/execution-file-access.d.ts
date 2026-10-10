/** 外部文件只认官方附件能力解析的会话授权，不接受调用方自行声明授权。 */
export declare function authorizedInputPath(path: string, cwd?: string, managedRoot?: string, authorizedFiles?: readonly string[]): Promise<string>;
/** 新建输出按最近存在的祖先解析；已有软链接必须仍落在工作区内。 */
export declare function authorizedOutputPath(path: string, cwd?: string): Promise<string>;
/** 元数据与内容联合判定本次写入；不将文件存在或回复中的路径视为执行证据。 */
export declare function outputSignature(path: string): Promise<{
    size: number;
    signature: string;
} | null>;
