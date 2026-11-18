const MAX_JSON_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_EMBEDDING_BATCH = 256;
const MAX_TEXT_INPUT_CHARS = 2_000_000;
const MAX_RERANK_DOCUMENTS = 1_000;
const MAX_TTS_INPUT_CHARS = 100_000;
export async function invokeXinferenceEmbeddings(connection, request) {
    if (request.texts.length === 0 || request.texts.length > MAX_EMBEDDING_BATCH) {
        throw new Error(`Xinference embedding 批量大小必须在 1-${MAX_EMBEDDING_BATCH} 之间`);
    }
    assertTextBudget(request.texts, MAX_TEXT_INPUT_CHARS, "embedding");
    const value = await postJson(connection, "v1/embeddings", {
        model: connection.modelUid,
        input: [...request.texts],
        ...(connection.modelUid.includes("jina-embeddings-v4") ? { task: "retrieval" } : {}),
    }, request.signal);
    if (!isRecord(value) || !Array.isArray(value.data))
        throw new Error("Xinference embedding 返回缺少 data");
    const rows = value.data.map((item, position) => {
        if (!isRecord(item) || !Array.isArray(item.embedding))
            throw new Error(`Xinference embedding 第 ${position} 行无效`);
        const embedding = item.embedding.map((entry) => Number(entry));
        if (embedding.length === 0 || embedding.some((entry) => !Number.isFinite(entry))) {
            throw new Error(`Xinference embedding 第 ${position} 行包含无效向量`);
        }
        const index = nonNegativeInteger(item.index) ?? position;
        return { index, embedding };
    }).sort((left, right) => left.index - right.index);
    if (rows.length !== request.texts.length) {
        throw new Error(`Xinference embedding 返回数量不符（期望 ${request.texts.length}，实际 ${rows.length}）`);
    }
    const usage = isRecord(value.usage) ? {
        ...(nonNegativeInteger(value.usage.prompt_tokens) === undefined ? {} : { promptTokens: nonNegativeInteger(value.usage.prompt_tokens) }),
        ...(nonNegativeInteger(value.usage.total_tokens) === undefined ? {} : { totalTokens: nonNegativeInteger(value.usage.total_tokens) }),
    } : undefined;
    return {
        provider: connection.provider,
        model: connection.modelUid,
        embeddings: rows.map((row) => row.embedding),
        ...(usage && Object.keys(usage).length > 0 ? { usage } : {}),
    };
}
export async function invokeXinferenceRerank(connection, request) {
    if (!request.query.trim())
        throw new Error("Xinference rerank 查询不能为空");
    if (request.documents.length > MAX_RERANK_DOCUMENTS) {
        throw new Error(`Xinference rerank 文档数量不能超过 ${MAX_RERANK_DOCUMENTS}`);
    }
    if (request.documents.length === 0)
        return { provider: connection.provider, model: connection.modelUid, results: [] };
    assertTextBudget([request.query, ...request.documents], MAX_TEXT_INPUT_CHARS, "rerank");
    const topN = request.topN === undefined ? undefined : positiveInteger(request.topN, "topN");
    const threshold = request.scoreThreshold;
    if (threshold !== undefined && !Number.isFinite(threshold))
        throw new Error("Xinference rerank scoreThreshold 必须是有限数字");
    const value = await postJson(connection, "v1/rerank", {
        model: connection.modelUid,
        query: request.query,
        documents: [...request.documents],
        return_documents: true,
        ...(topN === undefined ? {} : { top_n: Math.min(topN, request.documents.length) }),
    }, request.signal);
    if (!isRecord(value) || !Array.isArray(value.results))
        throw new Error("Xinference rerank 返回缺少 results");
    const results = value.results.flatMap((item) => {
        if (!isRecord(item))
            return [];
        const index = nonNegativeInteger(item.index);
        const score = Number(item.relevance_score);
        if (index === undefined || index >= request.documents.length || !Number.isFinite(score))
            return [];
        const document = isRecord(item.document) ? item.document.text : item.document;
        const text = typeof document === "string" ? document : request.documents[index];
        if (threshold !== undefined && score < threshold)
            return [];
        return [{ index, text, score }];
    });
    if (value.results.length > 0 && results.length === 0 && threshold === undefined) {
        throw new Error("Xinference rerank 返回的结果条目无效");
    }
    return { provider: connection.provider, model: connection.modelUid, results };
}
export async function invokeXinferenceSpeechToText(connection, request) {
    if (request.audio.byteLength === 0 || request.audio.byteLength > MAX_AUDIO_BYTES) {
        throw new Error(`Xinference speech2text 音频大小必须在 1-${MAX_AUDIO_BYTES} 字节之间`);
    }
    if (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 1)) {
        throw new Error("Xinference speech2text temperature 必须在 0-1 之间");
    }
    const form = new FormData();
    form.append("model", connection.modelUid);
    const audio = Uint8Array.from(request.audio);
    form.append("file", new Blob([audio.buffer], { type: request.contentType ?? "application/octet-stream" }), request.fileName ?? "audio.wav");
    form.append("response_format", "json");
    if (request.language)
        form.append("language", request.language);
    if (request.prompt)
        form.append("prompt", request.prompt);
    if (request.temperature !== undefined)
        form.append("temperature", String(request.temperature));
    const value = await postForm(connection, "v1/audio/transcriptions", form, request.signal);
    if (!isRecord(value) || typeof value.text !== "string")
        throw new Error("Xinference speech2text 返回缺少 text");
    return { provider: connection.provider, model: connection.modelUid, text: value.text };
}
export async function invokeXinferenceTextToSpeech(connection, request) {
    const input = request.input.trim();
    if (!input || input.length > MAX_TTS_INPUT_CHARS) {
        throw new Error(`Xinference tts 文本长度必须在 1-${MAX_TTS_INPUT_CHARS} 之间`);
    }
    const speed = request.speed ?? 1;
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4)
        throw new Error("Xinference tts speed 必须在 0.25-4 之间");
    const responseFormat = request.responseFormat ?? "mp3";
    const pending = await requestWithTimeout(connection, "v1/audio/speech", {
        method: "POST",
        headers: jsonHeaders(connection),
        body: JSON.stringify({
            model: connection.modelUid,
            input,
            voice: request.voice ?? "default",
            response_format: responseFormat,
            speed,
        }),
    }, request.signal);
    try {
        if (!pending.response.ok)
            throw await responseError(pending.response);
        return {
            provider: connection.provider,
            model: connection.modelUid,
            audio: await readBoundedBytes(pending.response, MAX_AUDIO_BYTES),
            contentType: pending.response.headers.get("content-type")?.split(";")[0]?.trim() || audioContentType(responseFormat),
        };
    }
    finally {
        pending.dispose();
    }
}
async function postJson(connection, path, body, signal) {
    const pending = await requestWithTimeout(connection, path, {
        method: "POST",
        headers: jsonHeaders(connection),
        body: JSON.stringify(body),
    }, signal);
    try {
        if (!pending.response.ok)
            throw await responseError(pending.response);
        return await parseJsonResponse(pending.response);
    }
    finally {
        pending.dispose();
    }
}
async function postForm(connection, path, form, signal) {
    const pending = await requestWithTimeout(connection, path, {
        method: "POST",
        headers: authorizationHeaders(connection),
        body: form,
    }, signal);
    try {
        if (!pending.response.ok)
            throw await responseError(pending.response);
        return await parseJsonResponse(pending.response);
    }
    finally {
        pending.dispose();
    }
}
async function requestWithTimeout(connection, path, init, callerSignal) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted)
        controller.abort(callerSignal.reason);
    else
        callerSignal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error("Xinference request timeout")), connection.timeoutMs);
    let disposed = false;
    const dispose = () => {
        if (disposed)
            return;
        disposed = true;
        clearTimeout(timeout);
        callerSignal?.removeEventListener("abort", onAbort);
    };
    try {
        return { response: await fetch(endpointUrl(connection.serverUrl, path), { ...init, signal: controller.signal }), dispose };
    }
    catch (error) {
        dispose();
        throw error;
    }
}
async function parseJsonResponse(response) {
    const text = new TextDecoder().decode(await readBoundedBytes(response, MAX_JSON_RESPONSE_BYTES));
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error(`Xinference 返回无效 JSON（HTTP ${response.status}）`);
    }
}
async function responseError(response) {
    const text = new TextDecoder().decode(await readBoundedBytes(response, MAX_JSON_RESPONSE_BYTES)).slice(0, 2_000);
    let detail = text;
    try {
        const value = JSON.parse(text);
        if (isRecord(value))
            detail = String((isRecord(value.error) ? value.error.message : undefined) ?? value.detail ?? text);
    }
    catch {
        // 非 JSON 错误体保留截断后的原文。
    }
    return new Error(`Xinference 请求失败（HTTP ${response.status}）：${detail}`);
}
async function readBoundedBytes(response, limit) {
    if (!response.body)
        return new Uint8Array();
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done)
                break;
            length += chunk.value.byteLength;
            if (length > limit)
                throw new Error("Xinference response exceeds size limit");
            chunks.push(chunk.value);
        }
    }
    finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}
function endpointUrl(serverUrl, path) {
    const url = new URL(serverUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error("Xinference server_url 仅支持 http/https");
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
    url.search = "";
    url.hash = "";
    return url.toString();
}
function jsonHeaders(connection) {
    return { "Content-Type": "application/json", ...authorizationHeaders(connection) };
}
function authorizationHeaders(connection) {
    return connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {};
}
function assertTextBudget(values, limit, capability) {
    const total = values.reduce((sum, value) => sum + value.length, 0);
    if (total > limit)
        throw new Error(`Xinference ${capability} 文本总长度不能超过 ${limit}`);
}
function positiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(`Xinference rerank ${name} 必须是正整数`);
    return value;
}
function nonNegativeInteger(value) {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}
function audioContentType(format) {
    if (format === "wav")
        return "audio/wav";
    if (format === "flac")
        return "audio/flac";
    if (format === "aac")
        return "audio/aac";
    if (format === "opus")
        return "audio/ogg";
    if (format === "pcm")
        return "audio/L16";
    return "audio/mpeg";
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=xinference-capabilities.js.map