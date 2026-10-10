package com.aureli.ai.robot.domain.dos;

import com.baomidou.mybatisplus.annotation.*;
import lombok.*;
import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@TableName("t_map")
public class MapDO {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String mapId;
    private String name;
    @Builder.Default
    private Double zoom = 1.0;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
