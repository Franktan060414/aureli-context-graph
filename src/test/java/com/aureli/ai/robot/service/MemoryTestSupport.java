package com.aureli.ai.robot.service;

import com.aureli.ai.robot.domain.MemoryCategory;
import static org.mockito.Mockito.*;

public final class MemoryTestSupport {
    private MemoryTestSupport() {}
    public static GeneralSettingsService settings() {
        var settings = mock(GeneralSettingsService.class);
        when(settings.contextTokenBudget()).thenReturn(8000);
        return settings;
    }
    public static MemoryClassificationService classifier() {
        var classifier = mock(MemoryClassificationService.class);
        when(classifier.classify(any(), anyString())).thenReturn(MemoryCategory.UNKNOWN);
        return classifier;
    }
}
