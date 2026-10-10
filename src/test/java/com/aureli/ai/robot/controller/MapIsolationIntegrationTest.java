package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.advisor.CustomChatMemoryAdvisor;
import com.aureli.ai.robot.domain.dos.*;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.model.vo.customerService.*;
import com.aureli.ai.robot.reader.TileFileContentReader;
import com.aureli.ai.robot.service.TileFusionService;
import com.aureli.ai.robot.service.impl.CustomerServiceImpl;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import org.apache.ibatis.session.SqlSession;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisorChain;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.*;
import reactor.core.publisher.Flux;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Opt-in; uses an isolated schema and drops ONLY that schema in finally. Never touches user tables. */
@EnabledIfSystemProperty(named = "aureli.map.integration", matches = "true")
class MapIsolationIntegrationTest {
    @Test void repeatedFreshInitializationCreatesNoMap() {
        String schemaName = "map_empty_" + UUID.randomUUID().toString().replace("-", "");
        String url = System.getProperty("aureli.map.jdbc", "jdbc:postgresql://localhost:5432/robot");
        String user = System.getProperty("aureli.map.user", "postgres");
        String password = System.getProperty("aureli.map.password", "postgres");
        var adminJdbc = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        adminJdbc.execute("CREATE SCHEMA " + schemaName);
        var ds = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schemaName, user, password);
        var jdbc = new JdbcTemplate(ds);
        try {
            var migration = new ResourceDatabasePopulator(new ClassPathResource("schema.sql"));
            migration.execute(ds);
            migration.execute(ds);
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM t_map", Integer.class));
            jdbc.update("INSERT INTO t_map(map_id, name) VALUES ('default', '旧默认图谱')");
            jdbc.update("INSERT INTO t_tile(map_id, tile_id) VALUES ('default', 'keep-content')");
            var removal = new ResourceDatabasePopulator(new ClassPathResource("db/remove-default-map.sql"));
            removal.execute(ds);
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM t_map", Integer.class));
            jdbc.update("DELETE FROM t_tile WHERE tile_id='keep-content'");
            removal.execute(ds);
            migration.execute(ds);
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM t_map", Integer.class));
        } finally { adminJdbc.execute("DROP SCHEMA " + schemaName + " CASCADE"); }
    }

    @Test void migrationConstraintsAndEveryTileOperationRespectMapOwnership() throws Exception {
        String schemaName = "map_check_" + UUID.randomUUID().toString().replace("-", "");
        String url = System.getProperty("aureli.map.jdbc", "jdbc:postgresql://localhost:5432/robot");
        String user = System.getProperty("aureli.map.user", "postgres");
        String password = System.getProperty("aureli.map.password", "postgres");
        var admin = new DriverManagerDataSource(url, user, password);
        var adminJdbc = new JdbcTemplate(admin);
        adminJdbc.execute("CREATE SCHEMA " + schemaName);
        var ds = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schemaName, user, password);
        var jdbc = new JdbcTemplate(ds);
        try {
            String schema = new ClassPathResource("schema.sql").getContentAsString(StandardCharsets.UTF_8);
            // Seed the pre-map schema to verify upgrade rather than only a fresh install.
            String legacy = schema.substring(schema.indexOf("CREATE TABLE IF NOT EXISTS t_tile ("), schema.indexOf("-- 多图谱字段"));
            new ResourceDatabasePopulator(new ByteArrayResource(legacy.getBytes(StandardCharsets.UTF_8))).execute(ds);
            jdbc.update("INSERT INTO t_tile (tile_id, user_message) VALUES ('legacy-root', 'old question'), ('legacy-child', 'old child')");
            jdbc.update("INSERT INTO t_tile_message (tile_id, role, content) VALUES ('legacy-root', 'assistant', 'old answer')");
            jdbc.update("INSERT INTO t_tile_edge (edge_id, source_tile_id, target_tile_id, direction, relation_type) VALUES ('legacy-edge', 'legacy-root', 'legacy-child', 'DIRECTED', 'EXTENDS')");
            jdbc.execute("CREATE TABLE t_map(id BIGSERIAL PRIMARY KEY, map_id VARCHAR(128) NOT NULL UNIQUE, name VARCHAR(100) NOT NULL, create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
            jdbc.update("INSERT INTO t_map(map_id, name) VALUES ('map-test', '已有图谱'), ('default', '旧默认图谱')");
            for (String table : List.of("t_tile", "t_tile_message", "t_tile_edge")) {
                jdbc.execute("ALTER TABLE " + table + " ADD COLUMN map_id VARCHAR(128) NOT NULL DEFAULT 'default'");
                jdbc.update("UPDATE " + table + " SET map_id='map-test'");
            }
            new ResourceDatabasePopulator(new ClassPathResource("db/remove-default-map.sql")).execute(ds);
            var migration = new ResourceDatabasePopulator(new ClassPathResource("schema.sql"));
            migration.execute(ds);
            migration.execute(ds);
            assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM t_tile WHERE map_id='map-test'", Integer.class));
            assertEquals("old answer", jdbc.queryForObject("SELECT content FROM t_tile_message WHERE map_id='map-test'", String.class));
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM t_tile_edge WHERE map_id='map-test'", Integer.class));

            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM t_map WHERE map_id='default'", Integer.class));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_schema=? AND table_name IN ('t_tile','t_tile_message','t_tile_edge') AND column_name='map_id' AND column_default IS NOT NULL", Integer.class, schemaName));
            assertThrows(RuntimeException.class, () -> jdbc.update("INSERT INTO t_tile(tile_id) VALUES ('unassigned')"));

            var config = new MybatisConfiguration();
            config.setMapUnderscoreToCamelCase(true);
            for (var mapper : List.of(MapMapper.class, com.aureli.ai.robot.domain.mapper.LabelMapper.class, TileMapper.class, TileMessageMapper.class, TileEdgeMapper.class)) config.addMapper(mapper);
            var factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(ds);
            factory.setConfiguration(config);
            try (SqlSession session = factory.getObject().openSession(true)) {
                var maps = session.getMapper(MapMapper.class);
                var tiles = session.getMapper(TileMapper.class);
                var messages = session.getMapper(TileMessageMapper.class);
                var edges = session.getMapper(TileEdgeMapper.class);
                var mapController = new MapController(maps);
                var a = mapController.create(new MapController.CreateMap(" 图谱 A ")).getData();
                var b = mapController.create(new MapController.CreateMap("图谱 B")).getData();
                assertEquals("图谱 A", a.getName());
                assertEquals(3, mapController.list().getBody().getData().size());
                assertEquals(1.0, a.getZoom());
                assertEquals(1.0, jdbc.queryForObject("SELECT zoom FROM t_map WHERE map_id='map-test'", Double.class));
                assertTrue(mapController.updateZoom(a.getMapId(), new MapController.UpdateZoom(0.65)).isSuccess());
                var storedMaps = mapController.list().getBody().getData();
                assertEquals(0.65, storedMaps.stream().filter(map -> map.getMapId().equals(a.getMapId())).findFirst().orElseThrow().getZoom());
                assertEquals(1.0, storedMaps.stream().filter(map -> map.getMapId().equals(b.getMapId())).findFirst().orElseThrow().getZoom());
                assertFalse(mapController.updateZoom("missing-map", new MapController.UpdateZoom(0.8)).isSuccess());
                assertThrows(RuntimeException.class, () -> jdbc.update("UPDATE t_map SET zoom=0.1 WHERE map_id=?", a.getMapId()));
                assertThrows(RuntimeException.class, () -> jdbc.update("UPDATE t_map SET zoom=2.0 WHERE map_id=?", a.getMapId()));
                var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(mapController).build();
                for (String invalid : List.of("{\"zoom\":0.1}", "{\"zoom\":2.0}", "{}"))
                    mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/customer-service/maps/" + a.getMapId() + "/zoom")
                            .contentType("application/json").content(invalid))
                            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isBadRequest());
                mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/customer-service/maps/" + a.getMapId() + "/zoom")
                        .contentType("application/json").content("{\"zoom\":0.75}"))
                        .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.success").value(true));
                var workspace = new TileWorkspaceController(tiles, edges, messages, new TileFileContentReader(), session.getMapper(com.aureli.ai.robot.domain.mapper.LabelMapper.class));
                workspace.createNote(new SaveTileNoteReqVO("a-note", "A", "A private", List.of(), a.getMapId()));
                workspace.createNote(new SaveTileNoteReqVO("b-note", "B", "B private", List.of(), b.getMapId()));
                workspace.createNote(new SaveTileNoteReqVO("a-child", "child", "child text", List.of("a-note"), a.getMapId()));
                assertEquals(2, workspace.workspace(a.getMapId()).getBody().getData().tiles().size());
                assertEquals(1, workspace.workspace(b.getMapId()).getBody().getData().tiles().size());
                assertThrows(RuntimeException.class, () -> workspace.createNote(new SaveTileNoteReqVO("bad", "bad", "bad", List.of("b-note"), a.getMapId())));
                assertFalse(workspace.updateNote(new SaveTileNoteReqVO("b-note", "hacked", "hacked", List.of(), a.getMapId())).isSuccess());
                var weight = new UpdateTileWeightReqVO(); weight.setTileId("b-note"); weight.setMapId(a.getMapId()); weight.setWeight(3);
                assertFalse(workspace.updateWeight(weight).isSuccess());
                assertThrows(RuntimeException.class, () -> jdbc.update("INSERT INTO t_tile_message(map_id, tile_id, role, content) VALUES (?, 'b-note', 'user', 'wrong map')", a.getMapId()));
                assertThrows(RuntimeException.class, () -> jdbc.update("INSERT INTO t_tile_edge(map_id, edge_id, source_tile_id, target_tile_id, direction, relation_type) VALUES (?, 'bad-edge', 'a-note', 'b-note', 'DIRECTED', 'EXTENDS')", a.getMapId()));
                assertThrows(RuntimeException.class, () -> jdbc.update("INSERT INTO t_tile(map_id, tile_id) VALUES ('missing-map', 'bad-map')"));
                assertTrue(tiles.selectByTileIds(a.getMapId(), List.of("b-note")).isEmpty());
                assertTrue(messages.selectByTileIds(a.getMapId(), List.of("b-note")).isEmpty());
                assertTrue(edges.selectRelatedEdges(b.getMapId(), "a-child").isEmpty());

                var upload = workspace.uploadFile(new MockMultipartFile("file", "private.docx", null,
                        com.aureli.ai.robot.support.DocxFixtures.textAndTable()), List.of("a-note"), a.getMapId()).getData();
                assertEquals(404, workspace.downloadFile(upload.id(), b.getMapId()).getStatusCode().value());
                assertNotNull(workspace.downloadFile(upload.id(), a.getMapId()).getBody());
                var chain = mock(StreamAdvisorChain.class);
                when(chain.nextStream(any())).thenReturn(Flux.empty());
                new CustomChatMemoryAdvisor(messages, edges, tiles, List.of("a-child", "b-note"), 3, List.of(), a.getMapId())
                        .adviseStream(new ChatClientRequest(new Prompt("current"), Map.of()), chain).blockLast();
                var prompt = ArgumentCaptor.forClass(ChatClientRequest.class);
                verify(chain).nextStream(prompt.capture());
                assertTrue(prompt.getValue().prompt().getContents().contains("A private"));
                assertFalse(prompt.getValue().prompt().getContents().contains("B private"));

                for (String id : List.of("a-qa1", "a-qa2")) {
                    tiles.insert(TileDO.builder().mapId(a.getMapId()).tileId(id).userMessage(id).answerSummary("answer " + id).build());
                    messages.insert(TileMessageDO.builder().mapId(a.getMapId()).tileId(id).role("assistant").content("full " + id).build());
                }
                var settings = mock(ModelApiSettingsService.class);
                var model = mock(ChatModel.class);
                when(settings.chatModel()).thenReturn(model);
                when(model.call(any(Prompt.class))).thenReturn(new ChatResponse(List.of(new Generation(new AssistantMessage("{\"userMessage\":\"merged\",\"answer\":\"merged answer\"}")))));
                var tx = mock(TransactionTemplate.class);
                when(tx.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0)).doInTransaction(new SimpleTransactionStatus()));
                var fusion = new TileFusionService(tiles, messages, edges, settings, tx);
                assertThrows(IllegalArgumentException.class, () -> fusion.fuse(new FuseTilesReqVO("wrong-fusion", List.of("a-qa1", "a-qa2"), b.getMapId())));
                verifyNoInteractions(model);
                var merged = fusion.fuse(new FuseTilesReqVO("a-merged", List.of("a-qa1", "a-qa2"), a.getMapId()));
                assertEquals(a.getMapId(), merged.tile().getMapId());
                assertEquals(2, messages.selectByTileIds(a.getMapId(), List.of("a-merged")).size());
                assertEquals(2, merged.edges().size());
                var service = new CustomerServiceImpl();
                ReflectionTestUtils.setField(service, "tileMapper", tiles);
                ReflectionTestUtils.setField(service, "tileMessageMapper", messages);
                ReflectionTestUtils.setField(service, "tileEdgeMapper", edges);
                assertThrows(RuntimeException.class, () -> service.deleteTile(DeleteTileReqVO.builder().tileId("b-note").mapId(a.getMapId()).build()));
                service.deleteTile(DeleteTileReqVO.builder().tileId("a-child").mapId(a.getMapId()).build());
                assertTrue(edges.selectRelatedEdges(a.getMapId(), "a-child").isEmpty());
                service.resetTileWorkspace(a.getMapId());
                assertTrue(workspace.workspace(a.getMapId()).getBody().getData().tiles().isEmpty());
                assertEquals(1, workspace.workspace(b.getMapId()).getBody().getData().tiles().size());
                assertEquals(2, workspace.workspace("map-test").getBody().getData().tiles().size());
                // Delete the entire map through HTTP, including every cascade level.
                workspace.createNote(new SaveTileNoteReqVO("b-child", "child", "B child", List.of("b-note"), b.getMapId()));
                messages.insert(TileMessageDO.builder().mapId(b.getMapId()).tileId("b-note").role("assistant").content("B message").build());
                assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM t_tile_edge WHERE map_id=?", Integer.class, b.getMapId()));
                mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/customer-service/maps/" + b.getMapId()))
                        .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.success").value(true));
                for (String table : List.of("t_map", "t_tile", "t_tile_message", "t_tile_edge"))
                    assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM " + table + " WHERE map_id=?", Integer.class, b.getMapId()));
                assertEquals(2, workspace.workspace("map-test").getBody().getData().tiles().size());
                assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM t_map WHERE map_id=?", Integer.class, a.getMapId()));
                mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/customer-service/maps/" + b.getMapId()))
                        .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.success").value(false));
            }
        } finally { adminJdbc.execute("DROP SCHEMA " + schemaName + " CASCADE"); }
    }
}
