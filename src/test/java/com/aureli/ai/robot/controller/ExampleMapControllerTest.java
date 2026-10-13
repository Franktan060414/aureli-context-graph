package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.MapDO;
import com.aureli.ai.robot.service.ExampleMapService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ExampleMapControllerTest {
    @Test void postCreatesAndReturnsNewMapWhileGetCannotCreate() throws Exception {
        var service = mock(ExampleMapService.class);
        when(service.create()).thenReturn(MapDO.builder().mapId("first").name("示例图谱 · 功能导览").build(),
                MapDO.builder().mapId("second").name("示例图谱 · 功能导览").build());
        var mvc = MockMvcBuilders.standaloneSetup(new ExampleMapController(service)).build();
        mvc.perform(get("/customer-service/maps/example")).andExpect(status().isMethodNotAllowed());
        verifyNoInteractions(service);
        mvc.perform(post("/customer-service/maps/example").contentType("application/json").content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.mapId").value("first"))
                .andExpect(jsonPath("$.data.name").value("示例图谱 · 功能导览"));
        mvc.perform(post("/customer-service/maps/example").contentType("application/json").content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.mapId").value("second"));
        verify(service, times(2)).create();
    }
}
