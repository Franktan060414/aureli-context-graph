package com.aureli.ai.robot.service.impl;

import com.aureli.ai.robot.model.dto.SearchResultDTO;
import com.aureli.ai.robot.service.SearchResultContentFetcherService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.apache.commons.lang3.StringUtils;
import org.jsoup.Jsoup;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * @Author: 犬小哈
 * @Date: 2025/7/30 12:15
 * @Version: v1.0.0
 * @Description: 页面内容提取
 **/
@Service
@Slf4j
public class SearchResultContentFetcherServiceImpl implements SearchResultContentFetcherService {

    @Resource
    private OkHttpClient okHttpClient;
    @Resource(name = "httpRequestExecutor")
    private ThreadPoolTaskExecutor httpExecutor;
    @Resource(name = "resultProcessingExecutor")
    private ThreadPoolTaskExecutor processingExecutor;

    /**
     * 并发批量获取搜索结果页面的内容
     *
     * @param searchResults
     * @param timeout 超时时间
     * @param unit 单位
     * @return
     */
    @Override
    public CompletableFuture<List<SearchResultDTO>> batchFetch(List<SearchResultDTO> searchResults, long timeout, TimeUnit unit) {
        // 步骤1：为每个搜索结果创建独立的异步获取任务
        List<CompletableFuture<SearchResultDTO>> futures = searchResults.stream()
                .map(result -> asynFetchContentForResult(result, timeout, unit))
                .toList();

        // 步骤2：合并所有独立任务为一个聚合任务
        CompletableFuture<Void> allFutures = CompletableFuture.allOf(
                futures.toArray(new CompletableFuture[0])
        );

        // 步骤3：当所有任务完成后收集结果
        return allFutures.thenApplyAsync(v -> // 所有任务完成后触发
                        futures.stream() // 遍历所有已完成的任务
                                .map(future -> {
                                    SearchResultDTO searchResult = future.join();
                                    // 获取页面 HTML 代码
                                    String html = searchResult.getContent();

                                    if (StringUtils.isNotBlank(html)) {
                                        // 提取 HTML 中的文本
                                        searchResult.setContent(Jsoup.parse(html).text());
                                    }

                                    return searchResult;
                                }) // 提取每个任务的结果
                                .collect(Collectors.toList()), // 合并所有结果为一个集合，并返回
                processingExecutor // 使用专用的 processingExecutor 线程池
        );
    }

    /**
     * 异步获取单个 SearchResult 对象对应的页面内容
     * @param result
     * @param timeout
     * @param unit
     * @return
     */
    private CompletableFuture<SearchResultDTO> asynFetchContentForResult(
            SearchResultDTO result,
            long timeout,
            TimeUnit unit) {

        // 异步线程处理
        return CompletableFuture.supplyAsync(() -> {
                    // 获取 HTML 内容
                    String html = syncFetchHtmlContent(result.getUrl());

                    return SearchResultDTO.builder()
                            .url(result.getUrl())
                            .score(result.getScore())
                            .content(html)
                            .build();

                }, httpExecutor) // 使用专用的 httpExecutor 线程池
                // 超时处理
                .completeOnTimeout(createFallbackResult(result), timeout, unit)
                // 异常处理
                .exceptionally(e -> {
                    // 记录错误日志
                    log.error("## 获取页面内容异常, URL: {}", result.getUrl(), e);
                    return createFallbackResult(result);
                });
    }

    /**
     * 创建回退结果（请求失败时使用）
     */
    private SearchResultDTO createFallbackResult(SearchResultDTO searchResult) {
        return SearchResultDTO.builder()
                .url(searchResult.getUrl())
                .score(searchResult.getScore())
                .content("") // 空字符串表示获取页面内容失败
                .build();
    }

    /**
     * 同步获取指定 URL 的 HTML 内容
     * @param url
     * @return
     */
    private String syncFetchHtmlContent(String url) {
        // 构建 HTTP GET 请求
        Request request = new Request.Builder()
                .url(url)  // 设置要访问的目标 URL
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")  // 设置浏览器标识，模拟真实浏览器访问
                .header("Accept", "text/html")  // 指定接受 HTML 格式的响应
                .build();

        try (Response response = okHttpClient.newCall(request).execute()) {  // 执行请求并自动关闭响应资源
            // 检查响应状态和内容
            if (!response.isSuccessful() || response.body() == null) {  // 响应失败或响应体为空
                return "";  // 返回空字符串
            }

            // 读取响应体内容并返回
            return response.body().string();
        } catch (IOException e) {  // 捕获网络 IO 异常
            return "";  // 异常时返回空字符串
        }
    }
}
