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
 * Targets are restricted to addresses on the signed-in account before the call
 * reaches here, and rate limited, matching `src/main/reachability.ts`. This
 * refuses anything that is not an IP literal as a second line of defence, so the
 * plugin cannot resolve names even if the JS guard were bypassed.
 */
@CapacitorPlugin(name = "NetProbe")
public class NetProbePlugin extends Plugin {

    private static final int MIN_TIMEOUT_MS = 500;
    private static final int MAX_TIMEOUT_MS = 10000;

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

    /** IPv4 dotted quad or anything containing a colon (IPv6). Never a hostname. */
    private static boolean isIpLiteral(String value) {
        if (value.indexOf(':') >= 0) return value.matches("[0-9A-Fa-f:.]+");
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
}
