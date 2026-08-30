package com.aureli.ai.robot.enums;

import com.aureli.ai.robot.exception.BaseExceptionInterface;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * @Date: 2026/8/19 16:18
 * @Version: v1.0.0
 * @Description: 响应异常码
 **/
@Getter
@AllArgsConstructor
public enum ResponseCodeEnum implements BaseExceptionInterface {

    // ----------- 通用异常状态码 -----------
    SYSTEM_ERROR("10000", "出错啦，后台小哥正在努力修复中..."),
    PARAM_NOT_VALID("10001", "参数错误"),


    // ----------- 业务异常状态码 -----------
    CHAT_NOT_EXISTED("20000", "此对话不存在"),
    UPLOAD_FILE_CANT_EMPTY("20001", "上传文件不能为空"),
    ONLY_SUPPORT_MARKDOWN("20002", "仅支持 Markdown 文件（.md 后缀）"),
    UPLOAD_FILE_FAILED("20003", "文件上传失败"),
    MARKDOWN_FILE_NOT_FOUND("20004", "Markdown 问答文件不存在"),
    MARKDOWN_FILE_CANT_DELETE("20005", "正在处理中的 Markdown 问答文件，不允许删除"),
    ;

    // 异常码
    private String errorCode;
    // 错误信息
    private String errorMessage;

}
