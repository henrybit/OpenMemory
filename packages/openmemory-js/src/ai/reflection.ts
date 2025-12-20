
import { q } from "../core/db";
import { env } from "../core/cfg";
import { p } from "../utils";

/**
 * 调用 LLM 进行文本生成
 */
async function callLLM(
    prompt: string,
    systemPrompt?: string
): Promise<string> {
    // 优先使用 OpenAI
    if (env.openai_key) {
        return await callOpenAI(prompt, systemPrompt);
    }
    // 其次使用 Gemini
    if (env.gemini_key) {
        return await callGemini(prompt, systemPrompt);
    }
    // 最后尝试 Ollama
    if (env.ollama_url) {
        return await callOllama(prompt, systemPrompt);
    }
    throw new Error(
        "No LLM provider configured. Please set OPENAI_API_KEY, GEMINI_API_KEY, or OLLAMA_URL"
    );
}

/**
 * 调用 OpenAI Chat Completion API
 */
async function callOpenAI(
    prompt: string,
    systemPrompt?: string
): Promise<string> {
    if (!env.openai_key) {
        throw new Error("OpenAI key missing");
    }
    const model = env.openai_chat_model || "gpt-4o-mini";
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
    console.log("[REFLECTION] Calling OpenAI with api_url", env.openai_base_url);
    const response = await fetch(
        `${env.openai_base_url.replace(/\/$/, "")}/chat/completions`,
        {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${env.openai_key}`,
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0.7,
                max_tokens: 2000,
            }),
        }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as any;
    return data.choices[0]?.message?.content || "";
}

/**
 * 调用 Gemini API
 */
async function callGemini(
    prompt: string,
    systemPrompt?: string
): Promise<string> {
    if (!env.gemini_key) {
        throw new Error("Gemini key missing");
    }
    const fullPrompt = systemPrompt
        ? `${systemPrompt}\n\n${prompt}`
        : prompt;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${env.gemini_key}`,
        {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [{ text: fullPrompt }],
                    },
                ],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 2000,
                },
            }),
        }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as any;
    return (
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        "No response from Gemini"
    );
}

/**
 * 调用 Ollama API
 */
async function callOllama(
    prompt: string,
    systemPrompt?: string
): Promise<string> {
    const model = "llama3.2"; // 默认模型，可以根据需要调整
    const fullPrompt = systemPrompt
        ? `${systemPrompt}\n\n${prompt}`
        : prompt;

    const response = await fetch(
        `${env.ollama_url.replace(/\/$/, "")}/api/generate`,
        {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model,
                prompt: fullPrompt,
                stream: false,
                options: {
                    temperature: 0.7,
                    num_predict: 2000,
                },
            }),
        }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as any;
    return data.response || "";
}

/**
 * 对一批 memory 进行反思，抽象出更高阶的信息体集合
 * @param memory_list Memory ID 列表
 * @returns 抽象后的高阶信息体集合（字符串数组）
 */
export async function thinking(memory_list: string[]): Promise<string[]> {
    if (!memory_list || memory_list.length === 0) {
        return [];
    }

    // 获取所有 memory 的完整信息
    const memories = await Promise.all(
        memory_list.map(async (id) => {
            const mem = await q.get_mem.get(id);
            if (!mem) {
                return null;
            }
            return {
                id: mem.id,
                content: mem.content,
                primary_sector: mem.primary_sector,
                tags: p(mem.tags || "[]") as string[],
                metadata: p(mem.meta || "{}") as Record<string, unknown>,
                created_at: mem.created_at,
                salience: mem.salience,
            };
        })
    );

    // 过滤掉不存在的 memory
    const validMemories = memories.filter((m) => m !== null) as Array<{
        id: string;
        content: string;
        primary_sector: string;
        tags: string[];
        metadata: Record<string, unknown>;
        created_at: number;
        salience: number;
    }>;

    if (validMemories.length === 0) {
        return [];
    }

    // 限制每个 memory 内容的长度，避免超过 token 限制
    const MAX_MEMORY_LENGTH = 500; // 每个 memory 最多 500 字符
    const truncateContent = (content: string, maxLength: number): string => {
        if (content.length <= maxLength) return content;
        return content.substring(0, maxLength - 3) + "...";
    };

    // 构建 prompt，让 LLM 分析这些 memory 并抽象出更高阶的信息
    // 按 salience 排序，优先分析重要的 memory
    const sortedMemories = [...validMemories].sort(
        (a, b) => b.salience - a.salience
    );

    const memoryTexts = sortedMemories
        .map(
            (m, idx) =>
                `Memory ${idx + 1} [${m.primary_sector}, salience=${m.salience.toFixed(2)}]:\n${truncateContent(m.content, MAX_MEMORY_LENGTH)}${m.tags.length > 0 ? `\nTags: ${m.tags.join(", ")}` : ""}`
        )
        .join("\n\n");

    const systemPrompt = `You are an advanced memory reflection system. Your task is to analyze a collection of memories and extract higher-order insights, patterns, principles, or abstract concepts from them.

Guidelines:
1. Look for common themes, patterns, or recurring concepts across the memories
2. Identify relationships, connections, or dependencies between different memories
3. Extract abstract principles, insights, or learnings that generalize beyond individual memories
4. Consider temporal patterns, cause-effect relationships, or evolutionary trends
5. Each insight should be a concise, high-level abstraction (1-3 sentences)
6. Focus on actionable insights, principles, or patterns that could inform future behavior or understanding
7. Return each insight as a separate item in a structured format`;

    const userPrompt = `Analyze the following ${validMemories.length} memories and extract higher-order insights, patterns, or abstract concepts:

${memoryTexts}

Please provide 3-8 high-level insights or abstract concepts. Format your response as a JSON array of strings, where each string is a distinct insight. For example:
["Insight 1: ...", "Insight 2: ...", "Insight 3: ..."]

If you cannot extract meaningful insights, return an empty array [].`;

    try {
        const response = await callLLM(userPrompt, systemPrompt);
        
        // 尝试解析 JSON 响应
        let insights: string[] = [];
        try {
            // 尝试提取 JSON 数组
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                insights = JSON.parse(jsonMatch[0]);
            } else {
                // 如果不是 JSON 格式，尝试按行分割
                insights = response
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0 && !line.match(/^[\[\],\s]*$/))
                    .map((line) => line.replace(/^[-*•]\s*/, "").replace(/^\d+\.\s*/, ""));
            }
        } catch (parseError) {
            // 如果解析失败，将整个响应作为单个 insight
            console.warn("[REFLECTION] Failed to parse LLM response as JSON, using raw response");
            insights = [response.trim()].filter((s) => s.length > 0);
        }

        // 过滤和清理 insights
        insights = insights
            .filter((insight) => insight && insight.length > 10) // 过滤太短的
            .map((insight) => insight.trim())
            .filter((insight, idx, arr) => arr.indexOf(insight) === idx); // 去重

        return insights.length > 0 ? insights : [];
    } catch (error) {
        console.error("[REFLECTION] Error during LLM reflection:", error);
        throw new Error(
            `Failed to perform reflection: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}