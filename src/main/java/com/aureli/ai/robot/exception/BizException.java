package com.aureli.ai.robot.exception;

import lombok.Getter;
import lombok.Setter;

/**
 * @Date: 2026/8/19 16:18
 * @Version: v1.0.0
 * @Description: 业务异常
 **/
@Getter
@Setter
public class BizException extends RuntimeException {
    // 异常码
    private String errorCode;
    // 错误信息
    private String errorMessage;

    public BizException(BaseExceptionInterface baseExceptionInterface) {
        this.errorCode = baseExceptionInterface.getErrorCode();
        this.errorMessage = baseExceptionInterface.getErrorMessage();
    }
}
