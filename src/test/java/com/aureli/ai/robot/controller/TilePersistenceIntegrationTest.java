package com.aureli.ai.robot.controller;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

/** Opt-in: verify and remove ONLY the four Tiles created by the live browser/API scripts. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@EnabledIfSystemProperty(named = "aureli.integration.prefix", matches = "studio-check-[0-9]+")
class TilePersistenceIntegrationTest {
    @Autowired JdbcTemplate jdbc;
    @Test
    void generatedAnswersAndMemoryEdgesPersistAndTestRecordsAreCleaned() {
        String prefix = System.getProperty("aureli.integration.prefix");
        List<String> ids = List.of(prefix + "-root", prefix + "-memory", prefix + "-rag", prefix + "-ui");
        long before = jdbc.queryForObject("SELECT COUNT(*) FROM t_tile", Long.class);
        try {
            for (String id : ids) {
                assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile WHERE tile_id = ?", Integer.class, id));
                assertTrue(jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_message WHERE tile_id = ? AND role = 'assistant' AND length(content) > 0", Integer.class, id) > 0);
            }
            assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_edge WHERE source_tile_id = ? AND target_tile_id = ?", Integer.class, ids.get(0), ids.get(1)));
            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_edge WHERE target_tile_id = ?", Integer.class, ids.get(3)));
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_ai_customer_service_md_storage WHERE original_file_name LIKE ?", Integer.class, prefix + "%"));
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_vector_store WHERE metadata->>'originalFileName' LIKE ?", Integer.class, prefix + "%"));
        } finally {
            // Exact ownership IDs only; foreign keys cascade their messages and edges.
            for (String id : ids) jdbc.update("DELETE FROM t_tile WHERE tile_id = ?", id);
        }
        assertEquals(before - 4, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile", Long.class));
        for (String id : ids) assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_message WHERE tile_id = ?", Integer.class, id));
    }
}
