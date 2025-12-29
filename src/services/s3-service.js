const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');
const { Logger } = require('../config');

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

/**
 * Get a signed URL for reading a file from S3
 */
const getPresignedUrl = async (key, expiresIn = 3600) => {
    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });
        return await getSignedUrl(s3Client, command, { expiresIn });
    } catch (error) {
        Logger.error(`[S3 Service] Error generating signed URL for ${key}:`, error);
        return null;
    }
};

/**
 * Upload a file buffer to S3
 */
const uploadToS3 = async (key, body, contentType) => {
    try {
        const parallelUploads3 = new Upload({
            client: s3Client,
            params: {
                Bucket: BUCKET_NAME,
                Key: key,
                Body: body,
                ContentType: contentType
            },
        });

        await parallelUploads3.done();
        Logger.info(`[S3 Service] Successfully uploaded ${key} to S3`);
        return key;
    } catch (error) {
        Logger.error(`[S3 Service] Error uploading ${key} to S3:`, error);
        throw error;
    }
};

/**
 * Test S3 connectivity
 */
const testConnection = async () => {
    try {
        const { HeadBucketCommand } = require('@aws-sdk/client-s3');
        await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
        Logger.info(`[S3 Service] S3 Connected Successfully to bucket: ${BUCKET_NAME}`);
        return true;
    } catch (error) {
        Logger.error(`[S3 Service] S3 Connection Failed: ${error.message}`);
        return false;
    }
};

/**
 * Delete a file from S3
 */
const deleteFromS3 = async (key) => {
    try {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        await s3Client.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        }));
        Logger.info(`[S3 Service] Successfully deleted ${key} from S3`);
        return true;
    } catch (error) {
        Logger.error(`[S3 Service] Error deleting ${key} from S3:`, error);
        return false;
    }
};

module.exports = {
    s3Client,
    getPresignedUrl,
    uploadToS3,
    deleteFromS3,
    testConnection,
};

