CREATE TABLE IF NOT EXISTS t_map (
    id BIGSERIAL PRIMARY KEY,
    map_id VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    zoom NUMERIC(7, 6) NOT NULL DEFAULT 1.0 CONSTRAINT chk_map_zoom CHECK (zoom BETWEEN 0.35 AND 1.5),
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- 旧图谱默认使用 100% 缩放；与画布支持的 35%–150% 范围一致。
ALTER TABLE t_map ADD COLUMN IF NOT EXISTS zoom NUMERIC(7, 6) NOT NULL DEFAULT 1.0
    CONSTRAINT chk_map_zoom CHECK (zoom BETWEEN 0.35 AND 1.5);

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

-- 多图谱字段必须显式赋值；不创建图谱，也不为旧数据推断归属。
-- 若尚有未分配图谱的旧数据，应先明确归属再升级，避免无意删除。
ALTER TABLE t_tile ADD COLUMN IF NOT EXISTS map_id VARCHAR(128);
ALTER TABLE t_tile_message ADD COLUMN IF NOT EXISTS map_id VARCHAR(128);
ALTER TABLE t_tile_edge ADD COLUMN IF NOT EXISTS map_id VARCHAR(128);
ALTER TABLE t_tile ALTER COLUMN map_id DROP DEFAULT;
ALTER TABLE t_tile_message ALTER COLUMN map_id DROP DEFAULT;
ALTER TABLE t_tile_edge ALTER COLUMN map_id DROP DEFAULT;
ALTER TABLE t_tile ALTER COLUMN map_id SET NOT NULL;
ALTER TABLE t_tile_message ALTER COLUMN map_id SET NOT NULL;
ALTER TABLE t_tile_edge ALTER COLUMN map_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_t_tile_map_tile ON t_tile (map_id, tile_id);
CREATE INDEX IF NOT EXISTS idx_t_tile_map_order ON t_tile (map_id, id);
CREATE INDEX IF NOT EXISTS idx_t_tile_message_map_tile_time ON t_tile_message (map_id, tile_id, create_time);
CREATE INDEX IF NOT EXISTS idx_t_tile_edge_map_source ON t_tile_edge (map_id, source_tile_id);
CREATE INDEX IF NOT EXISTS idx_t_tile_edge_map_target ON t_tile_edge (map_id, target_tile_id);

-- 重复启动可重入；复合外键确保消息、边的两个端点与 Tile 属于同一个 Map。
ALTER TABLE t_tile DROP CONSTRAINT IF EXISTS fk_tile_map;
ALTER TABLE t_tile ADD CONSTRAINT fk_tile_map FOREIGN KEY (map_id) REFERENCES t_map (map_id) ON DELETE CASCADE;
ALTER TABLE t_tile_message DROP CONSTRAINT IF EXISTS fk_tile_message_tile;
ALTER TABLE t_tile_message ADD CONSTRAINT fk_tile_message_tile FOREIGN KEY (map_id, tile_id)
    REFERENCES t_tile (map_id, tile_id) ON DELETE CASCADE;
ALTER TABLE t_tile_edge DROP CONSTRAINT IF EXISTS fk_tile_edge_source;
ALTER TABLE t_tile_edge ADD CONSTRAINT fk_tile_edge_source FOREIGN KEY (map_id, source_tile_id)
    REFERENCES t_tile (map_id, tile_id) ON DELETE CASCADE;
ALTER TABLE t_tile_edge DROP CONSTRAINT IF EXISTS fk_tile_edge_target;
ALTER TABLE t_tile_edge ADD CONSTRAINT fk_tile_edge_target FOREIGN KEY (map_id, target_tile_id)
    REFERENCES t_tile (map_id, tile_id) ON DELETE CASCADE;

-- 标签仅属于一个 Map；NULL 表示 Tile 没有标签，历史数据无需回填。
CREATE TABLE IF NOT EXISTS t_label (
    id BIGSERIAL PRIMARY KEY,
    map_id VARCHAR(128) NOT NULL REFERENCES t_map(map_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0 AND name = trim(name)),
    color_hex VARCHAR(7) NOT NULL CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (map_id, name),
    UNIQUE (map_id, id)
);
ALTER TABLE t_tile ADD COLUMN IF NOT EXISTS label_id BIGINT;
ALTER TABLE t_tile DROP CONSTRAINT IF EXISTS fk_tile_label;
ALTER TABLE t_tile ADD CONSTRAINT fk_tile_label FOREIGN KEY (map_id, label_id)
    REFERENCES t_label (map_id, id);
CREATE INDEX IF NOT EXISTS idx_t_tile_map_label ON t_tile (map_id, label_id);

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

-- 拆分关系升级：仅转换带有系统拆分 ID 和拆分备注的旧连线，不修改普通延伸关系。
-- 修正早期拆分关系的拼写；与旧 EXTENDS 升级一起执行，重复启动不会重复更新。
UPDATE t_tile_edge
SET relation_type = 'DIVIDES', update_time = CURRENT_TIMESTAMP
WHERE relation_type = 'DEVIDES';

UPDATE t_tile_edge e
SET relation_type = 'DIVIDES', update_time = CURRENT_TIMESTAMP
FROM t_tile child
WHERE e.map_id = child.map_id AND e.target_tile_id = child.tile_id
  AND child.tile_type = 'QA'
  AND e.direction = 'DIRECTED' AND e.relation_type = 'EXTENDS'
  AND e.target_tile_id ~ '^tile-split-[A-Za-z0-9-]+-[0-3]$'
  AND (e.description = '手动拆分' OR e.description LIKE '手动拆分：%');
-- 拆分关系升级结束
