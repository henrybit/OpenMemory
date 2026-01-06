import { q, run_async, all_async, get_async } from "../../core/db";
import { now, rid, j, p } from "../../utils";
import { thinking } from "../../ai/reflection";
import { env } from "../../core/cfg";
import { embedForSector, vectorToBuffer, bufferToVector, cosineSimilarity } from "../../memory/embed";

/**
 * 反思任务状态
 */
type ReflectionStatus = "pending" | "running" | "completed" | "failed";

/**
 * 反思任务接口
 */
interface ReflectionTask {
    id: string;
    user_id: string;
    status: ReflectionStatus;
    memory_ids: string[];
    insights: string[];
    time_range_start: number | null;
    time_range_end: number | null;
    created_at: number;
    updated_at: number;
    completed_at: number | null;
    error: string | null;
}

/**
 * 初始化反思任务表和反思记录表
 */
async function initReflectionTable() {
    const is_pg = env.metadata_backend === "postgres";
    const sc = process.env.OM_PG_SCHEMA || "public";
    const task_table_name = is_pg
        ? `"${sc}"."openmemory_reflections_task"`
        : "reflections_task";
    const reflection_table_name = is_pg
        ? `"${sc}"."openmemory_reflections"`
        : "reflections";

    // 迁移旧表（如果存在）
    if (is_pg) {
        // PostgreSQL: 检查旧表是否存在，如果存在则重命名
        try {
            const old_table_check = await get_async(
                `SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = $1 
                    AND table_name = 'openmemory_reflections'
                ) as exists`,
                [sc]
            );
            if (old_table_check?.exists) {
                // 检查新表是否已存在
                const new_table_check = await get_async(
                    `SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = $1 
                        AND table_name = 'openmemory_reflections_task'
                    ) as exists`,
                    [sc]
                );
                if (!new_table_check?.exists) {
                    await run_async(
                        `ALTER TABLE "${sc}"."openmemory_reflections" RENAME TO "openmemory_reflections_task"`
                    );
                    console.log("[REFLECTION] Migrated table: openmemory_reflections -> openmemory_reflections_task");
                }
            }
        } catch (e) {
            // 如果出错，继续创建新表
            console.warn("[REFLECTION] Migration check failed, continuing:", e);
        }
    } else {
        // SQLite: 检查旧表是否存在，如果存在则重命名
        try {
            const old_table_check = await get_async(
                `SELECT name FROM sqlite_master WHERE type='table' AND name='reflections'`
            );
            if (old_table_check) {
                const new_table_check = await get_async(
                    `SELECT name FROM sqlite_master WHERE type='table' AND name='reflections_task'`
                );
                if (!new_table_check) {
                    await run_async(`ALTER TABLE reflections RENAME TO reflections_task`);
                    console.log("[REFLECTION] Migrated table: reflections -> reflections_task");
                }
            }
        } catch (e) {
            console.warn("[REFLECTION] Migration check failed, continuing:", e);
        }
    }

    // 创建反思任务表
    if (is_pg) {
        await run_async(
            `create table if not exists ${task_table_name}(
                id text primary key,
                user_id text not null,
                status text not null default 'pending',
                memory_ids text not null,
                insights text,
                time_range_start bigint,
                time_range_end bigint,
                created_at bigint not null,
                updated_at bigint not null,
                completed_at bigint,
                error text
            )`
        );
        await run_async(
            `create index if not exists idx_reflections_task_user on ${task_table_name}(user_id)`
        );
        await run_async(
            `create index if not exists idx_reflections_task_status on ${task_table_name}(status)`
        );
        await run_async(
            `create index if not exists idx_reflections_task_created on ${task_table_name}(created_at)`
        );
    } else {
        await run_async(
            `create table if not exists ${task_table_name}(
                id text primary key,
                user_id text not null,
                status text not null default 'pending',
                memory_ids text not null,
                insights text,
                time_range_start integer,
                time_range_end integer,
                created_at integer not null,
                updated_at integer not null,
                completed_at integer,
                error text
            )`
        );
        await run_async(
            `create index if not exists idx_reflections_task_user on ${task_table_name}(user_id)`
        );
        await run_async(
            `create index if not exists idx_reflections_task_status on ${task_table_name}(status)`
        );
        await run_async(
            `create index if not exists idx_reflections_task_created on ${task_table_name}(created_at)`
        );
    }

    // 创建反思记录表（存储每个 insight）
    if (is_pg) {
        await run_async(
            `create table if not exists ${reflection_table_name}(
                id text primary key,
                user_id text not null,
                task_id text,
                content text not null,
                created_at bigint not null,
                vector bytea not null,
                vector_dim integer not null
            )`
        );
        await run_async(
            `create index if not exists idx_reflections_user on ${reflection_table_name}(user_id)`
        );
        await run_async(
            `create index if not exists idx_reflections_task_id on ${reflection_table_name}(task_id)`
        );
        await run_async(
            `create index if not exists idx_reflections_created on ${reflection_table_name}(created_at)`
        );
    } else {
        await run_async(
            `create table if not exists ${reflection_table_name}(
                id text primary key,
                user_id text not null,
                task_id text,
                content text not null,
                created_at integer not null,
                vector blob not null,
                vector_dim integer not null
            )`
        );
        await run_async(
            `create index if not exists idx_reflections_user on ${reflection_table_name}(user_id)`
        );
        await run_async(
            `create index if not exists idx_reflections_task_id on ${reflection_table_name}(task_id)`
        );
        await run_async(
            `create index if not exists idx_reflections_created on ${reflection_table_name}(created_at)`
        );
    }
}

