package com.aureli.ai.robot.service;

import com.aureli.ai.robot.domain.dos.MapDO;
import com.aureli.ai.robot.domain.mapper.MapMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;

/** Creates a fresh, editable example workspace only when requested. */
@Service
public class ExampleMapService {
    private final NamedParameterJdbcTemplate jdbc;
    private final MapMapper maps;
    private final String sql;

    public ExampleMapService(JdbcTemplate jdbc, MapMapper maps) throws IOException {
        this.jdbc = new NamedParameterJdbcTemplate(jdbc);
        this.maps = maps;
        this.sql = new ClassPathResource("db/create-example-map.sql").getContentAsString(StandardCharsets.UTF_8);
    }

    @Transactional
    public MapDO create() {
        String mapId = "map-" + UUID.randomUUID();
        jdbc.update(sql, Map.of("mapId", mapId));
        return maps.selectOne(Wrappers.<MapDO>lambdaQuery().eq(MapDO::getMapId, mapId));
    }
}
