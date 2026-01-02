import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

// Configure Cloudinary - this will be called after dotenv loads
export const configureCloudinary = () => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  // Debug: Log if configuration is missing
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    console.error('[CLOUDINARY] Missing configuration:', {
      cloud_name: !!process.env.CLOUDINARY_CLOUD_NAME,
      api_key: !!process.env.CLOUDINARY_API_KEY,
      api_secret: !!process.env.CLOUDINARY_API_SECRET,
    });
  } else {
    console.log('[CLOUDINARY] Configuration loaded successfully');
  }
};

interface UploadResult {
  url: string;
  publicId: string;
  secureUrl: string;
  width: number;
  height: number;
  format: string;
}

export const uploadImage = async (
  fileBuffer: Buffer,
  folder: string = 'relun/profiles'
): Promise<UploadResult> => {
  try {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          transformation: [
            { width: 1080, height: 1080, crop: 'limit' }, // Max size
            { quality: 'auto:good' }, // Auto quality optimization
            { fetch_format: 'auto' }, // Auto format (WebP, AVIF support)
          ],
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            resolve({
              url: result.url,
              publicId: result.public_id,
              secureUrl: result.secure_url,
              width: result.width,
              height: result.height,
              format: result.format,
            });
          }
        }
      );

      // Convert buffer to stream and pipe to Cloudinary
      const readableStream = new Readable();
      readableStream.push(fileBuffer);
      readableStream.push(null);
      readableStream.pipe(uploadStream);
    });
  } catch (error) {
    console.error('[CLOUDINARY] Upload error:', error);
    throw new Error('Failed to upload image to Cloudinary');
  }
};

export const deleteImage = async (publicId: string): Promise<void> => {
  try {
    await cloudinary.uploader.destroy(publicId);
    console.log(`[CLOUDINARY] Deleted image: ${publicId}`);
  } catch (error) {
    console.error('[CLOUDINARY] Delete error:', error);
    throw new Error('Failed to delete image from Cloudinary');
  }
};

export const uploadMultipleImages = async (
  fileBuffers: Buffer[],
  folder: string = 'relun/profiles'
): Promise<UploadResult[]> => {
  try {
    const uploadPromises = fileBuffers.map((buffer) => uploadImage(buffer, folder));
    return await Promise.all(uploadPromises);
  } catch (error) {
    console.error('[CLOUDINARY] Multiple upload error:', error);
    throw new Error('Failed to upload images to Cloudinary');
  }
};
