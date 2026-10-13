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

class TileSizeControllerTest {
    private TileMapper tiles;
    private MockMvc mvc;

    @BeforeEach void setUp() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), TileDO.class);
        tiles = mock(TileMapper.class);
        mvc = MockMvcBuilders.standaloneSetup(new TileWorkspaceController(
                tiles, mock(TileEdgeMapper.class), mock(TileMessageMapper.class), new com.aureli.ai.robot.reader.TileFileContentReader(), mock(com.aureli.ai.robot.domain.mapper.LabelMapper.class))).build();
    }

    @ParameterizedTest @ValueSource(ints = {200, 440, 4000})
    @SuppressWarnings({"unchecked", "rawtypes"})
    void updatesOnlyRequestedTileSizeAndTimestamp(int width) throws Exception {
        when(tiles.update(isNull(), any())).thenReturn(1);
        mvc.perform(post("/customer-service/tile/size").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"tileId\":\"current-tile\",\"height\":320,\"width\":" + width + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true));
        var captor = ArgumentCaptor.forClass(LambdaUpdateWrapper.class);
        verify(tiles).update(isNull(), captor.capture());
        LambdaUpdateWrapper<TileDO> update = captor.getValue();
        assertTrue(update.getSqlSet().contains("width="));
        assertTrue(update.getSqlSet().contains("update_time="));
        assertFalse(update.getSqlSet().contains("answer_summary"));
        assertFalse(update.getSqlSet().contains("weight="));
        assertTrue(update.getSqlSet().contains("height="));
        assertTrue(update.getSqlSegment().contains("map_id ="));
        assertTrue(update.getSqlSegment().contains("tile_id ="));
        assertTrue(update.getParamNameValuePairs().containsValue(width));
        assertTrue(update.getParamNameValuePairs().containsValue("current-tile"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "199", "4001", "-1"})
    void rejectsInvalidWidthWithoutWriting(String width) throws Exception {
        mvc.perform(post("/customer-service/tile/size").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"tileId\":\"current-tile\",\"width\":" + width + ",\"height\":200}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(tiles);
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "159", "4001", "-1"})
    void rejectsInvalidHeightWithoutWriting(String height) throws Exception {
        mvc.perform(post("/customer-service/tile/size").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"tileId\":\"current-tile\",\"width\":260,\"height\":" + height + "}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(tiles);
    }

    @Test @SuppressWarnings({"unchecked", "rawtypes"})
    void nullableDimensionsResetToDefaultsAndNeverChangeWeight() throws Exception {
        when(tiles.update(isNull(), any())).thenReturn(1);
        mvc.perform(post("/customer-service/tile/size").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"tileId\":\"current-tile\",\"width\":null,\"height\":null}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true));
        var captor = ArgumentCaptor.forClass(LambdaUpdateWrapper.class);
        verify(tiles).update(isNull(), captor.capture());
        LambdaUpdateWrapper<TileDO> update = captor.getValue();
        assertTrue(update.getSqlSet().contains("width="));
        assertTrue(update.getSqlSet().contains("height="));
        assertFalse(update.getSqlSet().contains("weight="));
        assertTrue(update.getParamNameValuePairs().containsValue(null));
        assertTrue(update.getSqlSegment().contains("map_id ="));
    }

    @Test void missingTileReturnsFailure() throws Exception {
        when(tiles.update(isNull(), any())).thenReturn(0);
        mvc.perform(post("/customer-service/tile/size").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"tileId\":\"missing\",\"width\":300,\"height\":240}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(false));
    }
}
