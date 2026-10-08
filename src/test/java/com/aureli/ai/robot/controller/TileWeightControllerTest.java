package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class TileWeightControllerTest {
    private TileMapper tiles;
    private MockMvc mvc;

    @BeforeEach void setUp() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), TileDO.class);
        tiles = mock(TileMapper.class);
        mvc = MockMvcBuilders.standaloneSetup(new TileWorkspaceController(
                tiles, mock(TileEdgeMapper.class), mock(TileMessageMapper.class), new com.aureli.ai.robot.reader.TileFileContentReader())).build();
    }

    @ParameterizedTest @ValueSource(ints = {1, 2, 3})
    @SuppressWarnings({"unchecked", "rawtypes"})
    void updatesOnlyRequestedTileWeightAndTimestamp(int weight) throws Exception {
        when(tiles.update(isNull(), any())).thenReturn(1);
        mvc.perform(post("/customer-service/tile/weight").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"tileId\":\"current-tile\",\"weight\":" + weight + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true));
        var captor = ArgumentCaptor.forClass(LambdaUpdateWrapper.class);
        verify(tiles).update(isNull(), captor.capture());
        LambdaUpdateWrapper<TileDO> update = captor.getValue();
        assertTrue(update.getSqlSet().contains("weight="));
        assertTrue(update.getSqlSet().contains("update_time="));
        assertFalse(update.getSqlSet().contains("answer_summary"));
        assertTrue(update.getSqlSegment().contains("tile_id ="));
        assertTrue(update.getParamNameValuePairs().containsValue(weight));
        assertTrue(update.getParamNameValuePairs().containsValue("current-tile"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "4", "-1", "null"})
    void rejectsInvalidWeightWithoutWriting(String weight) throws Exception {
        mvc.perform(post("/customer-service/tile/weight").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"tileId\":\"current-tile\",\"weight\":" + weight + "}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(tiles);
    }

    @Test void rejectsBlankIdWithoutWriting() throws Exception {
        mvc.perform(post("/customer-service/tile/weight").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"tileId\":\" \",\"weight\":2}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(tiles);
    }

    @Test void missingTileReturnsFailure() throws Exception {
        when(tiles.update(isNull(), any())).thenReturn(0);
        mvc.perform(post("/customer-service/tile/weight").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"tileId\":\"missing\",\"weight\":2}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(false));
    }
}
