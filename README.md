# Aureli Context Graph

Aureli Context Graph 是一个基于 Spring Boot、Spring AI、PostgreSQL 与 PGVector 构建的图式 AI 客服实验项目。

项目将传统线性聊天改造成 Tile 图式交互：用户每次提问都会生成一个独立 Tile，不同 Tile 默认隔离工作记忆；用户可以在画布上选择多个相关 Tile，并通过单向或双向边建立关系。新建 Tile 时，系统会按照固定深度遍历相关 Tile 的工作记忆，同时继续共享 RAG 知识库。

## 功能特性

- Tile 式 AI 客服问答
- 不同 Tile 默认隔离工作记忆
- 支持多个相关 Tile 形成图关系
- 支持单向边和双向边
- 支持 Markdown 知识库上传、列表、更新和删除
- 基于 PGVector 的 RAG 检索增强问答
- 前端画布直观展示 Tile、关系边和问答结果
- 支持重置画布并清空 Tile 相关数据

## 技术栈

- Java 21
- Spring Boot 4.1
- Spring AI 2.0
- MyBatis-Plus
- PostgreSQL
- PGVector
- Lombok
- Log4j2
- 原生 HTML、CSS、JavaScript

## 项目结构

```text
src/main/java/com/aureli/ai/robot
├── advisor                 # Spring AI Advisor，处理 RAG、Tile 记忆和流式日志
├── config                  # Spring、MyBatis、跨域、线程池等配置
├── controller              # AI 客服接口
├── domain                  # DO 实体和 Mapper
├── event                   # Markdown 上传后的向量化事件
├── exception               # 全局异常处理
├── model                   # 请求和响应 VO
├── reader                  # Markdown 文档读取
├── service                 # 业务服务
└── utils                   # 通用工具

src/main/resources/static   # 前端页面
src/main/resources/schema.sql
knowledge-base              # 示例 Markdown 知识库
```

## 核心概念

### Tile

Tile 是一次用户提问和 AI 回答组成的独立认知单元。每个 Tile 会保存自己的问题、回答摘要和对话消息。

### Tile Message

Tile Message 用于保存某个 Tile 内部的完整问答消息，包括用户消息和 AI 回复。

### Tile Edge

Tile Edge 表示 Tile 之间的图关系。边可以是单向的，也可以是双向的，并可以标记关系类型。

### RAG 知识库

RAG 知识库来自上传的 Markdown 文档。不同 Tile 默认共享 RAG 知识库，但不默认共享工作记忆。

## 接口说明

### Tile 问答

```http
POST /customer-service/chat/tile/completion
Content-Type: application/json
Accept: text/event-stream
```

请求示例：

```json
{
  "message": "RAG 和 Agent 有什么区别？",
  "tileId": "tile-003",
  "relatedTileIds": ["tile-001", "tile-002"],
  "memoryDepth": 3,
  "edgeDirection": "DIRECTED",
  "relationType": "EXTENDS",
  "edgeWeight": 1,
  "edgeDescription": "从相关 Tile 继续追问"
}
```

### 重置 Tile 画布

```http
POST /customer-service/tile/reset
```

该接口会清空：

- `t_tile_edge`
- `t_tile_message`
- `t_tile`

### Markdown 知识库

```http
POST /customer-service/md/upload
POST /customer-service/md/list
POST /customer-service/md/update
POST /customer-service/md/delete
```

## 本地运行

### 1. 准备环境

请先安装：

- JDK 21
- Maven
- PostgreSQL
- PGVector 扩展

### 2. 创建数据库

示例数据库名为 `robot`：

```sql
CREATE DATABASE robot;
```

连接数据库后启用扩展：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### 3. 创建 PostgreSQL 表

项目使用 PostgreSQL 保存 Markdown 文件记录、向量数据、Tile 节点、Tile 消息和 Tile 边关系。

