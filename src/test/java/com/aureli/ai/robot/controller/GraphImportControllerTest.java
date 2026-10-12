package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.*;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.service.GraphImportService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class GraphImportControllerTest {
    MapMapper maps; TileMapper tiles; TileMessageMapper messages; TileEdgeMapper edges; LabelMapper labels;
    GraphImportService service; MockMvc mvc;
    public static final String FIXTURE = """
        {"name":"历史记录（导入）","tiles":[
          {"id":"a","message":"问题","answer":"完整回答\\n第二段","weight":3,"labelId":7},
          {"id":"b","message":"便签","tileType":"NOTE","content":"正文","relatedTileIds":["a"]},
          {"id":"c","message":"doc.pdf","tileType":"FILE","content":"文件文字","fileSize":42}],
          "edges":[],"labels":[{"id":7,"name":"研究","colorHex":"#AABBCC"}],"layout":{"a":{"x":-42,"y":120}}}
        """;

    @BeforeEach void setup() {
        maps = mock(MapMapper.class); tiles = mock(TileMapper.class); messages = mock(TileMessageMapper.class);
        edges = mock(TileEdgeMapper.class); labels = mock(LabelMapper.class);
        when(labels.insert(any(LabelDO.class))).thenAnswer(call -> { ((LabelDO)call.getArgument(0)).setId(88L); return 1; });
        service = new GraphImportService(maps, tiles, messages, edges, labels);
        mvc = MockMvcBuilders.standaloneSetup(new GraphImportController(service)).build();
    }

    @Test void restoresCompleteContentReferencesAndLayoutWithNewIdsOnEachImport() {
        var document = JsonMapper.builder().build().readTree(FIXTURE);
        var result = service.importGraph(document);
        assertEquals(3, result.tiles().size());
        var qa = result.tiles().getFirst();
        assertNotEquals("a", qa.id());
        assertEquals("完整回答\n第二段", qa.answer());
        assertEquals(3, qa.weight()); assertEquals(88L, qa.labelId());
        assertEquals("正文", result.tiles().get(1).answer());
        assertEquals("文件文字", result.tiles().get(2).content());
        assertEquals(java.util.List.of(qa.id()), result.tiles().get(1).relatedTileIds());
        assertEquals(qa.id(), result.edges().getFirst().sourceTileId());
        assertEquals(new GraphImportService.Point(-42,120), result.layout().get(qa.id()));
        verify(messages,times(2)).insert(any(TileMessageDO.class));
        verify(tiles,times(3)).insert(any(TileDO.class));
        var repeated = service.importGraph(document);
        assertNotEquals(result.map().getMapId(), repeated.map().getMapId());
        assertNotEquals(qa.id(), repeated.tiles().getFirst().id());
    }

    @Test void rejectsMalformedJsonAndInvalidSnapshotsBeforeAnyWrite() throws Exception {
        for (String body : java.util.List.of("{", "null", "[]", "{}",
                FIXTURE.replace("\"weight\":3", "\"weight\":\"3\""),
                FIXTURE.replace("\"relatedTileIds\":[\"a\"]", "\"relatedTileIds\":[\"gone\"]"),
                FIXTURE.replace("\"labelId\":7", "\"labelId\":99"),
                FIXTURE.replace("\"x\":-42", "\"x\":\"bad\""))) {
            mvc.perform(post("/customer-service/maps/import").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.success").value(false))
                    .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("JSON 格式错误")));
        }
        verifyNoInteractions(maps,tiles,messages,edges,labels);
    }

    @Test void serializesImportedWorkspaceForTheClient() throws Exception {
        mvc.perform(post("/customer-service/maps/import").contentType(MediaType.APPLICATION_JSON).content(FIXTURE))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.map.name").value("历史记录（导入）"))
                .andExpect(jsonPath("$.data.tiles.length()").value(3))
                .andExpect(jsonPath("$.data.tiles[0].answer").value("完整回答\n第二段"))
                .andExpect(jsonPath("$.data.tiles[0].labelId").value(88))
                .andExpect(jsonPath("$.data.edges.length()").value(1))
                .andExpect(jsonPath("$.data.layout.*.x").value(org.hamcrest.Matchers.contains(-42.0)));
    }
}
