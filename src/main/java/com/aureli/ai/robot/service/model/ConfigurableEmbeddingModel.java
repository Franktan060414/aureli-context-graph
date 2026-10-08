package com.aureli.ai.robot.service.model;

import org.springframework.ai.document.Document;
import org.springframework.ai.embedding.*;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;
import java.util.List;

/** The PGVector bean resolves this primary model for both ingestion and retrieval. */
@Component
@Primary
public class ConfigurableEmbeddingModel implements EmbeddingModel {
    private final ModelApiSettingsService settings;
    public ConfigurableEmbeddingModel(ModelApiSettingsService settings) { this.settings = settings; }
    @Override public EmbeddingResponse call(EmbeddingRequest request) { return settings.embeddingModel().call(request); }
    @Override public float[] embed(Document document) { return settings.embeddingModel().embed(document); }
    @Override public String getEmbeddingContent(Document document) { return settings.embeddingModel().getEmbeddingContent(document); }
    @Override public int dimensions() { return settings.dimensions(); }
    @Override public List<float[]> embed(List<Document> documents, EmbeddingOptions options, BatchingStrategy batchingStrategy) {
        // Keep one model snapshot for an entire document batch.
        return settings.embeddingModel().embed(documents, options, batchingStrategy);
    }
}
