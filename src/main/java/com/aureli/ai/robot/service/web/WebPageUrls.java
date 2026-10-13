package com.aureli.ai.robot.service.web;

import java.net.URI;
import java.net.InetAddress;
import java.util.Locale;

/** Validate public HTTP(S) sources before sending them to the hosted extractor. No local fetches. */
public final class WebPageUrls {
    private WebPageUrls() {}
    public static String validate(String value) {
        try {
            String text = value == null ? "" : value.trim();
            URI uri = URI.create(text);
            String host = uri.getHost();
            if (text.length() > 2048 || text.chars().anyMatch(Character::isISOControl)
                    || host == null || uri.getUserInfo() != null
                    || !("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                    || (uri.getPort() != -1 && uri.getPort() != 80 && uri.getPort() != 443 && uri.getPort() != 8081)) throw new IllegalArgumentException();
            host = host.toLowerCase(Locale.ROOT);
            if (host.endsWith(".")) host = host.substring(0, host.length() - 1);
            if (host.equals("localhost") || host.endsWith(".localhost") || host.endsWith(".local")
                    || host.endsWith(".internal") || (!host.contains(".") && !host.contains(":"))) throw new IllegalArgumentException();
            // Only parse literal addresses; ordinary hostnames do not cause DNS/network calls here.
            if (host.contains(":") || host.matches("[0-9.]+")) {
                InetAddress address = InetAddress.getByName(host);
                byte[] bytes = address.getAddress();
                if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                        || address.isSiteLocalAddress() || address.isMulticastAddress()
                        || (bytes.length == 16 && (bytes[0] & 0xfe) == 0xfc)
                        || (bytes.length == 4 && ((bytes[0] & 255) == 0 || (bytes[0] & 255) >= 224
                            || ((bytes[0] & 255) == 100 && (bytes[1] & 255) >= 64 && (bytes[1] & 255) <= 127))))
                    throw new IllegalArgumentException();
            }
            return uri.toASCIIString();
        } catch (Exception error) {
            throw new IllegalArgumentException("请填写公开的 HTTP / HTTPS 网页地址，不支持本地地址、内网地址或带账号密码的网址。");
        }
    }
}
