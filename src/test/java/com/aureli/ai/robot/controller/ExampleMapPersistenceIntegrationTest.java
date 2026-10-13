package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.reader.TileFileContentReader;
import com.aureli.ai.robot.service.ExampleMapService;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Creates and removes a private schema; never edits existing workspace data. */
@EnabledIfSystemProperty(named = "aureli.example.integration", matches = "true")
class ExampleMapPersistenceIntegrationTest {
    @Test void createsOnClickAndPreservesIndependentMapsEditsClearsAndDeletion() throws Exception {
        withSchema((ds, jdbc) -> {
            var initializer = new ResourceDatabasePopulator(new ClassPathResource("schema.sql"));
            initializer.execute(ds);
            var config = new MybatisConfiguration();
            config.setMapUnderscoreToCamelCase(true);
            for (var mapper : List.of(MapMapper.class, TileMapper.class, TileMessageMapper.class, TileEdgeMapper.class, LabelMapper.class))
                config.addMapper(mapper);
            var factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(ds);
            factory.setConfiguration(config);
            var session = new SqlSessionTemplate(factory.getObject());
            var controller = new TileWorkspaceController(session.getMapper(TileMapper.class),
                    session.getMapper(TileEdgeMapper.class), session.getMapper(TileMessageMapper.class),
                    new TileFileContentReader(), session.getMapper(LabelMapper.class));
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_map", Integer.class));
            var service = new ExampleMapService(jdbc, session.getMapper(MapMapper.class));
            var endpoint = new ExampleMapController(service);
            String mapId = endpoint.create().getData().getMapId();
            String guideId = mapId + "-tile-guide", contextId = mapId + "-tile-context";
            assertEquals("示例图谱 · 功能导览", jdbc.queryForObject("SELECT name FROM t_map WHERE map_id=?", String.class, mapId));
            var workspace = controller.workspace(mapId).getBody().getData();
            assertEquals(10, workspace.tiles().size());
            assertEquals(10, workspace.edges().size());
            assertEquals(4, workspace.labels().size());
            assertEquals(6, workspace.tiles().stream().filter(t -> "QA".equals(t.tileType())).count());
            assertEquals(3, workspace.tiles().stream().filter(t -> "NOTE".equals(t.tileType())).count());
            assertTrue(workspace.tiles().stream().filter(t -> "QA".equals(t.tileType()))
                    .allMatch(t -> t.answer() != null && !t.answer().isBlank()));
            assertEquals(12, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_message WHERE map_id=?", Integer.class, mapId));
            assertEquals(java.util.Set.of("EXTENDS", "RELATES", "DIVIDES", "FUSES"),
                    workspace.edges().stream().map(TileWorkspaceController.Edge::relationType).collect(java.util.stream.Collectors.toSet()));
            assertEquals(java.util.Set.of(1, 2, 3), workspace.tiles().stream().map(TileWorkspaceController.Node::weight)
                    .collect(java.util.stream.Collectors.toSet()));
            var file = workspace.tiles().stream().filter(t -> "FILE".equals(t.tileType())).findFirst().orElseThrow();
            var bytes = jdbc.queryForObject("SELECT file_data FROM t_tile WHERE tile_id=?", byte[].class, file.id());
            assertEquals(file.fileSize(), (long) bytes.length);
            assertEquals(file.content(), new String(bytes, StandardCharsets.UTF_8));
            assertEquals(1, workspace.tiles().stream().filter(t -> t.labelId() == null).count());
            initializer.execute(ds);
            assertEquals(workspace, controller.workspace(mapId).getBody().getData());

            jdbc.update("UPDATE t_map SET name='我的图谱', zoom=0.9 WHERE map_id=?", mapId);
            jdbc.update("UPDATE t_tile SET content='我修改的便签', weight=3, label_id=NULL WHERE tile_id=?", guideId);
            jdbc.update("DELETE FROM t_tile WHERE tile_id=?", contextId);
            jdbc.update("UPDATE t_label SET name='我的标签' WHERE map_id=? AND name='入门导览'", mapId);
            jdbc.update("INSERT INTO t_map(map_id,name) VALUES ('my-map','已有图谱')");
            jdbc.update("INSERT INTO t_tile(map_id,tile_id,tile_type,title,content) VALUES ('my-map','my-note','NOTE','已有便签','我的内容')");
            initializer.execute(ds);
            assertEquals("我的图谱", jdbc.queryForObject("SELECT name FROM t_map WHERE map_id=?", String.class, mapId));
            assertEquals("我修改的便签", jdbc.queryForObject("SELECT content FROM t_tile WHERE tile_id=?", String.class, guideId));
            assertEquals(9, controller.workspace(mapId).getBody().getData().tiles().size());
            assertEquals("我的内容", jdbc.queryForObject("SELECT content FROM t_tile WHERE tile_id='my-note'", String.class));
            // Clearing keeps labels but must not repopulate Tiles on startup.
            jdbc.update("DELETE FROM t_tile WHERE map_id=?", mapId);
            initializer.execute(ds);
            assertTrue(controller.workspace(mapId).getBody().getData().tiles().isEmpty());
            assertEquals(4, controller.workspace(mapId).getBody().getData().labels().size());
            jdbc.update("DELETE FROM t_map WHERE map_id=?", mapId);
            initializer.execute(ds);
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_map WHERE map_id=?", Integer.class, mapId));
            String nextId = endpoint.create().getData().getMapId();
            assertNotEquals(mapId, nextId);
            var fresh = controller.workspace(nextId).getBody().getData();
            assertEquals(10, fresh.tiles().size());
            assertEquals(4, fresh.labels().size());
            assertTrue(fresh.tiles().stream().noneMatch(t -> workspace.tiles().stream().anyMatch(old -> old.id().equals(t.id()))));
            assertTrue(fresh.labels().stream().noneMatch(l -> workspace.labels().stream().anyMatch(old -> old.getId().equals(l.getId()))));
            assertEquals("我的内容", jdbc.queryForObject("SELECT content FROM t_tile WHERE tile_id='my-note'", String.class));
        });
    }

    @Test void failedClickRollsBackAllRowsAndCanRetry() throws Exception {
        withSchema((ds, jdbc) -> {
            new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(ds);
            String sql = new ClassPathResource("db/create-example-map.sql").getContentAsString(StandardCharsets.UTF_8);
            var named = new org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate(jdbc);
            jdbc.execute("ALTER TABLE t_tile_edge ADD CONSTRAINT reject_example CHECK (relation_type <> 'FUSES')");
            assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                    () -> named.update(sql, java.util.Map.of("mapId", "retry-example")));
            for (String table : List.of("t_map", "t_tile", "t_label", "t_tile_message", "t_tile_edge"))
                assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class));
            jdbc.execute("ALTER TABLE t_tile_edge DROP CONSTRAINT reject_example");
            named.update(sql, java.util.Map.of("mapId", "retry-example"));
            assertEquals(10, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile", Integer.class));
            named.update(sql, java.util.Map.of("mapId", "another-example"));
            assertEquals(20, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile", Integer.class));
        });
    }

    private void withSchema(Check check) throws Exception {
        String url = System.getenv().getOrDefault("AURELI_TEST_JDBC_URL", "jdbc:postgresql://localhost:5432/robot");
        String user = System.getenv().getOrDefault("AURELI_TEST_DB_USER", "postgres");
        String password = System.getenv().getOrDefault("AURELI_TEST_DB_PASSWORD", "postgres");
        var admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        String schema = "example_check_" + UUID.randomUUID().toString().replace("-", "");
        admin.execute("CREATE SCHEMA " + schema);
        var ds = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema, user, password);
        try { check.run(ds, new JdbcTemplate(ds)); }
        finally { admin.execute("DROP SCHEMA " + schema + " CASCADE"); }
    }

    private interface Check { void run(DriverManagerDataSource ds, JdbcTemplate jdbc) throws Exception; }
}
