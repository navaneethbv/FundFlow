export function firstSearchParam(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

export function firstSearchParamOrEmpty(
  value: string | readonly string[] | undefined,
): string {
  return firstSearchParam(value) ?? "";
}
