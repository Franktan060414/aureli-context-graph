package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.model.vo.customerService.*;
import com.aureli.ai.robot.service.*;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import com.aureli.ai.robot.reader.TileFileContentReader;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import org.mybatis.spring.SqlSessionTemplate;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import java.util.List;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** PostgreSQL checks in a temporary schema; no user tables or real AI models are used. */
@EnabledIfSystemProperty(named = "aureli.label.integration", matches = "true")
class LabelPersistenceIntegrationTest {
    @Test void labelsRoundTripOwnershipRollbackAndInheritance() throws Exception {
        String schemaName = "label_check_" + UUID.randomUUID().toString().replace("-", "");
        String url = System.getProperty("aureli.map.jdbc", "jdbc:postgresql://localhost:5432/robot");
        String user = System.getProperty("aureli.map.user", "postgres"), password = System.getProperty("aureli.map.password", "postgres");
        var admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        admin.execute("CREATE SCHEMA " + schemaName);
        var ds = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schemaName, user, password);
        var jdbc = new JdbcTemplate(ds);
        try {
            var migration = new ResourceDatabasePopulator(new ClassPathResource("schema.sql"));
            migration.execute(ds); migration.execute(ds);
            var configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            for (var mapper : List.of(LabelMapper.class, TileMapper.class, TileMessageMapper.class, TileEdgeMapper.class)) configuration.addMapper(mapper);
            var factory = new MybatisSqlSessionFactoryBean(); factory.setDataSource(ds); factory.setConfiguration(configuration);
            var session = new SqlSessionTemplate(factory.getObject());
            var labels = session.getMapper(LabelMapper.class); var tiles = session.getMapper(TileMapper.class);
            var messages = session.getMapper(TileMessageMapper.class); var edges = session.getMapper(TileEdgeMapper.class);
            var manager = new DataSourceTransactionManager(ds);
            var proxy = new ProxyFactory(new LabelController(labels, tiles)); proxy.setProxyTargetClass(true);
            proxy.addAdvice(new TransactionInterceptor(manager, new AnnotationTransactionAttributeSource()));
            var controller = (LabelController) proxy.getProxy();
            var workspace = new TileWorkspaceController(tiles, edges, messages, new TileFileContentReader(), labels);
            jdbc.update("INSERT INTO t_map(map_id,name) VALUES ('a','A'),('b','B')");
            jdbc.update("INSERT INTO t_tile(map_id,tile_id,user_message,answer_summary) VALUES ('a','one','问题一','回答一'),('a','two','问题二','回答二'),('b','other','问题','回答')");
            var a = controller.create(new LabelController.SaveLabel(" a ", " 研究 ", "#e8f2ff")).getData();
            var b = controller.create(new LabelController.SaveLabel("b", "研究", "#123456")).getData();
            assertEquals("研究", a.getName()); assertEquals("#E8F2FF", a.getColorHex());
            assertThrows(RuntimeException.class, () -> controller.create(new LabelController.SaveLabel("a","研究","#000000")));
            assertThrows(RuntimeException.class, () -> controller.create(new LabelController.SaveLabel("a","非法颜色","red")));
            assertThrows(IllegalArgumentException.class, () -> controller.create(new LabelController.SaveLabel("missing","研究","#123456")));
            assertTrue(controller.assign(new LabelController.AssignLabel("a", List.of("one","two"," one "), a.getId())).isSuccess());
            assertThrows(IllegalArgumentException.class, () -> controller.assign(new LabelController.AssignLabel("a",List.of("one"),b.getId())));
            assertThrows(IllegalArgumentException.class, () -> controller.update(b.getId(), new LabelController.SaveLabel("a","修改","#000000")));
            assertThrows(IllegalArgumentException.class, () -> controller.delete(b.getId(), "a"));
            assertThrows(RuntimeException.class, () -> jdbc.update("UPDATE t_tile SET label_id=? WHERE tile_id='other'", a.getId()));
            assertThrows(IllegalArgumentException.class, () -> controller.assign(new LabelController.AssignLabel("a",List.of("one","other"),null)));
            assertEquals(a.getId(), jdbc.queryForObject("SELECT label_id FROM t_tile WHERE tile_id='one'", Long.class));
            // Fail after updates begin: the first Tile update must also roll back.
            jdbc.execute("CREATE FUNCTION reject_two() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tile_id='two' AND NEW.label_id IS NULL THEN RAISE EXCEPTION 'forced test failure'; END IF; RETURN NEW; END $$");
            jdbc.execute("CREATE TRIGGER reject_two BEFORE UPDATE ON t_tile FOR EACH ROW EXECUTE FUNCTION reject_two()");
            assertThrows(RuntimeException.class, () -> controller.assign(new LabelController.AssignLabel("a",List.of("one","two"),null)));
            assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM t_tile WHERE map_id='a' AND label_id=?", Integer.class, a.getId()));
            jdbc.execute("DROP TRIGGER reject_two ON t_tile");
            controller.update(a.getId(), new LabelController.SaveLabel("a","已整理","#000000"));
            var restored = workspace.workspace("a").getBody().getData();
            assertEquals(1, restored.labels().size()); assertEquals("已整理", restored.labels().get(0).getName());
            assertTrue(restored.tiles().stream().allMatch(tile -> a.getId().equals(tile.labelId())));
            // Model-generated nodes inherit current labels without passing label metadata to AI.
            var settings = mock(ModelApiSettingsService.class); var model = mock(ChatModel.class); when(settings.chatModel()).thenReturn(model);
            when(model.call(any(Prompt.class))).thenReturn(reply("{\"userMessage\":\"融合\",\"answer\":\"回答\"}"));
            var transactions = new TransactionTemplate(manager);
            var fusion = new TileFusionService(tiles,messages,edges,settings,transactions);
            assertEquals(a.getId(), fusion.fuse(new FuseTilesReqVO("fused",List.of("one","two"),"a")).tile().getLabelId());
            controller.assign(new LabelController.AssignLabel("a", List.of("two"),null));
            assertNull(fusion.fuse(new FuseTilesReqVO("mixed",List.of("one","two"),"a")).tile().getLabelId());
            when(model.call(any(Prompt.class))).thenReturn(reply("{\"splittable\":true,\"reason\":\"可细分\"}"),reply("{\"tiles\":[{\"userMessage\":\"子问题一\",\"answer\":\"回答一\"},{\"userMessage\":\"子问题二\",\"answer\":\"回答二\"}]}"));
            var splitting = new TileSplitService(tiles,messages,edges,settings,transactions);
            assertTrue(splitting.split(new SplitTileReqVO("one",null,"a")).children().stream().allMatch(child -> a.getId().equals(child.tile().getLabelId())));
            // Force label deletion to fail after clearing Tile references, proving atomic deletion.
            jdbc.execute("CREATE FUNCTION reject_label_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced delete failure'; END $$");
            jdbc.execute("CREATE TRIGGER reject_label_delete BEFORE DELETE ON t_label FOR EACH ROW EXECUTE FUNCTION reject_label_delete()");
            assertThrows(RuntimeException.class, () -> controller.delete(a.getId(),"a"));
            assertEquals(a.getId(), jdbc.queryForObject("SELECT label_id FROM t_tile WHERE tile_id='one'", Long.class));
            jdbc.execute("DROP TRIGGER reject_label_delete ON t_label");
            int before = jdbc.queryForObject("SELECT count(*) FROM t_tile",Integer.class);
            controller.delete(a.getId(),"a");
            assertEquals(before,jdbc.queryForObject("SELECT count(*) FROM t_tile",Integer.class));
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM t_tile WHERE map_id='a' AND label_id IS NOT NULL",Integer.class));
            controller.assign(new LabelController.AssignLabel("b",List.of("other"),b.getId()));
            jdbc.update("DELETE FROM t_map WHERE map_id='b'");
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM t_label WHERE map_id='b'",Integer.class));
            assertEquals(before-1,jdbc.queryForObject("SELECT count(*) FROM t_tile",Integer.class));
        } finally { admin.execute("DROP SCHEMA " + schemaName + " CASCADE"); }
    }
    private static ChatResponse reply(String text) { return new ChatResponse(List.of(new Generation(new AssistantMessage(text)))); }
}
