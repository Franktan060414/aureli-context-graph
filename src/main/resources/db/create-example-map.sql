-- 每次点击创建一张独立示例图谱；Map、标签、Tile、消息、附件和关系由同一条语句原子保存。
WITH example_map AS (
    INSERT INTO t_map (map_id, name, zoom)
    VALUES (:mapId, '示例图谱 · 功能导览', 0.65)
    RETURNING map_id
), example_labels AS (
    INSERT INTO t_label (map_id, name, color_hex)
    SELECT m.map_id, v.name, v.color_hex FROM example_map m
    CROSS JOIN (VALUES
        ('入门导览', '#DBEAFE'),
        ('知识关联', '#D1FAE5'),
        ('思路整合', '#EDE9FE'),
        ('实践记录', '#FEF3C7')
    ) AS v(name, color_hex)
    RETURNING map_id, id, name
), example_tiles AS (
    INSERT INTO t_tile (map_id, tile_id, tile_type, title, content, user_message, answer_summary,
                        weight, label_id, file_name, file_content_type, file_size, file_data)
    SELECT m.map_id, :mapId || '-tile-' || v.slug, v.tile_type, v.title, v.content,
           v.user_message, v.answer, v.weight, l.id, v.file_name, v.file_content_type,
           CASE WHEN v.tile_type = 'FILE' THEN octet_length(convert_to(v.content, 'UTF8')) ELSE NULL END,
           CASE WHEN v.tile_type = 'FILE' THEN convert_to(v.content, 'UTF8') ELSE NULL END
    FROM example_map m
    CROSS JOIN (VALUES
        ('welcome', 'QA', NULL, NULL, 'Aureli 可以怎样帮助我整理知识？', '## 从问题到知识网络
每个 **问答 Tile** 保存一个问题和完整回答。把相关节点连接起来，就能沿已有思路继续探索。

- **问答**：提出问题，保留回答。
- **便签**：记录自己的观察、计划和待办。
- **附件**：在画布保存原始文件；PDF / DOCX 可预览并提取文字。
- **标签**：用颜色区分主题，整理不同知识分组。

这张图谱是数据库中的普通 map。可以修改节点、调整权重、创建标签或删除内容，刷新后仍会保留。后续生成新回答需要配置可用的模型服务。', 3, '入门导览', NULL, NULL),
        ('context', 'QA', NULL, NULL, '如何用已有 Tile 作为下一次提问的上下文？', '## 关联后继续提问
1. 点击一个节点，在详情中选择“关联节点”。
2. 可以同时选择多个已完成的节点。
3. 输入新的问题，系统结合所选来源和可达的关联链生成回答。

**单向关系**表示沿一个思路延伸；**双向关系**表示两个主题相互关联。工作台默认读取最多 3 层记忆。

便签正文、可读取的附件文字和已保存的网页正文也可以作为上下文。共享 RAG 知识库需要另行上传 Markdown 并完成向量化。', 2, '知识关联', NULL, NULL),
        ('organize', 'QA', NULL, NULL, '如何用标签、权重和布局管理复杂图谱？', '## 三个整理维度
| 功能 | 用途 |
| --- | --- |
| 标签 | 用名称与颜色归类主题 |
| 权重 | 用普通、重要、非常重要标记优先级 |
| 排列 | 用树状或分层排列梳理关联 |

这张图谱预设了四个标签，也保留一个没有标签的便签，方便比较。可以拖动节点或调整卡片大小，再尝试不同视图。

节点内容、标签、权重、卡片尺寸与 map 缩放保存在数据库中；节点位置和排列方式保存在当前浏览器。', 2, '知识关联', NULL, NULL),
        ('split-context', 'QA', NULL, NULL, '拆分后，怎样聚焦一个独立的研究问题？', '把一个复杂问题拆成几个可以分别回答的子问题。例如，将“怎样整理并复用知识？”拆为：

- 怎样选取和复用上下文？
- 怎样归类和管理知识？

当前节点用 **DIVIDES** 连接到原问答，展示拆分结果的阅读方式。实际拆分时需要明确关联且仅关联一个已完成的问答 Tile；AI 会先判断拆分价值，再生成子问答。', 1, '思路整合', NULL, NULL),
        ('split-layout', 'QA', NULL, NULL, '拆分后的多个子问题如何独立展开？', '每个子 Tile 都有自己的问题和回答，可以分别继续提问、分配标签或调整重要程度。

原问答继续保留，子问答通过 **DIVIDES** 表达来源。请切换到分支对话或 Tile 列表，查看同一组内容的不同阅读方式。

这组子节点已经预设好，阅读无需调用模型；继续拆分或生成问答会使用正常的后端服务。', 1, '思路整合', NULL, NULL),
        ('fusion', 'QA', NULL, NULL, '结合上下文复用与知识整理，怎样形成一个可执行流程？', '## 一个可以反复使用的流程
1. **记录**：先提出问题，把结论保存成问答 Tile。
2. **补充**：添加便签、附件或网页作为资料来源。
3. **归类**：用标签组织主题，用权重突出关键节点。
4. **延伸**：选择已有 Tile，带着上下文继续提问。
5. **整合**：选择至少两个已完成的问答，将问题与答案融合成新节点。

这个节点有两条 **FUSES** 来源连线，展示融合后的知识汇总。可以查看来源、阅读完整回答，或将它作为下一次提问的上下文。', 3, '思路整合', NULL, NULL),
        ('guide', 'NOTE', '先试试这几个操作', '功能导览

1. 点击问答 Tile，阅读完整问题和回答。
2. 打开“全页面查看”，体验长内容阅读。
3. 把一个节点设为关联来源，观察选择状态。
4. 打开“标签”，修改颜色或新建一个标签。
5. 修改这张便签，刷新确认内容已经保存。
6. 切换图谱、Tile 列表和分支对话视图。

需要生成新回答时，先在服务设置中配置模型。', NULL, NULL, 2, '入门导览', NULL, NULL),
        ('checklist', 'NOTE', '我的探索清单', '待办清单

□ 选择一个值得深入研究的主题
□ 为资料节点设置标签
□ 添加一份 PDF / DOCX 或公开网页
□ 关联相关 Tile，提出下一步问题
□ 尝试拆分或融合问答
□ 导出图谱留存

这张便签可直接编辑，把清单改成自己的计划。', NULL, NULL, 1, '实践记录', NULL, NULL),
        ('scratch', 'NOTE', '没有标签的自由便签', '便签适合记录自己的想法，不必先发起 AI 问答。

这张便签没有标签，也没有关联来源。可以给它分配标签，与其他节点建立联系，或删除它。

示例图谱可正常编辑、清空或删除。点击“显示示例”会创建一张新的示例图谱，不会覆盖已有内容。', NULL, NULL, 1, NULL, NULL, NULL),
        ('file', 'FILE', '示例使用说明.txt', 'Aureli 示例附件

这是一个真实保存在数据库中的文本附件，可通过文件 Tile 下载。
PDF / DOCX 可通过同一入口上传、预览和提取正文，图片附件可显示缩略图。
请添加自己的文件体验这些功能。

示例图谱可以编辑、清空或删除，修改会正常保存。
', NULL, NULL, 1, '实践记录', '示例使用说明.txt', 'text/plain; charset=UTF-8')
    ) AS v(slug, tile_type, title, content, user_message, answer, weight, label_name, file_name, file_content_type)
    LEFT JOIN example_labels l ON l.map_id = m.map_id AND l.name = v.label_name
    RETURNING map_id, tile_id, tile_type, user_message, answer_summary, create_time
), example_messages AS (
    INSERT INTO t_tile_message (map_id, tile_id, role, content, create_time)
    SELECT t.map_id, t.tile_id, v.role, v.content,
           t.create_time + v.offset_ms * INTERVAL '1 millisecond'
    FROM example_tiles t
    CROSS JOIN LATERAL (VALUES ('user', t.user_message, 0), ('assistant', t.answer_summary, 1)) AS v(role, content, offset_ms)
    WHERE t.tile_type = 'QA'
    RETURNING id
)
INSERT INTO t_tile_edge (map_id, edge_id, source_tile_id, target_tile_id, direction, relation_type, weight, description)
SELECT m.map_id, :mapId || '-edge-' || v.source || '-' || v.target,
       :mapId || '-tile-' || v.source, :mapId || '-tile-' || v.target,
       v.direction, v.relation_type, 1, v.description
FROM example_map m
CROSS JOIN (VALUES
        ('welcome', 'context', 'DIRECTED', 'EXTENDS', '从入门概念延伸到上下文复用'),
        ('welcome', 'organize', 'DIRECTED', 'EXTENDS', '从入门概念延伸到知识整理'),
        ('context', 'organize', 'UNDIRECTED', 'RELATES', '上下文复用与知识整理相互关联'),
        ('welcome', 'guide', 'DIRECTED', 'EXTENDS', '把功能说明转成操作指南'),
        ('organize', 'checklist', 'DIRECTED', 'EXTENDS', '根据整理方法记录实践清单'),
        ('guide', 'file', 'DIRECTED', 'EXTENDS', '下载附件并体验文件节点'),
        ('welcome', 'split-context', 'DIRECTED', 'DIVIDES', '预设拆分结果：聚焦研究问题'),
        ('welcome', 'split-layout', 'DIRECTED', 'DIVIDES', '预设拆分结果：独立展开子问题'),
        ('context', 'fusion', 'DIRECTED', 'FUSES', '预设融合来源：上下文复用'),
        ('organize', 'fusion', 'DIRECTED', 'FUSES', '预设融合来源：知识整理')
) AS v(source, target, direction, relation_type, description);
