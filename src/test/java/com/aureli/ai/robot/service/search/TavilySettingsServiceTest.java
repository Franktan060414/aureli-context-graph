package com.aureli.ai.robot.service.search;

import com.aureli.ai.robot.controller.TavilySettingsController;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import tools.jackson.databind.json.JsonMapper;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TavilySettingsServiceTest {
    private final TavilySettingsRepository repository = mock(TavilySettingsRepository.class);

    @Test void startsDisabledAndRequiresKeyBeforeEnabling() {
        when(repository.find()).thenReturn(Optional.empty());
        var service = new TavilySettingsService(repository);
        assertFalse(service.view().enabled());
        assertFalse(service.view().keyConfigured());
        assertThrows(IllegalArgumentException.class, () -> service.save(
                new TavilySettingsService.Request(true, TavilySettingsService.DEFAULT_URL, "")));
        verify(repository, never()).save(any());
    }

    @Test void restoresSavedStateRetainsBlankKeyAndDoesNotReturnSecret() {
        var initial = new TavilySettingsRepository.Settings(true, TavilySettingsService.DEFAULT_URL, "fixture-secret");
        when(repository.find()).thenReturn(Optional.of(initial));
        var service = new TavilySettingsService(repository);
        assertTrue(service.view().enabled());
        service.save(new TavilySettingsService.Request(false, initial.mcpUrl(), ""));
        assertEquals("fixture-secret", service.snapshot().apiKey());
        assertFalse(service.view().enabled());
        assertTrue(service.view().keyConfigured());
        assertFalse(JsonMapper.builder().build().writeValueAsString(service.view()).contains("fixture-secret"));
        assertFalse(service.snapshot().toString().contains("fixture-secret"));
        assertFalse(new TavilySettingsService.Request(true, initial.mcpUrl(), "fixture-secret").toString().contains("fixture-secret"));
    }

    @Test void changingServerCannotReuseCredentialsAndDatabaseFailurePreservesActiveState() {
        var initial = new TavilySettingsRepository.Settings(true, TavilySettingsService.DEFAULT_URL, "fixture-secret");
        when(repository.find()).thenReturn(Optional.of(initial));
        var service = new TavilySettingsService(repository);
        assertThrows(IllegalArgumentException.class, () -> service.save(
                new TavilySettingsService.Request(true, "https://other.example/mcp", "")));
        doThrow(new DataAccessResourceFailureException("private-db-detail")).when(repository).save(any());
        assertThrows(DataAccessResourceFailureException.class, () -> service.save(
                new TavilySettingsService.Request(false, initial.mcpUrl(), "")));
        assertEquals(initial, service.snapshot());
        var controller = new TavilySettingsController(service, mock(TavilyMcpSearchService.class));
        var response = controller.save(new TavilySettingsService.Request(false, initial.mcpUrl(), ""));
        assertEquals(500, response.getStatusCode().value());
        assertFalse(JsonMapper.builder().build().writeValueAsString(response.getBody()).contains("private-db-detail"));
    }

    @Test void rejectsCredentialUrlsAndHeaderInjectionAndDisablesIfStorageIsUnavailable() {
        when(repository.find()).thenThrow(new DataAccessResourceFailureException("private-db-detail"));
        var service = new TavilySettingsService(repository);
        assertFalse(service.view().enabled());
        for (String url : new String[]{"file:///tmp/mcp", "https://user:secret@example.com/mcp", "https://example.com/mcp?key=secret"})
            assertThrows(IllegalArgumentException.class, () -> service.save(new TavilySettingsService.Request(true, url, "key")));
        assertThrows(IllegalArgumentException.class, () -> service.save(
                new TavilySettingsService.Request(true, TavilySettingsService.DEFAULT_URL, "key\r\nX-Secret: x")));
        verify(repository, never()).save(any());
    }

    @Test void connectionFailureIsSafeAndTestsEvenWhileDisabledWithoutRunningSearch() {
        when(repository.find()).thenReturn(Optional.of(new TavilySettingsRepository.Settings(false,
                TavilySettingsService.DEFAULT_URL, "fixture-secret")));
        var service = new TavilySettingsService(repository);
        var search = mock(TavilyMcpSearchService.class);
        var controller = new TavilySettingsController(service, search);
        assertEquals(200, controller.testConnection().getStatusCode().value());
        verify(search).testConnection(service.snapshot());
        verify(search, never()).search(any(), any());
        doThrow(new IllegalStateException("fixture-secret upstream body")).when(search).testConnection(any());
        var response = controller.testConnection();
        assertEquals(502, response.getStatusCode().value());
        assertEquals("no-store", response.getHeaders().getCacheControl());
        assertFalse(JsonMapper.builder().build().writeValueAsString(response.getBody()).contains("fixture-secret"));
    }
}
