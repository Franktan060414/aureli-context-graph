package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.service.GraphImportService;
import com.aureli.ai.robot.reader.TileFileContentReader;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import tools.jackson.databind.json.JsonMapper;
import java.util.List;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Uses and removes only a fresh schema; verifies the production transaction proxy. */
@EnabledIfSystemProperty(named = "aureli.import.integration", matches = "true")
class WebTilePersistenceIntegrationTest {
    @Test void persistsSnapshotsKeepsOldBodyAndUpgradesLegacySchema() throws Exception {
        String schema = "import_check_" + UUID.randomUUID().toString().replace("-", "");
        String url = System.getProperty("aureli.map.jdbc", "jdbc:postgresql://localhost:5432/robot");
        String user = System.getProperty("aureli.map.user", "postgres"), password = System.getProperty("aureli.map.password", "postgres");
        var admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        admin.execute("CREATE SCHEMA " + schema);
        var ds = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema, user, password);
        var jdbc = new JdbcTemplate(ds);
        try {
            new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(ds);
            var config = new MybatisConfiguration(); config.setMapUnderscoreToCamelCase(true);
            for (var mapper : List.of(MapMapper.class, LabelMapper.class, TileMapper.class, TileMessageMapper.class, TileEdgeMapper.class))
                config.addMapper(mapper);
            var factory = new MybatisSqlSessionFactoryBean(); factory.setDataSource(ds); factory.setConfiguration(config);
            var session = new SqlSessionTemplate(factory.getObject());
            var maps = session.getMapper(MapMapper.class); var labels = session.getMapper(LabelMapper.class);
            var tiles = session.getMapper(TileMapper.class); var messages = session.getMapper(TileMessageMapper.class);
            var edges = session.getMapper(TileEdgeMapper.class);
            var initializer = new ResourceDatabasePopulator(new ClassPathResource("schema.sql"));
            jdbc.execute("ALTER TABLE t_tile DROP COLUMN source_url, DROP COLUMN resolved_url, DROP COLUMN fetched_at, DROP COLUMN fetch_status, DROP COLUMN fetch_error, DROP COLUMN fetch_token");
            jdbc.execute("ALTER TABLE t_tile DROP CONSTRAINT chk_tile_type");
            jdbc.execute("ALTER TABLE t_tile ADD CONSTRAINT chk_tile_type CHECK (tile_type IN ('QA','NOTE','FILE'))");
            jdbc.update("INSERT INTO t_map(map_id,name) VALUES ('map-one','Map 1'), ('map-two','Map 2')");
            jdbc.update("INSERT INTO t_tile(map_id,tile_id,tile_type,title,content) VALUES ('map-one','old-note','NOTE','便签','原始正文')");
            initializer.execute(ds); initializer.execute(ds);
            assertEquals("原始正文", jdbc.queryForObject("SELECT content FROM t_tile WHERE tile_id='old-note'", String.class));
            var extractor = mock(com.aureli.ai.robot.service.search.TavilyMcpSearchService.class);
            var settings = mock(com.aureli.ai.robot.service.search.TavilySettingsService.class);
            var active = new com.aureli.ai.robot.service.search.TavilySettingsRepository.Settings(false, "https://mcp.tavily.com/mcp/", "fixture-key");
            when(settings.snapshot()).thenReturn(active);
            var service = new com.aureli.ai.robot.service.web.WebTileService(tiles, edges, maps, extractor, settings,
                    new org.springframework.transaction.support.TransactionTemplate(new DataSourceTransactionManager(ds)));
            assertThrows(IllegalArgumentException.class, () -> service.create("map-two", "https://example.com", List.of("old-note")));
            var pending = service.create("map-one", "https://example.com/article", List.of("old-note"));
            assertEquals("PENDING", pending.fetchStatus()); assertEquals(List.of("old-note"), pending.relatedTileIds());
            when(extractor.extract(active, pending.sourceUrl())).thenReturn(new com.aureli.ai.robot.service.search.TavilyMcpSearchService.WebPage("文章标题", "https://example.com/final", "# 原始正文"));
            var ready = service.refresh("map-one", pending.id());
            assertEquals("READY", ready.fetchStatus()); assertEquals("# 原始正文", ready.content()); assertNotNull(ready.fetchedAt());
            assertThrows(IllegalArgumentException.class, () -> service.refresh("map-two", pending.id()));
            doThrow(new IllegalStateException("secret-from-provider")).when(extractor).extract(active, pending.sourceUrl());
            var failed = service.refresh("map-one", pending.id());
            assertEquals("FAILED", failed.fetchStatus()); assertEquals(ready.content(), failed.content()); assertEquals(ready.fetchedAt(), failed.fetchedAt());
            assertFalse(failed.fetchError().contains("secret"));
            var workspace = new TileWorkspaceController(tiles, edges, messages, new TileFileContentReader(), labels);
            var restored = workspace.workspace("map-one").getBody().getData().tiles().stream().filter(tile -> tile.id().equals(ready.id())).findFirst().orElseThrow();
            assertEquals(failed, restored);
            var json = JsonMapper.builder().build();
            var document = json.readTree(json.writeValueAsString(java.util.Map.of("name", "网页快照导入", "tiles", List.of(failed), "edges", List.of(), "labels", List.of())));
            ((tools.jackson.databind.node.ObjectNode)document.path("tiles").get(0)).putArray("relatedTileIds");
            var imported = new GraphImportService(maps,tiles,messages,edges,labels).importGraph(document);
            assertEquals("READY", imported.tiles().getFirst().fetchStatus()); assertEquals(ready.content(), imported.tiles().getFirst().content());
            assertEquals(ready.sourceUrl(), imported.tiles().getFirst().sourceUrl());
            assertEquals(imported.tiles(), workspace.workspace(imported.map().getMapId()).getBody().getData().tiles());
            // A newer refresh token wins even if the older extraction completes afterwards.
            doAnswer(call -> {
                jdbc.update("UPDATE t_tile SET content='更新的快照', fetch_status='READY', fetch_token=? WHERE tile_id=?", UUID.randomUUID().toString(), ready.id());
                return new com.aureli.ai.robot.service.search.TavilyMcpSearchService.WebPage("旧请求", "https://example.com", "不应覆盖");
            }).when(extractor).extract(active, pending.sourceUrl());
            assertEquals("更新的快照", service.refresh("map-one", ready.id()).content());
            doThrow(new IllegalStateException("secret-from-provider")).when(extractor).extract(active, pending.sourceUrl());
            jdbc.update("UPDATE t_tile SET fetch_status='FETCHING', update_time=CURRENT_TIMESTAMP WHERE tile_id=?", ready.id());
            assertThrows(IllegalArgumentException.class, () -> service.refresh("map-one", ready.id()));
            jdbc.update("UPDATE t_tile SET update_time=CURRENT_TIMESTAMP - INTERVAL '3 minutes' WHERE tile_id=?", ready.id());
            assertEquals("FAILED", service.refresh("map-one", ready.id()).fetchStatus());
            doAnswer(call -> {
                jdbc.update("DELETE FROM t_tile WHERE tile_id=?", ready.id());
                return new com.aureli.ai.robot.service.search.TavilyMcpSearchService.WebPage("已删除", "https://example.com", "不能复活");
            }).when(extractor).extract(active, pending.sourceUrl());
            assertThrows(IllegalArgumentException.class, () -> service.refresh("map-one", ready.id()));
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile WHERE tile_id=?", Integer.class, ready.id()));
        } finally { admin.execute("DROP SCHEMA " + schema + " CASCADE"); }
    }
}
