package com.aureli.ai.robot.domain.dos;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableField;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * @Date: 2026/8/31 10:00
 * @Version: v1.0.0
 * @Description: Tile 节点
 **/
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@TableName("t_tile")
public class TileDO {

    @TableId(type = IdType.AUTO)
    private Long id;
    private String tileId;
    private String title;
    /** QA 问答、NOTE 便签、FILE 临时附件；旧节点默认 QA。 */
    @Builder.Default
    private String tileType = "QA";
    private String content;
    private String fileName;
    private String fileContentType;
    private Long fileSize;
    /** 临时附件随节点一起持久化、删除；图谱快照不读取二进制内容。 */
    @JsonIgnore
    @TableField(select = false)
    private byte[] fileData;
    private String userMessage;
    private String answerSummary;
    /** Tile 重要程度：1 普通，2 重要，3 非常重要。 */
    @Builder.Default
    private Integer weight = 1;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;

}
