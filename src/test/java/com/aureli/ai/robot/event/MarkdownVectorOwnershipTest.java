package com.aureli.ai.robot.event;

import com.aureli.ai.robot.event.listener.AiCustomerServiceMdUploadedListener;
import com.aureli.ai.robot.reader.MarkdownReader;
import com.aureli.ai.robot.domain.mapper.AiCustomerServiceMdStorageMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.*;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;

class MarkdownVectorOwnershipTest {
    @Test void sameContentHasStableIdsWithinFileAndDifferentIdsAcrossFiles() {
        var listener = new AiCustomerServiceMdUploadedListener();
        var reader = mock(MarkdownReader.class);
        var vectors = mock(VectorStore.class);
        var transaction = mock(TransactionTemplate.class);
        ReflectionTestUtils.setField(listener, "markdownReader", reader);
        ReflectionTestUtils.setField(listener, "vectorStore", vectors);
        ReflectionTestUtils.setField(listener, "transactionTemplate", transaction);
        ReflectionTestUtils.setField(listener, "aiCustomerServiceMdStorageMapper", mock(AiCustomerServiceMdStorageMapper.class));
        when(transaction.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0)).doInTransaction(new SimpleTransactionStatus()));
        when(reader.loadMarkdown(any(), any())).thenAnswer(call -> List.of(Document.builder()
                .text("相同正文").metadata(call.getArgument(1)).build()));
        for (long id : List.of(10L, 10L, 11L)) listener.vectorizing(AiCustomerServiceMdUploadedEvent.builder()
                .id(id).filePath("/tmp/ownership-test.md").metadatas(Map.of("mdStorageId", id)).build());
        @SuppressWarnings("unchecked") ArgumentCaptor<List<Document>> captor = ArgumentCaptor.forClass(List.class);
        verify(vectors, times(3)).add(captor.capture());
        var batches = captor.getAllValues();
        assertEquals(batches.get(0).get(0).getId(), batches.get(1).get(0).getId());
        assertNotEquals(batches.get(0).get(0).getId(), batches.get(2).get(0).getId());
        assertEquals(11L, batches.get(2).get(0).getMetadata().get("mdStorageId"));
    }
}
