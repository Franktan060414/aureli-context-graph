package com.aureli.ai.robot.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * @Date: 2026/8/20 21:08
 * @Version: v1.0.0
 * @Description: 自定义线程池
 **/
@Configuration
public class ThreadPoolConfig {

    /**
     * HTTP 请求线程池（IO 密集型任务）
     * @return
     */
    @Bean("httpRequestExecutor")
    public ThreadPoolTaskExecutor httpRequestExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(50); // 核心线程数（保持常驻）
        executor.setMaxPoolSize(200); // 最大线程数（突发流量时扩容）
        executor.setQueueCapacity(1000); // 任务队列容量（缓冲突发请求）
        executor.setKeepAliveSeconds(120); // 空闲线程存活时间（秒）
        executor.setThreadNamePrefix("http-fetcher-"); // 线程名前缀（便于监控）
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy()); // 拒绝策略（由调用线程执行）
        executor.initialize(); // 初始化线程池
        return executor;
    }

    /**
     * 结果处理线程池（CPU 密集型任务）
     * @return
     */
    @Bean("resultProcessingExecutor")
    public ThreadPoolTaskExecutor resultProcessingExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(Runtime.getRuntime().availableProcessors()); // 核心线程数（等于CPU核心数）
        executor.setMaxPoolSize(Runtime.getRuntime().availableProcessors() * 2); // 最大线程数（不超过CPU核心数2倍）
        executor.setQueueCapacity(200); // 较小队列（避免任务堆积）
        executor.setThreadNamePrefix("result-processor-"); // 线程名前缀（便于监控）
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy()); // 拒绝策略（直接抛出异常）
        executor.initialize(); // 初始化线程池
        return executor;
    }

}
