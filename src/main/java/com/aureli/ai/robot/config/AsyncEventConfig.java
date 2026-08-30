package com.aureli.ai.robot.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * @Date: 2026/8/22 16:31
 * @Version: v1.0.0
 * @Description: TODO
 **/
@Configuration
@EnableAsync // 开启异步支持
public class AsyncEventConfig {

    /**
     * 自定义事件处理线程池
     */
    @Bean("eventTaskExecutor")
    public Executor eventTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();

        // 核心线程数：线程池创建时候初始化的线程数
        executor.setCorePoolSize(5);

        // 最大线程数：线程池最大的线程数，只有在缓冲队列满了之后才会申请超过核心线程数的线程
        executor.setMaxPoolSize(10);

        // 缓冲队列：用来缓冲执行任务的队列
        executor.setQueueCapacity(50);

        // 允许线程的空闲时间：当超过了核心线程数之外的线程在空闲时间到达之后会被销毁
        executor.setKeepAliveSeconds(60);

        // 线程池名的前缀：设置好了之后可以方便我们定位处理任务所在的线程池
        executor.setThreadNamePrefix("event-handler-");

        // 拒绝策略：当线程池和队列都满了，如何处理新任务
        // CallerRunsPolicy：不在新线程中执行任务，而是由调用者所在的线程来执行
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());

        // 等待所有任务结束后再关闭线程池
        executor.setWaitForTasksToCompleteOnShutdown(true);

        // 等待终止的最大时间，单位秒
        executor.setAwaitTerminationSeconds(60);

        // 初始化线程池
        executor.initialize();

        return executor;
    }
}
