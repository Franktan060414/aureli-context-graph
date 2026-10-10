package com.aureli.ai.robot.domain;

import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class TileRelationTypesTest {
    @Test void preservesSplitMeaningForBothSpellings() {
        for (String type : new String[]{"DIVIDES", "DEVIDES"}) {
            assertEquals("DIVIDES", TileRelationTypes.forEdge(TileEdgeDO.builder()
                    .direction("DIRECTED").relationType(type).build()));
        }
        assertEquals("FUSES", TileRelationTypes.forEdge(TileEdgeDO.builder()
                .direction("DIRECTED").relationType("FUSES").build()));
        assertEquals("EXTENDS", TileRelationTypes.forEdge(TileEdgeDO.builder()
                .direction("DIRECTED").relationType("CUSTOM").build()));
    }
}
