package com.aureli.ai.robot.domain.mapper;

import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;

import java.util.Collection;
import java.util.List;

/**
 * @Date: 2026/8/31 10:00
 * @Version: v1.0.0
 * @Description: Tile 图关系 Mapper
 **/
public interface TileEdgeMapper extends BaseMapper<TileEdgeDO> {

    default List<TileEdgeDO> selectRelatedEdges(String mapId, String tileId) {
        return selectList(Wrappers.<TileEdgeDO>lambdaQuery()
                .eq(TileEdgeDO::getMapId, mapId)
                .and(q -> q.eq(TileEdgeDO::getSourceTileId, tileId).or().eq(TileEdgeDO::getTargetTileId, tileId)));
    }

    /** 只读取工作记忆范围内两端均可见的关系，不引入其他分支。 */
    default List<TileEdgeDO> selectWithinTileIds(String mapId, Collection<String> tileIds) {
        if (tileIds == null || tileIds.size() < 2) {
            return List.of();
        }
        return selectList(Wrappers.<TileEdgeDO>lambdaQuery()
                .eq(TileEdgeDO::getMapId, mapId).in(TileEdgeDO::getSourceTileId, tileIds)
                .in(TileEdgeDO::getTargetTileId, tileIds)
                .orderByAsc(TileEdgeDO::getId));
    }

}
