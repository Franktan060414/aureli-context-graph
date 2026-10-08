CREATE TABLE IF NOT EXISTS t_tile (
    id BIGSERIAL PRIMARY KEY,
    tile_id VARCHAR(128) NOT NULL UNIQUE,
    title VARCHAR(255),
    tile_type VARCHAR(16) NOT NULL DEFAULT 'QA' CONSTRAINT chk_tile_type CHECK (tile_type IN ('QA', 'NOTE', 'FILE')),
    content TEXT,
    file_name VARCHAR(512),
    file_content_type VARCHAR(128),
    file_size BIGINT,
    file_data BYTEA,
    user_message TEXT,
    answer_summary TEXT,
    weight SMALLINT NOT NULL DEFAULT 1 CONSTRAINT chk_tile_weight CHECK (weight IN (1, 2, 3)),
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 兼容尚未添加节点权重的既有工作区；已存在该列时保留原有值。
ALTER TABLE t_tile ADD COLUMN IF NOT EXISTS weight SMALLINT NOT NULL DEFAULT 1
    CONSTRAINT chk_tile_weight CHECK (weight IN (1, 2, 3));

-- 升级既有工作区：原问答数据保留并自动标记为 QA。
ALTER TABLE t_tile ADD COLUMN IF NOT EXISTS tile_type VARCHAR(16) NOT NULL DEFAULT 'QA'
    CONSTRAINT chk_tile_type CHECK (tile_type IN ('QA', 'NOTE', 'FILE'));
ALTER TABLE t_tile ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE t_tile ADD COLUMN IF NOT EXISTS file_name VARCHAR(512);
ALTER TABLE t_tile ADD COLUMN IF NOT EXISTS file_content_type VARCHAR(128);
ALTER TABLE t_tile ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE t_tile ADD COLUMN IF NOT EXISTS file_data BYTEA;

CREATE TABLE IF NOT EXISTS t_tile_message (
    id BIGSERIAL PRIMARY KEY,
    tile_id VARCHAR(128) NOT NULL,
    role VARCHAR(32) NOT NULL,
    content TEXT NOT NULL,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tile_message_tile
        FOREIGN KEY (tile_id)
        REFERENCES t_tile (tile_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_t_tile_message_tile_time
    ON t_tile_message (tile_id, create_time ASC);

CREATE TABLE IF NOT EXISTS t_tile_edge (
    id BIGSERIAL PRIMARY KEY,
    edge_id VARCHAR(128) NOT NULL UNIQUE,
    source_tile_id VARCHAR(128) NOT NULL,
    target_tile_id VARCHAR(128) NOT NULL,
    direction VARCHAR(32) NOT NULL,
    relation_type VARCHAR(64) NOT NULL,
    weight NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
    description TEXT,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tile_edge_source
        FOREIGN KEY (source_tile_id)
        REFERENCES t_tile (tile_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_tile_edge_target
        FOREIGN KEY (target_tile_id)
        REFERENCES t_tile (tile_id)
        ON DELETE CASCADE,
    CONSTRAINT chk_tile_edge_direction
        CHECK (direction IN ('DIRECTED', 'UNDIRECTED')),
    CONSTRAINT chk_tile_edge_weight
        CHECK (weight >= 0 AND weight <= 1),
    CONSTRAINT chk_tile_edge_not_self
        CHECK (source_tile_id <> target_tile_id)
);

CREATE INDEX IF NOT EXISTS idx_t_tile_edge_source
    ON t_tile_edge (source_tile_id);

CREATE INDEX IF NOT EXISTS idx_t_tile_edge_target
    ON t_tile_edge (target_tile_id);

CREATE INDEX IF NOT EXISTS idx_t_tile_edge_relation_type
    ON t_tile_edge (relation_type);

CREATE TABLE IF NOT EXISTS t_ai_customer_service_md_storage (
    id BIGSERIAL PRIMARY KEY,
    original_file_name VARCHAR(512) NOT NULL,
    new_file_name VARCHAR(512) NOT NULL,
    file_path VARCHAR(1024) NOT NULL,
    file_size BIGINT NOT NULL,
    status INTEGER NOT NULL,
    remark VARCHAR(1024),
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- PostgreSQL: 服务设置。首次启动从旧 JSON 或 application.yml 初始化唯一配置记录。
CREATE TABLE IF NOT EXISTS t_model_api_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    chat_provider VARCHAR(16) NOT NULL CHECK (chat_provider IN ('local', 'openai')),
    chat_base_url TEXT NOT NULL,
    chat_model VARCHAR(200) NOT NULL,
    chat_api_key VARCHAR(4096) NOT NULL,
    embedding_provider VARCHAR(16) NOT NULL CHECK (embedding_provider IN ('local', 'openai')),
    embedding_base_url TEXT NOT NULL,
    embedding_model VARCHAR(200) NOT NULL,
    embedding_api_key VARCHAR(4096) NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