```sql
create table t_ai_customer_service_md_storage
(
    id                 bigserial
        primary key,
    original_file_name varchar(160) not null,
    new_file_name      varchar(160) not null,
    file_path          varchar(500) not null,
    file_size          bigint       not null,
    status             smallint  default 0,
    remark             varchar(200),
    create_time        timestamp default CURRENT_TIMESTAMP,
    update_time        timestamp default CURRENT_TIMESTAMP
);

comment on table t_ai_customer_service_md_storage is '问答 Markdown 文件存储表';

comment on column t_ai_customer_service_md_storage.id is '主键ID';

comment on column t_ai_customer_service_md_storage.original_file_name is '原始文件名称';

comment on column t_ai_customer_service_md_storage.new_file_name is '新命名文件名称（防止名称相同导致覆盖）';

comment on column t_ai_customer_service_md_storage.file_path is '文件存储路径';

comment on column t_ai_customer_service_md_storage.file_size is '文件大小(字节)';

comment on column t_ai_customer_service_md_storage.status is '处理状态：0-待处理 1-向量化中 2-已完成 3-失败';

comment on column t_ai_customer_service_md_storage.remark is '备注信息';

comment on column t_ai_customer_service_md_storage.create_time is '创建时间';

comment on column t_ai_customer_service_md_storage.update_time is '更新时间';

alter table t_ai_customer_service_md_storage
    owner to postgres;

create index idx_t_ai_customer_service_md_storage_status
    on t_ai_customer_service_md_storage (status);

create index idx_t_ai_customer_service_md_storage_created_time
    on t_ai_customer_service_md_storage (create_time);

create index idx_t_ai_customer_service_md_storage_original_file_name
    on t_ai_customer_service_md_storage (original_file_name);

create table t_vector_store
(
    id        uuid default uuid_generate_v4() not null
        primary key,
    content   text,
    metadata  json,
    embedding vector(1536)
);

alter table t_vector_store
    owner to postgres;

create index t_vector_store_embedding_idx
    on t_vector_store using hnsw (embedding vector_cosine_ops);

create table t_tile
(
    id             bigserial
        primary key,
    tile_id        varchar(128)                        not null
        unique,
    title          varchar(255),
    user_message   text,
    answer_summary text,
    create_time    timestamp default CURRENT_TIMESTAMP not null,
    update_time    timestamp default CURRENT_TIMESTAMP not null
);

alter table t_tile
    owner to postgres;

create table t_tile_message
(
    id          bigserial
        primary key,
    tile_id     varchar(128)                        not null
        constraint fk_tile_message_tile
            references t_tile (tile_id)
            on delete cascade,
    role        varchar(32)                         not null,
    content     text                                not null,
    create_time timestamp default CURRENT_TIMESTAMP not null
);

alter table t_tile_message
    owner to postgres;

create index idx_t_tile_message_tile_time
    on t_tile_message (tile_id, create_time);

create table t_tile_edge
(
    id             bigserial
        primary key,
    edge_id        varchar(128)                            not null
        unique,
    source_tile_id varchar(128)                            not null
        constraint fk_tile_edge_source
            references t_tile (tile_id)
            on delete cascade,
    target_tile_id varchar(128)                            not null
        constraint fk_tile_edge_target
            references t_tile (tile_id)
            on delete cascade,
    direction      varchar(32)                             not null
        constraint chk_tile_edge_direction
            check ((direction)::text = ANY
                   ((ARRAY ['DIRECTED'::character varying, 'UNDIRECTED'::character varying])::text[])),
    relation_type  varchar(64)                             not null,
    weight         numeric(5, 4) default 1.0000            not null
        constraint chk_tile_edge_weight
            check ((weight >= (0)::numeric) AND (weight <= (1)::numeric)),
    description    text,
    create_time    timestamp     default CURRENT_TIMESTAMP not null,
    update_time    timestamp     default CURRENT_TIMESTAMP not null,
    constraint chk_tile_edge_not_self
        check ((source_tile_id)::text <> (target_tile_id)::text)
);

alter table t_tile_edge
    owner to postgres;

create index idx_t_tile_edge_source
    on t_tile_edge (source_tile_id);

create index idx_t_tile_edge_target
    on t_tile_edge (target_tile_id);

create index idx_t_tile_edge_relation_type
    on t_tile_edge (relation_type);
```

### 4. 修改配置

编辑 `src/main/resources/application-dev.yml`：

```yaml
spring:
  datasource:
    url: jdbc:p6spy:postgresql://localhost:5432/robot
    username: postgres
    password: postgres
  ai:
    openai:
      base-url: https://dashscope.aliyuncs.com/compatible-mode/v1
      api-key: your-api-key
      embedding:
        model: text-embedding-v4
        dimensions: 1536

customer-service:
  md-storage-path: /path/to/your/Markdown
  model: deepseek-v3
  temperature: 0.0
```

请将 `api-key` 和 `md-storage-path` 替换为自己的配置。

### 5. 启动项目

```bash
mvn spring-boot:run
```

默认访问地址：

```text
http://localhost:8080
```

## 前端使用方式

1. 打开 `http://localhost:8080`
2. 在左侧输入问题，点击发送生成 Tile
3. 在画布中点击某个 Tile 的“选择关联”按钮
4. 输入新的问题并发送，新 Tile 会与已选择 Tile 建立边关系
5. 可选择单向边或双向边
6. 可上传 Markdown 文件作为共享 RAG 知识库
7. 点击“重置画布”会清空所有 Tile 节点、消息和边关系

## TODO:
目前为止这仍然是一个相对原始的demo，对于未来的功能有以下展望：
Tile 图数据完善
- 支持查询历史 Tile，并在页面刷新后恢复画布。
- 支持删除单个 Tile，同时级联删除相关消息和边。
- 支持编辑 Tile 标题、备注、关系说明。
- 支持手动新增、删除、修改 Tile 之间的边。
- 支持多种关系类型：EXTENDS、RELATED、SUPPORTS、CONTRADICTS、DEPENDS_ON。

Tile 记忆增强
- 给 Tile 工作记忆增加清晰标签，例如 Tile ID、用户问题、AI回答。
- 支持按图深度遍历相关 Tile，目前默认深度为 3。
- 支持根据边方向决定记忆流向。
- 支持对相关 Tile 记忆做摘要，避免上下文过长。
- 支持区分“对话历史问题”和“知识库问题”，减少模型误用 RAG。

RAG 知识库增强
- 上传 Markdown 后显示向量化进度。
- 支持查看知识库文档切片内容。
- 支持删除知识库时同步删除对应向量数据。
- 支持展示每次回答命中的知识库片段。
- 支持知识库引用来源，让回答更可信。

前端交互升级
- 画布刷新后从数据库加载已有 Tile 图。
- 支持拖拽 Tile，但保留“一键自动排版”。
- 支持框选多个 Tile 作为相关上下文。
- 支持边的可视化编辑，例如点击边修改方向和关系类型。
- 支持搜索 Tile、按关键词定位 Tile。
- 支持缩放、拖动画布、迷你地图。

智能回答体验
- 更具智能的交互方式
