import { readFileSync, writeFileSync } from "node:fs";
import * as ResEdit from "resedit";

const RT_GROUP_ICON = 14;

/**
 * An `.ico` file holding PNG-compressed images, which Windows Vista and later
 * read. `images` lists square images from smallest to largest.
 */
export function iconFile(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    // A zero width and height means 256 pixels.
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

/**
 * Give the packaged executable Animama's icon and version strings, as
 * electron-builder's rcedit step would. On Windows that step downloads a tool
 * archive whose macOS symlinks need Developer Mode to extract; this edits the
 * resources in place with no external tool. Existing resources, including
 * Electron's ASAR integrity record, are kept.
 */
export function brandWindowsExecutable(
  file,
  { icon, productName, companyName, copyright, version },
) {
  const executable = ResEdit.NtExecutable.from(readFileSync(file), {
    ignoreCert: true,
  });
  const resources = ResEdit.NtExecutableResource.from(executable);
  const group = resources.entries.find((entry) => entry.type === RT_GROUP_ICON);
  if (!group) throw new Error(`${file} has no icon group to replace`);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    group.id,
    group.lang,
    ResEdit.Data.IconFile.from(icon).icons.map((item) => item.data),
  );
  const [info] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if (!info) throw new Error(`${file} has no version information`);
  const [language] = info.getAllLanguagesForStringValues();
  info.setStringValues(language, {
    CompanyName: companyName,
    FileDescription: productName,
    InternalName: productName,
    LegalCopyright: copyright,
    OriginalFilename: `${productName}.exe`,
    ProductName: productName,
  });
  info.setFileVersion(version, language.lang);
  info.setProductVersion(version, language.lang);
  info.outputToResourceEntries(resources.entries);
  resources.outputResource(executable);
  writeFileSync(file, Buffer.from(executable.generate()));
}
