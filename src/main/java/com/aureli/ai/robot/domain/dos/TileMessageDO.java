package com.aureli.ai.robot.domain.dos;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * @Date: 2026/8/31 10:00
 * @Version: v1.0.0
 * @Description: Tile 对话消息
 **/
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@TableName("t_tile_message")
public class TileMessageDO {

    @TableId(type = IdType.AUTO)
    private Long id;
    private String tileId;
    private String role;
    private String content;
    private LocalDateTime createTime;

}
