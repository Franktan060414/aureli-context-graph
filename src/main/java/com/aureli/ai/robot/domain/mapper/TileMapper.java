package com.aureli.ai.robot.domain.mapper;

import com.aureli.ai.robot.domain.dos.TileDO;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;

import java.util.Collection;
import java.util.List;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.type.ByteArrayTypeHandler;

/**
 * @Date: 2026/8/31 10:00
 * @Version: v1.0.0
 * @Description: Tile 节点 Mapper
 **/
public interface TileMapper extends BaseMapper<TileDO> {
    @Select("SELECT file_data FROM t_tile WHERE map_id = #{mapId} AND tile_id = #{tileId} AND tile_type = 'FILE'")
    @Results(@Result(column = "file_data", property = "fileData", typeHandler = ByteArrayTypeHandler.class))
    TileDO selectFileData(@Param("mapId") String mapId, @Param("tileId") String tileId);
    default List<TileDO> selectByTileIds(String mapId, Collection<String> tileIds) {
        if (tileIds == null || tileIds.isEmpty()) {
            return List.of();
        }
        return selectList(Wrappers.<TileDO>lambdaQuery().eq(TileDO::getMapId, mapId).in(TileDO::getTileId, tileIds));
    }
}
