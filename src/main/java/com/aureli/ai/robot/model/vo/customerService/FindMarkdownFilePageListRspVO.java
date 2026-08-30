package com.aureli.ai.robot.model.vo.customerService;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * @Author: 犬小哈
 * @Date: 2026/8/23 15:48
 * @Version: v1.0.0
 * @Description: 查询 Markdown 问答文件列表
 **/
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class FindMarkdownFilePageListRspVO {

    /**
     * 文件 ID
     */
    private Long id;

    /**
     * 文件原始名称
     */
    private String originalFileName;

    /**
     * 文件大小
     */
    private String fileSize;

    /**
     * 处理状态：0-待处理 1-向量化中 2-已完成 3-失败
     */
    private Integer status;

    /**
     * 发布时间
     */
    private LocalDateTime createTime;

    /**
     * 更新时间
     */
    private LocalDateTime updateTime;

    /**
     * 备注
     */
    private String remark;

}