// 初始化表（在模块加载时执行一次）
let tableInitialized = false;
const ensureTableInitialized = async () => {
    if (!tableInitialized) {
        await initReflectionTable();
        tableInitialized = true;
    }
};

/**
 * 获取任务表名
 */
function getTaskTableName(): string {
    const is_pg = env.metadata_backend === "postgres";
    const sc = process.env.OM_PG_SCHEMA || "public";
    return is_pg ? `"${sc}"."openmemory_reflections_task"` : "reflections_task";
}

/**
 * 获取反思记录表名
 */
function getReflectionTableName(): string {
    const is_pg = env.metadata_backend === "postgres";
    const sc = process.env.OM_PG_SCHEMA || "public";
    return is_pg ? `"${sc}"."openmemory_reflections"` : "reflections";
}

/**
 * 根据数据库类型获取参数占位符
 */
function getPlaceholder(index: number): string {
    const is_pg = env.metadata_backend === "postgres";
    return is_pg ? `$${index}` : "?";
}

/**
 * 构建 SQL 语句，根据数据库类型使用正确的占位符
 */
function buildSQL(template: string): string {
    const is_pg = env.metadata_backend === "postgres";
    if (is_pg) {
        // PostgreSQL 使用 $1, $2, $3...
        return template;
    } else {
        // SQLite 使用 ?, ?, ?...
        let placeholderIndex = 1;
        return template.replace(/\$\d+/g, () => {
            return "?";
        });
    }
}

/**
 * 启动某个用户下的最近一定时间范围的反思
 * POST /reflection/start
 * Body: { user_id: string, time_range_hours?: number }
 */
async function startReflection(
    user_id: string,
    time_range_hours: number = 24
): Promise<ReflectionTask> {
    await ensureTableInitialized();
    const table = getTaskTableName();

    // 计算时间范围
    const now_ts = now();
    const time_range_end = now_ts;
    const time_range_start = now_ts - time_range_hours * 60 * 60 * 1000;

    // 获取该用户在时间范围内的所有 memory
    const all_mems = await q.all_mem_by_user.all(user_id, 10000, 0);
    const filtered_mems = all_mems.filter(
        (m: any) =>
            m.created_at >= time_range_start && m.created_at <= time_range_end
    );

    if (filtered_mems.length === 0) {
        throw new Error(
            `No memories found for user ${user_id} in the last ${time_range_hours} hours`
        );
    }

    // 创建反思任务
    const task_id = rid();
    const memory_ids = filtered_mems.map((m: any) => m.id);

    await run_async(
        buildSQL(
            `insert into ${table}(id, user_id, status, memory_ids, time_range_start, time_range_end, created_at, updated_at)
         values($1, $2, $3, $4, $5, $6, $7, $8)`
        ),
        [
            task_id,
            user_id,
            "pending",
            j(memory_ids),
            time_range_start,
            time_range_end,
            now_ts,
            now_ts,
        ]
    );

    // 异步执行反思任务
    executeReflectionTask(task_id).catch((err) => {
        console.error(`[REFLECTION] Task ${task_id} failed:`, err);
    });

    return {
        id: task_id,
        user_id,
        status: "pending",
        memory_ids,
        insights: [],
        time_range_start,
        time_range_end,
        created_at: now_ts,
        updated_at: now_ts,
        completed_at: null,
        error: null,
    };
}

/**
 * 执行反思任务
 */
