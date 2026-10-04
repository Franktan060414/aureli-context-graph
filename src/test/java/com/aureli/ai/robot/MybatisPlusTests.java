package com.aureli.ai.robot;

import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import jakarta.annotation.Resource;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.UUID;

@SpringBootTest
@Transactional
class MybatisPlusTests {

    @Resource
    private TileMapper tileMapper;

    /**
     * 添加数据
     */
    @Test
    void testInsert() {
        tileMapper.insert(TileDO.builder()
                .tileId(UUID.randomUUID().toString())
                .title("新 Tile")
                .userMessage("测试问题")
                .createTime(LocalDateTime.now())
                .updateTime(LocalDateTime.now())
                .build());
    }

}
