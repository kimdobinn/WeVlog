import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    }
});

const bucketName = process.env.S3_BUCKET_NAME!;

// Generate presigned URL for uploading
export async function getUploadUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: contentType
    });

    // URL expires in 15 minutes
    return getSignedUrl(s3Client, command, { expiresIn: 900 });
}

// Generate presigned URL for viewing/downloading
export async function getDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key
    });

    // URL expires in 1 hour
    return getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

// Delete a file from S3
export async function deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key
    });

    await s3Client.send(command);
}

// Generate a unique S3 key for a shot video
export function generateVideoKey(sessionId: string, shotId: string, filename: string): string {
    const timestamp = Date.now();
    const extension = filename.split('.').pop() || 'mp4';
    return `sessions/${sessionId}/shots/${shotId}/${timestamp}.${extension}`;
}
