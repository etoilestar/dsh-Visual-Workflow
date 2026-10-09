import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { WfError } from "./errors.js";
function within(root, path) {
    const remainder = relative(root, path);
    return remainder === "" || (!isAbsolute(remainder) && remainder !== ".." && !remainder.startsWith(`..${sep}`));
}
async function canonicalRoot(path) {
    if (!path || !isAbsolute(path))
        return undefined;
    try {
        return await realpath(path);
    }
    catch {
        return undefined;
    }
}
/** 外部文件只认官方附件能力解析的会话授权，不接受调用方自行声明授权。 */
export async function authorizedInputPath(path, cwd, managedRoot, authorizedFiles = []) {
    let canonical;
    try {
        canonical = await realpath(path);
        await access(canonical, constants.R_OK);
        if (!(await stat(canonical)).isFile())
            throw new Error("not a file");
    }
    catch {
        throw Object.assign(new WfError(`输入文件不存在、不可读或不是普通文件：${path}`, "WF_INPUT_FILE_UNAVAILABLE"), { phase: "node_input", retryable: false });
    }
    const roots = await Promise.all([canonicalRoot(cwd), canonicalRoot(managedRoot ? join(managedRoot, "data", "files") : undefined)]);
    if (roots.some((root) => root && within(root, canonical)))
        return canonical;
    const external = await Promise.all(authorizedFiles.map(canonicalRoot));
    if (external.includes(canonical))
        return canonical;
    throw Object.assign(new WfError(`输入文件超出会话工作区和受管文件范围：${path}；请通过 DSH 附件授权该文件或将其放入工作区`, "WF_INPUT_FILE_UNAUTHORIZED"), { phase: "node_input", retryable: false });
}
/** 新建输出按最近存在的祖先解析；已有软链接必须仍落在工作区内。 */
export async function authorizedOutputPath(path, cwd) {
    const root = await canonicalRoot(cwd);
    if (!root)
        throw Object.assign(new WfError("声明文件产物需要实际会话工作目录", "WF_INPUT_PATH_UNRESOLVED"), { phase: "node_input", retryable: false });
    let cursor = path;
    const missing = [];
    while (true) {
        try {
            const canonical = join(await realpath(cursor), ...missing.reverse());
            if (!within(root, canonical))
                throw new WfError(`输出路径超出会话工作区：${path}`, "WF_OUTPUT_PATH_UNWRITABLE");
            return canonical;
        }
        catch (error) {
            if (error.code !== "ENOENT" || dirname(cursor) === cursor)
                throw error;
            // 断开的软链接不能当作可新建的普通路径，否则后续创建目标后会越界。
            try {
                if ((await lstat(cursor)).isSymbolicLink())
                    throw new WfError(`输出路径包含无法解析的软链接：${path}`, "WF_OUTPUT_PATH_UNWRITABLE");
            }
            catch (linkError) {
                if (linkError.code !== "ENOENT")
                    throw linkError;
            }
            missing.push(basename(cursor));
            cursor = dirname(cursor);
        }
    }
}
/** 元数据与内容联合判定本次写入；不将文件存在或回复中的路径视为执行证据。 */
export async function outputSignature(path) {
    try {
        const info = await stat(path, { bigint: true });
        if (!info.isFile())
            throw new WfError(`声明产物不是普通文件：${path}`, "WF_OUTPUT_PATH_UNWRITABLE");
        const digest = createHash("sha256");
        for await (const chunk of createReadStream(path))
            digest.update(chunk);
        return { size: Number(info.size), signature: JSON.stringify([path, String(info.dev), String(info.ino), String(info.size), String(info.mtimeNs), String(info.ctimeNs), digest.digest("hex")]) };
    }
    catch (error) {
        if (error.code === "ENOENT")
            return null;
        throw error;
    }
}
//# sourceMappingURL=execution-file-access.js.map