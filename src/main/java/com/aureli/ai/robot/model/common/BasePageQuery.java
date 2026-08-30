package com.aureli.ai.robot.model.common;

import lombok.Data;

/**
 * @Date: 2026/8/21 17:22
 * @Version: v1.0.0
 * @Description: TODO
 **/
@Data
public class BasePageQuery {
    /**
     * 当前页码, 默认第一页
     */
    private Long current = 1L;
    /**
     * 每页展示的数据数量，默认每页展示 10 条数据
     */
    private Long size = 10L;
}
