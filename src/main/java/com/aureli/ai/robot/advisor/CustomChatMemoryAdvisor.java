package com.aureli.ai.robot.advisor;

import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.dos.TileMessageDO;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
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
import java.util.LinkedHashSet;
import java.util.List;
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
    private final TileEdgeMapper tileEdgeMapper;
    private final List<String> startTileIds;
    private final int maxDepth;

    public CustomChatMemoryAdvisor(TileMessageMapper tileMessageMapper,
                                   TileEdgeMapper tileEdgeMapper,
                                   Collection<String> startTileIds,
                                   int maxDepth) {
        this.tileMessageMapper = tileMessageMapper;
        this.tileEdgeMapper = tileEdgeMapper;
        this.startTileIds = startTileIds == null ? List.of() : startTileIds.stream()
                .filter(Objects::nonNull)
                .filter(tileId -> !tileId.isBlank())
                .distinct()
                .toList();
        this.maxDepth = Math.max(maxDepth, 0);
    }

    @Override
    public int getOrder() {
        return 2; // order 值越小，越先执行
    }

    @Override
    public String getName() {
        return this.getClass().getSimpleName();
    }

    @Override
    public Flux<ChatClientResponse> adviseStream(ChatClientRequest chatClientRequest, StreamAdvisorChain streamAdvisorChain) {
        log.info("## 自定义 Tile 图记忆 Advisor...");

        Set<String> relatedTileIds = collectRelatedTileIds();
        List<TileMessageDO> messages = tileMessageMapper.selectByTileIds(relatedTileIds);

        // 所有消息
        List<Message> messageList = Lists.newArrayList();

        // 将数据库记录转换为对应类型的消息
        for (TileMessageDO tileMessageDO : messages) {
            // 消息类型
            String type  = tileMessageDO.getRole();
            if (Objects.equals(type, MessageType.USER.getValue())) { // 用户消息
                Message userMessage = new UserMessage(tileMessageDO.getContent());
                messageList.add(userMessage);
            } else if (Objects.equals(type, MessageType.ASSISTANT.getValue())) { // AI 助手消息
                Message assistantMessage = new AssistantMessage(tileMessageDO.getContent());
                messageList.add(assistantMessage);
            }
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

        if (Objects.equals(edge.getDirection(), DIRECTED)
                && Objects.equals(edge.getSourceTileId(), currentTileId)) {
            return edge.getTargetTileId();
        }

        return null;
    }

    private record TileDepth(String tileId, int depth) {
    }
}
