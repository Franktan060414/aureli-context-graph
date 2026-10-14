package com.aureli.ai.robot.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.dao.DataAccessResourceFailureException;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GeneralSettingsServiceTest {
    final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    @Test void readsPersistedBudgetAndFallsBackWhenMissingOrUnavailable() {
        when(jdbc.query(anyString(), any(RowMapper.class), eq("context_token_budget")))
                .thenReturn(List.of("12000"), List.of())
                .thenThrow(new DataAccessResourceFailureException("database unavailable"));
        var settings = new GeneralSettingsService(jdbc);
        assertEquals(12000, settings.contextTokenBudget());
        assertEquals(8000, settings.contextTokenBudget());
        assertEquals(8000, settings.contextTokenBudget());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }
    @ParameterizedTest @ValueSource(strings = {"", "0", "-1", "not-a-number", "1000001", "99999999999999"})
    void invalidBudgetUsesSafeDefault(String value) {
        when(jdbc.query(anyString(), any(RowMapper.class), eq("context_token_budget"))).thenReturn(List.of(value));
        assertEquals(8000, new GeneralSettingsService(jdbc).contextTokenBudget());
    }
}
