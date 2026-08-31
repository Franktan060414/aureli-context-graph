package com.aureli.ai.robot.service.impl;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.io.unit.DataSizeUtil;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.google.common.collect.Maps;
import com.aureli.ai.robot.domain.dos.AiCustomerServiceMdStorageDO;
import com.aureli.ai.robot.domain.mapper.AiCustomerServiceMdStorageMapper;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.aureli.ai.robot.enums.AiCustomerServiceMdStatusEnum;
import com.aureli.ai.robot.enums.ResponseCodeEnum;
import com.aureli.ai.robot.event.AiCustomerServiceMdUploadedEvent;
import com.aureli.ai.robot.exception.BizException;
import com.aureli.ai.robot.model.vo.customerService.DeleteMarkdownFileReqVO;
import com.aureli.ai.robot.model.vo.customerService.FindMarkdownFilePageListReqVO;
import com.aureli.ai.robot.model.vo.customerService.FindMarkdownFilePageListRspVO;
import com.aureli.ai.robot.model.vo.customerService.UpdateMarkdownFileReqVO;
import com.aureli.ai.robot.service.CustomerService;
import com.aureli.ai.robot.utils.PageResponse;
import com.aureli.ai.robot.utils.Response;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.io.FileUtils;
import org.apache.commons.io.FilenameUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * @Date: 2026/8/22 13:01
 * @Version: v1.0.0
 * @Description: AI 客服
 **/
@Service
@Slf4j
public class CustomerServiceImpl implements CustomerService {

    @Value("${customer-service.md-storage-path}")
    private String mdStoragePath;

    @Resource
    private AiCustomerServiceMdStorageMapper aiCustomerServiceMdStorageMapper;
    @Resource
    private TileMapper tileMapper;
    @Resource
    private TileMessageMapper tileMessageMapper;
    @Resource
    private TileEdgeMapper tileEdgeMapper;

    @Resource
    private ApplicationEventPublisher eventPublisher; // 注入事件发布器

    @Resource
    private VectorStore vectorStore;

    /**
     * 上传 Markdown 问答文件
     *
     * @param file
     * @return
     */
    @Override
    public Response<?> uploadMarkdownFile(MultipartFile file) {
        // 校验文件不能为空
        if (file == null || file.isEmpty()) {
            throw new BizException(ResponseCodeEnum.UPLOAD_FILE_CANT_EMPTY);
        }

        // 获取原始文件名（去除空格）
        String originalFilename = StringUtils.trimToEmpty(file.getOriginalFilename());

        // 验证文件类型，仅支持 Markdown
        if (StringUtils.isBlank(originalFilename) || !isMarkdownFile(originalFilename)) {
            throw new BizException(ResponseCodeEnum.ONLY_SUPPORT_MARKDOWN);
        }

        try {
            // 重新生成文件名 (防止文件名冲突导致覆盖)
            String newFilename = UUID.randomUUID().toString() + "-" + originalFilename;

            // 构建存储路径
            Path storageDirectory = Paths.get(mdStoragePath);
            Path targetPath = storageDirectory.resolve(newFilename);

            // 确保目录存在
            Files.createDirectories(storageDirectory);

            // 保存文件
            file.transferTo(targetPath.toFile());

            // 记录操作日志
            log.info("## Markdown 问答文件存储成功, 文件名：{} -> 存储路径：{}", originalFilename, targetPath);

            // 存储入库
            AiCustomerServiceMdStorageDO aiCustomerServiceMdStorageDO = AiCustomerServiceMdStorageDO.builder()
                    .originalFileName(originalFilename)
                    .newFileName(newFilename)
                    .filePath(targetPath.toString())
                    .fileSize(file.getSize())
                    .status(AiCustomerServiceMdStatusEnum.PENDING.getCode())
                    .createTime(LocalDateTime.now())
                    .updateTime(LocalDateTime.now())
                    .build();

            aiCustomerServiceMdStorageMapper.insert(aiCustomerServiceMdStorageDO);

            // 获取主键 ID
            Long id =  aiCustomerServiceMdStorageDO.getId();

            // 元数据
            Map<String, Object> metadatas = Maps.newHashMap();
            metadatas.put("mdStorageId", id); // 关联的文件存储表主键 ID
            metadatas.put("originalFileName", originalFilename); // 文件原始名称

            // 发布事件
            eventPublisher.publishEvent(AiCustomerServiceMdUploadedEvent.builder()
                    .id(id)
                    .filePath(targetPath.toString())
                    .metadatas(metadatas)
                    .build());

            return Response.success();

        } catch (IOException e) {
            log.error("## Markdown 问答文件上传失败：{}", originalFilename, e);
            throw new BizException(ResponseCodeEnum.UPLOAD_FILE_FAILED);
        }
    }

