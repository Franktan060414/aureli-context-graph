/**
 * 应用提示词模板的统一入口。
 *
 * <p>按业务场景组织模板类（如 {@link com.aureli.ai.robot.prompt.CustomerServicePrompts}），
 * 集中维护角色说明、回答规则、占位符和上下文片段格式。
 * Controller、Service 和 Advisor 通过此包的渲染方法获取提示词，不内嵌模板正文。
 * 用户输入、检索文档和历史消息由调用方传入，不作为模板保存。
 */
package com.aureli.ai.robot.prompt;
