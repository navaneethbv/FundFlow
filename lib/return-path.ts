/** Accept only local paths, including query strings, without ambiguous separators. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\u0000-\u0020]/.test(decoded)) return "/dashboard";
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid" || ["/login", "/signup", "/auth/callback"].includes(url.pathname)) return "/dashboard";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/dashboard"; }
}
