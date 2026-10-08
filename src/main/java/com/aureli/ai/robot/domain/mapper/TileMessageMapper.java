package com.aureli.ai.robot.domain.mapper;

import com.aureli.ai.robot.domain.dos.TileMessageDO;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;

import java.util.Collection;
import java.util.List;

/**
 * @Date: 2026/8/31 10:00
 * @Version: v1.0.0
 * @Description: Tile 消息 Mapper
 **/
public interface TileMessageMapper extends BaseMapper<TileMessageDO> {

    default List<TileMessageDO> selectByTileIds(Collection<String> tileIds) {
        if (tileIds == null || tileIds.isEmpty()) {
            return List.of();
        }

        return selectList(Wrappers.<TileMessageDO>lambdaQuery()
                .in(TileMessageDO::getTileId, tileIds)
                .orderByAsc(TileMessageDO::getCreateTime));
    }

}
