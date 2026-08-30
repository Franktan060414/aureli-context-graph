package com.aureli.ai.robot.config;

import com.aureli.ai.robot.utils.JsonUtil;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.ObjectMapper;

/**
 * @author: 犬小哈
 * @date: 2026/8/19 21:30
 * @version: v1.0.0
 * @description: 初始化 JsonUtil，让其与 Spring 容器共用同一个 ObjectMapper，
 **/
@Configuration
public class JsonUtilInitializer {

    public JsonUtilInitializer(ObjectMapper objectMapper) {
        JsonUtil.init(objectMapper);
    }

}
