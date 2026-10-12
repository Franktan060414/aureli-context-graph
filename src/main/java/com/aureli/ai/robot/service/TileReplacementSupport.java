package com.aureli.ai.robot.service;

import com.aureli.ai.robot.domain.TileRelationTypes;
import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.dos.TileMessageDO;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Called inside the generating operation's write transaction, with source tiles locked. */
final class TileReplacementSupport {
    private TileReplacementSupport() {}

    static List<TileEdgeDO> replace(String mapId, List<String> sourceIds, List<String> replacementIds,
                                   TileMapper tiles, TileMessageMapper messages, TileEdgeMapper edges) {
        Set<String> removed = Set.copyOf(sourceIds);
        var incident = Wrappers.<TileEdgeDO>lambdaQuery().eq(TileEdgeDO::getMapId, mapId)
                .and(query -> query.in(TileEdgeDO::getSourceTileId, sourceIds)
                        .or().in(TileEdgeDO::getTargetTileId, sourceIds));
        List<TileEdgeDO> originals = edges.selectList(incident.orderByAsc(TileEdgeDO::getId).last("FOR UPDATE"));
        List<TileEdgeDO> links = new ArrayList<>();
        LocalDateTime now = LocalDateTime.now();
        for (TileEdgeDO original : originals) {
            boolean sourceRemoved = removed.contains(original.getSourceTileId());
            boolean targetRemoved = removed.contains(original.getTargetTileId());
            // Internal fusion edges disappear, rather than becoming self-links.
            if (sourceRemoved && targetRemoved) continue;
            for (String replacementId : replacementIds) {
                TileEdgeDO link = TileEdgeDO.builder().mapId(mapId).edgeId("edge-" + UUID.randomUUID())
                        .sourceTileId(sourceRemoved ? replacementId : original.getSourceTileId())
                        .targetTileId(targetRemoved ? replacementId : original.getTargetTileId())
                        .direction(original.getDirection()).relationType(TileRelationTypes.forEdge(original))
                        .weight(original.getWeight()).description(original.getDescription())
                        .createTime(original.getCreateTime()).updateTime(now).build();
                edges.insert(link);
                links.add(link);
            }
        }
        edges.delete(Wrappers.<TileEdgeDO>lambdaQuery().eq(TileEdgeDO::getMapId, mapId)
                .and(query -> query.in(TileEdgeDO::getSourceTileId, sourceIds)
                        .or().in(TileEdgeDO::getTargetTileId, sourceIds)));
        messages.delete(Wrappers.<TileMessageDO>lambdaQuery().eq(TileMessageDO::getMapId, mapId)
                .in(TileMessageDO::getTileId, sourceIds));
        if (tiles.delete(Wrappers.<TileDO>lambdaQuery().eq(TileDO::getMapId, mapId)
                .in(TileDO::getTileId, sourceIds)) != sourceIds.size())
            throw new IllegalArgumentException("来源 Tile 已发生变化，请同步图谱后重试。");
        return List.copyOf(links);
    }
}
