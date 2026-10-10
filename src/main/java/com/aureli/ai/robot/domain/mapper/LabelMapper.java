package com.aureli.ai.robot.domain.mapper;

import com.aureli.ai.robot.domain.dos.LabelDO;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface LabelMapper extends BaseMapper<LabelDO> {
    // 同一 Map 内串行处理标签修改、删除与批量设置，防止检查与保存之间发生变化。
    @Select("SELECT map_id FROM t_map WHERE map_id = #{mapId} FOR UPDATE")
    String lockMap(@Param("mapId") String mapId);
}
