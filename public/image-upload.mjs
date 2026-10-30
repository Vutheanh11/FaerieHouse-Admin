const maxImageBytes = 20_000_000;
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const mimeAliases = {
  "image/jpg": "image/jpeg",
  "image/jfif": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};
const extensionTypes = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", jfif: "image/jpeg",
  png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif",
};

export function imageMimeType(file) {
  const reportedType = (file.type ?? "").trim().toLowerCase();
  const mimeType = mimeAliases[reportedType] ?? reportedType;
  if (supportedTypes.has(mimeType)) return mimeType;
  // Some browsers report an empty or generic MIME type for valid image files.
  // The backend still decodes the bytes and verifies the actual image format.
  if (["", "application/octet-stream", "binary/octet-stream"].includes(reportedType)) {
    const extension = /\.([^.]+)$/.exec(file.name ?? "")?.[1].toLowerCase();
    return Object.hasOwn(extensionTypes, extension) ? extensionTypes[extension] : "";
  }
  return "";
}

export function validateImageFiles(selection, maxFiles = 1) {
  const files = Array.from(selection ?? []);
  if (files.length > maxFiles) {
    throw new Error(`Đã chọn ${files.length} ảnh. Chỉ được chọn tối đa ${maxFiles} ảnh; hãy bỏ bớt ảnh rồi thử lại.`);
  }
  for (const file of files) {
    if (!imageMimeType(file)) {
      throw new Error(`Ảnh “${file.name}” có định dạng không được hỗ trợ (${file.type || "không nhận diện được"}). Chọn JPG/JPEG, PNG, WebP hoặc HEIC/HEIF.`);
    }
    if (file.size === 0) {
      throw new Error(`Ảnh “${file.name}” là file rỗng. Hãy chọn lại ảnh.`);
    }
    if (file.size > maxImageBytes) {
      throw new Error(`Ảnh “${file.name}” có dung lượng ${(file.size / 1_000_000).toFixed(2)} MB, vượt giới hạn 20 MB mỗi ảnh.`);
    }
  }
  return files;
}
