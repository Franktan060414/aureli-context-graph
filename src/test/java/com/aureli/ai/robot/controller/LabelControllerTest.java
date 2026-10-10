package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.*;
import com.aureli.ai.robot.domain.mapper.*;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.List;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class LabelControllerTest {
    LabelMapper labels; TileMapper tiles; MockMvc mvc;
    @BeforeEach void setup() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(),""),LabelDO.class);
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(),""),TileDO.class);
        labels = mock(LabelMapper.class); tiles = mock(TileMapper.class);
        when(labels.lockMap("a")).thenReturn("a");
        mvc = MockMvcBuilders.standaloneSetup(new LabelController(labels,tiles)).build();
    }
    @ParameterizedTest @ValueSource(strings = {"red","#FFF","#FFFFFF00","#GGGGGG",""})
    void rejectsInvalidHexBeforeWriting(String color) throws Exception {
        mvc.perform(post("/customer-service/labels").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"a\",\"name\":\"研究\",\"colorHex\":\""+color+"\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(labels,tiles);
    }
    @Test void validatesSelectionAndAllowsExplicitNullForClear() throws Exception {
        for (String body : List.of("{\"mapId\":\"a\",\"tileIds\":[]}","{\"mapId\":\"a\",\"tileIds\":[null]}",
                "{\"mapId\":\"a\",\"tileIds\":[\"one\"],\"labelId\":0}","{\"tileIds\":[\"one\"]}")) {
            mvc.perform(post("/customer-service/tile/label").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(labels,tiles);
        when(tiles.selectList(any())).thenReturn(List.of(TileDO.builder().tileId("one").mapId("a").build()));
        when(tiles.update(isNull(),any())).thenReturn(1);
        mvc.perform(post("/customer-service/tile/label").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"a\",\"tileIds\":[\"one\"],\"labelId\":null}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true));
        verify(labels,never()).selectOne(any());
    }
    @Test void staleSelectionAndMissingMapHaveNoWrites() throws Exception {
        when(tiles.selectList(any())).thenReturn(List.of());
        mvc.perform(post("/customer-service/tile/label").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"a\",\"tileIds\":[\"missing\"]}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("部分 Tile 不存在或不属于当前图谱，请同步后重试"));
        verify(tiles,never()).update(any(),any());
        mvc.perform(post("/customer-service/labels").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"missing\",\"name\":\"研究\",\"colorHex\":\"#FFFFFF\"}"))
                .andExpect(status().isBadRequest());
        verify(labels,never()).insert(any(LabelDO.class));
    }
}
