// General purpose bit 11: file names are UTF-8 encoded.
const UTF8_FLAG = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      if ((value & 1) === 1) {
        value = 0xedb88320 ^ (value >>> 1);
      } else {
        value >>>= 1;
      }
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dateToDosTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | seconds;

  return { dosDate, dosTime };
}

function u16(value) {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setUint16(0, value, true);
  return new Uint8Array(buffer);
}

function u32(value) {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, value, true);
  return new Uint8Array(buffer);
}

function encodeText(value) {
  return new TextEncoder().encode(value);
}

export function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encodeText(file.path);
    const dataBytes = typeof file.text === "string" ? encodeText(file.text) : file.bytes;
    const checksum = crc32(dataBytes);
    const modifiedAt = file.lastModified ? new Date(file.lastModified) : new Date();
    const { dosDate, dosTime } = dateToDosTime(modifiedAt);

    const localHeader = [
      u32(0x04034b50),
      u16(20),
      u16(UTF8_FLAG),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(checksum),
      u32(dataBytes.length),
      u32(dataBytes.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      dataBytes,
    ];

    const localSize = localHeader.reduce((size, chunk) => size + chunk.length, 0);
    localParts.push(...localHeader);

    const centralHeader = [
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(UTF8_FLAG),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(checksum),
      u32(dataBytes.length),
      u32(dataBytes.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ];

    centralParts.push(...centralHeader);
    offset += localSize;
  }

  const centralSize = centralParts.reduce((size, chunk) => size + chunk.length, 0);
  const endRecord = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  ];

  return new Blob([...localParts, ...centralParts, ...endRecord], {
    type: "application/zip",
  });
}
