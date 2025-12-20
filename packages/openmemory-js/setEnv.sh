# ============================================
# OpenMemory - Environment Configuration
# ============================================

# --------------------------------------------
# Backend Server Settings
# --------------------------------------------
export OM_PORT=8080

# API Authentication (IMPORTANT: Set a strong API key for production!)
# Generate a secure key: openssl rand -base64 32
# Leave empty to disable authentication (development only)
export OM_API_KEY=/R3BcK+W7PnK4XzuFKFP/PGkukXjlYInpGBjVJ5fHPw=

# Rate Limiting
# Enable rate limiting to prevent abuse
export OM_RATE_LIMIT_ENABLED=true
# Time window in milliseconds (default: 60000 = 1 minute)
export OM_RATE_LIMIT_WINDOW_MS=60000
# Maximum requests per window (default: 100 requests per minute)
export OM_RATE_LIMIT_MAX_REQUESTS=100

# Optional: Log all authenticated requests (set to 'true' for debugging)
export OM_LOG_AUTH=false

# Telemetry (true by default, set to false to opt out of anonymous ping)
export OM_TELEMETRY=true

# Server Mode
export OM_MODE=standard # standard | langgraph

# --------------------------------------------
# Metadata Store
# --------------------------------------------
# sqlite (default) | postgres
export OM_METADATA_BACKEND=postgres
export OM_DB_PATH=./data/openmemory.sqlite

# PostgreSQL Settings (used when OM_METADATA_BACKEND=postgres or OM_VECTOR_BACKEND=pgvector)
export OM_PG_HOST=47.92.111.138
export OM_PG_PORT=5432
export OM_PG_DB=openmemory
export OM_PG_USER=postgres
export OM_PG_PASSWORD=NigytqjM
export OM_PG_SCHEMA=public
export OM_PG_TABLE=openmemory_memories
export OM_PG_SSL=disable # disable | require

# --------------------------------------------
# Vector Store Backend
# --------------------------------------------
# sqlite (default) | pgvector | weaviate
export OM_VECTOR_BACKEND=pgvector
export OM_VECTOR_TABLE=openmemory_vectors
export OM_WEAVIATE_URL=
export OM_WEAVIATE_API_KEY=
export OM_WEAVIATE_CLASS=OpenMemory

# --------------------------------------------
# Embeddings Configuration
# --------------------------------------------
# Available providers: openai, gemini, ollama, local, synthetic
# Embedding models per sector can be configured in models.yaml
#
# NOTE: Your selected TIER (fast/smart/deep) affects how embeddings work:
# • FAST tier: Uses synthetic embeddings regardless of OM_EMBEDDINGS setting
# • SMART tier: Combines synthetic + compressed semantic from your chosen provider
# • DEEP tier: Uses full embeddings from your chosen provider
#
# For SMART/DEEP tiers, set your preferred provider:
export OM_EMBEDDINGS=openai

# Vector dimension (auto-adjusted by tier, but can be overridden)
# • FAST: 256-dim  • SMART: 384-dim  • DEEP: 1536-dim
export OM_VEC_DIM=1536

# Embedding Mode
# simple   = 1 unified batch call for all sectors (faster, rate-limit safe, recommended)
# advanced = 5 separate calls, one per sector (higher precision, more API calls)
export OM_EMBED_MODE=simple

# Advanced Mode Options (only used when OM_EMBED_MODE=advanced)
# Enable parallel embedding (not recommended for Gemini due to rate limits)
export OM_ADV_EMBED_PARALLEL=false
# Delay between embeddings in milliseconds
export OM_EMBED_DELAY_MS=200

# OpenAI-compatible Embeddings Provider
export OM_OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
# Model override for all sector embeddings (leave empty to use defaults)
export OM_OPENAI_MODEL=text-embedding-v4
export OM_OPENAI_CHAT_MODEL=qwen-plus
# API Configuration
# Max request body size in bytes (default: 1MB)
export OM_MAX_PAYLOAD_SIZE=1000000

# --------------------------------------------
# Embedding Provider API Keys
# --------------------------------------------
# OpenAI Embeddings
export OPENAI_API_KEY=sk-2f69acb3dd354b2b850b4c690667d9f8

# Google Gemini Embeddings
#GEMINI_API_KEY=your-gemini-api-key-here

# Ollama Local Embeddings
#OLLAMA_URL=http://localhost:11434

# Local Model Path (for custom embedding models)
#LOCAL_MODEL_PATH=/path/to/your/local/model

# --------------------------------------------
# Memory System Settings
# --------------------------------------------