async function executeReflectionTask(task_id: string) {
    await ensureTableInitialized();
    const task_table = getTaskTableName();
    const reflection_table = getReflectionTableName();
    const now_ts = now();

    try {
        // 更新状态为 running
        await run_async(
            buildSQL(`update ${task_table} set status=$1, updated_at=$2 where id=$3`),
            ["running", now_ts, task_id]
        );

        // 获取任务信息
        const task = await get_async(
            buildSQL(`select * from ${task_table} where id=$1`),
            [task_id]
        );
        if (!task) {
            throw new Error(`Task ${task_id} not found`);
        }

        const memory_ids: string[] = p(task.memory_ids || "[]") as string[];
        const user_id = task.user_id;

        // 执行反思
        const insights = await thinking(memory_ids);

        // 将每个 insight 保存为单独的记录，并生成向量
        for (const insight of insights) {
            if (!insight || insight.trim().length === 0) {
                continue;
            }

            // 生成向量（使用 reflective sector）
            const vector = await embedForSector(insight.trim(), "reflective");
            const vector_buffer = vectorToBuffer(vector);
            const reflection_id = rid();

            // 插入反思记录
            await run_async(
                buildSQL(
                    `insert into ${reflection_table}(id, user_id, task_id, content, created_at, vector, vector_dim)
                     values($1, $2, $3, $4, $5, $6, $7)`
                ),
                [
                    reflection_id,
                    user_id,
                    task_id,
                    insight.trim(),
                    now_ts,
                    vector_buffer,
                    vector.length,
                ]
            );
        }

        // 更新任务为完成状态
        await run_async(
            buildSQL(
                `update ${task_table} set status=$1, insights=$2, completed_at=$3, updated_at=$4 where id=$5`
            ),
            ["completed", j(insights), now_ts, now_ts, task_id]
        );
    } catch (error: any) {
        // 更新任务为失败状态
        await run_async(
            buildSQL(
                `update ${task_table} set status=$1, error=$2, updated_at=$3 where id=$4`
            ),
            [
                "failed",
                error.message || String(error),
                now_ts,
                task_id,
            ]
        );
        throw error;
    }
}

/**
 * 查询某用户下所有反思任务列表
 * GET /reflection/:user_id/tasks
 */
async function getUserReflectionTasks(
    user_id: string
): Promise<ReflectionTask[]> {
    await ensureTableInitialized();
    const table = getTaskTableName();

    const tasks = await all_async(
        buildSQL(`select * from ${table} where user_id=$1 order by created_at desc`),
        [user_id]
    );

    return tasks.map((t: any) => ({
        id: t.id,
        user_id: t.user_id,
        status: t.status as ReflectionStatus,
        memory_ids: p(t.memory_ids || "[]") as string[],
        insights: p(t.insights || "[]") as string[],
        time_range_start: t.time_range_start,
        time_range_end: t.time_range_end,
        created_at: t.created_at,
        updated_at: t.updated_at,
        completed_at: t.completed_at,
        error: t.error,
    }));
}

/**
 * 查询某个反思任务的信息
 * GET /reflection/task/:task_id
 */
async function getReflectionTask(task_id: string): Promise<ReflectionTask | null> {
    await ensureTableInitialized();
    const table = getTaskTableName();

    const task = await get_async(
        buildSQL(`select * from ${table} where id=$1`),
        [task_id]
    );

    if (!task) {
        return null;
    }

    return {
        id: task.id,
        user_id: task.user_id,
        status: task.status as ReflectionStatus,
        memory_ids: p(task.memory_ids || "[]") as string[],
        insights: p(task.insights || "[]") as string[],
        time_range_start: task.time_range_start,
        time_range_end: task.time_range_end,
        created_at: task.created_at,
        updated_at: task.updated_at,
        completed_at: task.completed_at,
        error: task.error,
    };
}

/**
 * 反思记录接口
 */
interface ReflectionRecord {
    id: string;
    user_id: string;
    task_id: string | null;
    content: string;
    created_at: number;
    similarity?: number; // 仅在相似度搜索时包含
}

/**
 * 查询用户最近n条反思记录
 * @param user_id 用户ID
 * @param limit 返回记录数，默认10
 */
async function getUserRecentReflections(
    user_id: string,
    limit: number = 10
): Promise<ReflectionRecord[]> {
    await ensureTableInitialized();
    const reflection_table = getReflectionTableName();

    const records = await all_async(
        buildSQL(
            `select id, user_id, task_id, content, created_at 
             from ${reflection_table} 
             where user_id=$1 
             order by created_at desc 
             limit $2`
        ),
        [user_id, limit]
    );

    return records.map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        task_id: r.task_id,
        content: r.content,
        created_at: r.created_at,
    }));
}

/**
 * 通过文本相似度搜索用户的反思记录
 * @param user_id 用户ID
 * @param query_text 查询文本
 * @param limit 返回记录数，默认10
 * @param min_similarity 最小相似度阈值，默认0.5
 */
