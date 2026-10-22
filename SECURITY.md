# Security

The current 0.1.x line is the supported release line. Report a security issue
through the repository's private vulnerability reporting feature when available.
If that feature is unavailable, open a minimal issue asking for a private channel
without publishing exploit details, credentials or private traces.

This tool is for local development. It binds only IPv4 loopback, rejects foreign
Host/Origin requests, limits resources and never proxies a remote service or
executes fixture code. These restrictions do not constitute a hostile-process
sandbox. Do not expose it through a tunnel or reverse proxy.

Fixture text and Last-Event-ID values appear in reports. Review content before
sharing. Avoid sensitive fixture values and use synthetic bug reproductions.
Input parsing and rendering bugs should be reported even when only local use is
affected. Dependencies are currently limited to Node built-ins; keep Node on a
supported, patched release.
