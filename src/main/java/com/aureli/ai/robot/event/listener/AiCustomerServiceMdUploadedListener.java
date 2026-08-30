package com.aureli.ai.robot.event.listener;

import com.google.common.collect.Lists;
import com.aureli.ai.robot.domain.dos.AiCustomerServiceMdStorageDO;
import com.aureli.ai.robot.domain.mapper.AiCustomerServiceMdStorageMapper;
import com.aureli.ai.robot.enums.AiCustomerServiceMdStatusEnum;
import com.aureli.ai.robot.event.AiCustomerServiceMdUploadedEvent;
import com.aureli.ai.robot.reader.MarkdownReader;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.document.id.IdGenerator;
import org.springframework.ai.document.id.JdkSha256HexIdGenerator;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.context.event.EventListener;
import org.springframework.core.io.FileSystemResource;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * @Date: 2026/8/22 15:29
 * @Version: v1.0.0
 * @Description: Markdown 文件上传事件监听
 **/
@Component
@Slf4j
public class AiCustomerServiceMdUploadedListener {

    @Resource
    private MarkdownReader markdownReader;
    @Resource
    private VectorStore vectorStore;
    @Resource
    private AiCustomerServiceMdStorageMapper aiCustomerServiceMdStorageMapper;
    @Resource
    private TransactionTemplate transactionTemplate;

    /**
     * Markdown 文件向量化
     * @param event
     */
    @EventListener
    @Async("eventTaskExecutor") // 指定使用自定义的线程池
    public void vectorizing(AiCustomerServiceMdUploadedEvent event) {
        log.info("## AiCustomerServiceMdUploadedEvent: {}", event);

        // 文件存储表主键 ID
        Long id =  event.getId();
        // Markdown 文件存储路径
        String filePath = event.getFilePath();
        // 元数据
        Map<String, Object> metadatas = event.getMetadatas();

        // 更新存储文件的处理状态为 “向量化中”
        aiCustomerServiceMdStorageMapper.updateById(AiCustomerServiceMdStorageDO.builder()
                .id(id)
                .status(AiCustomerServiceMdStatusEnum.VECTORIZING.getCode())
                .updateTime(LocalDateTime.now())
                .build());

        // 编程式事务
        boolean isSuccess = Boolean.TRUE.equals(transactionTemplate.execute(status -> {
            try {
                // 读取文件
                org.springframework.core.io.Resource resource = new FileSystemResource(filePath);

                // 解析为 Document 集合
                List<Document> documents = markdownReader.loadMarkdown(resource, metadatas);

                log.info("## documents: {}", documents);

                // 防止重复添加相同文档到 PGVector 中
                // 这里仅对正文内容做哈希，同一份文件重复上传才能命中同一个 ID，从而被覆盖而非新增
                JdkSha256HexIdGenerator jdkSha256HexIdGenerator = new JdkSha256HexIdGenerator();
                IdGenerator contentHashIdGenerator = contents -> jdkSha256HexIdGenerator.generateId(contents[0]);

                // 重建 Document，将随机 ID 替换为基于内容哈希的确定性 ID
                List<Document> documentsWithStableId = documents.stream()
                        .map(doc -> Document.builder()
                                .text(doc.getText()) // 保留原文内容
                                .metadata(doc.getMetadata()) // 保留文件关联元数据
                                .idGenerator(contentHashIdGenerator) // 基于内容哈希生成确定性 ID
                                .build())
                        .toList();

                // 通过向量模型，将文档分批向量化并写入 PGVector
                // 注意：向量模型服务端限制单次批量向量化数量不能超过 10 条，这里按 10 条一批分批写入
                // 相同内容永远落到同一个 ID 上，天然幂等，重复上传不会产生重复数据
                for (List<Document> batch : Lists.partition(documentsWithStableId, 10)) {
                    vectorStore.add(batch);
                }

                // 更新存储文件的处理状态为 “已完成”
                aiCustomerServiceMdStorageMapper.updateById(AiCustomerServiceMdStorageDO.builder()
                        .id(id)
                        .status(AiCustomerServiceMdStatusEnum.COMPLETED.getCode())
                        .updateTime(LocalDateTime.now())
                        .build());

                return true;
            } catch (Exception ex) {
                log.error("## Markdown 文件向量化失败: {}", event, ex);
                status.setRollbackOnly(); // 标记事务为回滚
                return false;
            }
        }));

        // 若事务执行失败，更新存储文件的处理状态为 “失败”
        if (!isSuccess) {
            aiCustomerServiceMdStorageMapper.updateById(AiCustomerServiceMdStorageDO.builder()
                    .id(id)
                    .status(AiCustomerServiceMdStatusEnum.FAILED.getCode())
                    .updateTime(LocalDateTime.now())
                    .build());
        }
    }
}
