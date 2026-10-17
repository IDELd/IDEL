const path = require("path");
const fs = require("fs");
const multer = require("multer");

// Папка загрузок: в продакшене обычно указывают постоянный диск (UPLOAD_DIR).
const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "..", "uploads");

const LIMITS = {
  avatars: 5 * 1024 * 1024,
  covers: 5 * 1024 * 1024,
  posts: 10 * 1024 * 1024,
  voice: 10 * 1024 * 1024,
  video: 25 * 1024 * 1024,
};

function makeUploader(subfolder) {
  const dir = path.join(UPLOAD_ROOT, subfolder);
  fs.mkdirSync(dir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").slice(0, 10);
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
      cb(null, name);
    },
  });
  return multer({ storage, limits: { fileSize: LIMITS[subfolder] || 10 * 1024 * 1024 } });
}

const uploadAvatar = makeUploader("avatars");
const uploadCover = makeUploader("covers");
const uploadPostImage = makeUploader("posts");
const uploadVoice = makeUploader("voice");
const uploadVideo = makeUploader("video");

/** Builds the public URL for a file saved under uploads/<subfolder>/<filename>. */
function fileUrl(req, subfolder, filename) {
  const base = `${req.protocol}://${req.get("host")}`;
  return `${base}/uploads/${subfolder}/${filename}`;
}

module.exports = {
  UPLOAD_ROOT,
  uploadAvatar,
  uploadCover,
  uploadPostImage,
  uploadVoice,
  uploadVideo,
  fileUrl,
};
