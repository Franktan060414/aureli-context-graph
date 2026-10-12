package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.model.vo.customerService.*;
import com.aureli.ai.robot.reader.TileFileContentReader;
import com.aureli.ai.robot.service.*;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import org.mybatis.spring.SqlSessionTemplate;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.List;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** All writes, migrations and forced failures run in a disposable PostgreSQL schema. */
@EnabledIfSystemProperty(named = "aureli.replacement.integration", matches = "true")
class TileReplacementPersistenceIntegrationTest {
    @ParameterizedTest @ValueSource(booleans = {false, true})
    void replacementRoundTripIsolationAndRollbackAfterSourceDeletion(boolean split) throws Exception {
        String schema = "replacement_check_" + UUID.randomUUID().toString().replace("-", "");
        String url = System.getProperty("aureli.map.jdbc", "jdbc:postgresql://localhost:5432/robot");
        String user = System.getProperty("aureli.map.user", "postgres");
        String password = System.getProperty("aureli.map.password", "postgres");
        var admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        admin.execute("CREATE SCHEMA " + schema);
        var ds = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema, user, password);
        var jdbc = new JdbcTemplate(ds);
        try {
            new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(ds);
            var configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            for (var mapper : List.of(LabelMapper.class, TileMapper.class, TileMessageMapper.class, TileEdgeMapper.class))
                configuration.addMapper(mapper);
            var factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(ds); factory.setConfiguration(configuration);
            var session = new SqlSessionTemplate(factory.getObject());
            var tiles = session.getMapper(TileMapper.class);
            var messages = session.getMapper(TileMessageMapper.class);
            var edges = session.getMapper(TileEdgeMapper.class);
            var workspace = new TileWorkspaceController(tiles, edges, messages, new TileFileContentReader(), session.getMapper(LabelMapper.class));
            var tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
            var model = mock(ChatModel.class);
            var settings = mock(ModelApiSettingsService.class);
            when(settings.chatModel()).thenReturn(model);
            jdbc.update("INSERT INTO t_map(map_id,name) VALUES ('a','覆盖测试'),('b','隔离测试')");
            jdbc.update("INSERT INTO t_label(map_id,name,color_hex) VALUES ('a','继承标签','#E8F2FF')");
            Long labelId = jdbc.queryForObject("SELECT id FROM t_label WHERE map_id='a'", Long.class);
            for (String id : List.of("one", "two", "parent", "child", "note", "file")) {
                jdbc.update("INSERT INTO t_tile(map_id,tile_id,tile_type,user_message,answer_summary,weight,label_id) VALUES ('a',?,?,?, '原始回答',2,?)",
                        id, id.equals("note") ? "NOTE" : id.equals("file") ? "FILE" : "QA", "原始问题" + id, labelId);
                jdbc.update("INSERT INTO t_tile_message(map_id,tile_id,role,content) VALUES ('a',?,'assistant',?)", id, "完整回答" + id);
            }
            jdbc.update("INSERT INTO t_tile(map_id,tile_id,user_message,answer_summary) VALUES ('b','other','隔离问题','隔离回答')");
            jdbc.update("INSERT INTO t_tile_edge(map_id,edge_id,source_tile_id,target_tile_id,direction,relation_type,weight,description) VALUES "
                    + "('a','incoming','parent','one','DIRECTED','EXTENDS',0.7,'父边'),"
                    + "('a','outgoing','one','child','DIRECTED','DIVIDES',0.4,'子边'),"
                    + "('a','undirected','one','note','UNDIRECTED','RELATES',0.3,'便签边'),"
                    + "('a','internal','one','two','DIRECTED','FUSES',0.9,'内部边'),"
                    + "('a','second','two','file','UNDIRECTED','RELATES',0.5,'文件边'),"
                    + "('a','untouched','parent','file','DIRECTED','EXTENDS',0.8,'不受影响')");
            var before = workspace.workspace("a").getBody().getData();
            var isolated = workspace.workspace("b").getBody().getData();
            Runnable generate = () -> {
                if (split) new TileSplitService(tiles, messages, edges, settings, tx)
                        .split(new SplitTileReqVO("one", "按步骤", "a", "replacement-test", true));
                else new TileFusionService(tiles, messages, edges, settings, tx)
                        .fuse(new FuseTilesReqVO("fused", List.of("one", "two", "note", "file"), "a", true));
            };

            // Invalid model output must leave both source content and topology untouched.
            when(model.call(any(Prompt.class))).thenReturn(reply("{}"));
            assertThrows(IllegalStateException.class, generate::run);
            assertEquals(before, workspace.workspace("a").getBody().getData());

            // Fail at the end of source deletion, after new nodes, messages and edges were saved.
            jdbc.execute("CREATE FUNCTION reject_source_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                    + "RAISE EXCEPTION 'forced source deletion failure'; RETURN OLD; END $$");
            jdbc.execute("CREATE TRIGGER reject_source_delete AFTER DELETE ON t_tile FOR EACH ROW EXECUTE FUNCTION reject_source_delete()");
            accepted(model, split);
            assertThrows(RuntimeException.class, generate::run);
            assertEquals(before, workspace.workspace("a").getBody().getData());
            jdbc.execute("DROP TRIGGER reject_source_delete ON t_tile");

            accepted(model, split);
            if (split) generate.run();
            else MockMvcBuilders
                    .standaloneSetup(new TileFusionController(new TileFusionService(tiles, messages, edges, settings, tx))).build()
                    .perform(post("/customer-service/tile/fusion/overwrite")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"mapId\":\"a\",\"tileId\":\"fused\",\"sourceTileIds\":[\"one\",\"two\",\"note\",\"file\"],\"overwrite\":false}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.deletedTileIds.length()").value(2));
            var restored = workspace.workspace("a").getBody().getData();
            List<String> removed = split ? List.of("one") : List.of("one", "two");
            List<String> replacements = split ? List.of("tile-split-replacement-test-0", "tile-split-replacement-test-1") : List.of("fused");
            assertTrue(restored.tiles().stream().noneMatch(tile -> removed.contains(tile.id())));
            assertEquals(split ? 7 : 5, restored.tiles().size());
            assertEquals(split ? 10 : 5, restored.edges().size());
            assertTrue(restored.edges().stream().noneMatch(edge -> removed.contains(edge.sourceTileId()) || removed.contains(edge.targetTileId())));
            assertTrue(restored.tiles().stream().allMatch(tile -> tile.relatedTileIds().stream().noneMatch(removed::contains)));
            for (String id : replacements) {
                var node = restored.tiles().stream().filter(tile -> tile.id().equals(id)).findFirst().orElseThrow();
                assertEquals(List.of("parent"), node.relatedTileIds());
                assertEquals(labelId, node.labelId());
                assertEquals(2, node.weight());
                assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM t_tile_message WHERE tile_id=?", Integer.class, id));
                var outgoing = restored.edges().stream().filter(edge -> edge.sourceTileId().equals(id) && edge.targetTileId().equals("child")).findFirst().orElseThrow();
                assertEquals("DIVIDES", outgoing.relationType());
                assertEquals(0, new java.math.BigDecimal("0.4").compareTo(outgoing.weight()));
                assertEquals("子边", outgoing.description());
                var neighbour = restored.edges().stream().filter(edge -> edge.sourceTileId().equals(id) && edge.targetTileId().equals("note")).findFirst().orElseThrow();
                assertEquals("UNDIRECTED", neighbour.direction());
            }
            var child = restored.tiles().stream().filter(tile -> tile.id().equals("child")).findFirst().orElseThrow();
            assertEquals(replacements.stream().sorted().toList(), child.relatedTileIds().stream().sorted().toList());
            assertEquals(isolated, workspace.workspace("b").getBody().getData());
            for (String id : removed)
                assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM t_tile_message WHERE tile_id=?", Integer.class, id));
            assertTrue(restored.edges().stream().anyMatch(edge -> edge.id().equals("untouched") && edge.description().equals("不受影响")));
            // Repeating the same request cannot create a second group or delete neighbours.
            clearInvocations(model);
            assertThrows(RuntimeException.class, generate::run);
            verifyNoInteractions(model);
            assertEquals(restored, workspace.workspace("a").getBody().getData());
        } finally {
            admin.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }

    private void accepted(ChatModel model, boolean split) {
        if (split) when(model.call(any(Prompt.class))).thenReturn(
                reply("{\"splittable\":true,\"reason\":\"可以独立展开\"}"),
                reply("{\"tiles\":[{\"userMessage\":\"目标是什么？\",\"answer\":\"目标回答\"},{\"userMessage\":\"如何实施？\",\"answer\":\"实施回答\"}]}"));
        else when(model.call(any(Prompt.class))).thenReturn(reply("{\"userMessage\":\"融合问题\",\"answer\":\"融合回答\"}"));
    }

    private ChatResponse reply(String content) {
        return new ChatResponse(List.of(new Generation(new AssistantMessage(content))));
    }
}
