package com.aureli.ai.robot.domain.dos;

import com.baomidou.mybatisplus.annotation.*;
import lombok.*;
import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@TableName("t_label")
public class LabelDO {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String mapId;
    private String name;
    private String colorHex;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
