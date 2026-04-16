import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireEnv } from "@/lib/env";

let cachedS3: S3Client | null = null;

function getS3Client(): S3Client {
  if (cachedS3) return cachedS3;

  const accountId = requireEnv("R2_ACCOUNT_ID");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");

  cachedS3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return cachedS3;
}

export async function uploadFile(
  file: File | Buffer | Uint8Array,
  key: string,
  contentType: string
): Promise<string> {
  const client = getS3Client();
  const bucketName = requireEnv("R2_BUCKET_NAME");
  const publicDomain = requireEnv("R2_PUBLIC_DOMAIN").replace(/\/$/, "");

  // Convert File to Buffer if necessary
  let body: Buffer | Uint8Array;
  if (file instanceof File) {
    const arrayBuffer = await file.arrayBuffer();
    body = new Uint8Array(arrayBuffer);
  } else {
    body = file;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  return `${publicDomain}/${key}`;
}

export async function createPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 3600
): Promise<{ presignedUrl: string; publicUrl: string }> {
  const client = getS3Client();
  const bucketName = requireEnv("R2_BUCKET_NAME");
  const publicUrl = getPublicUrl(key);

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
  });

  const presignedUrl = await getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
  });

  return { presignedUrl, publicUrl };
}

export function getPublicUrl(key: string): string {
  const publicDomain = requireEnv("R2_PUBLIC_DOMAIN").replace(/\/$/, "");
  return `${publicDomain}/${key}`;
}
