package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.advisor.CustomChatMemoryAdvisor;
import com.aureli.ai.robot.advisor.CustomStreamLoggerAndMessage2DBAdvisor;
import com.aureli.ai.robot.domain.MemoryCategory;
import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.service.GeneralSettingsService;
import com.aureli.ai.robot.service.MemoryTokenBudget;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisorChain;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.transaction.support.TransactionTemplate;
import reactor.core.publisher.Flux;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Creates and drops only its own schema; exercised against a disposable PostgreSQL instance. */
@EnabledIfSystemProperty(named = "aureli.memory.integration", matches = "true")
class MemoryPersistenceIntegrationTest {
    @Test void upgradesLegacySchemaPreservesSettingsAndPersistsHiddenClassification() throws Exception {
        String schema = "memory_check_" + UUID.randomUUID().toString().replace("-", "");
        String url = System.getProperty("aureli.map.jdbc", "jdbc:postgresql://localhost:5432/robot");
        String user = System.getProperty("aureli.map.user", "postgres");
        String password = System.getProperty("aureli.map.password", "postgres");
        var admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        admin.execute("CREATE SCHEMA " + schema);
        var ds = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema, user, password);
        var jdbc = new JdbcTemplate(ds);
        try {
            var migration = new ResourceDatabasePopulator(new ClassPathResource("schema.sql"));
            migration.execute(ds);
            jdbc.execute("ALTER TABLE t_tile DROP COLUMN memory_category");
            jdbc.execute("DROP TABLE t_general_setting");
            jdbc.update("INSERT INTO t_map(map_id,name) VALUES ('map-a','A'), ('map-b','B')");
            jdbc.update("INSERT INTO t_tile(map_id,tile_id,user_message,answer_summary) VALUES ('map-a','legacy','旧问题','旧回答')");
            migration.execute(ds); migration.execute(ds);
            assertEquals("UNKNOWN", jdbc.queryForObject("SELECT memory_category FROM t_tile WHERE tile_id='legacy'", String.class));
            assertEquals("旧回答", jdbc.queryForObject("SELECT answer_summary FROM t_tile WHERE tile_id='legacy'", String.class));
            var general = new GeneralSettingsService(jdbc);
            assertEquals(8000, general.contextTokenBudget());
            jdbc.update("UPDATE t_general_setting SET config_content='600' WHERE config_title='context_token_budget'");
            migration.execute(ds);
            assertEquals(600, general.contextTokenBudget());
            assertThrows(RuntimeException.class, () -> jdbc.update("UPDATE t_tile SET memory_category='INVALID' WHERE tile_id='legacy'"));

            var config = new MybatisConfiguration(); config.setMapUnderscoreToCamelCase(true);
            for (var mapper : List.of(TileMapper.class, TileMessageMapper.class, TileEdgeMapper.class)) config.addMapper(mapper);
            var factory = new MybatisSqlSessionFactoryBean(); factory.setDataSource(ds); factory.setConfiguration(config);
            var session = new SqlSessionTemplate(factory.getObject());
            var tiles = session.getMapper(TileMapper.class); var messages = session.getMapper(TileMessageMapper.class);
            var edges = session.getMapper(TileEdgeMapper.class);
            var chain = mock(StreamAdvisorChain.class);
            when(chain.nextStream(any())).thenReturn(Flux.just(ChatClientResponse.builder()
                    .chatResponse(new ChatResponse(List.of(new Generation(new AssistantMessage("完整回答"))))).build()));
            var persistence = new CustomStreamLoggerAndMessage2DBAdvisor(tiles, messages, edges, "new",
                    "项目必须离线运行", List.of("legacy"), "DIRECTED", "EXTENDS", null, null,
                    new TransactionTemplate(new DataSourceTransactionManager(ds)), "map-a", MemoryCategory.PROJECT_RULE);
            persistence.adviseStream(new ChatClientRequest(new Prompt("项目必须离线运行"), Map.of()), chain).blockLast();
            TileDO saved = tiles.selectByTileIds("map-a", List.of("new")).getFirst();
            assertEquals("PROJECT_RULE", saved.getMemoryCategory());
            assertEquals("UNKNOWN", tiles.selectByTileIds("map-a", List.of("legacy")).getFirst().getMemoryCategory());
            String json = tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(saved);
            assertFalse(json.contains("memoryCategory"));
            assertEquals(2, messages.selectByTileIds("map-a", List.of("new")).size());
            assertEquals(1, edges.selectRelatedEdgesBatch("map-a", List.of("new")).size());
            assertTrue(edges.selectRelatedEdgesBatch("map-b", List.of("new")).isEmpty());
            jdbc.update("INSERT INTO t_tile(map_id,tile_id,tile_type,title,content) VALUES ('map-a','large','NOTE','长便签',?)", "长正文".repeat(1000));
            jdbc.update("INSERT INTO t_tile_edge(map_id,edge_id,source_tile_id,target_tile_id,direction,relation_type) VALUES ('map-a','large-link','large','legacy','DIRECTED','EXTENDS')");
            var memory = new CustomChatMemoryAdvisor(messages, edges, tiles, List.of("new"), List.of(), "map-a",
                    MemoryCategory.DISCUSSION, general.contextTokenBudget()).memoryMessages();
            assertTrue(MemoryTokenBudget.tokens(memory) <= 600);
            assertTrue(memory.stream().anyMatch(message -> message.getText().contains("完整回答")));
            assertTrue(memory.stream().anyMatch(message -> message.getText().contains("长正文")));
        } finally { admin.execute("DROP SCHEMA " + schema + " CASCADE"); }
    }
}
