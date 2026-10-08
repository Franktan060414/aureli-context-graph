package com.aureli.ai.robot.advisor;

import com.aureli.ai.robot.domain.TileRelationTypes;

import com.aureli.ai.robot.domain.maps.MapIds;

import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.dos.TileMessageDO;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisor;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisorChain;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.transaction.support.TransactionTemplate;
import reactor.core.publisher.Flux;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

/**
 * @Date: 2026/8/20 18:31
 * @Version: v1.0.0
 * @Description: 自定义打印流式日志 Advisor
 **/
@Slf4j
public class CustomStreamLoggerAndMessage2DBAdvisor implements StreamAdvisor {

    private static final String DEFAULT_DIRECTION = "DIRECTED";

    private final TileMapper tileMapper;
    private final TileMessageMapper tileMessageMapper;
    private final TileEdgeMapper tileEdgeMapper;
    private final String tileId;
    private final String mapId;
    private final String userMessage;
    private final List<String> relatedTileIds;
    private final String edgeDirection;
    private final String relationType;
    private final BigDecimal edgeWeight;
    private final String edgeDescription;
    private final TransactionTemplate transactionTemplate;

    public CustomStreamLoggerAndMessage2DBAdvisor(TileMapper tileMapper, TileMessageMapper tileMessageMapper,
            TileEdgeMapper tileEdgeMapper, String tileId, String userMessage, Collection<String> relatedTileIds,
            String edgeDirection, String relationType, BigDecimal edgeWeight, String edgeDescription,
            TransactionTemplate transactionTemplate, String mapId) {
        this.mapId = MapIds.normalize(mapId);
        this.tileMapper = tileMapper;
        this.tileMessageMapper = tileMessageMapper;
        this.tileEdgeMapper = tileEdgeMapper;
        this.tileId = tileId;
        this.userMessage = userMessage;
        this.relatedTileIds = relatedTileIds == null ? List.of() : relatedTileIds.stream()
                .filter(Objects::nonNull)
                .filter(item -> !item.isBlank())
                .filter(item -> !Objects.equals(item, tileId))
                .distinct()
                .toList();
        String normalizedDirection = StringUtils.defaultIfBlank(edgeDirection, DEFAULT_DIRECTION).trim().toUpperCase(java.util.Locale.ROOT);
        this.edgeDirection = "UNDIRECTED".equals(normalizedDirection) ? "UNDIRECTED" : DEFAULT_DIRECTION;
        this.relationType = TileRelationTypes.forDirection(this.edgeDirection);
        this.edgeWeight = normalizeWeight(edgeWeight);
        this.edgeDescription = edgeDescription;
        this.transactionTemplate = transactionTemplate;
    }

    @Override
    public int getOrder() {
        return 99; // order 值越小，越先执行
    }

    @Override
    public String getName() {
        return this.getClass().getSimpleName();
    }

    @Override
    public Flux<ChatClientResponse> adviseStream(ChatClientRequest chatClientRequest, StreamAdvisorChain streamAdvisorChain) {
        Flux<ChatClientResponse> chatClientResponseFlux = streamAdvisorChain.nextStream(chatClientRequest);

        // 创建 AI 流式回答聚合容器（线程安全）
        AtomicReference<StringBuilder> fullContent = new AtomicReference<>(new StringBuilder());

        // 返回处理后的流
        return chatClientResponseFlux
                .doOnNext(response -> {
                    // getResult() 为 null 时，直接跳过
                    if (response.chatResponse() == null || response.chatResponse().getResult() == null) {
                        return;
                    }

                    // 逐块收集内容
                    String chunk = response.chatResponse().getResult().getOutput().getText();

                    log.info("## chunk: {}", chunk);

                    // 若 chunk 块不为空，则追加到 fullContent 中
                    if (chunk != null) {
                        fullContent.get().append(chunk);
                    }
                })
                .doOnComplete(() -> {
                    // 流完成后打印完整回答
                    String completeResponse = fullContent.get().toString();
                    log.info("\n==== FULL AI RESPONSE ====\n{}\n========================", completeResponse);

                    // 开启编程式事务
                    Boolean saved = transactionTemplate.execute(status -> {
                        try {
                            LocalDateTime now = LocalDateTime.now();
                            saveOrUpdateTile(completeResponse, now);
                            saveEdges(now);

                            // 1. 存储用户消息
                            tileMessageMapper.insert(TileMessageDO.builder().mapId(mapId)
                                    .tileId(tileId)
                                    .content(userMessage)
                                    .role(MessageType.USER.getValue()) // 用户消息
                                    .createTime(now)
                                    .build());


                            // 2. 存储 AI 回答
                            tileMessageMapper.insert(TileMessageDO.builder().mapId(mapId)
                                    .tileId(tileId)
                                    .content(completeResponse)
                                    .role(MessageType.ASSISTANT.getValue()) // AI 回答
                                    .createTime(LocalDateTime.now())
                                    .build());

                            return true;
                        } catch (Exception ex) {
                            status.setRollbackOnly(); // 标记事务为回滚
                            log.error("", ex);
                        }
                        return false;
                    });
                    if (!Boolean.TRUE.equals(saved)) {
                        throw new IllegalStateException("Tile persistence failed");
                    }
                })
                .doOnError(error -> {
                    // 出错时打印已收集的部分
                    String partialResponse = fullContent.get().toString();
                    log.error("## Stream 流出现错误，已收集回答如下: {}", partialResponse, error);
                });
    }