    /**
     * 删除 Markdown 问答文件
     *
     * @param deleteMarkdownFileReqVO
     * @return
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public Response<?> deleteMarkdownFile(DeleteMarkdownFileReqVO deleteMarkdownFileReqVO) {
        // 文件记录 ID
        Long id = deleteMarkdownFileReqVO.getId();

        // 查询该文件记录
        AiCustomerServiceMdStorageDO aiCustomerServiceMdStorageDO = aiCustomerServiceMdStorageMapper.selectById(id);

        // 若记录不存在
        if (Objects.isNull(aiCustomerServiceMdStorageDO)) {
            throw new BizException(ResponseCodeEnum.MARKDOWN_FILE_NOT_FOUND);
        }

        // 正在处理中的文件，无法删除
        AiCustomerServiceMdStatusEnum statusEnum = AiCustomerServiceMdStatusEnum.codeOf(aiCustomerServiceMdStorageDO.getStatus());
        if (Objects.equals(statusEnum, AiCustomerServiceMdStatusEnum.PENDING) // 待向量化
                || Objects.equals(statusEnum, AiCustomerServiceMdStatusEnum.VECTORIZING)) { // 向量化中...
            throw new BizException(ResponseCodeEnum.MARKDOWN_FILE_CANT_DELETE);
        }

        // 删除文件表记录
        aiCustomerServiceMdStorageMapper.deleteById(id);

        // 删除向量化数据
        vectorStore.delete(String.format("mdStorageId == %s", id));

        // 删除本地文件
        String filePath = aiCustomerServiceMdStorageDO.getFilePath();
        try {
            FileUtils.forceDelete(new File(filePath));
        } catch (IOException e) {
            log.error("## Markdown 问答文件删除失败：", e);
        }

        return Response.success();
    }

    /**
     * 分页查询 Markdown 问答文件
     *
     * @param findMarkdownFilePageListReqVO
     * @return
     */
    @Override
    public PageResponse<FindMarkdownFilePageListRspVO> findMarkdownFilePageList(FindMarkdownFilePageListReqVO findMarkdownFilePageListReqVO) {
        // 获取当前页、以及每页需要展示的数据数量
        Long current = findMarkdownFilePageListReqVO.getCurrent();
        Long size = findMarkdownFilePageListReqVO.getSize();

        // 执行分页查询
        Page<AiCustomerServiceMdStorageDO> mdStorageDOPage = aiCustomerServiceMdStorageMapper.selectPageList(current, size);

        List<AiCustomerServiceMdStorageDO> mdStorageDOS = mdStorageDOPage.getRecords();
        // DO 转 VO
        List<FindMarkdownFilePageListRspVO> vos = null;
        if (CollUtil.isNotEmpty(mdStorageDOS)) {
            vos = mdStorageDOS.stream()
                    .map(mdStorageDO -> FindMarkdownFilePageListRspVO.builder() // 构建返参 VO 实体类
                            .id(mdStorageDO.getId())
                            .originalFileName(mdStorageDO.getOriginalFileName())
                            .fileSize(DataSizeUtil.format(mdStorageDO.getFileSize())) // Hutool 工具库提供的字节转换
                            .status(mdStorageDO.getStatus())
                            .createTime(mdStorageDO.getCreateTime())
                            .updateTime(mdStorageDO.getUpdateTime())
                            .remark(mdStorageDO.getRemark())
                            .build())
                    .collect(Collectors.toList());
        }

        return PageResponse.success(mdStorageDOPage, vos);
    }

    /**
     * 修改  Markdown 问答文件信息
     *
     * @param updateMarkdownFileReqVO
     * @return
     */
    @Override
    public Response<?> updateMarkdownFile(UpdateMarkdownFileReqVO updateMarkdownFileReqVO) {
        // 文件 ID
        Long id = updateMarkdownFileReqVO.getId();
        // 备注
        String remark = updateMarkdownFileReqVO.getRemark();

        // 根据 ID 修改备注信息
        int count = aiCustomerServiceMdStorageMapper.updateById(AiCustomerServiceMdStorageDO.builder()
                .id(id)
                .remark(remark)
                .updateTime(LocalDateTime.now())
                .build());

        // 若影响的行数为 0， 说明该文件记录不存在
        if (count == 0 ) {
            throw new BizException(ResponseCodeEnum.MARKDOWN_FILE_NOT_FOUND);
        }

        return Response.success();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Response<?> resetTileWorkspace() {
        tileEdgeMapper.delete(null);
        tileMessageMapper.delete(null);
        tileMapper.delete(null);
        return Response.success();
    }

    /**
     * 验证文件是否为 Markdown 格式
     */
    private boolean isMarkdownFile(String filename) {
        if (StringUtils.isBlank(filename)) {
            return false;
        }

        // 获取文件扩展名
        String extension = FilenameUtils.getExtension(filename);
        return StringUtils.equalsIgnoreCase(extension, "md");
    }

}
