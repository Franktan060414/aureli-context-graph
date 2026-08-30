package com.aureli.ai.robot.utils;

import org.apache.commons.lang3.StringUtils;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * @Date: 2026/8/19 18:57
 * @Version: v1.0.0
 * @Description: JSON 工具类
 **/
public class JsonUtil {

    private static ObjectMapper OBJECT_MAPPER = JsonMapper.builder()
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .disable(SerializationFeature.FAIL_ON_EMPTY_BEANS)
            .build();

    /**
     * 初始化：统一使用 Spring Boot 个性化配置的 ObjectMapper
     *
     * @param objectMapper
     */
    public static void init(ObjectMapper objectMapper) {
        OBJECT_MAPPER = objectMapper;
    }

    /**
     *  将对象转换为 JSON 字符串
     * @param obj
     * @return
     */
    public static String toJsonString(Object obj) {
        return OBJECT_MAPPER.writeValueAsString(obj);
    }

    /**
     * 将 JSON 字符串转换为对象
     *
     * @param jsonStr
     * @param clazz
     * @return
     * @param <T>
     */
    public static <T> T parseObject(String jsonStr, Class<T> clazz) {
        if (StringUtils.isBlank(jsonStr)) {
            return null;
        }

        return OBJECT_MAPPER.readValue(jsonStr, clazz);
    }

    /**
     * 将 JSON 字符串转换为 Map
     * @param jsonStr
     * @param keyClass
     * @param valueClass
     * @return
     * @param <K>
     * @param <V>
     */
    public static <K, V> Map<K, V> parseMap(String jsonStr, Class<K> keyClass, Class<V> valueClass) {
        // 将 JSON 字符串转换为 Map
        return OBJECT_MAPPER.readValue(jsonStr, OBJECT_MAPPER.getTypeFactory().constructMapType(Map.class, keyClass, valueClass));
    }

    /**
     * 将 JSON 字符串解析为指定类型的 List 对象
     *
     * @param jsonStr
     * @param clazz
     * @return
     * @param <T>
     */
    public static <T> List<T> parseList(String jsonStr, Class<T> clazz) {
        // 构造 List<clazz> 对应的 JavaType 后反序列化
        return OBJECT_MAPPER.readValue(jsonStr, OBJECT_MAPPER.getTypeFactory().constructCollectionType(List.class, clazz));
    }

    /**
     * 将 JSON 字符串解析为指定类型的 Set 对象
     *
     * @param jsonStr
     * @param clazz
     * @return
     * @param <T>
     */
    public static <T> Set<T> parseSet(String jsonStr, Class<T> clazz) {
        // 构造 Set<clazz> 对应的 JavaType 后反序列化
        return OBJECT_MAPPER.readValue(jsonStr, OBJECT_MAPPER.getTypeFactory().constructCollectionType(Set.class, clazz));
    }

}
