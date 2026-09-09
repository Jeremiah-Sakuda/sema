export const MAX_SOURCE_VIDEO_BYTES = 1024 * 1024 * 1024;
export const MAX_SOURCE_VIDEO_LABEL = "1 GB";

export function normalizeSourceVideoContentType(
  name: string,
  contentType: string,
): string | null {
  if (contentType.startsWith("video/")) return contentType;
  if (
    /\.(mov|qt)$/i.test(name) &&
    contentType === "application/octet-stream"
  ) {
    return "video/quicktime";
  }
  return null;
}