# ============================================
# PERFORMANCE TIER (Manual Configuration Required)
# ============================================
# OpenMemory requires you to manually set the performance tier.
# Set OM_TIER to one of: hybrid, fast, smart, or deep
#
# Available Tiers:
#
# HYBRID - Keyword + Synthetic embeddings (256-dim) with BM25 ranking
#         • Recall: ~100% (exact keyword matching)  • QPS: 800-1000  • RAM: 0.5GB/10k memories
#         • Best for: Exact searches, documentation, code search, personal knowledge
#         • Features: Exact phrase matching, BM25 scoring, n-gram matching, 100% accuracy
#         • Use when: You need guaranteed exact matches and keyword-based retrieval
#
# FAST  - Synthetic embeddings only (256-dim)
#         • Recall: ~70-75%  • QPS: 700-850  • RAM: 0.6GB/10k memories
#         • Best for: Local apps, VS Code extensions, low-end hardware
#         • Use when: < 4 CPU cores or < 8GB RAM
#
# SMART - Hybrid embeddings (256-dim synthetic + 128-dim compressed semantic = 384-dim)
#         • Recall: ~85%  • QPS: 500-600  • RAM: 0.9GB/10k memories
#         • Best for: Production servers, AI copilots, mid-range hardware
#         • Use when: 4-7 CPU cores and 8-15GB RAM
#
# DEEP  - Full AI embeddings (1536-dim OpenAI/Gemini)
#         • Recall: ~95-100%  • QPS: 350-400  • RAM: 1.6GB/10k memories
#         • Best for: Cloud deployments, high-accuracy systems, semantic research
#         • Use when: 8+ CPU cores and 16+ GB RAM
#
# REQUIRED: Set your tier (no auto-detection):
export OM_TIER=hybrid

# Keyword Matching Settings (HYBRID tier only)
# Boost multiplier for keyword matches (default: 2.5)
export OM_KEYWORD_BOOST=2.5
# Minimum keyword length for matching (default: 3)
export OM_KEYWORD_MIN_LENGTH=3

export OM_MIN_SCORE=0.3

# ============================================
# Smart Decay Settings (Time-Based Algorithm)
# ============================================
# Decay interval in minutes - how often the decay cycle runs
# The new algorithm uses time-based decay with daily lambda rates (hot=0.005/day, warm=0.02/day, cold=0.05/day)
# Unlike batch-based systems, running more frequently doesn't increase decay speed
# Decay is calculated from: decay_factor = exp(-lambda * days_since_access / (salience + 0.1))
#
# Recommended intervals:
# • Testing: 30 minutes (for rapid validation)
# • Development: 60-120 minutes (balanced testing)
# • Production: 120-180 minutes (optimal - captures meaningful decay deltas while minimizing overhead)
#
# At 2-3 hours: hot tier decays ~0.04-0.06%, warm ~0.16-0.24%, cold ~0.4-0.6% per cycle
export OM_DECAY_INTERVAL_MINUTES=120

# Number of parallel decay worker threads (default: 3)
export OM_DECAY_THREADS=3
# Cold tier threshold - memories below this salience get fingerprinted (default: 0.25)
export OM_DECAY_COLD_THRESHOLD=0.25
# Reinforce memory salience when queried (default: true)
export OM_DECAY_REINFORCE_ON_QUERY=true
# Enable regeneration of cold memories on query hits (default: true)
export OM_REGENERATION_ENABLED=true
# Maximum vector dimensions (default: 1536)
export OM_MAX_VECTOR_DIM=1536
# Minimum vector dimensions for compression (default: 64)
export OM_MIN_VECTOR_DIM=64
# Number of summary compression layers 1-3 (default: 3)
export OM_SUMMARY_LAYERS=3

# Full Semantic Graph MVP Settings
# Use summary-only storage (≤300 chars, intelligent extraction)
export OM_USE_SUMMARY_ONLY=true
# Maximum summary length - smart extraction preserves dates, names, numbers, actions
export OM_SUMMARY_MAX_LENGTH=300
# Memories per segment (10k recommended for optimal cache performance)
export OM_SEG_SIZE=10000

# Cache segments (auto-tuned by tier, but can be overridden)
# • FAST: 2 segments  • SMART: 3 segments  • DEEP: 5 segments
# OM_CACHE_SEGMENTS=3

# Max active queries (auto-tuned by tier, but can be overridden)
# • FAST: 32 queries  • SMART: 64 queries  • DEEP: 128 queries
# OM_MAX_ACTIVE=64

# Brain Sector Configuration (auto-classified, but you can override)
# Sectors: episodic, semantic, procedural, emotional, reflective

# Auto-Reflection System
# Automatically creates reflective memories by clustering similar memories
export OM_AUTO_REFLECT=false
# Reflection interval in minutes (default: 10)
export OM_REFLECT_INTERVAL=10
# Minimum memories required before reflection runs (default: 20)
export OM_REFLECT_MIN_MEMORIES=20

# Compression
# Enable automatic content compression for large memories
export OM_COMPRESSION_ENABLED=false
# Minimum content length (characters) to trigger compression (default: 100)
export OM_COMPRESSION_MIN_LENGTH=100
# Compression algorithm: semantic, syntactic, aggressive, auto (default: auto)
export OM_COMPRESSION_ALGORITHM=auto

# --------------------------------------------
# LangGraph Integration Mode (LGM)
# --------------------------------------------
export OM_LG_NAMESPACE=default
export OM_LG_MAX_CONTEXT=50
export OM_LG_REFLECTIVE=true
