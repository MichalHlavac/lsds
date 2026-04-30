// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Minimal POSIX ustar tar.gz writer — no external dependencies.

import { createGzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";

export interface TarEntry {
  name: string;
  content: Buffer | string;
}

function makeHeader(name: string, size: number, isDir: boolean): Buffer {
  const h = Buffer.alloc(512, 0);
  const mtime = Math.floor(Date.now() / 1000);

  h.write(name.slice(0, 99), 0, "ascii");
  h.write(isDir ? "0000755\0" : "0000644\0", 100, "ascii");
  h.write("0000000\0", 108, "ascii"); // uid
  h.write("0000000\0", 116, "ascii"); // gid
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii"); // size
  h.write(mtime.toString(8).padStart(11, "0") + "\0", 136, "ascii"); // mtime
  h.fill(0x20, 148, 156); // checksum placeholder — spaces
  h[156] = isDir ? 0x35 : 0x30; // typeflag: '5'=dir, '0'=file
  h.write("ustar\0", 257, "ascii"); // magic
  h.write("00", 263, "ascii"); // version

  let cksum = 0;
  for (let i = 0; i < 512; i++) cksum += h[i];
  h.write(cksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");

  return h;
}

export async function writeTarGz(
  outputPath: string,
  prefix: string,
  entries: TarEntry[]
): Promise<void> {
  const pass = new PassThrough();
  const gzip = createGzip();
  const dest = createWriteStream(outputPath);

  const done = pipeline(pass, gzip, dest);

  // directory entry
  pass.write(makeHeader(prefix.endsWith("/") ? prefix : prefix + "/", 0, true));

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, "utf8");
    const entryName = `${prefix}/${entry.name}`.replace(/\/+/g, "/");
    pass.write(makeHeader(entryName, data.length, false));
    pass.write(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) pass.write(Buffer.alloc(pad));
  }

  pass.write(Buffer.alloc(1024)); // end-of-archive
  pass.end();

  await done;
}
