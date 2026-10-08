package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ModelApiSettingsControllerTest {
    @Test void failedSaveReturnsSafeDatabaseError() {
        var service = mock(ModelApiSettingsService.class);
        var request = new ModelApiSettingsService.SettingsRequest(null, null, 1536);
        when(service.save(request)).thenThrow(new DataAccessResourceFailureException("fixture-secret in driver error"));
        var response = new ModelApiSettingsController(service).save(request);
        assertEquals(500, response.getStatusCode().value());
        String body = JsonMapper.builder().build().writeValueAsString(response.getBody());
        assertFalse(body.contains("fixture-secret"));
        assertTrue(body.contains("数据库"));
        assertTrue(body.contains("原配置仍然生效"));
    }

    @Test void connectionTestReturnsModelReply() {
        var service = mock(ModelApiSettingsService.class);
        when(service.testConnection()).thenReturn(
                new ModelApiSettingsService.ConnectionTestView("fixture-model", "连接成功"));
        var response = new ModelApiSettingsController(service).testConnection();
        assertEquals(200, response.getStatusCode().value());
        assertEquals("fixture-model", ((ModelApiSettingsService.ConnectionTestView) response.getBody().getData()).model());
    }

    @Test void connectionTestHidesProviderExceptionDetails() throws Exception {
        var service = mock(ModelApiSettingsService.class);
        when(service.testConnection()).thenThrow(new IllegalStateException("Bearer fixture-secret"));
        var response = new ModelApiSettingsController(service).testConnection();
        assertEquals(502, response.getStatusCode().value());
        String body = JsonMapper.builder().build().writeValueAsString(response.getBody());
        assertFalse(body.contains("fixture-secret"));
        assertTrue(body.contains("API 地址、密钥和模型名称"));
    }
}
