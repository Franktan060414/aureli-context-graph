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
class GraphImportPersistenceIntegrationTest {
    @Test void persistsImportsWithNewIdsAndRollsBackAllTablesOnLateFailure() throws Exception {
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
            var transactions = new DataSourceTransactionManager(ds);
            var imports = transactional(new GraphImportService(maps,tiles,messages,edges,labels), transactions);
            var source = JsonMapper.builder().build().readTree(GraphImportControllerTest.FIXTURE);
            var first = imports.importGraph(source); var second = imports.importGraph(source);
            assertNotEquals(first.map().getMapId(), second.map().getMapId());
            var workspace = new TileWorkspaceController(tiles,edges,messages,mock(TileFileContentReader.class),labels);
            var restored = workspace.workspace(first.map().getMapId()).getBody().getData();
            assertEquals(first.tiles(), restored.tiles());
            assertEquals(first.edges().getFirst().id(), restored.edges().getFirst().id());
            assertEquals(first.edges().getFirst().sourceTileId(), restored.edges().getFirst().sourceTileId());
            assertEquals(first.edges().getFirst().targetTileId(), restored.edges().getFirst().targetTileId());
            assertEquals(0, first.edges().getFirst().weight().compareTo(restored.edges().getFirst().weight()));
            assertEquals(first.labels().getFirst().getId(), restored.labels().getFirst().getId());
            assertEquals("研究", restored.labels().getFirst().getName());
            assertEquals("#AABBCC", restored.labels().getFirst().getColorHex());
            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM t_map", Integer.class));
            assertEquals(6, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile", Integer.class));
            assertEquals(4, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_message", Integer.class));
            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM t_label", Integer.class));
            var brokenEdges = mock(TileEdgeMapper.class);
            when(brokenEdges.insert(any(TileEdgeDO.class))).thenThrow(new IllegalStateException("fixture late write failure"));
            var failing = transactional(new GraphImportService(maps,tiles,messages,brokenEdges,labels), transactions);
            assertThrows(IllegalStateException.class, () -> failing.importGraph(source));
            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM t_map", Integer.class));
            assertEquals(6, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile", Integer.class));
            assertEquals(4, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_message", Integer.class));
            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_edge", Integer.class));
            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM t_label", Integer.class));
        } finally { admin.execute("DROP SCHEMA " + schema + " CASCADE"); }
    }

    private GraphImportService transactional(GraphImportService service, DataSourceTransactionManager manager) {
        var proxy = new ProxyFactory(service);
        proxy.addAdvice(new TransactionInterceptor(manager, new AnnotationTransactionAttributeSource()));
        return (GraphImportService)proxy.getProxy();
    }
}
