package com.aureli.ai.robot.domain.mapper;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.aureli.ai.robot.domain.dos.ChatMessageDO;

/**
 * @Author: 犬小哈
 * @Date: 2026/8/20 18:31
 * @Version: v1.0.0
 * @Description: TODO
 **/
public interface ChatMessageMapper extends BaseMapper<ChatMessageDO> {

    /**
     * 分页查询
     * @param current
     * @param size
     * @param chatId
     * @return
     */
    default Page<ChatMessageDO> selectPageList(Long current, Long size, String chatId) {
        // 分页对象(查询第几页、每页多少数据)
        Page<ChatMessageDO> page = new Page<>(current, size);

        // 构建查询条件
        LambdaQueryWrapper<ChatMessageDO> wrapper = Wrappers.<ChatMessageDO>lambdaQuery()
                .eq(ChatMessageDO::getChatUuid, chatId) // 对话 ID
                .orderByDesc(ChatMessageDO::getCreateTime); // 按创建时间倒序

        return selectPage(page, wrapper);
    }

}
