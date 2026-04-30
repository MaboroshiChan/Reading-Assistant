#!/bin/bash

# 获取项目根目录（脚本所在目录的父目录）
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "正在清除持久化数据..."

# 1. 清除 LLM 响应记录
if [ -d "$PROJECT_ROOT/resource/LLM_response" ]; then
    echo "清除 LLM 响应记录: $PROJECT_ROOT/resource/LLM_response/*.json"
    rm -f "$PROJECT_ROOT/resource/LLM_response"/*.json
fi

# 2. 清除 Book Ingestion 存储数据
if [ -f "$PROJECT_ROOT/reading-app-server/data/book-ingestion/store.json" ]; then
    echo "清除 Book Ingestion 存储数据: $PROJECT_ROOT/reading-app-server/data/book-ingestion/store.json"
    rm -f "$PROJECT_ROOT/reading-app-server/data/book-ingestion/store.json"
fi

# 3. 清除 Knowledge Extraction 提取数据
if [ -d "$PROJECT_ROOT/reading-app-server/data/knowledge-extraction" ]; then
    echo "清除 Knowledge Extraction 提取数据: $PROJECT_ROOT/reading-app-server/data/knowledge-extraction/store.json"
    rm -f "$PROJECT_ROOT/reading-app-server/data/knowledge-extraction/store.json"
fi

# 4. 清除日志文件
if [ -d "$PROJECT_ROOT/reading-app-server/log" ]; then
    echo "清除日志文件: $PROJECT_ROOT/reading-app-server/log/*.log"
    rm -f "$PROJECT_ROOT/reading-app-server/log"/*.log
fi

echo "数据清除完成！"
