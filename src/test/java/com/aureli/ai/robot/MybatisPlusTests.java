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

    @Resource
    private com.aureli.ai.robot.domain.mapper.MapMapper mapMapper;

    /**
     * 添加数据
     */
    @Test
    void testInsert() {
        String mapId = "map-test-" + UUID.randomUUID();
        mapMapper.insert(com.aureli.ai.robot.domain.dos.MapDO.builder().mapId(mapId).name("测试图谱").build());
        tileMapper.insert(TileDO.builder().mapId(mapId)
                .tileId(UUID.randomUUID().toString())
                .title("新 Tile")
                .userMessage("测试问题")
                .createTime(LocalDateTime.now())
                .updateTime(LocalDateTime.now())
                .build());
    }

}
