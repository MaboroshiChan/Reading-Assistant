#!/bin/bash

set -euo pipefail

# 获取项目根目录（脚本所在目录的父目录）
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-all}"

clear_all_data() {
    echo "正在清除全部持久化数据..."

    if [ -d "$PROJECT_ROOT/resource/LLM_response" ]; then
        echo "清除 LLM 响应记录: $PROJECT_ROOT/resource/LLM_response/*.json"
        rm -f "$PROJECT_ROOT/resource/LLM_response"/*.json
    fi

    if [ -f "$PROJECT_ROOT/reading-app-server/data/book-ingestion/store.json" ]; then
        echo "清除 Book Ingestion 存储数据: $PROJECT_ROOT/reading-app-server/data/book-ingestion/store.json"
        rm -f "$PROJECT_ROOT/reading-app-server/data/book-ingestion/store.json"
    fi

    if [ -d "$PROJECT_ROOT/reading-app-server/data/knowledge-extraction" ]; then
        echo "清除 Knowledge Extraction 提取数据: $PROJECT_ROOT/reading-app-server/data/knowledge-extraction/store.json"
        rm -f "$PROJECT_ROOT/reading-app-server/data/knowledge-extraction/store.json"
    fi

    if [ -d "$PROJECT_ROOT/reading-app-server/log" ]; then
        echo "清除日志文件: $PROJECT_ROOT/reading-app-server/log/*.log"
        rm -f "$PROJECT_ROOT/reading-app-server/log"/*.log
    fi

    echo "全部数据清除完成！"
}

clear_quiz_data() {
    echo "正在清除 Quiz 相关数据..."

    if [ -f "$PROJECT_ROOT/reading-app-server/log/workflows.log" ]; then
        echo "清除 Quiz 工作流日志: $PROJECT_ROOT/reading-app-server/log/workflows.log"
        rm -f "$PROJECT_ROOT/reading-app-server/log/workflows.log"
    fi

    if [ -f "$PROJECT_ROOT/reading-app-server/scripts/delete-surreal-records.cjs" ]; then
        echo "尝试清除 SurrealDB 中的 Quiz workflow_run 记录..."
        (
            cd "$PROJECT_ROOT/reading-app-server"
            SURREAL_URL="${SURREAL_URL:-http://127.0.0.1:8000}" \
            SURREAL_NS="${SURREAL_NS:-Lumen}" \
            SURREAL_DB="${SURREAL_DB:-test}" \
            SURREAL_USER="${SURREAL_USER:-root}" \
            SURREAL_PASS="${SURREAL_PASS:-root}" \
            node scripts/delete-surreal-records.cjs --table workflow_run --where "kind = 'quiz_generation'"
        ) || echo "警告: SurrealDB Quiz 记录清除失败，可能是数据库未启动或当前没有匹配记录。"
    fi

    echo "Quiz 数据清除完成！"
}

case "$MODE" in
    all)
        clear_all_data
        ;;
    quiz)
        clear_quiz_data
        ;;
    *)
        echo "用法: $0 [all|quiz]"
        exit 1
        ;;
esac
