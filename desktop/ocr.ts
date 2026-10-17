import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Reading the text on scanned pages with Windows' own OCR (Windows.Media.Ocr): offline, nothing to download, in the
 * languages installed on this PC. Each page is read in the person's language first; a page that says little is read
 * again in the other installed languages (an Arabic scan on an English Windows), and the fullest reading is kept.
 * The window draws the pages (src/desktop/ocr.ts); this only reads the pictures.
 */
const SCRIPT = String.raw`param([string]$List)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + "`" + String.raw`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$first = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$engines = @($first) + @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Where-Object { -not $first -or $_.LanguageTag -ne $first.RecognizerLanguage.LanguageTag } | ForEach-Object { [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($_) }) | Where-Object { $_ }
if (-not $engines) { [Console]::Error.WriteLine("Windows has no OCR language installed, so scanned pages cannot be read. Add a language with its text recognition in Settings > Time & language > Language."); exit 3 }
$out = @()
foreach ($path in (Get-Content -LiteralPath $List -Encoding UTF8)) {
  if (-not $path) { continue }
  $text = $null
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync([IO.Path]::GetFullPath($path))) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $best = 0
    $text = ""
    foreach ($engine in $engines) {
      $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      # Windows lists a right-to-left line's words from left to right on the page: Arabic and Hebrew lines are put back in reading order.
      $read = (($result.Lines | ForEach-Object { $words = @($_.Words | ForEach-Object { $_.Text }); $rtl = ([regex]::Matches($_.Text, '[֐-ࣿ]')).Count; if ($rtl -gt ([regex]::Matches($_.Text, '[A-Za-z]')).Count) { [array]::Reverse($words) }; $words -join ' ' }) -join "` + "`" + String.raw`n")
      $letters = ([regex]::Matches($read, '\p{L}')).Count
      if ($letters -gt $best) { $best = $letters; $text = $read }
      if ($best -ge 60) { break }
    }
    $stream.Dispose()
  } catch { $text = $null }
  $out += ,$text
}
[Console]::OutputEncoding = [Text.Encoding]::UTF8
ConvertTo-Json -InputObject @($out) -Compress
`;

/** At most this many pages a call, so one call ends well within its time limit. */
export const OCR_BATCH = 12;

/** The text of each picture (PNG or JPEG), in order; null for one that could not be read, to be tried again later.
 *  Throws when Windows has no OCR language at all. */
export async function readPictures(folder: string, pictures: Uint8Array[]): Promise<(string | null)[]> {
  if (process.platform !== "win32" || !pictures.length) return pictures.map(() => "");
  const work = join(folder, "ocr-" + randomUUID());
  await mkdir(work, { recursive: true });
  try {
    const script = join(work, "ocr.ps1"), list = join(work, "list.txt");
    // A BOM, so Windows PowerShell reads the script and the list as UTF-8 (folders with Arabic names).
    await writeFile(script, "﻿" + SCRIPT);
    const paths = await Promise.all(pictures.slice(0, OCR_BATCH).map(async (data, i) => {
      const path = join(work, `${i + 1}${data[0] === 0x89 ? ".png" : ".jpg"}`);
      await writeFile(path, data);
      return path;
    }));
    await writeFile(list, "﻿" + paths.join("\r\n"));
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-List", list], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      const timer = setTimeout(() => { child.kill(); reject(Error("Reading the scanned pages took too long.")); }, 120_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (part: string) => { out += part; });
      child.stderr.on("data", (part) => { err = (err + part).slice(-2000); });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(Error(err.trim() || "Windows could not read the scanned pages.")); });
    });
    const texts = JSON.parse(output.trim().replace(/^﻿/, "") || "[]");
    return paths.map((_, i) => (typeof texts[i] === "string" ? texts[i] : null));
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
