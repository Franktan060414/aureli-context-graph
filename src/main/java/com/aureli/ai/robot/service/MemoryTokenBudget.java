package com.aureli.ai.robot.service;

import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.messages.UserMessage;
import com.knuddels.jtokkit.Encodings;
import com.knuddels.jtokkit.api.Encoding;
import com.knuddels.jtokkit.api.EncodingType;
import java.util.ArrayList;
import java.util.List;

/** Local CL100K estimate plus per-message framing; makes no model or embedding calls. */
public final class MemoryTokenBudget {
    private static final Encoding TOKENS = Encodings.newLazyEncodingRegistry().getEncoding(EncodingType.CL100K_BASE);
    private static final int MESSAGE_OVERHEAD = 8;
    private static final String EXCERPT = "\n[上下文摘录：其余内容未读取，请勿把摘录当作完整结论]";
    private MemoryTokenBudget() {}

    public static int tokens(Message message) {
        return MESSAGE_OVERHEAD + TOKENS.countTokensOrdinary(message.getText());
    }

    public static long tokens(List<Message> messages) {
        return messages.stream().mapToLong(MemoryTokenBudget::tokens).sum();
    }

    /** Preserves roles and the Tile source header; returns null if even the header cannot fit. */
    public static Message excerpt(Message message, int budget) {
        if (tokens(message) <= budget) return message;
        String text = message.getText();
        if (text.startsWith("【Tile 关系参考")) return null; // Do not cut a JSON relation record in half.
        int bodyStart = text.startsWith("【Tile 工作记忆：") ? text.indexOf("】\n") + 2 : 0;
        if (bodyStart < 2) bodyStart = 0;
        String header = text.substring(0, bodyStart);
        if (TOKENS.countTokensOrdinary(header + EXCERPT) + MESSAGE_OVERHEAD > budget) return null;
        int low = bodyStart, high = text.length();
        while (low < high) {
            int middle = low + (high - low + 1) / 2;
            String candidate = text.substring(0, safeEnd(text, middle)) + EXCERPT;
            if (TOKENS.countTokensOrdinary(candidate) + MESSAGE_OVERHEAD <= budget) low = middle;
            else high = middle - 1;
        }
        String result = text.substring(0, safeEnd(text, low)) + EXCERPT;
        while (TOKENS.countTokensOrdinary(result) + MESSAGE_OVERHEAD > budget && low > bodyStart) {
            low = Math.max(bodyStart, low - 1);
            result = text.substring(0, safeEnd(text, low)) + EXCERPT;
        }
        return message.getMessageType() == MessageType.ASSISTANT
                ? new AssistantMessage(result) : new UserMessage(result);
    }

    public static List<Message> fit(List<Message> messages, int budget) {
        if (tokens(messages) <= budget) return List.copyOf(messages);
        var result = new ArrayList<Message>();
        int remaining = Math.max(0, budget);
        for (int i = 0; i < messages.size(); i++) {
            Message clipped = excerpt(messages.get(i), remaining / (messages.size() - i));
            if (clipped != null) {
                result.add(clipped);
                remaining -= tokens(clipped);
            }
        }
        return List.copyOf(result);
    }

    private static int safeEnd(String text, int end) {
        return end > 0 && end < text.length() && Character.isHighSurrogate(text.charAt(end - 1)) ? end - 1 : end;
    }
}