    private void saveOrUpdateTile(String completeResponse, LocalDateTime now) {
        TileDO existTile = tileMapper.selectOne(Wrappers.<TileDO>lambdaQuery()
                .eq(TileDO::getTileId, tileId));

        if (existTile != null && !mapId.equals(existTile.getMapId())) {
            throw new IllegalStateException("节点不属于当前 Map");
        }

        if (existTile != null && existTile.getTileType() != null && !"QA".equals(existTile.getTileType())) {
            throw new IllegalStateException("节点 ID 已被便签或附件使用，不能覆盖为问答");
        }

        TileDO tileDO = TileDO.builder().mapId(mapId)
                .id(existTile == null ? null : existTile.getId())
                .tileId(tileId)
                .title(abbreviate(userMessage, 80))
                .userMessage(userMessage)
                .answerSummary(abbreviate(completeResponse, 240))
                .weight(existTile == null || existTile.getWeight() == null ? 1 : existTile.getWeight())
                .createTime(existTile == null ? now : existTile.getCreateTime())
                .updateTime(now)
                .build();

        if (existTile == null) {
            tileMapper.insert(tileDO);
        } else {
            tileMapper.updateById(tileDO);
        }
    }

    /** 为本次回答提供尚未落库的关系，沿用与持久化相同的默认值与归一化规则。 */
    public List<TileEdgeDO> pendingEdges() {
        return relatedTileIds.stream().map(relatedTileId -> TileEdgeDO.builder().mapId(mapId)
                .sourceTileId(relatedTileId)
                .targetTileId(tileId)
                .direction(edgeDirection)
                .relationType(relationType)
                .weight(edgeWeight)
                .description(edgeDescription)
                .build()).toList();
    }

    private void saveEdges(LocalDateTime now) {
        for (TileEdgeDO edge : pendingEdges()) {
            String relatedTileId = edge.getSourceTileId();
            Long relatedTileCount = tileMapper.selectCount(Wrappers.<TileDO>lambdaQuery()
                    .eq(TileDO::getMapId, mapId).eq(TileDO::getTileId, relatedTileId));
            if (relatedTileCount == null || relatedTileCount == 0) {
                throw new IllegalStateException("关联节点不存在或不属于当前 Map");
            }

            Long count = tileEdgeMapper.selectCount(Wrappers.<TileEdgeDO>lambdaQuery()
                    .eq(TileEdgeDO::getMapId, mapId).eq(TileEdgeDO::getSourceTileId, relatedTileId)
                    .eq(TileEdgeDO::getTargetTileId, tileId)
                    .eq(TileEdgeDO::getRelationType, relationType));
            if (count != null && count > 0) {
                continue;
            }

            edge.setEdgeId("edge-" + UUID.randomUUID());
            edge.setCreateTime(now);
            edge.setUpdateTime(now);
            tileEdgeMapper.insert(edge);
        }
    }

    private String abbreviate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength);
    }

    private BigDecimal normalizeWeight(BigDecimal weight) {
        if (weight == null) {
            return BigDecimal.ONE;
        }
        if (weight.compareTo(BigDecimal.ZERO) < 0) {
            return BigDecimal.ZERO;
        }
        if (weight.compareTo(BigDecimal.ONE) > 0) {
            return BigDecimal.ONE;
        }
        return weight;
    }
}
