import assert from "node:assert/strict";
import { test } from "node:test";
import { imageMimeType, validateImageFiles } from "../public/image-upload.mjs";

const image = (name, type = "", size = 180_000) => new File([new Uint8Array(size)], name, { type });

test("180 KB images are accepted when the browser omits their MIME type", () => {
  for (const [extension, mimeType] of Object.entries({
    jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", jfif: "image/jpeg",
    png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  })) {
    const file = image(`Ảnh Faerie.${extension.toUpperCase()}`);
    assert.equal(imageMimeType(file), mimeType);
    assert.deepEqual(validateImageFiles([file], 4), [file]);
  }
});

test("generic browser MIME types fall back to the file extension", () => {
  for (const type of ["application/octet-stream", "binary/octet-stream"]) {
    assert.equal(imageMimeType(image("Faerie.jpg", type)), "image/jpeg");
    assert.equal(imageMimeType(image("Faerie.png", type)), "image/png");
  }
});

test("JPEG and PNG MIME aliases are normalized for the backend", () => {
  for (const type of ["image/jpg", "image/jfif", "image/pjpeg"]) {
    assert.equal(imageMimeType(image("Faerie.jfif", type)), "image/jpeg");
  }
  assert.equal(imageMimeType(image("Faerie.png", "image/x-png")), "image/png");
  assert.equal(imageMimeType(image("download", "image/jpeg")), "image/jpeg");
});

test("unsupported formats identify the file without blaming its size", () => {
  for (const [name, type] of [["Faerie.gif", "image/gif"], ["Faerie.avif", "image/avif"], ["Faerie.svg", "image/svg+xml"], ["unknown", ""]]) {
    assert.throws(() => validateImageFiles([image(name, type)], 4), (error) => {
      assert.ok(error.message.includes(name));
      assert.match(error.message, /định dạng không được hỗ trợ/);
      assert.doesNotMatch(error.message, /20 MB/);
      return true;
    });
  }
  assert.equal(imageMimeType(image("renamed.jpg", "image/gif")), "");
  assert.equal(imageMimeType(image("document.pdf")), "");
  assert.equal(imageMimeType(image("document.constructor")), "");
});

test("five small images report the image count while four are accepted", () => {
  const files = Array.from({ length: 5 }, (_, index) => image(`Faerie-${index}.jpg`, "image/jpeg"));
  assert.equal(validateImageFiles(files.slice(0, 4), 4).length, 4);
  assert.throws(() => validateImageFiles(files, 4), /Đã chọn 5 ảnh.*tối đa 4 ảnh/);
});

test("only oversized files get a size error and the 20 MB boundary is allowed", () => {
  assert.equal(validateImageFiles([image("20mb.jpg", "image/jpeg", 20_000_000)], 4).length, 1);
  assert.throws(() => validateImageFiles([
    image("small.jpg", "image/jpeg"), image("large.jpg", "image/jpeg", 20_000_001),
  ], 4), /large\.jpg.*vượt giới hạn 20 MB/);
});

test("empty files and multiple popup/member images get specific errors", () => {
  assert.throws(() => validateImageFiles([image("empty.png", "image/png", 0)]), /empty\.png.*file rỗng/);
  assert.throws(() => validateImageFiles([image("a.jpg"), image("b.jpg")]), /Đã chọn 2 ảnh.*tối đa 1 ảnh/);
  assert.deepEqual(validateImageFiles(undefined, 4), []);
});
