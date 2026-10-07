package com.aureli.ai.robot.advisor;

import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.dos.TileMessageDO;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.prompt.CustomerServicePrompts;
import com.google.common.collect.Lists;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisor;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisorChain;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.messages.UserMessage;
import reactor.core.publisher.Flux;

import java.util.ArrayDeque;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Queue;
import java.util.Set;

/**
 * @Date: 2026/8/20 18:56
 * @Version: v1.0.0
 * @Description: 自定义 Tile 图记忆 Advisor
 **/
@Slf4j
public class CustomChatMemoryAdvisor implements StreamAdvisor {

    private static final String DIRECTED = "DIRECTED";
    private static final String UNDIRECTED = "UNDIRECTED";

    private final TileMessageMapper tileMessageMapper;
    private final TileMapper tileMapper;
    private final TileEdgeMapper tileEdgeMapper;
    private final List<String> startTileIds;
    private final int maxDepth;
    private final List<TileEdgeDO> pendingEdges;

    public CustomChatMemoryAdvisor(TileMessageMapper tileMessageMapper,
                                   TileEdgeMapper tileEdgeMapper,
                                   TileMapper tileMapper,
                                   Collection<String> startTileIds,
                                   int maxDepth) {
        this(tileMessageMapper, tileEdgeMapper, tileMapper, startTileIds, maxDepth, List.of());
    }

    public CustomChatMemoryAdvisor(TileMessageMapper tileMessageMapper,
                                   TileEdgeMapper tileEdgeMapper,
                                   TileMapper tileMapper,
                                   Collection<String> startTileIds,
                                   int maxDepth,
                                   Collection<TileEdgeDO> pendingEdges) {
        this.tileMessageMapper = tileMessageMapper;
        this.tileMapper = tileMapper;
        this.tileEdgeMapper = tileEdgeMapper;
        this.startTileIds = startTileIds == null ? List.of() : startTileIds.stream()
                .filter(Objects::nonNull)
                .filter(tileId -> !tileId.isBlank())
                .distinct()
                .toList();
        this.maxDepth = Math.max(maxDepth, 0);
        this.pendingEdges = pendingEdges == null ? List.of() : List.copyOf(pendingEdges);
    }

    @Override
    public int getOrder() {
        return 1; // 在知识检索判定之前加载 Tile 工作记忆
    }

    @Override
    public String getName() {
        return this.getClass().getSimpleName();
    }

    @Override
    public Flux<ChatClientResponse> adviseStream(ChatClientRequest chatClientRequest, StreamAdvisorChain streamAdvisorChain) {
        log.info("## 自定义 Tile 图记忆 Advisor...");

        Set<String> relatedTileIds = collectRelatedTileIds();
        log.info("## Tile 工作记忆范围: startTileIds={}, maxDepth={}, resolvedTileIds={}",
                startTileIds, maxDepth, relatedTileIds);
        List<TileMessageDO> messages = tileMessageMapper.selectByTileIds(relatedTileIds);
        Map<String, Integer> weights = new HashMap<>();
        List<Message> artifactMessages = Lists.newArrayList();
        if (!relatedTileIds.isEmpty()) {
            tileMapper.selectByTileIds(relatedTileIds)
                    .forEach(tile -> {
                        weights.put(tile.getTileId(), tile.getWeight());
                        if ("NOTE".equals(tile.getTileType())) {
                            artifactMessages.add(new UserMessage(CustomerServicePrompts.tileMemory(
                                    tile.getTileId(), tile.getWeight(),
                                    "便签：" + tile.getTitle() + "\n" + tile.getContent())));
                        } else if ("FILE".equals(tile.getTileType()) && tile.getContent() != null && !tile.getContent().isBlank()) {
                            artifactMessages.add(new UserMessage(CustomerServicePrompts.tileMemory(
                                    tile.getTileId(), tile.getWeight(),
                                    "文件正文：" + (tile.getFileName() == null ? tile.getTitle() : tile.getFileName())
                                            + "\n" + tile.getContent())));
                        }
                    });
        }

        // 所有消息
        List<Message> messageList = Lists.newArrayList();
        messageList.addAll(artifactMessages);

        // 将数据库记录转换为对应类型的消息
        for (TileMessageDO tileMessageDO : messages) {
            // 消息类型
            String type  = tileMessageDO.getRole();
            String content = CustomerServicePrompts.tileMemory(tileMessageDO.getTileId(),
                    weights.get(tileMessageDO.getTileId()), tileMessageDO.getContent());
            if (Objects.equals(type, MessageType.USER.getValue())) { // 用户消息
                Message userMessage = new UserMessage(content);
                messageList.add(userMessage);
            } else if (Objects.equals(type, MessageType.ASSISTANT.getValue())) { // AI 助手消息
                Message assistantMessage = new AssistantMessage(content);
                messageList.add(assistantMessage);
            }
        }

        // 关系只作为参考数据注入；保持历史角色、顺序和原始用户问题。
        List<TileEdgeDO> storedEdges = relatedTileIds.size() < 2 ? List.of()
                : tileEdgeMapper.selectWithinTileIds(relatedTileIds);
        List<TileEdgeDO> visiblePendingEdges = pendingEdges.stream()
                .filter(edge -> startTileIds.contains(edge.getSourceTileId()))
                .toList();
        if (!storedEdges.isEmpty() || !visiblePendingEdges.isEmpty()) {
            messageList.add(new UserMessage(CustomerServicePrompts.tileRelations(storedEdges, visiblePendingEdges)));
        }

        // 除了记忆消息，还需要添加当前用户消息
        messageList.addAll(chatClientRequest.prompt().getInstructions());

        // 构建一个新的 ChatClientRequest 请求对象
        ChatClientRequest processedChatClientRequest = chatClientRequest
                .mutate()
                .prompt(chatClientRequest.prompt().mutate().messages(messageList).build())
                .build();

        return streamAdvisorChain.nextStream(processedChatClientRequest);
    }

    private Set<String> collectRelatedTileIds() {
        Set<String> visited = new LinkedHashSet<>();
        Queue<TileDepth> queue = new ArrayDeque<>();

        startTileIds.forEach(tileId -> {
            visited.add(tileId);
            queue.offer(new TileDepth(tileId, 0));
        });

        while (!queue.isEmpty()) {
            TileDepth current = queue.poll();
            if (current.depth() >= maxDepth) {
                continue;
            }

            for (TileEdgeDO edge : tileEdgeMapper.selectRelatedEdges(current.tileId())) {
                String nextTileId = nextTileId(current.tileId(), edge);
                if (nextTileId == null || visited.contains(nextTileId)) {
                    continue;
                }
                visited.add(nextTileId);
                queue.offer(new TileDepth(nextTileId, current.depth() + 1));
            }
        }

        return visited;
    }

    private String nextTileId(String currentTileId, TileEdgeDO edge) {
        if (Objects.equals(edge.getDirection(), UNDIRECTED)) {
            if (Objects.equals(edge.getSourceTileId(), currentTileId)) {
                return edge.getTargetTileId();
            }
            if (Objects.equals(edge.getTargetTileId(), currentTileId)) {
                return edge.getSourceTileId();
            }
        }

        // 有向边保存为「上下文来源 -> 新 Tile」，读取记忆应反向追溯来源。
        // 沿出边访问子节点会把共同父节点下的其他分支混入当前上下文。
        if (Objects.equals(edge.getDirection(), DIRECTED)
                && Objects.equals(edge.getTargetTileId(), currentTileId)) {
            return edge.getSourceTileId();
        }

        return null;
    }

    private record TileDepth(String tileId, int depth) {
    }
}
