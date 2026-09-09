package com.termau.bldesk;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.ConnectException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NoRouteToHostException;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.ArrayDeque;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * TCP reachability from the phone.
 *
 * The desktop build probes from the Electron main process; a WebView cannot
 * open a raw socket, so on Android the same question needs native code. This is
 * deliberately the one operation: connect, time it, close. No scanning helpers,
 * no ranges, no hostname resolution.
 *
 * The distinction the UI depends on is refused vs timeout. A refusal means
 * something answered and the host is up with the port shut - a different problem
 * from a silent drop, and a different fix (service down rather than firewall).
 *
 * The JavaScript side checks the target against the current server list and
 * applies the same per-minute budget, but it runs in the same context as its
 * caller: those checks stop the app probing by accident, not a direct call to
 * this plugin. So the bounds that actually hold live here - an IP-literal
 * requirement, a rolling per-minute budget and a cap on concurrent sockets.
 * Two numbers and a check, deliberately, rather than a policy layer.
 *
 * The address list stays on the JavaScript side. It is supplied by the renderer
 * on both platforms, so it was never proof of account ownership, and moving it
 * here would not make it so.
 */
@CapacitorPlugin(name = "NetProbe")
public class NetProbePlugin extends Plugin {

    private static final int MIN_TIMEOUT_MS = 500;
    private static final int MAX_TIMEOUT_MS = 10000;

    /** Matches the desktop's budget: plenty for a person, useless for a scan. */
    private static final int RATE_LIMIT_PER_MINUTE = 30;
    /** Each probe holds a thread and a socket, so a burst is bounded too. */
    private static final int MAX_CONCURRENT_PROBES = 4;

    private static final ArrayDeque<Long> recentProbes = new ArrayDeque<>();
    private static final AtomicInteger inFlight = new AtomicInteger(0);

    private static synchronized boolean underRateLimit() {
        long now = System.currentTimeMillis();
        while (!recentProbes.isEmpty() && now - recentProbes.peekFirst() > 60_000L) {
            recentProbes.pollFirst();
        }
        if (recentProbes.size() >= RATE_LIMIT_PER_MINUTE) return false;
        recentProbes.addLast(now);
        return true;
    }

    @PluginMethod
    public void probeTcp(PluginCall call) {
        final String host = call.getString("host");
        final Integer portArg = call.getInt("port");
        int t = call.getInt("timeoutMs", 3000);
        final int timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(t, MAX_TIMEOUT_MS));

        if (host == null || portArg == null || portArg < 1 || portArg > 65535) {
            call.resolve(fail("invalid-target", "host and port are required"));
            return;
        }
        if (!isIpLiteral(host)) {
            call.resolve(fail("invalid-target", "not an IP literal"));
            return;
        }
        // After the target checks, as on the desktop, so a malformed call does
        // not spend the budget. Concurrency first, then the budget, so that a
        // call turned away for being one of too many at once has not also
        // consumed a probe it never made.
        if (inFlight.incrementAndGet() > MAX_CONCURRENT_PROBES) {
            inFlight.decrementAndGet();
            call.resolve(fail("invalid-target", "too many probes at once"));
            return;
        }
        if (!underRateLimit()) {
            inFlight.decrementAndGet();
            call.resolve(fail("invalid-target", "too many probes - wait a minute"));
            return;
        }
        final int port = portArg;

        // Off the main thread: connect() blocks for up to timeoutMs.
        new Thread(() -> {
            Socket socket = new Socket();
            long startedAt = System.nanoTime();
            JSObject result;
            try {
                socket.connect(new InetSocketAddress(InetAddress.getByName(host), port), timeoutMs);
                long ms = (System.nanoTime() - startedAt) / 1_000_000L;
                result = new JSObject();
                result.put("ok", true);
                result.put("latencyMs", ms);
            } catch (SocketTimeoutException e) {
                result = fail("timeout", "no answer within " + timeoutMs + "ms");
            } catch (ConnectException e) {
                String message = e.getMessage() == null ? "" : e.getMessage().toLowerCase();
                // ECONNREFUSED surfaces as "Connection refused" here.
                result = message.contains("refused")
                        ? fail("refused", e.getMessage())
                        : fail("unreachable", e.getMessage());
            } catch (NoRouteToHostException | UnknownHostException e) {
                result = fail("unreachable", e.getMessage());
            } catch (Exception e) {
                result = fail("other", e.getClass().getSimpleName() + ": " + e.getMessage());
            } finally {
                inFlight.decrementAndGet();
                try {
                    socket.close();
                } catch (Exception ignored) {
                    // Nothing useful to do; the probe result is already decided.
                }
            }
            call.resolve(result);
        }, "bldesk-tcp-probe").start();
    }

    private static JSObject fail(String error, String detail) {
        JSObject o = new JSObject();
        o.put("ok", false);
        o.put("error", error);
        if (detail != null) o.put("detail", detail);
        return o;
    }

    /**
     * IPv4 dotted quad, or IPv6 hex groups and colons. Never a hostname.
     *
     * The colon branch has to be a real parse, not a character class:
     * "1.2.3.4:22" passes a class check, is not a literal, and would reach
     * getByName below - which resolves whatever it cannot parse. Mixed forms
     * like "::ffff:1.2.3.4" are refused for the same reason; BinaryLane hands
     * out neither, and every form allowed here is one this plugin must accept.
     */
    private static boolean isIpLiteral(String value) {
        if (value.indexOf(':') >= 0) return isIpv6Literal(value);
        String[] parts = value.split("\\.", -1);
        if (parts.length != 4) return false;
        for (String part : parts) {
            if (part.isEmpty() || part.length() > 3) return false;
            for (int i = 0; i < part.length(); i++) {
                if (!Character.isDigit(part.charAt(i))) return false;
            }
            if (Integer.parseInt(part) > 255) return false;
        }
        return true;
    }

    /** At most one "::", every group 1-4 hex digits, eight groups unless elided. */
    private static boolean isIpv6Literal(String value) {
        if (!value.matches("[0-9A-Fa-f:]+")) return false;
        int elision = value.indexOf("::");
        if (elision >= 0 && value.indexOf("::", elision + 1) >= 0) return false;
        int groups = 0;
        for (String group : value.split(":", -1)) {
            if (group.isEmpty()) continue;
            if (!group.matches("[0-9A-Fa-f]{1,4}")) return false;
            groups++;
        }
        return elision >= 0 ? groups <= 7 : groups == 8;
    }
}
