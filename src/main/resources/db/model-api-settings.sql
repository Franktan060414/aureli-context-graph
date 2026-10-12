-- PostgreSQL: 服务设置。首次启动从旧 JSON 或 application.yml 初始化唯一配置记录。
CREATE TABLE IF NOT EXISTS t_model_api_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    chat_provider VARCHAR(16) NOT NULL CHECK (chat_provider IN ('openai', 'anthropic')),
    chat_base_url TEXT NOT NULL,
    chat_model VARCHAR(200) NOT NULL,
    chat_api_key VARCHAR(4096) NOT NULL,
    embedding_provider VARCHAR(16) NOT NULL CHECK (embedding_provider IN ('openai')),
    embedding_base_url TEXT NOT NULL,
    embedding_model VARCHAR(200) NOT NULL,
    embedding_api_key VARCHAR(4096) NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 旧版 local 也是 OpenAI 协议。仅迁移协议名称，保留地址、模型和密钥。
ALTER TABLE t_model_api_settings DROP CONSTRAINT IF EXISTS t_model_api_settings_chat_provider_check;
ALTER TABLE t_model_api_settings DROP CONSTRAINT IF EXISTS t_model_api_settings_embedding_provider_check;
UPDATE t_model_api_settings SET chat_provider = 'openai' WHERE chat_provider = 'local';
UPDATE t_model_api_settings SET embedding_provider = 'openai' WHERE embedding_provider = 'local';
ALTER TABLE t_model_api_settings ADD CONSTRAINT t_model_api_settings_chat_provider_check
    CHECK (chat_provider IN ('openai', 'anthropic'));
ALTER TABLE t_model_api_settings ADD CONSTRAINT t_model_api_settings_embedding_provider_check
    CHECK (embedding_provider IN ('openai'));
