package com.aureli.ai.robot.domain.dos;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * @Date: 2026/8/31 10:00
 * @Version: v1.0.0
 * @Description: Tile 图关系边
 **/
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@TableName("t_tile_edge")
public class TileEdgeDO {

    @TableId(type = IdType.AUTO)
    private Long id;
    private String edgeId;
    private String sourceTileId;
    private String targetTileId;
    private String direction;
    private String relationType;
    private BigDecimal weight;
    private String description;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;

}
