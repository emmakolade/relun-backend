import multer from 'multer';

// Configure multer to use memory storage
const storage = multer.memoryStorage();

// The apps send a JPEG when they can decode the photo, and the original file
// when they can't (HEIC, AVIF, RAW...). Cloudinary reads all of these and
// stores them as JPEG, so accept any image. Some browsers send HEIC with no
// type, so fall back to the file extension.
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif|avif|jxl|dng|ico)$/i;

const fileFilter = (_req: any, file: Express.Multer.File, cb: any) => {
  if (file.mimetype.startsWith('image/') || IMAGE_EXTENSIONS.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error('That file isn’t a photo. Choose an image instead.'), false);
  }
};

// Multer configuration
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB; originals from modern phones can be large
  },
});
