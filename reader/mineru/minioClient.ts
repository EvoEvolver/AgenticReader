import { config } from 'dotenv';
import { Client } from 'minio';
import { basename, resolve } from 'path';
import { existsSync } from 'fs';
import crypto from 'crypto';
import { readFileSync } from 'fs';

// Load .env variables
config();

// Decompose the URL into protocol, endpoint and port
const url = process.env.MINIO_ENDPOINT;
if (!url) throw new Error('MINIO_ENDPOINT environment variable is not set');

const urlParts = new URL(url);
const protocol = urlParts.protocol.replace(':', '');
const endpoint = urlParts.hostname;
const port = urlParts.port ? parseInt(urlParts.port) : (protocol === 'https' ? 443 : 80);

// MinIO client setup
export const minioClient = new Client({
  endPoint: endpoint,
  port: port,
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
  useSSL: protocol === 'https',
});

/**
 * Upload a file to MinIO and return the public URL
 * @param filePath - Local file path
 * @param bucketName - MinIO bucket name
 * @param useHash - Whether to use SHA-256 hash as filename (default: true)
 * @returns Public URL of the uploaded file
 */
export async function uploadFileToMinio(
  filePath: string,
  bucketName: string = 'pdf',
  useHash: boolean = true
): Promise<string> {
  try {
    const resolvedPath = resolve(filePath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`File ${resolvedPath} does not exist`);
    }

    // Generate object name based on hash or original filename
    let objectName: string;
    if (useHash) {
      const fileBuffer = readFileSync(resolvedPath);
      const hash = crypto.createHash('sha256');
      hash.update(fileBuffer);
      const extension = basename(resolvedPath).split('.').pop();
      objectName = hash.digest('hex') + (extension ? `.${extension}` : '');
    } else {
      objectName = basename(resolvedPath);
    }

    // Ensure bucket exists
    const exists = await minioClient.bucketExists(bucketName);
    if (!exists) {
      await minioClient.makeBucket(bucketName);
      console.log(`Created bucket: ${bucketName}`);
    }

    // Upload file
    await minioClient.fPutObject(bucketName, objectName, resolvedPath, {});
    console.log(`Successfully uploaded ${basename(resolvedPath)} to ${bucketName}/${objectName}`);

    // Return public URL
    const publicHost = process.env.MINIO_PUBLIC_HOST || process.env.MINIO_ENDPOINT;
    return `${publicHost}/${bucketName}/${objectName}`;
  } catch (err) {
    throw new Error(`Error uploading file: ${(err as Error).message}`);
  }
}

/**
 * Upload a file by path to images bucket (for assets)
 * @param filePath - Local file path
 * @returns Boolean indicating success
 */
export async function uploadImageToMinio(filePath: string): Promise<boolean> {
  try {
    const resolvedPath = resolve(filePath);
    const objectName = basename(resolvedPath);

    if (!existsSync(resolvedPath)) {
      console.error(`Error: File ${resolvedPath} does not exist`);
      return false;
    }

    const bucketName = 'images';
    const exists = await minioClient.bucketExists(bucketName);
    if (!exists) {
      await minioClient.makeBucket(bucketName);
    }

    await minioClient.fPutObject(bucketName, objectName, resolvedPath, {});
    console.log(`Successfully uploaded image: ${objectName}`);
    return true;
  } catch (err) {
    console.error(`Error uploading image: ${(err as Error).message}`);
    return false;
  }
}
