import {readFile} from 'node:fs/promises';
import {expect, type Page} from '@playwright/test';
import {PNG} from 'pngjs';
import jsQR from 'jsqr';

export async function assertReferralCardDownload(page:Page, expectedUrl:string, privateValues:string[] = []) {
  const promise = page.waitForEvent('download');
  await page.getByRole('button',{name:'下載 QR 分享圖',exact:true}).click();
  const download = await promise;
  expect(download.suggestedFilename()).toBe('celebratedeal-referral.svg');
  const file = await download.path();
  expect(file).not.toBeNull();
  const svg = await readFile(file!, 'utf8');
  for (const value of privateValues) expect(svg).not.toContain(value);
  const encoded = svg.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/u)?.[1];
  expect(encoded).toBeTruthy();
  const png = PNG.sync.read(Buffer.from(encoded!, 'base64'));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(decoded?.data).toBe(expectedUrl);
  return {svg, destination:decoded!.data};
}
