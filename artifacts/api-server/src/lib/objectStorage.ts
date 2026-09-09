import { randomUUID } from "crypto";
import { Readable } from "stream";
import { File, Storage } from "@google-cloud/storage";

import {
  canAccessObject,
  getObjectAclPolicy,
  type ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  async savePrivateArtifact(
    data: Buffer,
    contentType: string,
    owner: string,
  ): Promise<string> {
    const objectPath = `/objects/generated/${randomUUID()}`;
    const { bucketName, objectName } = parseObjectPath(
      `${this.getPrivateObjectDir()}/${objectPath.slice("/objects/".length)}`,
    );
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(data, {
      resumable: false,
      contentType,
      metadata: { cacheControl: "private, no-store" },
    });
    await setObjectAclPolicy(file, { owner, visibility: "private" });
    return objectPath;
  }

  async snapshotUpload(objectPath: string, owner: string): Promise<string> {
    const source = await this.getObjectEntityFile(objectPath);
    const [metadata] = await source.getMetadata();
    if (!Number(metadata.size) || Number(metadata.size) > 250 * 1024 * 1024)
      throw new Error("Upload must be between 1 byte and 250 MB.");
    const destinationPath = `/objects/sources/${randomUUID()}`;
    const { bucketName, objectName } = parseObjectPath(
      `${this.getPrivateObjectDir()}/${destinationPath.slice("/objects/".length)}`,
    );
    const destination = objectStorageClient.bucket(bucketName).file(objectName);
    await source.copy(destination);
    await setObjectAclPolicy(destination, { owner, visibility: "private" });
    return destinationPath;
  }

  getPublicObjectSearchPaths(): string[] {
    const paths = Array.from(
      new Set(
        (process.env.PUBLIC_OBJECT_SEARCH_PATHS || "")
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in Object Storage and set the env var.",
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in Object Storage and set the env var.",
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const { bucketName, objectName } = parseObjectPath(
        `${searchPath}/${filePath}`,
      );
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (exists) return file;
    }
    return null;
  }

  async downloadObject(
    file: File,
    cacheTtlSec = 3600,
    range?: string,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const size = Number(metadata.size);
    let start = 0;
    let end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start < 0 ||
        start >= size
      )
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
    }
    const nodeStream = file.createReadStream(range ? { start, end } : {});
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    const headers: Record<string, string> = {
      "Content-Type":
        (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${aclPolicy?.visibility === "public" ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    headers["Accept-Ranges"] = "bytes";
    if (Number.isFinite(size))
      headers["Content-Length"] = String(end - start + 1);
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    return new Response(webStream, { headers, status: range ? 206 : 200 });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const { bucketName, objectName } = parseObjectPath(
      `${this.getPrivateObjectDir()}/uploads/${randomUUID()}`,
    );
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) throw new ObjectNotFoundError();

    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir += "/";
    const { bucketName, objectName } = parseObjectPath(
      `${entityDir}${parts.slice(1).join("/")}`,
    );
    const objectFile = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) throw new ObjectNotFoundError();
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir += "/";
    if (!rawObjectPath.startsWith(entityDir)) return rawObjectPath;
    return `/objects/${rawObjectPath.slice(entityDir.length)}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) return normalizedPath;
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) path = `/${path}`;
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  return {
    bucketName: pathParts[1],
    objectName: pathParts.slice(2).join("/"),
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method,
        expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, make sure you're running on Replit`,
    );
  }
  const payload = (await response.json()) as { signed_url: string };
  return payload.signed_url;
}
