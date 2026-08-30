package com.aureli.ai.robot.constants;

import java.time.format.DateTimeFormatter;

/**
 * @Date: 2026/8/19 16:21
 * @Version: v1.0.0
 * @Description: 日期全局常量
 **/
public interface DateConstants {

    /**
     * DateTimeFormatter：年-月-日 时：分：秒
     */
    DateTimeFormatter DATE_FORMAT_Y_M_D_H_M_S = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /**
     * DateTimeFormatter：年-月-日
     */
    DateTimeFormatter DATE_FORMAT_Y_M_D = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    /**
     * DateTimeFormatter：月-日
     */
    DateTimeFormatter DATE_FORMAT_M_D = DateTimeFormatter.ofPattern("MM-dd");

    /**
     * DateTimeFormatter：时：分：秒
     */
    DateTimeFormatter DATE_FORMAT_H_M_S = DateTimeFormatter.ofPattern("HH:mm:ss");

    /**
     * DateTimeFormatter：时：分
     */
    DateTimeFormatter DATE_FORMAT_H_M = DateTimeFormatter.ofPattern("HH:mm");

    /**
     * DateTimeFormatter：年-月
     */
    DateTimeFormatter DATE_FORMAT_Y_M =  DateTimeFormatter.ofPattern("yyyy-MM");
}
