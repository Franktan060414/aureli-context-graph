export function demoGraph() {
  const content = [
    [
      "如何构建一个知识图谱？",
      "知识图谱以实体、关系和属性为核心，将分散的信息组织成可查询、可推理的知识网络。\n\n构建流程：数据采集 → 知识抽取 → 知识融合 → 图谱存储 → 检索与应用。",
      [],
    ],
    [
      "如何从文档中抽取知识？",
      "通过实体识别与关系抽取，将非结构化文档转化为结构化三元组。结合语言模型，可提取领域概念及它们之间的联系。",
      ["tile-001"],
    ],
    [
      "RAG 如何增强图谱问答？",
      "RAG 在回答前检索相关知识，为语言模型提供可靠的事实依据。图谱检索与向量检索可以互补，实现更完整的上下文。",
      ["tile-001"],
    ],
    [
      "Tile 之间如何共享记忆？",
      "每个 Tile 默认隔离工作记忆。选择相关 Tile 并建立关系后，新问题会沿来源链读取上下文。所有 Tile 共享 RAG 知识库。",
      ["tile-001"],
    ],
    [
      "实体消歧有哪些方法？",
      "利用名称、属性和上下文进行相似度匹配，合并指向同一对象的实体，减少知识冗余。",
      ["tile-002"],
    ],
    [
      "向量检索与图检索的区别",
      "向量检索寻找语义相似的内容；图检索沿实体关系查找关联知识。结合两者能够兼顾语义与结构。",
      ["tile-003"],
    ],
  ];
  const tiles = content.map(([message, answer, relatedTileIds], index) => ({
    id: `tile-${String(index + 1).padStart(3, "0")}`,
    message,
    answer,
    relatedTileIds,
    status: "ready",
    weight: 1,
    kind: index === 0 ? "root" : index === 2 || index === 5 ? "rag" : "memory",
  }));
  const edges = tiles.flatMap((t) =>
    t.relatedTileIds.map((id) => ({
      id: `${id}-${t.id}`,
      sourceTileId: id,
      targetTileId: t.id,
      direction: "DIRECTED",
      relationType: "EXTENDS",
      weight: 1,
      description: "延伸探索",
    })),
  );
  return { tiles, edges };
}
export function demoFiles() {
  return [
    {
      id: 1,
      originalFileName: "知识图谱入门指南.md",
      fileSize: "12.8 KB",
      status: 2,
      remark: "知识图谱基础概念与构建流程",
      createTime: "2026-10-01T09:30:00",
    },
    {
      id: 2,
      originalFileName: "RAG 检索增强问答.md",
      fileSize: "8.4 KB",
      status: 2,
      remark: "检索策略与问答实践",
      createTime: "2026-10-02T14:20:00",
    },
    {
      id: 3,
      originalFileName: "Tile 工作记忆说明.md",
      fileSize: "5.2 KB",
      status: 1,
      remark: "上下文隔离与关联机制",
      createTime: "2026-10-03T11:10:00",
    },
  ];
}