async function searchSimilarReflections(
    user_id: string,
    query_text: string,
    limit: number = 10,
    min_similarity: number = 0.5
): Promise<ReflectionRecord[]> {
    await ensureTableInitialized();
    const reflection_table = getReflectionTableName();

    // 生成查询文本的向量
    const query_vector = await embedForSector(query_text.trim(), "reflective");

    // 获取该用户的所有反思记录
    const all_records = await all_async(
        buildSQL(
            `select id, user_id, task_id, content, created_at, vector, vector_dim 
             from ${reflection_table} 
             where user_id=$1`
        ),
        [user_id]
    );

    // 计算相似度并排序
    const records_with_similarity: Array<ReflectionRecord & { similarity: number }> = [];

    for (const record of all_records) {
        // 将数据库中的向量Buffer转换为数组
        const vector_buffer = Buffer.isBuffer(record.vector)
            ? record.vector
            : Buffer.from(record.vector);
        const record_vector = bufferToVector(vector_buffer);

        // 计算余弦相似度
        const similarity = cosineSimilarity(query_vector, record_vector);

        if (similarity >= min_similarity) {
            records_with_similarity.push({
                id: record.id,
                user_id: record.user_id,
                task_id: record.task_id,
                content: record.content,
                created_at: record.created_at,
                similarity: similarity,
            });
        }
    }

    // 按相似度降序排序，返回前limit条
    records_with_similarity.sort((a, b) => b.similarity - a.similarity);
    return records_with_similarity.slice(0, limit);
}

/**
 * 注册反思相关的路由
 */
export function reflection(app: any) {
    // 启动反思任务
    app.post("/reflection/start", async (req: any, res: any) => {
        try {
            const { user_id, time_range_hours } = req.body;
            if (!user_id) {
                return res.status(400).json({ err: "user_id required" });
            }

            const task = await startReflection(
                user_id,
                time_range_hours || 24
            );
            res.json({ ok: true, task });
        } catch (err: any) {
            res.status(500).json({ err: err.message });
        }
    });

    // 查询某用户下所有反思任务列表
    app.get("/reflection/:user_id/tasks", async (req: any, res: any) => {
        try {
            const { user_id } = req.params;
            if (!user_id) {
                return res.status(400).json({ err: "user_id required" });
            }

            const tasks = await getUserReflectionTasks(user_id);
            res.json({ user_id, tasks });
        } catch (err: any) {
            res.status(500).json({ err: err.message });
        }
    });

    // 查询某个反思任务的信息
    app.get("/reflection/task/:task_id", async (req: any, res: any) => {
        try {
            const { task_id } = req.params;
            if (!task_id) {
                return res.status(400).json({ err: "task_id required" });
            }

            const task = await getReflectionTask(task_id);
            if (!task) {
                return res.status(404).json({ err: "task not found" });
            }

            res.json({ task });
        } catch (err: any) {
            res.status(500).json({ err: err.message });
        }
    });

    // 查询用户最近n条反思记录
    // GET /reflection/:user_id/recent?limit=10
    app.get("/reflection/:user_id/recent", async (req: any, res: any) => {
        try {
            const { user_id } = req.params;
            const limit = parseInt(req.query.limit || "10", 10);

            if (!user_id) {
                return res.status(400).json({ err: "user_id required" });
            }

            if (isNaN(limit) || limit < 1 || limit > 100) {
                return res.status(400).json({ err: "limit must be between 1 and 100" });
            }

            const reflections = await getUserRecentReflections(user_id, limit);
            res.json({ user_id, reflections, count: reflections.length });
        } catch (err: any) {
            res.status(500).json({ err: err.message });
        }
    });

    // 通过文本相似度搜索用户的反思记录
    // POST /reflection/:user_id/search
    // Body: { query: string, limit?: number, min_similarity?: number }
    app.post("/reflection/:user_id/search", async (req: any, res: any) => {
        try {
            const { user_id } = req.params;
            const { query, limit, min_similarity } = req.body;

            if (!user_id) {
                return res.status(400).json({ err: "user_id required" });
            }

            if (!query || typeof query !== "string" || query.trim().length === 0) {
                return res.status(400).json({ err: "query text is required" });
            }

            const search_limit = limit ? parseInt(String(limit), 10) : 10;
            const min_sim = min_similarity ? parseFloat(String(min_similarity)) : 0.5;

            if (isNaN(search_limit) || search_limit < 1 || search_limit > 100) {
                return res.status(400).json({ err: "limit must be between 1 and 100" });
            }

            if (isNaN(min_sim) || min_sim < 0 || min_sim > 1) {
                return res.status(400).json({ err: "min_similarity must be between 0 and 1" });
            }

            const reflections = await searchSimilarReflections(
                user_id,
                query,
                search_limit,
                min_sim
            );
            res.json({
                user_id,
                query,
                reflections,
                count: reflections.length,
            });
        } catch (err: any) {
            res.status(500).json({ err: err.message });
        }
    });
}

