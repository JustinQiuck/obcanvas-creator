import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
await mkdir('.local/media-fixtures', { recursive: true });
// Entirely synthetic media: geometric test chart, no production footage.
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-frames:v', '1', '.local/media-fixtures/参考图.png']);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '.local/media-fixtures/短视频.mp4']);
console.log('已准备 640 × 360 测试图和 2 秒测试视频。');
